import test from 'node:test';
import assert from 'node:assert/strict';
import {recallFixture,OWNER,PHONE} from './recall-fixture.js';
import {MeetingVoiceSession,speechSelection,prepareVoice,authorizeVoice} from '../meetings/voice.js';
import {meetingMedia} from '../meetings/media.js';
import {showMeetingBoard,readMeetingBoard} from '../meetings/board.js';
import {requestMeetingSummary,processMeetingSummary} from '../meetings/summary.js';
import {MELODI_VOICE} from '../../calls/protocol.js';
async function voiceFixture(){
 const f=await recallFixture();Object.assign(f.env,{BRIVANY_MUSE_API_KEY:'synthetic-muse',BRIVANY_META_API_KEY:'synthetic-meta',BRIVANY_META_MODEL:'synthetic-model',BRIVANY_CARTESIA_API_KEY:'synthetic-cartesia'});
 const m=await f.service.submit(OWNER,PHONE,f.input());await f.drain();await f.store.update(m.id,{status:'recording'});let row=await f.store.get(m.id);const url=await prepareVoice(f.env,row);row=await f.store.get(m.id);await f.store.q('UPDATE brivany_meeting_voice SET lease=?,lease_until=? WHERE meeting_id=?','synthetic-lease',Date.now()+45000,m.id).run();
 const frames=[],calls=[],pending=[],listeners={},muse={bufferedAmount:0,accept(){},close(){},addEventListener(type,fn){listeners[type]=fn;},send(data){if(typeof data==='string'){calls.push({kind:'muse-config',body:JSON.parse(data)});queueMicrotask(()=>listeners.message({data:JSON.stringify({sessionId:'synthetic-session'})}));}else calls.push({kind:'pcm',bytes:data.byteLength});}};
 const socket={bufferedAmount:0,send(value){frames.push(JSON.parse(value));},close(){}};
 const fetcher=async(url,options={})=>{const body=options.body?JSON.parse(options.body):null;
  if(url.endsWith('/asr/realtime'))return {status:101,webSocket:muse};
  if(url.endsWith('/chat/completions')){calls.push({kind:'model',body});return Response.json({choices:[{message:{content:'Soy Melodi, la asistente personal de Daniel Luna.'}}]});}
  if(url.includes('cartesia')){calls.push({kind:'tts',body});return new Response(new Uint8Array(4800),{headers:{'Content-Type':'application/octet-stream'}});}
  return f.fetcher(url,options);
 };
 const session=new MeetingVoiceSession({env:f.env,socket,store:f.store,row,lease:'synthetic-lease',waitUntil:promise=>pending.push(promise),fetcher});
 return {...f,row,url,frames,voiceCalls:calls,pending,session,fetcher};
}
test('selective response ignores conversation and recognizes explicit requests and silence',()=>{
 assert.equal(speechSelection('Estamos hablando de Melodi y del proyecto'),'silent');assert.equal(speechSelection('Melodi, ¿puedes explicarlo?'),'respond');assert.equal(speechSelection('Oye Melody, hola'),'respond');assert.equal(speechSelection('Melodi, no hables'),'stop');assert.equal(speechSelection('Hola a todos'),'silent');
});
test('voice starts silently, receives PCM and calls only the selected Cartesia voice when addressed',async()=>{
 const f=await voiceFixture();await f.session.open();assert.equal(f.voiceCalls.filter(x=>x.kind==='tts').length,0);assert.equal(f.voiceCalls.filter(x=>x.kind==='model').length,0);
 await f.session.accept(new Uint8Array(960).buffer);assert.equal(f.voiceCalls.find(x=>x.kind==='pcm').bytes,960);
 await f.session.recognized({turnId:'ignored',transcript:'Conversación entre participantes'});assert.equal(f.voiceCalls.filter(x=>x.kind==='model').length,0);
 await f.session.recognized({turnId:0,transcript:'Melodi, preséntate'});assert.equal(f.voiceCalls.filter(x=>x.kind==='tts').length,1);const tts=f.voiceCalls.find(x=>x.kind==='tts');assert.equal(tts.body.voice,MELODI_VOICE.id);assert.equal(tts.body.model_id,MELODI_VOICE.model);assert.equal(tts.body.generation_config.speed,1);assert.equal(tts.body.output_format.encoding,'pcm_s16le');assert.equal(tts.body.output_format.sample_rate,24000);
 await f.session.recognized({turnId:0,transcript:'Melodi, preséntate'});assert.equal(f.voiceCalls.filter(x=>x.kind==='tts').length,1);
 assert.ok(f.frames.some(x=>x.type==='audio'));assert.ok(f.frames.some(x=>x.type==='audio-end'));assert.equal(f.session.playing,true);await f.session.accept(JSON.stringify({type:'played',id:f.frames.find(x=>x.type==='audio-end').id}));assert.equal(f.session.playing,false);
 assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM brivany_meeting_voice_turns').all()),/preséntate|asistente personal/);f.session.close();await Promise.all(f.pending);
});
test('raising the visual hand is silent and an explicit hush clears playback',async()=>{
 const f=await voiceFixture();await f.session.open();await f.session.recognized({turnId:'hand',transcript:'Melodi, levanta la mano'});assert.ok(f.frames.some(x=>x.type==='hand'&&x.raised));assert.equal(f.voiceCalls.filter(x=>x.kind==='tts').length,0);await f.session.recognized({turnId:'hush',transcript:'Melodi, guarda silencio'});assert.ok(f.frames.some(x=>x.type==='clear'));f.session.close();await Promise.all(f.pending);
});
test('meeting replies reuse the existing non-thinking Brivany inference when available',async()=>{
 const f=await voiceFixture();let native=0;f.env.ASSISTANT_NATIVE_AI_ENABLED='true';f.env.AI={async run(model,input){native++;assert.equal(input.max_tokens,300);assert.match(input.messages[0].content,/Daniel Luna/);return {response:'Soy Melodi, tu asistente personal.',model};}};
 await f.session.open();await f.session.recognized({turnId:0,transcript:'Melodi, preséntate'});assert.equal(native,1);assert.equal(f.voiceCalls.filter(x=>x.kind==='model').length,0);assert.equal(f.voiceCalls.filter(x=>x.kind==='tts').length,1);f.session.close();await Promise.all(f.pending);
});

