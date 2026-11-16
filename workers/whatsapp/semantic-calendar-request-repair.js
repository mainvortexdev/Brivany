import { createReminderBatch } from './calendar-reminder-batch.js';
import { createDeliveryNotices } from './delivery-notice.js';
import { requestGoogleCalendarSync } from './google-calendar-sync-queue.js';
import { shortReminderTime } from './reminder-language.js';

export const SEMANTIC_SCHEDULE_REPAIR_REV = '2026-10-26.2';
export const SEMANTIC_SCHEDULE_REPAIR_MESSAGE = 'wamid.HBgLMTg0OTUyMDUyNDYVAgASGBYzRUIwMUU3NTAyNjg0MEQxQTE2NTBBAA==';
export const SEMANTIC_SCHEDULE_REPAIR_AT = '2026-10-26T12:22:21.738Z';
export const SEMANTIC_SCHEDULE_REPAIR_REPLY = '¿Para qué día son esas actividades?';
const OWNER = '18495205246', ZONE = 'America/Santo_Domingo';
const SESSION_AT = '2026-10-26T03:23:11.574Z', LEASE_MS = 120000;
const KEY = `semantic-calendar-repair:${SEMANTIC_SCHEDULE_REPAIR_REV}:${SEMANTIC_SCHEDULE_REPAIR_MESSAGE}`;
export const SEMANTIC_SCHEDULE_REPAIR_SCHEMA = `CREATE TABLE IF NOT EXISTS semantic_calendar_request_repairs (
  owner TEXT NOT NULL,source_message_id TEXT NOT NULL,revision TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','prepared','applied','repaired','blocked')),
  source_hash TEXT,payload_encrypted TEXT,payload_iv TEXT,event_ids TEXT,
  guard_value INTEGER NOT NULL DEFAULT 1 CHECK(guard_value=1),reason TEXT,
  lease_token TEXT,lease_until INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
  PRIMARY KEY(owner,source_message_id))`;
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const asTime = value => value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);

function eventsFrom(result, now) {
  if (result?.route !== 'events' || result.events?.length !== 4) throw Error('invalid_semantic_plan');
  const events = result.events.map(event => {
    const title = typeof event?.title === 'string' ? event.title.trim() : '';
    const at = Date.parse(event?.eventAt);
    if (!title || title.length > 240 || /[\u0000-\u001f]/.test(title) || !Number.isFinite(at)) throw Error('invalid_semantic_plan');
    if (at <= Date.parse(SEMANTIC_SCHEDULE_REPAIR_AT) || at <= now) throw Error('event_time_elapsed');
    return { title, eventAt: new Date(at).toISOString() };
  });
  if (new Set(events.map(event => JSON.stringify(event))).size !== 4) throw Error('invalid_semantic_plan');
  return events;
}

/** One owner-reported failure only. The source is recovered and interpreted in
 * the Worker; neither keys nor the private conversation leave the runtime.
 * interpret(raw,{referenceAt,now,timeZone}) must use the semantic planner.
 * persist must write melodi_calendar_events in one D1 batch, with id as its first
 * INSERT binding, and return the usual {status:'scheduled',events} receipt. */
