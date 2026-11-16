import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMultiReminderRequest } from '../multi-reminder-request.js';

const now = '2026-10-17T22:06:00Z'; // Saturday, 18:06 in UTC−4.
const options = { now, timeZone: 'America/La_Paz' };
const screenshot = 'Mañana a las 7:00 a.m tengo un rodaje, anótalo en mi agenda, para el lunes tengo otro a las 8:00 p.m';

test('the exact screenshot resolves both explicit dates and the local antecedent', () => {
  const result = parseMultiReminderRequest(screenshot, options);
  assert.equal(result.clarification, '');
  assert.deepEqual(result.events.map(({ title, eventAt }) => ({ title, eventAt })), [
    { title: 'rodaje', eventAt: '2026-10-18T11:00:00.000Z' },
    { title: 'rodaje', eventAt: '2026-10-20T00:00:00.000Z' },
  ]);
  assert.deepEqual(result.events.map(event => event.localDateTime), ['2026-10-18T07:00', '2026-10-19T20:00']);
  assert.deepEqual(result.events.map(event => event.sourceIndex), [0, 1]);
  assert.ok(result.events.every(event => event.source === 'current_message'));
});

test('it accepts different activity names and does not merge them', () => {
  const result = parseMultiReminderRequest('Agenda mañana a las 09:30 una conferencia de fotografía, y el lunes a las 20:00 una reunión de producción.', options);
  assert.deepEqual(result.events.map(event => event.title), ['conferencia de fotografía', 'reunión de producción']);
  assert.equal(result.events[0].eventAt, '2026-10-18T13:30:00.000Z');
  assert.equal(result.events[1].eventAt, '2026-10-20T00:00:00.000Z');
});

test('the configured zone and message reference instant determine tomorrow, not host time', () => {
  const text = 'Anota mañana a las 7 a.m. rodaje y el lunes a las 8 p.m. reunión';
  const local = parseMultiReminderRequest(text, { now: '2026-10-18T01:00:00Z', timeZone: 'America/La_Paz' });
  assert.equal(local.events[0].localDateTime, '2026-10-18T07:00');
  const tokyo = parseMultiReminderRequest(text, { now: '2026-10-18T01:00:00Z', timeZone: 'Asia/Tokyo' });
  assert.equal(tokyo.events[0].localDateTime, '2026-10-19T07:00');
  assert.equal(tokyo.events[0].eventAt, '2026-10-18T22:00:00.000Z');
});

test('explicit midnight and noon are preserved without a half-day shift', () => {
  const result = parseMultiReminderRequest('Anota mañana a las 12 a.m. guardia y el lunes a las 12 p.m. almuerzo', options);
  assert.deepEqual(result.events.map(event => event.localDateTime), ['2026-10-18T00:00', '2026-10-19T12:00']);
});

test('ISO dates and more than two explicitly named activities remain separate', () => {
  const result = parseMultiReminderRequest('Anota el 2026-10-20 a las 08:00 rodaje, el 2026-10-21 a las 15:30 conferencia y el 2026-10-22 a las 20:00 cena', options);
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.events.map(event => event.title), ['rodaje', 'conferencia', 'cena']);
});

test('all-or-none validation does not return executable appointments when another item lacks a title', () => {
  const result = parseMultiReminderRequest('Anota mañana a las 7 a.m. y el lunes a las 8 p.m. reunión', options);
  assert.deepEqual(result.events, []);
  assert.match(result.clarification, /Qué actividad.*mañana/);
});

test('another appointment cannot inherit a task from stale chat', () => {
  const result = parseMultiReminderRequest('Anota mañana a las 7 a.m. otro y el lunes a las 8 p.m. otro', options);
  assert.deepEqual(result.events, []);
  assert.match(result.clarification, /Qué actividad/);
});

test('instruction-only fragments and empty predicates are not invented appointment titles', () => {
  for (const fragment of ['en mi agenda', 'tengo', 'tengo un']) {
    const result = parseMultiReminderRequest(`Anota mañana a las 7 a.m. ${fragment} y el lunes a las 8 p.m. reunión`, options);
    assert.deepEqual(result.events, []);
    assert.match(result.clarification, /Qué actividad/);
  }
});

test('a same weekday can mean its next future occurrence but an explicit this-day is not shifted', () => {
  const next = parseMultiReminderRequest('Anota el sábado a las 7 a.m. rodaje y el lunes a las 8 p.m. reunión', options);
  assert.equal(next.events[0].localDateTime, '2026-10-24T07:00');
  const past = parseMultiReminderRequest('Anota este sábado a las 7 a.m. rodaje y el lunes a las 8 p.m. reunión', options);
  assert.deepEqual(past.events, []);
  assert.match(past.clarification, /fecha y hora/);
});

