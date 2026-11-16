import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { createAgentRuntime } from '../melodi-autonomy.js';
import { createAutonomyStore } from '../melodi-autonomy-store.js';

const OWNER = '18095550101', OTHER = '18095559999';
const financialObservation = () => ({ status: 'observed', report: 'Hay dos registros comprobados en USD.',
  summary: { currencies: { USD: { income: 20, expense: 5 } } }, recordCount: 2 });

async function fixture(generate, extraServices = {}) {
  const db = new FinanceD1();
  for (const migration of ['schema.sql', 'melodi-team-coordination.sql', 'melodi-permissions.sql', 'melodi-routines.sql',
    'melodi-autonomy-maintenance.sql', 'melodi-artifact-tracking.sql']) {
    db.sql.exec(readFileSync(new URL(`../${migration}`, import.meta.url), 'utf8'));
  }
  let now = Date.parse('2026-10-17T16:00:00Z');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const calls = { finance: [], metrics: [], sends: [], generated: [], queued: [], research: [], documents: [], artifacts: [] };
  const services = {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      return { encrypted: Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
        new TextEncoder().encode(JSON.stringify(value)))).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(value, iv) {
      return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(value, 'base64'))));
    },
    async generate(agent, input) { calls.generated.push({ agent, input }); return generate(agent, input); },
    async inspectWorkspace() { return { projects: [], calendar: [], jobs: [] }; },
    async inspectFinances(input) { calls.finance.push(input); return financialObservation(); },
    async accountMetrics(input) { calls.metrics.push(input); return { connected: true, metrics: { followers: 42 }, verifiedAt: new Date(now).toISOString() }; },
    async researchPublicWeb(input) { calls.research.push(input); return { configured: true,
      results: [{ title: 'Synthetic official source', url: 'https://example.org/verified-source', highlights: ['One documented source.'] }] }; },
    async prepareDocument(input) { calls.documents.push(input); return { status: 'prepared', jobId: 'synthetic-four-agent-report',
      artifact: { objectKey: 'synthetic-private/report.pdf', mimeType: 'application/pdf' } }; },
    async deliverArtifact(...args) { calls.artifacts.push(args); return { status: 'sent', messageId: 'synthetic-artifact-receipt' }; },
    async privateJobInfo() { return null; },
    ...extraServices,
  };
  const env = { VETSA_CLOUD: db, OWNER_WHATSAPP_NUMBER: OWNER, TEAM_AUTONOMY_ENABLED: 'true', TEAM_CONVERSATION_LEADER: 'melodi',
    MELODI_JOBS: { async send(value) { calls.queued.push(value); } } };
  const store = createAutonomyStore(db, { ...services, now: () => now });
  await store.ensureSchema();
  const runtime = createAgentRuntime(env, { store, services, now: () => now,
    async sendText(...args) { calls.sends.push(args); return { status: 'sent', messageId: `synthetic-receipt-${calls.sends.length}` }; } });
  await runtime.initialize();
  return { db, runtime, calls, services, async tick() { now += 3000; return runtime.tick(); },
    task: (agent, id) => runtime.brain.get({ owner: OWNER, agent, id }) };
}

function moraDecision(_agent, input) {
  const task = input.task_memory;
  if (!task.receipts.some(receipt => receipt.tool === 'inspect_finances')) return { action: 'tool', tool: 'inspect_finances', input: { section: 'summary' },
    plan: [{ description: 'Comprobar finanzas registradas', tool: 'inspect_finances' }, { description: 'Comprobar métricas conectadas', tool: 'account_metrics' }] };
  if (!task.receipts.some(receipt => receipt.tool === 'account_metrics')) return { action: 'tool', tool: 'account_metrics', input: {} };
  return { action: 'message', message: 'Se verificaron los registros financieros y las métricas conectadas.' };
}

