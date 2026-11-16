import {MeetingError,config,meetingURL,joinTime,uuid,recallClient,verifyWebhook,WEBHOOK_EVENTS,WORKSPACE_ID,transcriptSegments,retryDelay,boundedJSON} from './recall.js';
import {meetingStore,hash} from './store.js';
import {readMeetingCalendar,eligibleEvent} from './calendar.js';
import {prepareVoice,voiceConfigured} from './voice.js';
import {requestMeetingSummary,processMeetingSummary} from './summary.js';
import {probeMeetingVoice} from './probe.js';
import {showMeetingBoard} from './board.js';
import {meetingCamera} from './brand.js';
const terminal=new Set(['ready','failed','cancelled','ended']);
const errors={meeting_url_invalid:'Pega un enlace válido de Google Meet o Zoom.',join_time_invalid:'Elige una hora futura, entre un minuto y 90 días.',recording_consent_required:'Autoriza la entrada y grabación de esta reunión.',calendar_connection_required:'Conecta Google Calendar desde Ajustes → Conexiones.',calendar_event_ineligible:'El evento debe ser futuro, tener hora y contener un enlace de Meet o Zoom.',calendar_changed:'El calendario vinculado ha cambiado. Revisa la programación.',meeting_not_found:'Esta reunión no está disponible.',meeting_limit:'Ya tienes cinco reuniones activas o has alcanzado el límite diario de veinte.',request_conflict:'Esa solicitud ya corresponde a otra reunión.',recall_not_configured:'La conexión con Recall aún no está configurada.',recall_workspace_mismatch:'La configuración de Recall no corresponde al workspace autorizado.',calendar_busy:'Calendar está actualizándose. Vuelve a intentarlo en un momento.',calendar_read_failed:'No se pudo actualizar Calendar. La programación anterior se conserva.',recall_uncertain:'Recall no confirmó la respuesta. Estoy comprobando si el bot ya existe; no crearé otro automáticamente.',transcript_uncertain:'La petición de transcripción no se confirmó. Esperaré el resultado antes de repetirla.'};
export const meetingMessage=code=>errors[code]||(/^recall_http_/.test(code||'')?'Recall no pudo completar la operación ('+code.slice(12)+').':'No se pudo completar la operación de reuniones.');
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function createMeetingService(env,{store=meetingStore(env),client=recallClient(env),calendar=readMeetingCalendar,now=Date.now}={}){
 const q=store.q;
 async function publicRow(row){const data=await store.unseal(row.owner+':intent:'+row.id,row);return {id:row.id,title:data.title,meetingUrl:data.meetingUrl,joinAt:row.join_at?new Date(row.join_at).toISOString():null,source:row.source,eventId:data.eventId||null,selected:!!row.selected,status:row.status,botStatus:row.bot_status,botId:row.bot_id,error:row.error_code?meetingMessage(row.error_code):null,errorCode:row.error_code,transcriptAvailable:row.transcript_state==='done',createdAt:row.created_at,updatedAt:row.updated_at};}
 async function enqueue(id){await env.MELODI_JOBS.send({type:'recall_meeting',id});}
 async function submit(owner,phone,input,{source='manual',event,calendarId,testDurationSeconds=0}={}){
  if(input.consent!==true)throw new MeetingError('recording_consent_required');
  if(!uuid(input.requestId))throw new MeetingError('request_id_invalid');
  const meetingUrl=meetingURL(event?.meetingUrl??input.meetingUrl),joinAt=joinTime(event?.startAt??input.joinAt,now());
  const title=String(event?.title||input.title||'Reunión con Melodi').trim().slice(0,160);
  const eventKey=event?await hash(calendarId+':'+event.googleId):null;
  const fingerprint=await hash(JSON.stringify([meetingUrl,joinAt,source,eventKey]));
  await store.ensure();
  const prior=await q('SELECT * FROM brivany_meetings WHERE owner=? AND request_key=?',owner,input.requestId).first();
  if(prior){if(prior.fingerprint!==fingerprint)throw new MeetingError('request_conflict',409);if(prior.status==='queued')await enqueue(prior.id);return publicRow(prior);}
  const existing=await q("SELECT * FROM brivany_meetings WHERE owner=? AND ((fingerprint=? AND status NOT IN ('ready','failed','cancelled','ended')) OR (source='calendar' AND event_key=? AND selected=1)) LIMIT 1",owner,fingerprint,eventKey).first();
  if(existing)return publicRow(existing);
  const id=crypto.randomUUID(),sealed=await store.seal(owner+':intent:'+id,{meetingUrl,title,eventId:event?.googleId||null,calendarId:calendarId||null,interactive:input.interactive===true,consentAt:now(),consentVersion:'explicit-event-v1'});
  try{
   const inserted=await q(`INSERT INTO brivany_meetings(id,owner,phone,request_key,fingerprint,source,event_key,join_at,status,next_at,calendar_next,state_encrypted,state_iv,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,? WHERE (SELECT count(*) FROM brivany_meetings WHERE owner=? AND status NOT IN ('ready','failed','cancelled','ended'))<5 AND (SELECT count(*) FROM brivany_meetings WHERE owner=? AND created_at>?)<20`,id,owner,phone,input.requestId,fingerprint,source,eventKey,joinAt?Date.parse(joinAt):null,now(),source==='calendar'?now()+60000:0,sealed.state_encrypted,sealed.state_iv,now(),now(),owner,owner,now()-86400000).run();
   if(!inserted.meta?.changes)throw new MeetingError('meeting_limit',429);
  }catch(error){const duplicate=await q('SELECT * FROM brivany_meetings WHERE owner=? AND (request_key=? OR (fingerprint=? AND status NOT IN (\'ready\',\'failed\',\'cancelled\',\'ended\')) OR (event_key=? AND selected=1)) LIMIT 1',owner,input.requestId,fingerprint,eventKey).first();if(duplicate)return publicRow(duplicate);throw error;}
  // Intent is durable before queueing or the first provider write. Cron recovers a failed send.
  if(testDurationSeconds)await q('INSERT OR IGNORE INTO brivany_meeting_limits VALUES(?,?)',id,now()+Math.min(90,Math.max(15,testDurationSeconds))*1000).run();
  await enqueue(id);return publicRow(await store.get(id,owner));
 }
 async function cancel(owner,id){
  if(!uuid(id))throw new MeetingError('meeting_not_found',404);const row=await store.get(id,owner);if(!row)throw new MeetingError('meeting_not_found',404);
  if(!terminal.has(row.status)){await store.update(id,{cancel_requested:1,selected:0,next_at:now()});await enqueue(id);}
  else await store.update(id,{selected:0});
  return publicRow(await store.get(id,owner));
 }
 async function linked(row){return !!await q('SELECT user_id FROM vetsa_app_agent_links WHERE user_id=? AND phone=?',row.owner,row.phone).first();}
 async function reconcile(row){
  const found=await client.call('/bot/?metadata__brivany_meeting_id='+encodeURIComponent(row.id));
  const matches=(found.results||[]).filter(bot=>bot.metadata?.brivany_meeting_id===row.id&&bot.metadata?.brivany_workspace===WORKSPACE_ID&&uuid(bot.id));
  if(matches.length===1){await store.update(row.id,{bot_id:matches[0].id,status:row.join_at&&row.join_at>now()?'scheduled':'joining',error_code:null,next_at:0},row.lease);return matches[0].id;}
  await store.update(row.id,{status:'uncertain',attempts:row.attempts+1,error_code:matches.length>1?'duplicate_provider_bots':'recall_uncertain',next_at:row.attempts>=12?0:now()+300000},row.lease);
  return null;
 }
 async function stop(row){
  if(!row.bot_id&&['creating','uncertain'].includes(row.status)){const id=await reconcile(row);if(!id)return;row={...row,bot_id:id};}
  if(row.bot_id){
   try{await client.call('/bot/'+row.bot_id+'/',{method:'DELETE'});}
   catch(error){if(error.status===404){/* already gone */}else if(error.status===405){await client.call('/bot/'+row.bot_id+'/leave_call/',{method:'POST'});}else throw error;}
  }
  await store.update(row.id,{status:'cancelled',selected:0,cancel_requested:0,next_at:0,error_code:null},row.lease);
 }
 async function create(row){
  if(row.status==='creating'||row.status==='uncertain'){await reconcile(row);return;}
  if(row.status!=='queued')return;
  if(row.join_at&&row.join_at<=now()||!row.join_at&&now()-row.created_at>300000){await store.update(row.id,{status:'failed',error_code:'scheduled_time_passed',selected:0,next_at:0},row.lease);return;}
  const data=await store.unseal(row.owner+':intent:'+row.id,row);
  const outputURL=data.interactive?await prepareVoice(env,row):null;
  await store.update(row.id,{status:'creating',attempts:row.attempts+1,next_at:now()+60000},row.lease);
  let bot;
  try{bot=await client.call('/bot/',{method:'POST',body:{meeting_url:data.meetingUrl,bot_name:row.phone===String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'')?'Melodi · Asistente de Daniel Luna':'Melodi · Brivany',join_at:row.join_at?new Date(row.join_at).toISOString():null,recording_config:{audio_mixed_mp3:{},video_mixed_mp4:null},...(outputURL?{output_media:{camera:{kind:'webpage',config:{url:outputURL}}}}:meetingCamera()),metadata:{brivany_meeting_id:row.id,brivany_workspace:WORKSPACE_ID}}});}
  catch(error){
   if(error.status===429){await store.update(row.id,{status:'queued',next_at:now()+error.retryDelaySeconds*1000,error_code:error.code},row.lease);return;}
   if(error.status>=500){await store.update(row.id,{status:'uncertain',next_at:now()+Math.max(30,error.retryDelaySeconds)*1000,error_code:'recall_uncertain'},row.lease);return;}
   await store.update(row.id,{status:'failed',selected:0,next_at:0,error_code:error.code||'recall_create_failed'},row.lease);return;
  }
  if(!uuid(bot?.id)){await store.update(row.id,{status:'uncertain',error_code:'recall_uncertain',next_at:now()+60000},row.lease);return;}
  await store.update(row.id,{bot_id:bot.id,status:row.join_at?'scheduled':'joining',next_at:0,error_code:null},row.lease);
 }
 async function syncCalendar(row){
  const data=await store.unseal(row.owner+':intent:'+row.id,row);
  const result=await calendar(env,row.phone,{eventId:data.eventId,now:now()});
  if(result.calendarId!==data.calendarId)throw new MeetingError('calendar_changed',409);
  const event=result.event;
  if(!event||!event.meetingUrl){await store.update(row.id,{cancel_requested:1,selected:0},row.lease);await stop({...row,cancel_requested:1});return;}
  if(Date.parse(event.startAt)<=now()){
   // Once dispatched, a past start is normal. Never cancel an active call on a timer.
   if(!row.bot_id)await store.update(row.id,{status:'failed',selected:0,error_code:'scheduled_time_passed',next_at:0},row.lease);
   return;
  }
  if(!eligibleEvent(event,now()))throw new MeetingError('calendar_event_ineligible',409);
  if(event.meetingUrl!==data.meetingUrl||Date.parse(event.startAt)!==row.join_at||event.title!==data.title){
   if(row.bot_id&&(event.meetingUrl!==data.meetingUrl||Date.parse(event.startAt)!==row.join_at))await client.call('/bot/'+row.bot_id+'/',{method:'PATCH',body:{meeting_url:event.meetingUrl,join_at:event.startAt}});
   const sealed=await store.seal(row.owner+':intent:'+row.id,{...data,meetingUrl:event.meetingUrl,title:event.title});
   await store.update(row.id,{...sealed,join_at:Date.parse(event.startAt)},row.lease);
  }
  await store.update(row.id,{calendar_next:now()+60000,error_code:null},row.lease);
 }
 async function transcript(row){
  if(row.transcript_state==='done'||row.transcript_state==='failed')return;
  if(row.transcript_id&&row.transcript_state==='download'){
   const artifact=await client.call('/transcript/'+row.transcript_id+'/');
   if(artifact.recording?.id!==row.recording_id)throw new MeetingError('artifact_owner_mismatch',502);
   if(artifact.status?.code!=='done')throw new MeetingError('artifact_not_ready',502,30); // inconsistent done delivery; retry only that durable job
   const segments=transcriptSegments(await client.download(artifact.data?.download_url));
   await store.saveOutput(row,segments);await store.update(row.id,{transcript_state:'done',status:'ready',next_at:0,error_code:null},row.lease);await requestMeetingSummary(env,row.id);return;
  }
  if(row.transcript_state==='requesting'||row.transcript_state==='uncertain'){
   const recording=await client.call('/recording/'+row.recording_id+'/');
   const artifact=recording.media_shortcuts?.transcript;
   if(uuid(artifact?.id)){await store.update(row.id,{transcript_id:artifact.id,transcript_state:'processing',next_at:0},row.lease);if(artifact.status?.code==='done')await transcript({...row,transcript_id:artifact.id,transcript_state:'download'});}
   else await store.update(row.id,{transcript_state:'uncertain',error_code:'transcript_uncertain',next_at:now()+300000},row.lease);
   return;
  }
  if(row.transcript_state!=='needed')return;
  await store.update(row.id,{transcript_state:'requesting',status:'transcribing',next_at:now()+60000},row.lease);
  try{
   const result=await client.call('/recording/'+row.recording_id+'/create_transcript/',{method:'POST',body:{provider:{recallai_async:{language_code:'auto'}}}});
   await store.update(row.id,{transcript_state:'processing',...(uuid(result?.id)?{transcript_id:result.id}:{}),next_at:0,error_code:null},row.lease);
  }catch(error){
   if(error.status===429)await store.update(row.id,{transcript_state:'needed',next_at:now()+error.retryDelaySeconds*1000,error_code:error.code},row.lease);
   else if(error.status>=500)await store.update(row.id,{transcript_state:'uncertain',next_at:now()+Math.max(30,error.retryDelaySeconds)*1000,error_code:'transcript_uncertain'},row.lease);
   else await store.update(row.id,{transcript_state:'failed',status:'failed',error_code:error.code,next_at:0},row.lease);
  }
 }
 async function processMeeting(id){
  await store.ensure();let row=await store.claim(id);if(!row)return;
  try{
   const limit=await q('SELECT stop_at FROM brivany_meeting_limits WHERE meeting_id=?',id).first();
   if(limit&&limit.stop_at<=now()&&!terminal.has(row.status)&&row.status!=='transcribing'){
    await store.update(id,{cancel_requested:1,selected:0,next_at:now()},row.lease);row={...row,cancel_requested:1,next_at:now()};
   }
   if(row.next_at>now())return;
   if(row.cancel_requested||!await linked(row)){await stop(row);return;}
   if(row.source==='calendar'&&row.selected&&!terminal.has(row.status)&&row.calendar_next<=now()&&(!row.join_at||row.join_at>now())){
    await syncCalendar(row);row=await store.get(id);if(row.status==='cancelled'||row.status==='failed')return;
   }
   await create(row);row=await store.get(id);
   if(row.cancel_requested){await stop(row);return;}
   if(row.recording_id)await transcript(row);
  }catch(error){await store.update(id,{attempts:row.attempts+1,next_at:row.attempts>=12?0:now()+Math.max(error.retryDelaySeconds||retryDelay(null,row.attempts),10)*1000,error_code:error.code||'meeting_processing_failed'},row.lease);}
  finally{await store.release(id,row.lease);}
 }
 async function acceptWebhook(request){
  const verified=await verifyWebhook(request,env.RECALL_WEBHOOK_VERIFICATION_SECRET,now());
  // No schema/storage/queue call occurs until the exact raw body passes HMAC.
  await store.ensure();const sealed=await store.seal('webhook:'+verified.id,verified.payload);
  await q('INSERT OR IGNORE INTO brivany_meeting_inbox(id,event,next_at,state_encrypted,state_iv,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',verified.id,verified.payload.event,now(),sealed.state_encrypted,sealed.state_iv,now(),now()).run();
  const row=await q('SELECT status FROM brivany_meeting_inbox WHERE id=?',verified.id).first();
  if(row.status==='pending')await env.MELODI_JOBS.send({type:'recall_webhook',id:verified.id});
  return json({accepted:true});
 }
 async function processWebhook(id){
  await store.ensure();const lease=crypto.randomUUID();const inbox=await q("UPDATE brivany_meeting_inbox SET lease=?,lease_until=?,attempts=attempts+1 WHERE id=? AND status='pending' AND lease_until<=? AND next_at<=? RETURNING *",lease,now()+60000,id,now(),now()).first();if(!inbox)return;
  let row;
  try{
   const payload=await store.unseal('webhook:'+id,inbox),data=payload.data,event=payload.event;
   if(!WEBHOOK_EVENTS.includes(event)){await done('ignored');return;}
   const botId=data.bot?.id,recordingId=data.recording?.id;
   const target=uuid(botId)?await q('SELECT * FROM brivany_meetings WHERE bot_id=?',botId).first():uuid(recordingId)?await q('SELECT * FROM brivany_meetings WHERE recording_id=?',recordingId).first():null;
   if(!target){
    // Create-response loss/race: bind only a persisted Brivany intent with exact metadata.
    const correlation=data.bot?.metadata?.brivany_meeting_id;
    if(uuid(botId)&&uuid(correlation)&&data.bot.metadata.brivany_workspace===WORKSPACE_ID){const saved=await store.get(correlation);if(saved&&!saved.bot_id&&['creating','uncertain'].includes(saved.status)){await store.update(saved.id,{bot_id:botId});}}
    const retry=uuid(botId)?await q('SELECT id FROM brivany_meetings WHERE bot_id=?',botId).first():null;
    if(retry)throw new MeetingError('webhook_create_race',503,2);
    await done('ignored');return;
   }
   row=await store.claim(target.id);if(!row)throw new MeetingError('meeting_busy',503,5);
   if(uuid(recordingId)&&!row.recording_id)await store.update(row.id,{recording_id:recordingId},row.lease);
   if(row.recording_id&&uuid(recordingId)&&row.recording_id!==recordingId){await done('ignored');return;}
   if(event.startsWith('bot.')){
    const at=Date.parse(data.data?.updated_at)||inbox.created_at;
    if(at>=row.bot_status_at){
     const code=event.slice(4),updates={bot_status:code,bot_status_at:at};
     if(!terminal.has(row.status)&&!['transcribing'].includes(row.status))updates.status=({joining_call:'joining',in_waiting_room:'waiting',in_call_not_recording:'joined',recording_permission_denied:'permission_denied',in_call_recording:'recording',call_ended:'processing',done:'ended',fatal:'failed'})[code]||row.status;
     if(code==='fatal'||code==='recording_permission_denied')updates.error_code=String(data.data?.sub_code||code).slice(0,100);
     await store.update(row.id,updates,row.lease);
    }
   }else if(event==='recording.done'){
    if(!uuid(recordingId))throw new MeetingError('webhook_schema_invalid',400);
    if(row.transcript_state==='none')await store.update(row.id,{recording_id:recordingId,transcript_state:'needed',status:'transcribing',next_at:now()},row.lease);
   }else if(event==='transcript.done'){
    if(!uuid(data.transcript?.id)||!uuid(recordingId))throw new MeetingError('webhook_schema_invalid',400);
    if(row.transcript_state!=='done')await store.update(row.id,{recording_id:recordingId,transcript_id:data.transcript.id,transcript_state:'download',next_at:now()},row.lease);
   }else if(event.endsWith('.failed')){
    await store.update(row.id,{status:'failed',transcript_state:event==='transcript.failed'?'failed':row.transcript_state,error_code:String(data.data?.sub_code||data.status?.sub_code||event).slice(0,100),next_at:0},row.lease);
   }
   const latest=await store.get(row.id);if(latest.next_at)await enqueue(row.id);
   await done('done');
  }catch(error){
   const failed=inbox.attempts>=12;await q('UPDATE brivany_meeting_inbox SET status=?,next_at=?,updated_at=? WHERE id=? AND lease=?',failed?'failed':'pending',now()+Math.max(error.retryDelaySeconds||retryDelay(null,inbox.attempts),5)*1000,now(),id,lease).run();
  }finally{if(row)await store.release(row.id,row.lease);await q('UPDATE brivany_meeting_inbox SET lease=NULL,lease_until=0 WHERE id=? AND lease=?',id,lease).run();}
  async function done(status){await q('UPDATE brivany_meeting_inbox SET status=?,updated_at=? WHERE id=? AND lease=?',status,now(),id,lease).run();}
 }
 async function tick(){
  await store.ensure();
  const {results:expired=[]}=await q("SELECT m.id FROM brivany_meeting_limits l JOIN brivany_meetings m ON m.id=l.meeting_id WHERE l.stop_at<=? AND m.status NOT IN ('ready','ended','cancelled','failed','transcribing')",now()).all();
  for(const row of expired){await store.update(row.id,{cancel_requested:1,selected:0,next_at:now()});await enqueue(row.id);}
  const {results:meetings=[]}=await q("SELECT id FROM brivany_meetings WHERE lease_until<=? AND ((cancel_requested=1 AND next_at<=?) OR (next_at>0 AND next_at<=?) OR (source='calendar' AND selected=1 AND calendar_next<=? AND join_at>? AND status NOT IN ('ready','failed','cancelled','ended'))) ORDER BY next_at LIMIT 30",now(),now(),now(),now(),now()).all();
  for(const row of meetings)await enqueue(row.id);
  const {results:events=[]}=await q("SELECT id FROM brivany_meeting_inbox WHERE status='pending' AND next_at<=? AND lease_until<=? ORDER BY next_at LIMIT 30",now(),now()).all();
  for(const row of events)await env.MELODI_JOBS.send({type:'recall_webhook',id:row.id});
  const {results:summaries=[]}=await q("SELECT meeting_id FROM brivany_meeting_summaries WHERE status='pending' AND next_at<=? LIMIT 20",now()).all();
  for(const row of summaries)await env.MELODI_JOBS.send({type:'recall_summary',id:row.meeting_id});
 }
 async function route(request,owner,phone){
  await store.ensure();const url=new URL(request.url),path=url.pathname.replace(/^\/agents\/meetings/,'');
  if(request.method==='GET'&&path===''){
   const {results=[]}=await q('SELECT * FROM brivany_meetings WHERE owner=? ORDER BY created_at DESC LIMIT 50',owner).all();
   return json({configured:true,workspace:'Vetsa AI',region:'eu-central-1',meetings:await Promise.all(results.map(publicRow)),calendarRule:'explicit-event',capabilities:{transcript:true,liveVoice:voiceConfigured(env),summaries:true,nativeRaiseHand:false}});
  }
  if(request.method==='GET'&&path==='/calendar'){
   const data=await calendar(env,phone,{now:now()});
   const {results:rows=[]}=await q("SELECT * FROM brivany_meetings WHERE owner=? AND source='calendar' AND selected=1",owner).all();
   const selected=new Map();for(const row of rows){const state=await store.unseal(owner+':intent:'+row.id,row);if(state.calendarId===data.calendarId)selected.set(state.eventId,row);}
   return json({connected:data.connected,calendarName:data.calendarName,rule:'explicit-event',events:data.events.map(event=>({id:event.googleId,title:event.title,startAt:event.startAt,meetingUrl:event.meetingUrl,eligible:event.eligible,selected:selected.has(event.googleId),meetingId:selected.get(event.googleId)?.id||null}))});
  }
  if(request.method==='GET'&&path==='/detail'){
   const id=url.searchParams.get('id');if(!uuid(id))throw new MeetingError('meeting_not_found',404);const row=await store.get(id,owner);if(!row)throw new MeetingError('meeting_not_found',404);
   const part=Number(url.searchParams.get('part')||0);if(!Number.isInteger(part)||part<0||part>=150)throw new MeetingError('page_invalid');
   const page=row.transcript_state==='done'?await q('SELECT * FROM brivany_meeting_outputs WHERE meeting_id=? AND part=?',id,part).first():null;
   const next=page?await q('SELECT part FROM brivany_meeting_outputs WHERE meeting_id=? AND part=?',id,part+1).first():null;
   const summary=await q('SELECT * FROM brivany_meeting_summaries WHERE meeting_id=?',id).first();
   return json({meeting:await publicRow(row),summary:summary?.status==='done'?await store.unseal(owner+':summary:'+id,summary):null,summaryStatus:summary?.status||'pending',transcript:page?await store.unseal(owner+':output:'+id+':'+part,page):[],nextPart:next?.part??null});
  }
  if(request.method==='POST'){
   if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new MeetingError('json_required',415);
   const input=await boundedJSON(request,10000);
   if(!input||typeof input!=='object'||Array.isArray(input))throw new MeetingError('invalid_request');
   if(path===''&&!Object.keys(input).some(k=>!['requestId','meetingUrl','joinAt','title','consent','interactive'].includes(k)))return json({meeting:await submit(owner,phone,input)},202);
   if(path==='/schedule'&&!Object.keys(input).some(k=>!['requestId','eventId','consent'].includes(k))){const {event,calendarId}=await calendar(env,phone,{eventId:input.eventId,now:now()});if(!eligibleEvent(event,now()))throw new MeetingError('calendar_event_ineligible');return json({meeting:await submit(owner,phone,input,{source:'calendar',event,calendarId})},202);}
   if(path==='/cancel'&&Object.keys(input).length===1)return json({meeting:await cancel(owner,input.id)},202);
  }
  throw new MeetingError('meeting_route_not_found',404);
 }
 return {submit,cancel,processMeeting,acceptWebhook,processWebhook,tick,route,publicRow,store};
}
export async function meetingRoute(request,env,owner,phone){try{return await createMeetingService(env).route(request,owner,phone);}catch(error){return json({error:meetingMessage(error.code),code:error.code||'meeting_unavailable'},error instanceof MeetingError?error.status:503);}}
export async function recallWebhook(request,env){
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 try{config(env);return await createMeetingService(env).acceptWebhook(request);}catch(error){return json({error:error.code||'webhook_unavailable'},error instanceof MeetingError?error.status:503);}
}
export async function recallJob(env,job){
 const service=createMeetingService(env);
 if(job.type==='recall_operator_voice_check')return probeMeetingVoice(env,job.id);
 if(job.type==='recall_operator_board'){
  const row=await service.store.get(job.id),primary=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');if(!row||row.phone!==primary)throw new MeetingError('meeting_not_found',404);
  return showMeetingBoard(env,row,job.board);
 }
 if(job.type==='recall_operator_calendar_check'){
  await service.store.ensure();const primary=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');let details;
  try{const value=await readMeetingCalendar(env,primary);details={connected:value.connected,events:value.events.length,eligible:value.events.filter(event=>event.eligible).length,calendarName:value.calendarName};}
  catch(error){details={connected:false,error:error.code||'calendar_unavailable'};}
  await service.store.q('INSERT OR REPLACE INTO brivany_meeting_checks VALUES(?,?,?,?)',job.id,details.connected?'passed':'failed',JSON.stringify(details),Date.now()).run();return;
 }
 if(job.type==='recall_summary')return processMeetingSummary(env,job.id);
 if(job.type==='recall_operator_summary')return requestMeetingSummary(env,job.id);
 if(job.type==='recall_operator_media'){
  const row=await service.store.get(job.id),primary=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
  if(!row||row.phone!==primary||!row.bot_id||!['recording','joined'].includes(row.status))throw new MeetingError('meeting_not_active',409);
  const url=await prepareVoice(env,row);return recallClient(env).call('/bot/'+row.bot_id+'/output_media/',{method:'POST',body:{camera:{kind:'webpage',config:{url}}}});
 }
 if(job.type==='recall_operator_test'){
  // Private, Cloudflare-authenticated queue only. No public endpoint can enqueue
  // this operation. Resolve the original operator's existing account server-side.
  if(job.confirmed!==true||job.meetingRequest?.consent!==true)throw new MeetingError('recording_consent_required');
  if(job.expiresAt!==undefined&&(!Number.isSafeInteger(job.expiresAt)||job.expiresAt<=Date.now()))return;
  const phone=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
  const link=await service.store.q('SELECT user_id FROM vetsa_app_agent_links WHERE phone=? AND linked_at IS NOT NULL',phone).first();
  if(!link)throw new MeetingError('operator_account_not_linked',403);
  return service.submit(link.user_id,phone,job.meetingRequest,{testDurationSeconds:job.testDurationSeconds||60});
 }
 if(job.type==='recall_webhook')await service.processWebhook(job.id);else if(job.type==='recall_meeting')await service.processMeeting(job.id);else if(job.type==='recall_tick')await service.tick();
}
