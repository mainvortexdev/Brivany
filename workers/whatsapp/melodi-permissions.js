// Tool authority is deterministic application policy. Model output can request
// work, but can never award XP, change levels or approve its own escalation.
export const PERMISSION_AGENTS = Object.freeze(['melodi']);
export const INITIAL_AGENT_LEVELS = Object.freeze({ melodi: 3 });
export const MAX_AGENT_LEVEL = 10;
export const PRAISE_XP = 3;
export const SELECTION_XP = 1;

const MINIMUM_LEVELS = Object.freeze({
  inspect_finances: 0,
  inspect_workspace: 1, research_public_marketing: 1, research_public_web: 1, inspect_public_media: 1,
  account_metrics: 2, prepare_document: 2, delegate_agent_event: 2,
  prepare_story: 3, retry_owner_job: 3,
  manage_memory: 1, manage_calendar: 1, manage_projects: 1,
  read_owner_email: 2, send_owner_email: 3, manage_social: 3,
  publish_social: 5, desktop_action: 4, generate_media: 3, retrieve_private_document: 2,
});

export function xpForNextLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_AGENT_LEVEL) throw new TypeError('invalid_agent_level');
  return level === MAX_AGENT_LEVEL ? null : 10 * (level + 1);
}

export function permissionForTool(tool) {
  if (!Object.hasOwn(MINIMUM_LEVELS, tool)) return null;
  return { tool, minimumLevel: MINIMUM_LEVELS[tool], minLevel: MINIMUM_LEVELS[tool],
    agents: PERMISSION_AGENTS, ownerApprovalOnEscalation: true };
}