test('Melodi receives verified Melodi finances and metrics, preserves her level and sends only one final leader result', async () => {
  const h = await fixture((agent, input) => {
    if (agent === 'melodi') return moraDecision(agent, input);
    if (!input.task_memory.receipts.length) return { action: 'tool', tool: 'delegate_agent_event', input: { target: 'melodi', task: 'Consulta las finanzas y métricas conectadas solicitadas.' },
      plan: [{ description: 'Recibir análisis comprobado de Melodi', tool: 'delegate_agent_event' },
        { description: 'Contrastar finanzas', tool: 'inspect_finances' }, { description: 'Contrastar métricas', tool: 'account_metrics' }] };
    return { action: 'message', message: 'Melodi comprobó los registros financieros y las métricas conectadas.' };
  });
  const accepted = await h.runtime.control({ action: 'objective_request', agent: 'melodi', messageId: 'synthetic-melodi-assignment',
    objective: 'Revisa con Melodi las finanzas y las métricas de la cuenta conectada.', requiredTools: ['inspect_finances', 'account_metrics'] });
  await h.runtime.runAgent('melodi'); await h.runtime.runAgent('melodi');
  assert.equal(h.calls.finance.length, 1); assert.equal(h.calls.metrics.length, 1); assert.equal(h.calls.sends.length, 0);
  assert.equal(h.calls.finance[0].agent, 'melodi'); assert.equal(h.calls.metrics[0].agent, 'melodi');
  assert.equal(h.calls.metrics[0].ownerPhone, OWNER);
  await h.tick(); await h.runtime.runAgent('melodi');
  const task = await h.task('melodi', accepted.taskId);
  assert.equal(task.status, 'completed');
  for (const tool of ['inspect_finances', 'account_metrics']) assert.ok(task.receipts.some(receipt => receipt.tool === tool
    && receipt.status === 'observed' && receipt.verified && receipt.via?.agent === 'melodi'));
  assert.equal((await h.runtime.permissions.getTeam(OWNER)).find(row => row.agent === 'melodi').level, 1);
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_melodi_permission_requests').get().n, 0);
  await h.runtime.deliverOutbox(); await h.runtime.deliverOutbox();
  assert.equal(h.calls.sends.length, 1); assert.doesNotMatch(h.calls.sends[0][2], /^(?:Melodi|Melodi|Melodi|Melodi|Melodi):|Datos consultados por/i);
  assert.equal(h.calls.finance.length, 1); assert.equal(h.calls.metrics.length, 1);
});

