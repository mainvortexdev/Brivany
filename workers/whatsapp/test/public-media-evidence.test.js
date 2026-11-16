import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicMediaExtraction, publicMediaEvidence, readRequestedPublicSource } from '../public-media-evidence.js';

const url = 'https://www.instagram.com/reel/EXACT/?igsh=original';
const input = { url, agent: 'melodi', ownerPhone: '18095550000', eventId: 'original-owner-request', now: '2026-10-09T14:00:00Z' };
const evidence = 'Las manos colocan las piezas en tres pasos visibles.';
const ready = extra => ({ status: 'ready', sourceUrl: url, verified: true, caption: '',
  media: [{ id: 'video-1', kind: 'video', analysis: { summary: 'Una secuencia muestra las piezas.',
    observedFormats: [{ name: 'Tutorial', evidence, observed: true, frameIndex: 2, timestampMs: 8000, confidence: 'high' }],
    ocrText: '', transcript: '' }, coverage: { sampled: true, complete: true, framesAnalyzed: 3, totalFrames: 900, durationSeconds: 30 } }],
  coverage: { complete: true, sampled: true, framesAnalyzed: 3, totalFrames: 900 }, ...extra });

test('audio after thirty visual pages remains available and music is visible before text truncation', () => {
  const visuals = Array.from({ length: 32 }, (_, index) => ({ id: `sheet-${index}`, kind: 'framesheet',
    analysis: { summary: 'Detalle visual largo. '.repeat(100) }, coverage: { complete: true } }));
  const audio = { id: 'audio-last', kind: 'audio', analysis: { unknownTranscript: 'Palabras de baja confianza.',
    audioClassification: { status: 'classified', segments: [{ startSeconds: 0, endSeconds: 2, speech: true, music: true, singing: false, confidence: 'low', overlap: true }] } }, coverage: { complete: true } };
  const result = publicMediaEvidence(ready({ media: [...visuals, audio] }), { url });
  assert.equal(result.media.length, 33);
  assert.equal(result.results[0].audioEvidence[0].mediaId, 'audio-last');
  assert.match(result.results[0].text, /voz hablada \+ música/);
  assert.equal(result.results[0].truncated, true);
  assert.equal(result.results[0].complete, false);
});

test('cancelled analysis stops without text fallback or fabricated media', async () => {
  let fallback = 0;
  const result = await readRequestedPublicSource(input, { extractPublicMedia: async () => ({ status: 'cancelled', sourceUrl: url }),
    readPublicSource: async () => { fallback++; } });
  assert.equal(result.status, 'cancelled'); assert.equal(result.textFallbackAllowed, false); assert.equal(fallback, 0);
});

test('a sampled visual format retains source, frame and time without pretending its name was literal OCR', () => {
  const result = publicMediaEvidence(ready(), { url });
  assert.equal(result.status, 'ready');
  assert.equal(result.sourceUrl, url);
  assert.equal(result.results[0].url, url);
  assert.equal(result.results[0].complete, false);
  assert.equal(result.results[0].mediaVerified, true);
  assert.equal(result.results[0].visualEvidence[0].formatName, 'Tutorial');
  assert.equal(result.results[0].visualEvidence[0].frameIndex, 2);
  assert.equal(result.results[0].visualEvidence[0].timestampMs, 8000);
  assert.equal(result.results[0].literalText, '');
  assert.ok(result.results[0].text.includes(evidence));
});

test('inferences, missing frame provenance and timestamps outside the clip cannot become observed formats', () => {
  const value = ready();
  value.media[0].analysis.observedFormats = [
    { name: 'Inventado', evidence, observed: false, frameIndex: 2 },
    { name: 'Sin procedencia', evidence, observed: true },
    { name: 'Tiempo imposible', evidence, observed: true, timestampMs: 31000 },
  ];
  assert.deepEqual(validatePublicMediaExtraction(value, { url }).media[0].analysis.observedFormats, []);
});

