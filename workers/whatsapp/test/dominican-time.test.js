import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clockContext, explicitReminderTime, localEventTime } from '../event-time.js';
import { interpretOwnerIntent, resolveReminderDesktopBoundary } from '../owner-features.js';
import worker from '../worker.js';
import { reportRequest } from '../cognira-reports.js';

const require = createRequire(import.meta.url);
let nodeTime, mirrorTime;
try { nodeTime = require('../../functions/timeService.js'); mirrorTime = require('../../src/functions/timeService.js'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const screenshotNow = '2026-10-08T01:18:00Z'; // October 7, 9:18 p.m. in RD.

test('the clock carries the Dominican date after UTC midnight', () => {
  const clock = clockContext(screenshotNow);
  assert.equal(clock.now, '2026-10-07T21:18-04:00');
  assert.equal(clock.today_local, '2026-10-07');
  assert.equal(clock.now_utc, '2026-10-08T01:18:00.000Z');
  assert.equal(clockContext(screenshotNow, 'Asia/Tokyo').now, '2026-10-08T10:18+09:00');
});

const cases = [
  ['hoy a las 10:00 p.m.', screenshotNow, '2026-10-08T02:00:00.000Z'],
  ['a las 10', '2026-10-07T15:00:00Z', '2026-10-08T02:00:00.000Z'],
  ['a las 10', '2026-10-07T13:00:00Z', '2026-10-07T14:00:00.000Z'],
  ['a las 10', '2026-10-08T03:00:00Z', '2026-10-08T14:00:00.000Z'],
  ['a las 10', '2026-10-07T14:00:00Z', '2026-10-08T02:00:00.000Z'],
  ['hoy a las 10', '2026-10-08T03:00:00Z', null],
  ['a las 10 a.m.', screenshotNow, null],
  ['mañana a las 10 a.m.', screenshotNow, '2026-10-08T14:00:00.000Z'],
  ['mañana a las 10', screenshotNow, '2026-10-08T14:00:00.000Z'],
  ['pasado mañana a las 10 p.m.', screenshotNow, '2026-10-10T02:00:00.000Z'],
  ['a las 12 a.m.', '2026-10-07T03:00:00Z', null],
  ['mañana a las 12 a.m.', screenshotNow, '2026-10-08T04:00:00.000Z'],
  ['hoy a las 12 p.m.', '2026-10-07T15:00:00Z', '2026-10-07T16:00:00.000Z'],
  ['a las 12', screenshotNow, '2026-10-08T04:00:00.000Z'],
  ['el 2027-01-01 a las 10 p.m.', screenshotNow, '2027-01-02T02:00:00.000Z'],
  ['el 2026-02-30 a las 10 p.m.', screenshotNow, null],
  ['hoy a las 25:00', screenshotNow, null],
  ['hoy a las 13 p.m.', screenshotNow, null],
  ['hoy a las 10:60 p.m.', screenshotNow, null],
];
for (const [text, now, expected] of cases) {
  test(`Worker: ${text} at ${now}`, () => {
    assert.equal(explicitReminderTime(text, now)?.eventAt, expected);
  });
  test(`Both Node deployments: ${text} at ${now}`, { skip: !nodeTime && 'Install the root dependencies to test the Node deployments' }, () => {
    assert.equal(nodeTime.resolveRequestedTime(text, now), expected);
    assert.equal(mirrorTime.resolveRequestedTime(text, now), expected);
  });
}

test('screenshot request survives wrong UTC date, stale AI time and clarification', async () => {
  const requests = [];
  const env = { TIME_ZONE: 'America/Santo_Domingo', VETSA_INTELLIGENCE: { async fetch(req) {
    requests.push(await req.json());
    return Response.json({ text: JSON.stringify({ intent: 'create_reminder', category: 'reminder',
      title: 'corregir las conexiones remotas en Cognira Desktop', local_datetime: '2026-10-07T10:00',
      date_basis: 'unknown', delay_minutes: 10, clarification: 'Esa hora ya pasó.' }) });
  } } };
  const text = 'Recuérdame corregir las conexiones remotas en Cognira Desktop hoy a las 10:00 p.m.';
  const intent = await interpretOwnerIntent(env, text, { now: screenshotNow });
  const boundary = await resolveReminderDesktopBoundary(env, text, { now: screenshotNow });
  assert.equal(intent.eventAt, '2026-10-08T02:00:00.000Z');
  assert.equal(intent.delayMinutes, null);
  assert.equal(boundary.eventAt, intent.eventAt);
  assert.equal(boundary.clarification, '');
  assert.equal(boundary.delayMinutes, null);
  for (const req of requests) assert.equal(JSON.parse(req.contents).today_local, '2026-10-07');
  assert.match(localEventTime(intent.eventAt), /10:00 p\. m\./);
});

test('calendar API converts a wall time and rejects invalid/past dates', async () => {
  let stored;
  const env = { TIME_ZONE: 'America/Santo_Domingo', VETSA_CLOUD: { prepare(sql) { return { bind(...args) {
    return { first: async () => ({ phone: 'owner' }), run: async () => { stored = args; } };
  } }; } } };
  const post = dateTime => worker.fetch(new Request('https://ia.vetsa.es/api/calendar/events', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-calendar-token': 'token' },
    body: JSON.stringify({ title: 'Revisar', dateTime, type: 'REMINDER' }),
  }), env, { waitUntil() {} });
  assert.equal((await post('2099-10-07T22:00')).status, 200);
  assert.equal(stored[3], '2099-10-08T02:00:00.000Z');
  assert.equal((await post('2099-02-30T22:00')).status, 400);
  assert.equal((await post('2020-01-01T22:00')).status, 400);
});

test('calendar groups and displays events by RD date even in another host timezone', () => {
  const html = readFileSync(new URL('../../public/calendar.html', import.meta.url), 'utf8').replace(/\r\n/g,'\n');
  const parts = html.match(/function localParts[\s\S]*?\n}\n/)[0];
  const grouping = html.match(/function getEventsForDay[\s\S]*?\n}\n/)[0];
  const context = vm.createContext({ Intl, Date, events: [{ time: '2026-10-08T02:00:00Z' }] });
  vm.runInContext(`const CALENDAR_ZONE='America/Santo_Domingo';${parts}${grouping}`, context);
  assert.equal(vm.runInContext('getEventsForDay(2026,9,7).length', context), 1);
  assert.equal(vm.runInContext('getEventsForDay(2026,9,8).length', context), 0);
});

