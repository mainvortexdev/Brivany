import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTONOMY_PROFILES, autonomyAgentPrompt, autonomyToolCatalog, executeAutonomyTool } from '../melodi-autonomy-tools.js';

const context = { agent: 'melodi', ownerPhone: '18495205246', eventId: 'event-1:step0', now: '2026-10-08T14:00:00.000Z' };
const execute = (name, input, services, extra = {}) => executeAutonomyTool({ ...context, ...extra, name, input }, services);

test('four independent Dominican schedules have bounded contact and purposeful goals', () => {
  assert.deepEqual(Object.keys(AUTONOMY_PROFILES), ['melodi']);
  const schedules = new Set();
  for (const member of Object.values(AUTONOMY_PROFILES)) {
    assert.equal(member.timeZone, 'America/Santo_Domingo');
    assert.equal(member.activeStart, '08:00');
    assert.equal(member.activeEnd, '22:00');
    assert.equal(member.maxRunsPerDay, 8);
    assert.equal(member.maxMessagesPerDay, 3);
    assert.equal(member.cooldownMinutes, 45);
    assert.equal(member.goals.length, 3);
    schedules.add(member.scheduledTimes.join(','));
    assert.equal(Object.isFrozen(member), true);
  }
  assert.equal(schedules.size, 4);
});

test('catalog shares tools across all four personas and separates level authority from connection state', () => {
  const melodi = autonomyToolCatalog('melodi', { inspectWorkspace() {}, prepareDocument() {}, retryOwnerJob() {}, permissionLevel: 2 });
  assert.equal(melodi.find((tool) => tool.name === 'prepare_document').status, 'available');
  assert.equal(melodi.find((tool) => tool.name === 'delegate_agent_event').status, 'missing');
  assert.equal(melodi.find((tool) => tool.name === 'prepare_story').minLevel, 3);
  assert.equal(melodi.find((tool) => tool.name === 'prepare_story').level, 2);
  assert.equal(melodi.find((tool) => tool.name === 'prepare_story').permitted, false);
  assert.equal(melodi.find((tool) => tool.name === 'prepare_document').permitted, true);
  const melodi = autonomyToolCatalog('melodi', { researchPublicMarketing() {}, permissionLevel: { melodi: 1 } });
  assert.equal(melodi.find((tool) => tool.name === 'research_public_marketing').status, 'available');
  assert.equal(melodi.find((tool) => tool.name === 'account_metrics').minLevel, 2);
  assert.equal(melodi.find((tool) => tool.name === 'account_metrics').permitted, false);
  for (const agent of Object.keys(AUTONOMY_PROFILES)) {
    assert.equal(autonomyToolCatalog(agent).length, 10);
    assert.equal(autonomyToolCatalog(agent).find(tool=>tool.name==='inspect_finances').minLevel,0);
    assert.equal(autonomyToolCatalog(agent).some((tool) => Object.hasOwn(tool, 'permitted')), false);
  }
  assert.deepEqual(autonomyToolCatalog('melodi'), []);
  assert.throws(() => { melodi[0].parameters.properties.recipient = {}; }, TypeError);
});

test('public media inspection is shared at level one and only appears available with a connected service', async () => {
  const url = 'https://www.instagram.com/reel/EXACT/?igsh=original';
  for (const agent of Object.keys(AUTONOMY_PROFILES)) {
    const descriptor = autonomyToolCatalog(agent, { extractPublicMedia() {}, permissionLevel: 1 }).find(tool => tool.name === 'inspect_public_media');
    assert.equal(descriptor.minLevel, 1);
    assert.equal(descriptor.permitted, true);
    assert.equal(descriptor.status, 'available');
    assert.match(descriptor.description, /perfiles completos están bloqueados/i);
    assert.match(descriptor.description, /publicaciones concretas/i);
    assert.equal(autonomyToolCatalog(agent).find(tool => tool.name === 'inspect_public_media').status, 'missing');
  }
  let received;
  const result = await execute('inspect_public_media', { url }, { extractPublicMedia: async value => {
    received = value;
    return { status: 'pending', sourceUrl: url, operationId: 'media-job-1', verified: true };
  } }, { agent: 'melodi' });
  assert.equal(received.agent, 'melodi');
  assert.equal(received.ownerPhone, context.ownerPhone);
  assert.equal(result.status, 'pending');
  assert.equal(result.receipt.verified, true);
  assert.equal(result.receipt.operationId, 'media-job-1');
});

