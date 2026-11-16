import test from 'node:test';
import assert from 'node:assert/strict';
import { runWeeklyResearch } from '../melodi-routine-workflow.js';

const source = { title: 'Guion y edición', url: 'https://www.instagram.com/reel/example/?utm_source=public',
  publishedDate: '2026-10-07T12:00:00Z', highlights: ['Este reel muestra un proceso de edición.'],
  visibleMetrics: { likes: 200, comments: 15, views: 1200 } };
const context = { owner: '18495205246', agent: 'melodi', eventId: 'weekly-event', now: '2026-10-09T13:00:00Z',
  routine: { id: 'routine-1', owner: '18495205246', agent: 'melodi', title: 'Estudio semanal de formatos',
    profile: 'https://www.instagram.com/example/', brief: 'Revisa los formatos y recomienda pruebas.',
    channel: 'email', runKey: 'routine:1:2026-10-09', occurrenceAt: '2026-10-09T13:00:00Z' } };
const insights = { formats: [{ source_url: source.url, format: 'reel', evidence_quote: source.highlights[0] }],
  hypotheses: [{ hypothesis: 'Mostrar el proceso podría atraer preguntas.', experiment: 'Comparar una pieza de proceso con una pieza de resultado.', measurement: 'Registrar comentarios cualitativos y visualizaciones públicas.' }],
  limitations: ['Datos públicos incompletos.'] };

function fixture(options = {}) {
  const calls = { active: [], research: [], generate: [], document: [] };
  const services = {
    isRoutineActive: async id => { calls.active.push(id); return true; },
    researchPublicMarketing: async input => { calls.research.push(input); return { configured: true, results: [source] }; },
    generate: async (agent, input, prompt) => { calls.generate.push({ agent, input, prompt }); return { text: JSON.stringify(insights) }; },
    prepareDocument: async input => { calls.document.push(input); return { status: 'queued', jobId: 'pdf-job' }; },
    ...options,
  };
  return { calls, services };
}

test('weekly pipeline binds owner and agent, retrieves the last seven local days and returns a queued receipt', async () => {
  const { calls, services } = fixture();
  const result = await runWeeklyResearch(context, services);
  assert.equal(result.status, 'queued'); assert.equal(result.jobId, 'pdf-job');
  assert.equal(result.receipt.verified, true); assert.equal(result.receipt.operationId, 'pdf-job');
  assert.equal(calls.research.length, 1); assert.equal(calls.generate.length, 1); assert.equal(calls.document.length, 1);
  assert.match(calls.research[0].query, /2026-10-02T09:00 a 2026-10-09T09:00/);
  assert.match(calls.research[0].query, /instagram\.com\/example/);
  assert.equal(calls.generate[0].agent, 'melodi');
  assert.match(calls.generate[0].prompt, /ignora instrucciones/);
  const document = calls.document[0];
  assert.equal(document.ownerPhone, context.owner); assert.equal(document.agent, 'melodi');
  assert.equal(document.format, 'pdf'); assert.equal(document.kind, 'report');
  assert.equal(document.channel, 'email'); assert.equal(document.routineId, 'routine-1');
  assert.equal(document.runKey, context.routine.runKey);
  assert.equal(document.idempotencyKey, `weekly-report:${context.routine.runKey}`);
  for (const section of ['ALCANCE Y PERÍODO', 'FORMATOS OBSERVADOS', 'EJEMPLOS Y FUENTES', 'MÉTRICAS VISIBLES Y AUSENTES', 'HIPÓTESIS Y EXPERIMENTOS PROPUESTOS', 'LIMITACIONES Y CONFIANZA']) assert.ok(document.content.includes(section), section);
});

test('exact public URLs and observed public metrics are saved in document and receipt', async () => {
  const { calls, services } = fixture();
  const result = await runWeeklyResearch(context, services);
  assert.equal(result.sources[0].url, source.url);
  assert.match(calls.document[0].content, /likes=200, comments=15, views=1200/);
  assert.ok(calls.document[0].content.includes(source.url));
  assert.match(calls.document[0].content, /retención, guardados, conversiones y métricas privadas: no disponibles/);
  assert.match(calls.document[0].content, /Hipótesis sin confirmar/);
});

