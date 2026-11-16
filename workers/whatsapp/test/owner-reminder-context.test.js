import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { reminderHasTaskReference, resolveReminderTaskReference, reminderRoutingContext } from '../owner-reminder-context.js';
import { dateOnlyReminderTime, explicitReminderTime } from '../event-time.js';
import { handleOwnerMessage, interpretOwnerIntent, resolveReminderDesktopBoundary } from '../owner-features.js';

const NOW = '2026-10-08T17:05:00.000Z';
const OWNER = '18495205246';
const NEXT_STEP = 'Crear planos 3D a partir de imágenes';
const PROJECT = { id: 'project-cognira', name: 'Cognira Desktop', status: 'in_progress', nextStep: NEXT_STEP };
const PREVIOUS = 'El proyecto Cognira Desktop está en progreso y el siguiente paso es crear planos 3D a partir de imágenes. También hay un evento para reanudar el trabajo fallido de Melodi. ¿Quieres que investigue?';

test('a named project reference uses its real next step and ignores an unrelated failed job', () => {
  const result = resolveReminderTaskReference('Melodi, agenda para el 16 de este mes continuar con eso que mencionas de Cognira Desktop', {
    agent: 'melodi', projects: [PROJECT], recent: [{ role: 'assistant', message: PREVIOUS }],
  });
  assert.equal(result.title, `crear planos 3D a partir de imágenes (${PROJECT.name})`);
  assert.equal(result.projectId, PROJECT.id);
  assert.doesNotMatch(result.title, /Melodi|fallido|eso que/i);
});

test('a bare pronoun in a conversation containing several actions asks one concrete question', () => {
  const result = resolveReminderTaskReference('Melodi, agéndalo para el 16 de este mes', {
    agent: 'melodi', projects: [PROJECT], recent: [{ role: 'assistant', message: PREVIOUS }],
  });
  assert.equal(result.title, undefined);
  assert.match(result.clarification, /^¿Qué tarea concreta/);
  assert.equal((result.clarification.match(/\?/g) || []).length, 1);
});

test('a single labelled action in the selected agent conversation can resolve a pronoun', () => {
  const result = resolveReminderTaskReference('Agéndalo mañana', {
    agent: 'melodi', projects: [], recent: [{ role: 'assistant', message: 'Siguiente paso: Revisar los requisitos de exportación 3D.' }],
  });
  assert.equal(result.title, 'Revisar los requisitos de exportación 3D');
});

test('private conversation of a different agent is never reference evidence', () => {
  const recent = [{ role: 'assistant', agent: 'melodi', message: 'Siguiente paso: PRIVATE_DONA_GOAL.' }];
  const result = resolveReminderTaskReference('Melodi, agéndalo mañana', { agent: 'melodi', recent });
  assert.equal(result.title, undefined);
  assert.deepEqual(reminderRoutingContext({ agent: 'melodi', recent }).own_recent_conversation, []);
});

test('the exact referenced conversation takes priority over a subsequently changed project step', () => {
  const result = resolveReminderTaskReference('Agenda para el 16 de este mes eso que mencionas de Cognira Desktop', {
    agent: 'melodi', projects: [{ ...PROJECT, nextStep: 'Corregir las conexiones remotas' }],
    recent: [{ role: 'assistant', message: PREVIOUS }],
  });
  assert.equal(result.title, 'crear planos 3D a partir de imágenes (Cognira Desktop)');
  assert.equal(result.source, 'own_conversation');
});

test('the reference guard never replaces a concrete task expressly stated by the owner', () => {
  assert.deepEqual(resolveReminderTaskReference('Agenda el 16 de este mes probar la exportación de Cognira Desktop', {
    agent: 'melodi', projects: [PROJECT], recent: [{ role: 'assistant', message: PREVIOUS }],
  }), { requested: false });
});

test('a scheduling pronoun refers to the concrete event supplied in the same message', () => {
  const incoming = 'Mañana a las 7:00 a.m tengo un rodaje, anótalo en mi agenda, para el lunes tengo otro a las 8:00 p.m';
  assert.equal(reminderHasTaskReference(incoming), false);
  assert.deepEqual(resolveReminderTaskReference(incoming, {
    agent: 'melodi', projects: [PROJECT], recent: [{ role: 'assistant', message: PREVIOUS }],
  }), { requested: false });
});

