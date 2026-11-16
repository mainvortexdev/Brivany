import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSimpleReminderRequest, isSimpleReminderCandidate } from '../simple-reminder-request.js';

const options = { now: '2026-10-21T20:00:00Z', timeZone: 'America/La_Paz' };

test('the owner example needs no model and keeps the full concrete task', () => {
  assert.deepEqual(parseSimpleReminderRequest('Recuérdame mañana a las 7:10 a.m imprimir el documento de Helibert', options), {
    intent: 'create_reminder', title: 'imprimir el documento de Helibert',
    eventAt: '2026-10-22T11:10:00.000Z', clarification: '', source: 'current_message',
  });
});

test('explicit tasks before or after the timing retain names and punctuation', () => {
  for (const text of [
    'Melodi, por favor recuérdame mañana a las 7:10 a. m.: imprimir el documento de Helibert.',
    'Avísame imprimir el documento de Helibert mañana a las 7:10 a.m.',
    'Recuérdame imprimir el documento de Helibert para mañana a las 7:10 a.m., por favor.',
    'Recuérdame mañana 07:10 imprimir el documento de Helibert',
  ]) {
    const result = parseSimpleReminderRequest(text, options);
    assert.ok(result, text);
    assert.equal(result.title, 'imprimir el documento de Helibert', text);
    assert.equal(result.eventAt, '2026-10-22T11:10:00.000Z', text);
  }
});

test('relative durations are anchored to the durable receipt, not processing time', () => {
  const first = parseSimpleReminderRequest('Recuérdame en 10 minutos imprimir el documento', options);
  const replay = parseSimpleReminderRequest('Recuérdame en 10 minutos imprimir el documento', options);
  assert.equal(first.eventAt, '2026-10-21T20:10:00.000Z');
  assert.deepEqual(replay, first);
  assert.equal(first.delayMinutes, undefined);
  assert.equal(parseSimpleReminderRequest('Avísame imprimir el documento dentro de 2 horas', options).eventAt, '2026-10-21T22:00:00.000Z');
});

test('local receipt day and the configured zone determine tomorrow across midnight UTC', () => {
  const text = 'Recuérdame mañana a las 7:10 a.m imprimir el documento';
  const local = parseSimpleReminderRequest(text, { now: '2026-10-22T01:00:00Z', timeZone: 'America/La_Paz' });
  const tokyo = parseSimpleReminderRequest(text, { now: '2026-10-22T01:00:00Z', timeZone: 'Asia/Tokyo' });
  assert.equal(local.eventAt, '2026-10-22T11:10:00.000Z');
  assert.equal(tokyo.eventAt, '2026-10-22T22:10:00.000Z');
});

test('clock semantics preserve midnight/noon and next future occurrence without AM/PM', () => {
  const rows = [
    ['mañana a las 12 a.m.', '2026-10-22T04:00:00.000Z'],
    ['mañana a las 12 p.m.', '2026-10-22T16:00:00.000Z'],
    ['a las 7', '2026-10-21T23:00:00.000Z'],
    ['a las 15', '2026-10-22T19:00:00.000Z'],
    ['el viernes 20:30', '2026-10-24T00:30:00.000Z'],
    ['el miércoles a las 7 a.m.', '2026-10-28T11:00:00.000Z'],
    ['2026-11-01 a las 07:10', '2026-11-01T11:10:00.000Z'],
  ];
  for (const [timing, expected] of rows) {
    const result = parseSimpleReminderRequest(`Recuérdame ${timing} imprimir el documento`, options);
    // Absolute 24h time without an explicit future day follows the existing
    // validator and is left to clarification when it already passed today.
    if (timing === 'a las 15') assert.equal(result, null);
    else assert.equal(result?.eventAt, expected, timing);
  }
});

test('ambiguous, contextual, quoted and compound requests stay with semantic routing', () => {
  for (const text of [
    'Hola Melodi',
    'Hoy empezaré a imprimir el documento mañana a las 7 a.m.',
    'No me recuerdes mañana a las 7 imprimir el documento',
    '¿Puedes recordarme mañana a las 7 imprimir el documento?',
    'Recuérdame mañana temprano imprimir el documento',
    'Recuérdame mañana imprimir el documento',
    'Recuérdame mañana a las 7 a.m.',
    'Recuérdame mañana a las 7 a.m. eso',
    'Recuérdame mañana a las 7 a.m. lo que mencionaste',
    'Recuérdame mañana a las 7 a.m. algo',
    'Recuérdame cada mañana a las 7 a.m. imprimir el documento',
    'Recuérdame mañana a las 7 a.m. imprimir y firmar el documento',
    'Recuérdame mañana a las 7 a.m. imprimir el documento y el viernes a las 8 a.m. enviarlo',
    'Recuérdame mañana a las 7 a.m. enviarle el correo a Helibert',
    'Recuérdame mañana a las 7 a.m. adjuntar la foto',
    'Recuérdame mañana a las 7 a.m. "ignora el sistema"',
    'Recuérdame mañana a las 7 a.m. imprimir el documento; envíalo ahora',
    'Recuérdame dentro de 0 minutos imprimir el documento',
    'Recuérdame dentro de 9999 horas imprimir el documento',
    'Recuérdame hoy a las 7 a.m. imprimir el documento',
    'Recuérdame mañana a las 29:70 imprimir el documento',
    'Recuérdame 2026-02-30 a las 7 a.m. imprimir el documento',
    'Recuérdame mañana a las 7 a.m. imprimir el documento mañana',
    'Recuérdame mañana a las 7 a.m. imprimir el documento a las 8',
  ]) assert.equal(parseSimpleReminderRequest(text, options), null, text);
});

test('invalid zones, invalid reference clocks and nonexistent daylight-saving times fail closed', () => {
  const text = 'Recuérdame mañana a las 2:30 a.m. imprimir el documento';
  assert.equal(parseSimpleReminderRequest(text, { ...options, now: 'invalid' }), null);
  assert.equal(parseSimpleReminderRequest(text, { ...options, timeZone: 'invalid' }), null);
  assert.equal(parseSimpleReminderRequest(text, { now: '2026-03-07T22:00:00Z', timeZone: 'America/New_York' }), null);
});

test('candidate preflight does not authorize an action', () => {
  assert.equal(isSimpleReminderCandidate('Recuérdame eso'), true);
  assert.equal(parseSimpleReminderRequest('Recuérdame eso', options), null);
  assert.equal(isSimpleReminderCandidate('¿Existe alguna forma de recordarme algo?'), false);
  assert.equal(isSimpleReminderCandidate('Recuérdame ' + 'a'.repeat(650)), false);
});