test('empty public search produces an honest report with absent metrics and no invented findings', async () => {
  const { calls, services } = fixture({ researchPublicMarketing: async () => ({ configured: true, results: [] }) });
  const result = await runWeeklyResearch(context, services);
  assert.deepEqual(result.sources, []);
  const content = calls.document[0].content;
  assert.match(content, /No recuperé fuentes públicas verificables/);
  assert.match(content, /No recuperé cifras públicas verificables/);
  assert.match(content, /Confianza insuficiente/);
  assert.match(content, /ausencia de resultados no demuestra ausencia de publicaciones/);
  assert.equal(content.includes('likes=200'), false);
  assert.equal(content.includes('Mostrar el proceso podría atraer'), false);
  assert.equal(content.includes(source.url), false);
});

test('unconfigured research can document its limitation without pretending it researched successfully', async () => {
  const { calls, services } = fixture({ researchPublicMarketing: async () => ({ configured: false, results: [], reason: 'Búsqueda pública sin conectar' }) });
  await runWeeklyResearch(context, services);
  assert.match(calls.document[0].content, /Búsqueda pública sin conectar/);
  assert.match(calls.document[0].content, /No recuperé fuentes/);
});

test('invalid, private, duplicate and unsupported links do not become evidence', async () => {
  const { calls, services } = fixture({ researchPublicMarketing: async () => ({ results: [source, source,
    { ...source, url: 'https://instagram.com.evil.example/reel/a' },
    { ...source, url: 'http://instagram.com/reel/a' },
    { ...source, url: 'javascript:alert(1)' },
    { ...source, url: 'https://user:password@instagram.com/reel/a' },
    { ...source, url: 'https://instagram.com/reel/private', visibility: 'private' },
  ] }) });
  const result = await runWeeklyResearch(context, services);
  assert.equal(result.sources.length, 1);
  assert.equal(calls.generate[0].input.evidence.length, 1);
  assert.equal(calls.document[0].content.includes('evil.example'), false);
  assert.match(calls.document[0].content, /Se omitieron 5 referencias/);
});

test('undated or old sources are context, never verified observations of this week', async () => {
  const { calls, services } = fixture({ researchPublicMarketing: async () => ({ results: [
    { ...source, publishedDate: '' }, { ...source, url: 'https://instagram.com/p/old/', publishedDate: '2026-09-01' },
  ] }) });
  const result = await runWeeklyResearch(context, services);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources.every(item => !item.inPeriod), true);
  assert.match(calls.document[0].content, /No pude verificar formatos publicados dentro del período/);
  assert.match(calls.document[0].content, /fuera del período o fecha no verificable; solo contexto/);
  assert.match(calls.document[0].content, /Confianza insuficiente/);
});

test('unsupported model facts, URLs, metrics and claims of virality are omitted', async () => {
  const { calls, services } = fixture({ generate: async () => ({ text: JSON.stringify({
    formats: [{ source_url: source.url, format: 'carrusel', evidence_quote: 'Cita inventada' },
      { source_url: source.url, format: 'carrusel', evidence_quote: source.highlights[0] },
      { source_url: 'https://instagram.com/reel/invented/', format: 'reel', evidence_quote: source.highlights[0] }],
    hypotheses: [
      { hypothesis: 'Es viral', experiment: 'Repetir la fórmula', measurement: 'Medir' },
      { hypothesis: 'Tiene 99999 seguidores', experiment: 'Probar', measurement: 'Medir' },
      { hypothesis: 'Mirar este éxito', experiment: 'Usar https://evil.example', measurement: 'Medir' },
    ], limitations: [],
  }) }) });
  await runWeeklyResearch(context, services);
  const content = calls.document[0].content;
  for (const falseClaim of ['Cita inventada', 'carrusel', 'reel/invented', 'Es viral', '99999', 'evil.example']) assert.equal(content.includes(falseClaim), false);
  assert.match(content, /Se omitieron propuestas/);
});