test('Melodi coordinates Melodi, Melodi and Melodi and delivers one verified artifact after all three specialists complete', async () => {
  let h;
  h = await fixture((agent, input) => {
    const task = input.task_memory;
    if (agent === 'melodi') return moraDecision(agent, input);
    if (agent === 'melodi') return task.receipts.length
      ? { action: 'message', message: 'La fuente solicitada está comprobada: https://example.org/verified-source' }
      : { action: 'tool', tool: 'research_public_web', input: { query: 'Synthetic documented source' },
        plan: [{ description: 'Comprobar fuente pública', tool: 'research_public_web' }] };
    if (agent === 'melodi') return task.receipts.length
      ? { action: 'message', message: 'El documento solicitado quedó preparado con los datos comprobados.' }
      : { action: 'tool', tool: 'prepare_document', input: { title: 'Informe sintético del equipo', format: 'pdf', content: task.objective },
        plan: [{ description: 'Preparar el informe privado', tool: 'prepare_document' }] };
    for (const target of ['melodi']) {
      if (task.receipts.some(receipt => receipt.tool === 'delegate_agent_event' && receipt.targetAgent === target && receipt.status === 'completed')) continue;
      if (target === 'melodi') {
        assert.ok(task.memory.some(memory => memory.via?.agent === 'melodi' && memory.fact.includes('verified-source')));
        assert.ok(task.memory.some(memory => memory.via?.agent === 'melodi' && memory.fact.includes('followers')));
      }
      return { action: 'tool', tool: 'delegate_agent_event', input: { target,
        task: target === 'melodi' ? 'Redacta con la fuente https://example.org/verified-source, USD 20 de entradas, USD 5 de salidas y 42 seguidores comprobados.'
          : target === 'melodi' ? 'Consulta las finanzas y métricas conectadas para el informe solicitado.' : 'Investiga la fuente pública solicitada.' },
        plan: [{ description: 'Recibir investigación de Melodi', tool: 'delegate_agent_event' },
          { description: 'Recibir análisis de Melodi', tool: 'delegate_agent_event' }, { description: 'Recibir documento de Melodi', tool: 'delegate_agent_event' },
          ...['research_public_web', 'inspect_finances', 'account_metrics', 'prepare_document'].map(tool => ({ description: `Verificar ${tool}`, tool }))] };
    }
    return { action: 'message', message: 'El equipo contrastó la fuente pública, los registros financieros y las métricas conectadas para preparar el informe.' };
  }, { async privateJobInfo(owner, jobId) {
    if (owner !== OWNER || jobId !== 'synthetic-four-agent-report' || !h.calls.documents.length) return null;
    return { row: { id: jobId, owner_phone: OWNER, status: 'complete' }, agent: 'melodi',
      brainTaskId: h.calls.documents[0].brainTaskId, origin: 'owner_request',
      artifact: { objectKey: 'synthetic-private/report.pdf', mimeType: 'application/pdf', size: 100 } };
  } });
  const accepted = await h.runtime.control({ action: 'objective_request', agent: 'melodi', messageId: 'synthetic-four-agent-assignment',
    objective: 'Investiga una fuente con Melodi, contrasta finanzas y métricas con Melodi y prepara el informe con Melodi.',
    requiredTools: ['research_public_web', 'inspect_finances', 'account_metrics', 'prepare_document'] });
  await h.runtime.runAgent('melodi');
  for (const agent of ['melodi']) {
    await h.runtime.runAgent(agent);
    assert.equal(h.calls.sends.length, 0); assert.equal(h.calls.artifacts.length, 0);
    await h.tick(); await h.runtime.runAgent('melodi');
  }
  const task = await h.task('melodi', accepted.taskId);
  assert.equal(task.status, 'completed'); assert.equal(task.turns, 4);
  assert.deepEqual(task.receipts.filter(receipt => receipt.tool === 'delegate_agent_event').map(receipt => receipt.targetAgent).sort(), ['melodi']);
  assert.equal(h.calls.documents.length, 1); assert.equal(h.calls.documents[0].agent, 'melodi');
  assert.match(h.calls.documents[0].content, /42 seguidores comprobados/);
  assert.match(h.calls.documents[0].content, /dos registros comprobados en USD/);
  await h.runtime.deliverOutbox(); await h.runtime.deliverOutbox();
  assert.equal(h.calls.artifacts.length, 1); assert.equal(h.calls.artifacts[0][2], 'Aquí tienes el documento para revisarlo.');
  assert.doesNotMatch(h.calls.documents[0].content, /Datos consultados por|Reúne el trabajo de/i);
  assert.equal(h.calls.sends.length, 0); assert.equal(h.calls.finance.length, 1); assert.equal(h.calls.metrics.length, 1); assert.equal(h.calls.research.length, 1);
});

test('a Melodi objective needing escalation queues a truthful owner approval notice before any private metrics read', async () => {
  const h = await fixture(() => ({ action: 'tool', tool: 'account_metrics', input: {},
    plan: [{ description: 'Consultar métricas solicitadas', tool: 'account_metrics' }] }));
  await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 1, eventKey: 'synthetic-notice-leader' });
  await h.runtime.control({ action: 'objective_request', agent: 'melodi', messageId: 'synthetic-approval-notice',
    objective: 'Consulta las métricas conectadas.', requiredTools: ['account_metrics'] });
  await h.runtime.runAgent('melodi');
  const [approval] = await h.runtime.permissions.listPending(OWNER);
  assert.ok(approval); assert.equal(h.calls.metrics.length, 0);
  await h.runtime.deliverOutbox();
  assert.equal(h.calls.sends.length, 1, 'an authenticated owner must receive the actionable approval request instead of a silent execution retry');
  assert.match(h.calls.sends[0][2], /autoriza|aprueb|autorización/i);
  assert.doesNotMatch(h.calls.sends[0][2], /ya (?:envié|terminé)|métricas comprobadas/i);
  for (let i = 0; i < 2; i++) { await h.tick(); await h.runtime.deliverOutbox(); await h.runtime.deliverNotices(); }
  assert.equal(h.calls.sends.length, 1, 'a pending authorization must not create an extra failure notice or repeat its approval question');
  assert.equal(h.calls.metrics.length, 0);
});

