import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createAutonomyStore } from '../melodi-autonomy-store.js';
import { createTeamCoordinator } from '../melodi-team-coordination.js';
import { createAgentRuntime } from '../melodi-autonomy.js';
import { runWeeklyResearch } from '../melodi-routine-workflow.js';
import { GOOGLE_CALENDAR_SCHEMA } from '../google-calendar-store.js';
import { applyCalendarChange, routineCalendarRunState } from '../google-calendar-schedules.js';

const OWNER = '18095550000';
const source = { title: 'Un ejemplo de formato', url: 'https://www.instagram.com/reel/verified-example/',
  publishedDate: '2026-10-08T14:00:00Z', highlights: ['El reel muestra cómo se prepara una edición.'] };

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec('PRAGMA foreign_keys=ON'); }
  prepare(query) {
    const database = this;
    const make = values => ({ query, values, bind: (...next) => make(next),
      async run() { return database.execute(query, values); },
      async all() { return database.execute(query, values); },
      async first() { return database.execute(query, values).results[0] ?? null; } });
    return make([]);
  }
  execute(query, values) {
    const statement = this.sql.prepare(query);
    if (statement.columns().length) return { results: statement.all(...values).map(row => ({ ...row })),
      meta: { changes: Number(this.sql.prepare('SELECT changes() AS n').get().n) } };
    return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const result = statements.map(item => this.execute(item.query, item.values)); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

async function integrationHarness({ publicSources = [source], onResearch } = {}) {
  const database = new SqliteD1();
  for (const file of ['melodi-team-coordination.sql', 'melodi-permissions.sql', 'melodi-routines.sql', 'melodi-autonomy-maintenance.sql', 'melodi-artifact-tracking.sql']) {
    database.sql.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  }
  database.sql.exec(`CREATE TABLE wa_owner_jobs (id TEXT PRIMARY KEY, owner_phone TEXT, status TEXT, job_type TEXT,
    encrypted_payload TEXT, payload_iv TEXT, error_code TEXT, completed_at TEXT, created_at TEXT)`);
  let current = Date.parse('2026-10-08T13:00:00Z');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const reads = [], documents = [], sends = [], emails = [], artifacts = [], generated = [];
  let runtime;
  const services = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
      return { encrypted: Buffer.from(encrypted).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(encrypted, iv) {
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(encrypted, 'base64'));
      return JSON.parse(new TextDecoder().decode(bytes));
    },
    async researchPublicMarketing(input) { reads.push(input);if(onResearch)await onResearch(input);return { configured: true, results: publicSources }; },
    async generate(agent, contents) {
      generated.push({ agent, contents });
      if (contents.reportSections) return { text: JSON.stringify({ formats: [], hypotheses: [], limitations: [] }) };
      return { text: JSON.stringify({ action: 'wait', checkpoint: { summary: 'Sin acción adicional.' } }) };
    },
    async inspectWorkspace() { return { projects: [], calendar: [], jobs: [] }; },
    async privateJobInfo(owner,jobId) {
      const row=database.sql.prepare('SELECT * FROM wa_owner_jobs WHERE id=? AND owner_phone=?').get(jobId,owner);
      if(!row)return null;const payload=await services.decrypt(row.encrypted_payload,row.payload_iv);
      return {row,agent:payload.autonomyAgent,runKey:payload.autonomyRunKey,channel:payload.autonomyChannel,
        routineId:payload.autonomyRoutineId,origin:'autonomy'};
    },
    async prepareDocument(input) {
      documents.push(input);
      const jobId = `weekly-pdf-${documents.length}`;
      const sealed = await services.encrypt({ deliveryMode: 'private', autonomyAgent: input.agent,
        autonomyRunKey:input.runKey,autonomyRoutineId:input.routineId,autonomyChannel:input.channel });
      database.sql.prepare(`INSERT INTO wa_owner_jobs(id,owner_phone,status,job_type,encrypted_payload,payload_iv,created_at)
        VALUES (?,?,'waiting','generate_document',?,?,?)`).run(jobId, input.ownerPhone, sealed.encrypted, sealed.iv, new Date(current).toISOString());
      await runtime.artifacts.register({ jobId, owner: input.ownerPhone, agent: input.agent, jobType: 'generate_document',
        channel: input.channel || 'auto', routineId: input.routineId, runKey: input.runKey, approvalId: input.approvalId });
      return { status: 'queued', jobId };
    },
    async emailOwner(...args) { emails.push(args); return { status: 'sent' }; },
    async deliverArtifact(...args) { artifacts.push(args); return { status: 'sent' }; },
  };
  const store = createAutonomyStore(database, { ...services, now: () => current });
  await store.ensureSchema();
  const coordinator = createTeamCoordinator(database, services);
  const env = { OWNER_WHATSAPP_NUMBER: OWNER, TEAM_AUTONOMY_ENABLED: 'true', VETSA_CLOUD: database,
    MELODI_JOBS: { async send() {} } };
  runtime = createAgentRuntime(env, { store, coordinator, services, now: () => current,
    async sendText(...args) { sends.push(args); } });
  await runtime.initialize();
  return { runtime, store, coordinator, database, services, env, reads, documents, sends, emails, artifacts, generated,
    get now() { return new Date(current).toISOString(); }, advance(minutes) { current += minutes * 60000; } };
}

