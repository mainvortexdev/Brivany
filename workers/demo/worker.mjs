import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import {MAX_BUDGET,MAX_AUDIO_SECONDS,VOICES,metaPlan,voiceFrame,asrPlan} from './policy.mjs';
import {setupPage} from './admin.mjs';
import {generateMetaImage} from './meta-image.mjs';
import {releaseAdmin,releaseDownload} from './downloads.mjs';
export {DemoPhone} from './phone.mjs';

const enc=new TextEncoder();
const origins={meta:'https://api.meta.ai',cartesia:'https://api.cartesia.ai',deepgram:'https://api.deepgram.com'};
const answer=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const phoneMessages={telnyx_key_invalid:'Revisa tu clave API de Telnyx.',telnyx_key_rejected:'Telnyx rechazó tu clave API.',telnyx_permission_required:'Tu clave de Telnyx necesita permisos para llamadas y configuración de voz.',telnyx_number_invalid:'Escribe el número emisor en formato internacional, por ejemplo +34…',telnyx_number_unverified:'El número emisor debe estar activo o verificado en tu cuenta de Telnyx.',telnyx_country_unavailable:'Ese país todavía no está habilitado en esta demostración.',telnyx_destination_country:'Para esta prueba utiliza un destino del mismo país que el número emisor.',telnyx_not_connected:'Conecta tu API de Telnyx y tu número emisor.',telnyx_setup_failed:'Telnyx no pudo preparar la conexión. Revisa los permisos y el saldo de tu cuenta.',telnyx_setup_unconfirmed:'Telnyx no confirmó la configuración. No se ha realizado ninguna llamada.',call_active:'Termina la llamada antes de cambiar la conexión.'};
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const un64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
async function bodyText(request,max=16384){
 if(!request.body)return '';const reader=request.body.getReader(),decoder=new TextDecoder();let size=0,out='';
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('request_limit');}out+=decoder.decode(value,{stream:true});}}finally{reader.releaseLock();}
 return out+decoder.decode();
}
async function binaryBody(request,max){
 const reader=request.body?.getReader();if(!reader)throw Error('request_limit');let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('request_limit');}chunks.push(value);}}finally{reader.releaseLock();}
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}
function bearer(request){return (request.headers.get('Authorization')||request.headers.get('X-API-Key')||'').replace(/^(?:Bearer|Token) /,'');}
async function seal(env,value){
 const key=await crypto.subtle.importKey('raw',un64(env.DEMO_DATA_KEY),'AES-GCM',false,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));
 return {iv:b64(iv),data:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(value))))};
}
async function open(env,value){const key=await crypto.subtle.importKey('raw',un64(env.DEMO_DATA_KEY),'AES-GCM',false,['decrypt']);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(value.iv)},key,un64(value.data))));}

