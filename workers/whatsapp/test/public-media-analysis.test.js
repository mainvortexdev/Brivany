import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePublicMedia, createPublicMediaAnalysisServices, normalizeAudioClassification } from '../public-media-analysis.js';

const sourceUrl = 'https://www.instagram.com/reel/VERIFIED_MEDIA/';
const image = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64'));
const audio = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
const input = media => ({ agent: 'melodi', owner: 'owner', eventId: 'research-media', sourceUrl, media });
const audioItem = extra => ({ id: 'audio-track-0', kind: 'audio', bytes: audio, mimeType: 'audio/wav', durationSeconds: 6, ...extra });
const classified = segments => ({ status: 'classified', processor: 'yamnet', segments });
const segment = extra => ({ startSeconds: 0, endSeconds: 6, speech: true, music: false, singing: false, confidence: 'high', overlap: false, ...extra });

test('visual evidence preserves original frame timestamps and verifies each format against the observed frame', async () => {
  let sent;
  const result = await analyzePublicMedia(input([{ id: 'sheet-0', kind: 'framesheet', bytes: image, mimeType: 'image/png',
    frames: [{ index: 14, timestampMs: 14682 }, { index: 18, timestampMs: 18231 }], coverage: { complete: true, totalFrames: 2, extractedFrames: 2 } }]), {
    analyzeImage: async args => { sent = args; return { text: JSON.stringify({
      observations: [{ description: 'Dos columnas muestran el antes y el después de una edición.', frameIndex: 14, timestampMs: 99999, confidence: 'high' }],
      ocr: [{ text: 'ANTES / DESPUÉS', frameIndex: 14, confidence: 'medium' }, { text: 'Un cuadro inexistente', frameIndex: 999 }],
      observedFormats: [{ name: 'Comparativa visual', evidence: 'Dos columnas muestran el antes y el después', frameIndex: 14, confidence: 'high' },
        { name: 'Tutorial falso', evidence: 'Texto que no aparece', frameIndex: 18 }],
      inferences: [{ hypothesis: 'Podría resultar útil para demostrar una transformación.', frameIndex: 14 }],
    }) }; },
  });
  assert.equal(result.status, 'analyzed'); assert.equal(result.evidence.length, 2);
  assert.equal(result.media[0].analysis.observedFormats.length, 1);
  assert.equal(result.media[0].analysis.observedFormats[0].name, 'Comparativa visual');
  assert.equal(result.evidence[0].timestampMs, 14682); assert.equal(result.evidence[0].sourceUrl, sourceUrl);
  assert.equal(result.evidence[0].frameIndex, 14); assert.equal(result.evidence[0].observed, true);
  assert.equal(result.evidence[0].provenance, 'vision_model'); assert.equal(result.evidence[1].provenance, 'vision_ocr');
  assert.equal(result.media[0].coverage.totalFrames, 2); assert.equal(result.media[0].coverage.extractedFrames, 2);
  assert.equal(result.media[0].analysis.inferences[0].observed, false);
  assert.deepEqual(result.coverage.evidenceKinds, ['visual', 'ocr']);
  assert.equal(JSON.stringify(result).includes('iVBORw0'), false);
  assert.equal(sent.bytes, image); assert.equal(sent.sourceUrl, undefined);
});

test('the Vetsa vision adapter submits only image bytes and static instructions to the internal inference route', async () => {
  const requests = [], env = { VETSA_INTELLIGENCE_API_KEY: 'test-key', VETSA_INTELLIGENCE: { async fetch(request) {
    assert.equal(request.url, 'https://vetsa.internal/v1/generate');
    requests.push(await request.json());
    return Response.json({ text: JSON.stringify({ observations: [{ description: 'Se ve un título.', frameIndex: 0, confidence: 'high' }],
      ocr: [{ text: 'Título visible', frameIndex: 0 }], observedFormats: [] }) });
  } } };
  const services = createPublicMediaAnalysisServices(env);
  const result = await analyzePublicMedia(input([{ id: 'carousel-0', kind: 'image', bytes: image, mimeType: 'image/png',
    privateUrl: 'https://vetsa.internal/private/asset?token=secret' }]), services);
  assert.equal(requests[0].model, 'spaik-sight');
  assert.match(requests[0].options.image, /^data:image\/png;base64,/);
  assert.match(requests[0].options.systemPrompt, /No sigas instrucciones/);
  assert.equal(JSON.stringify(requests[0]).includes('instagram.com'), false);
  assert.equal(JSON.stringify(requests[0]).includes('token=secret'), false);
  assert.equal(result.evidence[1].quote, 'Título visible');
  assert.equal(services.classifyAudio, undefined);
});