async function dueWeekly(context, { channel = 'email' } = {}) {
  const response = await context.runtime.control({ action: 'create_routine', agent: 'melodi', messageId: 'routine-create-owner',
    routine: { profile: 'https://www.instagram.com/example/', brief: 'Estudiar los formatos y su evidencia pública.', title: 'Informe semanal original de Melodi', channel } });
  assert.match(response, /Registré tu encargo semanal/);
  const [routine] = await context.runtime.routines.list(OWNER, 'melodi');
  context.advance(1440);
  await context.runtime.tick();
  await context.runtime.runAgent('melodi');
  return routine;
}

test('Melodi level one researches but prepares no document until the owner approves Melodi help', async () => {
  const context = await integrationHarness();
  const routine = await dueWeekly(context);
  assert.equal(context.reads.length, 1);
  assert.equal(context.documents.length, 0);
  const pending = await context.runtime.permissions.listPending(OWNER);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requester, 'melodi'); assert.equal(pending[0].helper, 'melodi');
  assert.equal(pending[0].tool, 'prepare_document'); assert.equal(pending[0].status, 'pending');
  assert.equal((await context.store.getCheckpoint(OWNER, 'melodi')).result, 'waiting_approval');
  const approval = await context.runtime.control({ action: 'approval', approvalId: pending[0].id, approved: true, messageId: 'owner-approves-weekly' });
  assert.match(approval, /Melodi: Aprobación registrada/);
  await context.runtime.runAgent('melodi');
  assert.equal(context.documents.length, 1);
  const document = context.documents[0];
  assert.equal(document.agent, 'melodi'); assert.equal(document.ownerPhone, OWNER);
  assert.equal(document.title, 'Informe semanal original de Melodi');
  assert.equal(document.routineId, routine.id); assert.equal(document.channel, 'email');
  assert.ok(document.content.includes(source.url));
  assert.equal(document.approvalId, pending[0].id);
  const tracking = context.database.sql.prepare('SELECT * FROM wa_melodi_artifact_tracking').get();
  assert.equal(tracking.agent, 'melodi'); assert.equal(tracking.channel, 'email'); assert.equal(tracking.routine_id, routine.id);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(pending[0].id).status, 'completed');
  assert.equal(context.sends.length, 0); assert.equal(context.emails.length, 0);
  context.advance(60);
  await context.runtime.control({ action: 'approval', approvalId: pending[0].id, approved: true, messageId: 'replay-approved-weekly' });
  await context.runtime.runAgent('melodi');
  assert.equal(context.documents.length, 1);
  assert.equal(context.reads.length, 1);
});

