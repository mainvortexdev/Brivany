import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ARTIFACT_SCHEMA } from '../melodi-artifact-tracking.js';
import { PERMISSIONS_SCHEMA } from '../melodi-permissions.js';
import { runApprovedSingleStories } from '../story-campaign.js';

function fixture({ feature = 'true', schemas = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE wa_story_single_drafts(id TEXT PRIMARY KEY,owner_phone TEXT,operation_id TEXT,object_key TEXT,mime_type TEXT,
    scheduled_at TEXT,status TEXT,preview_sent_at TEXT,approved_at TEXT,updated_at TEXT,error_code TEXT);
    CREATE TABLE wa_story_publish_settings(owner_phone TEXT PRIMARY KEY,auto_publish INTEGER);`);
  if (schemas) sql.exec(`${ARTIFACT_SCHEMA.join(';')};${PERMISSIONS_SCHEMA.join(';')};`);
  const actions = [];
  const env = {
    TEAM_AUTONOMY_ENABLED: feature, INSTAGRAM_INTERNAL_TOKEN: 'test-internal-token',
    VETSA_CLOUD: { prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) || null; },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; },
    }; } }; } },
    VETSA_INSTAGRAM_OPERATIONS: { async fetch(request) {
      const body = await request.json(); actions.push(body);
      if (body.action === 'operation_status') return Response.json({ operation: null });
      if (body.action === 'prepare_story') return Response.json({ operation: { id: body.operationId, status: 'draft' } });
      return Response.json({ operation: { id: body.operationId, status: 'approved' } });
    } },
  };
  function story({ id = 'auto-private-story', level = 3, tracked = schemas, approved = false, auto = true, previewed = true, agent = 'melodi' } = {}) {
    sql.prepare('INSERT OR REPLACE INTO wa_story_publish_settings(owner_phone,auto_publish) VALUES(?,?)').run('owner-a', Number(auto));
    sql.prepare(`INSERT INTO wa_story_single_drafts(id,owner_phone,operation_id,object_key,mime_type,scheduled_at,status,preview_sent_at,approved_at)
      VALUES(?,?,?,?,?,?,'ready',?,?)`).run(id, 'owner-a', id, 'private/story.png', 'image/png', '2026-01-01T12:00:00Z',
    previewed ? '2026-01-01T11:00:00Z' : null, approved ? '2026-01-01T11:30:00Z' : null);
    if (tracked) {
      sql.prepare('INSERT OR REPLACE INTO wa_melodi_levels(owner_phone,agent,level,xp,created_at,updated_at) VALUES(?,?,?,0,1,1)').run('owner-a', agent, level);
      sql.prepare(`INSERT INTO wa_melodi_artifact_tracking(job_id,owner,agent,job_type,status,created_at,updated_at)
        VALUES(?,?,?,'generate_story','delivered',1,1)`).run(id, 'owner-a', agent);
    }
  }
  return { env, sql, actions, story };
}

test('a low-level autonomous story cannot publish from stored automatic preference alone', async () => {
  const context = fixture(); context.story({ level: 3 });
  await runApprovedSingleStories(context.env);
  assert.deepEqual(context.actions, []);
  assert.equal(context.sql.prepare('SELECT status FROM wa_story_single_drafts').get().status, 'ready');
});

test('an autonomous story may publish automatically only at level five with a stored owner grant', async () => {
  const context = fixture(); context.story({ level: 5 });
  await runApprovedSingleStories(context.env);
  assert.deepEqual(context.actions.map(item => item.action), ['operation_status', 'prepare_story', 'approve_operation']);
  assert.equal(context.sql.prepare('SELECT status FROM wa_story_single_drafts').get().status, 'publishing');
  const noGrant = fixture(); noGrant.story({ level: 10, auto: false });
  await runApprovedSingleStories(noGrant.env);
  assert.deepEqual(noGrant.actions, []);
});

test('the owner explicit approval of this preview permits publication at a lower agent level', async () => {
  const context = fixture(); context.story({ level: 1, approved: true, auto: false });
  await runApprovedSingleStories(context.env);
  assert.equal(context.actions.some(item => item.action === 'approve_operation'), true);
});

test('ordinary manual drafts keep their existing publication preference', async () => {
  const context = fixture(); context.story({ id: 'manual-story-1', tracked: false });
  await runApprovedSingleStories(context.env);
  assert.equal(context.actions.some(item => item.action === 'approve_operation'), true);
});

test('untracked autonomous IDs and unpreviewed stories fail closed', async () => {
  const context = fixture(); context.story({ tracked: false });
  await runApprovedSingleStories(context.env);
  assert.deepEqual(context.actions, []);
  const noPreview = fixture(); noPreview.story({ level: 5, approved: true, previewed: false });
  await runApprovedSingleStories(noPreview.env);
  assert.deepEqual(noPreview.actions, []);
});

test('missing hierarchy tables do not throw and preserve manual drafts while blocking autonomous auto-publication', async () => {
  const context = fixture({ schemas: false }); context.story({ id: 'auto-untracked', tracked: false });
  context.story({ id: 'manual-existing', tracked: false });
  await runApprovedSingleStories(context.env);
  assert.equal(context.actions[0].operationId, 'manual-existing');
  assert.equal(context.sql.prepare("SELECT status FROM wa_story_single_drafts WHERE id='auto-untracked'").get().status, 'ready');
});

test('a disabled autonomy feature uses legacy tables without requiring hierarchy migrations', async () => {
  const context = fixture({ schemas: false, feature: 'false' }); context.story({ id: 'manual-legacy', tracked: false });
  await runApprovedSingleStories(context.env);
  assert.equal(context.actions.some(item => item.action === 'approve_operation'), true);
});

test('a blocked autonomous draft cannot starve a later eligible manual draft', async () => {
  const context = fixture(); context.story({ level: 2 }); context.story({ id: 'manual-next', tracked: false });
  await runApprovedSingleStories(context.env);
  assert.equal(context.actions[0].operationId, 'manual-next');
});
