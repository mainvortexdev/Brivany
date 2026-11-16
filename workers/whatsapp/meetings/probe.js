// A bounded synthetic provider check. No meeting entry, dial or audio persistence.
import {MeetingVoiceSession,speechSelection} from './voice.js';
import {meetingStore,hash} from './store.js';
import {MELODI_VOICE} from '../../calls/protocol.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function probeMeetingVoice(env,id){
 const store=meetingStore(env);await store.ensure();const claim=await store.q("INSERT OR IGNORE INTO brivany_meeting_checks VALUES(?,'running',NULL,?)",id,Date.now()).run();if(!claim.meta.changes)return;
 const phone=String(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');const link=await store.q('SELECT user_id FROM vetsa_app_agent_links WHERE phone=? AND linked_at IS NOT NULL',phone).first();if(!link)throw Error('operator_account_not_linked');
 const probeId=crypto.randomUUID(),lease=crypto.randomUUID(),row={id:probeId,owner:link.user_id,phone,status:'recording'},tasks=[],packets=[],endsAt=Date.now()+30000;let session,phase='source',sourceBytes=0,replyBytes=0,outputDone=false,deadline;
 const result={mode:'synthetic_provider_probe_no_meeting',museReady:false,recognition:false,replyAudio:false,silentStartup:false,providerRequests:0,voiceId:MELODI_VOICE.id,model:MELODI_VOICE.model};
 await store.q('INSERT INTO brivany_meeting_voice(meeting_id,token_hash,expires_at,lease,lease_until,updated_at) VALUES(?,?,?,?,?,?)',probeId,await hash(crypto.randomUUID()),Date.now()+60000,lease,Date.now()+45000,Date.now()).run();
 const socket={bufferedAmount:0,send(raw){const value=JSON.parse(raw);if(value.type==='audio'){const packet=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));if(phase==='source'){sourceBytes+=packet.length;if(sourceBytes>480000)throw Error('probe_audio_limit');packets.push(packet);}else replyBytes+=packet.length;}if(value.type==='audio-end'&&phase==='reply'){outputDone=true;tasks.push(session.accept(JSON.stringify({type:'played',id:value.id})));}},close(){}};
 session=new MeetingVoiceSession({env,socket,store,row,lease,waitUntil:promise=>tasks.push(promise),fetcher:async(...args)=>{result.providerRequests++;return fetch(...args);}});
 const recognize=session.recognized.bind(session);session.recognized=event=>{result.syntheticRecognition=String(event.transcript||'').slice(0,100);return recognize(event);};
 const pipeline=async()=>{
  await session.open();result.museReady=true;result.silentStartup=sourceBytes===0&&replyBytes===0;
  await session.speak('Melodi, dime quién eres.',new AbortController(),'synthetic-source');
  phase='reply';const pcm=new Uint8Array(sourceBytes+72000);let at=0;for(const packet of packets){pcm.set(packet,at);at+=packet.length;}session.started=Date.now();session.audioBytes=0;
  for(let offset=0;offset<pcm.length&&!session.closed;offset+=960){await session.accept(pcm.slice(offset,offset+960).buffer);await delay(20);}
  // A fixed eight-second wait was stopping a valid inference/TTS response.
  // Wait for the actual terminal signal, inside the overall bounded budget.
  // Match the actual browser microphone: keep sending real-time silence while
  // the assistant prepares its answer, so ASR does not close an idle stream.
  const silence=new Uint8Array(960);
  while(!outputDone&&!session.closed&&!session.failure&&Date.now()<endsAt-250){await session.accept(silence.buffer);await delay(20);}
  result.asrEvents=session.asrEventTypes;result.asrFinals=session.finals.size;result.sourceAudioBytes=sourceBytes;result.recognition=session.finals.size>0&&speechSelection(result.syntheticRecognition)==='respond';result.replyAudio=outputDone&&replyBytes>0;result.replyAudioBytes=replyBytes;result.sessionClosed=session.closed;result.asrCloseCode=session.asrCloseCode||null;result.sessionFailure=session.failure||null;result.inference=session.modelMetrics||null;
  if(!(result.museReady&&result.silentStartup&&result.recognition&&result.replyAudio))throw Error('meeting_voice_probe_failed');
 };
 try{await Promise.race([pipeline(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('meeting_voice_probe_timeout')),30000);})]);result.passed=true;}
 catch(error){result.passed=false;result.failure=/^[a-z_]{3,60}$/.test(error.message)?error.message:'meeting_voice_probe_failed';}
 finally{clearTimeout(deadline);session.close();packets.length=0;await Promise.allSettled(tasks);await store.q('UPDATE brivany_meeting_checks SET status=?,details=?,updated_at=? WHERE id=?',result.passed?'passed':'failed',JSON.stringify(result),Date.now(),id).run();}
 return result;
}