test('owner denial never executes document preparation or another helper path', async () => {
  const context = await integrationHarness();
  await dueWeekly(context);
  const [pending] = await context.runtime.permissions.listPending(OWNER);
  await context.runtime.control({ action: 'approval', approvalId: pending.id, approved: false, messageId: 'owner-denies-weekly' });
  context.advance(60);
  await context.runtime.runAgent('melodi');
  await context.runtime.runAgent('melodi');
  assert.equal(context.documents.length, 0);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(pending.id).status, 'denied');
  assert.equal(context.reads.length, 1);
  assert.equal(context.database.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_permission_requests').get().n, 1);
});

test('create and stop use independent owner message keys and cancelled work is not researched', async () => {
  const context = await integrationHarness();
  await context.runtime.control({ action: 'create_routine', agent: 'melodi', messageId: 'create-message-key',
    routine: { profile: '@example', channel: 'whatsapp', weekday: 5, hour: '09:00' } });
  const [routine] = await context.runtime.routines.list(OWNER, 'melodi');
  const stopped = await context.runtime.control({ action: 'stop_routine', routineId: routine.id, messageId: 'distinct-stop-message-key' });
  assert.match(stopped, /Detuve el encargo/);
  assert.equal((await context.runtime.routines.list(OWNER, 'melodi'))[0].status, 'stopped');
  context.advance(1440);
  await context.runtime.tick();
  await context.runtime.runAgent('melodi');
  assert.equal(context.reads.length, 0); assert.equal(context.documents.length, 0);
});

test('stop between approval and helper execution blocks the already approved effect', async () => {
  const context = await integrationHarness();
  const routine = await dueWeekly(context);
  const [pending] = await context.runtime.permissions.listPending(OWNER);
  await context.runtime.control({ action: 'approval', approvalId: pending.id, approved: true, messageId: 'approve-before-stop' });
  await context.runtime.control({ action: 'stop_routine', routineId: routine.id, messageId: 'stop-after-approval' });
  await context.runtime.runAgent('melodi');
  assert.equal(context.documents.length, 0);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(pending.id).status, 'failed');
});

test('a cancelled routine already present in the outbox sends no WhatsApp or email', async () => {
  const context = await integrationHarness();
  const routine = await context.runtime.routines.create({ owner: OWNER, agent: 'melodi', eventKey: 'cancelled-outbox', title: 'Cancelar informe', profile: '@example', channel: 'email' });
  await context.store.enqueueOutbox({ owner: OWNER, agent: 'melodi', messageKey: 'already-queued-report',
    payload: { body: 'Melodi: Preparé tu informe.', routineId: routine.id, artifactJobId: 'cancelled-pdf', channel: 'email' } });
  await context.runtime.control({ action: 'stop_routine', routineId: routine.id, messageId: 'cancel-outbox' });
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.length, 0); assert.equal(context.emails.length, 0); assert.equal(context.artifacts.length, 0);
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.failed, 1);
});

test('explicit email preference sends the assigned agent report without a WhatsApp attempt', async () => {
  const context = await integrationHarness();
  const routine = await context.runtime.routines.create({ owner: OWNER, agent: 'melodi', eventKey: 'email-first', title: 'Informe por correo', profile: '@example', channel: 'email' });
  await context.runtime.artifacts.register({jobId:'email-pdf',owner:OWNER,agent:'melodi',jobType:'generate_document',channel:'email',routineId:routine.id});
  const sealed=await context.services.encrypt({deliveryMode:'private',autonomyAgent:'melodi',autonomyChannel:'email',autonomyRoutineId:routine.id});
  context.database.sql.prepare("INSERT INTO wa_owner_jobs(id,owner_phone,status,job_type,created_at,encrypted_payload,payload_iv) VALUES(?,?,'complete','generate_document',?,?,?)").run('email-pdf',OWNER,context.now,sealed.encrypted,sealed.iv);
  const claim=await context.runtime.artifacts.claim({owner:OWNER,jobId:'email-pdf',now:context.now});
  const outbox=await context.store.enqueueOutbox({ owner: OWNER, agent: 'melodi', messageKey: 'preferred-email-report',
    payload: { body: 'Melodi: Preparé tu informe semanal.', routineId: routine.id, artifactJobId: 'email-pdf', channel: 'email' } });
  await context.runtime.artifacts.markEnqueued({owner:OWNER,jobId:'email-pdf',token:claim.token,outboxId:outbox.id,now:context.now});
  await context.runtime.deliverOutbox();
  assert.equal(context.sends.length, 0); assert.equal(context.artifacts.length, 0);
  assert.equal(context.emails.length, 1);
  assert.equal(context.emails[0][0], OWNER); assert.equal(context.emails[0][2], 'melodi');
  assert.equal(context.emails[0][4], 'email-pdf');
  assert.equal((await context.store.getState(OWNER, 'melodi')).outboxCounts.sent, 1);
  await context.runtime.deliverOutbox();
  assert.equal(context.emails.length, 1);
});