test('silent listening supplies bounded recent meeting context only when explicitly addressed',async()=>{
 const f=await voiceFixture();let prompt;f.env.ASSISTANT_NATIVE_AI_ENABLED='true';f.env.AI={async run(model,input){prompt=JSON.parse(input.messages[1].content);return {response:'La entrega es el viernes.',model};}};
 await f.session.open();for(let i=0;i<45;i++)await f.session.recognized({turnId:i,transcript:i===44?'La entrega será el viernes.':'Comentario sintético '+i});assert.equal(prompt,undefined);assert.equal(f.voiceCalls.filter(x=>x.kind==='tts').length,0);assert.ok(f.session.context.length<=40);
 await f.session.recognized({turnId:45,transcript:'Melodi, ¿cuándo es la entrega?'});assert.ok(prompt.recentMeetingConversation.includes('La entrega será el viernes.'));assert.equal(prompt.request,'Melodi, ¿cuándo es la entrega?');f.session.close();await Promise.all(f.pending);assert.equal(f.session.context.length,0);
});
test('output media uses a scoped expiring token and serves the exact supplied brand image',async()=>{
 const f=await voiceFixture();const context={waitUntil(){}};let response=await meetingMedia(new Request(f.url),f.env,context);assert.equal(response.status,200);const html=await response.text();assert.match(html,/Daniel Luna/);assert.doesNotMatch(html,/synthetic-muse|synthetic-meta|RECALL_API_KEY/);
 response=await meetingMedia(new Request('https://ia.vetsa.es/meeting-media/avatar.png'),f.env,context);assert.equal(response.headers.get('Content-Type'),'image/png');const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(bytes.length,1354157);assert.deepEqual([...bytes.subarray(0,4)],[137,80,78,71]);
 await assert.rejects(authorizeVoice(new Request(f.url.replace(/token=.*/, 'token='+'0'.repeat(64))),f.env,f.row.id),/unauthorized/);
 await f.store.update(f.row.id,{status:'ended'});await assert.rejects(authorizeVoice(new Request(f.url),f.env,f.row.id),/unauthorized/);
});
test('the whiteboard is persisted, safe text and shared via the real Output Media boundary',async()=>{
 const f=await voiceFixture();const calls=[];const board={title:'Plan de trabajo',items:['Investigar','Revisar resultados']};await showMeetingBoard(f.env,f.row,board,{client:{async call(path,options){calls.push({path,options});}}});assert.equal(calls.length,1);assert.match(calls[0].options.body.screenshare.config.url,/mode=board/);assert.equal((await readMeetingBoard(f.store,f.row)).items[1],'Revisar resultados');assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM brivany_meeting_boards').all()),/Investigar/);await assert.rejects(showMeetingBoard(f.env,f.row,{title:'bad',items:['x'.repeat(301)]}),/invalid/);
});
test('summaries use the persisted transcript once and keep both source and output encrypted',async()=>{
 const f=await voiceFixture();await f.store.saveOutput(f.row,[{speaker:'Participante sintético',start:0,text:'Acordamos revisar el proyecto mañana.'}]);await f.store.update(f.row.id,{transcript_state:'done',status:'ready'});await requestMeetingSummary(f.env,f.row.id);let calls=0;
 const fetcher=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({overview:'Se acordó revisar el proyecto.',decisions:['Revisar el proyecto'],actions:[{text:'Revisar el proyecto',owner:null,due:'mañana'}],openQuestions:[]})}}]});};
 await processMeetingSummary(f.env,f.row.id,{fetcher});await processMeetingSummary(f.env,f.row.id,{fetcher});assert.equal(calls,1);const row=f.db.sql.prepare('SELECT * FROM brivany_meeting_summaries').get();assert.equal(row.status,'done');assert.doesNotMatch(JSON.stringify(row),/revisar|proyecto/);assert.equal((await f.store.unseal(OWNER+':summary:'+f.row.id,row)).actions[0].owner,null);
});
test('private real-test intents have an automatic expiry in addition to operator finally cleanup',async()=>{
 const f=await recallFixture();const m=await f.service.submit(OWNER,PHONE,f.input(),{testDurationSeconds:30});await f.drain();f.advance(31000);await f.service.tick();await f.drain();assert.equal((await f.store.get(m.id)).status,'cancelled');assert.equal(f.bots.length,0);
});

test('a delayed test job cannot create a bot after its test window expired',async()=>{
 const f=await recallFixture();const m=await f.service.submit(OWNER,PHONE,f.input(),{testDurationSeconds:30});f.advance(31000);await f.drain();assert.equal(f.bots.length,0);assert.equal(f.calls.filter(call=>call.method==='POST'&&call.path==='/bot/').length,0);assert.equal((await f.store.get(m.id)).status,'cancelled');
});
