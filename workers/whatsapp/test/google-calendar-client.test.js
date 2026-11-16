import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_CALENDAR_SCOPE, GOOGLE_CALENDAR_AUTH_SCOPES, GoogleCalendarError, buildGoogleCalendarAuthorizationUrl,
  exchangeGoogleCalendarCode, refreshGoogleCalendarToken, createGoogleCalendarClient,
  googleCalendarEventId, googleCalendarOwnerTag, toGoogleCalendarEvent, normalizeGoogleCalendarChange } from '../google-calendar-client.js';

const OWNER = '18095550001';
const mapping = { owner: OWNER, kind: 'routine', id: 'routine-1', agent: 'melodi', googleEventId: 'event-1' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const event = (changes = {}) => ({ id: 'event-1', status: 'confirmed', etag: '"v1"', summary: 'Melodi: Informe semanal',
  start: { dateTime: '2026-10-09T09:00:00-04:00', timeZone: 'America/Santo_Domingo' },
  end: { dateTime: '2026-10-09T09:15:00-04:00' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'], ...changes });

test('a screenshot event publishes its full invitation interval and requested two-hour Calendar notice',async()=>{
  const event=await toGoogleCalendarEvent({owner:OWNER,kind:'melodi_calendar_events',id:'screenshot-1',agent:'melodi',title:'Hackathon',
    startAt:'2026-10-26T17:00:00.000Z',endAt:'2026-11-05T02:00:00.000Z',reminderMinutes:120});
  assert.equal(event.start.dateTime,'2026-10-26T17:00:00.000Z'); assert.equal(event.end.dateTime,'2026-11-05T02:00:00.000Z');
  assert.deepEqual(event.reminders,{useDefault:false,overrides:[{method:'popup',minutes:120}]});
  await assert.rejects(toGoogleCalendarEvent({owner:OWNER,kind:'melodi_calendar_events',id:'screenshot-1',agent:'melodi',title:'Hackathon',startAt:'2026-10-26T17:00:00Z',reminderMinutes:-1}),/Invalid calendar reminder/);
});

test('OAuth URL requests the dedicated-calendar scope plus account identity, offline access and consent with PKCE', () => {
  const url = new URL(buildGoogleCalendarAuthorizationUrl({ clientId: 'client.example', redirectUri: 'https://ia.vetsa.es/oauth/google/callback',
    state: 'signed-owner-state', codeChallenge: 'a'.repeat(43), expectedEmail: 'owner@example.com' }));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.deepEqual(url.searchParams.get('scope').split(' '), [GOOGLE_CALENDAR_SCOPE, 'openid', 'email']);
  assert.deepEqual(GOOGLE_CALENDAR_AUTH_SCOPES, [GOOGLE_CALENDAR_SCOPE, 'openid', 'email']);
  assert.equal(url.searchParams.get('login_hint'), 'owner@example.com');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'signed-owner-state');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.throws(() => buildGoogleCalendarAuthorizationUrl({ clientId: 'client', redirectUri: 'http://ia.vetsa.es/callback', state: 's' }));
  assert.throws(() => buildGoogleCalendarAuthorizationUrl({ clientId: 'client', redirectUri: 'https://user:password@ia.vetsa.es/callback', state: 's' }));
  assert.throws(() => buildGoogleCalendarAuthorizationUrl({ clientId: 'client', redirectUri: 'https://ia.vetsa.es/callback', state: 's', expectedEmail: 'a@b.com\r\nInjected' }));
});

test('token exchange and refresh use the fixed OAuth endpoint and URL-encoded bodies without redirects', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return json({ access_token: 'new-access', expires_in: 3600 }); };
  const tokens = await exchangeGoogleCalendarCode({ clientId: 'client', clientSecret: 'secret-for-test',
    redirectUri: 'https://ia.vetsa.es/oauth/google/callback', code: 'one-use-code', codeVerifier: 'v'.repeat(43), fetch: fetcher });
  assert.equal(tokens.access_token, 'new-access');
  await refreshGoogleCalendarToken({ clientId: 'client', clientSecret: 'secret-for-test', refreshToken: 'long-lived-test-token', fetch: fetcher });
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  for (const call of calls) assert.equal(call.options.redirect, 'manual');
  assert.equal(calls[0].options.body.get('grant_type'), 'authorization_code');
  assert.equal(calls[0].options.body.get('code_verifier'), 'v'.repeat(43));
  assert.equal(calls[1].options.body.get('grant_type'), 'refresh_token');
  assert.equal(calls[1].options.body.get('refresh_token'), 'long-lived-test-token');
});

test('revoked refresh grant yields an authorization-required receipt without disclosing provider content', async () => {
  await assert.rejects(refreshGoogleCalendarToken({ clientId: 'client', clientSecret: 's', refreshToken: 'r',
    fetch: async () => json({ error: 'invalid_grant', error_description: 'sensitive-original-value' }, 400) }), error => {
    assert.equal(error.code, 'authorization_required');
    assert.equal(error.status, 400);
    assert.equal(error.retryable, false);
    assert.equal(error.message.includes('sensitive'), false);
    return true;
  });
});

test('OAuth and Calendar transports reject redirects before reading a body or forwarding credentials', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const operation of ['exchange', 'refresh', 'read', 'create']) {
      const calls = [], destination = 'https://foreign.example/credential-target';
      let bodyReads = 0;
      const fetcher = async (url, options) => {
        calls.push({ url, options });
        // Model the dangerous follow behavior instead of relying on a mock
        // transport that silently ignores the redirect option.
        if (options.redirect === 'follow') calls.push({ url: destination, options });
        if (options.redirect === 'error') throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
        return { status, ok: false, headers: new Headers({ location: destination }),
          get body() { bodyReads++; throw new Error('redirect body must not be read'); } };
      };
      const client = createGoogleCalendarClient({ accessToken: 'access-test', fetch: fetcher });
      const action = operation === 'exchange'
        ? () => exchangeGoogleCalendarCode({ clientId: 'client', clientSecret: 'secret-for-test', redirectUri: 'https://ia.vetsa.es/oauth/google/callback', code: 'one-use-code', codeVerifier: 'v'.repeat(43), fetch: fetcher })
        : operation === 'refresh'
          ? () => refreshGoogleCalendarToken({ clientId: 'client', clientSecret: 'secret-for-test', refreshToken: 'refresh-for-test', fetch: fetcher })
          : operation === 'read' ? () => client.getCalendar('team-id') : () => client.createCalendar();
      await assert.rejects(action(), error => {
        assert.ok(error instanceof GoogleCalendarError);
        assert.equal(error.code, 'redirect_rejected'); assert.equal(error.status, status);
        assert.equal(error.retryable, false); assert.equal(error.uncertain, false);
        assert.equal(error.message.includes(destination), false); return true;
      });
      assert.equal(calls.length, 1); assert.equal(calls[0].options.redirect, 'manual');
      assert.equal(calls.some(call => call.url === destination), false); assert.equal(bodyReads, 0);
    }
  }
});

