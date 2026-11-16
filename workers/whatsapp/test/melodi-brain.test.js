import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { agentBrainCapabilities, agentBrainPrompt, createAgentBrain } from '../melodi-brain.js';

class D1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); }
  prepare(sql) {
    const database = this.sql;
    const wrap = values => ({ bind: (...next) => wrap(next),
      async run() { return { meta: { changes: Number(database.prepare(sql).run(...values).changes) } }; },
      async first() { return database.prepare(sql).get(...values) || null; },
      async all() { return { results: database.prepare(sql).all(...values) }; } });
    return wrap([]);
  }
}
async function fixture() {
  const db = new D1(), key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const hooks = {
    async encrypt(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
      return { encrypted: Buffer.from(bytes).toString('base64'), iv: Buffer.from(iv).toString('base64') };
    },
    async decrypt(cipher, iv) {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(cipher, 'base64')));
    },
  };
  const brain = createAgentBrain(db, { ...hooks, now: () => Date.parse('2026-10-17T13:00:00Z') });
  await brain.ensureSchema();
  const accepted = await brain.accept({ owner: 'owner-A', agent: 'melodi', eventId: 'wa-message-1', objective: 'PRIVATE_OBJECTIVE crear informe de los datos comprobados', requiredTools: ['prepare_document'] });
  const identity = { owner: 'owner-A', agent: 'melodi', id: accepted.id };
  return { brain, db, accepted, identity };
}
const receipt = (tool, status, operationId) => ({ ok: true, status, receipt: { tool, status, verified: true, ...(operationId ? { operationId } : {}) } });

test('capabilities describe installed services and validated levels, never fictional agent powers', () => {
  const missing = agentBrainCapabilities('melodi');
  assert.deepEqual(missing.connected, []);
  assert.deepEqual(missing.executable, []);
  const live = agentBrainCapabilities('melodi', { permissionLevel: 10, inspectWorkspace() {} });
  assert.deepEqual(live.connected, ['inspect_workspace']);
  assert.deepEqual(live.executable, ['inspect_workspace']);
  assert.equal(agentBrainCapabilities('melodi').available, false, 'the excluded Desktop runtime must not be advertised as a connected WhatsApp power');
  assert.match(agentBrainPrompt('melodi'), /Melodi coordina/);
  assert.match(agentBrainPrompt('melodi'), /Cola, delegación o extracción pendiente/);
});

test('objective, plan and memory persist encrypted, idempotently and scoped to owner and executor', async () => {
  const { brain, db, accepted, identity } = await fixture();
  const duplicate = await brain.accept({ owner: 'owner-A', agent: 'melodi', requestId: 'wa-message-1', objective: 'Must not replace the authorized original' });
  assert.equal(duplicate.id, accepted.id);
  assert.equal(duplicate.objective, accepted.objective);
  assert.equal(accepted.speaker, 'melodi');
  assert.equal(accepted.coordinator, 'melodi');
  await brain.setPlan({ ...identity, steps: [{ description: 'PRIVATE_PLAN consultar datos', tool: 'inspect_workspace' }, { description: 'Redactar informe', tool: 'prepare_document' }] });
  await brain.remember({ ...identity, fact: 'PRIVATE_MEMORY el propietario pidió un informe', source: { kind: 'owner', id: 'wa-message-1' } });
  const raw = db.sql.prepare('SELECT * FROM wa_melodi_brain_tasks').get();
  assert.doesNotMatch(JSON.stringify(raw), /PRIVATE_OBJECTIVE|PRIVATE_PLAN|PRIVATE_MEMORY|informe/);
  assert.equal((await brain.get(identity)).memory[0].fact, 'PRIVATE_MEMORY el propietario pidió un informe');
  assert.equal(await brain.get({ ...identity, owner: 'owner-B' }), null);
  assert.equal(await brain.get({ ...identity, agent: 'melodi' }), null);
  assert.deepEqual(await brain.list({ owner: 'owner-B', agent: 'melodi' }), []);
});