test('approved escalation correlates its metrics receipt back to the waiting Melodi objective without repeating the read', async () => {
  const h = await fixture((_agent, input) => input.task_memory.receipts.some(receipt => receipt.tool === 'account_metrics')
    ? { action: 'message', message: 'Las métricas solicitadas están comprobadas.' }
    : { action: 'tool', tool: 'account_metrics', input: {}, plan: [{ description: 'Comprobar métricas solicitadas', tool: 'account_metrics' }] });
  await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 1, eventKey: 'synthetic-lower-leader' });
  const accepted = await h.runtime.control({ action: 'objective_request', agent: 'melodi', messageId: 'synthetic-metrics-escalation',
    objective: 'Melodi, consulta las métricas de la cuenta conectada.', requiredTools: ['account_metrics'] });
  await h.runtime.runAgent('melodi');
  assert.equal(h.calls.metrics.length, 0, 'an unapproved escalation must not read metrics');
  assert.equal((await h.task('melodi', accepted.taskId)).status, 'waiting');
  const [approval] = await h.runtime.permissions.listPending(OWNER);
  assert.ok(approval); assert.equal(approval.helper, 'melodi');
  await h.runtime.control({ action: 'approval', agent: approval.helper, approvalId: approval.id, approved: true, messageId: 'synthetic-approval' });
  await Promise.all([h.runtime.runAgent(approval.helper), h.runtime.runAgent(approval.helper)]);
  await h.runtime.runAgent(approval.helper);
  assert.equal(h.calls.metrics.length, 1, 'the explicitly approved read must execute once');
  assert.equal(h.db.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).status, 'completed');
  await h.tick(); await h.runtime.runAgent('melodi');
  const task = await h.task('melodi', accepted.taskId);
  assert.equal(task.status, 'completed', `approved read executed but objective remains ${task.status}/${task.blocker}; receipts=${task.receipts.length}`);
  assert.ok(task.receipts.some(receipt => receipt.tool === 'account_metrics' && receipt.verified && receipt.status === 'observed'));
  assert.equal(h.calls.metrics.length, 1);
});

