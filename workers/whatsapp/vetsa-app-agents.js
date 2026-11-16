import {appCalendarReadRoute} from './vetsa-app-calendar.js';
import {meetingRoute} from './meetings/service.js';
import {createGoogleCalendarStore} from './google-calendar-store.js';
import {getGoogleCalendarAccessToken} from './google-calendar-auth.js';
import {ensureTenantSchema,saveTenantProfile,linkedTenant,tenantEnvironment} from './melodi-tenants.js';
import {melodiEnvironment} from './melodi-identity.js';
import {createGoogleCalendarLink} from './google-calendar-auth.js';
import {createDriveLink} from './drive-auth.js';
import {createGmailLink} from './gmail-auth.js';
import {handleDesktopRoute} from './melodi-desktop.js';
// Private service binding into the existing WhatsApp runtime. No bot/provider
// credentials, phone identity or account IDs are supplied by the mobile client.
const agents=[{id:'melodi',name:'Melodi',role:'Tu compañera de Brivany'}];
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const ownerPhone=env=>String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
const query=(env,sql,...values)=>env.VETSA_CLOUD.prepare(sql).bind(...values);
export const appAgentSchema=[
 `CREATE TABLE IF NOT EXISTS vetsa_app_agent_links(user_id TEXT PRIMARY KEY,phone TEXT UNIQUE,linked_at INTEGER,next_link_at INTEGER NOT NULL DEFAULT 0,next_message_at INTEGER NOT NULL DEFAULT 0)`,
 `CREATE TABLE IF NOT EXISTS vetsa_app_agent_codes(code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS brivany_whatsapp_messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,agent TEXT NOT NULL,role TEXT NOT NULL,encrypted TEXT NOT NULL,iv TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'done')`,
 `CREATE INDEX IF NOT EXISTS brivany_whatsapp_messages_owner ON brivany_whatsapp_messages(user_id,agent,created_at)`
];
async function body(request){
 const reader=request.body?.getReader();if(!reader)return {};
 let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>10000){await reader.cancel();throw Error('body_too_large')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function userFromRequest(request,env){
 const authorization=request.headers.get('Authorization');if(!authorization?.startsWith('Bearer ')||authorization.length>16400)return null;
 const brivany=env.MELODI_APP_CLIENT==='brivany-desktop';
 const target=new Request('https://cognira.vetsa.es'+(brivany?'/api/brivany/account/session':'/api/vetsa-app/session'),{headers:{Authorization:authorization},signal:AbortSignal.timeout(15000),redirect:'manual'});
 const r=env.VETSA_IDENTITY?await env.VETSA_IDENTITY.fetch(target):await fetch(target.url,{headers:{Authorization:authorization},signal:target.signal,redirect:'manual'});
 if(!r.ok)return null;const data=await r.json();return data.authenticated&&(!brivany||data.client==='brivany-desktop')&&typeof data.user?.id==='string'?data.user:null;
}
async function save(env,services,{id,userId,agent,role,text,status='done'}){
 const sealed=await services.encrypt(JSON.stringify({userId,agent,role,text:String(text).slice(0,12000)}));
 await query(env,'INSERT OR IGNORE INTO brivany_whatsapp_messages(id,user_id,agent,role,encrypted,iv,created_at,status) VALUES (?,?,?,?,?,?,?,?)',id,userId,agent,role,sealed.encrypted,sealed.iv,Date.now(),status).run();
}
export async function appAgentRoute(request,env,services){
 env=melodiEnvironment(env);
 const user=await userFromRequest(request,env);if(!user)return json({error:'Inicia sesión con tu cuenta Vetsa.'},401);
 await env.VETSA_CLOUD.batch(appAgentSchema.map(sql=>env.VETSA_CLOUD.prepare(sql)));
 await ensureTenantSchema(env);
 const url=new URL(request.url),path=url.pathname,now=Date.now();
 const link=await query(env,'SELECT phone FROM vetsa_app_agent_links WHERE user_id=?',user.id).first();
 const linked=/^\d{8,15}$/.test(link?.phone||'');
 const number=String(env.ASSISTANT_WHATSAPP_NUMBER||'').replace(/\D/g,'');
 if(path==='/agents/integrations'&&request.method==='GET'){
  if(!linked)return json({integrations:[],linked:false});
  // Only metadata for a connection owned by the verified WhatsApp identity.
  // Credentials stay encrypted in the assistant's store.
  const exists=await query(env,"SELECT name FROM sqlite_master WHERE type='table' AND name='google_calendar_connections'").first();
  const connection=exists?await query(env,'SELECT status FROM google_calendar_connections WHERE owner=?',link.phone).first():null;
  return json({linked:true,integrations:connection?.status==='connected'?[{provider:'calendar',source:'vetsa-assistants',connected:true}]:[]});
 }
 if(path==='/agents'&&request.method==='GET')return json({agents,linked,number,name:'Melodi',url:/^\d{8,15}$/.test(number)?'https://wa.me/'+number:null,
   phone:linked?'••••'+link.phone.slice(-4):null});
 if(path==='/agents/link'&&request.method==='POST'){
  let settings;try{settings=await body(request);}catch{return json({error:'Solicitud no válida.'},400);}
  if(Object.keys(settings).some(key=>key!=='timeZone'))return json({error:'Solicitud no válida.'},400);
  if(typeof user.email==='string'&&user.email.includes('@'))await saveTenantProfile(env,user,services,{timeZone:settings.timeZone||env.TIME_ZONE||'UTC'});
  const reservation=await query(env,`INSERT INTO vetsa_app_agent_links(user_id,next_link_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET next_link_at=excluded.next_link_at WHERE next_link_at<=? RETURNING user_id`,user.id,now+60000,now).first();
  if(!reservation)return json({error:'Espera un minuto antes de solicitar otro enlace.'},429);
  const code=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b%32]).join('');
  await env.VETSA_CLOUD.batch([query(env,'DELETE FROM vetsa_app_agent_codes WHERE user_id=? OR expires_at<?',user.id,now),query(env,'INSERT INTO vetsa_app_agent_codes VALUES(?,?,?)',await hash(code),user.id,now+600000)]);
  const number=String(env.ASSISTANT_WHATSAPP_NUMBER||'').replace(/\D/g,'');
  if(!/^\d{8,15}$/.test(number))return json({error:'El servicio de vinculación no está disponible.'},503);
  return json({number,name:'Melodi',url:'https://wa.me/'+number+'?text='+encodeURIComponent('Brivany vincular '+code),expiresAt:now+600000});
 }
 if(path==='/agents/unlink'&&request.method==='POST'){
  await env.VETSA_CLOUD.batch([query(env,'UPDATE vetsa_app_agent_links SET phone=NULL,linked_at=NULL WHERE user_id=?',user.id),query(env,'DELETE FROM vetsa_app_agent_codes WHERE user_id=?',user.id)]);
  return json({linked:false});
 }
 if(!linked)return json({error:'Vincula tu WhatsApp autorizado para acceder a tus agentes.',linkRequired:true},403);
 const tenant=await linkedTenant(env,link.phone,services);if(!tenant)return json({error:'Vuelve a vincular tu cuenta.'},403);
 env=tenantEnvironment(env,tenant);
 if(path==='/agents/meetings'||path.startsWith('/agents/meetings/'))return meetingRoute(request,env,user.id,link.phone);
 const google=path.match(/^\/agents\/google\/(calendar|drive|gmail)$/);
 if(google&&request.method==='POST'){
  const factory={calendar:createGoogleCalendarLink,drive:createDriveLink,gmail:createGmailLink}[google[1]];
  const result=await factory(env);return json(result,result.configured?200:503);
 }
 if(path==='/agents/calendar/events'&&request.method==='GET')return appCalendarReadRoute(request,env,{owner:link.phone,createStore:createGoogleCalendarStore,getAccessToken:getGoogleCalendarAccessToken});
 if(path==='/agents/reminders'&&request.method==='GET'){
  const {results=[]}=await query(env,"SELECT id,title,event_at,reminded_at,updated_at FROM melodi_calendar_events WHERE phone=? AND event_type='REMINDER' AND (assigned_agent IS NULL OR assigned_agent='melodi') AND reminded_at IS NULL AND julianday(event_at)>=julianday(?) ORDER BY event_at ASC LIMIT 200",link.phone,new Intl.DateTimeFormat('en-CA',{timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now))+'T00:00:00-04:00').all();
  return json({reminders:results.map(row=>({id:row.id,title:row.title,eventAt:row.event_at,completed:!!row.reminded_at,updatedAt:row.updated_at}))});
 }
 if(path==='/agents/reminders'&&request.method==='POST'){
  let data;try{data=await body(request)}catch{return json({error:'Recordatorio no válido.'},400)}
  if(data.completed==='true')data.completed=true;else if(data.completed==='false')data.completed=false;
  if(typeof data.id!=='string'||data.id.length>100||typeof data.completed!=='boolean')return json({error:'Recordatorio no válido.'},400);
  const existing=await query(env,"SELECT id,event_at FROM melodi_calendar_events WHERE id=? AND phone=? AND event_type='REMINDER' AND (assigned_agent IS NULL OR assigned_agent='melodi')",data.id,link.phone).first();
  if(!existing)return json({error:'Este recordatorio ya no está disponible.'},404);
  if(!data.completed&&new Date(existing.event_at).getTime()<=now)return json({error:'Elige una fecha futura para reactivar este recordatorio desde Melodi.'},400);
  await query(env,"UPDATE melodi_calendar_events SET reminded_at=?,updated_at=? WHERE id=? AND phone=?",data.completed?new Date(now).toISOString():null,new Date(now).toISOString(),data.id,link.phone).run();return json({success:true});
 }
 if(path==='/agents/messages'&&request.method==='GET'){
  const agent=url.searchParams.get('agent');if(!agents.some(a=>a.id===agent))return json({error:'Agente no válido.'},400);
  const {results=[]}=await query(env,'SELECT * FROM brivany_whatsapp_messages WHERE user_id=? AND agent=? ORDER BY created_at DESC,id DESC LIMIT 100',user.id,agent).all();
  const messages=[];for(const row of results.reverse()){
   const decoded=await services.decrypt(row.encrypted,row.iv),value=typeof decoded==='string'?JSON.parse(decoded):decoded;
   if(value.userId!==user.id||value.agent!==agent||value.role!==row.role)throw Error('app_conversation_integrity');
   messages.push({id:row.id,role:row.role,text:value.text,createdAt:row.created_at,status:row.status});
  }
  return json({messages});
 }
 if(path==='/agents/messages'&&request.method==='POST'){
  let data;try{data=await body(request)}catch{return json({error:'Mensaje no válido.'},400)}
  if(!agents.some(a=>a.id===data.agent)||typeof data.text!=='string'||!data.text.trim()||data.text.length>4000||!/^[a-f0-9-]{36}$/i.test(data.clientId||''))return json({error:'Mensaje no válido.'},400);
  const id='app:'+user.id+':'+data.clientId;
  const existing=await query(env,'SELECT id,status FROM brivany_whatsapp_messages WHERE id=? AND user_id=?',id,user.id).first();
  if(!existing){
   const allowed=await query(env,'UPDATE vetsa_app_agent_links SET next_message_at=? WHERE user_id=? AND next_message_at<=? RETURNING user_id',now+3000,user.id,now).first();
   if(!allowed)return json({error:'Espera unos segundos antes de enviar otro mensaje.'},429);
   await save(env,services,{id,userId:user.id,agent:data.agent,role:'user',text:data.text.trim(),status:'queued'});
  }
  if(!existing||existing.status==='queued')await env.MELODI_JOBS.send({type:'vetsa_app_message',id,userId:user.id});
  return json({id,status:existing?.status||'queued'},202);
 }
 return json({error:'Ruta no disponible.'},404);
}
export async function consumeAppAgentLink(env,phone,incoming){
 const match=/^(?:Brivany vincular|Vetsa vincular app) ([A-Z2-9]{16})$/i.exec(incoming.trim());if(!match)return null;
 if(!/^\d{8,15}$/.test(phone))return 'No pude verificar tu número de WhatsApp.';
 await ensureTenantSchema(env);
 const row=await query(env,'SELECT user_id FROM vetsa_app_agent_codes WHERE code_hash=? AND expires_at>?',await hash(match[1].toUpperCase()),Date.now()).first();
 if(!row)return 'El enlace de Vetsa caducó o ya se utilizó. Solicita uno nuevo desde la app.';
 const assigned=await query(env,'SELECT user_id FROM brivany_whatsapp_identities WHERE phone=?',phone).first();
 if(assigned&&assigned.user_id!==row.user_id)return 'Este número corresponde a otra cuenta. Contacta con soporte para cambiar su titular sin compartir los datos anteriores.';
 const current=await query(env,'SELECT user_id FROM vetsa_app_agent_links WHERE phone=?',phone).first();
 if(current&&current.user_id!==row.user_id)return 'Este WhatsApp ya está vinculado a otra cuenta Vetsa.';
 const at=Date.now(),codeHash=await hash(match[1].toUpperCase());
 const result=await env.VETSA_CLOUD.batch([
  query(env,`INSERT INTO brivany_whatsapp_identities(phone,user_id,created_at) SELECT ?,user_id,? FROM vetsa_app_agent_codes WHERE code_hash=? AND expires_at>?
    ON CONFLICT(phone) DO NOTHING`,phone,at,codeHash,at),
  query(env,`UPDATE vetsa_app_agent_links SET phone=?,linked_at=? WHERE user_id=(SELECT user_id FROM vetsa_app_agent_codes WHERE code_hash=? AND expires_at>?)
    AND EXISTS(SELECT 1 FROM brivany_whatsapp_identities i WHERE i.phone=? AND i.user_id=vetsa_app_agent_links.user_id)
    AND NOT EXISTS(SELECT 1 FROM vetsa_app_agent_links other WHERE other.phone=? AND other.user_id<>vetsa_app_agent_links.user_id) RETURNING user_id`,phone,at,codeHash,at,phone,phone),
  query(env,`DELETE FROM vetsa_app_agent_codes WHERE code_hash=? AND user_id IN (SELECT user_id FROM vetsa_app_agent_links WHERE phone=? AND linked_at=?)`,codeHash,phone,at),
 ]);
 if(!result[1]?.results?.length)return 'El enlace caducó, ya se utilizó o pertenece a otra cuenta. Solicita uno nuevo desde Brivany.';
 return 'WhatsApp vinculado a Brivany. Soy Melodi; ya puedes escribirme aquí con tu cuenta conectada.';
}
export async function handleBrivanyWhatsApp(request,env,services){
 const url=new URL(request.url);
 if(url.pathname.startsWith('/api/brivany/whatsapp/desktop/'))return handleDesktopRoute(request,env,services,{userFromRequest});
 if(url.pathname==='/api/brivany/whatsapp/number'&&request.method==='GET'){
  const number=String(env.ASSISTANT_WHATSAPP_NUMBER||'').replace(/\D/g,'');
  return /^\d{8,15}$/.test(number)?json({number,name:'Melodi',url:'https://wa.me/'+number}):json({error:'Número no disponible.'},503);
 }
 url.pathname=url.pathname.replace(/^\/api\/brivany\/whatsapp/,'/agents').replace(/\/status$/,'');
 return appAgentRoute(new Request(url,request),{...env,MELODI_APP_CLIENT:'brivany-desktop'},services);
}
export async function captureAppAgentReply(env,phone,text,options,services){
 const context=env.VETSA_APP_CHAT;if(!context||phone!==ownerPhone(env))throw Error('app_reply_scope');
 const id=context.id+':reply:'+await hash(String(text));
 await save(env,services,{id,userId:context.userId,agent:context.agent,role:'assistant',text});
 return {status:'sent',messageId:id};
}
export async function mirrorAppAgentReply(env,phone,text,options,messageId,services){
 if(phone!==ownerPhone(env))return;
 const link=await query(env,'SELECT user_id FROM vetsa_app_agent_links WHERE phone=?',phone).first();if(!link)return;
 const agent=agents.some(a=>a.id===options.agent)?options.agent:'melodi';
 await save(env,services,{id:'wa:'+messageId,userId:link.user_id,agent,role:'assistant',text});
}
export async function runAppAgentMessage(env,job,services,run){
 const row=await query(env,'SELECT * FROM brivany_whatsapp_messages WHERE id=? AND user_id=? AND role=?',job.id,job.userId,'user').first();if(!row||row.status==='done')return;
 const link=await query(env,'SELECT phone FROM vetsa_app_agent_links WHERE user_id=?',job.userId).first();if(!link?.phone)throw Error('app_link_no_longer_valid');
 const tenant=await linkedTenant(env,link.phone,services);if(!tenant||tenant.userId!==job.userId)throw Error('app_link_no_longer_valid');
 env=tenantEnvironment(env,tenant);
 const raw=await services.decrypt(row.encrypted,row.iv),message=typeof raw==='string'?JSON.parse(raw):raw;
 if(message.userId!==job.userId||message.agent!==row.agent||message.role!=='user')throw Error('app_message_integrity');
 const scoped={...env,VETSA_APP_CHAT:{id:job.id,userId:job.userId,agent:row.agent}};
 const payload={object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:env.WHATSAPP_PHONE_NUMBER_ID},messages:[{id:'vetsa-app:'+await hash(job.id),from:link.phone,type:'text',timestamp:String(Math.floor(Date.now()/1000)),text:{body:(row.agent==='melodi'?'':row.agent+': ')+message.text}}]}}]}]};
 const result=await run(scoped,payload);
 if(result?.status==='uncertain')await captureAppAgentReply(scoped,link.phone,'No pude confirmar el resultado de esa acción. No la repetiré automáticamente.',{},services);
 await query(env,"UPDATE brivany_whatsapp_messages SET status='done' WHERE id=? AND user_id=?",job.id,job.userId).run();
}
export function createAppAgentEntrypoint(Base,servicesFactory){
 return class extends Base { fetch(request){return appAgentRoute(request,this.env,servicesFactory(this.env));} };
}
