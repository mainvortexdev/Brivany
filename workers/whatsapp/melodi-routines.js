import { clockContext, localDateTimeToUtc, DOMINICAN_TIME_ZONE } from './event-time.js';
import { calendarActivityPaused, calendarScheduleExclusion } from './google-calendar-guards.js';

const AGENTS = ['melodi'];
const WEEK = 7 * 86400000;
const LEASE_MS = 10 * 60000;
const MAX_ATTEMPTS = 3;

export const ROUTINE_SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS wa_melodi_routines (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL CHECK(agent IN ('melodi')),
    event_key TEXT NOT NULL, payload_encrypted TEXT NOT NULL, payload_iv TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('auto','email','whatsapp')),
    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), hour TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stopped')),
    next_at INTEGER NOT NULL, available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT, lease_until INTEGER, last_run_at INTEGER, last_outcome TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(owner,event_key))`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_routines_due ON wa_melodi_routines(owner,status,available_at,lease_until)`,
  `CREATE INDEX IF NOT EXISTS wa_melodi_routines_assigned ON wa_melodi_routines(owner,agent,status)`,
]);

function timestamp(value) {
  const at = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(at) || at < 0) throw new TypeError('Invalid routine timestamp');
  return Math.trunc(at);
}

function validOwner(owner) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length > 160) throw new TypeError('Invalid routine owner');
}

function validAgent(agent) {
  if (!AGENTS.includes(agent)) throw new TypeError('Invalid routine agent');
}

function schedule(weekday, hour) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || typeof hour !== 'string'
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hour)) throw new TypeError('Invalid weekly routine schedule');
}

export function routineWeekdays(row, payload = {}) {
  const days = payload.weekdays === undefined ? [row.weekday] : payload.weekdays;
  if (!Array.isArray(days) || days.length < 1 || days.length > 7 || new Set(days).size !== days.length
    || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new TypeError('Invalid weekly routine weekdays');
  return [...days].sort((a,b) => a-b);
}

async function digest(eventKey) {
  if (typeof eventKey !== 'string' || !eventKey.trim() || eventKey.length > 2000) throw new TypeError('Invalid routine event key');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(eventKey));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** First future occurrence of a weekly Dominican wall-clock schedule, as UTC ISO. */
export function nextWeeklyRoutineAt(now = Date.now(), weekday = 5, hour = '09:00') {
  if (Array.isArray(weekday)) {
    const days = routineWeekdays({}, { weekdays: weekday });
    return days.map(day => nextWeeklyRoutineAt(now, day, hour)).sort()[0];
  }
  schedule(weekday, hour);
  const at = timestamp(now);
  const day = clockContext(at, DOMINICAN_TIME_ZONE).today_local;
  const date = new Date(`${day}T12:00:00Z`);
  const daysUntil = (weekday - date.getUTCDay() + 7) % 7;
  const candidateDay = new Date(date.getTime() + daysUntil * 86400000).toISOString().slice(0, 10);
  const candidate = localDateTimeToUtc(`${candidateDay}T${hour}`, DOMINICAN_TIME_ZONE);
  return Date.parse(candidate) > at ? candidate : new Date(Date.parse(candidate) + WEEK).toISOString();
}

export function nextDailyRoutineAt(now = Date.now(), hour = '10:00') {
  schedule(0,hour);
  const at=timestamp(now), today=clockContext(at,DOMINICAN_TIME_ZONE).today_local;
  const candidate=localDateTimeToUtc(`${today}T${hour}`,DOMINICAN_TIME_ZONE);
  return Date.parse(candidate)>at ? candidate : new Date(Date.parse(candidate)+86400000).toISOString();
}

// BYMONTHDAY semantics: months without that date are skipped, never silently clamped.
export function nextMonthlyRoutineAt(now = Date.now(), dayOfMonth = 7, hour = '09:00') {
  schedule(0,hour);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) throw new TypeError('Invalid monthly day');
  const at=timestamp(now), today=clockContext(at,DOMINICAN_TIME_ZONE).today_local;
  const [year,month]=today.split('-').map(Number);
  for (let offset=0;offset<24;offset++) {
    const date=new Date(Date.UTC(year,month-1+offset,dayOfMonth,12));
    if (date.getUTCDate()!==dayOfMonth) continue;
    const candidate=localDateTimeToUtc(`${date.toISOString().slice(0,10)}T${hour}`,DOMINICAN_TIME_ZONE);
    if (Date.parse(candidate)>at) return candidate;
  }
  throw new Error('Monthly occurrence unavailable');
}

