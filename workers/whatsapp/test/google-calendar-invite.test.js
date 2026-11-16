import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ensureGoogleCalendarInvite } from '../worker.js';
import { createGoogleCalendarStore } from '../google-calendar-store.js';
import { createAgentRuntime } from '../melodi-autonomy.js';
import { googleCalendarInviteAuthority, googleCalendarInviteKey } from '../google-calendar-invite.js';
import { calendarHash } from '../google-calendar-store.js';
import { ARTIFACT_SCHEMA } from '../melodi-artifact-tracking.js';
import { ROUTINE_SCHEMA } from '../melodi-routines.js';
class D1 {
  constructor(){this.sql=new DatabaseSync(':memory:');for(const file of ['schema.sql','melodi-team-coordination.sql','melodi-autonomy.sql','melodi-permissions.sql'])this.sql.exec(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'));}
  prepare(sql){const db=this;const make=values=>({sql,values,bind:(...values)=>make(values),async run(){const stmt=db.sql.prepare(sql);return stmt.columns().length ? {results:stmt.all(...values),meta:{changes:Number(db.sql.prepare('SELECT changes() AS n').get().n)}} : {meta:{changes:Number(stmt.run(...values).changes)}};},async all(){return {results:db.sql.prepare(sql).all(...values)};},async first(){return db.sql.prepare(sql).get(...values) || null;}});return make([]);}
  async batch(statements){this.sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
function fixture(){const queue=[];const env={VETSA_CLOUD:new D1(),MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64'),GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'not-real',OWNER_WHATSAPP_NUMBER:'18495205246',GOOGLE_CALENDAR_INVITE_REV:'test-invite',MELODI_JOBS:{async send(message){queue.push(message);}}};return {env,queue};}
test('configured installation durably queues one personal invitation and preserves it on repeated ticks',async()=>{
  const {env,queue}=fixture();await ensureGoogleCalendarInvite(env);await ensureGoogleCalendarInvite(env);
  assert.equal(queue.length,1);assert.equal(queue[0].type,'autonomy_outbox');
  const records=env.VETSA_CLOUD.sql.prepare('SELECT owner,agent,status,payload_encrypted FROM wa_melodi_work_outbox').all();
  assert.equal(records.length,1);assert.equal(records[0].owner,env.OWNER_WHATSAPP_NUMBER);assert.equal(records[0].agent,'melodi');
  assert.equal(records[0].status,'pending');assert.ok(!records[0].payload_encrypted.includes('/oauth/google/start'));
  assert.equal(env.VETSA_CLOUD.sql.prepare('SELECT COUNT(*) AS count FROM google_calendar_oauth').get().count,1);
});
test('unconfigured installation and already linked account do not queue an invitation',async()=>{
  const {env,queue}=fixture();await ensureGoogleCalendarInvite({...env,GOOGLE_CLIENT_SECRET:undefined});assert.equal(queue.length,0);
  const store=createGoogleCalendarStore(env);await store.ensureSchema();await store.putConnection(env.OWNER_WHATSAPP_NUMBER,{status:'connected',calendarId:'calendar'});
  await ensureGoogleCalendarInvite(env);assert.equal(queue.length,0);
});
test('the requested invitation reaches WhatsApp with a fresh link while Melodi owns the conversation',async()=>{
  const {env}=fixture();env.TEAM_AUTONOMY_ENABLED='true';
  env.VETSA_CLOUD.sql.exec([...ARTIFACT_SCHEMA,...ROUTINE_SCHEMA].join(';'));
  await ensureGoogleCalendarInvite(env);
  env.VETSA_CLOUD.sql.prepare(`UPDATE wa_melodi_coordination SET focus_agent='melodi',conversation_agent='melodi',conversation_until=? WHERE owner_phone=?`)
    .run(new Date(Date.now()+3600000).toISOString(),env.OWNER_WHATSAPP_NUMBER);
  env.VETSA_CLOUD.sql.prepare('UPDATE google_calendar_oauth SET expires_at=?').run(Date.now()-1000);
  const sent=[];const runtime=createAgentRuntime(env,{sendText:async(_env,to,body)=>sent.push({to,body}),services:{emailOwner:async()=>{throw Error('Must use WhatsApp');}}});
  await runtime.deliverOutbox();
  assert.equal(env.VETSA_CLOUD.sql.prepare('SELECT status,error_code FROM wa_melodi_work_outbox').get().status,'sent',JSON.stringify(env.VETSA_CLOUD.sql.prepare('SELECT status,error_code FROM wa_melodi_work_outbox').get()));
  assert.equal(sent.length,1);assert.equal(sent[0].to,env.OWNER_WHATSAPP_NUMBER);assert.match(sent[0].body,/^Preparé Google Calendar/);
  assert.doesNotMatch(sent[0].body,/^(Melodi|Melodi):/);
  const url=new URL(sent[0].body.match(/https:\/\/ia\.vetsa\.es\/oauth\/google\/start\?link=[a-f0-9]+/)[0]);
  const fresh=await createGoogleCalendarStore(env).peekNonce(url.searchParams.get('link'),'link');assert.equal(fresh.agent,'melodi');
  assert.equal(env.VETSA_CLOUD.sql.prepare('SELECT status FROM wa_melodi_work_outbox').get().status,'sent');
  assert.equal(env.VETSA_CLOUD.sql.prepare('SELECT focus_agent FROM wa_melodi_coordination').get().focus_agent,'melodi');
});
test('model-supplied ownerRequested flags cannot impersonate a trusted calendar invitation',async()=>{
  const {env}=fixture();const row={owner:env.OWNER_WHATSAPP_NUMBER,agent:'melodi',payload:{ownerRequested:true},message_key:await calendarHash('fake-invitation')};
  assert.equal(await googleCalendarInviteAuthority(env,row),false);row.message_key=await calendarHash(googleCalendarInviteKey(env));
  assert.equal(await googleCalendarInviteAuthority(env,row),true);row.agent='melodi';assert.equal(await googleCalendarInviteAuthority(env,row),false);
});

test('a pending invitation is cancelled if the owner linked Google before WhatsApp delivery',async()=>{
  const {env}=fixture();env.TEAM_AUTONOMY_ENABLED='true';env.VETSA_CLOUD.sql.exec([...ARTIFACT_SCHEMA,...ROUTINE_SCHEMA].join(';'));
  await ensureGoogleCalendarInvite(env);
  const calendar=createGoogleCalendarStore(env);await calendar.putConnection(env.OWNER_WHATSAPP_NUMBER,{status:'connected',calendarId:'manual-calendar'});
  const count=env.VETSA_CLOUD.sql.prepare('SELECT COUNT(*) AS n FROM google_calendar_oauth').get().n;
  const runtime=createAgentRuntime(env,{sendText:async()=>assert.fail('Already connected owner must not receive another link'),
    services:{emailOwner:async()=>assert.fail('Already connected owner must not receive an email invitation')}});
  await runtime.deliverOutbox();const row=env.VETSA_CLOUD.sql.prepare('SELECT status,error_code FROM wa_melodi_work_outbox').get();
  assert.equal(row.status,'failed');assert.equal(row.error_code,'calendar_already_connected');
  assert.equal(env.VETSA_CLOUD.sql.prepare('SELECT COUNT(*) AS n FROM google_calendar_oauth').get().n,count);
});
