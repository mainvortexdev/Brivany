import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { registerDocumentSchedule } from '../document-schedules.js';
import { readFileSync } from 'node:fs';
import { createAutonomyStore } from '../melodi-autonomy-store.js';
import { createTeamCoordinator } from '../melodi-team-coordination.js';
import { createAgentRuntime } from '../melodi-autonomy.js';
import { repairOwnerResearchAssignments } from '../owner-research-repair.js';
import { executeFinanceRequest } from '../finance-workflow.js';
import { parseFinanceRequest } from '../finance-request.js';
import { currentOwnerSpeaker, selectOwnerSpeaker } from '../owner-speaker.js';

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec('PRAGMA foreign_keys=ON'); }
  prepare(query) {
    const db = this;
    const make = values => ({ query, values, bind: (...next) => make(next),
      async run() { return db.execute(query, values); }, async all() { return db.execute(query, values); },
      async first() { return db.execute(query, values).results[0] ?? null; },
    });
    return make([]);
  }
  execute(query, values) {
    const prepared = this.sql.prepare(query);
    if (prepared.columns().length) {
      const rows = prepared.all(...values).map(row => ({ ...row }));
      return { results: rows, meta: { changes: Number(this.sql.prepare('SELECT changes() AS n').get().n) } };
    }
    const result = prepared.run(...values);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try {
      const output = statements.map(statement => this.execute(statement.query, statement.values));
      this.sql.exec('COMMIT'); return output;
    } catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

const OWNER = '18095550000';
const AGENTS = ['melodi'];

test('a bounded artifact lookup filters the named agent before applying its limit', async () => {
  const h = await harness();
  for (let i = 0; i < 31; i++) await h.runtime.artifacts.register({ owner: OWNER, agent: 'melodi', jobId: `older-melodi-${i}`, jobType: 'generate_document' });
  h.advance(1);
  await h.runtime.artifacts.register({ owner: OWNER, agent: 'melodi', jobId: 'new-melodi-document', jobType: 'generate_document' });
  const rows = await h.runtime.artifacts.listPending({ owner: OWNER, agent: 'melodi', limit: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job_id, 'new-melodi-document');
  assert.equal(rows[0].agent, 'melodi');
  await assert.rejects(h.runtime.artifacts.listPending({ owner: OWNER, agent: 'unknown' }));
});

test('Melodi can report a verified source block without assigning herself the research or inventing delivery', async () => {
  const h = await harness();
  const sourceUrl = 'https://www.instagram.com/p/EXACT/';
  await h.store.enqueueEvent({ owner: OWNER, agent: 'melodi', eventKey: 'blocked-source-status', type: 'owner_research_report', priority: 20,
    payload: { request: { agent: 'melodi', origin: 'owner_request', recipient: 'owner', channel: 'email', sourceUrl, scope: 'single_post' } } });
  h.database.sql.prepare("UPDATE wa_melodi_work_events SET status='done',error_code='requested_research_formats_not_verified' WHERE event_key IS NOT NULL").run();
  const result = await h.runtime.control({ action: 'task_progress', agent: 'melodi', targetAgent: 'melodi' });
  assert.match(result, /^Melodi: Melodi está bloqueada/);
  assert.match(result, /diapositivas o texto/);
  assert.doesNotMatch(result, /[?¿]|envié|entregado|requested_research|https:/);
  await assert.rejects(h.runtime.control({ action: 'task_progress', agent: 'melodi', targetAgent: 'unknown' }));
  assert.equal(h.database.sql.prepare('SELECT agent FROM wa_melodi_work_events').get().agent, 'melodi');
  assert.equal(h.generated.length, 0);
  assert.equal(h.queued.length, 0);
});

test('an unexecuted misrouted Melodi request is reassigned in place from encrypted owner evidence exactly once', async () => {
  const h = await harness();
  const sourceUrl = 'https://www.instagram.com/p/DeKDpi8gii8/?stkn=YWJj';
  const brief = `Melodi. Quiero que m envíes por email todos los formatos que se muestran en esta publicación y como hacerlos\n${sourceUrl}`;
  const request = { agent: 'melodi', sourceUrl, scope: 'single_post', recipient: 'owner', channel: 'email',
    origin: 'owner_request', format: 'pdf', brief, includeAllFormats: true, includeTutorial: true };
  const event = await h.store.enqueueEvent({ owner: OWNER, agent: 'melodi', eventKey: 'original-owner-message',
    type: 'owner_research_report', payload: { request, allowContact: false }, priority: 20 });
  h.database.sql.prepare("UPDATE wa_melodi_work_events SET status='failed',attempts=3,error_code='agent_run_failed' WHERE id=?").run(event.id);
  const before = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(event.id);
  const options = { db: h.database, owner: OWNER, ...h.services, now: h.now };
  assert.deepEqual(await repairOwnerResearchAssignments(options), [{ id: event.id, agent: 'melodi', previousAgent: 'melodi' }]);
  const after = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(event.id);
  assert.equal(after.agent, 'melodi');
  assert.equal(after.status, 'pending');
  assert.equal(after.attempts, 0);
  assert.equal(after.created_at, before.created_at);
  assert.equal(after.event_key, before.event_key);
  assert.equal(after.error_code, null);
  const decoded = JSON.parse(await h.services.decrypt(after.payload_encrypted, after.payload_iv));
  assert.deepEqual(decoded.request, { ...request, agent: 'melodi' });
  assert.equal(JSON.stringify(after).includes(brief), false);
  assert.deepEqual(await repairOwnerResearchAssignments(options), []);
  assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_work_events').get().n, 1);
  assert.equal(h.database.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_work_audit WHERE action='assignment_repaired'").get().n, 1);
});

test('assignment repair cannot replay executed, waiting, claimed or ambiguous requests', async () => {
  for (const mode of ['done', 'processing', 'waiting', 'outbox', 'quoted', 'foreign_owner', 'existing_document', 'claim_race']) {
    const h = await harness();
    const sourceUrl = 'https://www.instagram.com/p/EXACT/';
    const request = { agent: 'melodi', sourceUrl, scope: 'single_post', recipient: 'owner', channel: 'email', origin: 'owner_request',
      brief: `${mode === 'quoted' ? 'Guarda este contenido:\n' : ''}Melodi. Investiga todos los formatos y envíame el informe por email: ${sourceUrl}` };
    const event = await h.store.enqueueEvent({ owner: OWNER, agent: 'melodi', eventKey: `guard:${mode}`,
      type: 'owner_research_report', payload: { request }, priority: 20 });
    if (['done', 'processing', 'waiting'].includes(mode))
      h.database.sql.prepare('UPDATE wa_melodi_work_events SET status=? WHERE id=?').run(mode, event.id);
    if (mode === 'outbox') await h.store.enqueueOutbox({ owner: OWNER, agent: 'melodi', eventId: event.id, messageKey: 'already-produced', payload: { body: 'Already prepared' } });
    if (mode === 'existing_document') {
      const { autonomousArtifactJobId } = await import('../melodi-artifact-tracking.js');
      const jobId = await autonomousArtifactJobId(OWNER, 'generate_document', `requested-research:${event.id}:document`);
      h.database.sql.prepare("INSERT INTO wa_owner_jobs (id,owner_phone,job_type,status) VALUES (?,?,'generate_document','complete')").run(jobId, OWNER);
    }
    const options = { db: h.database, owner: mode === 'foreign_owner' ? '18095550111' : OWNER, ...h.services, now: h.now };
    if (mode === 'claim_race') options.encrypt = async value => {
      const sealed = await h.services.encrypt(value);
      h.database.sql.prepare("UPDATE wa_melodi_work_events SET status='processing',lease_token='new-claim' WHERE id=?").run(event.id);
      return sealed;
    };
    assert.deepEqual(await repairOwnerResearchAssignments(options), [], mode);
    assert.equal(h.database.sql.prepare('SELECT agent FROM wa_melodi_work_events WHERE id=?').get(event.id).agent, 'melodi', mode);
    assert.equal(h.database.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_work_audit WHERE action='assignment_repaired'").get().n, 0, mode);
  }
});

async function harness({ now = '2026-10-08T13:30:00.000Z', generate, sendText, services: extraServices = {}, active = true, bootstrap,leader=false } = {}) {
  const database = new SqliteD1();
  for (const migration of ['melodi-team-coordination.sql', 'melodi-permissions.sql', 'melodi-routines.sql', 'melodi-autonomy-maintenance.sql', 'melodi-artifact-tracking.sql']) {
    database.sql.exec(readFileSync(new URL(`../${migration}`, import.meta.url), 'utf8'));
  }
  database.sql.exec(`CREATE TABLE wa_owner_jobs (id TEXT PRIMARY KEY, owner_phone TEXT, status TEXT, job_type TEXT,
    encrypted_payload TEXT, payload_iv TEXT, error_code TEXT, completed_at TEXT, created_at TEXT)`);
  let current = Date.parse(now);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const generated = [], sends = [], queued = [], emails = [], artifactSends = [], recorded = [];
  const services = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(value));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
      return { encrypted: Buffer.from(encrypted).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(encrypted, iv) {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64'));
      return JSON.parse(new TextDecoder().decode(plain));
    },
    async generate(agent, contents, prompt) {
      generated.push({ agent, contents, prompt });
      return generate ? generate(agent, contents, prompt) : { text: JSON.stringify({ action: 'message', message: `Tengo un avance concreto de ${agent}.`, needs_reply: true, checkpoint: { summary: 'Trabajo revisado' } }) };
    },
    async inspectWorkspace() { return { projects: [], calendar: [], jobs: [] }; },
    async privateJobInfo(owner, jobId) {
      const row = database.sql.prepare('SELECT * FROM wa_owner_jobs WHERE id=? AND owner_phone=?').get(jobId, owner);
      if (!row) return null;
      const payload = await services.decrypt(row.encrypted_payload, row.payload_iv);
      if (payload.deliveryMode !== 'private') return null;
      return { row, agent: payload.autonomyAgent, routineId: payload.autonomyRoutineId || null,
        channel: payload.autonomyChannel || 'auto', origin: payload.autonomyOrigin || 'autonomy', scheduledDelivery:Boolean(payload.deliveryAt) };
    },
    async deliverArtifact(...args) { artifactSends.push(args); return { status: 'sent' }; },
    async emailOwner(...args) { emails.push(args); return { status: 'sent' }; },
    ...extraServices,
  };
  const store = createAutonomyStore(database, { ...services, now: () => current });
  await store.ensureSchema();
  const coordinator = createTeamCoordinator(database, services);
  const env = { OWNER_WHATSAPP_NUMBER: OWNER, TEAM_AUTONOMY_ENABLED: String(active), VETSA_CLOUD: database,
    ...(leader?{TEAM_CONVERSATION_LEADER:'melodi'}:{}),
    TEAM_AUTONOMY_BOOTSTRAP: bootstrap,
    MELODI_JOBS: { async send(message) { queued.push(message); } },
  };
  const runtime = createAgentRuntime(env, { store, coordinator, services, now: () => current,
    async sendText(...args) { sends.push(args); if (sendText) return sendText(...args);return{status:'sent',messageId:'fixture-receipt-'+sends.length}; },
    async recordTurn(...args) { recorded.push(args); },
  });
  await runtime.initialize();
  return { runtime, store, coordinator, database, env, services, generated, sends, queued, emails, artifactSends, recorded,
    get now() { return new Date(current).toISOString(); }, advance(minutes) { current += minutes * 60000; } };
}

async function dueMotivation(h) {
  const routine=await h.runtime.routines.create({owner:OWNER,agent:'melodi',eventKey:'requested-motivation',kind:'motivational_message',frequency:'daily',
    title:'Frase motivacional diaria',brief:'Ayúdame a avanzar cada día.',hour:'10:00',channel:'auto'});
  h.advance(30);
  const [claimed]=await h.runtime.routines.claimDue({owner:OWNER});
  const queued=await h.store.enqueueEvent({owner:OWNER,agent:'melodi',eventKey:claimed.runKey,type:'motivational_message',payload:{routine:claimed,allowContact:false},priority:6});
  await h.runtime.routines.complete({owner:OWNER,id:claimed.id,leaseToken:claimed.leaseToken,success:true,now:h.now});
  return {routine,claimed,queued};
}
test('a daily Melodi message runs without research or documents and delivers once with the same identity',async()=>{
  const h=await harness({generate:async()=>({phrase:'Termina hoy ese paso pendiente. Tu siguiente avance puede empezar ahí.'})});
  const {queued}=await dueMotivation(h);await h.runtime.runAgent('melodi');
  assert.equal(h.generated.length,1);assert.equal(h.generated[0].agent,'melodi');
  assert.equal(h.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(queued.id).status,'done');
  await h.runtime.deliverOutbox();await h.runtime.deliverOutbox();
  assert.equal(h.sends.length,1);assert.match(h.sends[0][2],/^Termina hoy/);assert.equal(h.sends[0][3].agent,'melodi');assert.equal(h.artifactSends.length,0);
  assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n,0);
});

test('a requested daily Melodi phrase reaches WhatsApp through Melodi while Melodi owns the conversation, without takeover',async()=>{
  const phrase='Dedica diez minutos a ese paso que llevas posponiendo.';
  const h=await harness({leader:true,generate:async()=>({phrase})});
  await selectOwnerSpeaker(h.env,OWNER,'melodi','owner-selected-melodi',new Date(h.now));
  await h.coordinator.recordOwnerReply(OWNER,'melodi',h.now);
  const {queued}=await dueMotivation(h);
  await h.runtime.runAgent('melodi');
  const pending=h.database.sql.prepare('SELECT * FROM wa_melodi_work_outbox').get();
  assert.equal(pending.agent,'melodi');assert.equal(pending.status,'pending');
  const decoded=await h.services.decrypt(pending.payload_encrypted,pending.payload_iv);
  const payload=typeof decoded==='string' ? JSON.parse(decoded):decoded;
  assert.equal(payload.routineMessage,true);assert.equal(payload.channel,'auto');
  assert.equal(h.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(queued.id).status,'done');
  await h.runtime.deliverOutbox();await h.runtime.deliverOutbox();
  assert.equal(h.sends.length,1,'A verified daily phrase must not stay pending behind the selected conversation');
  assert.equal(h.sends[0][2],phrase);assert.equal(h.sends[0][3].agent,'melodi');
  assert.equal(h.emails.length,0,'Another selected conversation is not a WhatsApp delivery failure');
  assert.equal(h.artifactSends.length,0);assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n,0);
  assert.equal(h.database.sql.prepare('SELECT status FROM wa_melodi_work_outbox WHERE id=?').get(pending.id).status,'sent');
  assert.equal((await h.coordinator.settings(OWNER)).conversation_agent,'melodi');
  assert.equal(await currentOwnerSpeaker(h.env,OWNER,new Date(h.now)),'melodi');
  assert.equal(h.recorded.length,1);assert.equal(h.generated.length,1);
});

test('an explicit monthly reminder delivers at 22 RD once and uses the assigned agent without a model',async()=>{
  const h=await harness({now:'2026-11-07T01:59:00Z'});
  await h.runtime.routines.create({owner:OWNER,agent:'melodi',eventKey:'monthly-night',kind:'recurring_reminder',frequency:'monthly',dayOfMonth:6,hour:'22:00',title:'Renovar Google One y ChatGPT Plus'});
  h.advance(1);
  const [routine]=await h.runtime.routines.claimDue({owner:OWNER});
  await h.store.enqueueEvent({owner:OWNER,agent:'melodi',eventKey:routine.runKey,type:'recurring_reminder',payload:{routine,allowContact:false},priority:6});
  await h.runtime.routines.complete({owner:OWNER,id:routine.id,leaseToken:routine.leaseToken,success:true,now:h.now});
  await h.runtime.runAgent('melodi');await h.runtime.deliverOutbox();await h.runtime.deliverOutbox();
  assert.equal(h.generated.length,0);assert.equal(h.sends.length,1);assert.match(h.sends[0][2],/ya es hora de renovar Google One y ChatGPT Plus/);
});

test('monthly reminder uses verified email fallback when the WhatsApp window is closed',async()=>{
  const h=await harness({now:'2026-11-07T12:59:00Z',sendText:async()=>{throw new Error('Meta 131047 window closed');}});
  await h.runtime.routines.create({owner:OWNER,agent:'melodi',eventKey:'monthly-window',kind:'recurring_reminder',frequency:'monthly',dayOfMonth:7,title:'Renovar internet'});
  h.advance(1);const [routine]=await h.runtime.routines.claimDue({owner:OWNER});
  await h.store.enqueueEvent({owner:OWNER,agent:'melodi',eventKey:routine.runKey,type:'recurring_reminder',payload:{routine,allowContact:false},priority:6});
  await h.runtime.routines.complete({owner:OWNER,id:routine.id,leaseToken:routine.leaseToken,success:true,now:h.now});
  await h.runtime.runAgent('melodi');await h.runtime.deliverOutbox();await h.runtime.deliverOutbox();
  assert.equal(h.emails.length,1);assert.equal(h.emails[0][2],'melodi');assert.equal(h.generated.length,0);
});
test('stopping the daily routine before delivery cancels the pending phrase',async()=>{
  const h=await harness({generate:async()=>({phrase:'Haz hoy ese paso que llevas posponiendo.'})});
  const {routine}=await dueMotivation(h);await h.runtime.runAgent('melodi');await h.runtime.routines.cancel({owner:OWNER,id:routine.id});
  await h.runtime.deliverOutbox();assert.equal(h.sends.length,0);assert.equal(h.emails.length,0);
  assert.equal(h.database.sql.prepare('SELECT status,error_code FROM wa_melodi_work_outbox').get().error_code,'cancelled');
});
test('a cancelled routine during generation never enqueues the phrase',async()=>{
  let h;
  h=await harness({generate:async()=>{await h.runtime.routines.cancel({owner:OWNER,agent:'melodi'});return {phrase:'Empieza por ese paso que sí puedes dar hoy.'};}});
  await dueMotivation(h);await h.runtime.runAgent('melodi');assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_work_outbox').get().n,0);
});
test('a Calendar instance retime holds a daily message without generation until the new time',async()=>{
  const h=await harness({generate:async()=>({phrase:'Un paso pequeño también cuenta. Dale espacio hoy.'})});
  const {claimed,queued}=await dueMotivation(h);
  const row=h.database.sql.prepare('SELECT * FROM wa_melodi_routines WHERE id=?').get(claimed.id);
  const decoded=await h.services.decrypt(row.payload_encrypted,row.payload_iv),payload=typeof decoded==='string' ? JSON.parse(decoded):decoded;
  const sealed=await h.services.encrypt(JSON.stringify({...payload,calendarExceptions:{[claimed.originalOccurrenceAt]:{status:'updated',startAt:'2026-10-08T15:00:00.000Z',title:payload.title}}}));
  h.database.sql.prepare('UPDATE wa_melodi_routines SET payload_encrypted=?,payload_iv=? WHERE id=?').run(sealed.encrypted,sealed.iv,claimed.id);
  await h.runtime.runAgent('melodi');assert.equal(h.generated.length,0);
  const pending=h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(queued.id);assert.equal(pending.attempts,0);assert.equal(pending.available_at,Date.parse('2026-10-08T15:00:00Z'));
  h.advance(60);await h.runtime.runAgent('melodi');assert.equal(h.generated.length,1);await h.runtime.deliverOutbox();assert.equal(h.sends.length,1);
});
test('daily messages use Melodi email fallback when WhatsApp rejects a closed window',async()=>{
  const h=await harness({generate:async()=>({phrase:'Dale diez minutos hoy a eso que quieres construir.'}),sendText:async()=>{throw new Error('WhatsApp API 131047');}});
  await dueMotivation(h);await h.runtime.runAgent('melodi');await h.runtime.deliverOutbox();
  assert.equal(h.emails.length,1);assert.equal(h.emails[0][2],'melodi');assert.match(h.emails[0][3],/^Dale diez minutos/);
});
test('one-time restoration persists a single Melodi routine and cannot reactivate it after stopping',async()=>{
  const h=await harness();h.env.REQUESTED_MOTIVATION_RESTORE_REV='test-restore';
  await h.runtime.tick();await h.runtime.tick();
  const items=await h.runtime.routines.list(OWNER,'melodi');assert.equal(items.length,1);assert.equal(items[0].frequency,'daily');
  assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n,1);
  await h.runtime.routines.cancel({owner:OWNER,id:items[0].id});await h.runtime.tick();assert.equal((await h.runtime.routines.list(OWNER,'melodi'))[0].status,'stopped');
});

