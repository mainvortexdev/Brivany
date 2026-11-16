// Recall v1.11, EU workspace. Secrets are read only in the hosted backend.
export const WORKSPACE_ID='1501389b-6c5d-4194-bbf8-90b2abd6a895';
export const WEBHOOK_EVENTS=[
 'bot.joining_call','bot.in_waiting_room','bot.in_call_not_recording',
 'bot.recording_permission_allowed','bot.recording_permission_denied',
 'bot.in_call_recording','bot.call_ended','bot.done','bot.fatal',
 'recording.done','recording.failed','transcript.done','transcript.failed',
];
export class MeetingError extends Error {
 constructor(code,status=400,delay=0){super(code);this.code=code;this.status=status;this.retryDelaySeconds=delay;}
}
export function config(env){
 if(env.RECALL_REGION!=='eu-central-1'||env.RECALL_WORKSPACE_ID!==WORKSPACE_ID)throw new MeetingError('recall_workspace_mismatch',503);
 let base;try{base=new URL(env.PUBLIC_API_BASE_URL);}catch{throw new MeetingError('recall_not_configured',503);}
 if(base.protocol!=='https:'||base.origin!=='https://ia.vetsa.es'||base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw new MeetingError('recall_public_base_invalid',503);
 if(!env.RECALL_API_KEY||!env.RECALL_WEBHOOK_VERIFICATION_SECRET||!env.MEMORY_ENCRYPTION_KEY||!env.VETSA_CLOUD||!env.MELODI_JOBS)throw new MeetingError('recall_not_configured',503);
 return {api:'https://'+env.RECALL_REGION+'.recall.ai/api/v1',webhook:base.origin+'/webhooks/recall'};
}
export function meetingURL(value){
 if(typeof value!=='string'||value.length>2048)throw new MeetingError('meeting_url_invalid');
 let u;try{u=new URL(value.trim());}catch{throw new MeetingError('meeting_url_invalid');}
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)throw new MeetingError('meeting_url_invalid');
 const host=u.hostname.toLowerCase();
 const valid=host==='meet.google.com'?/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(u.pathname):
  (host==='zoom.us'||/^[a-z0-9-]+\.zoom\.us$/.test(host))&&/^\/(?:j|my)\/[A-Za-z0-9._-]+\/?$/.test(u.pathname);
 if(!valid)throw new MeetingError('meeting_url_invalid');
 return u.href;
}
export function joinTime(value,now=Date.now()){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw new MeetingError('join_time_invalid');
 const at=Date.parse(value);
 if(!Number.isFinite(at)||at<now+60000||at>now+90*86400000)throw new MeetingError('join_time_invalid');
 return new Date(at).toISOString();
}
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function boundedJSON(response,limit=1024*1024){
 const reader=response.body?.getReader();if(!reader)throw new MeetingError('empty_response',502);
 let size=0;const chunks=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new MeetingError('response_too_large',413);chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new MeetingError('invalid_response',502);}
}
export function retryDelay(headers,attempt=0,now=Date.now(),random=Math.random){
 const value=headers?.get('Retry-After'),seconds=Number(value),date=value?Date.parse(value):NaN;
 // Never retry earlier than Recall asks. Long delays remain in the durable outbox.
 if(value&&Number.isFinite(seconds)&&seconds>=0)return Math.max(1,Math.ceil(seconds+random()*2));
 if(Number.isFinite(date))return Math.max(1,Math.ceil((date-now)/1000+random()*2));
 return Math.ceil(Math.min(300,2**Math.min(7,attempt+1))*(1+random()*.25));
}
export function recallClient(env,{fetcher=fetch,now=Date.now}={}){
 const {api}=config(env);
 async function call(path,{method='GET',body}={}){
  if(!/^\/(?:bot|recording|transcript)(?:\/|\?)/.test(path))throw new MeetingError('recall_path_invalid');
  let response;
  try{response=await fetcher(api+path,{method,redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:env.RECALL_API_KEY,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{throw new MeetingError('recall_network',502,10);}
  if(!response.ok){const status=response.status,delay=[429,503,507].includes(status)?Math.max(status===507?30:status===503?5:1,retryDelay(response.headers,0,now())):0;await response.body?.cancel();throw new MeetingError('recall_http_'+status,status,delay);}
  return response.status===204?null:boundedJSON(response);
 }
 return {call,async download(url){
  let target;try{target=new URL(url);}catch{throw new MeetingError('artifact_url_invalid',502);}
  // A signed artifact URL is used without Recall credentials or redirects.
  if(target.protocol!=='https:'||target.username||target.password||target.port||!(/\.amazonaws\.com$/.test(target.hostname)||target.hostname.endsWith('.recall.ai')))throw new MeetingError('artifact_url_invalid',502);
  const response=await fetcher(target.href,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!response.ok){await response.body?.cancel();throw new MeetingError('artifact_download_failed',502,20);}
  return boundedJSON(response,4*1024*1024);
 }};
}
export async function verifyWebhook(request,secret,now=Date.now()){
 const id=request.headers.get('webhook-id'),timestamp=request.headers.get('webhook-timestamp'),signatures=request.headers.get('webhook-signature');
 if(!/^[A-Za-z0-9_-]{1,160}$/.test(id||'')||!/^\d{10}$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300||!signatures||signatures.length>2048||!secret?.startsWith('whsec_'))throw new MeetingError('invalid_signature',401);
 const reader=request.body?.getReader();if(!reader)throw new MeetingError('invalid_signature',401);
 const parts=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>60000)throw new MeetingError('webhook_too_large',413);parts.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const raw=new Uint8Array(size);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.length;}
 let key;try{key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['verify']);}catch{throw new MeetingError('recall_not_configured',503);}
 const prefix=new TextEncoder().encode(id+'.'+timestamp+'.'),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
 let valid=false;
 for(const value of signatures.split(' ')){if(!value.startsWith('v1,'))continue;try{valid=(await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(value.slice(3)),c=>c.charCodeAt(0)),signed))||valid;}catch{/* malformed candidate */}}
 if(!valid)throw new MeetingError('invalid_signature',401);
 let payload;try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{throw new MeetingError('invalid_webhook',400);}
 if(!payload||typeof payload.event!=='string'||typeof payload.data!=='object'||!payload.data)throw new MeetingError('invalid_webhook',400);
 return {id,payload};
}
export function transcriptSegments(data){
 if(!Array.isArray(data)||data.length>25000)throw new MeetingError('transcript_schema_invalid',502);
 return data.map(item=>{
  if(!Array.isArray(item.words)||item.words.length>10000)throw new MeetingError('transcript_schema_invalid',502);
  const text=item.words.map(w=>typeof w.text==='string'?w.text:'').join(' ').replace(/\s+/g,' ').trim();
  const start=item.words[0]?.start_timestamp?.relative;
  return {speaker:String(item.participant?.name||'Participante').slice(0,160),start:Number.isFinite(start)?start:0,text:text.slice(0,30000)};
 }).filter(row=>row.text);
}