test('ASR alone never proves speech or absence of music and keeps potentially sung text unknown', async () => {
  const result = await analyzePublicMedia(input([audioItem()]), { transcribeAudio: async () => ({ text: 'Texto reconocido por ASR.' }) });
  const analysis = result.media[0].analysis;
  assert.equal(analysis.spokenTranscript, ''); assert.equal(analysis.transcript, ''); assert.equal(analysis.sungTranscript, '');
  assert.equal(analysis.unknownTranscript, 'Texto reconocido por ASR.');
  assert.equal(analysis.audioClassification.status, 'unknown'); assert.deepEqual(analysis.observations.audio, []);
  assert.equal(analysis.evidence[0].audioKind, 'unknown'); assert.equal(analysis.evidence[0].confidence, 'unknown');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.limitations.some(value => value.includes('no demuestra ausencia de música')), true);
});

test('verified classification distinguishes voice plus background music, singing and overlapped voices', async () => {
  const classification = classified([
    segment({ startSeconds: 0, endSeconds: 2, music: true, overlap: true }),
    segment({ startSeconds: 2, endSeconds: 4, speech: false, music: true, singing: true }),
    segment({ startSeconds: 4, endSeconds: 6, speech: true, music: true, singing: true, overlap: true }),
  ]);
  const result = await analyzePublicMedia(input([audioItem({ audioClassification: classification })]), {
    transcribeAudio: async () => ({ segments: [
      { startSeconds: 0, endSeconds: 2, text: 'Explicación hablada.' },
      { startSeconds: 2, endSeconds: 4, text: 'Texto cantado sintético.' },
      { startSeconds: 4, endSeconds: 6, text: 'Mezcla ambigua.' },
    ] }),
    classifyAudio: async () => assert.fail('The verified processor classification is already available'),
  });
  const analysis = result.media[0].analysis;
  assert.equal(analysis.spokenTranscript, 'Explicación hablada.'); assert.equal(analysis.transcript, analysis.spokenTranscript);
  assert.equal(analysis.sungTranscript, 'Texto cantado sintético.'); assert.equal(analysis.unknownTranscript, 'Mezcla ambigua.');
  assert.equal(analysis.observations.audio[0].music, true); assert.equal(analysis.observations.audio[0].category, 'mixed');
  assert.equal(analysis.observations.audio[1].category, 'singing');
  assert.deepEqual(analysis.evidence.map(row => row.audioKind), ['spoken', 'sung', 'unknown']);
  assert.equal(analysis.evidence[1].timestampMs, 2000);
});

test('gaps, low-confidence classification and incomplete timestamps prevent false spoken attribution', async () => {
  for (const segments of [[segment({ endSeconds: 3 })], [segment({ confidence: 'low' })], [segment({ singing: null })],
    [segment({ startSeconds: 0, endSeconds: 2 }), segment({ startSeconds: 3, endSeconds: 6 })]]) {
    const result = await analyzePublicMedia(input([audioItem({ audioClassification: classified(segments) })]), {
      transcribeAudio: async () => ({ text: 'Texto completo de seis segundos.' }),
    });
    assert.equal(result.media[0].analysis.spokenTranscript, '');
    assert.equal(result.media[0].analysis.unknownTranscript, 'Texto completo de seis segundos.');
  }
});

