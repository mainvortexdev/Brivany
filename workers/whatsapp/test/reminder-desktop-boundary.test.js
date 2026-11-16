import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOwnerMessage, resolveReminderDesktopBoundary } from '../owner-features.js';

function fakeOwnerDb(device = null) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM stacy_devices')) return device;
              if (sql.includes('FROM wa_melodi_state')) return { active_agent: 'melodi' };
              return null;
            },
            async all() { return { results: [] }; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
}

function fakeIntelligence(primaryIntent, boundaryDecision) {
  const requests = [];
  return {
    requests,
    async fetch(request) {
      const body = await request.json();
      requests.push(body);
      const boundary = body.options.systemPrompt.includes('Verifica el límite entre calendario y control remoto');
      return Response.json({
        provider: 'SiliconFlow',
        text: JSON.stringify(boundary ? boundaryDecision : primaryIntent),
      });
    },
  };
}

test('a past local reminder time asks for a date instead of becoming a PC command', async () => {
  const intelligence = fakeIntelligence({}, {
    category: 'reminder', title: 'Continuar la configuración de Cognira Desktop',
    local_datetime: '2026-09-27T16:17', delay_minutes: null,
  });
  const result = await resolveReminderDesktopBoundary({
    TIME_ZONE: 'America/Santo_Domingo', VETSA_INTELLIGENCE: intelligence,
  }, 'Recuérdame a las 4:17 p.m. continuar la configuración de Cognira Desktop', {
    now: '2026-09-27T20:32:00.000Z', proposedIntent: 'stacy_command',
  });
  assert.equal(intelligence.requests[0].model, 'spaik-flash');
  assert.match(intelligence.requests[0].options.systemPrompt, /no por el tema, proyecto o aplicación/);
  assert.equal(result.category, 'reminder');
  assert.equal(result.eventAt, null);
  assert.match(result.clarification, /qué día y hora/i);
});

test('a model cannot silently move an unspecified missed time to tomorrow', async () => {
  const intelligence = fakeIntelligence({}, {
    category: 'reminder', title: 'Continuar la configuración de Cognira Desktop',
    local_datetime: '2026-09-28T16:17', date_basis: 'same_day',
  });
  const result = await resolveReminderDesktopBoundary({
    TIME_ZONE: 'America/Santo_Domingo', VETSA_INTELLIGENCE: intelligence,
  }, 'Recuérdame a las 4:17 p.m. continuar la configuración de Cognira Desktop', {
    now: '2026-09-27T20:32:00.000Z', proposedIntent: 'create_reminder',
  });
  assert.equal(result.eventAt, null);
  assert.match(result.clarification, /qué día y hora/i);
});

for (const primaryIntent of ['stacy_command', 'chat']) {
  test(`a reminder mentioning Cognira is saved even when the main router says ${primaryIntent}`, async () => {
    const intelligence = fakeIntelligence(
      { intent: primaryIntent, agent: primaryIntent === 'chat' ? 'melodi' : 'melodi' },
      { category: 'reminder', title: 'Continuar la configuración de Cognira Desktop', delay_minutes: 15 },
    );
    const replies = [];
    const reminders = [];
    const handled = await handleOwnerMessage({
      TIME_ZONE: 'America/Santo_Domingo', VETSA_CLOUD: fakeOwnerDb(), VETSA_INTELLIGENCE: intelligence,
    }, {
      phone: '18495205246', message: { type: 'text' },
      // Keep this scenario on semantic routing; the direct "Recuérdame en…"
      // grammar is covered separately by the fast-path integration tests.
      incoming: 'Dentro de 15 minutos recuérdame continuar la configuración de Cognira Desktop',
      markTyping: async () => {}, sendText: async (_env, _phone, body) => { replies.push(body); },
      addReminder: async (title, eventAt) => { reminders.push({ title, eventAt }); return {id:"reminder-test"}; },
    });
    assert.equal(handled, true);
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].title, 'Continuar la configuración de Cognira Desktop');
    assert.match(replies[0], /te recordaré continuar la configuración de Cognira Desktop/);
    assert.doesNotMatch(replies[0], /No estoy conectada/);
    assert.equal(intelligence.requests.length, 2);
  });
}

test('an explicit desktop action still checks the linked PC', async () => {
  const intelligence = fakeIntelligence(
    { intent: 'stacy_command', agent: 'melodi' },
    { category: 'desktop_command' },
  );
  const replies = [];
  const reminders = [];
  await handleOwnerMessage({
    TIME_ZONE: 'America/Santo_Domingo', VETSA_CLOUD: fakeOwnerDb({ device_name: 'Mi PC', status: 'offline' }),
    VETSA_INTELLIGENCE: intelligence,
  }, {
    phone: '18495205246', message: { type: 'text' }, incoming: 'Melodi, abre el navegador en mi PC ahora',
    markTyping: async () => {}, sendText: async (_env, _phone, body) => { replies.push(body); },
    addReminder: async (...args) => { reminders.push(args); return {id:"reminder-test"}; },
  });
  assert.equal(reminders.length, 0);
  assert.match(replies[0], /No estoy conectada/);
});

test('a missed 4:17 reminder never reaches Melodi or silently rolls to tomorrow', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-08T21:32:00Z') });
  const intelligence = fakeIntelligence(
    { intent: 'stacy_command', agent: 'melodi' },
    { category: 'reminder', title: 'Continuar la configuración de Cognira Desktop', local_datetime: '2020-01-01T16:17' },
  );
  const replies = [];
  const reminders = [];
  await handleOwnerMessage({
    MEMORY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    TIME_ZONE: 'America/Santo_Domingo', VETSA_CLOUD: fakeOwnerDb(), VETSA_INTELLIGENCE: intelligence,
  }, {
    phone: '18495205246', message: { type: 'text' },
    incoming: 'Recuérdame a las 4:17 p.m. continuar la configuración de Cognira Desktop',
    markTyping: async () => {}, sendText: async (_env, _phone, body) => { replies.push(body); },
    addReminder: async (...args) => { reminders.push(args); return {id:"reminder-test"}; },
  });
  assert.equal(reminders.length, 0);
  assert.match(replies[0], /qué día y hora/i);
  assert.doesNotMatch(replies[0], /conectada|Cognira y vuelve/i);
});

test('a desktop action needs agreement from both semantic decisions', async () => {
  const intelligence = fakeIntelligence(
    { intent: 'chat', agent: 'melodi' },
    { category: 'desktop_command' },
  );
  const replies = [];
  await handleOwnerMessage({
    TIME_ZONE: 'America/Santo_Domingo', VETSA_CLOUD: fakeOwnerDb(), VETSA_INTELLIGENCE: intelligence,
  }, {
    phone: '18495205246', message: { type: 'text' }, incoming: 'Cognira Desktop está casi listo',
    markTyping: async () => {}, sendText: async (_env, _phone, body) => { replies.push(body); },
    addReminder: async () => { throw new Error('must not create a reminder'); },
  });
  assert.match(replies[0], /¿Quieres que Melodi actúe/);
  assert.doesNotMatch(replies[0], /No estoy conectada/);
});