test('a current concrete event takes precedence over a different labelled prior task', () => {
  for (const incoming of [
    'Melodi, mañana tengo una reunión con Ana, prográmalo a las 10',
    'El lunes tendremos un rodaje en el estudio, agéndalo a las 8 p.m.',
    'Anótalo en mi agenda: revisar el contrato mañana a las 9',
  ]) {
    assert.deepEqual(resolveReminderTaskReference(incoming, {
      agent: 'melodi', recent: [{ role: 'assistant', message: 'Siguiente paso: INVESTIGAR_OTRO_PROYECTO.' }],
    }), { requested: false }, incoming);
  }
});

test('an unspecified, negated or reported event does not bypass reference clarification', () => {
  for (const incoming of [
    'Tengo algo pendiente, anótalo mañana',
    'Tengo otra tarea pendiente, anótalo mañana',
    'El lunes tengo otro a las 8 p.m., anótalo',
    'No tengo un rodaje, anótalo mañana',
    'Dijiste que tengo un rodaje, anótalo mañana',
    'Tengo la tarea que mencionaste, anótalo mañana',
    'Anótalo en mi agenda: eso que mencionaste',
  ]) {
    const result = resolveReminderTaskReference(incoming, { agent: 'melodi' });
    assert.equal(result.requested, true, incoming);
    assert.match(result.clarification, /^¿Qué tarea concreta/, incoming);
  }
});

test('date-only scheduling chooses 09 RD from the local month despite stale model midnight', () => {
  assert.deepEqual(dateOnlyReminderTime('para el 16 de este mes', '2020-01-01T00:00', NOW), {
    eventAt: '2026-10-16T13:00:00.000Z', assumedHour: '09:00',
  });
  assert.equal(dateOnlyReminderTime('mañana', '2020-01-01T00:00', '2026-10-08T01:18:00Z').eventAt, '2026-10-08T13:00:00.000Z');
  assert.equal(dateOnlyReminderTime('el 31 de este mes', '', '2026-02-08T15:00:00Z').eventAt, null);
  assert.equal(dateOnlyReminderTime('hoy', '2026-10-08T00:00', NOW).eventAt, null);
});

test('explicit clocks, midnight, dayparts and relative durations are preserved', () => {
  for (const text of ['el 16 de este mes a las 12 a.m.', 'el 16 de este mes a las 4 p.m.', 'mañana temprano', 'mañana por la mañana', 'en 3 horas', 'mañana a esa hora']) {
    assert.equal(dateOnlyReminderTime(text, '2026-10-16T00:00', NOW), undefined, text);
  }
  assert.equal(explicitReminderTime('el 16 de este mes a las 12 a.m.', NOW).eventAt, '2026-10-16T04:00:00.000Z');
  assert.equal(explicitReminderTime('el 16 de este mes a las 10', NOW).eventAt, '2026-10-16T14:00:00.000Z');
  assert.equal(explicitReminderTime('mañana 10AM', NOW).eventAt, '2026-10-09T14:00:00.000Z');
  assert.equal(explicitReminderTime('el 16 de este mes 4:30 PM', NOW).eventAt, '2026-10-16T20:30:00.000Z');
});

class SqliteD1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.reads = []; }
  prepare(query) {
    const database = this;
    const make = values => ({ bind: (...next) => make(next),
      async first() { database.reads.push({ query, values }); return database.sql.prepare(query).get(...values) || null; },
      async all() { database.reads.push({ query, values }); return { results: database.sql.prepare(query).all(...values) }; },
      async run() { return { meta: { changes: database.sql.prepare(query).run(...values).changes } }; },
    });
    return make([]);
  }
}