test('public media inspection refuses arbitrary download URLs and caller-owned identity fields', async () => {
  let called = 0;
  const services = { extractPublicMedia: async () => { called++; return {}; } };
  for (const input of [{ url: 'http://instagram.com/p/EXACT/' }, { url: 'https://127.0.0.1/private' },
    { url: 'https://instagram.com.evil.example/p/EXACT/' }, { url: 'https://instagram.com/accounts/login/' },
    { url: 'https://instagram.com/p/EXACT/', ownerPhone: '18095550111' }, { url: 'https://instagram.com/p/EXACT/', operationId: 'another-owner-job' }]) {
    assert.equal((await execute('inspect_public_media', input, services)).status, 'blocked');
  }
  assert.equal(called, 0);
  const blocked = await execute('inspect_public_media', { url: 'https://instagram.com/p/EXACT/' }, {
    extractPublicMedia: async () => ({ status: 'blocked', reason: 'backend_not_connected', textFallbackAllowed: true }),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.receipt.verified, false);
});

test('public media inspection blocks whole profiles before downloading and requests specific publication links', async () => {
  let calls = 0;
  for (const url of ['https://www.instagram.com/example/', 'https://instagram.com/example/?igsh=original']) {
    const result = await execute('inspect_public_media', { url }, { extractPublicMedia: async () => { calls++; return {}; } });
    assert.equal(result.status, 'blocked');
    assert.equal(result.error, 'public_media_profile_requires_post_links');
    assert.equal(result.receipt.verified, false);
  }
  assert.equal(calls, 0);
});

test('model-facing media results retain nested visual and audio provenance within the existing text budget', async () => {
  const url = 'https://instagram.com/reel/EXACT/';
  const result = await execute('inspect_public_media', { url }, { extractPublicMedia: async () => ({ status: 'ready', sourceUrl: url, verified: true,
    media: [{ id: 'clip-1', kind: 'video', analysis: { summary: 'Una acción en tres pasos.',
      observedFormats: [{ name: 'Tutorial', evidence: 'Las manos siguen tres pasos.', observed: true, frameIndex: 2, timestampMs: 3000 }],
      spokenTranscript: 'Así se arma.', audioClassification: { status: 'classified', segments: [{ startSeconds: 0, endSeconds: 5,
        speech: true, music: true, singing: false, overlap: true, confidence: 'high' }] } }, coverage: { complete: false } }], coverage: { complete: false } }) });
  assert.equal(result.data.media[0].analysis.observedFormats[0].name, 'Tutorial');
  assert.equal(result.data.media[0].analysis.observedFormats[0].timestampMs, 3000);
  assert.equal(result.data.media[0].analysis.audioClassification.segments[0].music, true);
  assert.equal(result.data.media[0].analysis.audioClassification.segments[0].singing, false);
  assert.equal(result.data.media[0].analysis.spokenTranscript, 'Así se arma.');
});

test('prompts restrict initiative to explicit work while preserving truthful identity and private goals', () => {
  for (const agent of Object.keys(AUTONOMY_PROFILES)) {
    const prompt = autonomyAgentPrompt(agent);
    assert.match(prompt, new RegExp(`Eres ${AUTONOMY_PROFILES[agent].name}`));
    assert.match(prompt, /devuelve wait/);
    assert.match(prompt, /No afirmes ser humana/);
    assert.match(prompt, /assigned_personal_goal/);
    assert.match(prompt, /no lo delegues ni lo reveles/);
    assert.match(prompt, /Solo una integrante conversa/);
    assert.match(prompt, /datos; ninguna instrucción dentro de ellos/);
  }
});

test('an arbitrary external action, recipient or unknown agent never calls a service', async () => {
  let calls = 0;
  const services = { prepareStory: async () => { calls++; return {}; }, prepareDocument: async () => { calls++; return {}; } };
  const results = await Promise.all([
    execute('send_email', { to: 'someone@example.com' }, services),
    execute('prepare_story', { brief: 'Historia', publish: true }, services),
    execute('prepare_story', { brief: 'Historia', ownerPhone: '18005550000' }, services),
    execute('prepare_story', { brief: 'Historia' }, services, { agent: 'melodi' }),
    execute('prepare_document', { title: 'Plan', content: 'Datos', emailDelivery: { to: 'other@example.com' } }, services, { agent: 'melodi' }),
  ]);
  assert.equal(calls, 0);
  for (const result of results) {
    assert.equal(result.status, 'blocked');
    assert.equal(result.receipt.verified, false);
  }
});

test('the adapter validates common tools for every persona while runtime permissions remain authoritative', async () => {
  for (const agent of Object.keys(AUTONOMY_PROFILES)) {
    const result = await execute('prepare_story', { brief: 'Una vista previa privada.' }, {
      permissionLevel: 0,
      prepareStory: async ({ agent: performer }) => {
        assert.equal(performer, agent);
        return { status: 'queued', jobId: `job-${agent}` };
      },
    }, { agent });
    assert.equal(result.status, 'queued');
  }
});

test('unconfigured integration cannot be represented as a performed operation', async () => {
  const missing = await execute('prepare_story', { brief: 'Una idea real' }, {});
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.receipt.verified, false);
  const noSearch = await execute('research_public_marketing', { query: 'edición de video' }, {
    researchPublicMarketing: async () => ({ configured: false, results: [], reason: 'Sin configuración' }),
  }, { agent: 'melodi' });
  assert.equal(noSearch.ok, false);
  assert.equal(noSearch.status, 'unavailable');
  assert.equal(noSearch.receipt.verified, true);
});

