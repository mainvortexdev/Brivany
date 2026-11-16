import test from 'node:test';
import assert from 'node:assert/strict';
import {recallFixture,withFixtureFetch,OWNER,PHONE,URL,BOT,REC,TRANSCRIPT} from './recall-fixture.js';
import {meetingURL,config,WORKSPACE_ID,retryDelay,verifyWebhook} from '../meetings/recall.js';
import {createMeetingService,recallWebhook,recallJob} from '../meetings/service.js';
import {eligibleEvent} from '../meetings/calendar.js';
const creates=f=>f.calls.filter(c=>c.url.endsWith('/bot/')&&c.method==='POST');
const transcriptCreates=f=>f.calls.filter(c=>c.url.includes('/create_transcript/'));
test('exact workspace, region and HTTPS meeting hosts are enforced',async()=>{
 const f=await recallFixture();assert.throws(()=>config({...f.env,RECALL_WORKSPACE_ID:'another-workspace'}),/workspace_mismatch/);assert.throws(()=>config({...f.env,RECALL_REGION:'us-east-1'}),/workspace_mismatch/);
 for(const url of ['http://meet.google.com/abc-defg-hij','https://meet.google.com.evil.test/abc-defg-hij','https://user@zoom.us/j/123','https://127.0.0.1/j/123','https://zoom.us.evil.test/j/123'])assert.throws(()=>meetingURL(url));
 assert.equal(meetingURL('https://us02web.zoom.us/j/123456789?pwd=secret'),'https://us02web.zoom.us/j/123456789?pwd=secret');
 await assert.rejects(f.service.submit(OWNER,PHONE,{...f.input(),consent:false}),/recording_consent/);assert.equal(creates(f).length,0);
});
test('private operator test needs explicit consent and resolves the existing owner link',async()=>{
 const f=await recallFixture();await assert.rejects(recallJob(f.env,{type:'recall_operator_test',confirmed:false,meetingRequest:f.input()}),/recording_consent_required/);
 const input=f.input();await recallJob(f.env,{type:'recall_operator_test',confirmed:true,meetingRequest:input});await recallJob(f.env,{type:'recall_operator_test',confirmed:true,meetingRequest:input});await f.drain();
 assert.equal(creates(f).length,1);const row=f.db.sql.prepare('SELECT owner,phone FROM brivany_meetings').get();assert.equal(row.owner,OWNER);assert.equal(row.phone,PHONE);
});
test('authenticated real app route persists intent, deduplicates requests and isolates users',async()=>{
 const f=await recallFixture();await withFixtureFetch(f,async()=>{
  assert.equal((await f.invoke('',undefined,'bad-token')).status,401);
  const input=f.input(),first=await f.invoke('',input),m=(await first.json()).meeting;assert.equal(first.status,202);assert.equal(creates(f).length,0);
  assert.equal((await(await f.invoke('',input)).json()).meeting.id,m.id);
  assert.equal((await f.invoke('',{...input,meetingUrl:'https://zoom.us/j/123'})).status,409);
  assert.equal((await f.invoke('/detail?id='+m.id,undefined,'synthetic-other')).status,404);
  assert.equal((await(await f.invoke('',undefined,'synthetic-other')).json()).meetings.length,0);
  await f.drain();assert.equal(creates(f).length,1);assert.equal((await f.store.get(m.id)).bot_id,BOT);assert.equal(creates(f)[0].body.join_at,null);assert.equal(creates(f)[0].body.metadata.brivany_workspace,WORKSPACE_ID);
  const camera=creates(f)[0].body.automatic_video_output;assert.equal(camera.in_call_recording.kind,'jpeg');assert.equal(camera.in_call_not_recording.b64_data,camera.in_call_recording.b64_data);const jpeg=Buffer.from(camera.in_call_recording.b64_data,'base64');assert.deepEqual([...jpeg.subarray(0,2)],[255,216]);assert.ok(jpeg.length<1300000);assert.equal(creates(f)[0].body.output_media,undefined);
 });
});
test('signed lifecycle to encrypted persistent transcript; duplicate delivery has no duplicate paid work',async()=>{
 const f=await recallFixture(),m=await f.service.submit(OWNER,PHONE,f.input());await f.drain();
 for(const event of ['bot.joining_call','bot.in_waiting_room','bot.in_call_recording','recording.done']){await f.service.acceptWebhook(f.signed(event));await f.drain();}
 assert.equal(transcriptCreates(f).length,1);assert.equal((await f.store.get(m.id)).transcript_state,'processing');
 await f.service.processMeeting(m.id);assert.equal(f.calls.filter(c=>c.url.includes('/transcript/')).length,0,'no progress polling before transcript.done');
 const id='msg_duplicate';await f.service.acceptWebhook(f.signed('transcript.done',{id}));await f.drain();await f.service.acceptWebhook(f.signed('transcript.done',{id}));await f.drain();
 const row=await f.store.get(m.id);assert.equal(row.status,'ready');assert.equal(row.next_at,0);assert.equal(transcriptCreates(f).length,1);
 const output=f.db.sql.prepare('SELECT * FROM brivany_meeting_outputs').get();assert.doesNotMatch(JSON.stringify(output),/Acuerdo sintético|Participante sintético/);
 assert.doesNotMatch(JSON.stringify(row),/meet.google.com|Reunión sintética/);
 await withFixtureFetch(f,async()=>{const restarted=createMeetingService(f.env);const response=await restarted.route(new Request('https://ia.vetsa.es/agents/meetings/detail?id='+m.id),OWNER,PHONE);const data=await response.json();assert.equal(data.transcript[0].text,'Acuerdo sintético de la reunión.');});
 const download=f.calls.find(c=>c.url.includes('amazonaws'));assert.equal(download.headers,undefined,'presigned download never receives Recall key');
});
test('tampered, stale and malformed signatures cannot store or enqueue a payload',async()=>{
 const f=await recallFixture();for(const request of [f.signed('bot.done',{signature:'v1,YmFk'}),f.signed('bot.done',{at:f.now()-600000})]){assert.equal((await recallWebhook(request,f.env)).status,401);}
 assert.equal(f.db.sql.prepare('SELECT count(*) n FROM brivany_meeting_inbox').get().n,0);assert.equal(f.queue.length,0);
 const valid=f.signed('bot.done');valid.headers.set('webhook-signature','v1,invalid '+valid.headers.get('webhook-signature'));assert.ok(await verifyWebhook(valid,f.env.RECALL_WEBHOOK_VERIFICATION_SECRET,f.now()));
});
test('429 obeys Retry-After with jitter in durable scheduling',async()=>{
 const f=await recallFixture();f.failCreate(429);const m=await f.service.submit(OWNER,PHONE,f.input());await f.drain();let row=await f.store.get(m.id);assert.equal(row.status,'queued');assert.ok(row.next_at>=f.now()+12000);
 await f.service.tick();await f.drain();assert.equal(creates(f).length,1);f.advance(15000);await f.service.tick();await f.drain();assert.equal(creates(f).length,2);assert.equal((await f.store.get(m.id)).bot_id,BOT);
 assert.ok(retryDelay(new Headers({'Retry-After':'3600'}),0,f.now(),()=>0)>=3600);
});
test('lost create response reconciles metadata and never blindly POSTs a second bot',async()=>{
 const f=await recallFixture();f.failCreate('lost');const m=await f.service.submit(OWNER,PHONE,f.input());await f.drain();assert.equal((await f.store.get(m.id)).status,'uncertain');f.advance(31000);await f.service.tick();await f.drain();assert.equal((await f.store.get(m.id)).bot_id,BOT);assert.equal(creates(f).length,1);
});
test('503 and 507 back off, reconcile absence and keep uncertain work from duplicating',async()=>{
 for(const status of [503,507]){const f=await recallFixture();f.failCreate(status);const m=await f.service.submit(OWNER,PHONE,f.input());await f.drain();assert.equal((await f.store.get(m.id)).status,'uncertain');f.advance(61000);await f.service.tick();await f.drain();assert.equal(creates(f).length,1);assert.equal((await f.store.get(m.id)).status,'uncertain');}
});
test('calendar read does not record; explicit selection uses server-owned URL and time',async()=>{
 const f=await recallFixture();await withFixtureFetch(f,async()=>{
  const read=await(await f.invoke('/calendar')).json();assert.equal(read.events[0].selected,false);assert.equal(creates(f).length,0);
  const response=await f.invoke('/schedule',{requestId:crypto.randomUUID(),eventId:'event-1',consent:true});assert.equal(response.status,202);await f.drain();assert.equal(creates(f).length,1);assert.equal(creates(f)[0].body.join_at,f.events.get('event-1').start.dateTime);
  assert.equal((await(await f.invoke('/calendar')).json()).events[0].selected,true);
 });
});
test('calendar edits PATCH one existing bot; deletion cancels it and cannot create another',async()=>{
 const f=await recallFixture();await withFixtureFetch(f,async()=>{
  const m=(await(await f.invoke('/schedule',{requestId:crypto.randomUUID(),eventId:'event-1',consent:true})).json()).meeting;await f.drain();
  f.events.get('event-1').start.dateTime=new Date(f.now()+7200000).toISOString();f.advance(61000);await f.service.tick();await f.drain();assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);assert.equal(creates(f).length,1);
  f.events.delete('event-1');f.advance(61000);await f.service.tick();await f.drain();assert.equal((await f.store.get(m.id)).status,'cancelled');assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
 });
});
test('past, cancelled, all-day and missing-URL events are ineligible; opt-out before send prevents create',async()=>{
 const f=await recallFixture();assert.equal(eligibleEvent({startAt:new Date(f.now()-1).toISOString(),meetingUrl:URL},f.now()),false);assert.equal(eligibleEvent({startAt:new Date(f.now()+3600000).toISOString(),allDay:true,meetingUrl:URL},f.now()),false);
 await withFixtureFetch(f,async()=>{
  f.events.get('event-1').hangoutLink=null;assert.equal((await f.invoke('/schedule',{requestId:crypto.randomUUID(),eventId:'event-1',consent:true})).status,400);
  f.events.get('event-1').hangoutLink=URL;f.events.get('event-1').status='cancelled';assert.equal((await f.invoke('/schedule',{requestId:crypto.randomUUID(),eventId:'event-1',consent:true})).status,400);
 });
 const m=await f.service.submit(OWNER,PHONE,f.input());await f.service.cancel(OWNER,m.id);await f.drain();assert.equal(creates(f).length,0);assert.equal((await f.store.get(m.id)).status,'cancelled');
});
test('parallel consumers, outbox recovery and out-of-order bot state are safe',async()=>{
 const f=await recallFixture();f.failQueue(true);await assert.rejects(f.service.submit(OWNER,PHONE,f.input()));assert.equal(f.db.sql.prepare('SELECT count(*) n FROM brivany_meetings').get().n,1);f.failQueue(false);await f.service.tick();const id=f.queue[0].id;await Promise.all([f.service.processMeeting(id),f.service.processMeeting(id)]);assert.equal(creates(f).length,1);await f.drain();
 await f.service.acceptWebhook(f.signed('bot.in_call_recording'));await f.drain();await f.service.acceptWebhook(f.signed('bot.in_waiting_room',{at:f.now()-1000}));await f.drain();assert.equal((await f.store.get(id)).status,'recording');
});
test('failed transcription is surfaced and signed events for unknown resources are ignored',async()=>{
 const f=await recallFixture(),m=await f.service.submit(OWNER,PHONE,f.input());await f.drain();await f.service.acceptWebhook(f.signed('transcript.failed'));await f.drain();assert.equal((await f.store.get(m.id)).status,'failed');assert.equal(transcriptCreates(f).length,0);
 await f.service.acceptWebhook(f.signed('bot.done',{id:'msg_unknown',data:{bot:{id:crypto.randomUUID()}}}));await f.drain();assert.equal(f.db.sql.prepare('SELECT status FROM brivany_meeting_inbox WHERE id=?').get('msg_unknown').status,'ignored');
});