test('requested media extraction polls durably without spending analysis retries and stops after fifteen minutes', async () => {
  const sourceUrl = 'https://www.instagram.com/reel/EXACT/?igsh=original';
  const inputs = [];
  const h = await harness({ services: {
    extractPublicMedia: async input => { inputs.push(input); return { status: 'pending', sourceUrl, operationId: 'durable-media-operation', verified: true, retryAfterMs: 60000 }; },
    readPublicSource: async () => assert.fail('No textual fallback while media is pending'),
    prepareDocument: async () => assert.fail('No PDF before the media evidence is ready'),
  } });
  const queued = await h.runtime.control({ action: 'research_request', agent: 'melodi', messageId: 'media-owner-message', request: {
    agent: 'melodi', sourceUrl, scope: 'single_post', recipient: 'owner', channel: 'email', brief: 'Analiza los medios de esta publicación.' } });
  const startedAt = Date.parse(h.now);
  for (let i = 0; i < 4; i++) {
    await h.runtime.runAgent('melodi');
    const row = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(queued.eventId);
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
    const payload = JSON.parse(await h.services.decrypt(row.payload_encrypted, row.payload_iv));
    assert.equal(payload.mediaOperation.operationId, 'durable-media-operation');
    assert.equal(payload.mediaOperation.startedAt, startedAt);
    assert.equal(payload.mediaOperation.eventId, queued.eventId);
    assert.equal(JSON.stringify(row).includes('durable-media-operation'), false);
    assert.equal((await h.runtime.notices.peek({ owner: OWNER, now: h.now })).length, 0);
    h.advance(1);
  }
  assert.ok(inputs.every(input => input.ownerPhone === OWNER && input.agent === 'melodi' && input.eventId === queued.eventId));
  assert.equal(inputs[1].operationId, 'durable-media-operation');
  assert.equal(h.generated.length, 0);
  h.advance(11);
  await h.runtime.runAgent('melodi');
  assert.equal(inputs.length, 4);
  assert.equal(h.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(queued.eventId).status, 'done');
  const outbox = h.database.sql.prepare('SELECT * FROM wa_melodi_work_outbox WHERE event_id=?').get(queued.eventId);
  const payload = JSON.parse(await h.services.decrypt(outbox.payload_encrypted, outbox.payload_iv));
  assert.equal(outbox.agent, 'melodi');
  assert.equal(payload.ownerRequested, true);
  assert.match(payload.body, /no terminó dentro del plazo/);
  assert.doesNotMatch(payload.body, /(?:informe enviado|documento completado)/i);
  assert.equal(h.generated.length, 0);
});

test('a level-zero research requester waits for media permission and an approved helper retains the original agent and operation', async () => {
  const sourceUrl = 'https://www.instagram.com/reel/EXACT/?igsh=original';
  const inputs = [];
  const quote = 'Se muestran dos estados diferentes en paneles paralelos.';
  const h = await harness({ generate: async () => ({ formats: [{ name: 'Comparativa', source_url: sourceUrl, evidence_quote: quote }] }),
    services: { extractPublicMedia: async input => { inputs.push(input);
      if (inputs.length < 4) return { status: 'pending', sourceUrl, operationId: 'approved-media-job', verified: true, retryAfterMs: 60000 };
      return { status: 'ready', sourceUrl, verified: true, media: [{ id: 'image-1', kind: 'image', analysis: { summary: quote,
        observedFormats: [{ name: 'Comparativa', evidence: quote, observed: true, frameIndex: 0 }] }, coverage: { complete: true } }], coverage: { complete: true } };
    }, readPublicSource: async () => assert.fail('No fallback from the approved media operation'),
    prepareDocument: async () => assert.fail('Document permission is separate and has not yet been granted') } });
  await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 0, eventKey: 'owner-lowers-melodi' });
  const queued = await h.runtime.control({ action: 'research_request', agent: 'melodi', messageId: 'approved-media-owner-request', request: {
    agent: 'melodi', sourceUrl, scope: 'single_post', recipient: 'owner', channel: 'email', brief: 'Investiga el reel original.' } });
  await h.runtime.runAgent('melodi');
  assert.equal(inputs.length, 0);
  const permission = (await h.runtime.permissions.listPending(OWNER)).find(row => row.tool === 'inspect_public_media');
  assert.equal(permission.requester, 'melodi');
  assert.equal(permission.helper, 'melodi');
  await h.runtime.control({ action: 'approval', approvalId: permission.id, approved: true, messageId: 'owner-approves-media' });
  await h.runtime.runAgent('melodi');
  assert.equal(inputs.length, 1);
  for (let i = 0; i < 3; i++) { await h.runtime.runAgent('melodi'); h.advance(1); }
  assert.equal(inputs.length, 4);
  assert.ok(inputs.every(input => input.agent === 'melodi' && input.ownerPhone === OWNER && input.eventId === queued.eventId));
  assert.equal(inputs[1].operationId, 'approved-media-job');
  const mediaApprovals = h.database.sql.prepare("SELECT * FROM wa_melodi_permission_requests WHERE tool='inspect_public_media'").all();
  assert.equal(mediaApprovals.length, 1);
  assert.equal(mediaApprovals[0].status, 'completed');
  const documentPermission = (await h.runtime.permissions.listPending(OWNER)).find(row => row.tool === 'prepare_document');
  assert.equal(documentPermission.requester, 'melodi');
  assert.equal(documentPermission.helper, 'melodi');
});