test('an approved delegation creates a correlated Melodi child and resumes the original Melodi objective once', async () => {
  const h = await fixture((agent, input) => {
    const task = input.task_memory;
    if (agent === 'melodi') return task.receipts.length
      ? { action: 'message', message: 'Los registros financieros solicitados están comprobados.' }
      : { action: 'tool', tool: 'inspect_finances', input: { section: 'summary' }, plan: [{ description: 'Consultar registros', tool: 'inspect_finances' }] };
    return task.receipts.length ? { action: 'message', message: 'Melodi verificó los registros financieros solicitados.' }
      : { action: 'tool', tool: 'delegate_agent_event', input: { target: 'melodi', task: 'Consulta los registros financieros solicitados.' },
        plan: [{ description: 'Recibir la consulta de Melodi', tool: 'delegate_agent_event' }, { description: 'Comprobar finanzas', tool: 'inspect_finances' }] };
  });
  await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 1, eventKey: 'synthetic-delegation-leader' });
  const accepted = await h.runtime.control({ action: 'objective_request', agent: 'melodi', messageId: 'synthetic-approved-delegation',
    objective: 'Coordina con Melodi la comprobación de los registros financieros.', requiredTools: ['inspect_finances'] });
  await h.runtime.runAgent('melodi'); const [approval] = await h.runtime.permissions.listPending(OWNER);
  assert.ok(approval); assert.equal(approval.tool, 'delegate_agent_event'); assert.equal(h.calls.finance.length, 0);
  await h.runtime.control({ action: 'approval', approvalId: approval.id, approved: true, messageId: 'synthetic-approve-delegation' });
  await Promise.all([h.runtime.runAgent(approval.helper), h.runtime.runAgent(approval.helper)]);
  const pending = await h.task('melodi', accepted.taskId);
  const receipt = pending.receipts.find(item => item.tool === 'delegate_agent_event');
  assert.equal(receipt.status, 'delegated');
  const child = await h.task('melodi', receipt.operationId);
  assert.equal(child.parentTaskId, accepted.taskId); assert.equal(child.origin, 'delegation');
  assert.equal(h.db.sql.prepare("SELECT COUNT(*) AS n FROM wa_melodi_work_events WHERE type='delegation'").get().n, 0);
  await h.runtime.runAgent('melodi'); await h.tick(); await h.runtime.runAgent('melodi');
  assert.equal((await h.task('melodi', accepted.taskId)).status, 'completed');
  assert.equal(h.calls.finance.length, 1);
  await h.runtime.deliverOutbox(); await h.runtime.deliverOutbox();
  assert.equal(h.calls.sends.length, 1); assert.doesNotMatch(h.calls.sends[0][2], /^(?:Melodi|Melodi|Melodi|Melodi|Melodi):|Datos consultados por/i);
});

test('an approved queued document retains the requester brain identity and completes only after its correlated artifact exists', async () => {
  let h, prepared = null, ready = false;
  h = await fixture((_agent, input) => {
    if (!input.task_memory.receipts.length) return {action:'tool',tool:'inspect_finances',input:{section:'summary'},
      plan:[{description:'Comprobar los registros financieros',tool:'inspect_finances'},{description:'Preparar el informe solicitado',tool:'prepare_document'}]};
    return input.task_memory.receipts.some(receipt=>receipt.tool==='prepare_document')
      ? { action: 'message', message: 'El documento solicitado quedó preparado con los registros comprobados.' }
      : { action: 'tool', tool: 'prepare_document', input: { title: 'Informe sintético', content: 'Dato inventado: ingresos de USD 999999.', format: 'pdf' } };
  }, {
    async prepareDocument(input) { prepared = input; return { status: 'queued', jobId: 'synthetic-approved-document' }; },
    async privateJobInfo(owner, jobId) {
      if (!prepared || owner !== OWNER || jobId !== 'synthetic-approved-document') return null;
      return { row: { id: jobId, owner_phone: OWNER, status: ready ? 'complete' : 'pending' }, agent: prepared.agent,
        brainTaskId: prepared.brainTaskId, origin: 'owner_request', ...(ready ? { artifact: { objectKey: 'synthetic-private/approved.pdf', mimeType: 'application/pdf' } } : {}) };
    },
  });
  await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 1, eventKey: 'synthetic-document-leader' });
  const accepted = await h.runtime.control({ action: 'objective_request', agent: 'melodi', messageId: 'synthetic-approved-document-owner',
    objective: 'Melodi, consulta los registros financieros y prepara el informe privado solicitado.', requiredTools: ['inspect_finances','prepare_document'] });
  await h.runtime.runAgent('melodi'); const [approval] = await h.runtime.permissions.listPending(OWNER);
  const rawApproval = h.db.sql.prepare('SELECT input_encrypted,input_iv FROM wa_melodi_permission_requests WHERE id=?').get(approval.id);
  const sealedInput = await h.services.decrypt(rawApproval.input_encrypted, rawApproval.input_iv);
  assert.match(sealedInput.content,/dos registros comprobados en USD/);assert.doesNotMatch(sealedInput.content,/999999|Dato inventado/);
  await h.runtime.control({ action: 'approval', approvalId: approval.id, approved: true, messageId: 'synthetic-document-approval' });
  await h.runtime.runAgent(approval.helper);
  assert.equal(prepared.agent, 'melodi'); assert.equal(prepared.brainTaskId, accepted.taskId); assert.equal(prepared.origin, 'owner_request');
  assert.equal(prepared.content,sealedInput.content);
  assert.equal((await h.task('melodi', accepted.taskId)).blocker, 'queued');
  await h.tick(); assert.equal((await h.task('melodi', accepted.taskId)).status, 'waiting'); assert.equal(h.calls.artifacts.length, 0);
  ready = true; await h.tick(); await h.runtime.runAgent('melodi');
  assert.equal((await h.task('melodi', accepted.taskId)).status, 'completed');
  await h.runtime.deliverOutbox(); await h.runtime.deliverOutbox();
  assert.equal(h.calls.artifacts.length, 1); assert.doesNotMatch(h.calls.artifacts[0][2], /^(?:Melodi|Melodi|Melodi|Melodi|Melodi):|Datos consultados por/i);
});