export function routineMatchesLocal(row,payload,local) {
  return local.slice(11,16)===row.hour && (payload.frequency==='daily'
    || payload.frequency==='monthly' && Number(local.slice(8,10))===payload.dayOfMonth
    || (!payload.frequency || payload.frequency==='weekly') && routineWeekdays(row,payload).includes(new Date(`${local.slice(0,10)}T12:00:00Z`).getUTCDay()));
}

export function nextRoutineAt(row,payload,after) {
  return payload.frequency === 'daily' ? nextDailyRoutineAt(after,row.hour)
    : payload.frequency === 'monthly' ? nextMonthlyRoutineAt(after,payload.dayOfMonth,row.hour) : nextWeeklyRoutineAt(after,routineWeekdays(row,payload),row.hour);
}

/** A Calendar instance changes only this occurrence; the weekly assignment and run key stay intact. */
export function routineCalendarOccurrence(payload, originalAt) {
  const original = new Date(timestamp(originalAt)).toISOString();
  const exception = payload.calendarExceptions?.[original];
  return { originalAt: original, cancelled: exception?.status === 'cancelled',
    startAt: exception?.status === 'updated' ? new Date(timestamp(exception.startAt)).toISOString() : original,
    title: exception?.status === 'updated' && typeof exception.title === 'string' ? exception.title : payload.title };
}

export function nextRoutineCalendarOccurrence(row, payload, after) {
  let next = Date.parse(nextRoutineAt(row,payload,after));
  for (let skipped = 0; skipped <= 100; skipped++) {
    const occurrence = routineCalendarOccurrence(payload,next);
    if (!occurrence.cancelled && Date.parse(occurrence.startAt) > timestamp(after)) return {nextAt:next,availableAt:Date.parse(occurrence.startAt)};
    next = Date.parse(nextRoutineAt(row,payload,next));
  }
  throw new Error('Routine calendar exception limit');
}