test('an autonomous media tool survives four polls as one owner-agent operation without another model, read or action before ready', async () => {
  const url = 'https://www.instagram.com/reel/AUTONOMOUS/?igsh=exact';
  const inputs = [];
  let workspaceReads = 0, generations = 0;
  const h = await harness({ generate: async (_agent, input) => {
    generations++;
    if (input.observations.some(row => row.receipt?.tool === 'inspect_public_media' && row.status === 'ready')) {
      return { action: 'wait', checkpoint: { summary: 'Medios inspeccionados; observaciones verificadas recibidas.' } };
    }
    return { action: 'tool', tool: 'inspect_public_media', input: { url } };
  }, services: { inspectWorkspace: async () => { workspaceReads++; return { projects: [], calendar: [], jobs: [] }; },
    extractPublicMedia: async input => { inputs.push(input);
      if (inputs.length <= 4) return { status: 'pending', sourceUrl: url, verified: true, operationId: 'same-autonomous-operation', retryAfterMs: 60000 };
      return { status: 'ready', sourceUrl: url, verified: true, media: [{ id: 'image-1', kind: 'image', analysis: { summary: 'Dos paneles con estados distintos.' }, coverage: { complete: true } }], coverage: { complete: true } };
    } } });
  await h.store.configureAgent({ owner: OWNER, agent: 'melodi', config: { dailyRunLimit: 1 } });
  const accepted = await event(h, 'melodi', 'autonomous-media-poll', { payload: { allowContact: true } });
  for (let poll = 0; poll < 4; poll++) {
    await h.runtime.runAgent('melodi');
    const row = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(accepted.id);
    assert.equal(row.status, 'pending');
    assert.equal(row.type, 'public_media_poll');
    assert.equal(row.attempts, 0);
    const payload = JSON.parse(await h.services.decrypt(row.payload_encrypted, row.payload_iv));
    assert.equal(payload.pendingTool.name, 'inspect_public_media');
    assert.equal(payload.pendingTool.url, url);
    assert.equal(payload.pendingTool.originalType, 'delegation');
    assert.equal(payload.pendingTool.eventId, `${accepted.id}:public-media`);
    assert.equal(payload.mediaOperation.operationId, 'same-autonomous-operation');
    assert.equal(generations, 1);
    assert.equal(workspaceReads, 1);
    assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_work_outbox').get().n, 0);
    assert.equal(JSON.stringify(row).includes('same-autonomous-operation'), false);
    assert.equal((await h.store.listStates(OWNER)).find(row => row.agent === 'melodi').runs_today, 1);
    h.advance(1);
  }
  await h.runtime.runAgent('melodi');
  assert.equal(inputs.length, 5);
  assert.equal(generations, 2);
  assert.equal(workspaceReads, 1);
  assert.ok(inputs.every(input => input.agent === 'melodi' && input.ownerPhone === OWNER && input.url === url && input.eventId === `${accepted.id}:public-media`));
  assert.ok(inputs.slice(1).every(input => input.operationId === 'same-autonomous-operation'));
  assert.equal(h.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(accepted.id).status, 'done');
  assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_work_events').get().n, 1);
  assert.equal(h.sends.length, 0);
});

test('autonomous media polling stops at its deadline or changed permissions without a new operation or another model decision', async () => {
  const url = 'https://instagram.com/reel/AUTONOMOUS/';
  for (const mode of ['deadline', 'permissions']) {
    let extractions = 0, models = 0;
    const h = await harness({ generate: async () => { models++; return { action: 'tool', tool: 'inspect_public_media', input: { url } }; },
      services: { extractPublicMedia: async () => { extractions++; return { status: 'pending', verified: true, sourceUrl: url, operationId: 'one-operation', retryAfterMs: 60000 }; } } });
    const accepted = await event(h, 'melodi', `stop-media-${mode}`);
    await h.runtime.runAgent('melodi');
    if (mode === 'permissions') await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 0, eventKey: 'owner-revokes-media' });
    h.advance(mode === 'deadline' ? 15 : 1);
    await h.runtime.runAgent('melodi');
    const row = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(accepted.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.error_code, mode === 'deadline' ? 'media_processing_timeout' : 'media_permission_revoked');
    assert.equal(extractions, 1);
    assert.equal(models, 1);
    assert.equal(h.sends.length, 0);
    assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_work_outbox').get().n, 0);
  }
});

test('repeated ready inspections within one model turn use the same public-media event identity', async () => {
  const url = 'https://instagram.com/p/READY/';
  const inputs = [];
  let steps = 0;
  const h = await harness({ generate: async () => ++steps < 3 ? { action: 'tool', tool: 'inspect_public_media', input: { url } } : { action: 'wait' },
    services: { extractPublicMedia: async input => { inputs.push(input); return { status: 'ready', sourceUrl: url, verified: true,
      media: [{ id: 'image-1', kind: 'image', analysis: { summary: 'La imagen contiene un objeto.' } }] }; } } });
  const accepted = await event(h, 'melodi', 'repeat-read-id');
  await h.runtime.runAgent('melodi');
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].eventId, `${accepted.id}:public-media`);
  assert.equal(inputs[1].eventId, inputs[0].eventId);
  assert.equal(inputs[1].idempotencyKey, inputs[0].idempotencyKey);
});

test('approved generic media inspection preserves the requester and polls the grant operation without another approval', async () => {
  const url = 'https://instagram.com/reel/APPROVED/';
  const inputs = [];
  let models = 0;
  const h = await harness({ generate: async (_agent, input) => {
    models++;
    return input.observations.some(row => row.receipt?.tool === 'inspect_public_media' && row.status === 'ready')
      ? { action: 'wait', checkpoint: { summary: 'Observación inspeccionada.' } }
      : { action: 'tool', tool: 'inspect_public_media', input: { url } };
  }, services: { extractPublicMedia: async input => { inputs.push(input);
    return inputs.length < 4 ? { status: 'pending', verified: true, sourceUrl: url, operationId: 'approved-generic-operation', retryAfterMs: 60000 }
      : { status: 'ready', verified: true, sourceUrl: url, media: [{ id: 'image-1', kind: 'image', analysis: { summary: 'Un panel visible.' } }] };
  } } });
  await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 0, eventKey: 'owner-level-zero' });
  await event(h, 'melodi', 'approval-for-read');
  await h.runtime.runAgent('melodi');
  assert.equal(inputs.length, 0);
  const approval = (await h.runtime.permissions.listPending(OWNER)).find(row => row.tool === 'inspect_public_media');
  assert.equal(approval.requester, 'melodi');
  await h.runtime.control({ action: 'approval', approvalId: approval.id, approved: true, messageId: 'approve-generic-read' });
  await h.runtime.runAgent(approval.helper);
  assert.equal(inputs[0].agent, 'melodi');
  for (let i = 0; i < 3; i++) { await h.runtime.runAgent('melodi'); h.advance(1); }
  assert.equal(inputs.length, 4);
  assert.ok(inputs.every(input => input.agent === 'melodi' && input.eventId === `approved:${approval.id}` && input.ownerPhone === OWNER));
  assert.ok(inputs.slice(1).every(input => input.operationId === 'approved-generic-operation'));
  assert.equal(h.database.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_permission_requests WHERE tool='inspect_public_media'").get().n, 1);
  assert.equal(h.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).status, 'completed');
  assert.equal(models, 2);
});

test('approved generic media polling stops when the helper authorization changes or another source replaces the approved URL', async () => {
  for (const mode of ['helper_revoked', 'changed_source']) {
    const url = 'https://instagram.com/reel/APPROVED/';
    let calls = 0;
    const h = await harness({ generate: async () => ({ action: 'tool', tool: 'inspect_public_media', input: { url } }),
      services: { extractPublicMedia: async () => { calls++; return { status: 'pending', verified: true, sourceUrl: url,
        operationId: 'approved-original-operation', retryAfterMs: 60000 }; } } });
    await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 0, eventKey: `initial:${mode}` });
    await event(h, 'melodi', `permission:${mode}`);
    await h.runtime.runAgent('melodi');
    const approval = (await h.runtime.permissions.listPending(OWNER)).find(row => row.tool === 'inspect_public_media');
    await h.runtime.control({ action: 'approval', approvalId: approval.id, approved: true, messageId: `approve:${mode}` });
    await h.runtime.runAgent(approval.helper);
    const poll = h.database.sql.prepare("SELECT * FROM wa_melodi_work_events WHERE type='public_media_poll'").get();
    assert.equal(calls, 1);
    if (mode === 'helper_revoked') {
      await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: approval.helper, level: 0, eventKey: 'owner-revokes-helper' });
    } else {
      const payload = JSON.parse(await h.services.decrypt(poll.payload_encrypted, poll.payload_iv));
      payload.pendingTool.url = 'https://instagram.com/reel/NOT_APPROVED/';
      const sealed = await h.services.encrypt(JSON.stringify(payload));
      h.database.sql.prepare('UPDATE wa_melodi_work_events SET payload_encrypted=?,payload_iv=? WHERE id=?').run(sealed.encrypted, sealed.iv, poll.id);
    }
    await h.runtime.runAgent('melodi');
    const row = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(poll.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.error_code, 'media_permission_revoked');
    assert.equal(calls, 1);
    assert.equal(h.generated.length, 1);
  }
});

test('media activation resumes only the configured original email request and announces once before its new result', async () => {
  const sourceUrl = 'https://www.instagram.com/p/ORIGINAL/?source=unchanged';
  const inputs = [];
  const h = await harness({ services: { extractPublicMedia: async input => { inputs.push(input);
    return { status: 'blocked', sourceUrl, reason: 'no_public_media' };
  }, readPublicSource: async () => assert.fail('A connected unavailable media source cannot silently fall back') } });
  const accepted = await h.runtime.control({ action: 'research_request', agent: 'melodi', messageId: 'original-owner-media', request: {
    agent: 'melodi', sourceUrl, scope: 'single_post', channel: 'email', recipient: 'owner', brief: 'Mi encargo original, con instrucciones exactas.' } });
  h.database.sql.prepare("UPDATE wa_melodi_work_events SET status='done',error_code='requested_research_source_unavailable',attempts=3 WHERE id=?").run(accepted.eventId);
  const before = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(accepted.eventId);
  const old = await h.store.enqueueOutbox({ owner: OWNER, agent: 'melodi', eventId: accepted.eventId,
    messageKey: `requested-research-blocked:${accepted.eventId}`, payload: { body: 'Melodi: El contenido anterior no estaba disponible.' } });
  h.database.sql.prepare("UPDATE wa_melodi_work_outbox SET status='sent' WHERE id=?").run(old.id);
  h.env.PUBLIC_MEDIA_RESUME_EVENT_ID = accepted.eventId;
  h.env.PUBLIC_MEDIA_ANALYSIS_ENABLED = 'true';
  await h.runtime.tick();
  await h.runtime.tick();
  const resumed = h.database.sql.prepare('SELECT * FROM wa_melodi_work_events WHERE id=?').get(accepted.eventId);
  assert.equal(resumed.status, 'pending');
  assert.equal(resumed.agent, 'melodi');
  assert.equal(resumed.payload_encrypted, before.payload_encrypted);
  assert.equal(resumed.payload_iv, before.payload_iv);
  assert.equal(resumed.event_key, before.event_key);
  assert.equal(resumed.attempts, 0);
  assert.equal(h.database.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_work_audit WHERE event_id=? AND action='media_activation_resume'").get(accepted.eventId).n, 1);
  const notice = h.database.sql.prepare('SELECT * FROM wa_melodi_delivery_notices').get();
  const noticePayload = JSON.parse(await h.services.decrypt(notice.payload_encrypted, notice.payload_iv));
  assert.equal(notice.agent, 'melodi');
  assert.match(noticePayload.body, /^Melodi: Retomaré tu encargo original/);
  assert.match(noticePayload.body, /te avisaré del resultado/);
  assert.equal(h.sends.filter(args => /Retomaré tu encargo original/.test(args[2])).length, 1);
  assert.equal(inputs.length, 0);
  await h.runtime.runAgent('melodi');
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].agent, 'melodi');
  assert.equal(inputs[0].eventId, accepted.eventId);
  assert.equal(inputs[0].url, sourceUrl);
  const outboxes = h.database.sql.prepare('SELECT * FROM wa_melodi_work_outbox WHERE event_id=?').all(accepted.eventId);
  assert.equal(outboxes.length, 2);
  assert.equal(outboxes.find(row => row.id !== old.id).status, 'pending');
  await h.runtime.tick();
  assert.equal(h.database.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_work_audit WHERE event_id=? AND action='media_activation_resume'").get(accepted.eventId).n, 1);
  assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, 1);
});