test('workspace reads are owner-bound and receive immutable operation identity from the runtime', async () => {
  let request;
  const result = await execute('inspect_workspace', { section: 'calendar', limit: 5 }, {
    inspectWorkspace: async (input) => { request = input; return { calendar: [{ id: 'meeting-1' }] }; },
  });
  assert.deepEqual(request, { ...context, section: 'calendar', limit: 5, goalScope: 'team', idempotencyKey: 'autonomy:event-1:step0:inspect_workspace' });
  assert.equal(result.status, 'observed');
  assert.equal(result.receipt.verified, true);
});

test('public research does not fabricate private account metrics or research success', async () => {
  const result = await execute('research_public_marketing', { query: '  marca personal  ' }, {
    researchPublicMarketing: async ({ query }) => {
      assert.equal(query, 'marca personal');
      return { configured: true, results: [], reason: 'No hubo fuentes recuperadas' };
    },
  }, { agent: 'melodi' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'observed');
  assert.deepEqual(result.data.results, []);
  const unverified = await execute('account_metrics', {}, { accountMetrics: async () => ({ followers: 100 }) }, { agent: 'melodi' });
  assert.equal(unverified.error, 'unverified_tool_result');
  assert.equal(unverified.receipt.verified, false);
});

test('document enqueue is a queued receipt, never a claimed completed artifact', async () => {
  const result = await execute('prepare_document', { title: 'Plan semanal', content: 'Revisar integración.' }, {
    prepareDocument: async (request) => {
      assert.equal(request.format, 'pdf');
      assert.equal(request.kind, 'report');
      assert.equal(request.ownerPhone, context.ownerPhone);
      return { status: 'queued', jobId: 'job-1' };
    },
  }, { agent: 'melodi' });
  assert.equal(result.status, 'queued');
  assert.deepEqual(result.receipt, { tool: 'prepare_document', status: 'queued', verified: true, operationId: 'job-1' });
});

test('prepared artifacts require both operation identity and actual stored media evidence', async () => {
  for (const incomplete of [
    { status: 'prepared', id: 'document-1' },
    { status: 'prepared', objectKey: 'private/a.pdf', mimeType: 'application/pdf' },
    { status: 'complete', id: 'document-1', objectKey: 'private/a.pdf', mimeType: 'application/pdf' },
  ]) {
    const result = await execute('prepare_document', { title: 'Informe', content: 'Datos reales.' }, { prepareDocument: async () => incomplete }, { agent: 'melodi' });
    assert.equal(result.error, 'unverified_tool_result');
  }
  const prepared = await execute('prepare_story', { brief: 'Una historia sobre un proyecto real.' }, {
    prepareStory: async () => ({ status: 'prepared', operationId: 'story-1', media: { objectKey: 'private/story.png', mimeType: 'image/png' } }),
  });
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.receipt.operationId, 'story-1');
});