test('image identity can prove a still-image observation and only complete coverage is labeled complete', () => {
  const value = ready({ media: [{ id: 'slide-1', kind: 'image', analysis: { summary: 'Dos imágenes se muestran juntas.',
    observedFormats: [{ name: 'Comparativa', evidence: 'Los dos paneles muestran estados distintos.', observed: true }] }, coverage: { complete: true } }], coverage: { complete: true } });
  const result = publicMediaEvidence(value, { url });
  assert.equal(result.results[0].visualEvidence[0].image, true);
  assert.equal(result.results[0].complete, true);
  const partial = ready({ media: value.media, coverage: { complete: true, mediaAnalyzed: 1, totalMedia: 2 } });
  assert.equal(publicMediaEvidence(partial, { url }).results[0].complete, false);
});

test('ready and pending receipts require an exact public source and actual verified evidence', () => {
  for (const invalid of [ready({ verified: false }), ready({ media: [] }), ready({ sourceUrl: 'https://instagram.com/p/OTHER/' }),
    { status: 'pending', sourceUrl: url, verified: true }, { status: 'pending', sourceUrl: url, operationId: '../external', verified: true },
    { status: 'ready', sourceUrl: url, verified: true, media: [{ kind: 'audio', analysis: {} }] }]) {
    assert.throws(() => validatePublicMediaExtraction(invalid, { url }), /public_media_unverified/);
  }
  assert.equal(validatePublicMediaExtraction({ status: 'pending', sourceUrl: url, operationId: 'media-job-1', verified: true, retryAfterMs: 1 }, { url }).retryAfterMs, 30000);
});

test('a pending extraction retains its identity and does not fall back to text or claim completion', async () => {
  let received;
  const result = await readRequestedPublicSource({ ...input, operationId: 'same-media-job' }, {
    extractPublicMedia: async value => { received = value; return { status: 'pending', sourceUrl: url, operationId: 'same-media-job', verified: true }; },
    readPublicSource: async () => assert.fail('No textual fallback during extraction'),
  });
  assert.equal(received.ownerPhone, input.ownerPhone);
  assert.equal(received.agent, 'melodi');
  assert.equal(received.eventId, input.eventId);
  assert.equal(received.operationId, 'same-media-job');
  assert.equal(received.idempotencyKey, `public-media:${input.eventId}`);
  assert.equal(result.status, 'pending');
  assert.equal(result.results, undefined);
});

test('text fallback only follows the explicit backend-not-connected capability and is never complete media coverage', async () => {
  let texts = 0;
  const services = { readPublicSource: async () => { texts++; return { configured: true, results: [{ url, text: 'Tutorial: texto de la publicación.', mediaVerified: false, complete: false }] }; } };
  const result = await readRequestedPublicSource(input, { ...services,
    extractPublicMedia: async () => ({ status: 'blocked', sourceUrl: url, reason: 'backend_not_connected', textFallbackAllowed: true }) });
  assert.equal(texts, 1);
  assert.equal(result.results[0].mediaVerified, false);
  for (const reason of ['private', 'media_unavailable', 'media_service_unavailable', 'download_rejected']) {
    const blocked = await readRequestedPublicSource(input, { ...services,
      extractPublicMedia: async () => ({ status: 'blocked', sourceUrl: url, reason, textFallbackAllowed: true }) });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.reason, reason);
  }
  assert.equal(texts, 1);
});

test('musical lyrics and unknown ASR are never reclassified as spoken voice or literal format evidence', () => {
  const value = ready({ media: [{ id: 'audio-1', kind: 'audio', analysis: { summary: 'Audio inspeccionado.',
    transcript: 'Tutorial cantado sin prueba de habla', sungTranscript: 'Tutorial cantado',
    audioClassification: { status: 'classified', segments: [{ startSeconds: 0, endSeconds: 10, speech: false, music: true, singing: true, confidence: 'high' }] } }, coverage: { complete: true } }] });
  const result = publicMediaEvidence(value, { url });
  assert.equal(result.media[0].analysis.spokenTranscript, '');
  assert.equal(result.media[0].analysis.transcript, '');
  assert.equal(result.media[0].analysis.sungTranscript, 'Tutorial cantado');
  assert.equal(result.results[0].literalText, '');
  assert.match(result.results[0].text, /Letra cantada/);
  const unclassified = ready({ media: [{ id: 'audio-2', kind: 'audio', analysis: { transcript: 'Esto podría ser canto' } }] });
  assert.equal(validatePublicMediaExtraction(unclassified, { url }).media[0].analysis.spokenTranscript, '');
  assert.equal(validatePublicMediaExtraction(unclassified, { url }).media[0].analysis.unknownTranscript, 'Esto podría ser canto');
});

