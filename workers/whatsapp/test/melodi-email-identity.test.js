import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { agentEmailIdentity, agentForEmail, literalEmailSender, ownerEmailBodyContinuation, AGENT_EMAIL_SENDERS, documentAcceptedReply } from '../melodi-email-identity.js';
import { ownerAutonomyServices, ownerExecutorServices, sendOwnerEmail } from '../owner-features.js';
import { send_email, continueEmailDelivery } from '../executors/email.js';
import { job_send_email, job_prepare_direct_email_attachment } from '../executors/jobs/email.js';
import { createDeliveryNotices } from '../delivery-notice.js';

const agents = ['melodi'];
test('accepted documents confirm the actual destination and delivery time without internal author names', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-21T20:00:00Z') });
  assert.equal(documentAcceptedReply({ agent: 'melodi' }), 'Vale, prepararé el PDF y te lo compartiré por aquí en cuanto termine.');
  for (const agent of agents) {
    const response = documentAcceptedReply({ agent, format: 'docx', deliveryAt: '2026-10-22T13:00:00Z', emailDelivery: { to: 'owner@example.com' } });
    assert.match(response, /documento Word.*owner@example.com.*mañana a las 9:00 a\. m\./);
    assert.match(response, /La entrega quedó en el calendario/);
    assert.doesNotMatch(response, /Melodi|Melodi|Melodi|Melodi|Melodi|2026|redactará/);
  }
  assert.throws(() => documentAcceptedReply({ agent: 'unknown' }), /email_unknown_agent/);
});
function emailHarness() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE wa_owner_email_messages(id TEXT PRIMARY KEY,owner_phone TEXT,direction TEXT,mailbox_hash TEXT,
    encrypted_payload TEXT,payload_iv TEXT,status TEXT,related_job_id TEXT,received_at TEXT,created_at TEXT,provider_message_id TEXT,sent_at TEXT,UNIQUE(owner_phone,direction,related_job_id))`);
  const db = { prepare(query) {
    const execute = values => {
      const statement = sql.prepare(query);
      return statement.columns().length ? { results: statement.all(...values).map(row => ({ ...row })) }
        : { results: [], meta: { changes: Number(statement.run(...values).changes) } };
    };
    const bound = values => ({ bind: (...next) => bound(next), first: async () => execute(values).results[0] ?? null,
      all: async () => execute(values), run: async () => execute(values) });
    return bound([]);
  }, async batch(statements) { return Promise.all(statements.map(statement => statement.run())); } };
  return { sql, env: { VETSA_CLOUD: db, MEMORY_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64'),
    BREVO_API_KEY: 'test-key-only', OWNER_EMAIL_FORWARD_TO: 'owner@example.com',
    VETSA_MEDIA: { get: async () => ({ size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }) } } };
}

test('every agent has its own allowed sender and display name without silently switching to Melodi', () => {
  assert.deepEqual(AGENT_EMAIL_SENDERS, agents.map(agent => `${agent}@vetsa.es`));
  for (const agent of agents) {
    const identity = agentEmailIdentity(agent);
    assert.equal(identity.from, `${agent}@vetsa.es`); assert.equal(identity.agent, agent);
    assert.equal(identity.senderName, `${agent[0].toUpperCase() + agent.slice(1)} · Equipo Vetsa`);
    assert.equal(agentForEmail(` ${agent.toUpperCase()}@VETSA.ES `), agent);
  }
  assert.throws(() => agentEmailIdentity('melodi', { from: 'unregistered@vetsa.es' }), /email_sender_not_allowed/);
  assert.throws(() => agentEmailIdentity('melodi', { from: 'melodi@example.com' }), /email_sender_not_allowed/);
  assert.throws(() => agentEmailIdentity('unknown'), /email_unknown_agent/);
  assert.equal(agentEmailIdentity('melodi', { from: 'ceo@vetsa.es' }).from, 'ceo@vetsa.es');
});

test('only an explicit first command may choose a sender; body, quoted text and model defaults cannot', () => {
  assert.equal(literalEmailSender('Melodi: envía el correo desde ceo@vetsa.es a cliente@example.com'), 'ceo@vetsa.es');
  assert.equal(literalEmailSender('Envía el correo desde la cuenta de Melodi'), 'melodi');
  assert.equal(literalEmailSender('Crea un PDF y envíamelo por email\nContenido: desde emily@vetsa.es'), '');
  assert.equal(literalEmailSender('Crea un PDF y envíamelo por email “Guion desde emily@vetsa.es”'), '');
  assert.equal(literalEmailSender('Envía esto por email: Texto que dice desde emily@vetsa.es'), '');
  assert.equal(literalEmailSender('“Envía el correo desde emily@vetsa.es”'), '');
});

test('waiting email prose cannot capture refusals, questions, approvals, social replies or fresh commands', () => {
  for (const text of ['No envíes nada', 'Melodi, no lo envíes', 'Cuéntame del proyecto', '¿Cómo va el proyecto?', 'Necesito ayuda',
    'Recuérdame mañana a las diez', 'Apruebo el informe', 'Cancelar correo', 'Gracias', 'Gracias por todo',
    'Gracias por enviármelo, pero no me avisaste', 'Hola', 'Perfecto', 'No', 'Qué hora es']) {
    assert.equal(ownerEmailBodyContinuation(text), false, text);
  }
  assert.equal(ownerEmailBodyContinuation('Estimado cliente, adjunto el informe solicitado.'), true);
  assert.equal(ownerEmailBodyContinuation('Cuerpo: No envíes nada'), true);
  assert.equal(ownerEmailBodyContinuation('Cuerpo: ¿Cómo va el proyecto?'), true);
  assert.equal(ownerEmailBodyContinuation('Cuerpo:'), false);
});

test('provider sender, reply-to, stored receipt and autonomous email use the actual agent for all five aliases', async t => {
  const { env, sql } = emailHarness(), sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
    const payload = JSON.parse(init.body); sent.push(payload);
    return Response.json({ messageId: `brevo-${sent.length}` });
  });
  for (const agent of agents) {
    const receipt = await ownerAutonomyServices(env).emailOwner('owner', `owner-mail-${agent}`, agent, 'Informe preparado');
    const identity = agentEmailIdentity(agent), email = sent.at(-1);
    assert.deepEqual(email.sender, { email: identity.from, name: identity.senderName });
    assert.deepEqual(email.replyTo, email.sender); assert.ok(email.subject.startsWith(identity.name));
    assert.equal(receipt.sender, identity.from); assert.equal(receipt.recipient, 'owner@example.com');
    assert.equal(receipt.agent, agent); assert.equal(receipt.status, 'sent'); assert.equal(receipt.deliveryState, 'provider_accepted');
    const row = sql.prepare('SELECT * FROM wa_owner_email_messages WHERE related_job_id=?').get(`owner-mail-${agent}`);
    assert.equal(row.status, 'sent'); assert.ok(row.provider_message_id.startsWith('brevo-'));
    assert.equal(JSON.stringify(row).includes('owner@example.com'), false);
  }
});

test('direct document wrappers attach the stored PDF and preserve the assigned sender', async t => {
  const { env } = emailHarness(), sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ messageId: `document-${sent.length}` }); });
  for (const agent of agents) {
    const result = await ownerExecutorServices({ assignmentAgent: agent }).sendIssuedDocumentByEmail(env, 'owner', `pdf-${agent}`,
      { object_key: 'owner/private.pdf', mime_type: 'application/pdf', file_name: 'informe.pdf' }, { to: 'owner@example.com' });
    assert.equal(sent.at(-1).sender.email, `${agent}@vetsa.es`); assert.equal(result.sender, `${agent}@vetsa.es`);
    assert.equal(sent.at(-1).attachment[0].name, 'informe.pdf');
    assert.equal(sent.at(-1).sender.name, agentEmailIdentity(agent).senderName);
  }
});

test('unknown or rejected sender aliases fail explicitly and never attempt a Melodi fallback', async t => {
  const { env, sql } = emailHarness(), sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ message: 'Sender is not verified' }, { status: 400 }); });
  await assert.rejects(sendOwnerEmail(env, 'owner', 'unknown', { to: 'owner@example.com', agent: 'melodi', from: 'wrong@vetsa.es' }), /email_sender_not_allowed/);
  assert.equal(sent.length, 0);
  await assert.rejects(sendOwnerEmail(env, 'owner', 'unverified', { to: 'owner@example.com', agent: 'melodi' }), /Brevo returned 400: Sender is not verified/);
  assert.equal(sent.length, 1); assert.equal(sent[0].sender.email, 'emily@vetsa.es');
  assert.equal(sql.prepare('SELECT status FROM wa_owner_email_messages').get().status, 'failed');
});

test('a successful HTTP response without a provider identifier remains unconfirmed and is never automatically resent', async t => {
  const { env, sql } = emailHarness(); let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return Response.json({}); });
  const payload = { to: 'owner@example.com', agent: 'melodi', body: 'Informe' };
  await assert.rejects(sendOwnerEmail(env, 'owner', 'ambiguous', payload), /did not confirm/);
  assert.equal(sql.prepare('SELECT status FROM wa_owner_email_messages').get().status, 'reserved');
  const replay = await sendOwnerEmail(env, 'owner', 'ambiguous', payload);
  assert.equal(replay.status, 'reserved'); assert.equal(attempts, 1);
});

test('a repeated sent job reports the original receipt rather than a newly requested agent', async t => {
  const { env } = emailHarness(); let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return Response.json({ messageId: 'first-sent' }); });
  await sendOwnerEmail(env, 'owner', 'same-job', { to: 'owner@example.com', agent: 'melodi' });
  const replay = await sendOwnerEmail(env, 'owner', 'same-job', { to: 'other@example.com', agent: 'melodi' });
  assert.equal(replay.status, 'sent'); assert.equal(replay.repeated, true); assert.equal(replay.messageId, 'first-sent');
  assert.equal(replay.agent, 'melodi'); assert.equal(replay.sender, 'emily@vetsa.es'); assert.equal(replay.recipient, 'owner@example.com');
  assert.equal(attempts, 1);
});

test('simultaneous first sends and failed-send retries have exactly one provider claimant',async t=>{
  const {env,sql}=emailHarness();let sends=0,reject=false;
  t.mock.method(globalThis,'fetch',async()=>{sends++;return reject?Response.json({message:'Rate limited'},{status:429}):Response.json({messageId:'verified-'+sends});});
  const payload={to:'owner@example.com',agent:'melodi',body:'Requested report'};
  await Promise.all([sendOwnerEmail(env,'owner','new-race',payload),sendOwnerEmail(env,'owner','new-race',payload)]);
  assert.equal(sends,1);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_email_messages').get().n,1);
  reject=true;await assert.rejects(sendOwnerEmail(env,'owner','retry-race',payload),/429/);reject=false;
  await Promise.all([sendOwnerEmail(env,'owner','retry-race',payload),sendOwnerEmail(env,'owner','retry-race',payload)]);
  assert.equal(sends,3,'one initial rejection and one concurrent retry, plus the separate first-send test');
});

test('provider 5xx cannot release an uncertain reservation for automatic replay',async t=>{
  const {env}=emailHarness();let sends=0;
  t.mock.method(globalThis,'fetch',async()=>{sends++;return Response.json({message:'Temporary failure'},{status:503});});
  const payload={to:'owner@example.com',agent:'melodi',body:'Requested report'};
  await assert.rejects(sendOwnerEmail(env,'owner','uncertain-5xx',payload),/503/);
  assert.equal((await sendOwnerEmail(env,'owner','uncertain-5xx',payload)).status,'reserved');assert.equal(sends,1);
});

test('legacy email jobs persist one encrypted confirmation from the provider receipt and never resend the email', async t => {
  const { env, sql } = emailHarness(); let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return Response.json({ messageId: 'legacy-accepted' }); });
  const services = ownerExecutorServices({ assignmentAgent: 'melodi' });
  const context = { env, row: { owner_phone: 'owner' }, jobId: 'legacy-email', payload: {
    agent: 'melodi', from: 'emily@vetsa.es', to: 'owner@example.com', body: 'Correo solicitado' },
    sendText: async () => assert.fail('Durable notifications are dispatched by the global contact coordinator') };
  await job_send_email(context, services);
  // A stale retry must report the real first receipt, even if its payload has changed.
  await job_send_email({ ...context, payload: { ...context.payload, agent: 'melodi', from: 'emily@vetsa.es', to: 'changed@example.com' } }, services);
  assert.equal(attempts, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, 1);
  assert.equal(JSON.stringify(sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get()).includes('owner@example.com'), false);
  const notices = createDeliveryNotices(env.VETSA_CLOUD, ownerAutonomyServices(env));
  const [notice] = await notices.claim({ owner: 'owner' });
  assert.equal(notice.agent, 'melodi'); assert.equal(notice.ownerRequested, true);
  assert.match(notice.body, /^Melodi: Envié el correo solicitado a owner@example\.com desde melodi@vetsa\.es\.$/);
});

test('edited-attachment email jobs also use the durable confirmed-receipt notifier', async () => {
  const calls = [];
  await job_prepare_direct_email_attachment({ env: {}, row: { owner_phone: 'owner' }, jobId: 'image-email', payload: { to: 'owner@example.com' },
    sendText: async () => assert.fail('No inline completion message') }, {
    editImageForScheduledEmail: async () => ({ objectKey: 'private/image' }),
    attachmentFromPrivateReference: async () => ({ fileName: 'imagen.png' }),
    sendOwnerEmail: async () => ({ status: 'sent', sender: 'emily@vetsa.es', recipient: 'owner@example.com', agent: 'melodi', messageId: 'provider-accepted' }),
    notifyEmailDelivered: async (...parameters) => calls.push(parameters),
  });
  assert.equal(calls.length, 1); assert.equal(calls[0][2], 'image-email'); assert.equal(calls[0][3].sender, 'emily@vetsa.es');
});

test('unconfirmed provider states never create a completion notice', async () => {
  const { env, sql } = emailHarness();
  for (const status of ['reserved', 'failed', 'pending']) {
    assert.equal((await ownerExecutorServices().notifyEmailDelivered(env, 'owner', `mail-${status}`, { status })).status, 'unconfirmed');
  }
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='wa_melodi_delivery_notices'").get().n, 0);
});

test('private research preparation retains the requested origin and original assigned agent', async () => {
  const { env, sql } = emailHarness(), dispatches = [];
  sql.exec(readFileSync(new URL('../melodi-artifact-tracking.sql', import.meta.url), 'utf8'));
  sql.exec(`CREATE TABLE wa_owner_jobs (id TEXT PRIMARY KEY, owner_phone TEXT, job_type TEXT, encrypted_payload TEXT,
    payload_iv TEXT, status TEXT, created_at TEXT)`);
  env.MELODI_JOBS = { send: async value => dispatches.push(value) };
  const services = ownerAutonomyServices(env);
  const receipt = await services.prepareDocument({ ownerPhone: 'owner', idempotencyKey: 'owner-research', agent: 'melodi', assignmentAgent: 'melodi',
    origin: 'owner_request', channel: 'email', format: 'pdf', title: 'Informe original de Melodi', content: 'Fuentes públicas verificadas.' });
  assert.equal(receipt.status, 'queued'); assert.equal(dispatches[0].jobId, receipt.jobId);
  const row = sql.prepare('SELECT * FROM wa_owner_jobs').get(), tracking = sql.prepare('SELECT * FROM wa_melodi_artifact_tracking').get();
  const payload = await services.decrypt(row.encrypted_payload, row.payload_iv);
  assert.equal(payload.autonomyOrigin, 'owner_request'); assert.equal(payload.autonomyAgent, 'melodi'); assert.equal(payload.autonomyChannel, 'email');
  assert.equal(payload.sourceContent, 'Informe original de Melodi\n\nFuentes públicas verificadas.');
  assert.equal(tracking.agent, 'melodi'); assert.equal(tracking.channel, 'email');
});

function executorHarness(interpretation, overrides = {}) {
  const events = [], jobs = [], sessions = [];
  const context = { interpretation, env: { BREVO_API_KEY: 'test', OWNER_EMAIL_FORWARD_TO: 'owner@example.com' },
    phone: 'owner', normalized: '', message: {}, reply: async body => events.push({ type: 'reply', body }), ...overrides };
  const services = {
    resolveOwnerRecipient: async (_env, _phone, input) => input.contactEmail ? { email: input.contactEmail } : null,
    setOwnerSession: async (_env, _phone, type, state) => sessions.push({ type, state }), clearOwnerSession: async () => {},
    storeIncomingMedia: async () => null,
    enqueueDirectOwnerEmail: async (_env, _phone, payload) => { events.push({ type: 'stored' }); jobs.push(payload); return 'durable-job'; },
  };
  return { context, services, events, jobs, sessions };
}
test('direct owner mail defaults to the assigned agent and acknowledges only after durable acceptance', async () => {
  const context = executorHarness({ intent: 'send_email', agent: 'melodi', emailFrom: 'emily@vetsa.es', emailToSelf: true, emailBody: 'Contenido autorizado' },
    { normalized: 'Melodi, envíame este correo a mi email\nContenido desde emily@vetsa.es' });
  await send_email(context.context, context.services);
  assert.deepEqual(context.events.map(event => event.type), ['stored', 'reply']);
  assert.equal(context.jobs[0].to, 'owner@example.com'); assert.equal(context.jobs[0].from, 'emily@vetsa.es');
  assert.equal(context.jobs[0].senderName, 'Melodi · Equipo Vetsa'); assert.match(context.events[1].body, /^Melodi: Recibí/);
  const acknowledged = executorHarness({ intent: 'send_email', agent: 'melodi', emailToSelf: true, emailBody: 'Contenido' }, { receiptSent: true });
  await send_email(acknowledged.context, acknowledged.services);
  assert.deepEqual(acknowledged.events.map(event => event.type), ['stored']);
  const failure = executorHarness({ intent: 'send_email', agent: 'melodi', emailToSelf: true, emailBody: 'Contenido' });
  failure.services.enqueueDirectOwnerEmail = async () => null;
  await assert.rejects(send_email(failure.context, failure.services), /not durably accepted/);
  assert.deepEqual(failure.events, []);
  const explicit = executorHarness({ intent: 'send_email', agent: 'melodi', emailFrom: 'emily@vetsa.es', emailToSelf: true, emailBody: 'Contenido' },
    { normalized: 'Melodi: envíame el correo desde ceo@vetsa.es' });
  await send_email(explicit.context, explicit.services);
  assert.equal(explicit.jobs[0].from, 'ceo@vetsa.es'); assert.equal(explicit.jobs[0].agent, 'melodi');
});

test('email continuation keeps the stored agent, accepts body text and does not capture a new reminder', async () => {
  const saved = { type: 'await_email_delivery', state: { agent: 'melodi', from: 'emily@vetsa.es', to: 'owner@example.com', body: '' } };
  const context = executorHarness({ intent: 'chat', agent: 'melodi' }, { session: saved, normalized: 'Texto autorizado para el correo.' });
  await continueEmailDelivery(context.context, context.services);
  assert.equal(context.jobs[0].agent, 'melodi'); assert.equal(context.jobs[0].from, 'emily@vetsa.es');
  assert.equal(context.jobs[0].body, 'Texto autorizado para el correo.');
  const reminder = executorHarness({ intent: 'create_reminder', title: 'Otra tarea', emailBody: 'Esto no es un correo.' }, { session: saved });
  assert.equal(await continueEmailDelivery(reminder.context, reminder.services), undefined);
  assert.deepEqual(reminder.jobs, []); assert.deepEqual(reminder.events, []);
  for (const normalized of ['No envíes nada', 'Cuéntame del proyecto']) {
    const refusal = executorHarness({ intent: 'chat', emailBody: normalized }, { session: saved, normalized });
    assert.equal(await continueEmailDelivery(refusal.context, refusal.services), undefined);
    assert.deepEqual(refusal.jobs, []); assert.deepEqual(refusal.events, []);
    assert.equal(refusal.context.session, saved);
  }
  const literal = executorHarness({ intent: 'create_reminder', emailBody: 'Incorrecto generado por el modelo' },
    { session: saved, normalized: 'Cuerpo: Recuérdame mañana a las diez.\nPreserva estas líneas.' });
  await continueEmailDelivery(literal.context, literal.services);
  assert.equal(literal.jobs.length, 1);
  assert.equal(literal.jobs[0].body, 'Recuérdame mañana a las diez.\nPreserva estas líneas.');
});