test('a denied workflow service returns blocked without generating or preparing a document', async () => {
  let generated = 0, prepared = 0;
  const result = await runWeeklyResearch({ agent: 'melodi', owner: OWNER, eventId: 'permission-blocked-weekly', now: '2026-10-09T13:00:00Z',
    routine: { id: 'blocked-routine', agent: 'melodi', profile: '@example', brief: 'Investigar formatos' } }, {
    isRoutineActive: async () => true,
    researchPublicMarketing: async () => ({ allowed: false, status: 'blocked', reason: 'no_higher_level_helper' }),
    generate: async () => { generated++; }, prepareDocument: async () => { prepared++; },
  });
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'no_higher_level_helper');
  assert.equal(result.receipt.verified, false); assert.equal(generated, 0); assert.equal(prepared, 0);
});

test('large weekly research crosses real owner approval within tool bounds and retains all sources and limits', async () => {
  const publicSources = Array.from({ length: 12 }, (_, i) => {
    const prefix = `https://www.instagram.com/reel/public-source-${i}/?context=`;
    return { ...source, url: prefix + 'x'.repeat(480 - prefix.length),
      title: 'Título público extenso '.repeat(30), highlights: ['El reel muestra un proceso. '.repeat(100), 'Más detalles '.repeat(100)],
      summary: 'Contenido adicional público '.repeat(100),
      visibleMetrics: { likes: 200 + i, comments: 15 + i, views: 1000 + i } };
  });
  const context = await integrationHarness({ publicSources });
  await context.runtime.control({ action: 'create_routine', agent: 'melodi', messageId: 'create-large-weekly',
    routine: { profile: 'https://www.instagram.com/example/', brief: 'Investiga formatos públicos y sus límites. '.repeat(300),
      title: 'Informe extenso de investigación '.repeat(12), channel: 'email' } });
  context.advance(1440);
  await context.runtime.tick();
  await context.runtime.runAgent('melodi');
  assert.equal(context.reads.length, 1);
  assert.ok(context.reads[0].query.length <= 700);
  assert.ok(context.reads[0].query.includes('https://www.instagram.com/example/'));
  assert.ok(context.reads[0].query.includes('2026-10-02T09:00 a 2026-10-09T09:00'));
  const model = context.generated.find(call => call.contents.reportSections);
  assert.equal(model.contents.evidence.length, 12);
  assert.ok(model.contents.evidence.every(item => item.excerpt.length <= 800));
  assert.equal(context.documents.length, 0);
  const [approval] = await context.runtime.permissions.listPending(OWNER);
  assert.equal(approval.tool, 'prepare_document');
  await context.runtime.control({ action: 'approval', approvalId: approval.id, approved: true, messageId: 'approve-large-weekly' });
  await context.runtime.runAgent('melodi');
  assert.equal(context.documents.length, 1);
  const document = context.documents[0];
  assert.equal(document.format, 'pdf');
  assert.ok(document.title.length <= 160);
  assert.ok(document.content.length <= 16000);
  for (const publicSource of publicSources) assert.ok(document.content.includes(publicSource.url));
  for (const heading of ['ALCANCE Y PERÍODO', 'FORMATOS OBSERVADOS', 'EJEMPLOS Y FUENTES', 'MÉTRICAS VISIBLES Y AUSENTES', 'HIPÓTESIS Y EXPERIMENTOS PROPUESTOS', 'LIMITACIONES Y CONFIANZA']) assert.ok(document.content.includes(heading));
  assert.match(document.content, /No puedo afirmar viralidad/);
  assert.match(document.content, /métricas privadas: no disponibles/);
  assert.equal(context.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).status, 'completed');
});

