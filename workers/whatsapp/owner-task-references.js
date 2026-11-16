const PREFIXES = Object.freeze({ approval: 'C', job: 'T', routine: 'R' });
const AGENTS = ['melodi'];

export const TASK_REFERENCE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_owner_task_reference_counters (
    owner TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('approval','job','routine')),next_value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(owner,type))`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_task_references (
    owner TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('approval','job','routine')),task_id TEXT NOT NULL,
    short_ref TEXT NOT NULL,ordinal INTEGER NOT NULL,agent TEXT,status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(owner,type,task_id),UNIQUE(owner,short_ref),UNIQUE(owner,type,ordinal))`,
  `CREATE INDEX IF NOT EXISTS wa_owner_task_reference_recent ON wa_melodi_task_references(owner,type,agent,updated_at)`,
]);

function scope(owner, type, agent) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('invalid_reference_owner');
  if (type !== undefined && !Object.hasOwn(PREFIXES, type)) throw new TypeError('invalid_reference_type');
  if (agent != null && !AGENTS.includes(agent)) throw new TypeError('invalid_reference_agent');
}

function instant(value) {
  const at = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(at) || at < 0) throw new TypeError('invalid_reference_clock');
  return Math.trunc(at);
}

function taskId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(id)) throw new TypeError('invalid_reference_task');
}

function statusCode(status) {
  if (typeof status !== 'string' || !/^[a-z_]{1,32}$/.test(status)) throw new TypeError('invalid_reference_status');
  return status;
}

