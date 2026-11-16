import { DOMINICAN_TIME_ZONE, clockContext, localDateTimeToUtc } from './event-time.js';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const GOOGLE_CALENDAR_AUTH_SCOPES = Object.freeze([GOOGLE_CALENDAR_SCOPE, 'openid', 'email']);
const API = 'https://www.googleapis.com/calendar/v3';
const AGENTS = Object.freeze({ melodi: 'Melodi' });
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const WEEKDAYS = ['SU','MO','TU','WE','TH','FR','SA'];

/** Supported weekly RRULE subset. A missing BYDAY keeps legacy DTSTART semantics. */
export function weeklyRecurrenceWeekdays(recurrence, defaultWeekday) {
  if (!Array.isArray(recurrence) || recurrence.length !== 1 || !/^RRULE:/.test(recurrence[0])) return null;
  const parts = recurrence[0].slice(6).split(';'), entries = parts.map(part => part.split('='));
  if (entries.some(entry => entry.length !== 2)) return null;
  const fields = Object.fromEntries(entries);
  if (Object.keys(fields).length !== parts.length || Object.keys(fields).some(key => !['FREQ','INTERVAL','BYDAY','WKST'].includes(key))
    || fields.FREQ !== 'WEEKLY' || fields.INTERVAL !== undefined && fields.INTERVAL !== '1'
    || fields.WKST !== undefined && !WEEKDAYS.includes(fields.WKST)) return null;
  if (fields.BYDAY === undefined) return Number.isInteger(defaultWeekday) && defaultWeekday >= 0 && defaultWeekday <= 6 ? [defaultWeekday] : null;
  const tokens = fields.BYDAY.split(',');
  if (tokens.length < 1 || tokens.length > 7 || new Set(tokens).size !== tokens.length || tokens.some(day => !WEEKDAYS.includes(day))) return null;
  return tokens.map(day => WEEKDAYS.indexOf(day)).sort((a,b) => a-b);
}

export class GoogleCalendarError extends Error {
  constructor(code, { status = 0, retryable = false, uncertain = false } = {}) {
    super(`Google Calendar: ${code}`);
    this.name = 'GoogleCalendarError';
    Object.assign(this, { code, status, retryable, uncertain });
  }
}

function text(value, name, max = 2048) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new TypeError(`Invalid ${name}`);
  }
  return value;
}

function agent(value) {
  if (!Object.hasOwn(AGENTS, value)) throw new TypeError('Invalid calendar agent');
  return value;
}

function instant(value, name = 'calendar time') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new TypeError(`Invalid ${name}`);
  // Date.parse normalizes impossible calendar days; compare the date before applying its offset.
  const date = value.slice(0, 10);
  if (new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new TypeError(`Invalid ${name}`);
  return new Date(value).toISOString();
}

function redirect(value) {
  const url = new URL(text(value, 'Google redirect URI'));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new TypeError('Invalid Google redirect URI');
  return url.href;
}

async function digest(value) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(data), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function googleCalendarOwnerTag(owner) {
  return digest(text(owner, 'calendar owner', 160));
}

/** Stable IDs make interrupted inserts recoverable without duplicating an activity. */
export async function googleCalendarEventId({ owner, kind, id }) {
  return `vetsa${await digest(JSON.stringify([text(owner, 'calendar owner', 160), text(kind, 'activity kind', 80), text(id, 'activity id', 500)]))}`;
}