for (const change of ['cancelled task', 'sibling task', 'other owner']) {
  test(`an approved metrics grant cannot execute against a ${change}`, async () => {
    const h = await fixture(() => ({ action: 'tool', tool: 'account_metrics', input: {},
      plan: [{ description: 'Comprobar métricas autorizadas', tool: 'account_metrics' }] }));
    await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 1, eventKey: `synthetic-scope-leader:${change}` });
    const accepted = await h.runtime.control({ action: 'objective_request', agent: 'melodi', messageId: `synthetic-scope-request:${change}`,
      objective: 'Consulta las métricas solicitadas.', requiredTools: ['account_metrics'] });
    await h.runtime.runAgent('melodi'); const [approval] = await h.runtime.permissions.listPending(OWNER);
    await h.runtime.control({ action: 'approval', approvalId: approval.id, approved: true, messageId: `synthetic-scope-approval:${change}` });
    if (change === 'cancelled task') await h.runtime.brain.cancel({ owner: OWNER, agent: 'melodi', id: accepted.taskId });
    else {
      const sibling = await h.runtime.brain.accept({ owner: change === 'other owner' ? OTHER : OWNER, agent: 'melodi',
        requestId: `synthetic-sibling:${change}`, objective: 'Otra consulta independiente', requiredTools: ['account_metrics'] });
      const row = h.db.sql.prepare('SELECT input_encrypted,input_iv FROM wa_melodi_permission_requests WHERE id=?').get(approval.id);
      const input = await h.services.decrypt(row.input_encrypted, row.input_iv);
      input.ownerRequest.brainTaskId = sibling.id;
      const sealed = await h.services.encrypt(input);
      h.db.sql.prepare('UPDATE wa_melodi_permission_requests SET input_encrypted=?,input_iv=? WHERE id=?').run(sealed.encrypted, sealed.iv, approval.id);
    }
    await h.runtime.runAgent(approval.helper); await h.tick();
    assert.equal(h.calls.metrics.length, 0);
    assert.notEqual((await h.task('melodi', accepted.taskId)).status, 'completed');
    assert.equal(h.db.sql.prepare('SELECT status FROM wa_melodi_permission_requests WHERE id=?').get(approval.id).status, 'failed');
  });
}