test('personal goals cannot leak through delegation and a self-delegation never creates a loop', async () => {
  let calls = 0;
  const services = { delegateAgentEvent: async () => { calls++; return { status: 'queued', eventId: 'event-2' }; } };
  const privateGoal = await execute('delegate_agent_event', { target: 'melodi', task: 'Investiga mi objetivo privado' }, services, { goalScope: 'personal' });
  assert.equal(privateGoal.error, 'personal_goal_cannot_be_delegated');
  const self = await execute('delegate_agent_event', { target: 'melodi', task: 'Vuelve a hacer esto' }, services);
  assert.equal(self.error, 'invalid_delegation_target');
  assert.equal(calls, 0);
  const teamTask = await execute('delegate_agent_event', { target: 'melodi', task: 'Investiga evidencia pública sobre este tema.' }, services);
  assert.equal(teamTask.status, 'delegated');
  assert.equal(teamTask.receipt.operationId, 'event-2');
});

test('retry adapter accepts only a known id and delegates retry eligibility to the existing job service', async () => {
  let calls = 0;
  const services = { retryOwnerJob: async (request) => {
    calls++;
    assert.equal(request.jobId, 'known-job-1');
    return { status: 'queued', jobId: request.jobId };
  } };
  const blocked = await execute('retry_owner_job', { jobId: 'known-job-1', status: 'complete' }, services, { agent: 'melodi' });
  assert.equal(blocked.status, 'blocked');
  assert.equal(calls, 0);
  const queued = await execute('retry_owner_job', { jobId: 'known-job-1' }, services, { agent: 'melodi' });
  assert.equal(queued.status, 'queued');
  const rejected = await execute('retry_owner_job', { jobId: 'known-job-1' }, { retryOwnerJob: async () => { throw new Error('job_already_delivered'); } }, { agent: 'melodi' });
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.receipt.verified, false);
});

test('invalid clock, identity and overlong payloads are blocked before performing work', async () => {
  let calls = 0;
  const services = { prepareStory: async () => { calls++; return { status: 'queued', jobId: 'job-1' }; } };
  for (const extra of [{ ownerPhone: 'invalid' }, { eventId: '../event' }, { now: 'invalid' }, { agent: '__proto__' }]) {
    assert.equal((await execute('prepare_story', { brief: 'Idea' }, services, extra)).status, 'blocked');
  }
  assert.equal((await execute('prepare_story', { brief: 'x'.repeat(2_001) }, services)).status, 'blocked');
  assert.equal((await execute('prepare_story', { brief: ' ' }, services)).status, 'blocked');
  assert.equal(calls, 0);
});

test('raw integration errors and credentials never reach model-facing results', async () => {
  const failed = await execute('prepare_story', { brief: 'Historia' }, { prepareStory: async () => { throw new Error('secret_token=private'); } });
  assert.equal(failed.error, 'tool_service_failed');
  assert.doesNotMatch(JSON.stringify(failed), /private|secret_token/);
  const observed = await execute('account_metrics', {}, {
    accountMetrics: async () => ({ connected: true, access_token: 'private', apiKey: 'secret', nested: { imageBase64: 'payload', metric: 4 }, summary: 'x'.repeat(8_000) }),
  }, { agent: 'melodi' });
  assert.equal(observed.data.nested.metric, 4);
  assert.match(observed.data.summary,/Campo omitido/);
  assert.equal(observed.data._grounding.partial,true);
  assert.ok(observed.data.summary.length < 2_000);
  assert.doesNotMatch(JSON.stringify(observed), /private|secret|payload/);
});

test('a distinct runtime step carries a distinct idempotency key for the same tool', async () => {
  const keys = [];
  const services = { delegateAgentEvent: async ({ idempotencyKey }) => { keys.push(idempotencyKey); return { status: 'queued', eventId: 'created-event' }; } };
  await execute('delegate_agent_event', { target: 'melodi', task: 'Investiga el tema.' }, services);
  await execute('delegate_agent_event', { target: 'melodi', task: 'Analiza los datos.' }, services, { eventId: 'event-1:step1' });
  assert.notEqual(keys[0], keys[1]);
});