test('media activation remains dormant without the explicit feature flag and a connected extraction service', async () => {
  for (const mode of ['disabled', 'not_connected']) {
    const h = await harness({ services: { extractPublicMedia: mode === 'not_connected' ? null : async () => assert.fail('No activation without its flag') } });
    const request = await h.runtime.control({ action: 'research_request', agent: 'melodi', messageId: mode, request: {
      agent: 'melodi', sourceUrl: 'https://instagram.com/p/ORIGINAL/', scope: 'single_post', channel: 'email', recipient: 'owner', brief: 'Original request' } });
    h.database.sql.prepare("UPDATE wa_melodi_work_events SET status='done',error_code='requested_research_source_unavailable' WHERE id=?").run(request.eventId);
    h.env.PUBLIC_MEDIA_RESUME_EVENT_ID = request.eventId;
    h.env.PUBLIC_MEDIA_ANALYSIS_ENABLED = mode === 'disabled' ? 'false' : 'true';
    await h.runtime.tick();
    assert.equal(h.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(request.eventId).status, 'done');
    assert.equal(h.database.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_work_audit WHERE action='media_activation_resume'").get().n, 0);
    assert.equal(h.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, 0);
  }
});

test('first launch creates no generic review work or unsolicited contact', async()=>{
  let writes=0;
  const context=await harness({ now:'2026-10-08T03:35:00Z',bootstrap:'verified-release',
    generate:async()=>({text:JSON.stringify({action:'tool',tool:'prepare_story',input:{brief:'Una propuesta inicial'}})}),
    services:{prepareStory:async()=>{writes++;return {status:'queued',jobId:'unexpected'}}} });
  await context.runtime.tick(); await context.runtime.tick();
  for(const agent of AGENTS) {
    assert.equal((await context.store.listEvents({owner:OWNER,agent})).filter(row=>row.type==='team_bootstrap').length,0);
    await context.runtime.runAgent(agent);
  }
  assert.equal(writes,0); assert.equal(context.generated.length,0); assert.equal(context.sends.length,0);
  assert.equal((await context.store.listStates(OWNER)).reduce((n,row)=>n+row.outboxCounts.pending,0),0);
});

const event = (context, agent, key = `${agent}-event`, extra = {}) => context.store.enqueueEvent({ owner: OWNER, agent, eventKey: key,
  type: 'delegation', payload: { allowContact: false, task: 'Encargo concreto autorizado para esta prueba de ejecución.' }, ...extra });
const message = (context, agent = 'melodi', key = `${agent}-message`, extra = {}) => context.store.enqueueOutbox({ owner: OWNER, agent, messageKey: key,
  payload: { body: `${agent}: un avance concreto.`, needsReply: true }, ...extra });

async function requestedMessage(context, agent = 'melodi', key = `${agent}-requested-message`) {
  const parent = await context.store.enqueueEvent({ owner: OWNER, agent, eventKey: `request:${key}`, type: 'owner_research_report',
    payload: { request: { origin: 'owner_request', brief: 'Comprueba mi encargo.' } } });
  context.database.sql.prepare("UPDATE wa_melodi_work_events SET status='done' WHERE id=?").run(parent.id);
  return context.store.enqueueOutbox({ owner: OWNER, agent, eventId: parent.id, messageKey: key,
    payload: { body: `${agent}: No pude verificar la fuente de tu encargo.`, ownerRequested: true, ownerRequestEventId: parent.id } });
}

test('a spontaneous proposal is rejected and never owns the owner conversation',async()=>{
  const h=await harness();
  await message(h,'melodi','melodi-proposal',{payload:{body:'Melodi: Me gustaría investigar Cognira Desktop y su utilidad.',needsReply:false}});
  await h.runtime.deliverOutbox();assert.equal(h.sends.length,0);
  assert.equal((await h.coordinator.settings(OWNER)).conversation_agent,null);
  assert.equal((await h.store.getState(OWNER,'melodi')).outboxCounts.failed,1);
});

test('a failed spontaneous proposal does not take over the shared conversation',async()=>{
  const h=await harness({sendText:async()=>{throw Error('WhatsApp returned 400');}});
  await message(h,'melodi','melodi-failed-proposal',{payload:{body:'Melodi: Me gustaría investigar Cognira Desktop.',needsReply:false}});
  await h.runtime.deliverOutbox();assert.notEqual((await h.coordinator.settings(OWNER)).conversation_agent,'melodi');
});

async function completedArtifact(context, { agent = 'melodi', jobId = `doc-${agent}`, routineId = null, channel = 'auto', origin = 'autonomy', enqueue = true, deliveryAt } = {}) {
  const sealed = await context.services.encrypt({ deliveryMode: 'private', autonomyAgent: agent, autonomyChannel: channel,
    autonomyRoutineId: routineId, autonomyOrigin: origin, ...(deliveryAt?{deliveryAt}: {}) });
  context.database.sql.prepare(`INSERT INTO wa_owner_jobs (id,owner_phone,status,job_type,encrypted_payload,payload_iv,created_at,completed_at)
    VALUES (?,?,'complete','generate_document',?,?,?,?)`).run(jobId, OWNER, sealed.encrypted, sealed.iv, context.now, context.now);
  await context.runtime.artifacts.register({ owner: OWNER, agent, jobId, jobType: 'generate_document', routineId, channel });
  if (!enqueue) return { jobId };
  const claimed = await context.runtime.artifacts.claim({ owner: OWNER, jobId, now: context.now });
  const outbox = await context.store.enqueueOutbox({ owner: OWNER, agent, messageKey: `artifact:${jobId}`,
    payload: { body: `${agent}: Tu documento solicitado.`, artifactJobId: jobId, routineId, channel,
      ownerRequested: origin === 'owner_request', needsReply: !routineId } });
  await context.runtime.artifacts.markEnqueued({ owner: OWNER, jobId, token: claimed.token, outboxId: outbox.id, now: context.now });
  return { jobId, outbox };
}

test('a prepared document waits for its calendar deadline and rechecks cancellation or retiming before queued delivery',async()=>{
 for(const mode of ['waiting','cancelled','retimed']) {
  const h=await harness({now:new Date().toISOString()}),dueAt=new Date(Date.parse(h.now)+600000).toISOString();
  h.database.sql.exec(`CREATE TABLE melodi_calendar_events(id TEXT PRIMARY KEY,phone TEXT,title TEXT,event_at TEXT,event_type TEXT,assigned_agent TEXT,created_at TEXT,updated_at TEXT,reminded_at TEXT)`);
  const eventId=await registerDocumentSchedule(h.env,{owner:OWNER,agent:'melodi',jobId:'deadline-doc',dueAt,title:'Alexa AI de Electro Wisly'});
  await completedArtifact(h,{jobId:'deadline-doc',origin:'owner_request',deliveryAt:dueAt,enqueue:mode!=='waiting'});
  if(mode==='cancelled')h.database.sql.prepare('DELETE FROM melodi_calendar_events WHERE id=?').run(eventId);
  if(mode==='retimed')h.database.sql.prepare('UPDATE melodi_calendar_events SET event_at=? WHERE id=?').run(new Date(Date.parse(h.now)+3600000).toISOString(),eventId);
  await h.runtime.deliverOutbox();assert.equal(h.artifactSends.length,0);assert.equal(h.emails.length,0);
  if(mode==='waiting') { await h.runtime.tick();assert.equal(h.database.sql.prepare('SELECT count(*) n FROM wa_melodi_work_outbox WHERE agent=\'melodi\'').get().n,0); }
  h.advance(11);await h.runtime.tick();await h.runtime.deliverOutbox();
  assert.equal(h.artifactSends.length+h.emails.length,mode==='waiting'?1:0);
  if(mode==='waiting') {assert.ok(h.database.sql.prepare('SELECT reminded_at FROM melodi_calendar_events WHERE id=?').get(eventId).reminded_at);await h.runtime.deliverOutbox();assert.equal(h.artifactSends.length+h.emails.length,1);}
 }
});

test('a clock tick dispatches an outbox check without manufacturing agent assignments', async () => {
  const context = await harness({ now: '2026-10-08T12:16:00Z' });
  const result = await context.runtime.tick();
  assert.equal(result.enabled, true);
  assert.equal(result.dispatched, 0);
  assert.deepEqual(context.queued, [{ type: 'autonomy_outbox',calendarReady:true }]);
  await context.runtime.tick();
  assert.equal((await context.store.listEvents({ owner: OWNER, agent: 'melodi' })).length, 0);
});

test('a focused personal goal reaches only its assigned agent and only she may contact the owner', async () => {
  const context = await harness();
  const secret = 'Mi meta personal absolutamente privada';
  await context.runtime.control({ action: 'set_goal', agent: 'melodi', goal: { title: secret, description: 'Detalles privados' }, messageId: 'goal-message-1' });
  for (const agent of AGENTS.slice(1)) await event(context, agent);
  await Promise.all(AGENTS.map(agent => context.runtime.runAgent(agent)));
  for (const call of context.generated) {
    assert.equal(call.contents.assigned_personal_goal?.title ?? null, call.agent === 'melodi' ? secret : null);
    assert.equal(JSON.stringify(call.contents).includes(secret), call.agent === 'melodi');
  }
  const status = await context.runtime.status();
  assert.equal(status.focusAgent, 'melodi');
  assert.equal(status.agents.find(state => state.agent === 'melodi').outboxCounts.pending, 0);
  for (const agent of AGENTS.slice(1)) assert.equal(status.agents.find(state => state.agent === agent).outboxCounts.pending, 0);
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.length, 0);
  assert.equal(JSON.stringify(status).includes(secret), false);
});

test('background review and observed owner context update state without spontaneous messages', async () => {
  const context = await harness();
  await event(context, 'melodi', 'background', { type: 'background_review', payload: { allowContact: false } });
  await context.runtime.observeOwner({ messageId: 'incoming-1', message: 'Una actualización privada', agent: 'melodi' });
  assert.equal((await context.coordinator.context(OWNER, 'melodi')).message, 'Una actualización privada');
  assert.deepEqual(await context.store.listEvents({ owner: OWNER, agent: 'melodi' }), []);
  await event(context, 'melodi', 'background-melodi', { type: 'background_review', payload: { allowContact: false } });
  await context.runtime.runAgent('melodi');
  await context.runtime.runAgent('melodi');
  assert.ok(await context.store.getCheckpoint(OWNER, 'melodi'));
  assert.ok(await context.store.getCheckpoint(OWNER, 'melodi'));
  assert.equal(context.generated.length, 0);
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.length, 0);
  for (const agent of ['melodi']) assert.equal((await context.store.getState(OWNER, agent)).outboxCounts.pending, 0);
});

test('personal goals cannot be delegated even when the model requests another teammate', async () => {
  let step = 0;
  const context = await harness({ generate: async () => ({ text: JSON.stringify(step++ === 0
    ? { action: 'tool', tool: 'delegate_agent_event', input: { target: 'melodi', task: 'Mi meta privada' } }
    : { action: 'wait', checkpoint: { summary: 'Retengo mi meta privada' } }) }) });
  await context.runtime.control({ action: 'set_goal', agent: 'melodi', goal: { title: 'Meta privada' }, messageId: 'goal-private' });
  await context.runtime.runAgent('melodi');
  assert.deepEqual(await context.store.listEvents({ owner: OWNER, agent: 'melodi' }), []);
  assert.equal(context.generated.length, 1);
  assert.deepEqual(await context.runtime.permissions.listPending(OWNER), []);
  assert.equal((await context.store.getState(OWNER, 'melodi')).eventCounts.done, 1);
});

test('parallel outbox processors quarantine all legacy spontaneous conversations', async () => {
  const context = await harness();
  for (const agent of AGENTS) await message(context, agent);
  await Promise.all([context.runtime.deliverOutbox(), context.runtime.deliverOutbox(), context.runtime.deliverOutbox()]);
  assert.equal(context.sends.length, 0);
  assert.equal((await context.coordinator.settings(OWNER)).conversation_agent, null);
  const states = await context.store.listStates(OWNER);
  assert.equal(states.reduce((count, state) => count + state.outboxCounts.sent, 0), 0);
  assert.equal(states.reduce((count, state) => count + state.outboxCounts.failed, 0), 4);
});

test('WhatsApp 131047 falls back to owner email and records one successful receipt', async () => {
  const context = await harness({ sendText: async () => { throw new Error('WhatsApp returned 400: code 131047'); } });
  await requestedMessage(context);
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.filter(row => /No pude verificar/.test(row[2])).length, 1);
  assert.equal(context.emails.length, 1);
  assert.equal(context.emails[0][0], OWNER);
  assert.equal(context.emails[0][2], 'melodi');
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.sent, 1);
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 1);
});

test('an explicit WhatsApp rejection retries safely after backoff', async () => {
  const context = await harness({ sendText: async () => { throw new Error('WhatsApp returned 429'); } });
  await requestedMessage(context);
  await context.runtime.deliverOutbox();
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.pending, 1);
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.uncertain, 0);
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.filter(row => /No pude verificar/.test(row[2])).length, 1);
  context.advance(30);
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.filter(row => /No pude verificar/.test(row[2])).length, 2);
});

test('an ambiguous transport timeout is quarantined and never automatically resent', async () => {
  const context = await harness({ sendText: async () => { throw new Error('fetch transport timeout'); } });
  await requestedMessage(context);
  await context.runtime.deliverOutbox();
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.uncertain, 1);
  context.advance(60);
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.filter(row => /No pude verificar/.test(row[2])).length, 1);
  assert.equal(context.emails.length, 0);
});

test('an ambiguous provider server failure is quarantined rather than retried', async () => {
  const context = await harness({ sendText: async () => { throw new Error('WhatsApp returned 503'); } });
  await requestedMessage(context);
  await context.runtime.deliverOutbox();
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.uncertain, 1);
  context.advance(60);
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.filter(row => /No pude verificar/.test(row[2])).length, 1);
  assert.equal(context.emails.length, 0);
});

test('quiet hours suppress legacy unsolicited contact and global pause preserves requested work', async () => {
  const quiet = await harness({ now: '2026-10-09T02:00:00Z' });
  await message(quiet);
  await quiet.runtime.deliverOutbox();
  assert.equal(quiet.sends.length, 0);
  assert.equal((await quiet.store.getState(OWNER, 'melodi')).outboxCounts.failed, 1);
  const paused = await harness();
  await requestedMessage(paused);
  await paused.runtime.control({ action: 'pause' });
  await paused.runtime.deliverOutbox();
  assert.equal(paused.sends.length, 0);
  assert.equal((await paused.runtime.status()).enabled, false);
});

test('malformed model output retries the event without sending fabricated text', async () => {
  const context = await harness({ generate: async () => ({ text: '{bad json}' }) });
  await event(context, 'melodi');
  await context.runtime.runAgent('melodi');
  const [row] = await context.store.listEvents({ owner: OWNER, agent: 'melodi' });
  assert.equal(row.status, 'pending');
  assert.equal(row.error_code, 'agent_run_failed');
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.pending, 0);
});

