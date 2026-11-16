import {linkedTenant} from './melodi-tenants.js';
import {dispatchDueCalls,ensureCalls,deliverCallFailures} from './melodi-calls.js';

// An outbound-only host. A device credential never grants access to another
// phone, and a claimed operation is never returned to the pending queue.
export const DESKTOP_SCHEMA=Object.freeze([
 `CREATE TABLE IF NOT EXISTS brivany_desktop_devices(device_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,phone TEXT NOT NULL,device_name TEXT NOT NULL,key_hash TEXT NOT NULL,enabled INTEGER NOT NULL,last_seen INTEGER NOT NULL,created_at INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS brivany_desktop_owner ON brivany_desktop_devices(phone,enabled,last_seen)`,
 `CREATE TABLE IF NOT EXISTS brivany_desktop_commands(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,phone TEXT NOT NULL,request_hash TEXT NOT NULL,payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,pull_id TEXT,lease_hash TEXT,updated_at INTEGER NOT NULL,result_encrypted TEXT,result_iv TEXT,control_encrypted TEXT,control_iv TEXT,control_revision INTEGER NOT NULL DEFAULT 0,delivery_state TEXT NOT NULL DEFAULT 'pending',receipt_id TEXT,UNIQUE(device_id,request_hash))`,
 `CREATE INDEX IF NOT EXISTS brivany_desktop_pending ON brivany_desktop_commands(device_id,state,created_at)`,
 `CREATE INDEX IF NOT EXISTS brivany_desktop_delivery ON brivany_desktop_commands(phone,delivery_state,state)`
]);
export const desktopId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const desktopHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const keyOK=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>{if(!keyOK(a)||!keyOK(b))return false;let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
const stmt=(env,sql,...args)=>env.VETSA_CLOUD.prepare(sql).bind(...args);
const owner=env=>String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
export async function ensureDesktop(env){await env.VETSA_CLOUD.batch(DESKTOP_SCHEMA.map(sql=>env.VETSA_CLOUD.prepare(sql)));}
const decode=async(services,row,key)=>{const value=await services.decrypt(row[key+'_encrypted'],row[key+'_iv']);return typeof value==='string'?JSON.parse(value):value;};
const publicDevice=row=>row?{device_id:row.device_id,device_name:row.device_name,status:row.enabled&&row.last_seen>Date.now()-45000?'online':'offline',last_seen:new Date(row.last_seen).toISOString(),transport:'brivany'}:null;

export async function findBrivanyDesktop(env,phone){
 if(!await stmt(env,"SELECT name FROM sqlite_master WHERE type='table' AND name='brivany_desktop_devices'").first())return null;
 const row=await stmt(env,'SELECT * FROM brivany_desktop_devices WHERE phone=? ORDER BY enabled DESC,last_seen DESC,device_id ASC LIMIT 1',phone).first();
 return publicDevice(row);
}
export async function createDesktopCommand(env,deviceId,phone,type,instruction,payload,services,{now=Date.now(),ttl=600000}={}){
 if(!await stmt(env,"SELECT name FROM sqlite_master WHERE type='table' AND name='brivany_desktop_devices'").first())return null;
 const device=await stmt(env,'SELECT * FROM brivany_desktop_devices WHERE device_id=? AND phone=?',deviceId,phone).first();
 if(!device)return null;
 const tenant=await linkedTenant(env,phone,services);
 if(!device.enabled||!tenant||tenant.userId!==device.user_id)throw Error('desktop_disabled');
 if(!['instruction','instruction_reference','screenshot'].includes(type)||typeof instruction!=='string'||!instruction.trim()||instruction.length>2000)throw Error('desktop_instruction_invalid');
 if(!Number.isInteger(ttl)||ttl<1000||ttl>600000)throw Error('desktop_ttl_invalid');
 const requestKey=payload?.requestKey||crypto.randomUUID();
 if(typeof requestKey!=='string'||requestKey.length>600)throw Error('desktop_request_invalid');
 const requestHash=await desktopHash(phone+':'+requestKey),id=crypto.randomUUID();
 const sealed=await services.encrypt(JSON.stringify({id,deviceId,phone,type,instruction,payload:payload||{}}));
 await stmt(env,`INSERT OR IGNORE INTO brivany_desktop_commands(id,device_id,phone,request_hash,payload_encrypted,payload_iv,state,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?,?)`,id,deviceId,phone,requestHash,sealed.encrypted,sealed.iv,now,now+ttl,now).run();
 return (await stmt(env,'SELECT id FROM brivany_desktop_commands WHERE device_id=? AND request_hash=?',deviceId,requestHash).first()).id;
}
async function authenticate(env,data,services){
 if(!desktopId(data.deviceId)||!keyOK(data.deviceKey))return null;
 const row=await stmt(env,'SELECT * FROM brivany_desktop_devices WHERE device_id=?',data.deviceId).first();
 if(!row?.enabled||!same(row.key_hash,await desktopHash(data.deviceKey)))return null;
 const tenant=await linkedTenant(env,row.phone,services);
 return tenant&&tenant.userId===row.user_id?row:null;
}
async function boundedBody(request,max=18000){
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('invalid_body');
 const reader=request.body?.getReader();if(!reader)throw Error('invalid_body');let size=0;const chunks=[];
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>max){await reader.cancel();throw Error('invalid_body');}chunks.push(item.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid_body');return data;
}
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function handleDesktopRoute(request,env,services,{userFromRequest}={}){
 const path=new URL(request.url).pathname.replace('/api/brivany/whatsapp/desktop/','');
 if(!['register','poll','update','disable','artifact','reference'].includes(path)||request.method!=='POST'||new URL(request.url).search)return json({error:'Ruta no disponible.'},404);
 let data;try{data=await boundedBody(request,path==='artifact'?7100000:18000);}catch{return json({error:'Solicitud no válida.'},400);}
 await ensureDesktop(env);const now=Date.now();
 if(path==='register'){
  const user=await userFromRequest?.(request,{...env,MELODI_APP_CLIENT:'brivany-desktop'});if(!user)return json({error:'Inicia sesión en Brivany.'},401);
  const link=await stmt(env,'SELECT phone FROM vetsa_app_agent_links WHERE user_id=? AND linked_at IS NOT NULL',user.id).first();
  if(!link?.phone)return json({error:'Vincula tu WhatsApp desde Brivany.'},403);
  if(!desktopId(data.deviceId)||!keyOK(data.deviceKey)||typeof data.name!=='string'||!data.name.trim()||data.name.length>80||/[\x00-\x1f]/.test(data.name))return json({error:'Equipo no válido.'},400);
  if(data.demoToken!==undefined){
   if(typeof data.demoToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.demoToken)||!env.BRIVANY_DEMO?.enroll)return json({error:'La cuenta de demostración no está disponible.'},403);
   try{await env.BRIVANY_DEMO.enroll(user.id,data.demoToken,link.phone);}catch{return json({error:'No se pudo vincular la cuenta de demostración.'},403);}
  }
  const hash=await desktopHash(data.deviceKey);
  const changed=await stmt(env,`INSERT INTO brivany_desktop_devices VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(device_id) DO UPDATE SET enabled=1,last_seen=excluded.last_seen,device_name=excluded.device_name WHERE user_id=excluded.user_id AND phone=excluded.phone AND key_hash=excluded.key_hash RETURNING device_id`,data.deviceId,user.id,link.phone,data.name,hash,now,now).first();
  return changed?json({registered:true,phone:'••••'+link.phone.slice(-4)}):json({error:'La identidad del equipo cambió.'},403);
 }
 const device=await authenticate(env,data,services);if(!device)return json({error:'Control remoto desactivado o vínculo revocado.'},403);
 if(path==='disable'){
  await env.VETSA_CLOUD.batch([stmt(env,'UPDATE brivany_desktop_devices SET enabled=0,last_seen=? WHERE device_id=?',now,device.device_id),stmt(env,"UPDATE brivany_desktop_commands SET state='cancelled',result_encrypted=NULL,result_iv=NULL,updated_at=? WHERE device_id=? AND state IN ('pending','claimed','running','awaiting_approval','waiting_for_user','cancel_requested')",now,device.device_id)]);
  return json({enabled:false});
 }
 await stmt(env,'UPDATE brivany_desktop_devices SET last_seen=? WHERE device_id=?',now,device.device_id).run();
 if(path==='poll'){
  if(!desktopId(data.pullId)||!keyOK(data.lease))return json({error:'Consulta no válida.'},400);
  await dispatchDueCalls(env,services,{phone:device.phone,now});
  // Expired jobs are reported, never executed late or automatically replayed.
  await stmt(env,"UPDATE brivany_desktop_commands SET state='expired',updated_at=? WHERE device_id=? AND state IN ('pending','claimed') AND expires_at<=?",now,device.device_id,now).run();
  const leaseHash=await desktopHash(data.lease);
  let command=await stmt(env,'SELECT * FROM brivany_desktop_commands WHERE device_id=? AND pull_id=? AND lease_hash=? AND state=\'claimed\'',device.device_id,data.pullId,leaseHash).first();
  if(!command)command=await stmt(env,`UPDATE brivany_desktop_commands SET state='claimed',pull_id=?,lease_hash=?,updated_at=? WHERE id=(SELECT id FROM brivany_desktop_commands WHERE device_id=? AND state='pending' AND expires_at>? ORDER BY created_at,id LIMIT 1) AND state='pending' RETURNING *`,data.pullId,leaseHash,now,device.device_id,now).first();
  const {results:active=[]}=await stmt(env,"SELECT id,state,control_encrypted,control_iv,control_revision FROM brivany_desktop_commands WHERE device_id=? AND state IN ('running','awaiting_approval','waiting_for_user','cancel_requested') ORDER BY created_at LIMIT 16",device.device_id).all();
  const controls=[];for(const row of active)if(row.control_encrypted)controls.push({id:row.id,revision:row.control_revision,...await decode(services,row,'control')});
  let value=null;if(command){value=await decode(services,command,'payload');if(value.id!==command.id||value.deviceId!==device.device_id||value.phone!==device.phone)throw Error('desktop_payload_integrity');value.expiresAt=command.expires_at;}
  return json({enabled:true,command:value,controls,activeIds:active.map(row=>row.id),pollAfterMs:active.length?2000:5000});
 }
 if(!desktopId(data.id))return json({error:'Tarea no válida.'},400);
 const row=await stmt(env,'SELECT * FROM brivany_desktop_commands WHERE id=? AND device_id=? AND phone=?',data.id,device.device_id,device.phone).first();
 if(!row||!keyOK(data.lease)||!same(row.lease_hash,await desktopHash(data.lease)))return json({error:'Tarea no disponible.'},403);
 if(path==='reference'){
  if(row.state!=='running'||!['image','video'].includes(data.kind))return json({error:'Referencia no disponible.'},403);
  const value=await decode(services,row,'payload');
  if(value.id!==row.id||value.phone!==device.phone||value.deviceId!==device.device_id)throw Error('desktop_payload_integrity');
  const reference=value.payload?.[data.kind==='image'?'referenceImage':'sourceVideo'];
  if(typeof reference?.objectKey!=='string'||!/^melodi-private\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9/-]{1,160}$/.test(reference.objectKey))return json({error:'Referencia no disponible.'},404);
  const object=await env.VETSA_MEDIA.get(reference.objectKey),mime=object?.httpMetadata?.contentType;
  const allowed=data.kind==='image'?['image/png','image/jpeg','image/webp']:['video/mp4','video/quicktime','video/webm'];
  if(!object||!allowed.includes(mime)||object.size<=0||object.size>50000000)return json({error:'El adjunto no está disponible o supera 50 MB.'},413);
  return new Response(object.body,{headers:{'Content-Type':mime,'Content-Length':String(object.size),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='artifact'){
  if(!['running','awaiting_approval','waiting_for_user','cancel_requested'].includes(row.state)||!['image/png','image/jpeg','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','video/mp4'].includes(data.mimeType)||typeof data.base64!=='string'||data.base64.length>7000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64))return json({error:'Archivo no válido.'},400);
  const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>5000000)return json({error:'El archivo supera 5 MB.'},413);
  const key=`melodi-desktop/${device.device_id}/${row.id}`;
  await env.VETSA_MEDIA.put(key,bytes,{httpMetadata:{contentType:data.mimeType}});
  return json({stored:true});
 }
 const states=new Set(['accepted','running','awaiting_approval','waiting_for_user','succeeded','failed','cancelled','interrupted']);
 if(!states.has(data.state))return json({error:'Estado no válido.'},400);
 if(data.state==='accepted'){
  if(row.state==='claimed'&&row.expires_at>now)await stmt(env,"UPDATE brivany_desktop_commands SET state='running',updated_at=? WHERE id=? AND state='claimed' AND expires_at>?",now,row.id,now).run();
  const current=await stmt(env,'SELECT state FROM brivany_desktop_commands WHERE id=?',row.id).first();
  return json({accepted:current.state==='running',state:current.state});
 }
 if(!['running','awaiting_approval','waiting_for_user','cancel_requested'].includes(row.state))return json({accepted:false,state:row.state});
 const result=data.result||{};
 if(typeof result!=='object'||Array.isArray(result)||typeof result.summary!=='string'||result.summary.length>3000||Object.keys(result).some(k=>!['summary','approval','artifact','externalCalls'].includes(k)))return json({error:'Resultado no válido.'},400);
 if(result.approval&&(!['awaiting_approval'].includes(data.state)||typeof result.approval.id!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(result.approval.id)||typeof result.approval.description!=='string'||result.approval.description.length>2000))return json({error:'Aprobación no válida.'},400);
 if(result.artifact&&(!['image','document','video'].includes(result.artifact.kind)||typeof result.artifact.fileName!=='string'||!/^[\p{L}\p{N} _.()-]{1,120}$/u.test(result.artifact.fileName)))return json({error:'Adjunto no válido.'},400);
 const sealed=await services.encrypt(JSON.stringify({...result,id:row.id,deviceId:device.device_id,phone:device.phone}));
 await stmt(env,"UPDATE brivany_desktop_commands SET state=?,result_encrypted=?,result_iv=?,updated_at=?,delivery_state=CASE WHEN state<>? THEN 'pending' ELSE delivery_state END WHERE id=? AND state IN ('running','awaiting_approval','waiting_for_user','cancel_requested')",data.state,sealed.encrypted,sealed.iv,now,data.state,row.id).run();
 if(['succeeded','failed','cancelled','interrupted'].includes(data.state))await stmt(env,'UPDATE brivany_call_schedules SET state=?,updated_at=? WHERE command_id=? AND phone=?',data.state,now,row.id,device.phone).run();
 if(env.MELODI_JOBS)await env.MELODI_JOBS.send({type:'melodi_desktop_delivery',ownerPhone:device.phone,commandId:row.id});
 return json({accepted:true,state:data.state});
}

