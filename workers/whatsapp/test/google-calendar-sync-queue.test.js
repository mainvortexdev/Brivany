import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { createGoogleCalendarStore } from '../google-calendar-store.js';
import { syncGoogleCalendar } from '../google-calendar-sync.js';
import { processGoogleCalendarSync, requestGoogleCalendarSync } from '../google-calendar-sync-queue.js';

const OWNER = '18095550101', NOW = Date.parse('2026-10-21T20:00:00Z');
async function fixture() {
  const db = new FinanceD1(), messages = [], inserts = [];
  db.sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER: OWNER, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    MEMORY_ENCRYPTION_KEY: 'calendar-queue-test-only-key', MELODI_JOBS: { async send(value) { messages.push(value); } } };
  const store = createGoogleCalendarStore(env, { now: () => NOW });
  await store.ensureSchema();
  await store.putConnection(OWNER, { status: 'connected', calendarId: 'connected-secondary-calendar', syncToken: 'before' });
  const add = (id, title = 'Imprimir el documento de Helibert', phone = OWNER) => db.sql.prepare(`INSERT INTO melodi_calendar_events
    (id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,'REMINDER','melodi',?,?)`)
    .run(id, phone, title, '2026-10-22T11:10:00Z', new Date(NOW).toISOString(), new Date(NOW).toISOString());
  const client = {
    async listEvents(calendarId) { assert.equal(calendarId, 'connected-secondary-calendar'); return { items: [], nextSyncToken: 'after' }; },
    async insertEvent(calendarId, event) { assert.equal(calendarId, 'connected-secondary-calendar'); inserts.push(event); return { ...event, etag: '"inserted"' }; },
  };
  const sync = scoped => syncGoogleCalendar(scoped, { store, client, now: () => NOW });
  const request = () => requestGoogleCalendarSync(env, { now: NOW });
  const process = (body = messages[0]) => processGoogleCalendarSync(env, body, { sync, now: NOW });
  return { db, env, store, add, messages, inserts, sync, request, process, client };
}

test('concurrent schedule changes coalesce to one queue job and synchronize the persisted owner sources', async () => {
  const h = await fixture(); h.add('requested'); h.add('foreign', 'PRIVATE_OTHER_OWNER', '18095559999');
  const results = await Promise.all([h.request(), h.request(), h.request()]);
  assert.equal(results.filter(row => row.status === 'queued').length, 1);
  assert.equal(h.messages.length, 1);
  assert.deepEqual(Object.keys(h.messages[0]).sort(), ['owner', 'token', 'type']);
  assert.equal(h.messages[0].type, 'calendar_sync');
  assert.equal((await h.process()).retry, false);
  assert.equal(h.inserts.length, 1); assert.match(h.inserts[0].summary, /Helibert/);
  assert.doesNotMatch(JSON.stringify(h.inserts), /PRIVATE_OTHER_OWNER/);
  assert.equal((await h.store.listMappings(OWNER))[0].source_id, 'requested');
  assert.equal((await h.process()).status, 'superseded'); assert.equal(h.inserts.length, 1);
});

test('a cron-held connection lease asks the consumer to retry rather than lose the immediate request', async () => {
  const h = await fixture(); h.add('requested'); await h.request();
  const lease = await h.store.acquireLease(OWNER);
  const busy = await h.process(); assert.equal(busy.status, 'busy'); assert.equal(busy.retry, true); assert.equal(busy.retryDelaySeconds, 5);
  assert.equal(h.inserts.length, 0);
  await h.store.releaseLease(OWNER, lease);
  assert.equal((await h.process()).status, 'synced'); assert.equal(h.inserts.length, 1);
});

test('a source persisted during sync survives coalescing and is read on the next consumer attempt', async () => {
  const h = await fixture(); h.add('first'); await h.request();
  const insert = h.client.insertEvent;
  let added = false;
  h.client.insertEvent = async (...args) => {
    if (!added) { added = true; h.add('second', 'Entrenar boxeo'); assert.equal((await h.request()).status, 'coalesced'); }
    return insert(...args);
  };
  assert.equal((await h.process()).retry, true); assert.equal(h.inserts.length, 1);
  assert.equal(h.messages.length, 1);
  assert.equal((await h.process()).retry, false); assert.equal(h.inserts.length, 2);
  assert.deepEqual((await h.store.listMappings(OWNER)).map(row => row.source_id).sort(), ['first', 'second']);
});

test('a failed queue dispatch leaves dirty state and a later request can claim it immediately', async () => {
  const h = await fixture(); h.add('requested');
  const send = h.env.MELODI_JOBS.send; h.env.MELODI_JOBS.send = async () => { throw Error('synthetic_queue_failure'); };
  await assert.rejects(h.request(), /synthetic_queue_failure/);
  assert.equal(h.db.sql.prepare('SELECT dispatch_token FROM google_calendar_sync_requests').get().dispatch_token, null);
  h.env.MELODI_JOBS.send = send; assert.equal((await h.request()).status, 'queued');
  assert.equal((await h.process()).status, 'synced');
});

test('an expired dispatch is replaced safely and a foreign owner cannot cause a synchronization', async () => {
  const h = await fixture(); h.add('requested'); await h.request();
  await requestGoogleCalendarSync(h.env, { now: NOW + 120001 });
  assert.equal(h.messages.length, 2);
  assert.equal((await h.process(h.messages[0])).status, 'superseded');
  await assert.rejects(requestGoogleCalendarSync(h.env, { owner: '18095559999' }), /invalid_calendar_sync_owner/);
  await assert.rejects(h.process({ ...h.messages[1], owner: '18095559999' }), /invalid_calendar_sync_owner/);
  assert.equal((await h.process(h.messages[1])).status, 'synced'); assert.equal(h.inserts.length, 1);
});

test('missing configuration and a disconnected account do not invent a sync or a new calendar', async () => {
  assert.equal((await requestGoogleCalendarSync({})).status, 'unconfigured');
  const h = await fixture(); await h.store.disconnect(OWNER);
  assert.equal((await h.request()).status, 'disconnected'); assert.equal(h.messages.length, 0);
});