export class DemoAccount extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);this.live=new Set();
  ctx.blockConcurrencyWhile(async()=>{
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS demo_budget(id INTEGER PRIMARY KEY CHECK(id=1),limit_micro INTEGER NOT NULL,spent_micro INTEGER NOT NULL DEFAULT 0,revoked INTEGER NOT NULL DEFAULT 1)');
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS demo_sessions(device TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,created INTEGER NOT NULL)');
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS demo_reservations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,micros INTEGER NOT NULL,created INTEGER NOT NULL)');
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS demo_call_leases(id TEXT PRIMARY KEY,device TEXT NOT NULL,expires INTEGER NOT NULL)');
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS demo_members(user_id TEXT PRIMARY KEY,device TEXT UNIQUE NOT NULL,created INTEGER NOT NULL)');
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS demo_member_phones(user_id TEXT PRIMARY KEY,phone TEXT NOT NULL)');
   ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS demo_voices(id TEXT PRIMARY KEY,device TEXT NOT NULL,created INTEGER NOT NULL)');
  });
 }
 row(sql,...args){return this.ctx.storage.sql.exec(sql,...args).toArray()[0];}
 async config(){const value=await this.ctx.storage.get('account');if(!value)throw Error('demo_not_configured');return value;}
 async active(){const cfg=await this.config(),budget=this.row('SELECT * FROM demo_budget WHERE id=1');if(!budget||budget.revoked||cfg.expiresAt<=Date.now())throw Error('demo_unavailable');return cfg;}
 async authorize(request){const token=bearer(request);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('authentication_required');const row=this.row('SELECT device FROM demo_sessions WHERE token_hash=?',await hash(token));if(!row)throw Error('authentication_required');await this.active();return row;}
 reserve(micros,kind){
  if(!Number.isSafeInteger(micros)||micros<1||micros>MAX_BUDGET)throw Error('reservation_invalid');
  const result=this.row('UPDATE demo_budget SET spent_micro=spent_micro+? WHERE id=1 AND revoked=0 AND spent_micro+?<=limit_micro RETURNING spent_micro,limit_micro',micros,micros);
  if(!result)throw Error('demo_budget_exhausted');
  this.ctx.storage.sql.exec('INSERT INTO demo_reservations VALUES(?,?,?,?)',crypto.randomUUID(),kind,micros,Date.now());return result;
 }
 async status(){const cfg=await this.config(),b=this.row('SELECT * FROM demo_budget WHERE id=1');return {account:{id:'jon-demo',name:cfg.name,demo:true},enabled:!!b&&!b.revoked&&cfg.expiresAt>Date.now(),budget_usd:(b?.limit_micro||0)/1e6,reserved_usd:(b?.spent_micro||0)/1e6,remaining_usd:Math.max(0,(b?.limit_micro||0)-(b?.spent_micro||0))/1e6,expires_at:cfg.expiresAt,voice_session_seconds:MAX_AUDIO_SECONDS,providers:await this.providerStatus()};}
 async providerStatus(){const value={};for(const name of Object.keys(origins))value[name]=!!await this.ctx.storage.get('credential:'+name);return value;}
 async credential(name){const value=await this.ctx.storage.get('credential:'+name);if(!value)throw Error('provider_unavailable');return open(this.env,value);}
 knownDevice(device){return !!this.row('SELECT device FROM demo_sessions WHERE device=?',device);}
 voices(device){return new Set([...VOICES,...this.ctx.storage.sql.exec('SELECT id FROM demo_voices WHERE device=?',device||'').toArray().map(v=>v.id)]);}
 async cleanupVoices(){
  let failed=false;
  for(const row of this.ctx.storage.sql.exec('SELECT id FROM demo_voices').toArray()){
   try{const response=await fetch(origins.cartesia+'/voices/'+row.id,{method:'DELETE',headers:{Authorization:'Bearer '+await this.credential('cartesia'),'Cartesia-Version':'2026-08-14'},redirect:'manual',signal:AbortSignal.timeout(10000)});await response.body?.cancel();if(response.ok||response.status===404)this.ctx.storage.sql.exec('DELETE FROM demo_voices WHERE id=?',row.id);else failed=true;}catch{failed=true;}
  }
  if(failed)await this.ctx.storage.setAlarm(Date.now()+3600000);
 }
 async alarm(){const cfg=await this.config();if(cfg.expiresAt<=Date.now()||this.row('SELECT revoked FROM demo_budget WHERE id=1')?.revoked)await this.cleanupVoices();else await this.ctx.storage.setAlarm(cfg.expiresAt);}
 member(userId){return typeof userId==='string'&&!!this.row('SELECT user_id FROM demo_members WHERE user_id=?',userId);}
 async enroll(userId,token,phone){
  if(typeof userId!=='string'||!userId||userId.length>200)throw Error('account_identity_required');
  if(typeof phone!=='string'||!/^\d{8,15}$/.test(phone))throw Error('account_phone_required');
  const session=await this.authorize(new Request('https://demo.internal/v1/account',{headers:{Authorization:'Bearer '+token}}));
  const occupied=this.row('SELECT user_id FROM demo_members WHERE device=?',session.device);
  if(occupied&&occupied.user_id!==userId)throw Error('device_account_conflict');
  this.ctx.storage.sql.exec('INSERT INTO demo_members VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING',userId,session.device,Date.now());
  this.ctx.storage.sql.exec('INSERT INTO demo_member_phones VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone',userId,phone);
  return {linked:true,account:'jon-demo'};
 }
 async callService(userId,action,value){
  const member=this.row('SELECT device FROM demo_members WHERE user_id=?',userId),owner=this.row('SELECT phone FROM demo_member_phones WHERE user_id=?',userId);
  if(!member||!owner)throw Error('account_phone_required');await this.active();const phone=this.phone(member.device);
  if(action==='info')return phone.info();
  if(action==='schedule'){
   if(value?.phone!==owner.phone)throw Error('call_scope');const budget=this.row('SELECT * FROM demo_budget WHERE id=1');if(budget.limit_micro-budget.spent_micro<500000)throw Error('demo_budget_exhausted');
   return phone.schedule(value);
  }
  if(value?.phone!==owner.phone)throw Error('call_scope');
  if(action==='list')return phone.listOwn();
  if(action==='cancel')return phone.cancelOwn(value.id);
  if(action==='reserveNotices')return phone.reserveOwnNotices(owner.phone);
  if(action==='recordNotice')return phone.recordOwnNotice(owner.phone,value.id,value.accepted);
  throw Error('route_unavailable');
 }
 async generate(userId,body){
  if(!this.member(userId))return null;
  await this.active();
  if(!body||typeof body.contents!=='string'||body.contents.length>150000)throw Error('demo_input_limit');
  const options=body.options||{};
  const fetcher=(url,init)=>this.proxyHttp(new Request(url,init),'meta',new URL(url).pathname,new URL(url));
  if(body.model==='spaik-image'||body.model==='spaik-vision-flash'&&options.mode){
   const normalized={...options,...(['remix','recreate'].includes(options.mode)?{mode:'edit'}:{})};
   return generateMetaImage({META_API_KEY:'server-only-demo-route'},body.contents,normalized,fetcher);
  }
  if(options.image||options.audio||options.audioBase64||options.imageUrl||options.output)throw Error('demo_media_requires_desktop');
  const result=await fetcher('https://api.meta.ai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'muse-spark-1.3',messages:[...(options.systemPrompt?[{role:'system',content:String(options.systemPrompt)}]:[]),{role:'user',content:body.contents}],temperature:options.temperature??.3,max_completion_tokens:options.max_tokens||options.maxTokens||1100,reasoning_effort:'minimal',...(options.jsonMode?{response_format:{type:'json_object'}}:{})})});
  if(!result.ok)throw Error('demo_provider_unavailable');
  const value=JSON.parse(await bodyText(result,1_000_000)),choice=value.choices?.[0],text=choice?.message?.content;
  if(choice?.finish_reason==='length'||typeof text!=='string'||!text.trim())throw Error('demo_response_incomplete');
  return {text,response:text,provider:'Meta',providerModel:'muse-spark-1.3',modelUsed:body.model,usage:value.usage};
 }
 phone(device){if(!this.env.DEMO_PHONES)throw Error('telnyx_unavailable');return this.env.DEMO_PHONES.get(this.env.DEMO_PHONES.idFromName(device));}
 async callAccess(device,id){
  await this.active();if(!this.knownDevice(device)||!/^[-a-f0-9]{36}$/.test(id))throw Error('call_scope');
  let lease=this.row('SELECT device,expires FROM demo_call_leases WHERE id=?',id);
  if(!lease){const budget=this.row('SELECT * FROM demo_budget WHERE id=1');if(budget.limit_micro-budget.spent_micro<500000)throw Error('demo_budget_exhausted');this.reserve(200000,'telephone-asr');this.ctx.storage.sql.exec('INSERT INTO demo_call_leases VALUES(?,?,?)',id,device,Date.now()+150000);lease=this.row('SELECT device,expires FROM demo_call_leases WHERE id=?',id);}
  if(lease.device!==device||lease.expires<Date.now())throw Error('call_scope');
  return {BRIVANY_META_API_KEY:await this.credential('meta'),BRIVANY_MUSE_API_KEY:await this.credential('meta'),BRIVANY_META_MODEL:'muse-spark-1.3',BRIVANY_CARTESIA_API_KEY:await this.credential('cartesia')};
 }
 async phonePlan(device,id,provider,path,body){
  await this.active();const lease=this.row('SELECT device,expires FROM demo_call_leases WHERE id=?',id);if(!lease||lease.device!==device||lease.expires<Date.now())throw Error('call_scope');
  if(provider==='meta'&&path==='/v1/asr/realtime')return {};
  let plan;if(provider==='meta'&&path==='/v1/chat/completions')plan=metaPlan(path,body);else if(provider==='cartesia'&&path==='/tts/bytes')plan={...voiceFrame(body),kind:'telephone-speech'};else throw Error('provider_path');
  this.reserve(plan.cost,'telephone-'+plan.kind);return {body:plan.body};
 }
 async configure(value){
  const previous=await this.ctx.storage.get('account');if(previous)throw Error('account_already_configured');
  if(typeof value.invitation!=='string'||value.invitation.length<32||value.invitation.length>128||typeof value.name!=='string'||value.name.length>80||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+31*86400000)throw Error('invalid_configuration');
  const limit=value.budgetMicros??MAX_BUDGET;if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_BUDGET)throw Error('budget_limit');
  await this.ctx.storage.put('account',{name:value.name,inviteHash:await hash(value.invitation),expiresAt:value.expiresAt,maxDevices:8,setupExpiresAt:Date.now()+900000});
  this.ctx.storage.sql.exec('INSERT INTO demo_budget(id,limit_micro,spent_micro,revoked) VALUES(1,?,0,1)',limit);return this.status();
 }
 async providers(value){
  await this.config();for(const name of Object.keys(origins))if(value[name]!==undefined){if(typeof value[name]!=='string'||value[name].length<20||value[name].length>4096||!/^[\x21-\x7e]+$/.test(value[name]))throw Error('invalid_credential');await this.ctx.storage.put('credential:'+name,await seal(this.env,value[name]));}
  return this.providerStatus();
 }
 async activate(value){
  const cfg=await this.active();if(typeof value.invitation!=='string'||value.invitation.length>128||!equal(await hash(value.invitation),cfg.inviteHash)||typeof value.deviceId!=='string'||!/^[-a-f0-9]{36}$/.test(value.deviceId))throw Error('activation_rejected');
  const exists=this.row('SELECT device FROM demo_sessions WHERE device=?',value.deviceId);if(!exists&&this.row('SELECT COUNT(*) AS n FROM demo_sessions').n>=cfg.maxDevices)throw Error('device_limit');
  const token=random(),tokenHash=await hash(token);
  const inserted=this.row('INSERT INTO demo_sessions SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM demo_sessions WHERE device=?) OR (SELECT COUNT(*) FROM demo_sessions)<? ON CONFLICT(device) DO UPDATE SET token_hash=excluded.token_hash,created=excluded.created RETURNING device',value.deviceId,tokenHash,Date.now(),value.deviceId,cfg.maxDevices);
  if(!inserted)throw Error('device_limit');
  return {token,...await this.status()};
 }
 async proxyHttp(request,provider,path,url,device){
  if(provider==='cartesia'&&path==='/voices/clone'&&request.method==='POST'){
   if(!this.knownDevice(device))throw Error('authentication_required');
   if(this.row('SELECT COUNT(*) AS n FROM demo_voices').n>=4)throw Error('voice_limit');
   const raw=await binaryBody(request,2_900_000),form=await new Response(raw,{headers:{'Content-Type':request.headers.get('Content-Type')||''}}).formData(),language=form.get('language'),clip=form.get('clip');
   if(!['es','en','fr'].includes(language)||form.get('access')!=='private'||typeof form.get('name')!=='string'||[...form.keys()].some(k=>!['clip','name','access','language'].includes(k))||form.getAll('clip').length!==1||typeof clip?.arrayBuffer!=='function')throw Error('audio_format');
   const pcm=await clip.arrayBuffer(),wav=new DataView(pcm),tag=(at,n)=>new TextDecoder().decode(pcm.slice(at,at+n));
   if(pcm.byteLength<480044||pcm.byteLength>2880044||tag(0,4)!=='RIFF'||tag(8,4)!=='WAVE'||tag(12,4)!=='fmt '||wav.getUint32(16,true)!==16||wav.getUint16(20,true)!==1||wav.getUint16(22,true)!==1||wav.getUint32(24,true)!==24000||wav.getUint16(34,true)!==16||tag(36,4)!=='data'||wav.getUint32(40,true)!==pcm.byteLength-44||(pcm.byteLength-44)%2)throw Error('audio_format');
   const output=new FormData();output.set('name','Brivany demo '+crypto.randomUUID().slice(0,8));output.set('language',language);output.set('access','private');output.set('clip',new Blob([pcm],{type:'audio/wav'}),'voice.wav');
   await this.active();this.reserve(250000,'authorized-voice-clone');
   const response=await fetch(origins.cartesia+path,{method:'POST',headers:{Authorization:'Bearer '+await this.credential('cartesia'),'Cartesia-Version':'2026-08-14'},body:output,redirect:'manual',signal:AbortSignal.timeout(20000)});
   if(!response.ok){await response.body?.cancel();throw Error('provider_unavailable');}
   const value=JSON.parse(await bodyText(response,65536));if(!/^[a-f0-9-]{36}$/.test(value.id)||value.access!=='private'||value.language!==language)throw Error('voice_response');
   this.ctx.storage.sql.exec('INSERT INTO demo_voices VALUES(?,?,?)',value.id,device,Date.now());await this.ctx.storage.setAlarm((await this.config()).expiresAt);return answer({id:value.id,access:'private',language});
  }
  const ownedVoice=provider==='cartesia'&&path.match(/^\/voices\/([a-f0-9-]{36})$/);
  if(ownedVoice&&request.method==='DELETE'){
   if(!this.row('SELECT id FROM demo_voices WHERE id=? AND device=?',ownedVoice[1],device))return answer({error:'voice_unavailable'},404);
   const response=await fetch(origins.cartesia+path,{method:'DELETE',headers:{Authorization:'Bearer '+await this.credential('cartesia'),'Cartesia-Version':'2026-08-14'},redirect:'manual',signal:AbortSignal.timeout(10000)});await response.body?.cancel();if(!response.ok&&response.status!==404)throw Error('provider_unavailable');this.ctx.storage.sql.exec('DELETE FROM demo_voices WHERE id=?',ownedVoice[1]);return answer({deleted:true});
  }
  if(provider==='meta'&&path==='/v1/asr/transcribe'&&request.method==='POST'){
   const raw=await binaryBody(request,500000),form=await new Response(raw,{headers:{'Content-Type':request.headers.get('Content-Type')||''}}).formData();
   if([...form.keys()].some(name=>!['request','audio'].includes(name))||form.getAll('audio').length!==1||form.getAll('request').length!==1)throw Error('audio_format');
   const audio=form.get('audio');if(!audio||typeof audio.arrayBuffer!=='function')throw Error('audio_format');
   const bytes=await audio.arrayBuffer(),view=new DataView(bytes),tag=(at,n)=>new TextDecoder().decode(bytes.slice(at,at+n));
   if(bytes.byteLength<44||bytes.byteLength>384044||tag(0,4)!=='RIFF'||tag(8,4)!=='WAVE'||tag(12,4)!=='fmt '||view.getUint32(16,true)!==16||view.getUint16(20,true)!==1||view.getUint16(22,true)!==1||view.getUint32(24,true)!==24000||view.getUint16(34,true)!==16||tag(36,4)!=='data'||view.getUint32(40,true)!==bytes.byteLength-44||(bytes.byteLength-44)%2)throw Error('audio_format');
   const output=new FormData();output.set('request',JSON.stringify({model:'muse-voice-transcribe-1.0',audioEncoding:'WAV',mode:'DIARIZATION',languageBias:['Spanish','English','French'],keywords:['Brivany','Melodi']}));output.set('audio',new Blob([bytes],{type:'audio/wav'}),'prefix.wav');
   const key=await this.credential('meta');await this.active();this.reserve(100000,'video-prefix-recognition');
   const response=await fetch(origins.meta+path,{method:'POST',headers:{Authorization:'Bearer '+key},body:output,redirect:'manual',signal:AbortSignal.timeout(15000)});
   if(!response.ok){await response.body?.cancel();throw Error('provider_unavailable');}
   return new Response(response.body,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  if(request.method!=='POST')return answer({error:'method_not_allowed'},405);
  let value=JSON.parse(await bodyText(request,2_000_000)),plan;
  if(provider==='meta')plan=metaPlan(path,value);
  else if(provider==='cartesia'&&path==='/tts/bytes')plan={...voiceFrame(value,this.voices(device)),kind:'speech'};
  else throw Error('provider_path');
  const key=await this.credential(provider);await this.active();this.reserve(plan.cost,plan.kind);
  const headers={'Content-Type':'application/json',...(provider==='cartesia'?{'X-API-Key':key,'Cartesia-Version':'2026-08-14'}:{Authorization:'Bearer '+key})};
  const response=await fetch(origins[provider]+path,{method:'POST',headers,body:JSON.stringify(plan.body),redirect:'manual',signal:AbortSignal.timeout(provider==='meta'?150000:60000)});
  if(!response.ok){await response.body?.cancel();return answer({error:'provider_rejected',message:'El proveedor no pudo completar esta operación de demostración.'},502);}
  return new Response(response.body,{headers:{'Content-Type':response.headers.get('Content-Type')||'application/json','Cache-Control':'no-store'}});
 }
 async proxySocket(request,provider,path,url,device){
  if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')throw Error('websocket_required');
  const tts=provider==='cartesia'&&path==='/tts/websocket',asr=tts?null:asrPlan(provider,path,url.searchParams);
  const key=await this.credential(provider);await this.active();if(asr)this.reserve(asr.cost,'speech-recognition');
  const headers={Upgrade:'websocket'};if(provider==='cartesia')headers['X-API-Key']=key;if(provider==='deepgram')headers.Authorization='Token '+key;
  const target=new URL(origins[provider]+path);target.search=url.search;
  if(tts){target.search='';target.searchParams.set('cartesia_version','2026-08-14');}
  const upstream=await fetch(target,{headers,redirect:'manual',signal:AbortSignal.timeout(7000)});
  if(upstream.status!==101||!upstream.webSocket){await upstream.body?.cancel();throw Error('provider_unavailable');}
  const pair=new WebSocketPair(),client=pair[0],socket=pair[1],remote=upstream.webSocket;let closed=false,received=0,frames=0,chain=Promise.resolve(),first=true;
  // Current Workers deliver binary events as Blob unless explicitly selected.
  // PCM must stay binary: send(Blob) would become the text "[object Blob]".
  socket.binaryType='arraybuffer';remote.binaryType='arraybuffer';
  const finish=()=>{if(closed)return;closed=true;clearTimeout(timer);this.live.delete(finish);try{socket.close(1000,'Fin de sesión de demostración');}catch{}try{remote.close(1000,'Session ended');}catch{}};
  const timer=setTimeout(finish,MAX_AUDIO_SECONDS*1000);this.live.add(finish);
  socket.addEventListener('message',event=>{
   if(closed)return;frames++;if(frames>20000){finish();return;}
   const data=event.data;received+=typeof data==='string'?enc.encode(data).length:data.byteLength;
   if((typeof data==='string'?enc.encode(data).length:data.byteLength)>262144||received>48000*MAX_AUDIO_SECONDS+65536||remote.bufferedAmount>262144){finish();return;}
   chain=chain.then(async()=>{
    if(closed)return;await this.active();let output=data;
    if(tts){if(typeof data!=='string')throw Error('speech_frame');const value=JSON.parse(data);if(value.cancel===true&&typeof value.context_id==='string'&&value.context_id.length<=128){output=JSON.stringify({cancel:true,context_id:value.context_id});}else{const plan=voiceFrame(value,this.voices(device));this.reserve(plan.cost,'speech');output=JSON.stringify(plan.body);}}
    else if(provider==='meta'&&first){if(typeof data!=='string')throw Error('audio_handshake');const value=JSON.parse(data);if(value.audioEncoding!=='PCM_24KHZ')throw Error('audio_format');value.authorization={accessToken:'Bearer '+key};value.model='muse-voice-transcribe-1.0';output=JSON.stringify(value);}
    else if(!tts&&typeof data==='string'){
     const value=JSON.parse(data);
     if(provider==='meta'&&value.type!=='endStream'||provider==='deepgram'&&!['KeepAlive','CloseStream','Finalize'].includes(value.type)||provider==='cartesia'&&value.type!=='close')throw Error('audio_control');
    }
    first=false;remote.send(output);
   }).catch(()=>finish());this.ctx.waitUntil(chain);
  });
  remote.addEventListener('message',event=>{if(!closed){if(socket.bufferedAmount>1048576){finish();return;}try{socket.send(event.data);}catch{finish();}}});
  for(const ws of [socket,remote]){ws.addEventListener('close',finish);ws.addEventListener('error',finish);ws.accept();}
  return new Response(null,{status:101,webSocket:client});
 }
 async fetch(request){
  try{
   const url=new URL(request.url),path=url.pathname;
   if(path==='/download')return await releaseDownload(this,request,url);
   if(path.startsWith('/admin/')){
    if(path==='/admin/providers'&&request.method==='POST'&&this.env.DEMO_SETUP_TOKEN&&equal(bearer(request),this.env.DEMO_SETUP_TOKEN)){
     return await this.ctx.blockConcurrencyWhile(async()=>{
      if(await this.ctx.storage.get('setup_used'))return answer({error:'setup_already_used'},403);
      const cfg=await this.config();if(!cfg.setupExpiresAt||cfg.setupExpiresAt<=Date.now())return answer({error:'setup_expired'},403);
      const value=JSON.parse(await bodyText(request));if(!Object.keys(origins).every(name=>typeof value[name]==='string'&&value[name].length>=20&&value[name].length<=4096&&/^[\x21-\x7e]+$/.test(value[name])))throw Error('invalid_credential');
      const result=await this.providers(value);await this.ctx.storage.put('setup_used',true);return answer(result);
     });
    }
    if(!this.env.DEMO_ADMIN_TOKEN||!equal(bearer(request),this.env.DEMO_ADMIN_TOKEN))return answer({error:'authentication_required'},401);
    if(request.method==='GET'&&path==='/admin/status')return answer(await this.status());
    if(request.method!=='POST')return answer({error:'method_not_allowed'},405);
    if(path.startsWith('/admin/release/'))return await releaseAdmin(this,request,url);
    if(path==='/admin/configure')return answer(await this.configure(JSON.parse(await bodyText(request))));
    if(path==='/admin/providers')return answer(await this.providers(JSON.parse(await bodyText(request))));
    if(path==='/admin/setup-window'){
     if(await this.ctx.storage.get('setup_used'))return answer({error:'setup_already_used'},403);
     const cfg=await this.config();await this.ctx.storage.put('account',{...cfg,setupExpiresAt:Date.now()+900000});return answer({expires_in_seconds:900});
    }
    if(path==='/admin/enable'){
     const state=await this.providerStatus();if(!Object.values(state).every(Boolean))throw Error('providers_incomplete');const cfg=await this.config();if(cfg.expiresAt<=Date.now())throw Error('demo_unavailable');
     this.ctx.storage.sql.exec('UPDATE demo_budget SET revoked=0 WHERE id=1');return answer(await this.status());
    }
    if(path==='/admin/revoke'){
     this.ctx.storage.sql.exec('UPDATE demo_budget SET revoked=1 WHERE id=1');for(const stop of this.live)stop();
     if(this.env.DEMO_PHONES)await Promise.allSettled(this.ctx.storage.sql.exec('SELECT device FROM demo_sessions').toArray().map(s=>this.phone(s.device).stopOwn()));
     await this.cleanupVoices();
     return answer(await this.status());
    }
    throw Error('route_unavailable');
   }
   if(path==='/v1/activate'&&request.method==='POST')return answer(await this.activate(JSON.parse(await bodyText(request))));
   const session=await this.authorize(request);
   if(path==='/v1/account'&&request.method==='GET')return answer(await this.status());
   if(path==='/v1/telnyx/status'&&request.method==='GET')return answer(await this.phone(session.device).info());
   if(path==='/v1/telnyx/connect'&&request.method==='POST'){
    const value=JSON.parse(await bodyText(request));return answer(await this.phone(session.device).configurePhone({apiKey:value.api_key,fromNumber:value.from_number,deviceId:session.device}));
   }
   if(path==='/v1/calls'&&request.method==='GET')return answer({calls:await this.phone(session.device).listOwn()});
   if(path==='/v1/calls'&&request.method==='POST'){
    const value=JSON.parse(await bodyText(request));if(value.confirmed!==true||typeof value.to!=='string'||!/^\+[1-9]\d{7,14}$/.test(value.to)||typeof value.objective!=='string'||!value.objective.trim()||value.objective.length>600||!Number.isSafeInteger(value.due_at??Date.now()))throw Error('call_request_invalid');
    const budget=this.row('SELECT * FROM demo_budget WHERE id=1');if(budget.limit_micro-budget.spent_micro<500000)throw Error('demo_budget_exhausted');
    const signature=await hash(JSON.stringify({id:value.id,to:value.to,objective:value.objective}));return answer(await this.phone(session.device).schedule({id:value.id,requestHash:signature,phone:value.to.slice(1),objective:value.objective,dueAt:value.due_at??Date.now(),timeZone:value.time_zone||'UTC'}));
   }
   const callPath=path.match(/^\/v1\/calls\/([a-f0-9-]{36})(\/cancel)?$/);
   if(callPath){if(request.method===(callPath[2]?'POST':'GET')){const value=callPath[2]?await this.phone(session.device).cancelOwn(callPath[1]):(await this.phone(session.device).listOwn()).find(c=>c.id===callPath[1]);return answer(value||{error:'call_not_found'},value?200:404);}return answer({error:'method_not_allowed'},405);}
   const match=path.match(/^\/proxy\/(meta|cartesia|deepgram)(\/.*)$/);if(!match)throw Error('route_unavailable');
   return request.headers.get('Upgrade')?await this.proxySocket(request,match[1],match[2],url,session.device):await this.proxyHttp(request,match[1],match[2],url,session.device);
  }catch(error){const code=error?.message||'request_failed',allowed=new Set(['authentication_required','demo_unavailable','demo_not_configured','demo_budget_exhausted','activation_rejected','device_limit','provider_unavailable','providers_incomplete','account_already_configured','budget_limit','route_unavailable','provider_path','voice_unavailable','model_unavailable','request_limit','context_limit','output_limit','audio_option','audio_format','speech_limit','speech_frame','tool_limit','tool_unavailable']);return answer({error:allowed.has(code)||phoneMessages[code]?code:'request_failed',message:phoneMessages[code]||(code==='demo_budget_exhausted'?'Se ha agotado el presupuesto de esta demostración. Contacta con Daniel.':'No se pudo completar esta solicitud de demostración.')},code==='authentication_required'?401:code==='demo_budget_exhausted'?402:code==='demo_unavailable'?403:400);}
 }
}

// Only a bound first-party Worker can call this entrypoint. It has no HTTP
// admin route and never returns provider credentials to WhatsApp or the PC.
export class DemoAccess extends WorkerEntrypoint {
 account(){return this.env.DEMO_ACCOUNTS.get(this.env.DEMO_ACCOUNTS.idFromName('jon-demo-20261116'));}
 enroll(userId,token,phone){return this.account().enroll(userId,token,phone);}
 generate(userId,body){return this.account().generate(userId,body);}
 member(userId){return this.account().member(userId);}
 callService(userId,action,value){return this.account().callService(userId,action,value);}
}

export default {async fetch(request,env){
 const url=new URL(request.url);if(url.pathname==='/health'&&request.method==='GET')return answer({service:'brivany-demo',ready:true});
 if(url.pathname==='/setup'&&request.method==='GET')return setupPage();
 const phonePath=url.pathname.match(/^\/phone\/([a-f0-9-]{36})\/(?:webhooks\/telnyx-cloud|media\/telnyx-cloud\/[a-f0-9-]{36})$/);
 if(phonePath){const account=env.DEMO_ACCOUNTS.get(env.DEMO_ACCOUNTS.idFromName('jon-demo-20261116'));if(!await account.knownDevice(phonePath[1]))return new Response('Unauthorized',{status:401});return env.DEMO_PHONES.get(env.DEMO_PHONES.idFromName(phonePath[1])).fetch(request);}
 return env.DEMO_ACCOUNTS.get(env.DEMO_ACCOUNTS.idFromName('jon-demo-20261116')).fetch(request);
}};