function expose(row) {
  return row ? { id: row.task_id, shortRef: row.short_ref, type: row.type, agent: row.agent,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

function answer(rows) {
  if (!rows.length) return { status: 'missing', candidates: [] };
  const candidates = rows.map(expose);
  if (candidates.length !== 1) return { status: 'ambiguous', candidates };
  return { ...candidates[0], taskStatus: candidates[0].status, status: 'resolved', candidates };
}

/** References contain no message, task title, document content or private goal. */
export function createTaskReferences(db, { now = () => Date.now() } = {}) {
  if (!db?.prepare || !db?.batch) throw new TypeError('task_references_require_d1');
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const rows = result => result?.results || [];
  const clock = () => instant(now());

  async function ensureSchema() {
    await db.batch(TASK_REFERENCE_SCHEMA.map(sql => db.prepare(sql)));
  }

  async function register({ owner, type, id, agent = null, status = 'active' }) {
    scope(owner, type, agent); taskId(id); statusCode(status);
    if (type === undefined) throw new TypeError('invalid_reference_type');
    const at = clock();
    await db.batch([
      statement('INSERT OR IGNORE INTO wa_owner_task_reference_counters(owner,type) VALUES(?,?)', owner, type),
      statement(`UPDATE wa_owner_task_reference_counters SET next_value=next_value+1 WHERE owner=? AND type=?
        AND NOT EXISTS (SELECT 1 FROM wa_melodi_task_references WHERE owner=? AND type=? AND task_id=?)`, owner, type, owner, type, id),
      statement(`INSERT OR IGNORE INTO wa_melodi_task_references(owner,type,task_id,short_ref,ordinal,agent,status,created_at,updated_at)
        SELECT ?,?,?,?||next_value,next_value,?,?,?,? FROM wa_owner_task_reference_counters WHERE owner=? AND type=?`,
      owner, type, id, PREFIXES[type], agent, status, at, at, owner, type),
    ]);
    const existing = await statement('SELECT * FROM wa_melodi_task_references WHERE owner=? AND type=? AND task_id=?', owner, type, id).first();
    if (existing.agent != null && agent != null && existing.agent !== agent) throw new Error('reference_assignment_conflict');
    // Legacy full-ID registrations may be populated with the original assignment later.
    if (existing.agent == null && agent != null) await statement(`UPDATE wa_melodi_task_references SET agent=?,updated_at=?
      WHERE owner=? AND type=? AND task_id=? AND agent IS NULL`, agent, at, owner, type, id).run();
    const saved = await statement('SELECT * FROM wa_melodi_task_references WHERE owner=? AND type=? AND task_id=?', owner, type, id).first();
    if (agent != null && saved.agent !== agent) throw new Error('reference_assignment_conflict');
    return expose(saved);
  }

  async function list({ owner, type, agent, statuses, limit = 20 }) {
    scope(owner, type, agent);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('invalid_reference_limit');
    if (statuses !== undefined && (!Array.isArray(statuses) || !statuses.length || statuses.length > 20)) throw new TypeError('invalid_reference_statuses');
    const allowed = statuses?.map(statusCode);
    const statusFilter = allowed ? `AND status IN (${allowed.map(() => '?').join(',')})` : '';
    return rows(await statement(`SELECT * FROM wa_melodi_task_references WHERE owner=? AND (? IS NULL OR type=?)
      AND (? IS NULL OR agent=?) ${statusFilter} ORDER BY updated_at DESC,ordinal DESC LIMIT ?`,
    owner, type ?? null, type ?? null, agent ?? null, agent ?? null, ...(allowed || []), limit).all()).map(expose);
  }

  async function latest({ owner, type, agent, statuses, recentIds } = {}) {
    scope(owner, type, agent);
    const found = await list({ owner, type, agent, statuses, limit: 100 });
    if (recentIds !== undefined) {
      if (!Array.isArray(recentIds)) throw new TypeError('invalid_reference_context');
      for (const id of recentIds) {
        const candidate = found.find(item => item.id === id);
        if (candidate) return { ...candidate, taskStatus: candidate.status, status: 'resolved', candidates: [candidate] };
      }
    }
    if (!found.length) return { status: 'missing', candidates: [] };
    const candidate = found[0];
    return { ...candidate, taskStatus: candidate.status, status: 'resolved', candidates: [candidate] };
  }

  async function legacy(owner, type, id, agent) {
    const source = type === 'approval' ? { table: 'wa_melodi_permission_requests', owner: 'owner_phone', agent: 'requester' }
      : type === 'routine' ? { table: 'wa_melodi_routines', owner: 'owner', agent: 'agent' }
        : { table: 'wa_owner_jobs', owner: 'owner_phone', agent: null };
    // A UUID is never authority: prove ownership against the original record.
    const exists = await statement("SELECT name FROM sqlite_master WHERE type='table' AND name=?", source.table).first();
    if (!exists) return null;
    const row = await statement(`SELECT id,status,${source.agent || 'NULL'} AS assigned_agent FROM ${source.table} WHERE id=? AND ${source.owner}=?`, id, owner).first();
    if (!row || (agent && row.assigned_agent && agent !== row.assigned_agent)) return null;
    // Legacy jobs contain encrypted assignment; a caller can fill it using register().
    if (agent && !row.assigned_agent) return null;
    const saved = await register({ owner, type, id, agent: row.assigned_agent || null, status: /^[a-z_]{1,32}$/.test(row.status) ? row.status : 'active' });
    return { task_id: saved.id, short_ref: saved.shortRef, type, agent: saved.agent, status: saved.status, created_at: saved.createdAt, updated_at: saved.updatedAt };
  }

  async function resolve({ owner, type, reference, agent, recentIds, statuses, latest: preferLatest = false }) {
    scope(owner, type, agent);
    if (type === undefined) throw new TypeError('invalid_reference_type');
    if (reference == null || String(reference).trim() === '') {
      if (preferLatest || recentIds?.length) return latest({ owner, type, agent, statuses, recentIds });
      const listed = await list({ owner, type, agent, statuses, limit: 100 });
      return answer(listed.map(item => ({ task_id: item.id, short_ref: item.shortRef, type: item.type, agent: item.agent, status: item.status, created_at: item.createdAt, updated_at: item.updatedAt })));
    }
    if (typeof reference !== 'string' || reference.length > 1000) throw new TypeError('invalid_reference_text');
    const opaqueMatches = Array.from(reference.matchAll(/\b(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|auto-[A-Za-z0-9]{8,80})\b/gi));
    // Hexadecimal UUID segments such as "c123" are not short references.
    const shortTokens = Array.from(reference.toUpperCase().matchAll(/\b([CTR])\s*(\d{1,12})\b/g))
      .filter(match => !opaqueMatches.some(opaque => match.index >= opaque.index && match.index < opaque.index + opaque[0].length))
      .map(match => `${match[1]}${Number(match[2])}`);
    const shortRefs = Array.from(new Set(shortTokens));
    const matches = [];
    if (shortRefs.length) {
      matches.push(...rows(await statement(`SELECT * FROM wa_melodi_task_references WHERE owner=? AND type=?
        AND (? IS NULL OR agent=?) AND short_ref IN (${shortRefs.map(() => '?').join(',')})`, owner, type, agent ?? null, agent ?? null, ...shortRefs).all()));
    }
    const opaqueTokens = opaqueMatches.map(match => match[0]);
    const direct = !shortRefs.length && /^[A-Za-z0-9:_-]{1,180}$/.test(reference.trim()) ? [reference.trim()] : [];
    const ids = Array.from(new Set([...opaqueTokens, ...direct]));
    for (const id of ids) {
      const row = await statement('SELECT * FROM wa_melodi_task_references WHERE owner=? AND type=? AND task_id=? AND (? IS NULL OR agent=?)', owner, type, id, agent ?? null, agent ?? null).first();
      const candidate = row || await legacy(owner, type, id, agent);
      if (candidate && !matches.some(match => match.task_id === candidate.task_id)) matches.push(candidate);
    }
    return answer(matches);
  }

  async function setStatus({ owner, type, id, status }) {
    scope(owner, type); taskId(id); statusCode(status);
    if (type === undefined) throw new TypeError('invalid_reference_type');
    const result = await statement('UPDATE wa_melodi_task_references SET status=?,updated_at=? WHERE owner=? AND type=? AND task_id=?', status, clock(), owner, type, id).run();
    return Boolean(result.meta?.changes);
  }

  return Object.freeze({ ensureSchema, register, resolve, list, latest, setStatus });
}