test('stable Google IDs scope the same local activity to its owner and type without plaintext phone numbers', async () => {
  const id = await googleCalendarEventId({ owner: OWNER, kind: 'routine', id: 'routine-1' });
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.equal(id, await googleCalendarEventId({ owner: OWNER, kind: 'routine', id: 'routine-1' }));
  assert.notEqual(id, await googleCalendarEventId({ owner: 'other-owner', kind: 'routine', id: 'routine-1' }));
  assert.notEqual(id, await googleCalendarEventId({ owner: OWNER, kind: 'reminder', id: 'routine-1' }));
  assert.equal(id.includes(OWNER), false);
});

test('all five agent activities are private, timed in RD and keep weekly recurrence', async () => {
  for (const agent of ['melodi']) {
    const result = await toGoogleCalendarEvent({ owner: OWNER, kind: 'routine', id: 'routine-1', agent,
      title: 'Informe semanal', startAt: '2026-10-09T09:00:00-04:00', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'] });
    assert.equal(result.start.dateTime, '2026-10-09T13:00:00.000Z');
    assert.equal(result.start.timeZone, 'America/Santo_Domingo');
    assert.equal(result.end.dateTime, '2026-10-09T13:15:00.000Z');
    assert.equal(result.visibility, 'private');
    assert.equal(result.summary, 'Informe semanal');
    assert.equal(result.extendedProperties.private.vetsaAgent, agent);
    assert.equal(result.extendedProperties.private.vetsaOwner, await googleCalendarOwnerTag(OWNER));
    assert.equal(JSON.stringify(result).includes(OWNER), false);
    assert.deepEqual(result.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=FR']);
  }
  await assert.rejects(toGoogleCalendarEvent({ owner: OWNER, kind: 'reminder', id: '1', agent: 'melodi', title: 'Task', startAt: '2026-02-30T09:00:00Z' }));
  await assert.rejects(toGoogleCalendarEvent({ owner: OWNER, kind: 'reminder', id: '1', agent: 'melodi', title: 'Task', startAt: '2026-10-09T09:00:00' }));
  await assert.rejects(toGoogleCalendarEvent({ owner: OWNER, kind: 'reminder', id: '1', agent: 'melodi', title: 'Task', startAt: '2026-10-09T24:00:00Z' }));
});

test('multi-day weekly Calendar edits expose selected days while retaining the persisted agent',()=>{
  const result=normalizeGoogleCalendarChange(event({summary:'Entrenar boxeo',recurrence:['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']}),mapping);
  assert.equal(result.title,'Entrenar boxeo');assert.equal(result.agent,'melodi');assert.deepEqual(result.weekdays,[1,2,3,4,5]);
  assert.equal(normalizeGoogleCalendarChange(event({recurrence:['RRULE:FREQ=WEEKLY;BYDAY=MO,MO']}),mapping).weekdays,undefined);
});

test('Google edits keep the persisted assignment even if title and private metadata impersonate another agent', () => {
  const result = normalizeGoogleCalendarChange(event({ summary: 'Archivada: Cambiar el informe',
    extendedProperties: { private: { vetsaAgent: 'melodi', vetsaOwner: 'other-owner', vetsaId: 'other-id' } } }), mapping);
  assert.equal(result.agent, 'melodi');
  assert.equal(result.owner, OWNER);
  assert.equal(result.id, 'routine-1');
  assert.equal(result.title, 'Archivada: Cambiar el informe');
  assert.equal(result.hour, '09:00');
  assert.equal(result.weekday, 5);
  assert.equal(result.startAt, '2026-10-09T13:00:00.000Z');
  assert.deepEqual(normalizeGoogleCalendarChange(event(), { ...mapping, googleEventId: 'other' }), { status: 'ignored' });
  assert.deepEqual(normalizeGoogleCalendarChange(event(), null), { status: 'ignored' });
});

test('a bare deletion tombstone cancels its mapped activity and a recurring exception stays distinguishable', () => {
  const cancelled = normalizeGoogleCalendarChange({ id: 'event-1', status: 'cancelled' }, mapping);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.id, 'routine-1');
  const exception = normalizeGoogleCalendarChange({ id: 'event-1', status: 'cancelled', recurringEventId: 'series-1',
    originalStartTime: { dateTime: '2026-10-09T09:00:00-04:00' } }, mapping);
  assert.equal(exception.recurringEventId, 'series-1');
  assert.equal(exception.originalStartAt, '2026-10-09T13:00:00.000Z');
});

test('changed timezone offset is honored while resulting scheduling stays in RD, including external DST', () => {
  const dst = normalizeGoogleCalendarChange(event({ start: { dateTime: '2026-11-02T09:00:00-05:00', timeZone: 'America/New_York' },
    end: { dateTime: '2026-11-02T09:15:00-05:00' } }), mapping);
  assert.equal(dst.startAt, '2026-11-02T14:00:00.000Z');
  assert.equal(dst.hour, '10:00');
  assert.equal(dst.timeZone, 'America/Santo_Domingo');
  const local = normalizeGoogleCalendarChange(event({ start: { dateTime: '2026-10-09T10:00:00', timeZone: 'America/Santo_Domingo' },
    end: { dateTime: '2026-10-09T10:15:00', timeZone: 'America/Santo_Domingo' } }), mapping);
  assert.equal(local.startAt, '2026-10-09T14:00:00.000Z');
});

test('a single all-day date uses the same 09 RD policy while multiday and invalid times remain unsupported', () => {
  const allDay=normalizeGoogleCalendarChange(event({ start: { date: '2026-10-09' }, end: { date: '2026-10-10' } }), mapping);
  assert.equal(allDay.status,'updated');
  assert.equal(allDay.startAt,'2026-10-09T13:00:00.000Z');
  assert.equal(allDay.endAt,'2026-10-09T13:15:00.000Z');
  assert.equal(allDay.assumedHour,'09:00');
  assert.equal(normalizeGoogleCalendarChange(event({ start: { date: '2026-10-09' }, end: { date: '2026-10-11' } }), mapping).status, 'unsupported');
  assert.equal(normalizeGoogleCalendarChange(event({ start: { dateTime: '2026-02-30T10:00:00Z' } }), mapping).status, 'unsupported');
  assert.equal(normalizeGoogleCalendarChange(event({ end: {} }), mapping).status, 'unsupported');
});

test('sync list uses exact same non-filtered parameters across page and incremental requests', async () => {
  const calls = [];
  const client = createGoogleCalendarClient({ accessToken: async () => 'access-test', fetch: async (url, options) => {
    calls.push({ url: new URL(url), options }); return json({ items: [], nextSyncToken: 'next-token' }); } });
  await client.listEvents('team@example.com', { syncToken: 'previous+token', pageToken: 'second/page' });
  const query = calls[0].url.searchParams;
  assert.equal(calls[0].url.pathname, '/calendar/v3/calendars/team%40example.com/events');
  assert.equal(query.get('syncToken'), 'previous+token');
  assert.equal(query.get('pageToken'), 'second/page');
  assert.equal(query.get('singleEvents'), 'false');
  assert.equal(query.get('showDeleted'), 'true');
  for (const name of ['timeMin', 'timeMax', 'q', 'orderBy', 'privateExtendedProperty']) assert.equal(query.has(name), false);
  assert.equal(calls[0].options.headers.authorization, 'Bearer access-test');
});

test('calendar creation and every mutation use fixed endpoints, no invitations and conditional edits', async () => {
  const calls = [];
  const client = createGoogleCalendarClient({ accessToken: 'access-test', fetch: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return options.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ id: 'google-id' }); } });
  await client.createCalendar();
  assert.equal(JSON.parse(calls[0].options.body).timeZone, 'America/Santo_Domingo');
  await client.insertEvent('team-id', event());
  await client.updateEvent('team-id', 'event-1', event(), { etag: '"v1"' });
  assert.equal(await client.deleteEvent('team-id', 'event-1', { etag: '"v2"' }), null);
  for (const item of calls) { assert.equal(item.url.origin, 'https://www.googleapis.com'); assert.equal(item.options.redirect, 'manual'); }
  assert.equal(calls[1].url.searchParams.get('sendUpdates'), 'none');
  assert.equal(calls[2].options.method, 'PUT');
  assert.equal(calls[2].options.headers['if-match'], '"v1"');
  assert.equal(calls[3].options.headers['if-match'], '"v2"');
  assert.throws(() => client.updateEvent('team-id', 'event-1', event()), /ETag/);
  assert.throws(() => client.deleteEvent('team-id', 'event-1'), /ETag/);
});