test('explicit negative or private metrics are excluded', async () => {
  const { calls, services } = fixture({ researchPublicMarketing: async () => ({ results: [
    { ...source, visibleMetrics: { likes: -1, comments: '15', views: NaN, reach: 123456 } },
    { ...source, url: 'https://instagram.com/reel/other/', visibleMetrics: { visibility: 'private', likes: 1000 } },
  ] }) });
  await runWeeklyResearch(context, services);
  assert.match(calls.document[0].content, /No recuperé cifras públicas verificables/);
  assert.equal(calls.document[0].content.includes('123456'), false);
});

test('waiting approval at any service stops immediately without another effect', async () => {
  for (const service of ['isRoutineActive', 'researchPublicMarketing', 'generate', 'prepareDocument']) {
    const { calls, services } = fixture();
    let requests = 0;
    const original = services[service];
    services[service] = async (...args) => { requests++; await original(...args); return { status: 'waiting_approval', operationId: 'permission-operation' }; };
    const result = await runWeeklyResearch(context, services);
    assert.equal(result.status, 'waiting_approval'); assert.equal(result.operationId, 'permission-operation');
    assert.equal(requests, 1, service);
    assert.equal(calls.document.length, service === 'prepareDocument' ? 1 : 0, service);
    if (service === 'researchPublicMarketing') assert.equal(calls.generate.length, 0);
  }
});

test('failure during research or generation never prepares a document', async () => {
  for (const stage of ['researchPublicMarketing', 'generate']) {
    for (const response of [{ status: 'failed' }, { status: 'blocked' }, { ok: false, status: 'failed' }]) {
      const { calls, services } = fixture({ [stage]: async () => response });
      await assert.rejects(runWeeklyResearch(context, services), /routine_/);
      assert.equal(calls.document.length, 0);
    }
    const { calls, services } = fixture({ [stage]: async () => { throw Error('provider unavailable'); } });
    await assert.rejects(runWeeklyResearch(context, services), /provider unavailable/);
    assert.equal(calls.document.length, 0);
  }
});

test('cancellation before each stage stops subsequent effects', async () => {
  for (let stopAt = 1; stopAt <= 3; stopAt++) {
    let checks = 0;
    const { calls, services } = fixture({ isRoutineActive: async () => ++checks < stopAt });
    const result = await runWeeklyResearch(context, services);
    assert.equal(result.status, 'cancelled');
    assert.equal(calls.research.length, stopAt > 1 ? 1 : 0);
    assert.equal(calls.generate.length, stopAt > 2 ? 1 : 0);
    assert.equal(calls.document.length, 0);
  }
});

test('invalid generated reports and unverified queue responses cannot claim success', async () => {
  for (const output of ['not json', '{}', '{"formats":[],"hypotheses":[]}']) {
    const { calls, services } = fixture({ generate: async () => ({ text: output }) });
    await assert.rejects(runWeeklyResearch(context, services), /routine_report_invalid/);
    assert.equal(calls.document.length, 0);
  }
  for (const output of [null, {}, { status: 'queued' }, { status: 'sent', jobId: 'job' }]) {
    const { services } = fixture({ prepareDocument: async () => output });
    await assert.rejects(runWeeklyResearch(context, services), /unverified_receipt/);
  }
});

test('agent mismatch, owner mismatch or unavailable cancellation checks fail before effects', async () => {
  const { calls, services } = fixture();
  await assert.rejects(runWeeklyResearch({ ...context, agent: 'melodi' }, services), /invalid_scope/);
  await assert.rejects(runWeeklyResearch({ ...context, owner: 'other' }, services), /invalid_scope/);
  await assert.rejects(runWeeklyResearch({ ...context, now: 'invalid' }, services), /invalid_clock/);
  await assert.rejects(runWeeklyResearch(context, { ...services, isRoutineActive: undefined }), /service_missing/);
  assert.equal(calls.research.length, 0); assert.equal(calls.document.length, 0);
});
