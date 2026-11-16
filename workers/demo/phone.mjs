// One phone object per authenticated installation. No founder Telnyx credentials.
import {MelodiPhone,callView} from '../calls/worker.js';
import {seal,unseal,verifyWebhook,boundedText,UUID,from64,bytes64} from '../calls/protocol.js';
const ORIGIN='https://demo.brivany.vetsa.es';
const e164=value=>typeof value==='string'&&/^\+[1-9][0-9]{7,14}$/.test(value);
function country(phone){if(phone.startsWith('+34'))return 'ES';if(/^\+1(?:809|829|849)/.test(phone))return 'DO';if(phone.startsWith('+1'))return 'US';const codes={'+44':'GB','+33':'FR','+49':'DE','+39':'IT','+351':'PT','+52':'MX','+57':'CO','+54':'AR','+56':'CL','+51':'PE','+591':'BO'};return Object.keys(codes).find(k=>phone.startsWith(k))?codes[Object.keys(codes).find(k=>phone.startsWith(k))]:null;}

export async function telnyxRequest(key,method,path,body,fetcher=fetch){
 if(typeof key!=='string'||!/^KEY[A-Za-z0-9_.=-]{17,253}$/.test(key))throw Error('telnyx_key_invalid');
 const response=await fetcher('https://api.telnyx.com/v2'+path,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'manual'});
 let value;try{value=JSON.parse(await boundedText(response,262144));}catch{throw Error('telnyx_invalid_response');}
 if(!response.ok){const error=Error(response.status===401?'telnyx_key_rejected':response.status===403?'telnyx_permission_required':'telnyx_setup_failed');error.status=response.status;throw error;}
 return value.data;
}

export async function provisionTelnyx({apiKey,fromNumber,deviceId},fetcher=fetch){
 if(!e164(fromNumber)||!UUID.test(deviceId))throw Error('telnyx_number_invalid');
 const region=country(fromNumber);if(!region)throw Error('telnyx_country_unavailable');
 const call=(method,path,body)=>telnyxRequest(apiKey,method,path,body,fetcher);
 const owned=await call('GET','/phone_numbers?page[size]=250');let verified=[];
 try{verified=await call('GET','/verified_numbers?page[size]=250');}catch(error){if(![403,404].includes(error.status))throw error;}
 if(![...(Array.isArray(owned)?owned:[]),...(Array.isArray(verified)?verified:[])].some(n=>n.phone_number===fromNumber&&(n.status==='active'||n.verified_at)))throw Error('telnyx_number_unverified');
 const publicKey=await call('GET','/public_key'),rawKey=publicKey?.public||publicKey?.public_key;
 let verification;
 try{const bytes=/^[a-f0-9]{64}$/i.test(rawKey)?Uint8Array.from(rawKey.match(/../g),x=>parseInt(x,16)):from64(rawKey,32);if(bytes.length!==32)throw Error();await crypto.subtle.importKey('raw',bytes,'Ed25519',false,['verify']);verification=bytes64(bytes);}catch{throw Error('telnyx_public_key');}
 const name='Brivany demo '+deviceId,profiles=await call('GET','/outbound_voice_profiles?page[size]=250');const matches=(profiles||[]).filter(p=>p.name===name);
 if(matches.length>1)throw Error('telnyx_configuration_conflict');
 const profileBody={name,traffic_type:'conversational',service_plan:'global',whitelisted_destinations:[region],concurrent_call_limit:1,daily_spend_limit:'1.00',daily_spend_limit_enabled:true,max_destination_rate:.30,enabled:true};
 const profile=await call(matches.length?'PATCH':'POST',matches.length?'/outbound_voice_profiles/'+matches[0].id:'/outbound_voice_profiles',profileBody);
 if(!profile?.id)throw Error('telnyx_setup_failed');
 const apps=await call('GET','/call_control_applications?page[size]=250'),existing=(apps||[]).filter(a=>a.application_name===name);if(existing.length>1)throw Error('telnyx_configuration_conflict');
 const webhook=ORIGIN+'/phone/'+deviceId+'/webhooks/telnyx-cloud';
 const body={application_name:name,active:true,webhook_event_url:webhook,webhook_api_version:'2',webhook_timeout_secs:10,dtmf_type:'RFC 2833',first_command_timeout:true,first_command_timeout_secs:30,call_cost_in_webhooks:true,redact_dtmf_debug_logging:true,outbound:{channel_limit:1,outbound_voice_profile_id:String(profile.id)}};
 const app=await call(existing.length?'PATCH':'POST',existing.length?'/call_control_applications/'+existing[0].id:'/call_control_applications',body);if(!app?.id)throw Error('telnyx_setup_failed');
 const confirmed=await call('GET','/call_control_applications/'+app.id);
 if(confirmed?.active!==true||confirmed.webhook_event_url!==webhook||String(confirmed.outbound?.outbound_voice_profile_id)!==String(profile.id))throw Error('telnyx_setup_unconfirmed');
 return {deviceId,apiKey,fromNumber,connectionId:String(app.id),profileId:String(profile.id),verification,region};
}

