import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PhoneVoice,MuLaw24k} from '../voice.js';
import {MELODI_VOICE} from '../protocol.js';
import {phoneComputer} from '../computer.js';
const env={BRIVANY_CARTESIA_API_KEY:'synthetic-tts',BRIVANY_META_API_KEY:'synthetic-asr',BRIVANY_META_MODEL:'synthetic-model'};
function fixture(fetcher){
  const sent=[],ended=[],promises=[];let voice;
  const socket={send(raw){const value=JSON.parse(raw);sent.push(value);if(value.event==='mark')queueMicrotask(()=>voice.accept(JSON.stringify({event:'mark',mark:value.mark})));},close(){}};
  voice=new PhoneVoice({env,socket,controlId:'v3:test',objective:'PRIVATE_OBJECTIVE',onEnd:async reason=>ended.push(reason),waitUntil:p=>promises.push(p),fetcher});voice.streamId='test-stream';
  return {voice,sent,ended,promises};
}
test('cloud calls use precisely the selected Melodi Cartesia voice and pinned model',async()=>{
  const source=await readFile(new URL('../../../packages/providers/cartesia_melodi.py',import.meta.url),'utf8');
  assert.ok(source.includes(MELODI_VOICE.id));assert.ok(source.includes(MELODI_VOICE.model));assert.ok(source.includes(MELODI_VOICE.version));
  const calls=[],f=fixture(async(url,options)=>{calls.push({url,options});return new Response(new Uint8Array(640).fill(255),{headers:{'Content-Type':'application/octet-stream'}});});
  const turn=f.voice.turn=new AbortController();turn.acknowledged=[];await f.voice.speak('Texto ficticio.',turn);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.cartesia.ai/tts/bytes');const request=JSON.parse(calls[0].options.body);
  assert.equal(request.voice,MELODI_VOICE.id);assert.equal(request.model_id,MELODI_VOICE.model);assert.equal(request.output_format.encoding,'pcm_mulaw');assert.equal(request.output_format.sample_rate,8000);
  assert.equal(f.voice.outputReady,true);assert.deepEqual(turn.acknowledged,['Texto ficticio.']);assert.equal(f.voice.metrics.ackBoundary,'telnyx_playback_mark');f.voice.close();
});
test('a Cartesia rejection is terminal rather than selecting a default voice or another provider',async()=>{
  const calls=[],f=fixture(async url=>{calls.push(url);return Response.json({error:'synthetic rejection'},{status:403});});
  f.voice.enqueue(null);await Promise.all(f.promises);assert.deepEqual(calls,['https://api.cartesia.ai/tts/bytes']);assert.deepEqual(f.ended,['voice_failed']);assert.equal(f.sent.filter(e=>e.event==='media').length,0);
});
test('interruption cancels upstream generation, clears playback and never commits an unheard sentence',async()=>{
  const f=fixture(),turn=f.voice.turn=new AbortController();turn.acknowledged=[];
  f.voice.mark(turn,.1,'unheard');f.voice.interrupt();await new Promise(r=>setTimeout(r,1));
  assert.equal(turn.signal.aborted,true);assert.equal(f.voice.pending.size,0);assert.equal(f.voice.pendingSeconds,0);assert.deepEqual(turn.acknowledged,[]);assert.equal(f.sent.at(-1).event,'clear');f.voice.close();
});
test('maximum duration and silence remain bounded even if voice generation is healthy',()=>{
  const f=fixture(),start=f.voice.started;f.voice.inputReady=true;f.voice.outputReady=true;
  assert.equal(f.voice.reason(start+15001),'user_silence');f.voice.lastUserVoice=start+89999;assert.equal(f.voice.reason(start+90000),'maximum_duration');f.voice.close();
});
test('ASR finals are correlated and cannot replay or overflow a turn',()=>{
  const f=fixture(),turns=[];f.voice.enqueue=text=>turns.push(text);
  const event={type:'speechComplete',turnId:'turn-1',transcript:'Texto ficticio'};f.voice.transcript(event);f.voice.transcript(event);
  assert.deepEqual(turns,['Texto ficticio']);assert.throws(()=>f.voice.transcript({type:'speechComplete',turnId:'turn-2',transcript:'a'.repeat(1201)}),/transcript_invalid/);f.voice.close();
});
test('PCMU silence becomes mono 24 kHz PCM with state across packet boundaries',()=>{
  const decoder=new MuLaw24k();const result=decoder.decode(new Uint8Array(160).fill(255));assert.equal(result.pcm.length,960);assert.equal(result.rms,0);assert.ok(result.pcm.every(b=>b===0));
  const a=decoder.decode(new Uint8Array(160).fill(128)),b=decoder.decode(new Uint8Array(160).fill(128));
  assert.equal(a.pcm.length,960);const samples=new DataView(b.pcm.buffer);assert.ok(samples.getInt16(300,true)>30000);assert.ok(samples.getInt16(300,true)<=32767);
});
test('stale media is dropped while a late exact playback acknowledgement still succeeds',async()=>{
  const f=fixture();f.voice.sequence=4;f.voice.inputReady=true;let sent=0;f.voice.muse={send(){sent++;},bufferedAmount:0,close(){}};
  await f.voice.accept(JSON.stringify({event:'media',sequence_number:'3',media:{track:'inbound',payload:btoa('\xff'.repeat(160))}}));assert.equal(sent,0);
  const turn=f.voice.turn=new AbortController();turn.acknowledged=[];f.voice.pending.set('exact',{turn,seconds:.1,text:'Heard at provider boundary'});f.voice.pendingSeconds=.1;
  await f.voice.accept(JSON.stringify({event:'mark',sequence_number:'2',mark:{name:'exact'}}));assert.equal(f.voice.outputReady,true);assert.equal(f.voice.pendingSeconds,0);f.voice.close();
});
test('a spoken computer tool receives only the actual caller utterance and returns confirmed dispatch state',async()=>{
 const events=[],bridge={async execute(value){events.push(value);return {id:crypto.randomUUID(),summary:'Envié la instrucción.'};},async status(){return {summary:'La tarea sigue en curso.'};}};
 const computer=phoneComputer({MELODI_DESKTOP:bridge},'18095550101',crypto.randomUUID());
 const f=fixture(async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.parallel_tool_calls,false);assert.equal(body.tools.length,3);return Response.json({choices:[{message:{tool_calls:[{function:{name:'computer_execute',arguments:'{}'}}]}}]});});f.voice.computer=computer;
 assert.equal(await f.voice.reply('Abre una aplicación sintética',new AbortController()),'Envié la instrucción.');
 assert.equal(events.length,1);assert.equal(events[0].instruction,'Abre una aplicación sintética');assert.equal(f.voice.metrics.computerRequests,1);
 assert.equal(await computer('computer_status','¿Cómo va?',crypto.randomUUID()),'La tarea sigue en curso.');f.voice.close();
});
test('parallel, invented or expanded computer actions are rejected before any RPC',async()=>{
 let ran=0;
 for(const calls of [[{function:{name:'computer_execute',arguments:'{"instruction":"invented"}'}}],[{function:{name:'unknown',arguments:'{}'}}],[{function:{name:'computer_execute',arguments:'{}'}},{function:{name:'computer_execute',arguments:'{}'}}]]){
  const f=fixture(async()=>Response.json({choices:[{message:{tool_calls:calls}}]}));f.voice.computer=async()=>{ran++;};
  await assert.rejects(f.voice.reply('Synthetic request',new AbortController()),/phone_tool_invalid/);f.voice.close();
 }
 assert.equal(ran,0);
});
test('an uncertain computer dispatch is never automatically replayed',async()=>{
 let attempts=0;const computer=phoneComputer({MELODI_DESKTOP:{async execute(){attempts++;throw Error('Synthetic transport failure');}}},'18095550101',crypto.randomUUID());
 assert.match(await computer('computer_execute','Synthetic task',crypto.randomUUID()),/No pude confirmar/);assert.equal(attempts,1);
 assert.match(await computer('computer_status','Status',crypto.randomUUID()),/Todavía no/);assert.equal(attempts,1);
});
test('the voice timing starts on the media start event rather than while the phone is ringing',async()=>{
 const f=fixture();f.voice.streamId=null;const at=f.voice.started+30000;f.voice.clock=()=>at;f.voice.listen=async()=>{f.voice.inputReady=true;};f.voice.enqueue=()=>{};f.voice.outputReady=true;
 await f.voice.accept(JSON.stringify({event:'start',stream_id:'after-answer',start:{call_control_id:'v3:test',media_format:{encoding:'PCMU',sample_rate:8000,channels:1}}}));
 assert.equal(f.voice.started,at);assert.equal(f.voice.reason(at+14000),null);assert.equal(f.voice.reason(at+15001),'user_silence');f.voice.close();
});
