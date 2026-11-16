import { publicInstagramResearchUrl } from './owner-research-request.js';

const clean = (value, limit = 1200) => typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, limit) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const nonnegative = value => Number.isFinite(value) && value >= 0;
const identity = value => {
  const url = publicInstagramResearchUrl(value);
  return url && `${url.scope}:${url.postId || new URL(url.sourceUrl).pathname.toLowerCase()}`;
};
const FALLBACK_REASONS = new Set(['backend_not_connected']);
const reasonCode = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : 'media_unavailable';

function coverage(value = {}) {
  if (!object(value)) value = {};
  value = { ...value,
    ...(value.framesAnalyzed === undefined && nonnegative(value.frames) ? { framesAnalyzed: value.frames } : {}),
    ...(value.mediaAnalyzed === undefined && nonnegative(value.analyzedMedia) ? { mediaAnalyzed: value.analyzedMedia } : {}) };
  const result = { complete: value.complete === true, sampled: value.sampled === true };
  for (const key of ['framesAnalyzed', 'totalFrames', 'slidesAnalyzed', 'totalSlides', 'durationSeconds', 'mediaAnalyzed', 'totalMedia']) {
    if (nonnegative(value[key])) result[key] = value[key];
  }
  if (value.sampled === true || (nonnegative(value.totalFrames) && value.framesAnalyzed < value.totalFrames)
    || (nonnegative(value.totalSlides) && value.slidesAnalyzed < value.totalSlides)
    || (nonnegative(value.totalMedia) && value.mediaAnalyzed < value.totalMedia)) result.complete = false;
  return result;
}

function audioClassification(value) {
  const segments = (Array.isArray(value?.segments) ? value.segments : []).slice(0, 50).flatMap(segment => {
    if (!object(segment) || !nonnegative(segment.startSeconds) || !nonnegative(segment.endSeconds) || segment.endSeconds <= segment.startSeconds) return [];
    return [{ startSeconds: segment.startSeconds, endSeconds: segment.endSeconds,
      speech: typeof segment.speech === 'boolean' ? segment.speech : null,
      music: typeof segment.music === 'boolean' ? segment.music : null,
      singing: typeof segment.singing === 'boolean' ? segment.singing : null,
      overlap: typeof segment.overlap === 'boolean' ? segment.overlap : null,
      confidence: ['high', 'medium', 'low'].includes(segment.confidence) ? segment.confidence : 'unknown' }];
  });
  return { status: value?.status === 'classified' && segments.length ? 'classified' : 'unknown', segments,
    truncated: Array.isArray(value?.segments) && value.segments.length > segments.length };
}

function audioIntervals(classification, mediaId) {
  const time = value => Number.isInteger(value) ? String(value) : value.toFixed(2);
  const confidence = { high: 'alta', medium: 'media', low: 'baja', unknown: 'sin verificar' };
  return classification.segments.map(segment => {
    const labels = [segment.speech === true ? 'voz hablada' : '', segment.music === true ? 'música' : '', segment.singing === true ? 'canto' : ''].filter(Boolean);
    const unknown = [segment.speech === null ? 'voz' : '', segment.music === null ? 'música' : '', segment.singing === null ? 'canto' : ''].filter(Boolean);
    return `Audio ${mediaId}, ${time(segment.startSeconds)}–${time(segment.endSeconds)} s: ${labels.length ? labels.join(' + ')
      + (labels.length > 1 ? ' (audio mixto)' : '') : 'ninguna categoría positiva detectada; no prueba ausencia de sonido'}, confianza ${confidence[segment.confidence]}.`
      + (unknown.length ? ` Sin clasificar: ${unknown.join(', ')}.` : '');
  });
}