test('execution uses actual receipts, queued work waits and an original stored artifact is needed to finish', async () => {
  const { brain, identity } = await fixture();
  await brain.setPlan({ ...identity, steps: [{ description: 'Consultar datos', tool: 'inspect_workspace' }, { description: 'Preparar documento', tool: 'prepare_document' }] });
  await brain.start(identity);
  await brain.recordToolOutcome({ ...identity, operationKey: 'event:read', tool: 'inspect_workspace', result: receipt('inspect_workspace', 'observed') });
  await assert.rejects(brain.complete(identity), /not_verified/);
  const waiting = await brain.recordToolOutcome({ ...identity, operationKey: 'event:document', tool: 'prepare_document', result: receipt('prepare_document', 'queued', 'private-job-A') });
  assert.equal(waiting.status, 'waiting');
  await assert.rejects(brain.complete(identity), /not_verified/);
  assert.equal((await brain.reconcileJobOutcome({ ...identity, jobId: 'private-job-A', result: { status: 'complete', verified: true } })).status, 'waiting');
  await assert.rejects(brain.reconcileJobOutcome({ ...identity, jobId: 'other-owner-job', result: { status: 'complete', verified: true, artifact: { objectKey: 'other-owner/file', mimeType: 'application/pdf' } } }), /not_correlated/);
  await brain.reconcileJobOutcome({ ...identity, jobId: 'private-job-A', result: { status: 'complete', verified: true, artifact: { objectKey: 'owner-A/file', mimeType: 'application/pdf' } } });
  assert.equal((await brain.complete(identity)).status, 'completed');
  assert.equal((await brain.complete(identity)).status, 'completed', 'a repeated completion is idempotent');
});

test('unverified tool results and missing required tool evidence cannot produce completion', async () => {
  const { brain, identity } = await fixture();
  await brain.start(identity);
  await assert.rejects(brain.recordToolOutcome({ ...identity, operationKey: 'model-claim', tool: 'prepare_document', result: { summary: 'Ya está listo' } }), /runtime_receipt/);
  await brain.recordToolOutcome({ ...identity, operationKey: 'read', tool: 'inspect_workspace', result: receipt('inspect_workspace', 'observed') });
  await assert.rejects(brain.complete(identity), /not_verified/);
  const failed = await brain.recordToolOutcome({ ...identity, operationKey: 'broken', tool: 'prepare_document', result: { ok: false, receipt: { tool: 'prepare_document', verified: false, status: 'failed' } } });
  assert.equal(failed.status, 'failed');
  await assert.rejects(brain.complete(identity), /terminal/);
});

test('memory cites real tool evidence and a completed operation cannot be replaced by a different job', async () => {
  const { brain, identity } = await fixture();
  await assert.rejects(brain.remember({ ...identity, fact: 'Invented metric', source: { kind: 'tool', id: 'invented-operation' } }), /evidence_missing/);
  await brain.recordToolOutcome({ ...identity, operationKey: 'observed-data', tool: 'inspect_workspace', result: receipt('inspect_workspace', 'observed') });
  await brain.remember({ ...identity, fact: 'El calendario devolvió los eventos consultados', source: { kind: 'tool', id: 'observed-data' } });
  await brain.recordToolOutcome({ ...identity, operationKey: 'document', tool: 'prepare_document', result: receipt('prepare_document', 'queued', 'job-A') });
  await assert.rejects(brain.recordToolOutcome({ ...identity, operationKey: 'document', tool: 'prepare_document', result: receipt('prepare_document', 'prepared', 'job-B') }), /operation_mismatch/);
});