/** encrypt accepts JSON text and returns {encrypted,iv}; decrypt returns JSON text or an object. */
export function createRoutineStore(db, { encrypt, decrypt, now = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  if (!db?.prepare || !db?.batch) throw new TypeError('Routines require a D1 binding');
  if (typeof encrypt !== 'function' || typeof decrypt !== 'function') throw new TypeError('Routines require encryption hooks');
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  const time = value => timestamp(value ?? now());
  const rows = result => result?.results || [];
  const unpack = async row => {
    const decoded = await decrypt(row.payload_encrypted, row.payload_iv);
    const payload = typeof decoded === 'string' ? JSON.parse(decoded) : decoded;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Routine decryption failed');
    return payload;
  };
  const expose = async (row, includePrivate = false) => {
    const payload = await unpack(row);
    const occurrence = routineCalendarOccurrence(payload,row.next_at);
    return {
      id: row.id, owner: row.owner, agent: row.agent, eventKey: payload.eventKey, title: occurrence.title,
      channel: row.channel, weekday: row.weekday, hour: row.hour, timeZone: DOMINICAN_TIME_ZONE,
      status: row.status, kind:payload.kind || 'weekly_research', frequency:payload.frequency || 'weekly',
      ...(payload.weekdays ? {weekdays:routineWeekdays(row,payload)} : {}),
      ...(payload.frequency==='monthly' ? {dayOfMonth:payload.dayOfMonth} : {}),
      nextAt: occurrence.startAt, availableAt: new Date(row.available_at).toISOString(),
      attempts: row.attempts, lastRunAt: row.last_run_at === null ? null : new Date(row.last_run_at).toISOString(),
      lastOutcome: row.last_outcome, ...(includePrivate ? { brief: payload.brief, profile: payload.profile } : {}),
    };
  };

  async function ensureSchema() {
    await db.batch(ROUTINE_SCHEMA.map(sql => db.prepare(sql)));
  }

  async function create({ owner, agent, eventKey, title, brief = '', profile = '', channel = 'auto', weekday, weekdays, hour = '09:00', kind = 'weekly_research', frequency = 'weekly', dayOfMonth }) {
    const selectedDays = weekdays === undefined ? undefined : routineWeekdays({}, {weekdays});
    weekday ??= selectedDays?.[0] ?? 5;
    validOwner(owner); validAgent(agent); schedule(weekday, hour);
    if (!['weekly_research','motivational_message','recurring_reminder'].includes(kind) || !['weekly','daily','monthly'].includes(frequency)
      || (kind === 'weekly_research' && frequency !== 'weekly') || (kind === 'motivational_message' && frequency !== 'daily')) throw new TypeError('Invalid routine frequency');
    if (selectedDays && (frequency !== 'weekly' || !selectedDays.includes(weekday))) throw new TypeError('Invalid weekly routine weekdays');
    if (frequency==='monthly' && (!Number.isInteger(dayOfMonth) || dayOfMonth<1 || dayOfMonth>31)) throw new TypeError('Invalid monthly day');
    if (!['auto', 'email', 'whatsapp'].includes(channel)) throw new TypeError('Invalid routine channel');
    if (typeof title !== 'string' || !title.trim() || title.length > 500 || typeof brief !== 'string'
      || brief.length > 20000 || typeof profile !== 'string' || profile.length > 2048) throw new TypeError('Invalid routine content');
    const key = await digest(eventKey);
    // Never reactivate a stopped routine as a side effect of retrying a request.
    const existing = await statement('SELECT * FROM wa_melodi_routines WHERE owner=? AND event_key=?', owner, key).first();
    if (existing) {
      if (existing.agent !== agent) throw new Error('Routine is assigned to another agent');
      return expose(existing, true);
    }
    const at = time();
    const next = Date.parse(nextRoutineAt({weekday,hour},{frequency,dayOfMonth,...(selectedDays ? {weekdays:selectedDays}: {})},at));
    const sealed = await encrypt(JSON.stringify({ eventKey, title, brief, profile, kind, frequency,
      ...(selectedDays ? {weekdays:selectedDays}: {}), ...(frequency==='monthly' ? {dayOfMonth} : {}) }));
    if (typeof sealed?.encrypted !== 'string' || !sealed.encrypted || typeof sealed?.iv !== 'string' || !sealed.iv) throw new Error('Routine encryption failed');
    await statement(`INSERT OR IGNORE INTO wa_melodi_routines
      (id,owner,agent,event_key,payload_encrypted,payload_iv,channel,weekday,hour,next_at,available_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, uuid(), owner, agent, key, sealed.encrypted, sealed.iv, channel, weekday, hour, next, next, at, at).run();
    const stored = await statement('SELECT * FROM wa_melodi_routines WHERE owner=? AND event_key=?', owner, key).first();
    if (!stored || stored.agent !== agent) throw new Error('Routine assignment conflict');
    return expose(stored, true);
  }

  async function list(owner, agent) {
    validOwner(owner);
    if (agent !== undefined) validAgent(agent);
    const found = rows(await statement(`SELECT * FROM wa_melodi_routines WHERE owner=?${agent === undefined ? '' : ' AND agent=?'} ORDER BY next_at,id`,
      owner, ...(agent === undefined ? [] : [agent])).all());
    return Promise.all(found.map(row => expose(row, agent === row.agent)));
  }

  async function cancel({ owner, id, agent, eventKey } = {}) {
    validOwner(owner);
    if (agent !== undefined) validAgent(agent);
    if (id !== undefined && (typeof id !== 'string' || !id || id.length > 200)) throw new TypeError('Invalid routine id');
    const key = eventKey === undefined ? undefined : await digest(eventKey);
    const predicates = ['owner=?', "status='active'"];
    const values = [owner];
    for (const [column, value] of [['id', id], ['agent', agent], ['event_key', key]]) {
      if (value !== undefined) { predicates.push(`${column}=?`); values.push(value); }
    }
    const result = await statement(`UPDATE wa_melodi_routines SET status='stopped',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE ${predicates.join(' AND ')}`, time(), ...values).run();
    return Number(result?.meta?.changes || 0);
  }

  async function complete({ owner, id, leaseToken, success, now: atValue } = {}) {
    validOwner(owner);
    if (typeof id !== 'string' || !id || typeof leaseToken !== 'string' || !leaseToken || typeof success !== 'boolean') throw new TypeError('Invalid routine completion');
    const at = time(atValue);
    const row = await statement(`SELECT * FROM wa_melodi_routines WHERE owner=? AND id=? AND status='active'
      AND lease_token=? AND lease_until>?`, owner, id, leaseToken, at).first();
    if (!row) return false;
    const terminal = success || row.attempts >= MAX_ATTEMPTS;
    const nextOccurrence = terminal ? nextRoutineCalendarOccurrence(row,await unpack(row),Math.max(at,row.next_at)) : null;
    const next = terminal ? nextOccurrence.nextAt : row.next_at;
    const available = terminal ? nextOccurrence.availableAt : at + Math.min(60 * 60000, 60000 * 2 ** Math.max(0, row.attempts - 1));
    const result = await statement(`UPDATE wa_melodi_routines SET next_at=?,available_at=?,attempts=?,lease_token=NULL,
      lease_until=NULL,last_run_at=?,last_outcome=?,updated_at=? WHERE owner=? AND id=? AND status='active'
      AND lease_token=? AND lease_until>?`, next, available, terminal ? 0 : row.attempts, at,
      success ? 'success' : terminal ? 'failed' : 'retry', at, owner, id, leaseToken, at).run();
    return Number(result?.meta?.changes || 0) > 0;
  }

  async function claimDue({ owner, agent, now: atValue, limit = 10 } = {}) {
    validOwner(owner);
    if (agent !== undefined) validAgent(agent);
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new TypeError('Invalid routine claim limit');
    const at = time(atValue);
    // A worker crash on the final attempt must not create an endless cycle of
    // expired leases. Advance that occurrence while preserving stopped state.
    const exhausted = rows(await statement(`SELECT * FROM wa_melodi_routines WHERE owner=? AND status='active'
      AND available_at<=? AND attempts>=? AND (lease_token IS NULL OR lease_until<=?)`, owner, at, MAX_ATTEMPTS, at).all());
    for (const row of exhausted) {
      if (await calendarActivityPaused(db,owner,'agent_routine',row.id)) continue;
      const nextOccurrence = nextRoutineCalendarOccurrence(row,await unpack(row),Math.max(at,row.next_at)), next = nextOccurrence.nextAt;
      await statement(`UPDATE wa_melodi_routines SET next_at=?,available_at=?,attempts=0,lease_token=NULL,lease_until=NULL,
        last_run_at=?,last_outcome='failed',updated_at=? WHERE owner=? AND id=? AND status='active'
        AND next_at=? AND attempts>=? AND (lease_token IS NULL OR lease_until<=?)`,
        next, nextOccurrence.availableAt, at, at, owner, row.id, row.next_at, MAX_ATTEMPTS, at).run();
    }
    const calendarFilter=await calendarScheduleExclusion(db,{kind:'agent_routine',ownerColumn:'owner',idColumn:'id'});
    const candidates = rows(await statement(`SELECT * FROM wa_melodi_routines WHERE owner=? AND status='active'${calendarFilter}
      AND available_at<=? AND attempts<? AND (lease_token IS NULL OR lease_until<=?)${agent === undefined ? '' : ' AND agent=?'}
      ORDER BY available_at,id LIMIT ?`, owner, at, MAX_ATTEMPTS, at, ...(agent === undefined ? [] : [agent]), limit).all());
    const claimed = [];
    for (const row of candidates) {
      if (await calendarActivityPaused(db,owner,'agent_routine',row.id)) continue;
      const token = uuid();
      const leased = await statement(`UPDATE wa_melodi_routines SET lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
        WHERE owner=? AND id=? AND status='active' AND next_at=? AND available_at<=? AND attempts<?
        AND (lease_token IS NULL OR lease_until<=?) RETURNING *`, token, at + LEASE_MS, at,
        owner, row.id, row.next_at, at, MAX_ATTEMPTS, at).first();
      if (!leased) continue;
      try {
        const occurrence = routineCalendarOccurrence(await unpack(leased),leased.next_at);
        if (occurrence.cancelled) {
          await complete({owner,id:leased.id,leaseToken:token,success:true,now:at});
          continue;
        }
        const exposed = await expose(leased, true);
        const stillActive = await statement(`SELECT id FROM wa_melodi_routines WHERE owner=? AND id=? AND status='active'
          AND lease_token=? AND lease_until>?`, owner, leased.id, token, at).first();
        if (!stillActive) continue;
        claimed.push({ ...exposed, leaseToken: token,
          occurrenceAt: occurrence.startAt, originalOccurrenceAt: occurrence.originalAt, runKey: `routine:${leased.id}:${leased.next_at}` });
      } catch {
        await complete({ owner, id: leased.id, leaseToken: token, success: false, now: at });
      }
    }
    return claimed;
  }

  return Object.freeze({ ensureSchema, create, list, cancel, claimDue, complete });
}