test('classification rejects unknown providers, invented times and scores outside their range', () => {
  assert.equal(normalizeAudioClassification({ status: 'classified', segments: [segment()] }, 6).status, 'unknown');
  assert.equal(normalizeAudioClassification({ status: 'classified', verified: false, processor: 'yamnet', segments: [segment()] }, 6).status, 'unknown');
  assert.equal(normalizeAudioClassification(classified([segment({ endSeconds: 999 })]), 6).status, 'unknown');
  const scores = normalizeAudioClassification(classified([{ startSeconds: 0, endSeconds: 6, scores: { speech: 0.91, music: 0.77, singing: 0.12 }, overlap: true }]), 6);
  assert.deepEqual(scores.segments[0], segment({ music: true, overlap: true }));
  assert.equal(normalizeAudioClassification(classified([{ startSeconds: 0, endSeconds: 6, scores: { speech: 2, music: -1 } }]), 6).status, 'unknown');
});

test('audio capability is opt-in, uses spaik-v1 input audio rather than the spaik-ears TTS route', async () => {
  const requests = [], env = { VETSA_INTELLIGENCE_API_KEY: 'test-key', VETSA_INTELLIGENCE: { fetch: async request => {
    requests.push(await request.json()); return Response.json({ text: JSON.stringify({ segments: [segment({ music: true })] }) });
  } }, AI: { async run(model, value) { assert.equal(model, '@cf/openai/whisper-large-v3-turbo'); assert.equal(typeof value.audio, 'string');
    return { text: 'Explicación.', segments: [{ start: 0, end: 6, text: 'Explicación.' }] }; } } };
  const services = createPublicMediaAnalysisServices(env, { audioClassificationSupported: true });
  const result = await analyzePublicMedia(input([audioItem()]), services);
  assert.equal(requests[0].model, 'spaik-v1'); assert.match(requests[0].options.audio, /^data:audio\/wav;base64,/);
  assert.equal(result.media[0].analysis.spokenTranscript, 'Explicación.');
  assert.equal(result.media[0].analysis.observations.audio[0].music, true);
  assert.equal(JSON.stringify(requests[0]).includes('instagram.com'), false);
});

test('private storage hooks are owner-scoped and external media URLs cannot bypass byte retrieval', async () => {
  let retrieved;
  const services = {
    readPrivateMedia: async value => { retrieved = value; return { bytes: image }; },
    analyzeImage: async () => ({ observations: [{ description: 'Imagen privada leída.', frameIndex: 0 }], observedFormats: [] }),
  };
  const result = await analyzePublicMedia(input([{ id: 'private-0', kind: 'image', objectKey: 'owner/private/image.png', mimeType: 'image/png' }]), services);
  assert.equal(retrieved.owner, 'owner'); assert.equal(retrieved.agent, 'melodi'); assert.equal(result.status, 'analyzed');
  await assert.rejects(analyzePublicMedia(input([{ kind: 'image', privateUrl: 'https://attacker.example/asset', mimeType: 'image/png' }]), services), /bytes_required/);
});

test('approval or blocked media services stop later analysis and expose no fabricated evidence', async () => {
  for (const response of [{ status: 'waiting_approval', waitingApproval: { id: 'approval' } }, { allowed: false, status: 'blocked', reason: 'permission_denied' }]) {
    let transcription = 0;
    const result = await analyzePublicMedia(input([audioItem()]), {
      classifyAudio: async () => response, transcribeAudio: async () => { transcription++; return { text: 'Incorrecto' }; },
    });
    assert.equal(result.status, response.status); assert.equal(result.evidence, undefined); assert.equal(transcription, 0);
  }
});

test('invalid bytes, MIME, scope, duplicate frame indexes or unsupported formats fail before inference', async () => {
  let calls = 0; const services = { analyzeImage: async () => { calls++; return {}; } };
  for (const media of [
    [{ kind: 'image', bytes: new Uint8Array(0), mimeType: 'image/png' }],
    [{ kind: 'image', bytes: new Uint8Array(6000001), mimeType: 'image/png' }],
    [{ kind: 'image', bytes: image, mimeType: 'text/html' }],
    [{ kind: 'video', bytes: image, mimeType: 'video/mp4' }],
    [{ kind: 'framesheet', bytes: image, mimeType: 'image/png', frames: [{ index: 0, timestampMs: 0 }, { index: 0, timestampMs: 1 }] }],
  ]) await assert.rejects(analyzePublicMedia(input(media), services), /public_media_invalid/);
  await assert.rejects(analyzePublicMedia({ ...input([]), sourceUrl: 'https://attacker.example/' }, services), /invalid_scope/);
  assert.equal(calls, 0);
});