export const PERMISSIONS_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_melodi_levels (
    owner_phone TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('melodi')),
    level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 10), xp INTEGER NOT NULL DEFAULT 0 CHECK(xp>=0),
    permission_revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(owner_phone,agent))`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_level_events (
    id TEXT PRIMARY KEY, owner_phone TEXT NOT NULL, agent TEXT NOT NULL,
    event_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('selected','praised','adjusted')),
    xp_delta INTEGER NOT NULL DEFAULT 0, requested_level INTEGER, applied INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, UNIQUE(owner_phone,event_key),
    FOREIGN KEY(owner_phone,agent) REFERENCES wa_melodi_levels(owner_phone,agent))`,
  `CREATE TABLE IF NOT EXISTS wa_melodi_permission_requests (
    id TEXT PRIMARY KEY, owner_phone TEXT NOT NULL, requester TEXT NOT NULL, helper TEXT NOT NULL,
    event_key TEXT NOT NULL, tool TEXT NOT NULL, required_level INTEGER NOT NULL,
    goal_scope TEXT NOT NULL CHECK(goal_scope IN ('team','personal')), parent_event_id TEXT,
    input_encrypted TEXT NOT NULL, input_iv TEXT NOT NULL,
    requester_revision INTEGER NOT NULL, helper_revision INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','claimed','completed','denied','failed','expired','revoked')),
    decision_key TEXT, claim_token TEXT, claim_event_key TEXT, receipt_code TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    UNIQUE(owner_phone,event_key),
    FOREIGN KEY(owner_phone,requester) REFERENCES wa_melodi_levels(owner_phone,agent),
    FOREIGN KEY(owner_phone,helper) REFERENCES wa_melodi_levels(owner_phone,agent))`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_permission_pending ON wa_melodi_permission_requests(owner_phone,status,created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wa_melodi_permission_decision_once ON wa_melodi_permission_requests(owner_phone,decision_key) WHERE decision_key IS NOT NULL`,
]);

function scope(owner, agent) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('invalid_permission_owner');
  if (agent !== undefined && !PERMISSION_AGENTS.includes(agent)) throw new TypeError('unknown_permission_agent');
}

function instant(value) {
  const at = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(at) || at < 0) throw new TypeError('invalid_permission_clock');
  return Math.trunc(at);
}

async function digest(value) {
  if (typeof value !== 'string' || !value || value.length > 2000) throw new TypeError('invalid_permission_event_key');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function publicRequest(row) {
  if (!row) return null;
  const { input_encrypted, input_iv, event_key, decision_key, claim_token, claim_event_key, ...metadata } = row;
  return metadata;
}

function publicAgent(row) {
  return row ? { ...row, nextLevelXp: xpForNextLevel(row.level), initialLevel: INITIAL_AGENT_LEVELS[row.agent] } : null;
}

const rows = result => result?.results || [];
const changed = result => Number(result?.meta?.changes || 0) > 0;

/** Encrypt/decrypt hooks handle a JSON object, as do the owner service hooks. */
export function createPermissionStore(db, { encrypt, decrypt, now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  if (!db?.prepare || !db?.batch) throw new TypeError('permissions_require_database');
  const statement = (query, ...values) => db.prepare(query).bind(...values);
  const clock = () => instant(now());
  const getAgent = async (owner, agent) => publicAgent(await statement('SELECT * FROM wa_melodi_levels WHERE owner_phone=? AND agent=?', owner, agent).first());
  const getRequest = (owner, id) => statement('SELECT * FROM wa_melodi_permission_requests WHERE owner_phone=? AND id=?', owner, id).first();

  async function ensureSchema() { await db.batch(PERMISSIONS_SCHEMA.map(query => db.prepare(query))); }

  async function ensureAgent(owner, agent) {
    scope(owner, agent);
    const at = clock();
    await statement('INSERT OR IGNORE INTO wa_melodi_levels(owner_phone,agent,level,xp,created_at,updated_at) VALUES(?,?,?,0,?,?)',
      owner, agent, INITIAL_AGENT_LEVELS[agent], at, at).run();
    return getAgent(owner, agent);
  }

  async function getTeam(owner) {
    scope(owner);
    for (const agent of PERMISSION_AGENTS) await ensureAgent(owner, agent);
    return rows(await statement('SELECT * FROM wa_melodi_levels WHERE owner_phone=? ORDER BY level DESC,agent', owner).all()).map(publicAgent);
  }

  async function reward({ owner, agent, eventKey, kind }) {
    scope(owner, agent);
    if (!['selected', 'praised'].includes(kind)) throw new TypeError('invalid_permission_reward');
    await ensureAgent(owner, agent);
    const id = uuid(), key = await digest(eventKey), at = clock(), xp = kind === 'praised' ? PRAISE_XP : SELECTION_XP;
    const batch = await db.batch([
      statement(`INSERT OR IGNORE INTO wa_melodi_level_events(id,owner_phone,agent,event_key,kind,xp_delta,created_at) VALUES(?,?,?,?,?,?,?)`, id, owner, agent, key, kind, xp, at),
      statement(`UPDATE wa_melodi_levels SET xp=xp+?,updated_at=? WHERE owner_phone=? AND agent=?
        AND EXISTS(SELECT 1 FROM wa_melodi_level_events WHERE id=? AND applied=0) RETURNING level,xp`, xp, at, owner, agent, id),
      // Praise and conversation selection are not permission grants. Only an
      // explicit owner configuration or one-use approval changes authority.
      statement('UPDATE wa_melodi_level_events SET applied=1 WHERE id=? AND owner_phone=? AND agent=?', id, owner, agent),
    ]);
    return { applied: changed(batch[0]), kind, xpAwarded: changed(batch[0]) ? xp : 0, agent: await getAgent(owner, agent) };
  }

  async function adjustLevel({ owner, agent, level, eventKey }) {
    scope(owner, agent);
    xpForNextLevel(level);
    await ensureAgent(owner, agent);
    const id = uuid(), key = await digest(eventKey), at = clock();
    const batch = await db.batch([
      statement(`INSERT OR IGNORE INTO wa_melodi_level_events(id,owner_phone,agent,event_key,kind,requested_level,created_at) VALUES(?,?,?,?,'adjusted',?,?)`, id, owner, agent, key, level, at),
      statement(`UPDATE wa_melodi_levels SET level=?,xp=0,permission_revision=permission_revision+1,updated_at=? WHERE owner_phone=? AND agent=?
        AND EXISTS(SELECT 1 FROM wa_melodi_level_events WHERE id=? AND applied=0)`, level, at, owner, agent, id),
      statement(`UPDATE wa_melodi_permission_requests SET status='revoked',claim_token=NULL,receipt_code='level_changed',updated_at=?
        WHERE owner_phone=? AND (requester=? OR helper=?) AND status IN ('pending','approved','claimed')
        AND EXISTS(SELECT 1 FROM wa_melodi_level_events WHERE id=? AND applied=0)`, at, owner, agent, agent, id),
      statement('UPDATE wa_melodi_level_events SET applied=1 WHERE id=? AND owner_phone=? AND agent=?', id, owner, agent),
    ]);
    return { applied: changed(batch[0]), agent: await getAgent(owner, agent) };
  }

  async function seal(input) {
    if (typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new Error('permission_encryption_required');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('invalid_permission_input');
    const encoded = JSON.stringify(input);
    if (encoded.length > 50_000) throw new RangeError('permission_input_too_large');
    const safeInput = JSON.parse(encoded);
    const sealed = await encrypt(safeInput);
    if (typeof sealed?.encrypted !== 'string' || !sealed.encrypted || typeof sealed?.iv !== 'string' || !sealed.iv) throw new Error('permission_encryption_failed');
    return sealed;
  }

  async function unseal(row) {
    if (typeof decrypt !== 'function') throw new Error('permission_encryption_required');
    const input = await decrypt(row.input_encrypted, row.input_iv);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('permission_decryption_failed');
    return input;
  }

  async function expireRequests(owner) {
    const at = clock();
    await statement(`UPDATE wa_melodi_permission_requests SET status='expired',claim_token=NULL,receipt_code='approval_expired',updated_at=?
      WHERE owner_phone=? AND status IN ('pending','approved') AND expires_at<=?`, at, owner, at).run();
  }

  async function authorizeOrRequest({ owner, agent, tool, input = {}, eventKey, parentEventId = null, goalScope = 'team' }) {
    scope(owner, agent);
    const permission = permissionForTool(tool);
    if (!permission) return { allowed: false, status: 'blocked', reason: 'unknown_permission_tool' };
    if (!['personal', 'team'].includes(goalScope)) throw new TypeError('invalid_permission_scope');
    if (parentEventId !== null && (typeof parentEventId !== 'string' || parentEventId.length > 180)) throw new TypeError('invalid_parent_event');
    const key = await digest(eventKey), team = await getTeam(owner), member = team.find(item => item.agent === agent);
    if (goalScope === 'personal' && tool === 'delegate_agent_event') return { allowed: false, status: 'blocked', reason: 'personal_goal_cannot_be_delegated' };
    await expireRequests(owner);
    const prior = await statement('SELECT * FROM wa_melodi_permission_requests WHERE owner_phone=? AND event_key=?', owner, key).first();
    if (prior) {
      if (prior.requester !== agent || prior.tool !== tool) return { allowed: false, status: 'blocked', reason: 'permission_request_conflict' };
      return { allowed: false, status: prior.status === 'pending' || prior.status === 'approved' ? 'waiting_approval' : prior.status,
        waitingApproval: publicRequest(prior) };
    }
    if (member.level >= permission.minimumLevel) return { allowed: true, status: 'allowed', permission, agentLevel: member.level,
      permissionRevision: member.permission_revision };
    // The owner can grant this exact operation once. No retired specialist and
    // no permanent level increase is required to use an installed capability.
    const helper = member;
    const sealed = await seal(input), at = clock(), id = uuid();
    await statement(`INSERT OR IGNORE INTO wa_melodi_permission_requests
      (id,owner_phone,requester,helper,event_key,tool,required_level,goal_scope,parent_event_id,input_encrypted,input_iv,
        requester_revision,helper_revision,created_at,updated_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM wa_melodi_levels WHERE owner_phone=? AND agent=? AND permission_revision=?)
      AND EXISTS(SELECT 1 FROM wa_melodi_levels WHERE owner_phone=? AND agent=? AND permission_revision=?)`,
    id, owner, agent, helper.agent, key, tool, permission.minimumLevel, goalScope, parentEventId,
    sealed.encrypted, sealed.iv, member.permission_revision, helper.permission_revision, at, at, at + 24 * 60 * 60_000,
    owner, agent, member.permission_revision, owner, helper.agent, helper.permission_revision).run();
    const row = await statement('SELECT * FROM wa_melodi_permission_requests WHERE owner_phone=? AND event_key=?', owner, key).first();
    if (!row) return { allowed: false, status: 'blocked', reason: 'permission_state_changed' };
    if (row.requester !== agent || row.tool !== tool) return { allowed: false, status: 'blocked', reason: 'permission_request_conflict' };
    return { allowed: false, status: 'waiting_approval', waitingApproval: publicRequest(row), permission, agentLevel: member.level };
  }

  async function listPending(owner) {
    scope(owner);
    await expireRequests(owner);
    return rows(await statement(`SELECT * FROM wa_melodi_permission_requests WHERE owner_phone=? AND status IN ('pending','approved') ORDER BY created_at,id LIMIT 40`, owner).all()).map(publicRequest);
  }

  // Only the authenticated owner command path may call this method. A helper
  // receives a task after this explicit approval; her level is never changed.
  async function approve({ owner, approvalId, approved, eventKey }) {
    scope(owner);
    if (typeof approved !== 'boolean') throw new TypeError('explicit_owner_decision_required');
    const key = await digest(eventKey), at = clock();
    await expireRequests(owner);
    const usedDecision = await statement('SELECT id FROM wa_melodi_permission_requests WHERE owner_phone=? AND decision_key=?', owner, key).first();
    if (usedDecision && usedDecision.id !== approvalId) return { status: 'decision_conflict', applied: false };
    const current = await getRequest(owner, approvalId);
    if (!current) return { status: 'not_found' };
    if (current.status !== 'pending') return { status: current.status, applied: false };
    // Validate encrypted work before changing the row to approved.
    let input;
    if (approved) input = await unseal(current);
    let result;
    try { result = await statement(`UPDATE wa_melodi_permission_requests SET status=?,decision_key=?,updated_at=?
      WHERE id=? AND owner_phone=? AND status='pending' AND expires_at>?
      AND helper=requester
      AND EXISTS(SELECT 1 FROM wa_melodi_levels WHERE owner_phone=? AND agent=? AND permission_revision=?)
      AND EXISTS(SELECT 1 FROM wa_melodi_levels WHERE owner_phone=? AND agent=? AND permission_revision=?) RETURNING *`,
    approved ? 'approved' : 'denied', key, at, approvalId, owner, at,
    owner, current.helper, current.helper_revision, owner, current.requester, current.requester_revision).all(); }
    catch (error) {
      // Concurrent approvals using the same owner command cannot authorize
      // separate requests. Other SQL failures still fail closed normally.
      const replay = await statement('SELECT id FROM wa_melodi_permission_requests WHERE owner_phone=? AND decision_key=?', owner, key).first();
      if (replay && replay.id !== approvalId) return { status: 'decision_conflict', applied: false };
      throw error;
    }
    const row = rows(result)[0];
    if (!row) return { status: (await getRequest(owner, approvalId))?.status || 'not_found', applied: false };
    return approved ? { status: 'approved', applied: true, request: { ...publicRequest(row), input } }
      : { status: 'denied', applied: true, request: publicRequest(row) };
  }

  // Claim exactly once. Ambiguous external failures are not replayed; the
  // helper's actual tool uses this stable operation id for its own deduplication.
  async function claimApproved({ owner, approvalId, helper, eventKey }) {
    scope(owner, helper);
    const key = await digest(eventKey), at = clock(), token = uuid();
    await expireRequests(owner);
    const current = await getRequest(owner, approvalId);
    if (!current || current.helper !== helper || current.status !== 'approved') return { allowed: false, status: current?.status || 'not_found' };
    const input = await unseal(current);
    const result = await statement(`UPDATE wa_melodi_permission_requests SET status='claimed',claim_token=?,claim_event_key=?,updated_at=?
      WHERE id=? AND owner_phone=? AND helper=? AND status='approved' AND expires_at>?
      AND helper=requester
      AND EXISTS(SELECT 1 FROM wa_melodi_levels WHERE owner_phone=? AND agent=? AND permission_revision=?)
      AND EXISTS(SELECT 1 FROM wa_melodi_levels WHERE owner_phone=? AND agent=? AND permission_revision=?) RETURNING *`,
    token, key, at, approvalId, owner, helper, at, owner, helper, current.helper_revision,
    owner, current.requester, current.requester_revision).all();
    const row = rows(result)[0];
    if (!row) return { allowed: false, status: 'revoked_or_claimed' };
    return { allowed: true, status: 'claimed', request: { ...publicRequest(row), input },
      grant: { approvalId, helper, token, idempotencyKey: `approved:${approvalId}` } };
  }

  async function finishApproval({ owner, approvalId, token, status, receiptCode = null }) {
    scope(owner);
    if (!['complete', 'completed', 'failed'].includes(status)) throw new TypeError('invalid_approval_outcome');
    if (receiptCode !== null && (typeof receiptCode !== 'string' || !/^[a-z0-9_:-]{1,64}$/i.test(receiptCode))) throw new TypeError('invalid_permission_receipt');
    const result = await statement(`UPDATE wa_melodi_permission_requests SET status=?,claim_token=NULL,receipt_code=?,updated_at=?
      WHERE id=? AND owner_phone=? AND status='claimed' AND claim_token=? RETURNING id`,
    status === 'complete' ? 'completed' : status, receiptCode, clock(), approvalId, owner, token).all();
    return rows(result).length === 1;
  }

  return Object.freeze({ ensureSchema, ensureAgent, getTeam, reward, adjustLevel, authorizeOrRequest, listPending, approve, claimApproved, finishApproval });
}