test('disabled runtime does not observe owner context, run models, dispatch or send', async () => {
  const context = await harness({ active: false });
  await event(context, 'melodi');
  await message(context);
  await context.runtime.observeOwner({ messageId: 'ignored', message: 'Hi', agent: 'melodi' });
  assert.deepEqual(await context.runtime.tick(), { enabled: false });
  await context.runtime.runAgent('melodi');
  await context.runtime.deliverOutbox();
  assert.equal(context.generated.length, 0);
  assert.equal(context.queued.length, 0);
  assert.equal(context.sends.length, 0);
  assert.equal((await context.store.listEvents({ owner: OWNER, agent: 'melodi' })).length, 1);
});

test('unrequested helper approval notices and old chatter cannot take over a focused conversation', async () => {
  const context = await harness();
  await context.coordinator.setGoal(OWNER, 'melodi', { title: 'Objetivo privado de Melodi' }, context.now);
  await message(context, 'melodi', 'older-melodi-message', { payload: { body: 'Melodi: Tema ordinario anterior.', needsReply: false } });
  const permission = await context.runtime.permissions.authorizeOrRequest({ owner: OWNER, agent: 'melodi', tool: 'prepare_document', input: { title: 'Informe', content: 'Datos privados' }, eventKey: 'melodi-private-doc', goalScope: 'personal' });
  const approval = permission.waitingApproval;
  assert.equal(approval.helper, 'melodi');
  await context.store.enqueueOutbox({ owner: OWNER, agent: approval.helper, messageKey: `approval:${approval.id}`,
    payload: { body: 'Melodi: ¿Apruebas esta colaboración?', approvalId: approval.id, needsReply: true } });
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.length, 0);
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.pending, 0);
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.failed, 2);
  assert.equal((await context.coordinator.settings(OWNER)).focus_agent, 'melodi');
  assert.equal(context.database.sql.prepare('SELECT receipt_code FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).receipt_code, null);
});

test('a level-zero agent cannot read the private workspace through automatic initial observations', async () => {
  let reads = 0;
  const context = await harness({ services: { async inspectWorkspace() { reads++; return { projects: [] }; } } });
  await context.runtime.control({ action: 'set_level', agent: 'melodi', level: 0, messageId: 'zero-level' });
  await event(context, 'melodi');
  await context.runtime.runAgent('melodi');
  assert.equal(reads, 0);
  assert.equal(context.generated[0].contents.own_level.level, 0);
  assert.equal(context.generated[0].contents.observations[0].status, 'blocked');
  assert.equal(context.generated[0].contents.observations[0].error, 'level_required');
});

test('an invented tool is blocked without fabricating a pending collaboration', async () => {
  const context = await harness({ generate: async () => ({ action: 'tool', tool: 'invented_tool', input: {} }) });
  await event(context, 'melodi');
  await context.runtime.runAgent('melodi');
  const checkpoint = await context.store.getCheckpoint(OWNER, 'melodi');
  assert.match(checkpoint.summary, /Acción bloqueada: unknown_autonomy_tool/);
  assert.doesNotMatch(checkpoint.summary, /pendiente de aprobación/);
  assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS count FROM wa_melodi_permission_requests').get().count, 0);
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.pending, 0);
});

test('unsupported skill keys and malformed tool inputs cannot create owner approval requests', async () => {
  for (const decision of [
    { action: 'tool', tool: 'publish_social', input: { target: 'third-party' } },
    { action: 'tool', tool: 'prepare_story', input: { brief: 'Una escena.', publish: true } },
    { action: 'tool', tool: 'prepare_document', input: { title: 'Plan', content: 'Detalles.', to: 'third-party@example.com' } },
  ]) {
    const context = await harness({ generate: async () => decision });
    await event(context, 'melodi');
    await context.runtime.runAgent('melodi');
    assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS count FROM wa_melodi_permission_requests').get().count, 0);
    assert.match((await context.store.getCheckpoint(OWNER, 'melodi')).summary, /Acción bloqueada/);
  }
});

test('own pending approval metadata prevents repeated requests and stays private to its requester', async () => {
  const context = await harness({ services: { async prepareDocument() { return { status: 'queued', jobId: 'doc-1' }; } },
    generate: async (agent, contents) => agent === 'melodi' && !contents.own_pending_approvals.length
      ? { action: 'tool', tool: 'prepare_document', input: { title: 'Plan', content: 'Contenido privado del objetivo.' } }
      : { action: 'wait', checkpoint: { summary: 'Espero el resultado pendiente.' } },
  });
  await event(context, 'melodi', 'first-melodi-event');
  await context.runtime.runAgent('melodi');
  const checkpoint = await context.store.getCheckpoint(OWNER, 'melodi');
  assert.equal(checkpoint.pendingApproval.tool, 'prepare_document');
  assert.equal(checkpoint.pendingApproval.helper, 'melodi');
  assert.equal(checkpoint.pendingApproval.status, 'pending');
  context.advance(46);
  await event(context, 'melodi', 'second-melodi-event');
  await context.runtime.runAgent('melodi');
  assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS count FROM wa_melodi_permission_requests').get().count, 1);
  const pendingContext = context.generated.filter(call => call.agent === 'melodi')[1].contents.own_pending_approvals;
  assert.equal(pendingContext[0].id, checkpoint.pendingApproval.id);
  assert.doesNotMatch(JSON.stringify(pendingContext), /Contenido privado|input_encrypted|input_iv/);
  await event(context, 'melodi');
  await context.runtime.runAgent('melodi');
  assert.deepEqual(context.generated.find(call => call.agent === 'melodi').contents.own_pending_approvals, []);
});

test('a model cannot fabricate pending approval metadata in its saved checkpoint', async () => {
  const context = await harness({ generate: async () => ({ action: 'wait', checkpoint: {
    summary: 'Resumen', pending_approval: { id: 'invented-approval', helper: 'melodi', status: 'approved' },
  } }) });
  await event(context, 'melodi');
  await context.runtime.runAgent('melodi');
  assert.equal((await context.store.getCheckpoint(OWNER, 'melodi')).pendingApproval, null);
});

for (const channel of ['auto', 'whatsapp', 'email']) {
  test(`an explicitly assigned ${channel} routine delivers by email during another agent's personal focus`, async () => {
    const context = await harness();
    await context.coordinator.setGoal(OWNER, 'melodi', { title: 'Objetivo personal de meses' }, context.now);
    await context.coordinator.recordOwnerReply(OWNER, 'melodi', context.now);
    await message(context, 'melodi', 'older-ordinary-melodi-message');
    const routine = await context.runtime.routines.create({ owner: OWNER, agent: 'melodi', eventKey: `weekly-${channel}`,
      title: 'Informe semanal pedido por el propietario', profile: '@vetsa', channel });
    const { outbox } = await completedArtifact(context, { routineId: routine.id, channel });
    await context.runtime.deliverOutbox();
    assert.equal(context.emails.length, 1);
    assert.equal(context.emails[0][0], OWNER);
    assert.equal(context.emails[0][2], 'melodi');
    assert.equal(context.emails[0][4], 'doc-melodi');
    assert.equal(context.sends.length, 0);
    assert.equal(context.artifactSends.length, 0);
    assert.equal(context.recorded.length, 0);
    assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_work_outbox WHERE id=?').get(outbox.id).status, 'sent');
    assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.pending, 0);
    const coordination = await context.coordinator.settings(OWNER);
    assert.equal(coordination.focus_agent, 'melodi');
    assert.equal(coordination.conversation_agent, 'melodi');
    assert.equal(coordination.last_contact_at, context.now);
  });
}

test('an authorized routine still observes the shared 45 minute contact cooldown and quiet hours', async () => {
  const context = await harness();
  await context.coordinator.setGoal(OWNER, 'melodi', { title: 'Objetivo personal' }, context.now);
  const contact = await context.coordinator.claimContact(OWNER, 'melodi', context.now);
  await context.coordinator.finishContact(OWNER, contact, { delivered: true, needsReply: true, now: context.now });
  const routine = await context.runtime.routines.create({ owner: OWNER, agent: 'melodi', eventKey: 'weekly-cooldown', title: 'Informe solicitado' });
  await completedArtifact(context, { routineId: routine.id });
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 0);
  context.advance(44);
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 0);
  context.advance(1);
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 1);
  const quiet = await harness({ now: '2026-10-09T03:00:00Z' });
  await quiet.coordinator.setGoal(OWNER, 'melodi', { title: 'Objetivo personal' }, quiet.now);
  const quietRoutine = await quiet.runtime.routines.create({ owner: OWNER, agent: 'melodi', eventKey: 'weekly-night', title: 'Informe solicitado' });
  await completedArtifact(quiet, { routineId: quietRoutine.id, origin: 'owner_request' });
  await quiet.runtime.deliverOutbox();
  assert.equal(quiet.emails.length, 0);
  assert.equal((await quiet.store.getState(OWNER, 'melodi')).outboxCounts.pending, 1);
});

test('a reserved conversation without personal focus delivers another agent routine by email', async () => {
  const context = await harness();
  await context.coordinator.recordOwnerReply(OWNER, 'melodi', context.now);
  const routine = await context.runtime.routines.create({ owner: OWNER, agent: 'melodi', eventKey: 'weekly-conversation', title: 'Informe solicitado' });
  await completedArtifact(context, { routineId: routine.id, channel: 'whatsapp' });
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 1);
  assert.equal(context.artifactSends.length, 0);
  assert.equal((await context.coordinator.settings(OWNER)).conversation_agent, 'melodi');
});

test('stopped routines and unrelated payloads cannot claim a focus exception', async () => {
  const context = await harness();
  await context.coordinator.setGoal(OWNER, 'melodi', { title: 'Objetivo personal' }, context.now);
  const routine = await context.runtime.routines.create({ owner: OWNER, agent: 'melodi', eventKey: 'weekly-stopped', title: 'Informe solicitado' });
  await completedArtifact(context, { routineId: routine.id });
  await context.runtime.routines.cancel({ owner: OWNER, id: routine.id });
  const otherRoutine = await context.runtime.routines.create({ owner: OWNER, agent: 'melodi', eventKey: 'weekly-active', title: 'Otro informe solicitado' });
  await message(context, 'melodi', 'spoof-routine-message', { payload: { body: 'Conversación espontánea', routineId: otherRoutine.id } });
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 0);
  assert.equal(context.sends.length, 0);
  assert.equal((await context.coordinator.settings(OWNER)).contact_token, null);
});

test('a completed direct owner artifact responds at night without message quota and preserves another agent focus', async () => {
  const context = await harness({ now: '2026-10-09T03:00:00Z' });
  await context.coordinator.setGoal(OWNER, 'melodi', { title: 'Objetivo personal' }, context.now);
  await context.coordinator.recordOwnerReply(OWNER, 'melodi', context.now);
  await context.store.configureAgent({ owner: OWNER, agent: 'melodi', config: { dailyMessageLimit: 0 } });
  context.database.sql.prepare('UPDATE wa_melodi_coordination SET last_contact_at=? WHERE owner_phone=?').run(context.now, OWNER);
  await message(context, 'melodi', 'older-night-ordinary');
  const { outbox } = await completedArtifact(context, { origin: 'owner_request' });
  await Promise.all([context.runtime.deliverOutbox(), context.runtime.deliverOutbox(), context.runtime.deliverOutbox()]);
  assert.equal(context.emails.length, 1);
  assert.equal(context.artifactSends.length, 0);
  assert.equal(context.sends.length, 1);
  assert.match(context.sends[0][2], /^Envié el documento por correo/);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_work_outbox WHERE id=?').get(outbox.id).status, 'sent');
  const state = await context.store.getState(OWNER, 'melodi');
  assert.equal(state.messages_today, 0);
  assert.equal(state.outboxCounts.pending, 0);
  const coordination = await context.coordinator.settings(OWNER);
  assert.equal(coordination.focus_agent, 'melodi');
  assert.equal(coordination.conversation_agent, 'melodi');
  assert.equal(coordination.contact_token, null);
});

test('owner requested artifacts use WhatsApp at night when their agent owns the conversation', async () => {
  const context = await harness({ now: '2026-10-09T03:00:00Z' });
  await context.coordinator.recordOwnerReply(OWNER, 'melodi', context.now);
  await completedArtifact(context, { origin: 'owner_request', channel: 'whatsapp' });
  await context.runtime.deliverOutbox();
  assert.equal(context.artifactSends.length, 1);
  assert.equal(context.emails.length, 0);
  assert.equal(context.recorded.length, 1);
  assert.equal((await context.coordinator.settings(OWNER)).conversation_agent, 'melodi');
});

test('seedEvents copies owner-request origin only after verifying the private job owner and agent', async () => {
  const context = await harness({ now: '2026-10-09T03:00:00Z' });
  await completedArtifact(context, { origin: 'owner_request', enqueue: false });
  await context.runtime.tick();
  const pending = await context.store.peekOutbox({ owner: OWNER, agent: 'melodi', now: context.now });
  assert.equal(pending.payload.ownerRequested, true);
  assert.equal(pending.payload.artifactJobId, 'doc-melodi');
  await context.runtime.deliverOutbox();
  assert.equal(context.artifactSends.length, 1);
});