export class DemoPhone extends MelodiPhone {
 constructor(ctx,env){super(ctx,env);this.demoEnv=env;this.loaded=false;}
 parent(){return this.demoEnv.DEMO_ACCOUNTS.get(this.demoEnv.DEMO_ACCOUNTS.idFromName('jon-demo-20261116'));}
 async ready(){
  if(this.loaded)return;
  const saved=await this.ctx.storage.get('demo-phone-config');if(!saved)throw Error('telnyx_not_connected');
  this.settings=await unseal({CALLS_ENCRYPTION_KEY:this.demoEnv.DEMO_DATA_KEY},saved);
  this.env={...this.demoEnv,TELNYX_API_KEY:this.settings.apiKey,TELNYX_CONNECTION_ID:this.settings.connectionId,TELNYX_FROM_NUMBER:this.settings.fromNumber,TELNYX_PUBLIC_KEY:this.settings.verification,CALLS_ENCRYPTION_KEY:this.demoEnv.DEMO_DATA_KEY,PUBLIC_CALLS_ORIGIN:ORIGIN+'/phone/'+this.settings.deviceId,BRIVANY_META_API_KEY:'demo-account-provider',BRIVANY_META_MODEL:'muse-spark-1.3',BRIVANY_CARTESIA_API_KEY:'demo-account-provider'};this.loaded=true;
 }
 async configurePhone(value){
  if(this.row("SELECT id FROM calls WHERE state IN ('dialing','ringing','active','cancel_requested','uncertain') LIMIT 1"))throw Error('call_active');
  const config=await provisionTelnyx(value);await this.ctx.storage.put('demo-phone-config',await seal({CALLS_ENCRYPTION_KEY:this.demoEnv.DEMO_DATA_KEY},config));this.loaded=false;await this.ready();return this.info();
 }
 async info(){
  try{await this.ready();return {configured:true,outbound:true,provider:'Telnyx',transport:'cloud',from_number:this.settings.fromNumber,allowed_country:this.settings.region,maximum_seconds:90,telnyx_daily_limit_usd:1,voice_provider:'Cartesia',reason:''};}catch(error){if(error.message!=='telnyx_not_connected')throw error;return {configured:false,outbound:false,provider:'Telnyx',reason:'Conecta tu API de Telnyx y tu número emisor.'};}
 }
 async schedule(value){
  await this.ready();if(!e164('+'+value?.phone)||country('+'+value.phone)!==this.settings.region)throw Error('telnyx_destination_country');
  this.env.OWNER_WHATSAPP_NUMBER=value.phone;return super.schedule(value);
 }
 async listOwn(){await this.ready();return this.rows('SELECT calls.*,receipts.metrics FROM calls LEFT JOIN receipts ON receipts.id=calls.id ORDER BY calls.created_at DESC LIMIT 10').map(callView);}
 async cancelOwn(id){await this.ready();if(!UUID.test(id))throw Error('call_id_invalid');const row=this.row('SELECT phone FROM calls WHERE id=?',id);if(!row)return null;this.env.OWNER_WHATSAPP_NUMBER=row.phone;return super.cancel(row.phone,id);}
 async reserveOwnNotices(phone){await this.ready();this.env.OWNER_WHATSAPP_NUMBER=phone;return super.reserveNotices(phone);}
 async recordOwnNotice(phone,id,accepted){await this.ready();const row=this.row('SELECT phone FROM calls WHERE id=?',id);if(!row||row.phone!==phone)throw Error('call_scope');this.env.OWNER_WHATSAPP_NUMBER=phone;return super.recordNotice(phone,id,accepted);}
 async dial(row){
  await this.ready();
  try{const value=await this.parent().callAccess(this.settings.deviceId,row.id);Object.assign(this.env,value);this.env.OWNER_WHATSAPP_NUMBER=row.phone;return await super.dial(row);}
  catch{this.ctx.storage.sql.exec("UPDATE calls SET state='failed',reason='demo_access_unavailable',updated_at=? WHERE id=? AND state='scheduled'",Date.now(),row.id);}
 }
 async providerFetch(callId,url,options={}){
  const target=new URL(url);if(!['api.meta.ai','api.cartesia.ai'].includes(target.hostname))throw Error('provider_path');
  const body=options.body?JSON.parse(options.body):null;
  const plan=await this.parent().phonePlan(this.settings.deviceId,callId,target.hostname==='api.meta.ai'?'meta':'cartesia',target.pathname,body);
  return fetch(url,{...options,...(plan.body?{body:JSON.stringify(plan.body)}:{})});
 }
 async stopOwn(){await this.ready();for(const row of this.rows("SELECT id FROM calls WHERE state NOT IN ('completed','failed','cancelled','expired','interrupted')"))await this.cancelOwn(row.id);return {stopped:true};}
 async alarm(){await this.ready();return super.alarm();}
 async fetch(request){
  try{
   await this.ready();const url=new URL(request.url),prefix='/phone/'+this.settings.deviceId;
   if(url.pathname===prefix+'/webhooks/telnyx-cloud'&&request.method==='POST'){
    const raw=await boundedText(new Response(request.body),65536);if(!await verifyWebhook(request,raw,this.env.TELNYX_PUBLIC_KEY))return new Response('Unauthorized',{status:401});await this.webhook(JSON.parse(raw));return new Response('ok');
   }
   const match=url.pathname.match(new RegExp('^'+prefix+'/media/telnyx-cloud/([a-f0-9-]{36})$'));
   if(match&&UUID.test(match[1])&&request.headers.get('upgrade')?.toLowerCase()==='websocket')return this.media(request,match[1],url.searchParams.get('token'));
   return new Response('Not found',{status:404});
  }catch{return new Response('Unavailable',{status:503});}
 }
}
