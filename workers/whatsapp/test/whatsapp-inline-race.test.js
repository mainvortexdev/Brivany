import test from 'node:test';
import assert from 'node:assert/strict';
import { FinanceD1 } from './finance-fixture.js';
import { ownerAutonomyServices } from '../owner-features.js';
import { processWhatsAppEnvelope, runWhatsAppAction } from '../whatsapp-request-scope.js';

test('inline webhook work and its durable Queue copy cannot execute or answer twice', async () => {
  const db = new FinanceD1();
  db.sql.exec('CREATE TABLE wa_messages(message_id TEXT PRIMARY KEY,received_at TEXT NOT NULL)');
  const env = {
    VETSA_CLOUD: db, TEAM_CONVERSATION_LEADER: 'melodi', WHATSAPP_PHONE_NUMBER_ID: 'business',
    MEMORY_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
  };
  const payload = { entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'business' }, messages: [{
      id: 'wamid-inline-and-queue', from: '18095550101', type: 'text',
      text: { body: 'Recuérdame mañana a las 7:10 a.m imprimir el documento de Helibert' },
    }],
  } }] }] };
  const services = ownerAutonomyServices(env), sent = [];
  const raw = async (_env, phone, body) => {
    sent.push({ phone, body });
    return { status: 'sent', messageId: `meta-${sent.length}` };
  };
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let calls = 0, reminders = 0;
  const handler = async scoped => {
    calls++;
    await runWhatsAppAction(scoped, 'calendar_create', async () => {
      reminders++;
      enter();
      await blocked;
      return { id: 'one-durable-calendar-event', status: 'scheduled' };
    });
    await scoped.WHATSAPP_PROCESSING_SCOPE.reply('18095550101', 'Vale, Daniel, te recordaré imprimir el documento de Helibert.', { agent: 'melodi' });
  };
  const inline = processWhatsAppEnvelope(env, payload, handler, raw, services);
  try {
    await entered;
    const concurrentQueue = await processWhatsAppEnvelope(env, payload, handler, raw, services);
    assert.equal(concurrentQueue.status, 'busy');
    assert.equal(concurrentQueue.retry, true);
    assert.ok(concurrentQueue.retryAfterMs > 0);
    assert.equal(reminders, 1);
    assert.equal(calls, 1);
    assert.equal(sent.length, 0);
  } finally { release(); }
  assert.equal((await inline).status, 'done');
  assert.equal((await processWhatsAppEnvelope(env, payload, handler, raw, services)).status, 'done');
  assert.equal(reminders, 1);
  assert.equal(calls, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].phone, '18095550101');
  assert.equal('WHATSAPP_PROCESSING_SCOPE' in env, false);
});