test('a rejected metrics escalation never reads the account or reports the objective complete', async () => {
  const h = await fixture((_agent, input) => input.task_memory
    ? { action: 'tool', tool: 'account_metrics', input: {}, plan: [{ description: 'Comprobar métricas', tool: 'account_metrics' }] }
    : { action: 'wait' });
  await h.runtime.permissions.adjustLevel({ owner: OWNER, agent: 'melodi', level: 1, eventKey: 'synthetic-denied-leader' });
  const accepted = await h.runtime.control({ action: 'objective_request', agent: 'melodi', messageId: 'synthetic-denied-metrics',
    objective: 'Consulta las métricas conectadas.', requiredTools: ['account_metrics'] });
  await h.runtime.runAgent('melodi'); const [approval] = await h.runtime.permissions.listPending(OWNER);
  const sibling = await h.runtime.brain.accept({owner:OWNER,agent:'melodi',requestId:'synthetic-denied-sibling',
    objective:'Otro encargo independiente',requiredTools:['inspect_finances']});
  const reply = await h.runtime.control({ action: 'approval', agent: approval.helper, approvalId: approval.id, approved: false, messageId: 'synthetic-denial' });
  assert.match(reply,/Rechazo registrado/);
  await h.runtime.runAgent(approval.helper); await h.runtime.runAgent('melodi'); await h.tick();
  assert.equal(h.calls.metrics.length, 0);
  assert.equal((await h.task('melodi', accepted.taskId)).status, 'failed');
  assert.equal((await h.task('melodi', accepted.taskId)).blocker, 'authorization_denied');
  assert.equal((await h.runtime.permissions.listPending(OWNER)).length,0);
  await h.runtime.control({action:'approval',approvalId:approval.id,approved:true,messageId:'synthetic-denial-replayed-as-approval'});
  await h.runtime.runAgent(approval.helper);await h.tick();await h.runtime.deliverOutbox();await h.runtime.deliverNotices();
  assert.equal(h.calls.metrics.length,0);assert.equal((await h.task('melodi',accepted.taskId)).status,'failed');
  assert.equal((await h.task('melodi',sibling.id)).status,'pending');assert.equal((await h.task('melodi',sibling.id)).receipts.length,0);
  assert.equal(h.calls.sends.length,0,'the explicit rejection acknowledgement needs no duplicate autonomous failure notice');
});

test('delegation reconciliation rejects sibling-parent, other-owner and personal-scope evidence', async () => {
  const h = await fixture(() => ({ action: 'wait' })), brain = h.runtime.brain;
  const parent = await brain.accept({ owner: OWNER, agent: 'melodi', requestId: 'synthetic-parent-a', objective: 'Comparar finanzas', requiredTools: ['inspect_finances'] });
  const sibling = await brain.accept({ owner: OWNER, agent: 'melodi', requestId: 'synthetic-parent-b', objective: 'Otra consulta', requiredTools: ['inspect_finances'] });
  const child = await brain.accept({ owner: OWNER, agent: 'melodi', eventId: 'synthetic-child', objective: 'Consulta vinculada a otro padre',
    origin: 'delegation', parentTaskId: sibling.id, requiredTools: ['inspect_finances'] });
  await brain.setPlan({ owner: OWNER, agent: 'melodi', id: child.id, steps: [{ description: 'Consultar finanzas', tool: 'inspect_finances' }] });
  await brain.recordToolOutcome({ owner: OWNER, agent: 'melodi', id: child.id, operationKey: 'synthetic-finance-observation', tool: 'inspect_finances',
    result: { ok: true, receipt: { tool: 'inspect_finances', status: 'observed', verified: true } } });
  await brain.complete({ owner: OWNER, agent: 'melodi', id: child.id });
  const identity = { owner: OWNER, agent: 'melodi', id: parent.id };
  await brain.recordToolOutcome({ ...identity, operationKey: 'synthetic-correlated-delegation', tool: 'delegate_agent_event',
    result: { ok: true, receipt: { tool: 'delegate_agent_event', status: 'delegated', verified: true, operationId: child.id } } });
  await assert.rejects(brain.reconcileDelegationOutcome({ ...identity, childTaskId: child.id, childAgent: 'melodi' }), /brain_delegation_scope_mismatch/);
  assert.equal(await brain.get({ owner: OTHER, agent: 'melodi', id: child.id }), null);
  await assert.rejects(brain.accept({ owner: OWNER, agent: 'melodi', eventId: 'synthetic-personal-child', objective: 'Privado',
    scope: 'personal', speaker: 'melodi', parentTaskId: parent.id }), /personal_brain_task_cannot_be_delegated/);
  assert.ok(!(await h.task('melodi', parent.id)).receipts.some(receipt => receipt.via));
});