test('one-time reports with an explicit missed time do not silently move to tomorrow', () => {
  assert.equal(reportRequest('Reporte Cognira hoy a las 10 p.m.', new Date('2026-10-08T03:00:00Z')).clarify, true);
});

test('the owner interpreter and boundary choose 10 p.m. at 11 a.m. without asking', async () => {
  const env = { TIME_ZONE: 'America/Santo_Domingo', VETSA_INTELLIGENCE: { async fetch() {
    return Response.json({ text: JSON.stringify({ intent: 'create_reminder', category: 'reminder',
      title: 'completar las tareas pendientes', clarification: '¿AM o PM?', date_basis: 'unknown' }) });
  } } };
  const message = 'Recuérdame a las 10 completar las tareas pendientes';
  const now = '2026-10-07T15:00:00Z';
  const intent = await interpretOwnerIntent(env, message, { now });
  const boundary = await resolveReminderDesktopBoundary(env, message, { now });
  assert.equal(intent.eventAt, '2026-10-08T02:00:00.000Z');
  assert.equal(boundary.eventAt, intent.eventAt);
  assert.equal(boundary.clarification, '');
  const report = reportRequest('Reporte Cognira a las 10', new Date(now));
  assert.equal(report.schedules[0].at, intent.eventAt);
  assert.equal(report.schedules[0].hour, '22:00');
});

test('the second WhatsApp screenshot schedules tomorrow at 10 am despite a stale AI date', async () => {
  const env = { TIME_ZONE: 'America/Santo_Domingo', VETSA_INTELLIGENCE: { async fetch() {
    return Response.json({ text: JSON.stringify({ intent: 'create_reminder', category: 'reminder',
      title: 'implementar nuevas funcionalidades a los sistemas de Vetsa',
      local_datetime: '2026-10-07T10:00', date_basis: 'unknown',
      clarification: 'Esa hora ya pasó o falta la fecha. ¿Para qué día y hora quieres que te lo recuerde?' }) });
  } } };
  const text = 'Recuérdame mañana a las 10 am que debo implementar nuevas funcionalidades a los sistemas de Vetsa';
  const now = '2026-10-08T01:30:00Z';
  const intent = await interpretOwnerIntent(env, text, { now });
  const boundary = await resolveReminderDesktopBoundary(env, text, { now });
  assert.equal(intent.eventAt, '2026-10-08T14:00:00.000Z');
  assert.equal(boundary.eventAt, intent.eventAt);
  assert.equal(boundary.clarification, '');
});
