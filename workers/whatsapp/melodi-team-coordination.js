import { clockContext } from './event-time.js';
import { AUTONOMY_PROFILES } from './melodi-autonomy-tools.js';

export function contactWindow(now, start = '08:00', end = '22:00') {
  const time = clockContext(now).now_local.slice(11, 16);
  return time >= start && time < end;
}

export function createTeamCoordinator(db, { encrypt, decrypt }) {
  const agentId = agent => {
    if (!Object.hasOwn(AUTONOMY_PROFILES, agent)) throw new Error('unknown_team_agent');
    return agent;
  };
  const init = async (owner, now = new Date().toISOString()) => {
    await db.prepare(`INSERT OR IGNORE INTO wa_melodi_coordination(owner_phone,updated_at) VALUES(?,?)`).bind(owner, now).run();
  };
  const settings = owner => db.prepare('SELECT * FROM wa_melodi_coordination WHERE owner_phone=?').bind(owner).first();
  return {
    init, settings,
    async remember(owner, agent, message, now = new Date().toISOString(), role = 'user') {
      agentId(agent);
      const row = await db.prepare('SELECT encrypted_context,context_iv FROM wa_melodi_private_context WHERE owner_phone=? AND agent=?').bind(owner,agent).first();
      const prior = row ? await decrypt(row.encrypted_context,row.context_iv) : null;
      const text = String(message || '').slice(0,6000);
      const recent = Array.isArray(prior?.recent) ? prior.recent.slice(-7) : [];
      if (recent.at(-1)?.message !== text || recent.at(-1)?.role !== role) recent.push({ role, message: text, at: now });
      const sealed = await encrypt({ message: text, recent, updatedAt: now });
      await db.prepare(`INSERT INTO wa_melodi_private_context(owner_phone,agent,encrypted_context,context_iv,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(owner_phone,agent) DO UPDATE SET encrypted_context=excluded.encrypted_context,
        context_iv=excluded.context_iv,updated_at=excluded.updated_at`).bind(owner, agent, sealed.encrypted, sealed.iv, now).run();
    },
    async context(owner, agent) {
      agentId(agent);
      const row = await db.prepare('SELECT encrypted_context,context_iv FROM wa_melodi_private_context WHERE owner_phone=? AND agent=?').bind(owner, agent).first();
      return row ? decrypt(row.encrypted_context, row.context_iv) : null;
    },
    async goal(owner, agent) {
      agentId(agent);
      const row = await db.prepare('SELECT * FROM wa_melodi_personal_goals WHERE owner_phone=? AND agent=?').bind(owner, agent).first();
      return row ? { ...await decrypt(row.encrypted_goal, row.goal_iv), status: row.status, updatedAt: row.updated_at } : null;
    },
    async setGoal(owner, agent, goal, now = new Date().toISOString()) {
      agentId(agent);
      if (!goal?.title || typeof goal.title !== 'string' || goal.title.length > 500) throw new Error('invalid_personal_goal');
      await init(owner, now);
      const sealed = await encrypt({ title: goal.title, description: String(goal.description || '').slice(0, 6000), scope: 'personal', agent });
      await db.batch([
        db.prepare(`INSERT INTO wa_melodi_personal_goals(owner_phone,agent,encrypted_goal,goal_iv,status,updated_at)
          VALUES(?,?,?,?,'active',?) ON CONFLICT(owner_phone,agent) DO UPDATE SET encrypted_goal=excluded.encrypted_goal,
          goal_iv=excluded.goal_iv,status='active',updated_at=excluded.updated_at`).bind(owner, agent, sealed.encrypted, sealed.iv, now),
        db.prepare(`UPDATE wa_melodi_coordination SET focus_agent=?,conversation_agent=?,conversation_until=NULL,updated_at=? WHERE owner_phone=?`).bind(agent, agent, now, owner),
      ]);
      return { agent, status: 'active' };
    },
    async changeGoal(owner, agent, status, now = new Date().toISOString()) {
      agentId(agent);
      if (!['active', 'paused', 'complete'].includes(status)) throw new Error('invalid_goal_status');
      await db.batch([
        db.prepare('UPDATE wa_melodi_personal_goals SET status=?,updated_at=? WHERE owner_phone=? AND agent=?').bind(status, now, owner, agent),
        db.prepare(`UPDATE wa_melodi_coordination SET focus_agent=?,contact_token=NULL,contact_until=NULL,updated_at=?
          WHERE owner_phone=? AND (focus_agent=? OR ?='active')`).bind(status === 'active' ? agent : null, now, owner, agent, status),
      ]);
    },
    async enable(owner, enabled, now = new Date().toISOString()) {
      await init(owner, now);
      await db.prepare('UPDATE wa_melodi_coordination SET enabled=?,updated_at=? WHERE owner_phone=?').bind(enabled ? 1 : 0, now, owner).run();
    },
    async recordOwnerReply(owner, agent, now = new Date().toISOString()) {
      agentId(agent);
      await init(owner, now);
      const until = new Date(Date.parse(now) + 90 * 60000).toISOString();
      await db.prepare('UPDATE wa_melodi_coordination SET conversation_agent=?,conversation_until=?,updated_at=? WHERE owner_phone=?')
        .bind(agent, until, now, owner).run();
    },
    async claimContact(owner, agent, now = new Date().toISOString(), { collaboration = false, requestedReply = false } = {}) {
      agentId(agent);
      const row = await settings(owner);
      if (typeof requestedReply !== 'boolean') throw new TypeError('invalid_requested_reply');
      if (!row?.enabled || (!requestedReply && !contactWindow(now, row.notification_start, row.notification_end))) return null;
      const token = crypto.randomUUID();
      const leaseUntil = new Date(Date.parse(now) + 5 * 60000).toISOString();
      const cooldown = new Date(Date.parse(now) - 45 * 60000).toISOString();
      const result = await db.prepare(`UPDATE wa_melodi_coordination SET contact_agent=?,contact_until=?,contact_token=?,updated_at=?
        WHERE owner_phone=? AND enabled=1 AND (focus_agent IS NULL OR focus_agent=? OR ?=1)
        AND (contact_token IS NULL OR contact_until<=?)
        AND (conversation_until IS NULL OR conversation_until<=? OR conversation_agent=? OR ?=1)
        AND (last_contact_at IS NULL OR last_contact_at<=? OR ?=1)`).bind(agent, leaseUntil, token, now, owner, agent, collaboration ? 1 : 0, now, now, agent, collaboration ? 1 : 0, cooldown, requestedReply ? 1 : 0).run();
      return result.meta?.changes ? token : null;
    },
    async finishContact(owner, token, { delivered = false, needsReply = false, now = new Date().toISOString() } = {}) {
      const until = new Date(Date.parse(now) + 90 * 60000).toISOString();
      await db.prepare(`UPDATE wa_melodi_coordination SET contact_token=NULL,contact_until=?,
        conversation_agent=CASE WHEN ? THEN contact_agent ELSE conversation_agent END,
        conversation_until=CASE WHEN ? THEN ? ELSE conversation_until END,
        last_contact_at=CASE WHEN ? THEN ? ELSE last_contact_at END,updated_at=?
        WHERE owner_phone=? AND contact_token=?`).bind(now, delivered && needsReply ? 1 : 0, delivered && needsReply ? 1 : 0, until, delivered ? 1 : 0, now, now, owner, token).run();
    },
  };
}