test('a forged ownerRequested payload cannot bypass quiet hours or quota', async () => {
  const context = await harness({ now: '2026-10-09T03:00:00Z' });
  const { outbox } = await completedArtifact(context);
  const row = context.database.sql.prepare('SELECT payload_encrypted,payload_iv FROM wa_melodi_work_outbox WHERE id=?').get(outbox.id);
  const payload = await context.services.decrypt(row.payload_encrypted, row.payload_iv);
  const sealed = await context.services.encrypt({ ...payload, ownerRequested: true });
  context.database.sql.prepare('UPDATE wa_melodi_work_outbox SET payload_encrypted=?,payload_iv=? WHERE id=?').run(sealed.encrypted, sealed.iv, outbox.id);
  await context.runtime.deliverOutbox();
  assert.equal(context.artifactSends.length, 0);
  assert.equal(context.emails.length, 0);
  assert.equal((await context.store.getState(OWNER, 'melodi')).messages_today, 0);
});

test('an unrequested approval notice cannot become a contextual owner decision or uncertain delivery', async () => {
  const context = await harness({ sendText: async () => { throw new Error('WhatsApp returned 400: code 131047'); },
    services: { async emailOwner() { return { status: 'reserved' }; } } });
  await context.coordinator.setGoal(OWNER, 'melodi', { title: 'Meta privada' }, context.now);
  const authority = await context.runtime.permissions.authorizeOrRequest({ owner: OWNER, agent: 'melodi', tool: 'prepare_document',
    input: { title: 'Plan', content: 'Datos' }, eventKey: 'notice-reserved-email' });
  const approval = authority.waitingApproval;
  await context.store.enqueueOutbox({ owner: OWNER, agent: approval.helper, messageKey: `approval:${approval.id}`,
    payload: { body: 'Melodi: ¿Apruebas esta colaboración?', approvalId: approval.id, needsReply: true } });
  await context.runtime.deliverOutbox();
  assert.equal(context.database.sql.prepare('SELECT receipt_code FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).receipt_code, null);
  assert.equal((await context.coordinator.settings(OWNER)).conversation_agent, 'melodi');
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.uncertain, 0);
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.failed, 1);
});

test('outbox preflight quarantines a crashed sending row even when no pending candidate remains', async () => {
  const context = await harness();
  await message(context);
  const claimed = await context.store.claimOutbox({ owner: OWNER, agent: 'melodi', now: context.now, leaseMs: 60000 });
  assert.ok(claimed);
  context.advance(2);
  await context.runtime.deliverOutbox();
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.uncertain, 1);
  assert.equal(context.sends.length, 0);
  assert.equal(context.emails.length, 0);
});

test('a conversational promise never becomes an autonomous coordination without tool receipts', async () => {
  const context = await harness({ generate: async () => ({ text: JSON.stringify({ action: 'message',
    message: 'Voy a coordinar con Melodi para enviarte el informe. ¿Quieres que te mantenga informado?', needs_reply: true }) }) });
  await event(context, 'melodi', 'unsupported-promise');
  await context.runtime.runAgent('melodi');
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.pending, 0);
  assert.equal(context.sends.length, 0);
  assert.equal(context.emails.length, 0);
});

test('proceed and repeated yes report task state without optional followup questions or new tasks', async () => {
  const context = await harness();
  await completedArtifact(context, { agent: 'melodi', origin: 'owner_request' });
  for (let i = 0; i < 3; i++) {
    const answer = await context.runtime.control({ action: 'approval', agent: 'melodi', approved: true,
      contextual: true, messageId: `yes-${i}` });
    assert.match(answer, /en preparación|preparado y pendiente/);
    assert.doesNotMatch(answer, /¿|quieres|resumen|coordinar/i);
  }
  assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_work_events').get().n, 0);
  assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_owner_jobs').get().n, 1);
});

test('proceed after a legacy conversational promise exposes the missing execution instead of another promise', async () => {
  const context = await harness();
  await context.coordinator.remember(OWNER, 'melodi', 'Voy a coordinar con Melodi para enviar el informe. ¿Quieres que te mantenga informado?', context.now, 'assistant');
  const answer = await context.runtime.control({ action: 'approval', agent: 'melodi', contextual: true, approved: true, messageId: 'legacy-proceed' });
  assert.match(answer, /no figura en ejecución/);
  assert.doesNotMatch(answer, /¿|coordinar|te enviaré|ya (?:está|fue) enviado/);
});

test('confirmed email produces one durable WhatsApp notice with actual sender and recipient', async () => {
  const context = await harness({ services: { async emailOwner() {
    return { status: 'sent', sender: 'emily@vetsa.es', recipient: 'owner@example.com', agent: 'melodi' };
  } } });
  await completedArtifact(context, { origin: 'owner_request', channel: 'email' });
  await Promise.all([context.runtime.deliverOutbox(), context.runtime.deliverOutbox()]);
  assert.equal(context.sends.length, 1);
  assert.match(context.sends[0][2], /^Envié el documento por correo a owner@example.com desde emily@vetsa.es/);
  assert.equal(context.database.sql.prepare("SELECT status FROM wa_melodi_delivery_notices").get().status, 'sent');
  await context.runtime.deliverNotices();
  assert.equal(context.sends.length, 1);
});

test('a closed WhatsApp window holds the delivery notice until owner reopens it, without another email', async () => {
  let open = false;
  const context = await harness({ sendText: async () => { if (!open) throw new Error('WhatsApp returned 400: code 131047'); } });
  await completedArtifact(context, { origin: 'owner_request', channel: 'email' });
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 1);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_delivery_notices').get().status, 'window_closed');
  context.advance(60);
  await context.runtime.deliverNotices();
  assert.equal(context.sends.length, 1);
  open = true;
  await context.runtime.observeOwner({ messageId: 'new-owner-message', message: 'Hola Melodi', agent: 'melodi' });
  assert.equal(context.sends.length, 1); // Initial owner reply takes precedence.
  await context.runtime.deliverNotices();
  assert.equal(context.sends.length, 2);
  assert.equal(context.emails.length, 1);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_delivery_notices').get().status, 'sent');
});

test('an uncertain WhatsApp notice is never automatically replayed or recreated by duplicate email completion', async () => {
  const context = await harness({ sendText: async () => { throw new Error('transport timeout'); } });
  await completedArtifact(context, { origin: 'owner_request', channel: 'email' });
  await context.runtime.deliverOutbox();
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_delivery_notices').get().status, 'uncertain');
  context.advance(120);
  await context.runtime.deliverOutbox();
  await context.runtime.observeOwner({ messageId: 'new-chat', message: 'Hola', agent: 'melodi' });
  await context.runtime.deliverNotices();
  assert.equal(context.sends.length, 1);
  assert.equal(context.emails.length, 1);
});

test('a reserved email reports verification pending and never claims a successful delivery', async () => {
  const context = await harness({ services: { async emailOwner() { return { status: 'reserved' }; } } });
  await completedArtifact(context, { origin: 'owner_request', channel: 'email' });
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.length, 1);
  assert.match(context.sends[0][2], /pendiente de verificación/);
  assert.doesNotMatch(context.sends[0][2], /Envié|enviado|entregado/);
  assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_delivery_notices').get().n, 1);
});

test('shared contact lease postpones a notice without exhausting its transport attempts', async () => {
  const context = await harness();
  await context.runtime.notices.enqueue({ owner: OWNER, key: 'receipt-busy', agent: 'melodi', body: 'Melodi: Envié tu PDF.', ownerRequested: true });
  const token = await context.coordinator.claimContact(OWNER, 'melodi', context.now);
  for (let i = 0; i < 4; i++) await context.runtime.deliverNotices();
  assert.equal(context.sends.length, 0);
  assert.equal(context.database.sql.prepare('SELECT attempts FROM wa_melodi_delivery_notices').get().attempts, 0);
  await context.coordinator.finishContact(OWNER, token, { now: context.now });
  await context.runtime.deliverNotices();
  assert.equal(context.sends.length, 1);
});

test('Melodi email completion shares the global transport without changing her sender identity', async () => {
  const context = await harness();
  await context.coordinator.recordOwnerReply(OWNER, 'melodi', context.now);
  await context.runtime.notices.enqueue({ owner: OWNER, key: 'melodi-receipt', agent: 'melodi',
    body: 'Melodi: Envié el archivo desde emily@vetsa.es.', ownerRequested: true });
  await context.runtime.deliverNotices();
  assert.equal(context.sends.length, 1);
  assert.match(context.sends[0][2], /^Envié el archivo desde emily@vetsa.es/);
  assert.equal(context.sends[0][3].agent, 'melodi');
  assert.equal((await context.coordinator.settings(OWNER)).conversation_agent, 'melodi');
});

const requestedPost = 'https://instagram.com/p/REQUESTEDPOST/';
const requestedQuote = 'Comparativa: enseña el antes y después de un proceso.';
const reportRequest = { agent: 'melodi', sourceUrl: requestedPost, scope: 'single_post', recipient: 'owner', channel: 'email',
  brief: 'Investiga todos los formatos de esta publicación y cómo realizarlos; envíamelo por correo.', includeTutorial: true, includeAllFormats: true };

test('requested Melodi research waits for document permission then helper preserves its exact report and email assignment', async () => {
  const prepared = [];
  const context = await harness({ services: {
    async readPublicSource(input) { assert.equal(input.url, requestedPost); return { results: [{ url: requestedPost, text: requestedQuote }] }; },
    async prepareDocument(input) { prepared.push(input); return { status: 'queued', jobId: 'doc-requested-melodi' }; },
  }, generate: async () => ({ formats: [{ name: 'Comparativa', source_url: requestedPost, evidence_quote: requestedQuote,
    steps: ['Graba el antes y el después con el mismo encuadre.', 'Edita una comparación clara.'] }] }) });
  await context.coordinator.setGoal(OWNER, 'melodi', { title: 'Meta personal ajena a la investigación' }, context.now);
  const receipt = await context.runtime.control({ action: 'research_request', agent: 'melodi', request: reportRequest,
    eventId: 'owner-request-message', receiptSent: true });
  assert.equal(receipt.status, 'queued');
  assert.deepEqual(context.queued, [{ type: 'autonomy_agent', agent: 'melodi' }]);
  await context.runtime.runAgent('melodi');
  assert.equal(prepared.length, 0);
  const [pending] = await context.runtime.permissions.listPending(OWNER);
  assert.equal(pending.requester, 'melodi');
  assert.equal(pending.helper, 'melodi');
  assert.equal(pending.tool, 'prepare_document');
  const [reference] = await context.runtime.references.list({ owner: OWNER, type: 'approval' });
  assert.equal(reference.shortRef, 'C1');
  const outbox = await context.store.peekOutbox({ owner: OWNER, agent: 'melodi', messageKey: `approval:${pending.id}`, now: context.now });
  assert.match(outbox.payload.body, /colaboración \(C1\)/);
  assert.equal(outbox.event_id, receipt.eventId);
  assert.doesNotMatch(outbox.payload.body, new RegExp(pending.id));
  await context.runtime.control({ action: 'approval', approvalReference: 'C1', approved: true, messageId: 'owner-approval' });
  await context.runtime.runAgent('melodi');
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].agent, 'melodi');
  assert.equal(prepared[0].assignmentAgent, 'melodi');
  assert.equal(prepared[0].channel, 'email');
  assert.equal(prepared[0].origin, 'owner_request');
  assert.match(prepared[0].content, /Graba el antes y el después/);
  assert.equal(prepared[0].content.includes('Meta personal ajena'), false);
  assert.equal((await context.runtime.references.list({ owner: OWNER, type: 'job' }))[0].shortRef, 'T1');
  assert.equal((await context.coordinator.settings(OWNER)).focus_agent, 'melodi');
});

test('source unavailable produces a factual requested response bound to its completed explicit event', async () => {
  const context = await harness({ services: { async readPublicSource() { return { results: [], reason: 'No se pudo leer esa publicación.' }; } } });
  const result = await context.runtime.control({ type: 'research_request', agent: 'melodi', request: reportRequest, eventId: 'unavailable-request' });
  assert.equal(result.status, 'queued');
  assert.deepEqual(context.queued, []);
  await context.runtime.runAgent('melodi');
  const blocked = await context.store.peekOutbox({ owner: OWNER, agent: 'melodi', now: context.now });
  assert.equal(blocked.event_id, result.eventId);
  assert.equal(blocked.payload.ownerRequested, true);
  assert.equal(blocked.payload.ownerRequestEventId, result.eventId);
  assert.equal(blocked.payload.channel, 'email');
  assert.match(blocked.payload.body, /No pude verificar/);
  assert.match(blocked.payload.body, /captura/);
  assert.equal(context.generated.length, 0);
  assert.equal((await context.store.listEvents({ owner: OWNER, agent: 'melodi' }))[0].status, 'done');
});

test('a requested source failure passes older spontaneous messages at night without taking another agent focus', async () => {
  const context = await harness({ now: '2026-10-09T03:00:00Z', services: {
    async readPublicSource() { return { results: [], reason: 'No se pudo leer esa publicación.' }; },
  } });
  await context.runtime.control({ action: 'set_goal', agent: 'melodi', goal: { title: 'Un objetivo personal de Melodi' }, messageId: 'focus-before-report' });
  await message(context, 'melodi', 'older-spontaneous-message');
  context.advance(1);
  const request = await context.runtime.control({ action: 'research_request', agent: 'melodi', request: reportRequest, eventId: 'night-unavailable-request' });
  await context.runtime.runAgent('melodi');
  assert.equal((await context.store.peekOutbox({ owner: OWNER, agent: 'melodi', now: context.now })).event_id, null);
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 1);
  assert.equal(context.emails[0][2], 'melodi');
  assert.match(context.emails[0][3], /No pude verificar/);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_work_outbox WHERE event_id=?').get(request.eventId).status, 'sent');
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_work_outbox WHERE event_id IS NULL AND agent=?').get('melodi').status, 'failed');
  assert.equal((await context.coordinator.settings(OWNER)).focus_agent, 'melodi');
});

