import { AUTONOMY_PROFILES, autonomyToolCatalog } from './melodi-autonomy-tools.js';

const AGENTS = Object.freeze(Object.keys(AUTONOMY_PROFILES));
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const DONE_RECEIPTS = new Set(['observed', 'prepared', 'completed', 'sent']);
const WAIT_RECEIPTS = new Set(['queued', 'pending', 'delegated', 'unavailable', 'blocked']);
export const AGENT_BRAIN_SCHEMA = `CREATE TABLE IF NOT EXISTS wa_melodi_brain_tasks (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL, event_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','waiting','completed','failed','cancelled')),
  revision INTEGER NOT NULL DEFAULT 0, payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(owner,agent,event_key))`;

const text = (value, limit, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /\u0000/.test(value)) throw new TypeError(`invalid_brain_${label}`);
  return value.trim();
};
function scope(owner, agent) {
  text(owner, 160, 'owner');
  if (!AGENTS.includes(agent)) throw new TypeError('invalid_brain_agent');
}
async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}

// The registry describes installed functions, not aspirational product roles.
// Permission grants remain the responsibility of the existing runtime.
export function agentBrainCapabilities(agent, services = {}) {
  const tools = autonomyToolCatalog(agent, services);
  return { agent, available: AGENTS.includes(agent), tools,
    connected: tools.filter(tool => tool.status === 'available').map(tool => tool.name),
    executable: tools.filter(tool => tool.status === 'available' && tool.permitted === true).map(tool => tool.name) };
}

export function agentBrainPrompt(agent, services = {}) {
  const capabilities = agentBrainCapabilities(agent, services);
  const installed = { agent, available: capabilities.available,
    tools: capabilities.tools.map(({ name, status, permitted, effect }) => ({ name, status, permitted, effect })) };
  return `CONTRATO DE TRABAJO VERIFICABLE:\nMantén un objetivo vigente, un plan breve de pasos concretos y evidencia de herramientas para cada resultado. Usa la memoria de esta tarea y las preferencias del propietario, no conviertas contexto antiguo en nuevos encargos. La agenda y los próximos pasos de un proyecto son registros de tareas, no prueba de capacidades de un producto. Conserva las fuentes de cada recuerdo; una afirmación del propietario no es una medición de herramienta. Las herramientas conectadas se enumeran abajo; la conexión no concede permisos y el sistema autoriza cada ejecución. Cola, delegación o extracción pendiente significan esperar, nunca completar. Una negativa o una explicación de falta de acceso no es el archivo solicitado. Si falta una fuente, una herramienta o una autorización, registra el bloqueo sin inventar contenido. Melodi coordina y comunica los resultados salvo que el propietario haya elegido expresamente otra interlocutora; las colaboraciones devuelven evidencia al encargo original y no abren conversaciones independientes. No afirmes consciencia, aprendizaje permanente ni acciones fuera de herramientas reales.\nCAPACIDADES INSTALADAS:\n${JSON.stringify(installed)}`;
}