export async function desktopControl(env,phone,incoming,services,reply){
 const match=/^PC (cancelar|aprobar|rechazar|continuar) ([a-f0-9-]{36})(?: ([A-Za-z0-9_-]{32}))?$/i.exec(incoming.trim());if(!match)return false;
 await ensureDesktop(env);const row=await stmt(env,'SELECT * FROM brivany_desktop_commands WHERE id=? AND phone=?',match[2],phone).first();
 if(!row){await reply('No encuentro esa tarea en tu cuenta.');return true;}
 const action=match[1].toLowerCase();let value={action};
 if(action==='aprobar'||action==='rechazar'){
  const result=row.result_encrypted?await decode(services,row,'result'):null;
  if(row.state!=='awaiting_approval'||!match[3]||result?.approval?.id!==match[3]){await reply('Esa aprobación ya no está disponible.');return true;}
  value={action:'approval',approvalId:match[3],accepted:action==='aprobar'};
 }else if(action==='continuar'&&row.state!=='waiting_for_user'){await reply('Esa tarea no está esperando una intervención.');return true;}
 else if(action==='cancelar'&&row.state==='pending'){
  await stmt(env,"UPDATE brivany_desktop_commands SET state='cancelled',updated_at=? WHERE id=? AND state='pending'",Date.now(),row.id).run();await reply('Cancelé la tarea antes de enviarla al ordenador.');return true;
 }else if(action==='cancelar'&&!['claimed','running','awaiting_approval','waiting_for_user','cancel_requested'].includes(row.state)){await reply('La tarea ya terminó.');return true;}
 const sealed=await services.encrypt(JSON.stringify(value));
 await stmt(env,"UPDATE brivany_desktop_commands SET control_encrypted=?,control_iv=?,control_revision=control_revision+1,delivery_state='pending',state=CASE WHEN ?='cancelar' THEN 'cancel_requested' ELSE state END WHERE id=? AND phone=?",sealed.encrypted,sealed.iv,action,row.id,phone).run();
 await reply(action==='cancelar'?'Pedí al ordenador que detenga esa tarea.':'Envié tu respuesta para esta tarea concreta.');return true;
}
export async function deliverDesktopResults(env,services,sendText,sendMedia,{commandId}={}){
 await ensureDesktop(env);await ensureCalls(env);const phone=owner(env);
 const now=Date.now();
 await stmt(env,"UPDATE brivany_desktop_commands SET state='expired',updated_at=? WHERE phone=? AND state IN ('pending','claimed') AND expires_at<=?",now,phone,now).run();
 await stmt(env,"UPDATE brivany_desktop_commands SET state='interrupted',result_encrypted=NULL,result_iv=NULL,delivery_state='pending',updated_at=? WHERE phone=? AND state IN ('running','cancel_requested') AND updated_at<?",now,phone,now-1200000).run();
 await stmt(env,"UPDATE brivany_call_schedules SET state=(SELECT state FROM brivany_desktop_commands c WHERE c.id=command_id),updated_at=? WHERE phone=? AND state='queued' AND command_id IN (SELECT id FROM brivany_desktop_commands WHERE state IN ('expired','interrupted','cancelled'))",now,phone).run();
 const {results:rows=[]}=await stmt(env,`SELECT * FROM brivany_desktop_commands WHERE phone=? AND delivery_state='pending' AND state IN ('succeeded','failed','cancelled','interrupted','expired','awaiting_approval','waiting_for_user') ${commandId?'AND id=?':''} ORDER BY updated_at LIMIT 5`,phone,...(commandId?[commandId]:[])).all();
 for(const row of rows){
  const claim=await stmt(env,"UPDATE brivany_desktop_commands SET delivery_state='sending' WHERE id=? AND state=? AND delivery_state='pending'",row.id,row.state).run();if(!claim.meta?.changes)continue;
  try{
   const result=row.result_encrypted?await decode(services,row,'result'):{summary:row.state==='cancelled'?'El control del ordenador se desactivó.':'La orden caducó antes de que el equipo confirmara su inicio.'};
   if(row.result_encrypted&&(result.id!==row.id||result.deviceId!==row.device_id||result.phone!==phone))throw Error('desktop_result_integrity');
   let body=row.state==='succeeded'?'Terminé la tarea en tu ordenador.':row.state==='awaiting_approval'?'Necesito tu aprobación para esta acción concreta:':row.state==='waiting_for_user'?'La tarea está esperando tu intervención:':'La tarea no se completó.';
   body+='\n'+result.summary;
   if(result.approval)body+='\n'+result.approval.description+`\nPara autorizar: PC aprobar ${row.id} ${result.approval.id}\nPara rechazar: PC rechazar ${row.id} ${result.approval.id}`;
   if(row.state==='waiting_for_user')body+=`\nCuando resuelvas el bloqueo: PC continuar ${row.id}`;
   let receipt;
   if(row.state==='succeeded'&&result.artifact){const object=await env.VETSA_MEDIA.get(`melodi-desktop/${row.device_id}/${row.id}`);if(!object||object.size>5000000)throw Error('desktop_artifact_missing');receipt=await sendMedia(env,phone,result.artifact.kind,new Uint8Array(await object.arrayBuffer()),object.httpMetadata.contentType,result.artifact.fileName,body);}
   else receipt=await sendText(env,phone,body);
   await stmt(env,"UPDATE brivany_desktop_commands SET delivery_state='accepted',receipt_id=? WHERE id=? AND delivery_state='sending'",receipt?.messageId||null,row.id).run();
  }catch{await stmt(env,"UPDATE brivany_desktop_commands SET delivery_state='uncertain' WHERE id=? AND delivery_state='sending'",row.id).run();}
 }
 await deliverCallFailures(env,sendText);
}