/** A private presentation of a scheduled activity; content never grants tools or changes its assignment. */
export async function toGoogleCalendarEvent({ owner, kind, id, agent: assignedAgent, title, startAt, endAt,
  durationMinutes = 15, description = '', recurrence = [], reminderMinutes }) {
  agent(assignedAgent);
  const start = instant(startAt);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) throw new TypeError('Invalid calendar duration');
  const end = endAt === undefined ? new Date(Date.parse(start) + durationMinutes * 60000).toISOString() : instant(endAt);
  if (Date.parse(end) <= Date.parse(start)) throw new TypeError('Calendar end must follow start');
  if (typeof description !== 'string' || description.length > 16000) throw new TypeError('Invalid calendar description');
  if (reminderMinutes !== undefined && (!Number.isInteger(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 40320)) throw new TypeError('Invalid calendar reminder');
  if (!Array.isArray(recurrence) || recurrence.length > 8 || recurrence.some(line => typeof line !== 'string'
    || line.length > 1024 || !/^(?:RRULE|EXRULE|RDATE|EXDATE):[^\r\n]+$/.test(line))) throw new TypeError('Invalid calendar recurrence');
  return {
    id: await googleCalendarEventId({ owner, kind, id }), summary: text(title, 'calendar title', 1024),
    description, start: { dateTime: start, timeZone: DOMINICAN_TIME_ZONE }, end: { dateTime: end, timeZone: DOMINICAN_TIME_ZONE },
    visibility: 'private', reminders: { useDefault: false, ...(reminderMinutes === undefined ? {} : {overrides:[{method:'popup',minutes:reminderMinutes}]}) }, ...(recurrence.length ? { recurrence: [...recurrence] } : {}),
    extendedProperties: { private: { vetsaSchema: '1', vetsaOwner: await googleCalendarOwnerTag(owner),
      vetsaKind: kind, vetsaId: id, vetsaAgent: assignedAgent } },
  };
}

function eventInstant(value) {
  if (!value || typeof value.dateTime !== 'string') return null;
  try {
    if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime)) return instant(value.dateTime);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00)?$/.test(value.dateTime) || !value.timeZone) return null;
    return localDateTimeToUtc(value.dateTime.slice(0, 16), value.timeZone);
  } catch { return null; }
}