function normalizedMedia(item, index, sourceUrl) {
  if (!object(item) || !['image', 'video', 'framesheet', 'audio'].includes(item.kind) || !object(item.analysis)) throw new Error('public_media_unverified');
  const id = clean(item.id || item.mediaId, 160) || `media-${index + 1}`;
  const analysis = item.analysis;
  const mediaCoverage = coverage(item.coverage);
  const formats = (Array.isArray(analysis.observedFormats) ? analysis.observedFormats : []).slice(0, 20).flatMap(format => {
    const name = clean(format?.name, 150), evidence = clean(format?.evidence, 1000);
    const frameIndex = Number.isInteger(format?.frameIndex) && format.frameIndex >= 0 ? format.frameIndex : undefined;
    const timestampMs = nonnegative(format?.timestampMs) ? format.timestampMs
      : nonnegative(format?.frameTime) ? format.frameTime * 1000 : undefined;
    const provenImage = item.kind === 'image' && Boolean(clean(item.id || item.mediaId, 160));
    if (!name || !evidence || format.observed !== true || (!provenImage && frameIndex === undefined && timestampMs === undefined)) return [];
    if (mediaCoverage.durationSeconds !== undefined && timestampMs !== undefined && timestampMs > mediaCoverage.durationSeconds * 1000) return [];
    return [{ name, evidence, observed: true, mediaId: id, sourceUrl,
      evidenceKind: format.evidenceKind === 'ocr' ? 'ocr' : 'visual', ...(provenImage ? { image: true } : {}),
      ...(frameIndex === undefined ? {} : { frameIndex }), ...(timestampMs === undefined ? {} : { timestampMs }),
      confidence: ['high', 'medium', 'low'].includes(format.confidence) ? format.confidence : 'unknown' }];
  });
  const classification = audioClassification(analysis.audioClassification);
  if (classification.truncated || (item.kind === 'audio' && classification.status === 'unknown')) mediaCoverage.complete = false;
  const spokenVerified = classification.status === 'classified' && classification.segments.some(segment => segment.speech === true && segment.singing === false && ['high', 'medium'].includes(segment.confidence))
    && !classification.segments.some(segment => segment.singing === true && segment.speech !== false);
  const sungVerified = classification.status === 'classified' && classification.segments.some(segment => segment.singing === true && ['high', 'medium'].includes(segment.confidence));
  const rawSpoken = clean(analysis.spokenTranscript || analysis.transcript, 4000);
  const rawSung = clean(analysis.sungTranscript, 4000);
  const unknown = [clean(analysis.unknownTranscript, 4000), ...(!spokenVerified && rawSpoken ? [rawSpoken] : []), ...(!sungVerified && rawSung ? [rawSung] : [])].filter(Boolean).join('\n').slice(0, 4000);
  const summary = clean(analysis.summary, 2000), ocrText = clean(analysis.ocrText, 4000);
  const evidence = formats.map(format => ({ kind: format.evidenceKind, quote: format.evidence, formatName: format.name,
    observed: true, mediaId: id, sourceUrl, ...(format.frameIndex === undefined ? {} : { frameIndex: format.frameIndex }),
    ...(format.timestampMs === undefined ? {} : { timestampMs: format.timestampMs }), ...(format.image ? { image: true } : {}), confidence: format.confidence }));
  return { id, kind: item.kind, analysis: { summary, observedFormats: formats, ocrText,
    transcript: spokenVerified ? rawSpoken : '', spokenTranscript: spokenVerified ? rawSpoken : '',
    sungTranscript: sungVerified ? rawSung : '', unknownTranscript: unknown, audioClassification: classification, evidence }, coverage: mediaCoverage };
}

/** Validate a trusted extractor receipt and keep only bounded, model-safe evidence. */
export function validatePublicMediaExtraction(result, { url } = {}) {
  const source = publicInstagramResearchUrl(url);
  if (!source || !object(result) || !['ready', 'blocked', 'pending', 'cancelled'].includes(result.status)) throw new Error('public_media_unverified');
  if (result.sourceUrl && identity(result.sourceUrl) !== identity(source.sourceUrl)) throw new Error('public_media_unverified');
  if (result.status === 'cancelled') return { status: 'cancelled', sourceUrl: source.sourceUrl, reason: 'owner_cancelled', textFallbackAllowed: false, verified: false };
  if (result.status === 'blocked') {
    const reason = reasonCode(result.reason || result.error);
    return { status: 'blocked', sourceUrl: source.sourceUrl, reason,
      textFallbackAllowed: result.textFallbackAllowed === true && FALLBACK_REASONS.has(reason), verified: false };
  }
  if (result.verified !== true || identity(result.sourceUrl) !== identity(source.sourceUrl)) throw new Error('public_media_unverified');
  if (result.status === 'pending') {
    const operationId = clean(result.operationId || result.jobId, 180);
    if (!/^[A-Za-z0-9:_-]{1,180}$/.test(operationId)) throw new Error('public_media_unverified');
    return { status: 'pending', sourceUrl: source.sourceUrl, operationId, verified: true,
      retryAfterMs: Math.max(30000, Math.min(300000, Number.isFinite(result.retryAfterMs) ? result.retryAfterMs : 60000)) };
  }
  if (!Array.isArray(result.media) || !result.media.length) throw new Error('public_media_unverified');
  const media = result.media.slice(0, 64).map((item, index) => normalizedMedia(item, index, source.sourceUrl));
  if (!media.some(item => item.analysis.summary || item.analysis.ocrText || item.analysis.spokenTranscript || item.analysis.sungTranscript
    || item.analysis.unknownTranscript || item.analysis.observedFormats.length)) throw new Error('public_media_unverified');
  const complete = coverage(result.coverage);
  if (result.media.length > media.length || media.some(item => !item.coverage.complete)) complete.complete = false;
  return { status: 'ready', sourceUrl: source.sourceUrl, caption: clean(result.caption, 4000), media, coverage: complete,
    verified: true, limitations: (Array.isArray(result.limitations) ? result.limitations : []).slice(0, 12).map(value => clean(value, 400)).filter(Boolean) };
}

