import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleOwnerMessage, processOwnerJob, executeApprovedOwnerTask } from '../owner-features.js';
import { createOwnerJobRetry } from '../owner-job-retry.js';
import { createAgentRuntime } from '../melodi-autonomy.js';
import { ownerTeamCommand } from '../melodi-team-commands.js';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec('PRAGMA foreign_keys=ON'); }
  prepare(query) {
    const db = this;
    const make = values => ({ query, values, bind: (...next) => make(next),
      async run() { return db.execute(query, values); }, async all() { return db.execute(query, values); },
      async first() { return db.execute(query, values).results[0] ?? null; } });
    return make([]);
  }
  execute(query, values) {
    const prepared = this.sql.prepare(query);
    if (prepared.columns().length) return { results: prepared.all(...values).map(row => ({ ...row })), meta: { changes: 0 } };
    return { results: [], meta: { changes: Number(prepared.run(...values).changes) } };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const result = statements.map(statement => this.execute(statement.query, statement.values)); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

const OWNER = '18095551234';
const POST = 'https://www.instagram.com/p/DQexactPost/?igsh=YWJjMTIz';

async function fixture({ inference, onControl } = {}) {
  const db = new SqliteD1();
  for (const file of ['schema.sql', 'story-campaign.sql', 'story-approval.sql', 'melodi-team-coordination.sql', 'melodi-autonomy.sql',
    'melodi-permissions.sql', 'melodi-routines.sql', 'melodi-autonomy-maintenance.sql', 'melodi-artifact-tracking.sql', 'owner-task-references.sql', 'delivery-notice.sql']) {
    db.sql.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  }
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const hooks = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
      return { encrypted: Buffer.from(bytes).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(encrypted, iv) {
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64'));
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
  const replies = [], replyAgents = [], controls = [], requests = [], envelopes = [], reminders = [], traces = [], observed = [], observedReplies = [];
  const env = { TEAM_AUTONOMY_ENABLED: 'true', TIME_ZONE: 'America/Santo_Domingo', VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER:OWNER,
    MEMORY_ENCRYPTION_KEY: Buffer.from(keyBytes).toString('base64'), OWNER_EMAIL_FORWARD_TO: 'owner@example.net', BREVO_API_KEY: 'test-only-key',
    MELODI_JOBS: { async send(value) { traces.push({ kind: 'queue', value }); envelopes.push(value); } },
    VETSA_INTELLIGENCE: { async fetch(request) {
      const body = await request.json(); requests.push(body); traces.push({ kind: 'inference', body });
      return Response.json({ text: JSON.stringify(inference ? await inference(body) : {
        intent: 'send_email', agent: 'melodi', email_to: 'invented@example.net', email_body: 'This wrong interpretation must never run',
      }) });
    } },
  };
  const retries = createOwnerJobRetry(db, { ...hooks, queue: env.MELODI_JOBS });
  let messageNumber = 0;
  async function send(incoming) {
    const messageId = `owner-regression-${++messageNumber}`;
    return handleOwnerMessage(env, { phone: OWNER, incoming, message: { id: messageId, type: 'text', text: { body: incoming } },
      markTyping: async () => {}, sendText: async (_env, phone, body, options) => { assert.equal(phone, OWNER); traces.push({ kind: 'reply', body }); replies.push(body); replyAgents.push(options?.agent); },
      addReminder: async (title, eventAt) => { reminders.push({ title, eventAt }); return { id: `calendar-${reminders.length}` }; },
      observeAgent: async agent => observed.push(agent), observeAgentReply: async (agent, body) => observedReplies.push({ agent, body }),
      configureTeam: async command => {
        controls.push(command); traces.push({ kind: 'control', ...command });
        if (onControl) return onControl(command, { db, env, retries, messageId });
        if (command.action === 'authorize_skill') return { allowed: true };
        if (command.action === 'retry_job') {
          const result = await retries.retry({ owner: OWNER, agent: command.agent, jobId: command.jobId, latest: command.latest,
            requestKey: messageId, explicit: true });
          assert.equal(result.status, 'queued');
          return `${command.agent[0].toUpperCase() + command.agent.slice(1)}: Voy a reintentar ese trabajo.`;
        }
        return null;
      },
    });
  }
  async function session(type, state) {
    const sealed = await hooks.encrypt(state);
    db.sql.prepare('INSERT INTO wa_owner_session VALUES(?,?,?,?,?)').run(OWNER, type, sealed.encrypted, sealed.iv, new Date().toISOString());
  }
  async function job(id, payload, { agent = 'melodi', type = 'generate_story', status = 'failed', error = 'spaik_image_http_503' } = {}) {
    const sealed = await hooks.encrypt({ ...payload, autonomyAgent: agent });
    db.sql.prepare(`INSERT INTO wa_owner_jobs(id,owner_phone,job_type,encrypted_payload,payload_iv,status,created_at,error_code)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, OWNER, type, sealed.encrypted, sealed.iv, status, new Date().toISOString(), error);
  }
  const storedSession = () => db.sql.prepare('SELECT * FROM wa_owner_session WHERE owner_phone=?').get(OWNER);
  return { db, hooks, env, send, session, job, storedSession, replies, replyAgents, controls, requests, envelopes, reminders, traces, observed, observedReplies };
}

test('the explicit Melodi correction and compound research/email request bypass incorrect semantic email routing', async () => {
  const context = await fixture();
  const raw = `No, esto es para Melodi. Quiero que me envíes por mail todos los formatos que muestra esta publicación y cómo hacerlos: ${POST}`;
  assert.equal(await context.send(raw), true);
  assert.equal(context.requests.length, 0);
  assert.equal(context.reminders.length, 0);
  assert.equal(context.envelopes.length, 0);
  const command = context.controls.find(row => row.action === 'research_request');
  assert.equal(command.agent, 'melodi');
  assert.equal(command.request.agent, 'melodi');
  assert.equal(command.request.brief, raw);
  assert.equal(command.request.channel, 'email');
  assert.equal(command.request.recipient, 'owner');
  assert.equal(command.request.sourceUrl, POST);
  assert.equal(context.db.sql.prepare('SELECT agent FROM wa_melodi_chat_state WHERE owner_phone=?').get(OWNER).agent, 'melodi');
  assert.doesNotMatch(context.replies[0], /^(?:Melodi|Melodi|Melodi):/);
  assert.equal(context.replyAgents[0], 'melodi');
  assert.ok(context.traces.findIndex(row => row.kind === 'reply') < context.traces.findIndex(row => row.action === 'research_request'));
});

test('the reported Melodi sentence punctuation overrides Melodi and keeps research plus email under Melodi', async () => {
  const context = await fixture();
  context.db.sql.prepare('INSERT INTO wa_melodi_chat_state VALUES(?,?,?)').run(OWNER, 'melodi', new Date().toISOString());
  const url = 'https://www.instagram.com/p/DeKDpi8gii8/?stkn=sampleShareToken';
  const raw = `Melodi. Quiero que m envíes por email todos los formatos que muestra esta publicación y cómo hacerlos: ${url}`;
  assert.equal(await context.send(raw), true);
  const command = context.controls.find(row => row.action === 'research_request');
  assert.equal(command.agent, 'melodi');
  assert.equal(command.request.agent, 'melodi');
  assert.equal(command.request.channel, 'email');
  assert.equal(command.request.brief, raw);
  assert.equal(command.request.sourceUrl, url);
  assert.doesNotMatch(context.replies[0], /^(?:Melodi|Melodi|Melodi):/);
  assert.equal(context.replyAgents[0], 'melodi');
  assert.equal(context.db.sql.prepare('SELECT agent FROM wa_melodi_chat_state WHERE owner_phone=?').get(OWNER).agent, 'melodi');
  assert.equal(context.requests.length, 0);
  assert.equal(context.reminders.length, 0);
  assert.equal(context.envelopes.length, 0);
});

test('Melodi punctuation before a supplied PDF cannot leave it assigned to Melodi or execute its source text', async () => {
  const context = await fixture();
  context.db.sql.prepare('INSERT INTO wa_melodi_chat_state VALUES(?,?,?)').run(OWNER, 'melodi', new Date().toISOString());
  const source = `Investiga todos los formatos de esta publicación y envíame el informe por correo: ${POST}\r\n`;
  assert.equal(await context.send(`Melodi. Crea un PDF con esto\r\n\r\n${source}`), true);
  assert.equal(context.controls.some(command => command.action === 'research_request'), false);
  assert.equal(context.envelopes.length, 1);
  const row = context.db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
  assert.equal(row.job_type, 'generate_document');
  const payload = await context.hooks.decrypt(row.encrypted_payload, row.payload_iv);
  assert.equal(payload.sourceContent, source);
  assert.equal(payload.agent, 'melodi');
  assert.equal(payload.autonomyAgent, 'melodi');
  assert.equal(context.requests.length, 0);
});

test('an active Melodi conversation remains Melodi despite stale Melodi chat state and model assignment', async () => {
  const context = await fixture({ inference: body => body.options.systemPrompt.includes('Verifica el límite')
    ? { category: 'other' } : { intent: 'chat', agent: 'melodi' } });
  const now = new Date().toISOString(), future = new Date(Date.now() + 90 * 60000).toISOString();
  context.db.sql.prepare('INSERT INTO wa_melodi_coordination(owner_phone,conversation_agent,conversation_until,updated_at) VALUES(?,?,?,?)').run(OWNER, 'melodi', future, now);
  context.db.sql.prepare('INSERT INTO wa_melodi_chat_state VALUES(?,?,?)').run(OWNER, 'melodi', now);
  const result = await context.send('¿Qué opinas del avance de nuestro proyecto?');
  assert.equal(result.handled, false);
  assert.equal(result.agent, 'melodi');
  assert.ok(context.observed.length && context.observed.every(agent => agent === 'melodi'));
  const parsed = JSON.parse(context.requests[0].contents);
  assert.equal(parsed.context.active_agent, 'melodi');
  assert.equal(context.db.sql.prepare('SELECT agent FROM wa_melodi_chat_state WHERE owner_phone=?').get(OWNER).agent, 'melodi');
});

test('asking Melodi what Melodi is doing separates the speaker from the task status target', () => {
  for (const incoming of ['Oye Melodi, que está haciendo Melodi en este momento?', 'Oye Melodi, ¿qué está haciendo Melodi en este momento?']) {
    assert.deepEqual(ownerTeamCommand(incoming, 'melodi'), { action: 'task_progress', agent: 'melodi', targetAgent: 'melodi' });
  }
  assert.equal(ownerTeamCommand('Melodi, crea un PDF con esto\n\n¿Qué está haciendo Melodi en este momento?', 'melodi'), null);
});

test('Melodi answers the current status of Melodi directly without transferring the conversation or asking to verify', async () => {
  const context = await fixture({ onControl(command) {
    if (command.action === 'authorize_skill') return { allowed: true };
    if (command.action !== 'task_progress') return null;
    assert.deepEqual(command, { action: 'task_progress', agent: 'melodi', targetAgent: 'melodi' });
    return 'Melodi: La investigación de Melodi está bloqueada por un fallo de análisis. No hay un documento ni un envío confirmado.';
  } });
  context.db.sql.prepare('INSERT INTO wa_melodi_chat_state VALUES(?,?,?)').run(OWNER, 'melodi', new Date().toISOString());
  assert.equal(await context.send('Oye Melodi, que está haciendo Melodi en este momento?'), true);
  assert.equal(context.controls.filter(command => command.action === 'task_progress').length, 1);
  assert.equal(context.controls.some(command => command.agent === 'melodi'), false);
  assert.deepEqual(context.replies, ['La investigación de Melodi está bloqueada por un fallo de análisis. No hay un documento ni un envío confirmado.']);
  assert.deepEqual(context.replyAgents, ['melodi']);
  assert.doesNotMatch(context.replies[0], /(?:quieres que|deseas que|debo verificar|confirma(?:\s|[?!.]|$))/i);
  assert.equal(context.db.sql.prepare('SELECT agent FROM wa_melodi_chat_state WHERE owner_phone=?').get(OWNER).agent, 'melodi');
  assert.deepEqual(context.observedReplies, [{ agent: 'melodi', body: context.replies[0] }]);
  assert.ok(context.observed.every(agent => agent === 'melodi'));
  assert.equal(context.requests.length, 0);
  assert.equal(context.envelopes.length, 0);
  assert.equal(context.reminders.length, 0);
});

test('a shared task status reports Melodi analysis failure through Melodi without revealing private goals or request contents', async () => {
  const context = await fixture();
  context.env.OWNER_WHATSAPP_NUMBER = OWNER;
  const current = Date.parse('2026-10-09T14:00:00Z');
  const runtime = createAgentRuntime(context.env, { now: () => current, services: context.hooks });
  await runtime.initialize();
  const privateGoal = 'PRIVATE_LILA_PERSONAL_GOAL exact content never shared in status';
  const privateBrief = 'PRIVATE_LILA_RESEARCH_BRIEF exact content never shared in status';
  await runtime.coordinator.setGoal(OWNER, 'melodi', { title: privateGoal }, new Date(current).toISOString());
  const failed = await runtime.store.enqueueEvent({ owner: OWNER, agent: 'melodi', eventKey: 'task-status-private-analysis',
    type: 'owner_research_report', priority: 20, payload: { request: { agent: 'melodi', brief: privateBrief } } });
  context.db.sql.prepare('UPDATE wa_melodi_work_events SET status=?,error_code=?,attempts=3 WHERE id=?').run('failed', 'requested_research_invalid_analysis', failed.id);
  const answer = await runtime.control({ action: 'task_progress', agent: 'melodi', targetAgent: 'melodi' });
  assert.match(answer, /^Melodi:/);
  assert.match(answer, /Melodi/);
  assert.match(answer, /(?:an[aá]lisis|interpretar|estructurar)/i);
  assert.match(answer, /(?:fall[oó]|fallo|bloquead|no pudo|no ha podido)/i);
  assert.doesNotMatch(answer, /PRIVATE_LILA_|requested_research_|agent_run_failed|\?/);
  assert.equal(context.requests.length, 0);
  assert.equal(context.envelopes.length, 0);
  assert.equal(context.reminders.length, 0);
  assert.equal((await runtime.coordinator.settings(OWNER)).focus_agent, 'melodi');
});

test('the reported retry cannot become a recipient, email or reminder even with stale clarification state', async () => {
  for (const type of ['await_reminder_time', 'await_reminder_recipient', 'await_document_recipient', 'await_email_delivery']) {
    const context = await fixture();
    const originalState = { title: 'An unrelated reminder', recipientName: 'Original recipient', to: 'original@example.net',
      payload: { sourceContent: 'An unrelated pending PDF' } };
    await context.session(type, originalState);
    const before = { ...context.storedSession() };
    await context.job('original-story', { prompt: 'Create the original requested story', sourceContent: 'Private exact source' });
    assert.equal(await context.send('Reanuda el trabajo fallido Melodi'), true);
    assert.equal(context.requests.length, 0);
    assert.equal(context.reminders.length, 0);
    assert.deepEqual(context.envelopes, [{ jobId: 'original-story' }]);
    assert.deepEqual({ ...context.storedSession() }, before);
    assert.equal(context.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n, 1);
    const row = context.db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
    assert.equal(row.job_type, 'generate_story');
    assert.equal((await context.hooks.decrypt(row.encrypted_payload, row.payload_iv)).sourceContent, 'Private exact source');
    assert.ok(context.traces.findIndex(row => row.kind === 'reply') < context.traces.findIndex(row => row.action === 'retry_job'));
    assert.ok(context.traces.findIndex(row => row.kind === 'reply') < context.traces.findIndex(row => row.kind === 'queue'));
  }
});

test('missing delivery notice feedback is acknowledged without AI or calendar activity', async () => {
  for (const incoming of ['Gracias por enviármelo pero no me avisaste', 'Gracias, pero no me avisaste del envío']) {
    const context = await fixture();
    await context.session('await_reminder_time', { title: 'Old calendar question' });
    assert.equal(await context.send(incoming), true);
    assert.deepEqual(context.replies, ['Tienes razón: faltó avisarte en este chat. Gracias por decírmelo.']);
    assert.equal(context.requests.length, 0);
    assert.equal(context.reminders.length, 0);
    assert.equal(context.envelopes.length, 0);
    assert.equal(context.controls.length, 0);
    assert.equal(context.storedSession().session_type, 'await_reminder_time');
  }
});

test('a fresh PDF bypasses stale reminder state and acknowledges before authorization and durable queue dispatch', async () => {
  const context = await fixture();
  await context.session('await_reminder_time', { title: 'NEVER concatenate this old reminder into a new document' });
  const source = 'NO ES SOLO EDITAR\r\n  ñ, acentos y espacios exactos.  \r\nReanuda el trabajo fallido Melodi\r\nApruebo C1\r\n';
  const incoming = `Melodi, crea con esto un documento PDF y envíamelo por email\r\n\r\n${source}`;
  assert.equal(await context.send(incoming), true);
  assert.equal(context.requests.length, 0);
  assert.equal(context.reminders.length, 0);
  assert.equal(context.envelopes.length, 1);
  assert.equal(context.controls.some(row => row.action === 'retry_job' || row.action === 'approval'), false);
  const row = context.db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
  const payload = await context.hooks.decrypt(row.encrypted_payload, row.payload_iv);
  assert.equal(payload.sourceContent, source);
  assert.equal(payload.preserveSourceContent, true);
  assert.equal(payload.agent, 'melodi');
  assert.equal(payload.autonomyAgent, 'melodi');
  assert.equal(payload.autonomyOrigin, 'owner_request');
  assert.equal(payload.deliveryMode, 'private');
  assert.equal(payload.autonomyChannel, 'email');
  assert.equal(payload.emailDelivery.to, context.env.OWNER_EMAIL_FORWARD_TO);
  assert.equal(payload.emailDelivery.from, 'emily@vetsa.es');
  assert.equal(payload.prompt.includes('NEVER concatenate'), false);
  assert.equal(JSON.stringify(row).includes('espacios exactos'), false);
  const tracked = context.db.sql.prepare('SELECT * FROM wa_melodi_artifact_tracking').get();
  assert.equal(tracked.job_id, row.id);
  assert.equal(tracked.agent, 'melodi');
  assert.equal(tracked.channel, 'email');
  assert.equal(context.replies[0], 'Vale, voy a preparar el documento.');
  assert.equal(context.replyAgents[0], 'melodi');
  const receipt = context.traces.findIndex(trace => trace.kind === 'reply');
  assert.ok(receipt < context.traces.findIndex(trace => trace.action === 'authorize_skill'));
  assert.ok(receipt < context.traces.findIndex(trace => trace.kind === 'queue'));
  assert.equal(context.storedSession().session_type, 'await_reminder_time');
});

test('the Electro Wisly follow-up retains the document context and registers its delivery instead of sending it immediately',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-09T14:00:00Z')});
  const h=await fixture(),created=new Date().toISOString();
  h.db.sql.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .run('wisly-deadline',OWNER,'Terminar integración de Alexa AI en Electro Wisly','2026-10-12T13:00:00.000Z','melodi',created,created);
  await h.send('Melodi, quiero para ese mismo día 1 documento de todas las funcionalidades que Alexa AI deberá tener para esa empresa');
  assert.equal(h.requests.length,0);assert.equal(h.envelopes.length,1);
  const row=h.db.sql.prepare('SELECT * FROM wa_owner_jobs').get(),payload=await h.hooks.decrypt(row.encrypted_payload,row.payload_iv);
  assert.equal(payload.deliveryAt,'2026-10-12T13:00:00.000Z');assert.match(payload.documentContext,/Electro Wisly/);
  assert.equal(payload.authorAgent,'melodi');assert.equal(payload.autonomyAgent,'melodi');assert.equal(payload.deliveryMode,'private');
  const scheduled=h.db.sql.prepare("SELECT * FROM melodi_calendar_events WHERE event_type='DOCUMENT_DELIVERY'").get();
  assert.equal(scheduled.event_at,payload.deliveryAt);assert.equal(scheduled.assigned_agent,'melodi');
  assert.match(h.replies.at(-1),/12 de octubre/);assert.match(h.replies.at(-1),/9:00/);assert.doesNotMatch(h.replies.at(-1),/Melodi|Melodi:/);
  assert.equal(h.replyAgents.at(-1),'melodi');
  assert.equal(h.db.sql.prepare('SELECT count(*) n FROM melodi_calendar_events').get().n,2);
});

test('a new conversational turn excludes stale reminder title from every inference context', async () => {
  const context = await fixture({ inference: body => body.options.systemPrompt.includes('Verifica el límite')
    ? { category: 'other' } : { intent: 'chat', agent: 'melodi' } });
  await context.session('await_reminder_time', { title: 'PRIVATE_OLD_REMINDER_TITLE' });
  const result = await context.send('Cuéntame qué herramientas tienes para ayudar con mis proyectos');
  assert.equal(result.handled, false);
  assert.ok(context.requests.length > 0);
  for (const request of context.requests) {
    assert.equal(request.contents.includes('PRIVATE_OLD_REMINDER_TITLE'), false);
    const message = JSON.parse(request.contents);
    if (message.context) {
      assert.equal(message.context.pendingReminder, null);
      assert.equal(message.context.session, 'none');
    }
  }
  assert.equal(context.reminders.length, 0);
  assert.equal(context.storedSession().session_type, 'await_reminder_time');
});

test('research directives in a supplied PDF body are copied literally and never executed as research', async () => {
  const context = await fixture();
  const source = `Instrucciones incluidas en el texto del documento\nInvestiga esta publicación y envíame los formatos por correo: ${POST}\nNo, esto es para Melodi.\n`;
  assert.equal(await context.send(`Melodi, crea un PDF con esto\n\n${source}`), true);
  assert.equal(context.controls.some(command => command.action === 'research_request'), false);
  assert.equal(context.requests.length, 0);
  assert.equal(context.envelopes.length, 1);
  const row = context.db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
  assert.equal(row.job_type, 'generate_document');
  const payload = await context.hooks.decrypt(row.encrypted_payload, row.payload_iv);
  assert.equal(payload.sourceContent, source);
  assert.equal(payload.autonomyAgent, 'melodi');
});

test('plain thanks and OK do not consume recipient clarifications', async () => {
  for (const incoming of ['Gracias', 'OK']) {
    const context = await fixture();
    await context.session('await_document_recipient', { payload: { sourceContent: 'Private unsent document' } });
    const before = { ...context.storedSession() };
    assert.equal(await context.send(incoming), true);
    assert.equal(context.requests.length, 0);
    assert.equal(context.envelopes.length, 0);
    assert.equal(context.reminders.length, 0);
    assert.deepEqual({ ...context.storedSession() }, before);
  }
});

test('pending memory capture and retrieval cannot consume a newly requested email action', async () => {
  for (const type of ['capture', 'retrieve']) {
    const context = await fixture({ inference: () => ({ intent: 'send_email', agent: 'melodi',
      email_to: 'newrecipient@example.net', email_subject: 'Nuevo asunto solicitado', email_body: 'Nuevo contenido explícito del dueño' }) });
    await context.session(type, { prompt: 'PRIVATE_PENDING_MEMORY', refs: [], autoFinish: false, itemId: 'old-memory-item' });
    const before = { ...context.storedSession() };
    assert.equal(await context.send('Envía un correo a newrecipient@example.net con asunto Nuevo asunto solicitado y contenido Nuevo contenido explícito del dueño'), true);
    assert.equal(context.envelopes.length, 1);
    assert.equal(context.reminders.length, 0);
    assert.deepEqual({ ...context.storedSession() }, before);
    assert.equal(context.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_memory_items').get().n, 0);
    const row = context.db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
    assert.equal(row.job_type, 'send_email');
    const payload = await context.hooks.decrypt(row.encrypted_payload, row.payload_iv);
    assert.equal(payload.to, 'newrecipient@example.net');
    assert.equal(payload.subject, 'Nuevo asunto solicitado');
    assert.equal(payload.body, 'Nuevo contenido explícito del dueño');
    assert.equal(payload.body.includes('PRIVATE_PENDING_MEMORY'), false);
    assert.ok(context.traces.findIndex(trace => trace.kind === 'reply') < context.traces.findIndex(trace => trace.kind === 'queue'));
  }
});

test('a private document failure preserves owner assignment and creates one encrypted durable failure notice', async () => {
  const context = await fixture();
  const source = 'Contenido privado original de Melodi\r\n  ñ y espacios exactos  \r\n';
  await context.send(`Melodi, crea un PDF con esto\r\n\r\n${source}`);
  const accepted = context.db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
  let storageAttempts = 0;
  context.env.VETSA_MEDIA = { async put() { storageAttempts++; throw new Error('private_storage_unavailable'); } };
  const directSends = [];
  await assert.rejects(processOwnerJob(context.env, accepted.id, async (...args) => directSends.push(args)), /private_storage_unavailable/);
  const failed = context.db.sql.prepare('SELECT * FROM wa_owner_jobs WHERE id=?').get(accepted.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error_code, 'private_storage_unavailable');
  const payload = await context.hooks.decrypt(failed.encrypted_payload, failed.payload_iv);
  assert.equal(payload.sourceContent, source);
  assert.equal(payload.autonomyAgent, 'melodi');
  assert.equal(payload.autonomyOrigin, 'owner_request');
  assert.ok(Number.isFinite(Date.parse(payload.autonomyStartedAt)));
  assert.equal(context.requests.length, 0);
  assert.equal(context.reminders.length, 0);
  assert.equal(directSends.length, 0);
  const notice = context.db.sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get();
  assert.equal(notice.owner, OWNER);
  assert.equal(notice.agent, 'melodi');
  assert.equal(notice.owner_requested, 1);
  assert.equal(notice.artifact_job_id, accepted.id);
  assert.equal(notice.status, 'pending');
  let receipt = await context.hooks.decrypt(notice.payload_encrypted, notice.payload_iv);
  if (typeof receipt === 'string') receipt = JSON.parse(receipt);
  assert.match(receipt.body, /^Melodi: No pude terminar el documento que me pediste/);
  assert.doesNotMatch(receipt.body, /(?:envi[eé]|entregado|completado)/i);
  assert.equal(JSON.stringify(notice).includes('No pude terminar'), false);
  assert.equal(JSON.stringify(notice).includes('Contenido privado'), false);
  assert.equal(context.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices WHERE owner<>?').get(OWNER).n, 0);
  await processOwnerJob(context.env, accepted.id, async (...args) => directSends.push(args));
  assert.equal(context.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, 1);
  assert.equal(storageAttempts, 1);
});

test('requested research analysis failures preserve the stage and notify the assigned owner exactly once after bounded retries', async () => {
  const context = await fixture();
  context.env.OWNER_WHATSAPP_NUMBER = OWNER;
  let current = Date.parse('2026-10-09T14:00:00Z');
  let documentPreparations = 0;
  const runtime = createAgentRuntime(context.env, { now: () => current, services: { ...context.hooks,
    async readPublicSource() { return { configured: true, results: [{ url: POST, text: 'Comparativa: muestra el antes y el después.' }] }; },
    async generate() { return { text: '{"formats":[{"name":"Comparativa","source_url":' }; },
    async prepareDocument() { documentPreparations++; return { status: 'queued', jobId: 'must-not-prepare' }; },
  } });
  const queued = await runtime.control({ action: 'research_request', agent: 'melodi', eventId: 'failed-owner-analysis', request: {
    agent: 'melodi', sourceUrl: POST, scope: 'single_post', recipient: 'owner', channel: 'email', brief: 'Identifica los formatos y cómo hacerlos', includeTutorial: true,
  } });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await runtime.runAgent('melodi');
    const event = context.db.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(queued.eventId);
    assert.equal(event.attempts, attempt);
    assert.equal(event.status, attempt === 3 ? 'failed' : 'pending');
    assert.equal(event.error_code, 'requested_research_invalid_analysis');
    assert.equal(context.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, attempt === 3 ? 1 : 0);
    current += 61 * 60000;
  }
  assert.equal(documentPreparations, 0);
  assert.equal(context.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n, 0);
  assert.equal(context.reminders.length, 0);
  assert.equal(context.envelopes.length, 0);
  const notice = context.db.sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get();
  assert.equal(notice.owner, OWNER);
  assert.equal(notice.agent, 'melodi');
  assert.equal(notice.status, 'pending');
  assert.equal(notice.owner_requested, 1);
  let payload = await context.hooks.decrypt(notice.payload_encrypted, notice.payload_iv);
  if (typeof payload === 'string') payload = JSON.parse(payload);
  assert.match(payload.body, /^Melodi:/);
  assert.match(payload.body, /(?:no pude|no he podido|no se pudo|fall[oó])/i);
  assert.match(payload.body, /(?:no hay|no existe|no se (?:ha )?envi[oó]|no lo (?:he )?envi|no puedo entreg)/i);
  assert.doesNotMatch(payload.body, /(?:ya envi[eé] el informe|informe enviado correctamente|documento completado|agent_run_failed|requested_research_invalid_analysis)/i);
  assert.equal(JSON.stringify(notice).includes('Identifica los formatos'), false);
  await runtime.runAgent('melodi');
  assert.equal(context.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, 1);
  assert.equal(context.db.sql.prepare('SELECT attempts FROM wa_melodi_work_events WHERE id=?').get(queued.eventId).attempts, 3);
});

test('approved work uses its own snapshot and cannot consume an unrelated pending document session', async () => {
  const context = await fixture();
  await context.session('await_document_recipient', { agent: 'melodi', payload: { prompt: 'Unrelated private document', format: 'pdf' } });
  const before = { ...context.storedSession() };
  const result = await executeApprovedOwnerTask(context.env, { phone: OWNER, helper: 'melodi',
    input: { interpretation: { intent: 'send_email', agent: 'melodi', emailTo: 'authorized@example.net',
      emailBody: 'Authorized literal body', emailSubject: 'Authorized title' }, normalized: 'Melodi, envía un correo a authorized@example.net',
      message: { id: 'approved-original-message' }, receiptSent: true }, sendText: async () => {}, addReminder: async () => assert.fail('No calendar writes') });
  assert.equal(result.ok, true);
  const job = context.db.sql.prepare('SELECT * FROM wa_owner_jobs').get();
  assert.equal(job.job_type, 'send_email');
  const payload = await context.hooks.decrypt(job.encrypted_payload, job.payload_iv);
  assert.equal(payload.body, 'Authorized literal body');
  assert.equal(payload.agent, 'melodi');
  assert.equal(payload.from, 'emily@vetsa.es');
  assert.deepEqual({ ...context.storedSession() }, before);
});

test('the reported agenda follow-up returns the actual Melodi appointment through Melodi without inference or a new task',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T22:00:00Z')});
  const h=await fixture();
  h.db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('melodi-original',OWNER,'Crear planos 3D a partir de imágenes (Cognira Desktop)','2026-10-16T13:00:00.000Z','melodi','2026-10-08','2026-10-08');
  await h.session('await_reminder_time',{title:'Unrelated pending reminder'});
  const before={...h.storedSession()};
  assert.equal(await h.send('Que es lo que está programado para el 16?'),true);
  assert.match(h.replies[0],/^Esto está programado/);assert.match(h.replies[0],/Crear planos 3D/);assert.match(h.replies[0],/9:00/);
  assert.doesNotMatch(h.replies[0],/Melodi:|Melodi:|Melodi:/);assert.equal(h.replyAgents[0],'melodi');
  assert.equal(h.requests.length,0);assert.equal(h.envelopes.length,0);assert.equal(h.reminders.length,0);
  assert.deepEqual({...h.storedSession()},before);assert.equal(h.db.sql.prepare('SELECT assigned_agent FROM melodi_calendar_events').get().assigned_agent,'melodi');
});
test('an agenda read failure is not reported as an empty or inaccessible calendar',async()=>{
  const h=await fixture();h.db.sql.exec('DROP TABLE melodi_calendar_events');
  assert.equal(await h.send('Qué hay en la agenda para mañana?'),true);
  assert.match(h.replies[0],/No pude consultar la agenda actual/);assert.doesNotMatch(h.replies[0],/No hay actividades|no tengo información|actualización/);
  assert.equal(h.requests.length,0);
});
test('Melodi acknowledges the reported daily request before storing and confirms only a persisted routine',async()=>{
  const h=await fixture({onControl:async command=>command.action==='create_routine' ? 'Melodi: Quedó programado cada día a las 10:00 RD (R1).':null});
  assert.equal(await h.send('Oye Melodi, envíame una frase motivacional corta que trate de alcanzar el éxito todos los días y en cualquier momento'),true);
  const command=h.controls.find(row=>row.action==='create_routine');
  assert.equal(command.agent,'melodi');assert.equal(command.routine.frequency,'daily');assert.equal(command.routine.hour,'10:00');
  assert.match(h.replies[0],/^Sí, lo dejaré programado/);assert.match(h.replies[1],/Quedó programado/);
  assert.ok(h.replies.every(body=>!/^(?:Melodi|Melodi):/.test(body)));assert.deepEqual(h.replyAgents,['melodi']);
  assert.ok(h.traces.findIndex(row=>row.kind==='reply')<h.traces.findIndex(row=>row.action==='create_routine'));
  assert.equal(h.requests.length,0);assert.equal(h.envelopes.length,0);assert.equal(h.reminders.length,0);
  assert.equal(h.db.sql.prepare('SELECT agent FROM wa_melodi_chat_state WHERE owner_phone=?').get(OWNER).agent,'melodi');
});
test('a failed daily registration never claims success and stopping is scoped to the requested kind and agent',async()=>{
  const h=await fixture({onControl:async command=>{if(command.action==='create_routine')throw new Error('storage unavailable');if(command.action==='stop_routine')return 'Detuve las frases diarias.';return null;}});
  await h.send('Melodi, envíame una frase motivacional cada día');assert.match(h.replies.at(-1),/No pude guardar/);assert.doesNotMatch(h.replies.at(-1),/Quedó programado/);
  await h.send('Melodi, detén las frases diarias');
  const stop=h.controls.find(row=>row.action==='stop_routine');assert.equal(stop.agent,'melodi');assert.equal(stop.routineKind,'motivational_message');
});