export async function repairRequestedSemanticSchedule(env, {
  services, interpret, authorize, persist = createReminderBatch,
  sync = input => requestGoogleCalendarSync(env, input), now = () => Date.now(),
} = {}) {
  if (env.REQUESTED_SEMANTIC_SCHEDULE_REPAIR_REV !== SEMANTIC_SCHEDULE_REPAIR_REV) return { status: 'disabled' };
  if (String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '') !== OWNER || (env.TIME_ZONE || ZONE) !== ZONE) return { status: 'source_mismatch' };
  if (!services?.encrypt || !services?.decrypt || typeof interpret !== 'function' || typeof authorize !== 'function') return { status: 'unavailable' };
  const clock = () => asTime(typeof now === 'function' ? now() : now);
  const db = env.VETSA_CLOUD?.withSession ? env.VETSA_CLOUD.withSession('first-primary') : env.VETSA_CLOUD;
  if (!db?.prepare || !db?.batch || !Number.isSafeInteger(clock())) return { status: 'unavailable' };
  const query = (sql, ...values) => db.prepare(sql).bind(...values);
  const row = () => query('SELECT * FROM semantic_calendar_request_repairs WHERE owner=? AND source_message_id=?', OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE).first();
  await db.prepare(SEMANTIC_SCHEDULE_REPAIR_SCHEMA).run();
  await query(`INSERT OR IGNORE INTO semantic_calendar_request_repairs(owner,source_message_id,revision,created_at,updated_at) VALUES(?,?,?,?,?)`, OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, SEMANTIC_SCHEDULE_REPAIR_REV, clock(), clock()).run();
  let current = await row();
  if (current.revision !== SEMANTIC_SCHEDULE_REPAIR_REV) return { status: 'source_mismatch' };
  if (current.status === 'repaired') return { status: 'already_repaired' };
  if (current.status === 'blocked') return { status: 'blocked', reason: current.reason };
  const token = crypto.randomUUID();
  current = await query(`UPDATE semantic_calendar_request_repairs SET lease_token=?,lease_until=?,updated_at=?
    WHERE owner=? AND source_message_id=? AND status IN ('pending','prepared','applied') AND (lease_token IS NULL OR lease_until<=?) RETURNING *`,
    token, clock() + LEASE_MS, clock(), OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, clock()).first();
  if (!current) return { status: 'busy' };
  const blocked = async reason => {
    await query(`UPDATE semantic_calendar_request_repairs SET status='blocked',reason=?,updated_at=? WHERE owner=? AND source_message_id=? AND lease_token=?`, reason, clock(), OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, token).run();
    return { status: 'blocked', reason };
  };
  const unseal = async record => {
    const value = parse(await services.decrypt(record.payload_encrypted, record.payload_iv));
    if (value?.owner !== OWNER || value.messageId !== SEMANTIC_SCHEDULE_REPAIR_MESSAGE || value.revision !== SEMANTIC_SCHEDULE_REPAIR_REV
      || value.referenceAt !== SEMANTIC_SCHEDULE_REPAIR_AT || value.timeZone !== ZONE || typeof value.source !== 'string'
      || await digest(value.source) !== record.source_hash) throw Error('frozen_source_mismatch');
    return value;
  };
  async function sourceSnapshot() {
    const processing = await query('SELECT status,attempts,created_at,response_encrypted,response_iv FROM wa_message_processing WHERE owner=? AND message_id=?', OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE).first();
    if (processing?.status !== 'done' || processing.attempts !== 1 || processing.created_at !== Date.parse(SEMANTIC_SCHEDULE_REPAIR_AT) || !processing.response_encrypted) throw Error('source_changed');
    const response = parse(await services.decrypt(processing.response_encrypted, processing.response_iv));
    if (response?.body !== SEMANTIC_SCHEDULE_REPAIR_REPLY) throw Error('source_changed');
    if (await query("SELECT 1 n FROM wa_message_effects WHERE owner=? AND message_id=? AND kind='action' LIMIT 1", OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE).first()
      || await query('SELECT 1 n FROM wa_message_processing WHERE owner=? AND created_at>? LIMIT 1', OWNER, processing.created_at).first()) throw Error('source_changed');
    const context = await query("SELECT encrypted_context,context_iv,updated_at FROM wa_melodi_private_context WHERE owner_phone=? AND agent='melodi'", OWNER).first();
    if (!context) throw Error('source_unavailable');
    const decoded = parse(await services.decrypt(context.encrypted_context, context.context_iv));
    const turns = decoded?.recent?.filter(turn => turn.role === 'user' && Date.parse(turn.at) >= Date.parse('2026-10-26T12:22:20Z') && Date.parse(turn.at) <= Date.parse('2026-10-26T12:22:29Z')) || [];
    if (turns.length !== 1 || typeof turns[0].message !== 'string' || !turns[0].message.trim() || turns[0].message.length > 12000) throw Error('source_unavailable');
    const session = await query('SELECT session_type,encrypted_state,state_iv,updated_at FROM wa_owner_session WHERE owner_phone=?', OWNER).first();
    if (session && (session.session_type !== 'await_reminder_time' || session.updated_at !== SESSION_AT)) throw Error('source_changed');
    return { source: turns[0].message, processing, context, session };
  }
  let frozen;
  try {
    if (current.status !== 'applied') {
      if (current.status === 'prepared') frozen = await unseal(current);
      else {
        const snapshot = await sourceSnapshot();
        let interpretation;
        try { interpretation = await interpret(snapshot.source, { referenceAt: SEMANTIC_SCHEDULE_REPAIR_AT, now: clock(), timeZone: ZONE }); }
        catch { return { status: 'retryable', reason: 'semantic_planner_unavailable' }; }
        let events;
        try { events = eventsFrom(interpretation, clock()); }
        catch (error) { return blocked(error.message); }
        frozen = { owner: OWNER, messageId: SEMANTIC_SCHEDULE_REPAIR_MESSAGE, revision: SEMANTIC_SCHEDULE_REPAIR_REV,
          source: snapshot.source, referenceAt: SEMANTIC_SCHEDULE_REPAIR_AT, timeZone: ZONE, events, snapshot };
        const sealed = await services.encrypt(JSON.stringify(frozen));
        if (!sealed?.encrypted || !sealed.iv) throw Error('repair_encryption_unavailable');
        await query(`UPDATE semantic_calendar_request_repairs SET status='prepared',source_hash=?,payload_encrypted=?,payload_iv=?,updated_at=?
          WHERE owner=? AND source_message_id=? AND lease_token=? AND status='pending' AND lease_until>?`,
          await digest(snapshot.source), sealed.encrypted, sealed.iv, clock(), OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, token, clock()).run();
        current = await row();
        if (current.status !== 'prepared' || current.lease_token !== token) return { status: 'busy' };
        frozen = await unseal(current);
      }
      try { eventsFrom({ route: 'events', events: frozen.events }, clock()); }
      catch (error) { return blocked(error.message); }
      const authority = await authorize({ owner: OWNER, tool: 'manage_calendar', messageId: SEMANTIC_SCHEDULE_REPAIR_MESSAGE,
        input: { events: frozen.events, ownerRequest: { origin: 'owner_request', assignmentAgent: 'melodi', channel: 'whatsapp' } } });
      if (authority?.allowed !== true) return { status: 'approval_required' };
      const snapshot = frozen.snapshot, session = snapshot.session;
      const wrapped = new WeakMap(); let committed = false;
      const guard = () => {
        const at = clock();
        if (frozen.events.some(event => Date.parse(event.eventAt) <= at)) throw Error('event_time_elapsed');
        const sessionSql = session ? 'EXISTS(SELECT 1 FROM wa_owner_session WHERE owner_phone=? AND session_type=? AND encrypted_state=? AND state_iv=? AND updated_at=?)'
          : 'NOT EXISTS(SELECT 1 FROM wa_owner_session WHERE owner_phone=?)';
        return query(`UPDATE semantic_calendar_request_repairs SET guard_value=CASE WHEN status='prepared' AND lease_token=? AND lease_until>?
          AND EXISTS(SELECT 1 FROM wa_message_processing WHERE owner=? AND message_id=? AND status='done' AND attempts=1 AND created_at=? AND response_encrypted=? AND response_iv=?)
          AND NOT EXISTS(SELECT 1 FROM wa_message_effects WHERE owner=? AND message_id=? AND kind='action')
          AND NOT EXISTS(SELECT 1 FROM wa_message_processing WHERE owner=? AND created_at>?)
          AND EXISTS(SELECT 1 FROM wa_melodi_private_context WHERE owner_phone=? AND agent='melodi' AND encrypted_context=? AND context_iv=? AND updated_at=?)
          AND ${sessionSql} THEN 1 ELSE NULL END WHERE owner=? AND source_message_id=?`,
          token, at, OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, Date.parse(SEMANTIC_SCHEDULE_REPAIR_AT), snapshot.processing.response_encrypted, snapshot.processing.response_iv,
          OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, OWNER, Date.parse(SEMANTIC_SCHEDULE_REPAIR_AT), OWNER,
          snapshot.context.encrypted_context, snapshot.context.context_iv, snapshot.context.updated_at,
          ...(session ? [OWNER, session.session_type, session.encrypted_state, session.state_iv, session.updated_at] : [OWNER]), OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE);
      };
      const calendarWrite = sql => /^\s*(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+melodi_calendar_events\b/i.test(sql);
      const wrap = (statement, sql, values = []) => {
        const result = { bind: (...bound) => wrap(statement.bind(...bound), sql, bound),
          run: () => { if (calendarWrite(sql)) throw Error('repair_requires_atomic_calendar_batch'); return statement.run(); },
          first: (...args) => statement.first(...args), all: (...args) => statement.all(...args), raw: (...args) => statement.raw(...args) };
        wrapped.set(result, { statement, sql, values }); return result;
      };
      const guardedDb = {
        prepare: sql => wrap(db.prepare(sql), sql), withSession: () => guardedDb,
        async batch(statements) {
          const entries = statements.map(statement => wrapped.get(statement));
          if (entries.some(entry => !entry)) throw Error('repair_unbound_batch');
          const inserts = entries.filter(entry => calendarWrite(entry.sql));
          if (!inserts.length) return db.batch(entries.map(entry => entry.statement));
          if (committed || inserts.length !== 4 || inserts.some(entry => !/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+melodi_calendar_events\s*\(\s*id\s*,/i.test(entry.sql))) throw Error('invalid_repair_atomic_batch');
          const ids = inserts.map(entry => entry.values[0]);
          if (ids.some(id => typeof id !== 'string' || !id || id.length > 300) || new Set(ids).size !== 4) throw Error('invalid_repair_receipt');
          const cleanup = session ? [query('DELETE FROM wa_owner_session WHERE owner_phone=? AND session_type=? AND encrypted_state=? AND state_iv=? AND updated_at=?',
            OWNER, session.session_type, session.encrypted_state, session.state_iv, session.updated_at)] : [];
          const result = await db.batch([guard(), ...entries.map(entry => entry.statement), ...cleanup,
            query(`UPDATE semantic_calendar_request_repairs SET status='applied',event_ids=?,updated_at=? WHERE owner=? AND source_message_id=? AND lease_token=? AND status='prepared'`, JSON.stringify(ids), clock(), OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, token)]);
          committed = true;
          return result.slice(1, 1 + entries.length);
        },
      };
      try {
        const saved = await persist({ ...env, VETSA_CLOUD: guardedDb }, OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, frozen.events, { agent: 'melodi' });
        if (saved?.status !== 'scheduled' || saved.events?.length !== 4 || !committed) throw Error('repair_receipt_unconfirmed');
      } catch (error) {
        current = await row();
        if (current.status !== 'applied') {
          if (error?.message === 'event_time_elapsed') return blocked('event_time_elapsed');
          return { status: 'unconfirmed', reason: 'atomic_source_guard_or_persistence_failed' };
        }
      }
      current = await row();
    }
    frozen ||= await unseal(current);
    const ids = JSON.parse(current.event_ids || 'null');
    if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4) return blocked('invalid_repair_receipt');
    const saved = await query(`SELECT id,phone,title,event_at,assigned_agent FROM melodi_calendar_events WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).all();
    const events = ids.map((id, index) => (saved.results || []).find(event => event.id === id && event.phone === OWNER && event.assigned_agent === 'melodi'
      && event.title === frozen.events[index].title && event.event_at === frozen.events[index].eventAt));
    if (events.some(event => !event)) return blocked('calendar_changed_after_commit');
    const notices = createDeliveryNotices(db, { ...services, now: clock });
    await notices.ensureSchema();
    await notices.enqueue({ owner: OWNER, agent: 'melodi', key: KEY, ownerRequested: true,
      body: `Ya quedó tu agenda:\n${events.map(event => `• ${event.title}, ${shortReminderTime(event.event_at, ZONE, clock())}`).join('\n')}` });
    await sync?.({ owner: OWNER, now: clock() });
    await env.MELODI_JOBS?.send({ type: 'autonomy_outbox' });
    await query(`UPDATE semantic_calendar_request_repairs SET status='repaired',reason=NULL,updated_at=? WHERE owner=? AND source_message_id=? AND lease_token=? AND status='applied'`, clock(), OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, token).run();
    return { status: 'repaired', created: 4, eventIds: ids };
  } catch (error) {
    if (['source_changed', 'source_unavailable', 'frozen_source_mismatch'].includes(error?.message)) return blocked(error.message);
    return { status: 'retryable', reason: 'repair_unavailable' };
  } finally {
    await query('UPDATE semantic_calendar_request_repairs SET lease_token=NULL,lease_until=NULL WHERE owner=? AND source_message_id=? AND lease_token=?', OWNER, SEMANTIC_SCHEDULE_REPAIR_MESSAGE, token).run();
  }
}