/** Existing mapping is required, including for tombstones that contain only the Google ID. */
export function normalizeGoogleCalendarChange(event, mapping) {
  if (!event || typeof event !== 'object' || !mapping || event.id !== mapping.googleEventId
    || typeof mapping.owner !== 'string' || !mapping.owner || !Object.hasOwn(AGENTS, mapping.agent)
    || typeof mapping.kind !== 'string' || !mapping.kind || typeof mapping.id !== 'string' || !mapping.id) return { status: 'ignored' };
  const base = { owner: mapping.owner, kind: mapping.kind, id: mapping.id, agent: mapping.agent,
    googleEventId: event.id, etag: typeof event.etag === 'string' ? event.etag : null,
    updatedAt: typeof event.updated === 'string' ? event.updated : null };
  if (event.status === 'cancelled') return { ...base, status: 'cancelled',
    ...(event.recurringEventId ? { recurringEventId: event.recurringEventId, originalStartAt: eventInstant(event.originalStartTime) } : {}) };
  let startAt = eventInstant(event.start), endAt = eventInstant(event.end);
  const allDay = !event.start?.dateTime && typeof event.start?.date === 'string' && !event.end?.dateTime && typeof event.end?.date === 'string';
  if (allDay) {
    const date = event.start.date;
    const dateAt=/^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
    const nextDate = Number.isFinite(dateAt) ? new Date(dateAt + 86400000).toISOString().slice(0,10) : null;
    // Only a single calendar day has the same meaning as a date-only request.
    // Longer all-day ranges require a scheduling decision by the owner.
    if (nextDate && event.end.date === nextDate) {
      startAt = localDateTimeToUtc(`${date}T09:00`, DOMINICAN_TIME_ZONE);
      endAt = startAt ? new Date(Date.parse(startAt) + 15*60000).toISOString() : null;
    }
  }
  if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) return { ...base, status: 'unsupported', reason: 'timed_event_required' };
  if (typeof event.summary !== 'string' || !event.summary.trim() || event.summary.length > 2048) {
    return { ...base, status: 'unsupported', reason: 'invalid_title' };
  }
  if (event.recurrence !== undefined && (!Array.isArray(event.recurrence) || event.recurrence.length > 8
    || event.recurrence.some(line => typeof line !== 'string' || line.length > 1024 || /[\r\n]/.test(line)))) {
    return { ...base, status: 'unsupported', reason: 'invalid_recurrence' };
  }
  const prefix = `${AGENTS[mapping.agent]}: `;
  const local = clockContext(startAt, DOMINICAN_TIME_ZONE).now_local;
  const weekday = new Date(`${local.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const weekdays = weeklyRecurrenceWeekdays(event.recurrence, weekday);
  return { ...base, status: 'updated', title: event.summary.startsWith(prefix) ? event.summary.slice(prefix.length) : event.summary,
    startAt, endAt, localDateTime: local, weekday, ...(weekdays ? {weekdays} : {}),
    hour: local.slice(11, 16), timeZone: DOMINICAN_TIME_ZONE, recurrence: [...(event.recurrence || [])],
    ...(allDay ? {assumedHour:'09:00',allDay:true} : {}),
    ...(event.recurringEventId ? { recurringEventId: event.recurringEventId, originalStartAt: eventInstant(event.originalStartTime) } : {}) };
}

export function buildGoogleCalendarAuthorizationUrl({ clientId, redirectUri, state, codeChallenge, expectedEmail }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const values = { client_id: text(clientId, 'Google client ID', 512), redirect_uri: redirect(redirectUri), response_type: 'code',
    scope: GOOGLE_CALENDAR_AUTH_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state: text(state, 'Google OAuth state', 2048) };
  if (expectedEmail !== undefined && expectedEmail !== '') {
    if (typeof expectedEmail !== 'string' || expectedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail)) {
      throw new TypeError('Invalid Google account email');
    }
    values.login_hint = expectedEmail;
  }
  if (codeChallenge !== undefined) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new TypeError('Invalid PKCE challenge');
    Object.assign(values, { code_challenge: codeChallenge, code_challenge_method: 'S256' });
  }
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.href;
}

async function readJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new GoogleCalendarError('response_too_large');
  const reader = response.body?.getReader();
  if (!reader) throw new GoogleCalendarError('invalid_response');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new GoogleCalendarError('response_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new GoogleCalendarError('invalid_response'); }
}

async function request(fetcher, url, options, timeoutMs, maxBytes = MAX_RESPONSE_BYTES) {
  if (typeof fetcher !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new TypeError('Invalid Google transport');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const mutation = !['GET', 'HEAD'].includes(options.method || 'GET');
  try {
    // workerd accepts follow/manual, but rejects redirect:error before I/O.
    // Return redirects without following them, then reject them explicitly.
    const response = await fetcher(url, { ...options, signal: controller.signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) throw new GoogleCalendarError('redirect_rejected', { status: response.status });
    if (response.status === 204) return null;
    let value;
    try { value = await readJson(response, maxBytes); }
    catch (error) {
      if (response.ok) throw error;
      value = {};
    }
    if (!response.ok) {
      const reason = value.error?.errors?.[0]?.reason;
      const retryable = response.status === 429 || response.status >= 500
        || (response.status === 403 && ['rateLimitExceeded', 'userRateLimitExceeded', 'backendError'].includes(reason));
      const code = response.status === 401 || value.error === 'invalid_grant' ? 'authorization_required'
        : response.status === 410 ? 'sync_token_expired' : response.status === 412 ? 'conflict'
        : response.status === 409 ? 'already_exists' : response.status === 404 ? 'not_found'
        : retryable ? 'temporarily_unavailable' : 'provider_rejected';
      throw new GoogleCalendarError(code, { status: response.status, retryable });
    }
    return value;
  } catch (error) {
    if (error instanceof GoogleCalendarError) {
      if (mutation && !error.status) error.uncertain = true;
      throw error;
    }
    throw new GoogleCalendarError(controller.signal.aborted ? 'request_timeout' : 'network_error', { retryable: true, uncertain: mutation });
  } finally { clearTimeout(timer); }
}

export async function exchangeGoogleCalendarCode({ clientId, clientSecret, redirectUri, code, codeVerifier,
  fetch: fetcher = globalThis.fetch, timeoutMs = 15000 }) {
  const body = new URLSearchParams({ client_id: text(clientId, 'Google client ID', 512), client_secret: text(clientSecret, 'Google client secret', 1024),
    redirect_uri: redirect(redirectUri), code: text(code, 'Google OAuth code', 4096), grant_type: 'authorization_code' });
  if (codeVerifier !== undefined) {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) throw new TypeError('Invalid PKCE verifier');
    body.set('code_verifier', codeVerifier);
  }
  return request(fetcher, 'https://oauth2.googleapis.com/token', { method: 'POST', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' } }, timeoutMs, 65536);
}

export async function refreshGoogleCalendarToken({ clientId, clientSecret, refreshToken, fetch: fetcher = globalThis.fetch, timeoutMs = 15000 }) {
  return request(fetcher, 'https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: text(clientId, 'Google client ID', 512), client_secret: text(clientSecret, 'Google client secret', 1024),
      refresh_token: text(refreshToken, 'Google refresh token', 8192), grant_type: 'refresh_token' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' } }, timeoutMs, 65536);
}

/** No retry of mutations here: the sync coordinator owns durable receipts and conflict resolution. */
export function createGoogleCalendarClient({ accessToken, fetch: fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof accessToken !== 'function') text(accessToken, 'Google access token', 8192);
  async function call(path, { method = 'GET', body, etag, query } = {}) {
    const url = new URL(`${API}${path}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined) url.searchParams.set(key, String(value));
    const headers = { authorization: `Bearer ${text(typeof accessToken === 'function' ? await accessToken() : accessToken, 'Google access token', 8192)}` };
    if (etag !== undefined) headers['if-match'] = text(etag, 'Google event ETag', 2048);
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(body);
      if (new TextEncoder().encode(body).length > 131072) throw new TypeError('Google request too large');
    }
    return request(fetcher, url.href, { method, headers, ...(body === undefined ? {} : { body }) }, timeoutMs);
  }
  const calendarPath = value => `/calendars/${encodeURIComponent(text(value, 'Google calendar ID', 1024))}`;
  const eventPath = (calendarId, eventId) => `${calendarPath(calendarId)}/events/${encodeURIComponent(text(eventId, 'Google event ID', 1024))}`;
  return Object.freeze({
    createCalendar: ({ summary = 'Brivany · Melodi', description = 'Actividades programadas con Melodi en Brivany.' } = {}) => call('/calendars',
      { method: 'POST', body: { summary: text(summary, 'Google calendar name', 1024), description: text(description, 'Google calendar description', 4096), timeZone: DOMINICAN_TIME_ZONE } }),
    getCalendar: calendarId => call(calendarPath(calendarId)),
    listEvents: (calendarId, { syncToken, pageToken, maxResults = 100 } = {}) => {
      if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 2500) throw new TypeError('Invalid Google page size');
      if (syncToken !== undefined) text(syncToken, 'Google sync token', 8192);
      if (pageToken !== undefined) text(pageToken, 'Google page token', 8192);
      return call(`${calendarPath(calendarId)}/events`, { query: { singleEvents: false, showDeleted: true,
        timeZone: DOMINICAN_TIME_ZONE, maxResults, syncToken, pageToken } });
    },
    getEvent: (calendarId, eventId) => call(eventPath(calendarId, eventId)),
    insertEvent: (calendarId, event) => call(`${calendarPath(calendarId)}/events`, { method: 'POST', body: event, query: { sendUpdates: 'none' } }),
    updateEvent: (calendarId, eventId, event, { etag } = {}) => {
      text(etag, 'Google event ETag', 2048);
      return call(eventPath(calendarId, eventId), { method: 'PUT', body: event, etag, query: { sendUpdates: 'none' } });
    },
    deleteEvent: (calendarId, eventId, { etag } = {}) => {
      text(etag, 'Google event ETag', 2048);
      return call(eventPath(calendarId, eventId), { method: 'DELETE', etag, query: { sendUpdates: 'none' } });
    },
  });
}