async function fixture({ projects = [PROJECT], previous = PREVIOUS, wrongEvent = false } = {}) {
  const db = new SqliteD1();
  for (const filename of ['schema.sql', 'story-campaign.sql', 'story-approval.sql', 'melodi-team-coordination.sql']) {
    db.sql.exec(readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'));
  }
  const bytes = new Uint8Array(32).fill(11);
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
  const seal = async value => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
    return [Buffer.from(encrypted).toString('base64'), Buffer.from(iv).toString('base64')];
  };
  for (const project of projects) {
    const [encrypted, iv] = await seal(project);
    db.sql.prepare('INSERT INTO wa_owner_projects VALUES(?,?,?,?,?,?)').run(project.id, OWNER, encrypted, iv, NOW, NOW);
  }
  for (const [owner, agent, message] of [[OWNER, 'melodi', previous], [OWNER, 'melodi', 'Siguiente paso: PRIVATE_DONA_GOAL.'], ['another-owner', 'melodi', 'Siguiente paso: PRIVATE_OTHER_OWNER_GOAL.']]) {
    const [encrypted, iv] = await seal({ recent: [{ role: 'assistant', message, at: NOW }] });
    db.sql.prepare('INSERT INTO wa_melodi_private_context VALUES(?,?,?,?,?)').run(owner, agent, encrypted, iv, NOW);
  }
  db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('failed-melodi-event', OWNER, 'Reanudar el trabajo fallido de Melodi', '2026-10-14T19:00:00.000Z', 'REMINDER', NOW, NOW);
  const replies = [], reminders = [], requests = [];
  const env = { TEAM_AUTONOMY_ENABLED: 'true', TIME_ZONE: 'America/Santo_Domingo', VETSA_CLOUD: db,
    MEMORY_ENCRYPTION_KEY: Buffer.from(bytes).toString('base64'),
    VETSA_INTELLIGENCE: { async fetch(request) {
      const body = await request.json(); requests.push(body);
      const boundary = body.options.systemPrompt.includes('Verifica el límite');
      return Response.json({ text: JSON.stringify({ ...(boundary ? { category: 'reminder', date_basis: 'explicit_future_day' } : { intent: 'create_reminder', agent: 'melodi' }),
        title: wrongEvent ? 'Reanudar el trabajo fallido de Melodi' : 'continuar con eso que mencionas de Cognira Desktop',
        local_datetime: '2026-10-16T00:00', event_id: wrongEvent ? 'failed-melodi-event' : '',
      }) });
    } },
  };
  return { env, db, replies, reminders, requests, send: incoming => handleOwnerMessage(env, { phone: OWNER, incoming,
    message: { id: 'calendar-context-owner-message', type: 'text' }, markTyping: async () => {},
    sendText: async (_env, _phone, body) => replies.push(body),
    addReminder: async (title, eventAt) => { reminders.push({ title, eventAt }); return { id: 'saved-reminder' }; },
    configureTeam: async command => command.action === 'authorize_skill' ? { allowed: true } : null,
  }) };
}

test('the screenshot request saves one concrete action at 09 RD and keeps Melodi context private', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const context = await fixture();
  await context.send('Melodi, agenda para el 16 de este mes continuar con eso que mencionas de Cognira Desktop');
  assert.deepEqual(context.reminders, [{ title: `crear planos 3D a partir de imágenes (${PROJECT.name})`, eventAt: '2026-10-16T13:00:00.000Z' }]);
  assert.match(context.replies.at(-1), /Como no indicaste hora, elegí las 9:00 a\. m\./);
  assert.doesNotMatch(context.replies.at(-1), /12:00|fallido|eso que/);
  assert.doesNotMatch(context.replies[0], /^(?:Melodi|Melodi):/);
  const privateReads = context.db.reads.filter(row => row.query.includes('FROM wa_melodi_private_context'));
  assert.deepEqual(privateReads.map(row => row.values), [[OWNER, 'melodi']]);
  for (const request of context.requests) {
    assert.doesNotMatch(request.contents, /PRIVATE_DONA_GOAL|PRIVATE_OTHER_OWNER_GOAL/);
    assert.match(request.contents, /[Cc]rear planos 3D/);
  }
});

test('a wrong model event ID cannot attach the project reference to another existing reminder', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const context = await fixture({ wrongEvent: true });
  await context.send('Melodi, agenda para el 16 de este mes continuar con eso que mencionas de Cognira Desktop');
  assert.deepEqual(context.reminders, [{ title: `crear planos 3D a partir de imágenes (${PROJECT.name})`, eventAt: '2026-10-16T13:00:00.000Z' }]);
  assert.equal(context.db.sql.prepare('SELECT title FROM melodi_calendar_events WHERE id=?').get('failed-melodi-event').title, 'Reanudar el trabajo fallido de Melodi');
});

test('ambiguous context never persists a generic title or a guessed action', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(NOW) });
  const context = await fixture();
  await context.send('Melodi, agéndalo para el 16 de este mes');
  assert.equal(context.reminders.length, 0);
  assert.match(context.replies.at(-1), /^¿Qué tarea concreta/);
});

test('both semantic calendar decisions independently reject inferred midnight for a day-only request', async () => {
  const context = await fixture();
  const raw = 'Recuérdame probar la exportación de Cognira Desktop el 16 de este mes';
  const intent = await interpretOwnerIntent(context.env, raw, { now: NOW });
  const boundary = await resolveReminderDesktopBoundary(context.env, raw, { now: NOW });
  assert.equal(intent.eventAt, '2026-10-16T13:00:00.000Z');
  assert.equal(boundary.eventAt, intent.eventAt);
});