async function queuedCalendarRoutine(context,{level=2}={}) {
  if(level!==1)await context.runtime.permissions.adjustLevel({owner:OWNER,agent:'melodi',level,eventKey:'calendar-fixture-level'});
  await context.runtime.control({action:'create_routine',agent:'melodi',messageId:'calendar-create',routine:{profile:'@example',
    brief:'Estudiar los formatos y su evidencia pública.',title:'Informe original de Melodi',channel:'email'}});
  const [routine]=await context.runtime.routines.list(OWNER,'melodi');context.advance(1440);await context.runtime.tick();
  const row=context.database.sql.prepare("SELECT * FROM wa_melodi_work_events WHERE type='weekly_research'").get();
  const decoded=await context.services.decrypt(row.payload_encrypted,row.payload_iv);
  const payload=typeof decoded==='string' ? JSON.parse(decoded):decoded;
  context.database.sql.exec(GOOGLE_CALENDAR_SCHEMA.join(';'));
  context.database.sql.prepare(`INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,status,updated_at)
    VALUES(?,'agent_routine',?,'melodi','calendar-series','active',?)`).run(OWNER,routine.id,Date.parse(context.now));
  return {routine,event:row,snapshot:payload.routine};
}
async function calendarInstance(context,queued,{status='updated',hours=2,title='Informe retimado de Melodi'}={}) {
  const startAt=new Date(Date.parse(context.now)+hours*3600000).toISOString();
  const mapping={owner:OWNER,kind:'agent_routine',id:queued.routine.id,agent:'melodi',googleEventId:'calendar-instance'};
  const change={...mapping,status,title,startAt,endAt:new Date(Date.parse(startAt)+15*60000).toISOString(),
    recurringEventId:'calendar-series',originalStartAt:queued.snapshot.originalOccurrenceAt,updatedAt:context.now};
  assert.equal((await applyCalendarChange(context.env,OWNER,mapping,change,{services:context.services,now:()=>Date.parse(context.now)})).applied,true);
  return startAt;
}

test('a retimed queued run waits without using retries then executes at its new time with the original assignment and private brief',async()=>{
  const c=await integrationHarness(),q=await queuedCalendarRoutine(c),at=await calendarInstance(c,q);
  const state=await routineCalendarRunState(c.env,OWNER,q.routine.id,q.snapshot.runKey,{services:c.services,now:()=>Date.parse(c.now)});
  assert.equal(state.status,'waiting');assert.equal(state.startAt,at);assert.equal(JSON.stringify(state).includes(q.routine.brief),false);
  await c.runtime.runAgent('melodi');assert.equal(c.reads.length,0);assert.equal(c.documents.length,0);
  const event=c.database.sql.prepare('SELECT status,available_at,attempts FROM wa_melodi_work_events WHERE id=?').get(q.event.id);
  assert.equal(event.status,'pending');assert.equal(event.available_at,Date.parse(at));assert.equal(event.attempts,0);
  assert.equal((await c.store.getState(OWNER,'melodi')).runs_today,0);
  c.advance(119);await c.runtime.runAgent('melodi');assert.equal(c.reads.length,0);
  c.advance(1);await c.runtime.runAgent('melodi');assert.equal(c.reads.length,1);assert.equal(c.documents.length,1);
  const doc=c.documents[0];assert.equal(doc.title,'Informe retimado de Melodi');assert.equal(doc.agent,'melodi');
  assert.equal(doc.channel,'email');assert.equal(doc.runKey,q.snapshot.runKey);assert.ok(c.reads[0].query.includes(q.routine.brief));
  assert.ok(doc.content.startsWith('Informe retimado de Melodi'));await c.runtime.runAgent('melodi');assert.equal(c.documents.length,1);
});