test('verified speech with background music remains distinct from singing and unavailable classification', () => {
  const value = ready({ media: [{ id: 'audio-1', kind: 'audio', analysis: { spokenTranscript: 'Tutorial: arma las piezas.',
    audioClassification: { status: 'classified', segments: [{ startSeconds: 0, endSeconds: 10, speech: true, music: true, singing: false, overlap: true, confidence: 'high' }] } } }] });
  const result = publicMediaEvidence(value, { url });
  assert.equal(result.media[0].analysis.spokenTranscript, 'Tutorial: arma las piezas.');
  assert.match(result.results[0].literalText, /Tutorial/);
  assert.equal(result.results[0].audioEvidence[0].segments[0].music, true);
  assert.equal(result.results[0].audioEvidence[0].segments[0].singing, false);
  assert.match(result.results[0].text, /0–10 s: voz hablada \+ música \(audio mixto\), confianza alta/);
});

test('low confidence voice, background music and singing remain visible by interval without verifying ASR words', () => {
  const value = ready({ media: [{ id: 'audio-low', kind: 'audio', analysis: { transcript: 'Palabras del reconocimiento que podrían ser canto.',
    sungTranscript: 'Letra sin clasificación suficientemente segura', audioClassification: { status: 'classified', segments: [
      { startSeconds: 0, endSeconds: 2, speech: true, music: true, singing: false, overlap: true, confidence: 'low' },
      { startSeconds: 2, endSeconds: 4, speech: false, music: true, singing: true, overlap: true, confidence: 'low' },
    ] } } }] });
  const result = publicMediaEvidence(value, { url });
  assert.match(result.results[0].text, /0–2 s: voz hablada \+ música \(audio mixto\), confianza baja/);
  assert.match(result.results[0].text, /2–4 s: música \+ canto \(audio mixto\), confianza baja/);
  assert.equal(result.media[0].analysis.spokenTranscript, '');
  assert.equal(result.media[0].analysis.sungTranscript, '');
  assert.equal(result.results[0].literalText, '');
  assert.match(result.results[0].text, /Transcripción sin clasificación/);
  assert.doesNotMatch(result.results[0].text, /Voz hablada verificada/);
});

test('unavailable acoustic classification is an explicit unknown and truncating intervals makes coverage partial', () => {
  const unclassified = ready({ media: [{ id: 'audio-unknown', kind: 'audio', analysis: { summary: 'Audio recuperado.' }, coverage: { complete: true } }], coverage: { complete: true } });
  const unknown = publicMediaEvidence(unclassified, { url });
  assert.match(unknown.results[0].text, /composición desconocida/);
  assert.equal(unknown.results[0].complete, false);
  const many = ready({ media: [{ id: 'audio-many', kind: 'audio', analysis: { summary: 'Audio recuperado.', audioClassification: { status: 'classified',
    segments: Array.from({ length: 51 }, (_, index) => ({ startSeconds: index, endSeconds: index + 1, speech: true, music: false, singing: false, confidence: 'low' })) } },
    coverage: { complete: true } }], coverage: { complete: true } });
  const result = publicMediaEvidence(many, { url });
  assert.equal(result.media[0].analysis.audioClassification.segments.length, 50);
  assert.equal(result.results[0].complete, false);
});

test('extractor payloads expose bounded evidence without private download URLs, bytes or credentials', () => {
  const value = ready({ accessToken: 'secret', signedDownloadUrl: 'https://private.example/download?secret=1', bytes: 'rawbytes' });
  Object.assign(value.media[0], { bytes: 'rawbytes', objectKey: 'private/secret', privateUrl: 'https://private.example/secret' });
  const result = publicMediaEvidence(value, { url });
  assert.doesNotMatch(JSON.stringify(result), /rawbytes|private\/secret|private\.example|accessToken/);
});