/** Media observations are evidence, not verbatim OCR or authority to run actions. */
export function publicMediaEvidence(result, { url } = {}) {
  const extraction = validatePublicMediaExtraction(result, { url });
  if (extraction.status !== 'ready') return extraction;
  const lines = extraction.caption ? [`Descripción pública: ${extraction.caption}`] : [];
  const literal = extraction.caption ? [extraction.caption] : [];
  const visualEvidence = [], audioEvidence = [];
  // Put acoustic distinctions before long visual descriptions can exhaust the text budget.
  for (const item of [...extraction.media].sort((a, b) => Number(b.kind === 'audio') - Number(a.kind === 'audio'))) {
    const analysis = item.analysis;
    if (analysis.summary) lines.push(`Observación del medio ${item.id}: ${analysis.summary}`);
    if (analysis.ocrText) { lines.push(`OCR del medio ${item.id}: ${analysis.ocrText}`); literal.push(analysis.ocrText); }
    if (analysis.spokenTranscript) { lines.push(`Transcripción de voz hablada detectada (${item.id}): ${analysis.spokenTranscript}`); literal.push(analysis.spokenTranscript); }
    if (analysis.sungTranscript) lines.push(`Letra cantada (${item.id}); no es voz hablada: ${analysis.sungTranscript}`);
    if (analysis.unknownTranscript) lines.push(`Transcripción sin clasificación (${item.id}); no atribuida a voz hablada: ${analysis.unknownTranscript}`);
    for (const evidence of analysis.evidence) {
      if (evidence.kind === 'visual') visualEvidence.push(evidence);
      lines.push(`Formato visual observado ${evidence.formatName}, medio ${item.id}: ${evidence.quote}`);
    }
    if (analysis.audioClassification.status === 'classified') {
      const intervals = audioIntervals(analysis.audioClassification, item.id);
      audioEvidence.push({ mediaId: item.id, ...analysis.audioClassification, intervals });
      lines.push(...intervals);
    } else if (item.kind === 'audio') {
      const unknown = `Audio ${item.id}: no se verificó su clasificación entre voz hablada, música y canto; composición desconocida.`;
      audioEvidence.push({ mediaId: item.id, status: 'unknown', segments: [], intervals: [unknown] });
      lines.push(unknown);
    }
  }
  const fullText = lines.join('\n\n'), text = fullText.slice(0, 12000);
  const truncated = fullText.length > text.length;
  return { ...extraction, configured: true, results: [{ url: extraction.sourceUrl, text, title: 'Medios públicos analizados',
    mediaVerified: true, complete: extraction.coverage.complete && !truncated, truncated,
    visualEvidence: visualEvidence.filter(item => text.includes(item.quote)), literalText: literal.join('\n\n').slice(0, 12000), audioEvidence,
    mediaCoverage: extraction.coverage, limitations: extraction.limitations }],
    reason: 'Se analizaron medios públicos de la URL indicada. Las observaciones visuales, el OCR y el audio conservan su procedencia y los límites de cobertura.' };
}

/** Prefer connected media analysis; fall back only for explicitly compatible availability errors. */
export async function readRequestedPublicSource(input, services = {}) {
  if (typeof services.extractPublicMedia === 'function') {
    const result = await services.extractPublicMedia({ ownerPhone: input.ownerPhone, agent: input.agent, url: input.url,
      eventId: input.eventId, now: input.now, ...(input.operationId ? { operationId: input.operationId } : {}),
      idempotencyKey: `public-media:${input.eventId}` });
    if (result?.status === 'waiting_approval' || result?.allowed === false) return result;
    const evidence = publicMediaEvidence(result, { url: input.url });
    if (evidence.status !== 'blocked' || !evidence.textFallbackAllowed) return evidence;
  }
  if (typeof services.readPublicSource === 'function') return services.readPublicSource(input);
  if (typeof services.researchPublicMarketing === 'function') return services.researchPublicMarketing({ ...input,
    query: `Lee el contenido público de esta URL exacta: ${input.url}. Identifica los formatos con evidencia; no sustituyas la fuente.`.slice(0, 700) });
  return { status: 'blocked', reason: 'source_reader_not_connected', sourceUrl: input.url };
}