test('an explicit nighttime research request may ask its higher-level helper for C1 permission immediately', async () => {
  const context = await harness({ now: '2026-10-09T03:00:00Z', services: {
    async readPublicSource() { return { results: [{ url: requestedPost, text: requestedQuote }] }; },
  }, generate: async () => ({ formats: [{ name: 'Comparativa', source_url: requestedPost, evidence_quote: requestedQuote, steps: ['Graba dos estados del proceso.'] }] }) });
  await context.runtime.control({ action: 'research_request', agent: 'melodi', request: reportRequest, eventId: 'night-report', receiptSent: true });
  await context.runtime.runAgent('melodi');
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.length + context.emails.length, 1);
  const body = context.sends[0]?.[2] || context.emails[0]?.[3];
  assert.match(body, /C1/);
  assert.doesNotMatch(body, /^(?:Melodi|Melodi):/);
  const [pending] = await context.runtime.permissions.listPending(OWNER);
  assert.equal(pending.requester, 'melodi');
  assert.equal(pending.receipt_code, 'approval_notified');
});

test('short approvals preserve exact owner decisions and ambiguous contextual yes cannot choose a request', async () => {
  const context = await harness();
  for (const eventKey of ['first-doc', 'second-doc']) await context.runtime.control({ action: 'authorize_skill', agent: 'melodi',
    tool: 'prepare_document', input: { title: eventKey, content: 'Datos' }, messageId: eventKey });
  const pending = await context.runtime.permissions.listPending(OWNER);
  for (const request of pending) await context.runtime.control({ action: 'approval_notified', approvalId: request.id });
  await context.coordinator.recordOwnerReply(OWNER, 'melodi', context.now);
  const ambiguous = await context.runtime.control({ action: 'approval', contextual: true, approved: true, messageId: 'ambiguous-yes' });
  assert.match(ambiguous, /C1/);
  assert.match(ambiguous, /C2/);
  assert.equal((await context.runtime.permissions.listPending(OWNER)).filter(row => row.status === 'pending').length, 2);
  await context.runtime.control({ action: 'approval', approvalReference: 'C2', approved: false, messageId: 'deny-second' });
  const allRows = context.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests ORDER BY created_at,id').all();
  assert.equal(allRows.filter(row => row.status === 'denied').length, 1);
  assert.equal(allRows.filter(row => row.status === 'pending').length, 1);
});

test('financial report escalation preserves the sealed ledger snapshot and selected agent, executes only after approval once',async()=>{
  for(const approved of [false,true]) {
    const documents=[],h=await harness({services:{async prepareDocument(input){documents.push(input);return {status:'queued',jobId:'private-financial-report'};}}});
    await executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:'income',request:parseFinanceRequest('recibí 100 dólares por trabajo',Date.parse(h.now)),services:h.services,now:Date.parse(h.now)});
    const services={...h.services,async authorizeFinanceDocument(document){return h.runtime.control({action:'authorize_skill',agent:'melodi',tool:'prepare_document',messageId:'financial-report',
      input:{title:document.title,content:document.content,format:document.format,kind:document.kind,ownerRequest:{origin:'owner_request',assignmentAgent:'melodi',channel:document.channel}}});}};
    const response=await executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:'financial-report',request:parseFinanceRequest('envíame un informe de mis finanzas por email',Date.parse(h.now)),services,now:Date.parse(h.now)});
    assert.match(response,/Apruebas.*C1/);assert.equal(documents.length,0);
    const [approval]=await h.runtime.permissions.listPending(OWNER);assert.equal(approval.requester,'melodi');
    const raw=h.database.sql.prepare('SELECT * FROM wa_melodi_permission_requests WHERE id=?').get(approval.id);
    assert.ok(!JSON.stringify(raw).includes('USD 100.00'));
    await h.runtime.control({action:'approval_notified',approvalId:approval.id});
    await h.runtime.control({action:'approval',approvalReference:'C1',approved,messageId:'owner-decision'});
    if(!approved) {await h.runtime.runAgent(approval.helper);assert.equal(documents.length,0);continue;}
    await h.runtime.runAgent(approval.helper);await h.runtime.runAgent(approval.helper);
    assert.equal(documents.length,1);assert.equal(documents[0].agent,'melodi');assert.equal(documents[0].assignmentAgent,'melodi');
    assert.equal(documents[0].channel,'email');assert.equal(documents[0].origin,'owner_request');assert.equal(documents[0].approvalId,approval.id);
    assert.match(documents[0].content,/entradas USD 100.00/);assert.equal(h.generated.length,0);
    assert.equal(h.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).status,'completed');
  }
});

test('weekly creation, listing and stop use an owner-scoped short reference without exposing UUIDs', async () => {
  const context = await harness();
  const created = await context.runtime.control({ action: 'create_routine', agent: 'melodi', messageId: 'weekly-short', routine: { profile: '@vetsa', channel: 'email' } });
  assert.match(created, /R1/);
  assert.doesNotMatch(created, /[a-f0-9]{8}-[a-f0-9]{4}/);
  const listed = await context.runtime.control({ action: 'list_routines', agent: 'melodi' });
  assert.match(listed, /R1/);
  const stopped = await context.runtime.control({ action: 'stop_routine', agent: 'melodi', routineReference: 'R1' });
  assert.match(stopped, /Detuve el encargo R1/);
  assert.equal((await context.runtime.routines.list(OWNER))[0].status, 'stopped');
});

test('explicit retry resumes the last failed image as its original job instead of creating a reminder', async () => {
  const context = await harness();
  const sealed = await context.services.encrypt({ agent: 'melodi', prompt: 'Imagen solicitada', sourceContent: 'Contenido exacto' });
  context.database.sql.prepare(`INSERT INTO wa_owner_jobs (id,owner_phone,status,job_type,encrypted_payload,payload_iv,error_code,created_at)
    VALUES ('failed-image',?,'failed','generate_image',?,?,'provider_503',?)`).run(OWNER, sealed.encrypted, sealed.iv, context.now);
  const reply = await context.runtime.control({ action: 'retry_job', agent: 'melodi', latest: true, messageId: 'retry-owner-message' });
  assert.match(reply, /Reanudé T1/);
  assert.deepEqual(context.queued, [{ jobId: 'failed-image' }]);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_owner_jobs WHERE id=?').get('failed-image').status, 'pending');
  assert.deepEqual(await context.store.listEvents({ owner: OWNER, agent: 'melodi' }), []);
  const retained = context.database.sql.prepare('SELECT encrypted_payload,payload_iv FROM wa_owner_jobs WHERE id=?').get('failed-image');
  assert.equal((await context.services.decrypt(retained.encrypted_payload, retained.payload_iv)).sourceContent, 'Contenido exacto');
});

test('failed credits cannot be retried and model observations only offer truthful short task references', async () => {
  const context = await harness({ services: { async inspectWorkspace() { return { projects: [], calendar: [], jobs: [
    { id: 'credit-image', job_type: 'generate_image', status: 'failed', error_code: 'provider_402_insufficient_credits' },
  ] }; } } });
  const sealed = await context.services.encrypt({ agent: 'melodi', prompt: 'Imagen' });
  context.database.sql.prepare(`INSERT INTO wa_owner_jobs (id,owner_phone,status,job_type,encrypted_payload,payload_iv,error_code,created_at)
    VALUES ('credit-image',?,'failed','generate_image',?,?,'provider_402_insufficient_credits',?)`).run(OWNER, sealed.encrypted, sealed.iv, context.now);
  assert.match(await context.runtime.control({ action: 'retry_job', agent: 'melodi', messageId: 'retry-credits' }), /necesita resolver el bloqueo/);
  assert.deepEqual(context.queued, []);
  await event(context, 'melodi');
  await context.runtime.runAgent('melodi');
  const job = context.generated[0].contents.observations[0].data.jobs[0];
  assert.equal(job.shortRef, 'T1');
  assert.equal(job.retryPolicy.retryable, false);
});

test('a leader-led objective dispatches the specialist, resumes its parent and delivers once without waiting for cron',async()=>{
  const reads=[];
  const h=await harness({leader:true,generate:async(agent,input)=>{
    const task=input.task_memory;
    if(agent==='melodi'&&!task.receipts.length)return{text:JSON.stringify({action:'tool',tool:'delegate_agent_event',input:{target:'melodi',task:'Investiga la documentación de colas'},plan:[{description:'Investigar la fuente con Melodi',tool:'delegate_agent_event'},{description:'Comprobar fuentes',tool:'research_public_web'}]})};
    if(agent==='melodi'&&!task.receipts.length)return{text:JSON.stringify({action:'tool',tool:'research_public_web',input:{query:'Cloudflare Queues official docs'},plan:[{description:'Consultar documentación pública',tool:'research_public_web'}]})};
    return{text:JSON.stringify({action:'message',message:'Las colas permiten separar la recepción del mensaje y su procesamiento. Fuente: https://developers.cloudflare.com/queues/'})};
  },services:{researchPublicWeb:async input=>{reads.push(input);return{configured:true,results:[{title:'Cloudflare Queues',url:'https://developers.cloudflare.com/queues/',highlights:['Asynchronous message processing.']}]};}}});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'human-leader-task',objective:'Investiga la documentación de colas con el equipo',requiredTools:['research_public_web']});
  assert.equal(accepted.status,'queued');assert.match(accepted.acknowledgement,/Melodi:/);
  const dispatched=[];
  while(h.queued.length) {
    assert.ok(dispatched.length<10,'the wakeup chain must terminate');
    const message=h.queued.shift();dispatched.push(message);
    if(message.type==='autonomy_agent') {
      // At-least-once Queue delivery must not repeat completed tools or emit
      // duplicate results. Both deliveries observe the same D1 event claims.
      await h.runtime.runAgent(message.agent);
      await h.runtime.runAgent(message.agent);
    } else if(message.type==='autonomy_outbox') {
      await h.runtime.deliverOutbox();await h.runtime.deliverOutbox();
    } else assert.fail(`unexpected queue message ${message.type}`);
  }
  assert.deepEqual(dispatched.filter(item=>item.type==='autonomy_agent').map(item=>item.agent),['melodi']);
  assert.equal(dispatched.filter(item=>item.type==='autonomy_outbox').length,1);
  assert.equal(h.now,'2026-10-08T13:30:00.000Z','coordination needs no clock tick or time advance');
  const finished=await h.runtime.brain.get({owner:OWNER,agent:'melodi',id:accepted.taskId});
  assert.equal(finished.status,'completed');assert.equal(finished.coordinator,'melodi');assert.ok(finished.memory.some(item=>item.via?.agent==='melodi'));
  await h.runtime.deliverOutbox();await h.runtime.deliverOutbox();
  assert.equal(h.sends.length,1);assert.doesNotMatch(h.sends[0][2],/^(?:Melodi|Melodi):|Resultado de Melodi/);assert.equal(h.sends[0][3].agent,'melodi');assert.match(h.sends[0][2],/developers.cloudflare.com/);
  assert.equal(reads.length,1,'resume never repeats the completed specialist operation');
});

test('a missing queue or failed specialist wakeup preserves the accepted work for cron recovery',async()=>{
  for(const unavailable of ['missing','rejected']) {
    let reads=0;
    const h=await harness({leader:true,generate:async(agent,input)=>{
      if(agent==='melodi'&&!input.task_memory.receipts.length)return{action:'tool',tool:'delegate_agent_event',input:{target:'melodi',task:'Consulta la fuente'},
        plan:[{description:'Consultar con Melodi',tool:'delegate_agent_event'},{description:'Comprobar la fuente',tool:'research_public_web'}]};
      if(agent==='melodi'&&!input.task_memory.receipts.length)return{action:'tool',tool:'research_public_web',input:{query:'Queue documentation'},
        plan:[{description:'Consultar documentación pública',tool:'research_public_web'}]};
      return{action:'message',message:'Fuente comprobada.'};
    },services:{async researchPublicWeb(){reads++;return{configured:true,results:[{title:'Queues',url:'https://developers.cloudflare.com/queues/'}]};}}});
    const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:`wake-${unavailable}`,objective:'Consulta la documentación',requiredTools:['research_public_web']});
    h.queued.length=0;
    const queue=h.env.MELODI_JOBS;
    if(unavailable==='missing')delete h.env.MELODI_JOBS;
    else h.env.MELODI_JOBS={async send(){throw Error('queue temporarily unavailable');}};
    await h.runtime.runAgent('melodi');
    const identity={owner:OWNER,agent:'melodi',id:accepted.taskId};
    assert.equal((await h.runtime.brain.get(identity)).status,'waiting');
    assert.equal(h.database.sql.prepare("SELECT status FROM wa_melodi_work_events WHERE owner=? AND agent='melodi'").get(OWNER).status,'done');
    assert.equal(h.database.sql.prepare("SELECT status FROM wa_melodi_work_events WHERE owner=? AND agent='melodi'").get(OWNER).status,'pending');
    h.env.MELODI_JOBS=queue;
    await h.runtime.tick();
    let processed=0;
    while(h.queued.length) {
      assert.ok(processed++<12);
      const message=h.queued.shift();
      if(message.type==='autonomy_agent')await h.runtime.runAgent(message.agent);
      else if(message.type==='autonomy_outbox')await h.runtime.deliverOutbox();
    }
    assert.equal((await h.runtime.brain.get(identity)).status,'completed');
    assert.equal(reads,1);assert.equal(h.sends.length,1);
  }
});