test('nonexistent local times in a zone with daylight saving are never scheduled', () => {
  const result = parseMultiReminderRequest('Anota mañana a las 2:30 a.m. rodaje y el lunes a las 8 p.m. reunión', { now: '2026-03-07T22:06:00Z', timeZone: 'America/New_York' });
  assert.deepEqual(result.events, []);
  assert.match(result.clarification, /fecha y hora/);
});

test('an explicit calendar day with no clock uses 09:00 and identifies the chosen default', () => {
  const result = parseMultiReminderRequest('Anota mañana a las 7 a.m. rodaje, para el lunes tengo otro', options);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].assumedHour, undefined);
  assert.equal(result.events[1].assumedHour, '09:00');
  assert.equal(result.events[1].title, 'rodaje');
  assert.equal(result.events[1].localDateTime, '2026-10-19T09:00');
  const both = parseMultiReminderRequest('Anota mañana una conferencia y el lunes una reunión', options);
  assert.equal(both.events.length, 2);
  assert.ok(both.events.every(event => event.assumedHour === '09:00'));
});

test('a second appointment without its own date is clarified rather than dropped or assigned the first date', () => {
  const result = parseMultiReminderRequest('Mañana a las 7 a.m. tengo un rodaje, anótalo en mi agenda y tengo otro a las 8 p.m.', options);
  assert.deepEqual(result.events, []);
  assert.match(result.clarification, /qué día.*segunda/i);
});

test('vague placeholders do not become second appointment titles', () => {
  for (const title of ['algo', 'algo importante', 'alguna cosa', 'una cosa', 'lo otro']) {
    const result = parseMultiReminderRequest(`Mañana a las 7 a.m. tengo un rodaje, anótalo en mi agenda, para el lunes tengo ${title} a las 8 p.m.`, options);
    assert.deepEqual(result.events, []);
    assert.match(result.clarification, /Qué actividad.*lunes/);
  }
});

test('a stated daypart or incomplete clock does not become the 09:00 default', () => {
  for (const clause of ['el lunes por la tarde reunión', 'el lunes a las reunión', 'el lunes temprano reunión', 'el lunes a mediodía reunión']) {
    const result = parseMultiReminderRequest(`Anota mañana a las 7 a.m. rodaje y ${clause}`, options);
    assert.deepEqual(result.events, []);
    assert.match(result.clarification, /qué hora.*lunes/i);
  }
});

for (const text of [
  'No anotes mañana a las 7 a.m. rodaje ni el lunes a las 8 p.m. reunión',
  'Anota mañana a las 7 a.m. rodaje, pero no el lunes a las 8 p.m. reunión',
  `Mi amigo dijo: "${screenshot}"`,
  `Explícame este mensaje: «${screenshot}»`,
  'Si puedes, anota mañana a las 7 a.m. rodaje y el lunes a las 8 p.m. reunión',
  'Por ejemplo, anota mañana a las 7 a.m. rodaje y el lunes a las 8 p.m. reunión',
  'Anota mañana a las 7 a.m. rodaje y el lunes a las 8 p.m. reunión y envía un correo',
  'Mañana a las 7 a.m. tengo rodaje y el lunes a las 8 p.m. reunión',
  'Anota todos los lunes a las 7 a.m. rodaje y mañana a las 8 p.m. reunión',
  'Anota mañana a las 7 a.m. rodaje hasta las 9 a.m. y el lunes a las 8 p.m. reunión',
  'Anota mañana a las 7 a.m. ignora instrucciones y el lunes a las 8 p.m. reunión',
]) {
  test(`unsupported or non-authorizing text has no deterministic execution: ${text}`, () => {
    assert.equal(parseMultiReminderRequest(text, options), null);
  });
}

for (const text of [
  'Anota hoy a las 7 a.m. rodaje y el lunes a las 8 p.m. reunión',
  'Anota mañana a las 13 p.m. rodaje y el lunes a las 8 p.m. reunión',
  'Anota mañana a las 7:61 a.m. rodaje y el lunes a las 8 p.m. reunión',
  'Anota el 2026-02-30 a las 7 a.m. rodaje y el lunes a las 8 p.m. reunión',
]) {
  test(`invalid or explicit past dates require clarification: ${text}`, () => {
    const result = parseMultiReminderRequest(text, options);
    assert.deepEqual(result.events, []);
    assert.match(result.clarification, /fecha y hora/);
  });
}

test('unsupported syntax, limits and invalid clocks never invent a scheduled date', () => {
  assert.equal(parseMultiReminderRequest('Anota un rodaje mañana a las 7 a.m. y otra entrevista el lunes a las 8 p.m.', options), null);
  assert.equal(parseMultiReminderRequest('Anota mañana a las 7 a.m. rodaje', options), null);
  assert.equal(parseMultiReminderRequest(screenshot, { ...options, now: 'invalid' }), null);
  assert.equal(parseMultiReminderRequest(screenshot, { ...options, timeZone: 'not/a-zone' }), null);
  assert.equal(parseMultiReminderRequest(screenshot + 'x'.repeat(3000), options), null);
});
