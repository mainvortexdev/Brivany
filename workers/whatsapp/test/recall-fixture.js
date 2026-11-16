// Synthetic Recall/Google only. Uses the real SQL store, auth route and queue processor.
import {createHmac} from 'node:crypto';
import {FinanceD1} from './finance-fixture.js';
import {appAgentSchema,handleBrivanyWhatsApp} from '../vetsa-app-agents.js';
import {meetingStore} from '../meetings/store.js';
import {createMeetingService} from '../meetings/service.js';
import {recallClient,WORKSPACE_ID} from '../meetings/recall.js';
import {createGoogleCalendarStore} from '../google-calendar-store.js';
export const BOT='10000000-0000-4000-8000-000000000001',REC='20000000-0000-4000-8000-000000000001',TRANSCRIPT='30000000-0000-4000-8000-000000000001';
export const PHONE='18095550101',OWNER='synthetic-owner',URL='https://meet.google.com/abc-defg-hij';
export async function recallFixture(){
 const db=new FinanceD1(),queue=[],calls=[],bots=[];let clock=Date.now(),failCreate=null,queueFailure=false,botSequence=0;
 const env={VETSA_CLOUD:db,MEMORY_ENCRYPTION_KEY:'synthetic-meetings-encryption-key-32-characters',RECALL_API_KEY:'synthetic-backend-recall-key',RECALL_WEBHOOK_VERIFICATION_SECRET:'whsec_'+Buffer.from('synthetic-signing-key-at-least-32-bytes').toString('base64'),RECALL_REGION:'eu-central-1',RECALL_WORKSPACE_ID:WORKSPACE_ID,PUBLIC_API_BASE_URL:'https://ia.vetsa.es',OWNER_WHATSAPP_NUMBER:PHONE,ASSISTANT_WHATSAPP_NUMBER:'18095559999',GOOGLE_CLIENT_ID:'synthetic-google',GOOGLE_CLIENT_SECRET:'synthetic-secret',MELODI_JOBS:{async send(job){if(queueFailure)throw Error('synthetic queue outage');queue.push(job);}},VETSA_IDENTITY:{async fetch(request){const token=request.headers.get('Authorization');return Response.json(token==='Bearer synthetic-user'?{authenticated:true,client:'brivany-desktop',user:{id:OWNER}}:token==='Bearer synthetic-other'?{authenticated:true,client:'brivany-desktop',user:{id:'other-owner'}}:{authenticated:false});}}};
 await db.batch(appAgentSchema.map(sql=>db.prepare(sql)));
 db.sql.prepare('INSERT INTO vetsa_app_agent_links(user_id,phone,linked_at) VALUES(?,?,?)').run(OWNER,PHONE,clock);
 db.sql.prepare('INSERT INTO vetsa_app_agent_links(user_id,phone,linked_at) VALUES(?,?,?)').run('other-owner','18095550202',clock);
 const events=new Map([['event-1',{id:'event-1',status:'confirmed',summary:'Reunión sintética',start:{dateTime:new Date(clock+3600000).toISOString()},end:{dateTime:new Date(clock+7200000).toISOString()},hangoutLink:URL}]]);
 const googleStore=createGoogleCalendarStore(env,{now:()=>clock});await googleStore.ensureSchema();await googleStore.putConnection(PHONE,{status:'connected',calendarId:'synthetic-calendar',accessToken:'synthetic-google-access',refreshToken:'synthetic-google-refresh',accessTokenExpiresAt:clock+24*3600000,scope:'https://www.googleapis.com/auth/calendar.app.created'});
 const fetcher=async(url,options={})=>{
  const target=new globalThis.URL(url);calls.push({url:target.href,...options,body:options.body?JSON.parse(options.body):undefined});
  if(target.hostname==='www.googleapis.com'){
   if(target.pathname.endsWith('/events'))return Response.json({items:[...events.values()]});
   const event=events.get(decodeURIComponent(target.pathname.split('/').at(-1)));return event?Response.json(event):new Response('',{status:404});
  }
  if(target.hostname==='synthetic.s3.eu-central-1.amazonaws.com')return Response.json([{participant:{id:1,name:'Participante sintético'},words:[{text:'Acuerdo sintético de la reunión.',start_timestamp:{relative:2.5}}]}]);
  if(target.hostname!=='eu-central-1.recall.ai')throw Error('External service blocked by fixture');
  if(new Headers(options.headers).get('Authorization')!==env.RECALL_API_KEY)throw Error('Missing backend key');
  const path=target.pathname.replace('/api/v1','');
  if(path==='/bot/'&&options.method==='POST'){
   if(failCreate&&failCreate!=='lost'){const code=failCreate;failCreate=null;return new Response('{}',{status:code,headers:{'Retry-After':'12'}});}
   const number=++botSequence;
   const payload=JSON.parse(options.body),bot={id:'10000000-0000-4000-8000-'+String(number).padStart(12,'0'),metadata:payload.metadata,join_at:payload.join_at,...payload};bots.push(bot);
   if(failCreate==='lost'){failCreate=null;throw Error('Connection lost after provider accepted create');}
   return Response.json(bot,{status:201});
  }
  if(path==='/bot/'&&options.method==='GET')return Response.json({results:bots.filter(b=>b.metadata.brivany_meeting_id===target.searchParams.get('metadata__brivany_meeting_id')),next:null});
  if(/^\/bot\/[0-9a-f-]{36}\/$/.test(path)&&options.method==='DELETE'){const index=bots.findIndex(b=>path.includes(b.id));if(index>=0)bots.splice(index,1);return new Response(null,{status:204});}
  if(/^\/bot\/[0-9a-f-]{36}\/$/.test(path)&&options.method==='PATCH'){const bot=bots.find(b=>path.includes(b.id));Object.assign(bot,JSON.parse(options.body));return Response.json(bot);}
  if(/^\/bot\/[0-9a-f-]{36}\/output_media\/$/.test(path)&&options.method==='POST')return Response.json({id:BOT,...JSON.parse(options.body)});
  if(path==='/recording/'+REC+'/create_transcript/')return Response.json({id:TRANSCRIPT,status:{code:'processing'}},{status:201});
  if(path==='/transcript/'+TRANSCRIPT+'/')return Response.json({id:TRANSCRIPT,recording:{id:REC},status:{code:'done'},data:{download_url:'https://synthetic.s3.eu-central-1.amazonaws.com/transcript?signature=synthetic'}});
  if(path==='/recording/'+REC+'/')return Response.json({id:REC,media_shortcuts:{transcript:{id:TRANSCRIPT,status:{code:'processing'}}}});
  throw Error('Unimplemented synthetic endpoint '+options.method+' '+path);
 };
 const store=meetingStore(env,{now:()=>clock});await store.ensure();
 const service=createMeetingService(env,{store,client:recallClient(env,{fetcher,now:()=>clock}),now:()=>clock,calendar:async(...args)=>{const {readMeetingCalendar}=await import('../meetings/calendar.js');return readMeetingCalendar(args[0],args[1],{...args[2],fetcher,now:clock});}});
 async function drain(){clock=Math.max(clock,Date.now());for(let n=0;queue.length&&n<80;n++){const job=queue.shift();if(job.type==='recall_meeting')await service.processMeeting(job.id);else if(job.type==='recall_webhook')await service.processWebhook(job.id);}if(queue.length)throw Error('Fixture queue did not settle');}
 function signed(event,{id='msg_'+crypto.randomUUID(),data,at=clock,signature,raw}={}){
  const payload=raw??JSON.stringify({event,data:data||{bot:{id:BOT,metadata:bots[0]?.metadata||{}},recording:{id:REC,metadata:{}},transcript:{id:TRANSCRIPT,metadata:{}},data:{code:event.split('.').at(-1),updated_at:new Date(at).toISOString()}}});
  const timestamp=String(Math.floor(at/1000)),mac=createHmac('sha256',Buffer.from(env.RECALL_WEBHOOK_VERIFICATION_SECRET.slice(6),'base64')).update(id+'.'+timestamp+'.'+payload).digest('base64');
  return new Request('https://ia.vetsa.es/webhooks/recall',{method:'POST',headers:{'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signature||'v1,'+mac},body:payload});
 }
 const services={encrypt:async value=>({encrypted:value,iv:'synthetic-only'}),decrypt:async value=>value};
 async function invoke(path,body,token='synthetic-user'){return handleBrivanyWhatsApp(new Request('https://ia.vetsa.es/api/brivany/whatsapp/meetings'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,services);}
 return {env,db,queue,calls,bots,events,store,service,drain,signed,fetcher,invoke,services,now:()=>clock,advance:ms=>clock+=ms,failCreate:value=>failCreate=value,failQueue:value=>queueFailure=value,
 input:()=>({requestId:crypto.randomUUID(),meetingUrl:URL,consent:true,title:'Reunión sintética'})};
}
export async function withFixtureFetch(f,fn){const original=globalThis.fetch;globalThis.fetch=f.fetcher;try{return await fn();}finally{globalThis.fetch=original;}}