test('a quarantined queued routine stays pending through repeated reviews and resumes after correction',async()=>{
  const c=await integrationHarness(),q=await queuedCalendarRoutine(c);c.database.sql.prepare("UPDATE melodi_google_calendar_activity_map SET status='unsupported'").run();
  for(let review=0;review<4;review++){await c.runtime.runAgent('melodi');c.advance(1);}
  const row=c.database.sql.prepare('SELECT status,attempts FROM wa_melodi_work_events WHERE id=?').get(q.event.id);
  assert.equal(row.status,'pending');assert.equal(row.attempts,0);assert.equal(c.reads.length,0);
  assert.equal((await c.store.getState(OWNER,'melodi')).runs_today,0);
  c.database.sql.prepare("UPDATE melodi_google_calendar_activity_map SET status='active'").run();
  await c.runtime.runAgent('melodi');assert.equal(c.documents.length,1);assert.equal(c.documents[0].agent,'melodi');
});

test('cancelling the queued occurrence prevents research while preserving the next weekly assignment',async()=>{
  const c=await integrationHarness(),q=await queuedCalendarRoutine(c);await calendarInstance(c,q,{status:'cancelled'});
  await c.runtime.runAgent('melodi');assert.equal(c.reads.length,0);assert.equal(c.documents.length,0);
  assert.equal(c.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(q.event.id).status,'done');
  assert.equal((await c.runtime.routines.list(OWNER,'melodi'))[0].status,'active');
});

test('retiming between owner approval and helper execution leaves the grant unclaimed until the new time',async()=>{
  const c=await integrationHarness(),q=await queuedCalendarRoutine(c,{level:1});await c.runtime.runAgent('melodi');
  const [approval]=await c.runtime.permissions.listPending(OWNER);
  await c.runtime.control({action:'approval',approvalId:approval.id,approved:true,messageId:'calendar-approve'});
  const at=await calendarInstance(c,q,{title:'Entrega futura de Melodi'});await c.runtime.runAgent('melodi');assert.equal(c.documents.length,0);
  assert.equal(c.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).status,'approved');
  const event=c.database.sql.prepare("SELECT status,available_at,attempts FROM wa_melodi_work_events WHERE type='approved_action'").get();
  assert.equal(event.status,'pending');assert.equal(event.available_at,Date.parse(at));assert.equal(event.attempts,0);
  c.advance(120);await c.runtime.runAgent('melodi');assert.equal(c.documents.length,1);assert.equal(c.documents[0].title,'Entrega futura de Melodi');
  assert.equal(c.documents[0].agent,'melodi');assert.equal(c.documents[0].channel,'email');
  assert.equal(c.database.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).status,'completed');
});

test('retiming during public research keeps the queued event instead of losing its already claimed occurrence',async()=>{
  let c,q,retimed=false;c=await integrationHarness({onResearch:async()=>{if(!retimed){retimed=true;await calendarInstance(c,q);}}});
  q=await queuedCalendarRoutine(c);await c.runtime.runAgent('melodi');assert.equal(c.reads.length,1);assert.equal(c.documents.length,0);
  assert.equal(c.database.sql.prepare('SELECT status FROM wa_melodi_work_events WHERE id=?').get(q.event.id).status,'pending');
  c.advance(120);await c.runtime.runAgent('melodi');assert.equal(c.documents.length,1);assert.equal(c.documents[0].title,'Informe retimado de Melodi');
});

