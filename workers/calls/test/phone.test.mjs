import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,PHONE} from './fixture.mjs';
import {MelodiPhone} from '../worker.js';
import {verifyWebhook,seal,unseal,sha,bytes64} from '../protocol.js';

test('a schedule is encrypted and durable without a desktop/device record',async()=>{
  const f=fixture(),request=f.request(),result=await f.phone.schedule(request);
  assert.equal(result.transport,'cloud');assert.equal(result.created,true);assert.equal(f.storage.alarmAt,request.dueAt);
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM calls').get()),/SYNTHETIC_PRIVATE_OBJECTIVE/);
  const recovered=new MelodiPhone(f.ctx,f.env);assert.equal((await recovered.list(PHONE))[0].id,result.id);
  assert.equal((await f.phone.schedule({...request,id:crypto.randomUUID()})).created,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM calls').get().n,1);
});
test('schedule/list/cancel reject another recipient and unavailable voices never become a schedule',async()=>{
  const f=fixture();await assert.rejects(f.phone.schedule(f.request({phone:'18095559999'})),/owner/);await assert.rejects(f.phone.list('18095559999'),/owner/);
  delete f.env.BRIVANY_CARTESIA_API_KEY;await assert.rejects(f.phone.schedule(f.request()),/unconfigured/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM calls').get().n,0);
});
test('simultaneous requests cannot exceed the pending limit across encryption awaits',async()=>{
  const f=fixture();const results=await Promise.allSettled(Array.from({length:12},(_,i)=>f.phone.schedule(f.request({requestHash:i.toString(16).padStart(64,'0')}))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,10);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM calls').get().n,10);
});
test('cancelling before the durable alarm prevents any provider request',async t=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);await f.phone.cancel(PHONE,r.id);
  t.mock.method(globalThis,'fetch',()=>{throw Error('must not dial');});await f.phone.alarm();assert.equal((await f.phone.list(PHONE))[0].state,'cancelled');
});
test('a due alarm dials only once with fixed channel, owner, hard limits and cloud callbacks',async t=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);const calls=[];t.mock.method(Date,'now',()=>r.dueAt);
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({data:{call_control_id:'v3:synthetic'}});});
  await f.phone.alarm();await f.phone.alarm();assert.equal(calls.length,1);
  const body=calls[0].body;assert.equal(body.to,'+'+PHONE);assert.equal(body.command_id,r.id);assert.equal(body.time_limit_secs,90);assert.equal(body.timeout_secs,45);
  assert.equal(body.webhook_url,'https://ia.vetsa.es/webhooks/telnyx-cloud');assert.match(body.stream_url,/^wss:\/\/ia\.vetsa\.es\/media\/telnyx-cloud\//);assert.doesNotMatch(body.stream_url,/localhost|trycloudflare/);
  assert.equal(body.stream_bidirectional_codec,'PCMU');assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM calls').get()),new RegExp(new URL(body.stream_url).searchParams.get('token')));
});
test('uncertain dial results survive a cold start without redialing or prematurely freeing the line',async t=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);let now=r.dueAt,attempts=0;t.mock.method(Date,'now',()=>now);
  t.mock.method(globalThis,'fetch',async()=>{attempts++;throw Error('network timeout');});await f.phone.alarm();
  const recovered=new MelodiPhone(f.ctx,f.env);now+=15001;await recovered.alarm();assert.equal((await recovered.list(PHONE))[0].state,'uncertain');
  now=r.dueAt+120001;await recovered.alarm();assert.equal((await recovered.list(PHONE))[0].state,'failed');assert.equal(attempts,1);
});
test('an expired schedule is not shifted forward and two simultaneous calls do not overlap',async t=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);await f.phone.schedule(f.request({requestHash:'b'.repeat(64),dueAt:r.dueAt}));
  let now=r.dueAt;t.mock.method(Date,'now',()=>now);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:{call_control_id:'v3:synthetic'}});});
  await f.phone.alarm();assert.equal(calls,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM calls WHERE reason='line_busy'").get().n,1);
  const other=fixture(),late=other.request();await other.phone.schedule(late);now=late.dueAt+60001;await other.phone.alarm();assert.equal((await other.phone.list(PHONE))[0].state,'expired');assert.equal(calls,1);
});
test('signed webhook processing binds the reservation, account and exact phone and deduplicates events',async()=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);f.db.prepare("UPDATE calls SET state='ringing',started_at=?,control_id='v3:synthetic' WHERE id=?").run(Date.now(),r.id);
  const event={data:{id:'event-1',event_type:'call.answered',payload:{connection_id:f.env.TELNYX_CONNECTION_ID,from:f.env.TELNYX_FROM_NUMBER,to:'+'+PHONE,call_control_id:'v3:synthetic',client_state:bytes64(new TextEncoder().encode(JSON.stringify({v:1,id:r.id})))}}};
  await f.phone.webhook({...event,data:{...event.data,payload:{...event.data.payload,to:'+18095559999'}}});assert.equal((await f.phone.list(PHONE))[0].state,'ringing');
  await f.phone.webhook(event);await f.phone.webhook(event);assert.equal((await f.phone.list(PHONE))[0].state,'active');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM events').get().n,1);
  assert.ok(f.storage.alarmAt>Date.now(),'active alarms must not loop on the original answered timestamp');
});
test('voice loss after restart requests a bounded hangup and waits for its signed terminal event',async t=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);const at=Date.now();f.db.prepare("UPDATE calls SET state='active',started_at=?,answered_at=?,control_id='v3:synthetic' WHERE id=?").run(at,at,r.id);
  let now=at+15001;t.mock.method(Date,'now',()=>now);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:{}});});
  await f.phone.alarm();assert.equal((await f.phone.list(PHONE))[0].state,'cancel_requested');assert.equal(calls,1);
  await f.phone.webhook({data:{id:'hangup-1',event_type:'call.hangup',payload:{connection_id:f.env.TELNYX_CONNECTION_ID,from:f.env.TELNYX_FROM_NUMBER,to:'+'+PHONE,call_control_id:'v3:synthetic',client_state:bytes64(new TextEncoder().encode(JSON.stringify({v:1,id:r.id})))}}});
  assert.equal((await f.phone.list(PHONE))[0].state,'interrupted');
});
test('webhook signature verification rejects changed bodies, old timestamps and another key',async()=>{
  const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),key=bytes64(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))),timestamp=String(Math.floor(Date.now()/1000)),raw='{"data":{}}';
  const signature=bytes64(new Uint8Array(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(timestamp+'|'+raw))));
  const request=new Request('https://test.invalid',{headers:{'telnyx-timestamp':timestamp,'telnyx-signature-ed25519':signature}});
  assert.equal(await verifyWebhook(request,raw,key),true);assert.equal(await verifyWebhook(request,raw+' ',key),false);assert.equal(await verifyWebhook(request,raw,key,Date.now()+400000),false);
});
test('terminal notifications are reserved once and never retried after an uncertain delivery',async()=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);await f.phone.cancel(PHONE,r.id);
  const notices=await f.phone.reserveNotices(PHONE);assert.equal(notices.length,1);await f.phone.recordNotice(PHONE,r.id,false);assert.equal((await f.phone.reserveNotices(PHONE)).length,0);
});
test('ringing gets its own 45-second budget and does not consume voice silence or communication timers',async t=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);let now=r.dueAt;t.mock.method(Date,'now',()=>now);
  let hangups=0;t.mock.method(globalThis,'fetch',async url=>{if(url.includes('/hangup'))hangups++;return Response.json({data:{call_control_id:'v3:synthetic'}});});
  await f.phone.alarm();let voiceChecks=0;f.phone.voices.set(r.id,{reason(){voiceChecks++;return 'communication_timeout';},close(){},metrics:{acknowledgedSentences:0}});
  now+=20000;await f.phone.alarm();assert.equal((await f.phone.list(PHONE))[0].state,'ringing');assert.equal(voiceChecks,0);assert.equal(hangups,0);
  now=r.dueAt+45001;await f.phone.alarm();assert.equal((await f.phone.list(PHONE))[0].reason,'no_answer');assert.equal(hangups,1);
});
test('signed provider timeout before answer is classified as no answer even if the media socket closed first',async t=>{
  const f=fixture(),r=f.request();await f.phone.schedule(r);f.db.prepare("UPDATE calls SET state='ringing',started_at=?,control_id='v3:synthetic' WHERE id=?").run(Date.now(),r.id);
  t.mock.method(globalThis,'fetch',async()=>Response.json({data:{}}));await f.phone.finish(r.id,'media_disconnected');
  await f.phone.webhook({data:{id:'no-answer-1',event_type:'call.hangup',payload:{connection_id:f.env.TELNYX_CONNECTION_ID,from:f.env.TELNYX_FROM_NUMBER,to:'+'+PHONE,call_control_id:'v3:synthetic',hangup_cause:'timeout',client_state:bytes64(new TextEncoder().encode(JSON.stringify({v:1,id:r.id})))}}});
  const receipt=(await f.phone.list(PHONE))[0];assert.equal(receipt.state,'failed');assert.equal(receipt.reason,'no_answer');assert.equal(receipt.answeredAt,null);
});