test('plans cannot grant unknown tools or self-report completion and personal tasks do not gain delegation', async () => {
  const { brain, identity } = await fixture();
  await assert.rejects(brain.setPlan({ ...identity, steps: [{ description: 'Run code', tool: 'arbitrary_shell', status: 'completed' }] }), /invalid_brain_tool/);
  const planned = await brain.setPlan({ ...identity, steps: [{ description: 'Consultar', tool: 'inspect_workspace', status: 'completed' }] });
  assert.equal(planned.steps[0].status, 'pending');
  await assert.rejects(brain.accept({ owner: 'owner-A', agent: 'melodi', eventId: 'personal', objective: 'Objetivo privado', scope: 'personal', speaker: 'melodi' }), /cannot_be_delegated/);
  const personal = await brain.accept({ owner: 'owner-A', agent: 'melodi', eventId: 'personal', objective: 'Objetivo privado', scope: 'personal', speaker: 'melodi' });
  assert.equal(personal.coordinator, 'melodi');
  assert.equal((await brain.cancel({ owner: 'owner-A', agent: 'melodi', id: personal.id })).status, 'cancelled');
});

test('Melodi completes delegated work only after the correlated specialist task has verified evidence', async () => {
  const { brain } = await fixture();
  const parent = await brain.accept({ owner: 'owner-A', agent: 'melodi', eventId: 'owner-objective-2', objective: 'Coordinar investigación', requiredTools: ['inspect_workspace'] });
  const parentId = { owner: 'owner-A', agent: 'melodi', id: parent.id };
  await brain.setPlan({ ...parentId, steps: [{ description: 'Consultar la fuente', tool: 'inspect_workspace' }, { description: 'Delegar la consulta', tool: 'delegate_agent_event' }] });
  const child = await brain.accept({ owner: 'owner-A', agent: 'melodi', eventId: 'delegate:owner-objective-2:melodi', objective: 'Consultar el encargo comprobado',
    origin: 'delegation', parentTaskId: parent.id, speaker: parent.speaker, requiredTools: ['inspect_workspace'] });
  const childId = { owner: 'owner-A', agent: 'melodi', id: child.id };
  assert.equal((await brain.findByEvent({ owner: 'owner-A', agent: 'melodi', eventId: child.eventId })).id, child.id);
  assert.equal(child.speaker, 'melodi');
  await brain.recordToolOutcome({ ...parentId, operationKey: 'delegate-step', tool: 'delegate_agent_event', result: receipt('delegate_agent_event', 'delegated', child.id) });
  assert.equal((await brain.reconcileDelegationOutcome({ ...parentId, childTaskId: child.id, childAgent: 'melodi' })).status, 'waiting');
  await assert.rejects(brain.reconcileDelegationOutcome({ ...parentId, childTaskId: child.id, childAgent: 'melodi' }), /scope_mismatch/);
  await brain.recordToolOutcome({ ...childId, operationKey: 'child-read', tool: 'inspect_workspace', result: receipt('inspect_workspace', 'observed') });
  await brain.remember({ ...childId, fact: 'Datos comprobados que necesita Melodi para responder', source: { kind: 'tool', id: 'child-read' } });
  await brain.remember({ ...childId, fact: 'Private unrelated owner statement', source: { kind: 'owner', id: 'private-message' } });
  await brain.complete(childId);
  const resumed = await brain.reconcileDelegationOutcome({ ...parentId, childTaskId: child.id, childAgent: 'melodi' });
  assert.ok(resumed.receipts.some(item => item.tool === 'inspect_workspace' && item.via?.taskId === child.id));
  assert.equal(resumed.memory[0].fact, 'Datos comprobados que necesita Melodi para responder');
  assert.equal(resumed.memory[0].via.taskId, child.id);
  assert.equal(resumed.memory.some(item => /unrelated/.test(item.fact)), false, 'a specialist cannot transfer private owner memories as shared findings');
  const repeated = await brain.reconcileDelegationOutcome({ ...parentId, childTaskId: child.id, childAgent: 'melodi' });
  assert.equal(repeated.revision, resumed.revision, 'reconciliation is idempotent and atomic');
  assert.equal((await brain.complete(parentId)).status, 'completed');
});