test('a completed private PDF already in the outbox waits for its retimed delivery without using a contact attempt',async()=>{
  const c=await integrationHarness(),q=await queuedCalendarRoutine(c);await c.runtime.runAgent('melodi');
  c.database.sql.prepare("UPDATE wa_owner_jobs SET status='complete'").run();c.advance(60);await c.runtime.tick();
  const outbox=c.database.sql.prepare('SELECT id FROM wa_melodi_work_outbox WHERE agent=?').get('melodi');assert.ok(outbox);
  const at=await calendarInstance(c,q);await c.runtime.deliverOutbox();
  assert.equal(c.emails.length,0);assert.equal(c.artifacts.length,0);assert.equal(c.sends.length,0);
  const row=c.database.sql.prepare('SELECT status,available_at,attempts FROM wa_melodi_work_outbox WHERE id=?').get(outbox.id);
  assert.equal(row.status,'pending');assert.equal(row.available_at,Date.parse(at));assert.equal(row.attempts,0);
  assert.equal((await c.store.getState(OWNER,'melodi')).messages_today,0);
  c.advance(120);await c.runtime.deliverOutbox();assert.equal(c.emails.length,1);assert.equal(c.emails[0][2],'melodi');
  assert.equal(c.database.sql.prepare('SELECT status FROM wa_melodi_work_outbox WHERE id=?').get(outbox.id).status,'sent');
  await c.runtime.deliverOutbox();assert.equal(c.emails.length,1);
});

test('cancelling a deferred PDF occurrence prevents its later email delivery',async()=>{
  const c=await integrationHarness(),q=await queuedCalendarRoutine(c);await c.runtime.runAgent('melodi');
  c.database.sql.prepare("UPDATE wa_owner_jobs SET status='complete'").run();c.advance(60);await c.runtime.tick();
  const outbox=c.database.sql.prepare('SELECT id FROM wa_melodi_work_outbox WHERE agent=?').get('melodi');
  await calendarInstance(c,q);await c.runtime.deliverOutbox();await calendarInstance(c,q,{status:'cancelled'});
  c.advance(120);await c.runtime.deliverOutbox();assert.equal(c.emails.length,0);assert.equal(c.sends.length,0);
  assert.equal(c.database.sql.prepare('SELECT status FROM wa_melodi_work_outbox WHERE id=?').get(outbox.id).status,'failed');
});

test('routine deferral requires both current leases and cannot partially roll back a failed D1 batch',async()=>{
  const c=await integrationHarness(),q=await queuedCalendarRoutine(c),claim=await c.store.claimEvent({owner:OWNER,agent:'melodi',now:c.now});
  const input={owner:OWNER,agent:'melodi',eventId:claim.id,leaseToken:claim.leaseToken,routineId:q.routine.id,runKey:q.snapshot.runKey,
    retryAt:new Date(Date.parse(c.now)+60000).toISOString(),now:c.now};
  await assert.rejects(c.store.deferRoutineEvent({...input,runKey:`routine:${q.routine.id}:1`}),/scope mismatch/);
  const execute=c.database.execute.bind(c.database);
  c.database.execute=(query,values)=>{if(query.startsWith('UPDATE wa_melodi_work_state SET lease_token=NULL'))throw new Error('forced transaction failure');return execute(query,values);};
  await assert.rejects(c.store.deferRoutineEvent(input),/forced transaction failure/);c.database.execute=execute;
  let row=c.database.sql.prepare('SELECT status,attempts,lease_token FROM wa_melodi_work_events WHERE id=?').get(claim.id);
  assert.equal(row.status,'processing');assert.equal(row.attempts,1);assert.equal(row.lease_token,claim.leaseToken);
  assert.equal((await c.store.getState(OWNER,'melodi')).runs_today,1);
  c.database.sql.prepare("UPDATE wa_melodi_work_state SET lease_token='replacement' WHERE owner=? AND agent='melodi'").run(OWNER);
  assert.equal(await c.store.deferRoutineEvent(input),false);row=c.database.sql.prepare('SELECT status,attempts FROM wa_melodi_work_events WHERE id=?').get(claim.id);
  assert.equal(row.status,'processing');assert.equal(row.attempts,1);
});
