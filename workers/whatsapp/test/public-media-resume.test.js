import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AUTONOMY_SCHEMA } from '../melodi-autonomy-store.js';
import { autonomousArtifactJobId } from '../melodi-artifact-tracking.js';
import { resumeRequestedMedia } from '../public-media-resume.js';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  for (const query of AUTONOMY_SCHEMA) sql.exec(query);
  for (const file of ['melodi-artifact-tracking.sql', 'melodi-permissions.sql']) sql.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  sql.exec('CREATE TABLE wa_owner_jobs (id TEXT PRIMARY KEY,owner_phone TEXT)');
  const make = (query, values = []) => ({ query, values, bind: (...values) => make(query, values),
    async first() { return sql.prepare(query).get(...values) || null; },
    async run() { const result = sql.prepare(query).run(...values); return { meta: { changes: Number(result.changes) } }; } });
  const db = { prepare: query => make(query), async batch(statements) { sql.exec('BEGIN'); try {
    const outputs = statements.map(({ query, values }) => { const prepared = sql.prepare(query); return prepared.columns().length ? { results: prepared.all(...values) } : { meta: prepared.run(...values) }; });
    sql.exec('COMMIT'); return outputs;
  } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  const owner = '18495205246', eventId = 'original-melodi-event';
  for (const agent of ['melodi']) sql.prepare('INSERT INTO wa_melodi_levels(owner_phone,agent,level,created_at,updated_at) VALUES (?,?,3,1,1)').run(owner, agent);
  const payload = { request: { agent: 'melodi', origin: 'owner_request', recipient: 'owner', channel: 'email', sourceUrl: 'https://www.instagram.com/p/EXACT/?original=yes' } };
  sql.prepare(`INSERT INTO wa_melodi_work_state(owner,agent,enabled,budget_day,created_at,updated_at) VALUES (?,'melodi',1,'2026-10-08',1,1)`).run(owner);
  sql.prepare(`INSERT INTO wa_melodi_work_events(id,owner,agent,event_key,type,payload_encrypted,payload_iv,status,priority,available_at,created_at,updated_at,error_code)
    VALUES (?,?,'melodi','same-owner-message','owner_research_report','sealed-original','iv-original','done',20,1,1,1,'requested_research_formats_not_verified')`).run(eventId, owner);
  return { sql, db, owner, eventId, payload, async decrypt() { return payload; }, now: 1000 };
}

test('activation resumes the authorized original email request once, preserving assignment and ciphertext', async () => {
  const f = fixture(), before = f.sql.prepare('SELECT * FROM wa_melodi_work_events').get();
  assert.deepEqual({ ...(await resumeRequestedMedia(f)) }, { id: f.eventId, agent: 'melodi' });
  const after = f.sql.prepare('SELECT * FROM wa_melodi_work_events').get();
  for (const key of ['id', 'agent', 'event_key', 'created_at', 'payload_encrypted', 'payload_iv']) assert.equal(after[key], before[key]);
  assert.equal(after.status, 'pending'); assert.equal(after.error_code, null); assert.equal(after.attempts, 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_work_audit WHERE action='media_activation_resume'").get().n, 1);
  assert.equal(await resumeRequestedMedia(f), null);
  f.sql.prepare("UPDATE wa_melodi_work_events SET status='done',error_code='requested_research_formats_not_verified'").run();
  assert.equal(await resumeRequestedMedia(f), null);
});

test('activation cannot replay completed artifacts, active execution, waiting approvals, unsent outbox or foreign scope', async () => {
  for (const mode of ['job', 'lease', 'approval', 'outbox', 'foreign', 'channel', 'unreadable']) {
    const f = fixture();
    if (mode === 'job') f.sql.prepare('INSERT INTO wa_owner_jobs VALUES (?,?)').run(await autonomousArtifactJobId(f.owner, 'generate_document', `requested-research:${f.eventId}:document`), f.owner);
    if (mode === 'lease') f.sql.prepare("UPDATE wa_melodi_work_events SET lease_token='busy'").run();
    if (mode === 'approval') f.sql.prepare(`INSERT INTO wa_melodi_permission_requests(id,owner_phone,requester,helper,event_key,tool,required_level,goal_scope,parent_event_id,input_encrypted,input_iv,requester_revision,helper_revision,status,created_at,updated_at,expires_at)
      VALUES ('approval',?,'melodi','melodi','key','prepare_document',2,'team',?,'sealed','iv',0,0,'pending',1,1,5000)`).run(f.owner, f.eventId);
    if (mode === 'outbox') f.sql.prepare(`INSERT INTO wa_melodi_work_outbox(id,owner,agent,message_key,event_id,payload_encrypted,payload_iv,available_at,created_at,updated_at)
      VALUES ('outbox',?,'melodi','key',?,'sealed','iv',1,1,1)`).run(f.owner, f.eventId);
    if (mode === 'foreign') f.owner = '11111111111';
    if (mode === 'channel') f.payload.request.channel = 'whatsapp';
    if (mode === 'unreadable') f.decrypt = async () => { throw new Error('cipher invalid'); };
    assert.equal(await resumeRequestedMedia(f), null, mode);
    assert.equal(f.sql.prepare('SELECT status FROM wa_melodi_work_events').get().status, 'done', mode);
  }
});
