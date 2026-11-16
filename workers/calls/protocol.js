export const LIMITS = Object.freeze({ringSeconds:45,callSeconds:90,silenceSeconds:15,communicationSeconds:15,pending:10,turns:8});
// These are the selected Spanish Melodi voice and snapshot in
// packages/providers/cartesia_melodi.py, not a provider's default voice.
export const MELODI_VOICE = Object.freeze({provider:'Cartesia',id:'3597a26f-80ef-4bd5-8101-9699bc764917',model:'sonic-3.6-2026-08-27',version:'2026-08-14',language:'es'});
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const TERMINAL = new Set(['completed','failed','cancelled','expired','interrupted']);
export const bytes64 = bytes => btoa(String.fromCharCode(...bytes));
export function from64(value,max=65536) {
  if(typeof value!=='string'||value.length>Math.ceil(max/3)*4+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('invalid_base64');
  const raw=atob(value);if(raw.length>max)throw Error('invalid_base64');
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export const sha = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function same(a,b) {
  if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;
  let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
export function owner(env,phone) {
  const expected=String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
  if(!/^[1-9]\d{7,14}$/.test(expected)||phone!==expected)throw Error('call_owner_required');
  return expected;
}
export function configuration(env) {
  const required=['TELNYX_API_KEY','TELNYX_CONNECTION_ID','TELNYX_FROM_NUMBER','TELNYX_PUBLIC_KEY','BRIVANY_META_API_KEY','BRIVANY_META_MODEL','BRIVANY_CARTESIA_API_KEY','CALLS_ENCRYPTION_KEY'];
  const missing=required.filter(k=>!String(env[k]||'').trim());
  return {configured:!missing.length,transport:'cloud',provider:'telnyx',tts:MELODI_VOICE,limits:LIMITS,missing};
}
export async function seal(env,value) {
  const key=await crypto.subtle.importKey('raw',from64(env.CALLS_ENCRYPTION_KEY,32),'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
  return {encrypted:bytes64(new Uint8Array(bytes)),iv:bytes64(iv)};
}
export async function unseal(env,row) {
  const key=await crypto.subtle.importKey('raw',from64(env.CALLS_ENCRYPTION_KEY,32),'AES-GCM',false,['decrypt']);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(row.iv,12)},key,from64(row.encrypted,8192));
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function boundedText(response,max=65536) {
  if(!response.body)return '';
  const reader=response.body.getReader(),decoder=new TextDecoder();let size=0,text='';
  try {for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>max){await reader.cancel();throw Error('response_too_large');}text+=decoder.decode(item.value,{stream:true});}}
  finally{reader.releaseLock();}return text+decoder.decode();
}
export async function telnyx(env,path,body,{fetcher=fetch}={}) {
  if(!/^\/calls(?:\/[A-Za-z0-9_=:+%.-]{1,1500}\/actions\/(?:hangup|streaming_start))?$/.test(path))throw Error('telnyx_path_invalid');
  const response=await fetcher('https://api.telnyx.com/v2'+path,{method:'POST',headers:{Authorization:'Bearer '+env.TELNYX_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'manual'});
  const data=JSON.parse(await boundedText(response));
  if(!response.ok){const error=Error('telnyx_rejected');error.definitive=response.status>=400&&response.status<500&&response.status!==408;error.status=response.status;throw error;}
  return data.data||{};
}
export async function verifyWebhook(request,raw,key,now=Date.now()) {
  const timestamp=request.headers.get('telnyx-timestamp')||'',signature=request.headers.get('telnyx-signature-ed25519')||'';
  if(!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000)return false;
  try {
    const publicKey=await crypto.subtle.importKey('raw',from64(key,32),{name:'Ed25519'},false,['verify']);
    return await crypto.subtle.verify('Ed25519',publicKey,from64(signature,64),new TextEncoder().encode(timestamp+'|'+raw));
  }catch{return false;}
}