/** Durable task memory and execution receipts. No tool or permission bypass. */
export function createAgentBrain(db, { encrypt, decrypt, now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  if (!db?.prepare || typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new TypeError('brain_requires_encrypted_storage');
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const seal = async payload => {
    const encoded = JSON.stringify(payload);
    if (encoded.length > 100_000) throw new RangeError('brain_payload_too_large');
    const encrypted = await encrypt(encoded);
    if (!encrypted?.encrypted || !encrypted?.iv) throw new Error('brain_encryption_failed');
    return encrypted;
  };
  const decode = async row => {
    if (!row) return null;
    const plain = await decrypt(row.payload_encrypted, row.payload_iv);
    const payload = typeof plain === 'string' ? JSON.parse(plain) : plain;
    return { ...payload, id: row.id, owner: row.owner, agent: row.agent, status: row.status,
      revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
  };
  async function ensureSchema() { await db.prepare(AGENT_BRAIN_SCHEMA).run(); }
  async function get({ owner, agent, id }) {
    scope(owner, agent); text(id, 180, 'id');
    return decode(await statement('SELECT * FROM wa_melodi_brain_tasks WHERE owner=? AND agent=? AND id=?', owner, agent, id).first());
  }
  async function findByEvent({ owner, agent, eventId }) {
    scope(owner, agent); text(eventId, 200, 'event');
    const key = await digest(`${owner}\n${agent}\n${eventId}`);
    return decode(await statement('SELECT * FROM wa_melodi_brain_tasks WHERE owner=? AND agent=? AND event_key=?', owner, agent, key).first());
  }
  async function list({ owner, agent, limit = 10 }) {
    scope(owner, agent);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError('invalid_brain_limit');
    const rows = await statement('SELECT * FROM wa_melodi_brain_tasks WHERE owner=? AND agent=? ORDER BY updated_at DESC,id LIMIT ?', owner, agent, limit).all();
    return Promise.all((rows.results || []).map(decode));
  }
  async function accept({ owner, agent, eventId, requestId, objective, origin = 'owner_request', speaker = 'melodi',
    scope: taskScope = 'team', parentTaskId = null, requiredTools = [], requiredAgents=[] }) {
    scope(owner, agent);
    const event = text(eventId || requestId, 200, 'event');
    text(objective, 4000, 'objective');
    if (!['owner_request', 'routine', 'delegation', 'goal'].includes(origin) || !AGENTS.includes(speaker)
      || !['team', 'personal'].includes(taskScope)) throw new TypeError('invalid_brain_origin');
    if (taskScope === 'personal' && (parentTaskId || speaker !== agent)) throw new TypeError('personal_brain_task_cannot_be_delegated');
    if (parentTaskId) text(parentTaskId, 180, 'parent');
    const names = autonomyToolCatalog(agent).map(tool => tool.name);
    if (!Array.isArray(requiredTools) || requiredTools.length > 12 || requiredTools.some(tool => !names.includes(tool))) throw new TypeError('invalid_brain_required_tool');
    if(!Array.isArray(requiredAgents)||requiredAgents.length>3||requiredAgents.some(target=>!AGENTS.includes(target)||target===agent))throw new TypeError('invalid_brain_required_agent');
    const key = await digest(`${owner}\n${agent}\n${event}`);
    const existing = await statement('SELECT * FROM wa_melodi_brain_tasks WHERE owner=? AND agent=? AND event_key=?', owner, agent, key).first();
    if (existing) return decode(existing);
    const payload = { objective, origin, eventId: event, speaker, coordinator: taskScope === 'personal' ? agent : 'melodi',
      scope: taskScope, parentTaskId, requiredTools: [...new Set(requiredTools)],requiredAgents:[...new Set(requiredAgents)], steps: [], receipts: [], memory: [], blocker: null };
    const sealed = await seal(payload), at = now(), id = uuid();
    await statement(`INSERT OR IGNORE INTO wa_melodi_brain_tasks
      (id,owner,agent,event_key,status,revision,payload_encrypted,payload_iv,created_at,updated_at)
      VALUES(?,?,?,?,'pending',0,?,?,?,?)`, id, owner, agent, key, sealed.encrypted, sealed.iv, at, at).run();
    return decode(await statement('SELECT * FROM wa_melodi_brain_tasks WHERE owner=? AND agent=? AND event_key=?', owner, agent, key).first());
  }
  async function change(identity, mutate) {
    const task = await get(identity);
    if (!task) throw new Error('brain_task_not_found');
    const payload = await mutate(task);
    if (!payload) return task;
    const { id, owner, agent, status, revision, createdAt, updatedAt, ...privateState } = payload;
    const sealed = await seal(privateState);
    const update = await statement(`UPDATE wa_melodi_brain_tasks SET status=?,revision=revision+1,payload_encrypted=?,payload_iv=?,updated_at=?
      WHERE owner=? AND agent=? AND id=? AND revision=?`, status, sealed.encrypted, sealed.iv, now(), owner, agent, id, revision).run();
    if (!update.meta?.changes) throw new Error('brain_revision_conflict');
    return { ...privateState, id, owner, agent, status, revision: revision + 1, createdAt, updatedAt: now() };
  }
  function active(task) { if (TERMINAL.has(task.status)) throw new Error('brain_task_terminal'); }
  async function setPlan({ steps, ...identity }) {
    return change(identity, task => {
      active(task);
      if (task.steps.some(step => step.status !== 'pending')) throw new Error('brain_plan_already_executing');
      const catalog = autonomyToolCatalog(task.agent).map(tool => tool.name);
      if (!Array.isArray(steps) || !steps.length || steps.length > 12) throw new TypeError('invalid_brain_plan');
      task.steps = steps.map((step, index) => {
        text(step.description, 800, 'step');
        if (step.tool && !catalog.includes(step.tool)) throw new TypeError('invalid_brain_tool');
        return { id: `step-${index + 1}`, description: step.description, tool: step.tool || null, status: 'pending' };
      });
      for(const tool of task.requiredTools) if(!task.steps.some(step=>step.tool===tool)) task.steps.push({id:`step-${task.steps.length+1}`,description:`Comprobar el resultado requerido: ${tool}`,tool,status:'pending'});
      const count=task.steps.filter(step=>step.tool==='delegate_agent_event').length;
      for(let i=count;i<(task.requiredAgents || []).length;i++)task.steps.push({id:`step-${task.steps.length+1}`,description:`Recibir el trabajo comprobado de ${task.requiredAgents[i]}`,tool:'delegate_agent_event',status:'pending'});
      if(task.steps.length>12)throw new Error('brain_execution_budget_exceeded');
      return task;
    });
  }
  async function start(identity) {
    return change(identity, task => { active(task); if (task.status === 'running') return null;
      task.status = 'running'; task.blocker = null;task.turns=(task.turns||0)+1; return task; });
  }
  async function remember({ fact, source, ...identity }) {
    text(fact, 2000, 'memory');
    if (!source || !['owner', 'tool'].includes(source.kind)) throw new TypeError('invalid_brain_memory_source');
    text(source.id, 200, 'memory_source');
    return change(identity, task => { active(task);
      if (source.kind === 'tool' && !task.receipts.some(receipt => receipt.verified
        && (receipt.key === source.id || receipt.operationId === source.id))) throw new Error('brain_memory_evidence_missing');
      if (task.memory.some(item => item.fact === fact && item.source.kind === source.kind && item.source.id === source.id)) return null;
      const entry = { fact, source: { kind: source.kind, id: source.id }, scope: task.scope, observedAt: now() };
      task.memory = [...task.memory, entry].slice(-20); return task; });
  }
  async function recordToolOutcome({ operationKey, tool, result, stepId, ...identity }) {
    text(operationKey, 240, 'operation');
    return change(identity, task => {
      active(task);
      if (!autonomyToolCatalog(task.agent).some(entry => entry.name === tool)) throw new TypeError('invalid_brain_tool');
      const receipt = result?.receipt;
      if (receipt?.tool !== tool || typeof receipt.verified !== 'boolean' || typeof receipt.status !== 'string') throw new TypeError('brain_requires_runtime_receipt');
      const previous = task.receipts.find(item => item.key === operationKey);
      if (previous && previous.tool !== tool) throw new Error('brain_operation_mismatch');
      if (previous?.operationId && receipt.operationId && previous.operationId !== receipt.operationId) throw new Error('brain_operation_mismatch');
      if (previous?.verified && DONE_RECEIPTS.has(previous.status)) return null;
      const entry = { key: operationKey, tool, status: receipt.status, verified: receipt.verified,
        ...(typeof receipt.operationId === 'string' ? { operationId: receipt.operationId.slice(0, 200) } : {}) };
      let step = stepId ? task.steps.find(item => item.id === stepId) : task.steps.find(item => item.tool === tool && item.status !== 'completed');
      if (stepId && (!step || step.tool && step.tool !== tool)) throw new Error('brain_step_mismatch');
      if (!step) { step = { id: `step-${task.steps.length + 1}`, description: tool, tool, status: 'pending' }; task.steps.push(step); }
      if (task.steps.length > 12 || task.receipts.length > 48) throw new Error('brain_execution_budget_exceeded');
      if (previous) task.receipts[task.receipts.indexOf(previous)] = entry; else task.receipts.push(entry);
      step.tool = tool;
      if (result.ok === true && receipt.verified && DONE_RECEIPTS.has(receipt.status)) {
        step.status = 'completed'; step.evidence = operationKey; task.status = 'running'; task.blocker = null;
      } else if (WAIT_RECEIPTS.has(receipt.status)) {
        step.status = 'waiting'; task.status = 'waiting'; task.blocker = receipt.status;
      } else {
        step.status = 'failed'; task.status = 'failed'; task.blocker = 'tool_execution_failed';
      }
      return task;
    });
  }
  // The artifact tracker calls this only after checking the private job and
  // stored artifact. A job row marked complete alone does not prove a file.
  async function reconcileJobOutcome({ jobId, result, ...identity }) {
    text(jobId, 200, 'job');
    const task = await get(identity);
    if (!task) throw new Error('brain_task_not_found');
    if (TERMINAL.has(task.status)) return task;
    const queued = task.receipts.find(receipt => receipt.operationId === jobId && WAIT_RECEIPTS.has(receipt.status));
    if (!queued) throw new Error('brain_job_not_correlated');
    if (result?.status === 'failed' || result?.status === 'cancelled') {
      return result.status === 'cancelled' ? cancel(identity) : fail({ ...identity, reason: 'artifact_job_failed' });
    }
    if (result?.verified !== true || !['complete', 'completed', 'prepared'].includes(result.status)
      || typeof result.artifact?.objectKey !== 'string' || !result.artifact.objectKey
      || typeof result.artifact?.mimeType !== 'string' || !result.artifact.mimeType) {
      return task;
    }
    return recordToolOutcome({ ...identity, operationKey: queued.key, tool: queued.tool,
      result: { ok: true, receipt: { tool: queued.tool, operationId: jobId, status: 'prepared', verified: true } } });
  }
  async function reconcileDelegationOutcome({ childTaskId, childAgent, ...identity }) {
    const parent = await get(identity);
    if (!parent) throw new Error('brain_task_not_found');
    if (TERMINAL.has(parent.status)) return parent;
    const queued = parent.receipts.find(receipt => receipt.tool === 'delegate_agent_event'
      && ['delegated', 'completed'].includes(receipt.status) && receipt.operationId === childTaskId);
    if (!queued) throw new Error('brain_delegation_not_correlated');
    const child = await get({ owner: identity.owner, agent: childAgent, id: childTaskId });
    if (!child || child.scope !== 'team' || child.parentTaskId !== parent.id) throw new Error('brain_delegation_scope_mismatch');
    if (child.status === 'failed' || child.status === 'cancelled') {
      return child.status === 'cancelled' ? cancel(identity) : fail({ ...identity, reason: 'delegated_task_failed' });
    }
    if (child.status !== 'completed') return parent;
    // Preserve the specialist's verified work as evidence for the parent's
    // acceptance criteria. A delegation receipt alone never proves research
    // or artifact creation. The child row above supplies owner and ancestry.
    return change(identity, task => {
      active(task);
      const delegation = task.receipts.find(receipt => receipt.key === queued.key && receipt.operationId === child.id);
      if (!delegation) throw new Error('brain_delegation_not_correlated');
      let changed = delegation.status !== 'completed';
      delegation.status = 'completed'; delegation.verified = true;delegation.targetAgent=child.agent;
      const delegatedStep = task.steps.find(step => step.tool === 'delegate_agent_event' && step.status !== 'completed');
      if (delegatedStep) { delegatedStep.status = 'completed'; delegatedStep.evidence = queued.key; changed = true; }
      for (const receipt of child.receipts.filter(item => item.verified && DONE_RECEIPTS.has(item.status))) {
        const key = `child:${child.id}:${receipt.key}`;
        if (task.receipts.some(item => item.key === key)) continue;
        if (task.receipts.length >= 48) throw new Error('brain_execution_budget_exceeded');
        task.receipts.push({ ...receipt, key, via: { taskId: child.id, agent: child.agent } });
        changed = true;
        const step = task.steps.find(item => item.tool === receipt.tool && item.status !== 'completed');
        if (step) { step.status = 'completed'; step.evidence = key; }
      }
      for (const memory of child.memory.filter(item => item.source?.kind === 'tool')) {
        const evidence = child.receipts.find(receipt => receipt.verified && DONE_RECEIPTS.has(receipt.status)
          && (receipt.key === memory.source.id || receipt.operationId === memory.source.id));
        if (!evidence) continue;
        const sourceId = `child:${child.id}:${evidence.key}`;
        if (task.memory.some(item => item.fact === memory.fact && item.source?.id === sourceId)) continue;
        task.memory = [...task.memory, { fact: memory.fact, source: { kind: 'tool', id: sourceId }, scope: task.scope,
          observedAt: memory.observedAt, via: { taskId: child.id, agent: child.agent } }].slice(-20);
        changed = true;
      }
      if (!changed) return null;
      task.status = 'running'; task.blocker = null; return task;
    });
  }
  async function wait({ reason = 'awaiting_result', ...identity }) {
    text(reason, 160, 'blocker');
    return change(identity, task => { active(task); task.status = 'waiting'; task.blocker = reason; return task; });
  }
  async function fail({ reason = 'execution_failed', ...identity }) {
    text(reason, 160, 'failure');
    return change(identity, task => { if (task.status === 'failed') return null; active(task);
      task.status = 'failed'; task.blocker = reason; return task; });
  }
  async function cancel(identity) {
    return change(identity, task => { if (task.status === 'cancelled') return null; active(task);
      task.status = 'cancelled'; task.blocker = null; return task; });
  }
  async function complete(identity) {
    return change(identity, task => {
      if (task.status === 'completed') return null;
      active(task);
      if (!task.steps.length || task.steps.some(step => step.status !== 'completed')
        || task.requiredTools.some(tool => !task.receipts.some(receipt => receipt.tool === tool && receipt.verified && DONE_RECEIPTS.has(receipt.status)))
        || (task.requiredAgents || []).some(target=>!task.receipts.some(receipt=>receipt.tool==='delegate_agent_event'&&receipt.targetAgent===target&&receipt.verified&&receipt.status==='completed'))) {
        throw new Error('brain_objective_not_verified');
      }
      task.status = 'completed'; task.blocker = null; return task;
    });
  }
  return { ensureSchema, accept, get, findByEvent, list, setPlan, start, remember, recordToolOutcome, reconcileJobOutcome, reconcileDelegationOutcome, wait, fail, cancel, complete };
}