test('expired sync token, conflicts and provider errors have useful bounded receipts without leaking body', async () => {
  for (const [status, reason, code, retryable] of [[410, '', 'sync_token_expired', false], [412, '', 'conflict', false],
    [409, '', 'already_exists', false], [401, '', 'authorization_required', false], [403, 'forbidden', 'provider_rejected', false],
    [403, 'userRateLimitExceeded', 'temporarily_unavailable', true], [429, '', 'temporarily_unavailable', true], [503, '', 'temporarily_unavailable', true]]) {
    const client = createGoogleCalendarClient({ accessToken: 'access-test', fetch: async () => json({ error: { message: 'secret-provider-value', errors: [{ reason }] } }, status) });
    await assert.rejects(client.getEvent('team', 'event'), error => {
      assert.ok(error instanceof GoogleCalendarError);
      assert.equal(error.code, code); assert.equal(error.status, status); assert.equal(error.retryable, retryable);
      assert.equal(error.message.includes('secret-provider'), false); return true;
    });
  }
});

test('interrupted insert is uncertain and is never automatically repeated', async () => {
  let calls = 0;
  const client = createGoogleCalendarClient({ accessToken: 'a', fetch: async () => { calls++; throw new Error('private-details'); } });
  await assert.rejects(client.insertEvent('team', event()), error => error.code === 'network_error' && error.uncertain === true);
  assert.equal(calls, 1);
  await assert.rejects(client.getEvent('team', 'event'), error => error.uncertain === false);
});

test('response reads enforce stream limits and malformed successful mutations remain uncertain', async () => {
  const oversized = createGoogleCalendarClient({ accessToken: 'a', fetch: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(oversized.getEvent('team', 'event'), error => error.code === 'response_too_large');
  const malformed = createGoogleCalendarClient({ accessToken: 'a', fetch: async () => new Response('not-json') });
  await assert.rejects(malformed.insertEvent('team', event()), error => error.code === 'invalid_response' && error.uncertain);
});