test('a five-step objective continues durably after the four-step per-turn budget without repeating tools',async()=>{
  const queries=[];
  const h=await harness({leader:true,generate:async(_agent,input)=>{
    const next=input.task_memory.receipts.length;
    return{text:JSON.stringify(next<5?{action:'tool',tool:'research_public_web',input:{query:'Source '+next},plan:Array.from({length:5},(_,i)=>({description:'Consultar fuente '+i,tool:'research_public_web'}))}:{action:'message',message:'Se contrastaron las cinco fuentes solicitadas.'})};
  },services:{researchPublicWeb:async({query})=>{queries.push(query);return{configured:true,results:[{title:query,url:'https://example.org/'+queries.length}]};}}});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'five-steps',objective:'Compara cinco fuentes',requiredTools:['research_public_web']});
  await h.runtime.runAgent('melodi');assert.equal(queries.length,4);
  h.advance(0.05);await h.runtime.runAgent('melodi');
  assert.equal(queries.length,5);assert.equal(new Set(queries).size,5);
  assert.equal((await h.runtime.brain.get({owner:OWNER,agent:'melodi',id:accepted.taskId})).status,'completed');
});

test('Melodi continues a premature research summary through Melodi and accepts only the proven final artifact',async()=>{
  const reads=[],documents=[],deliveries=[];
  let partialSummary=false,jobComplete=false,artifactReady=false;
  const h=await harness({leader:true,generate:async(agent,input)=>{
    const task=input.task_memory;
    if(agent==='melodi'&&!task.receipts.length)return{action:'tool',tool:'delegate_agent_event',input:{target:'melodi',task:'Investiga las fuentes públicas para el informe'},
      plan:[{description:'Investigar con Melodi',tool:'delegate_agent_event'},{description:'Comprobar fuentes',tool:'research_public_web'},
        {description:'Redactar con Melodi',tool:'delegate_agent_event'},{description:'Preparar el informe',tool:'prepare_document'}]};
    if(agent==='melodi'&&!task.receipts.length)return{action:'tool',tool:'research_public_web',input:{query:'Cloudflare Queues official docs'},plan:[{description:'Consultar la fuente pública',tool:'research_public_web'}]};
    if(agent==='melodi'&&!task.receipts.some(receipt=>receipt.targetAgent==='melodi')) {
      if(!partialSummary) {partialSummary=true;return{action:'message',message:'Melodi comprobó las fuentes; el informe está terminado.'};}
      const correction=input.observations.find(item=>item.status==='required_steps_pending');
      assert.ok(correction);assert.ok(correction.requiredTools.includes('prepare_document'));assert.deepEqual(correction.requiredAgents,['melodi']);
      return{action:'tool',tool:'delegate_agent_event',input:{target:'melodi',task:'Prepara el informe con la fuente verificada https://developers.cloudflare.com/queues/'}};
    }
    if(agent==='melodi'&&!task.receipts.length)return{action:'tool',tool:'prepare_document',input:{title:'Informe de colas',content:'La documentación verificada está en https://developers.cloudflare.com/queues/',format:'pdf'},
      plan:[{description:'Preparar el archivo solicitado',tool:'prepare_document'}]};
    return{action:'message',message:'El informe compara las fuentes verificadas y presenta los siguientes pasos.'};
  },services:{
    async researchPublicWeb(input){reads.push(input);return{configured:true,results:[{title:'Cloudflare Queues',url:'https://developers.cloudflare.com/queues/'}]};},
    async prepareDocument(input){documents.push(input);return{status:'queued',jobId:'brain-team-report'};},
    async privateJobInfo(owner,jobId){
      if(owner!==OWNER||jobId!=='brain-team-report'||!documents.length)return null;
      return{row:{id:jobId,owner_phone:OWNER,status:jobComplete?'complete':'pending'},agent:'melodi',brainTaskId:documents[0].brainTaskId,
        origin:'owner_request',...(artifactReady?{artifact:{objectKey:'private/reports/brain-team-report.pdf',mimeType:'application/pdf'}}:{})};
    },
    async deliverArtifact(...args){deliveries.push(args);return{status:'sent',messageId:'verified-artifact-receipt'};},
  }});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'team-report-premature-summary',objective:'Investiga con Melodi y prepara con Melodi un informe privado',
    requiredTools:['research_public_web','prepare_document'],requiredAgents:['melodi']});
  const identity={owner:OWNER,agent:'melodi',id:accepted.taskId};
  await h.runtime.runAgent('melodi');await h.runtime.runAgent('melodi');
  h.advance(0.05);await h.runtime.tick();await h.runtime.runAgent('melodi');
  let task=await h.runtime.brain.get(identity);
  assert.equal(partialSummary,true);assert.equal(task.status,'waiting');assert.equal(task.blocker,'delegated');assert.equal(task.turns,2);
  assert.equal(task.receipts.filter(receipt=>receipt.tool==='delegate_agent_event').length,2);
  assert.equal(h.database.sql.prepare('SELECT count(*) AS n FROM wa_melodi_work_outbox').get().n,0);
  await h.runtime.runAgent('melodi');assert.equal(documents.length,1);assert.equal(reads.length,1);
  h.advance(0.05);await h.runtime.tick();assert.equal((await h.runtime.brain.get(identity)).status,'waiting');
  jobComplete=true;h.advance(0.05);await h.runtime.tick();
  assert.equal((await h.runtime.brain.get({owner:OWNER,agent:'melodi',id:documents[0].brainTaskId})).status,'waiting','a completed job row without an artifact is insufficient');
  assert.equal(h.database.sql.prepare('SELECT count(*) AS n FROM wa_melodi_work_outbox').get().n,0);
  artifactReady=true;h.advance(0.05);await h.runtime.tick();await h.runtime.runAgent('melodi');
  h.advance(0.05);await h.runtime.tick();await h.runtime.runAgent('melodi');
  task=await h.runtime.brain.get(identity);
  assert.equal(task.status,'completed');assert.equal(task.turns,3);assert.ok(task.steps.every(step=>step.status==='completed'));
  assert.ok(task.receipts.some(receipt=>receipt.tool==='prepare_document'&&receipt.status==='prepared'&&receipt.verified&&receipt.via?.agent==='melodi'));
  const result=await h.store.peekOutbox({owner:OWNER,agent:'melodi',messageKey:`brain-result:${task.id}`,now:h.now});
  assert.equal(result.payload.artifactJobId,'brain-team-report');
  await h.runtime.deliverOutbox();await h.runtime.deliverOutbox();
  assert.equal(deliveries.length,1);assert.equal(deliveries[0][1],'brain-team-report');assert.equal(deliveries[0][2],'Aquí tienes el documento para revisarlo.');
  assert.equal(h.sends.length,0);assert.equal(documents.length,1);assert.equal(reads.length,1);
});

test('an unavailable tool cannot complete an assignment and yields a single honest blocked notice',async()=>{
  const h=await harness({leader:true,generate:async()=>({text:JSON.stringify({action:'tool',tool:'research_public_web',input:{query:'A requested topic'}})}),
    services:{researchPublicWeb:async()=>({configured:true,available:false,results:[],reason:'Provider unavailable'})}});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'unavailable-tool',objective:'Investiga ese tema',requiredTools:['research_public_web']});
  await h.runtime.runAgent('melodi');
  const task=await h.runtime.brain.get({owner:OWNER,agent:'melodi',id:accepted.taskId});assert.equal(task.status,'waiting');assert.equal(task.blocker,'unavailable');
  await h.runtime.deliverNotices();await h.runtime.deliverNotices();assert.equal(h.sends.length,1);assert.match(h.sends[0][2],/No pude terminar/);
});

test('a model cannot replace a required research step with a workspace read or a fabricated success message',async()=>{
  const h=await harness({leader:true,generate:async(_agent,input)=>({text:JSON.stringify(input.task_memory.receipts.length?{action:'message',message:'Ya investigué y terminé todo.'}:{action:'tool',tool:'inspect_workspace',input:{limit:1},plan:[{description:'Consultar datos',tool:'inspect_workspace'}]})})});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'wrong-tools',objective:'Investiga una fuente pública',requiredTools:['research_public_web']});
  const identity={owner:OWNER,agent:'melodi',id:accepted.taskId};
  await h.runtime.runAgent('melodi');let task=await h.runtime.brain.get(identity);
  assert.equal(task.status,'waiting');assert.equal(task.blocker,'next_action_required');assert.equal(task.receipts.length,1);assert.equal(h.generated.length,4);
  assert.equal((await h.store.listEvents({owner:OWNER,agent:'melodi'})).filter(event=>event.status==='pending').length,1);
  for(let turn=1;turn<6;turn++){h.advance(0.05);await h.runtime.runAgent('melodi');}
  task=await h.runtime.brain.get(identity);
  assert.equal(task.status,'failed');assert.equal(task.blocker,'objective_execution_budget_exhausted');assert.equal(task.turns,6);
  assert.equal(task.receipts.length,1);assert.equal(h.generated.length,24);assert.ok(task.steps.some(step=>step.tool==='research_public_web'&&step.status==='pending'));
  h.advance(0.05);await h.runtime.runAgent('melodi');assert.equal(h.generated.length,24);
  assert.equal(h.database.sql.prepare('SELECT count(*) AS n FROM wa_melodi_work_outbox').get().n,0);
});

test('premature prose without a real plan stops after the four-call correction budget',async()=>{
  const h=await harness({leader:true,generate:async()=>({action:'wait',message:'Ya terminé.'})});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'unplanned-prose',objective:'Investiga una fuente pública',requiredTools:['research_public_web']});
  await h.runtime.runAgent('melodi');
  const task=await h.runtime.brain.get({owner:OWNER,agent:'melodi',id:accepted.taskId});
  assert.equal(task.status,'failed');assert.equal(task.blocker,'required_steps_not_executed');assert.equal(task.receipts.length,0);assert.equal(h.generated.length,4);
  assert.equal(h.database.sql.prepare('SELECT count(*) AS n FROM wa_melodi_work_outbox').get().n,0);
});

test('a proven objective stops at twelve verified operations before another tool dispatch',async()=>{
  const queries=[],workspaceReads=[];
  const h=await harness({leader:true,generate:async(_agent,input)=>{
    const next=input.task_memory.receipts.length;
    return next>=12?{action:'tool',tool:'inspect_workspace',input:{limit:1}}
      :{action:'tool',tool:'research_public_web',input:{query:'Source '+next},plan:Array.from({length:12},(_,i)=>({description:'Consultar fuente '+i,tool:'research_public_web'}))};
  },services:{async researchPublicWeb({query}){queries.push(query);return{configured:true,results:[{title:query,url:'https://example.org/'+queries.length}]};},
    async inspectWorkspace(){workspaceReads.push(true);return{projects:[]};}}});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'twelve-operations',objective:'Compara doce fuentes',requiredTools:['research_public_web']});
  const identity={owner:OWNER,agent:'melodi',id:accepted.taskId};
  await h.runtime.brain.setPlan({...identity,steps:Array.from({length:12},(_,i)=>({description:'Consultar fuente '+i,tool:'research_public_web'}))});
  for(let i=0;i<10;i++)await h.runtime.brain.recordToolOutcome({...identity,operationKey:`${accepted.taskId}:step${i}`,tool:'research_public_web',
    result:{ok:true,receipt:{tool:'research_public_web',verified:true,status:'observed'}}});
  await h.runtime.runAgent('melodi');const task=await h.runtime.brain.get(identity);
  assert.equal(queries.length,2);assert.equal(task.receipts.length,12);assert.equal(task.status,'completed');assert.equal(workspaceReads.length,0);
  assert.equal(h.database.sql.prepare('SELECT count(*) AS n FROM wa_melodi_work_outbox').get().n,1);
});

test('already proven work finalizes at the execution budget boundary without another model call',async()=>{
  const h=await harness({leader:true});
  const accepted=await h.runtime.control({action:'objective_request',agent:'melodi',messageId:'proven-budget-boundary',objective:'Contrasta doce fuentes',requiredTools:['research_public_web']});
  const identity={owner:OWNER,agent:'melodi',id:accepted.taskId};
  await h.runtime.brain.setPlan({...identity,steps:Array.from({length:12},(_,i)=>({description:'Consultar fuente '+i,tool:'research_public_web'}))});
  for(let i=0;i<12;i++)await h.runtime.brain.recordToolOutcome({...identity,operationKey:`${accepted.taskId}:step${i}`,tool:'research_public_web',
    result:{ok:true,receipt:{tool:'research_public_web',verified:true,status:'observed'}}});
  for(let i=0;i<6;i++){await h.runtime.brain.wait({...identity,reason:'next_action_required'});await h.runtime.brain.start(identity);}
  await h.runtime.runAgent('melodi');const task=await h.runtime.brain.get(identity);
  assert.equal(task.status,'completed');assert.equal(task.turns,6);assert.equal(task.receipts.length,12);assert.equal(h.generated.length,0);
  assert.equal(h.database.sql.prepare('SELECT count(*) AS n FROM wa_melodi_work_outbox').get().n,1);
});
