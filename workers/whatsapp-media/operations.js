import { publicInstagramResearchUrl } from '../whatsapp/owner-research-request.js';
import { analyzePublicMedia, createPublicMediaAnalysisServices } from '../whatsapp/public-media-analysis.js';

export const MEDIA_LIMITS = Object.freeze({ lifetimeMs: 900000, processingMs: 600000, leaseMs: 300000, copyBatch: 8, analysisBatch: 1,
  totalBytes: 400000000, visualBytes: 6000000, chunkBytes: 1048576, artifactBytes: 100000000,
  frames: 3000, media: 20, collages: 32, images: 20, audioChunks: 10, jsonBytes: 1000000 });
// Historical IDs identify archived media operations, not active bot personas.
const AGENTS = ['melodi', 'dona', 'emily', 'lila', 'mora', 'stacy'];
const TERMINAL = ['ready', 'blocked', 'cancelled'];
const FILE = /^[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|img|mp4|webm|mka|wav)$/;
const text = (value, max) => typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '';
const phone = value => String(value || '').replace(/\D/g, '');
const changed = result => Number(result?.meta?.changes || 0) > 0;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const fail = code => { throw new Error(code); };
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const base64 = value => {
  if (typeof value.toBase64 === 'function') return value.toBase64();
  let str = ''; for (let i = 0; i < value.length; i += 16384) str += String.fromCharCode(...value.subarray(i, i + 16384)); return btoa(str);
};
const unbase64 = value => {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(value);
  const str = atob(value), bytes = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i); return bytes;
};
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export const MEDIA_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS wa_public_media_operations (id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('pending','downloading','analyzing','ready','blocked','cancelled')),
    request_cipher TEXT NOT NULL, request_iv TEXT NOT NULL, checkpoint_cipher TEXT, checkpoint_iv TEXT,
    result_cipher TEXT, result_iv TEXT, reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
    dispatch_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS idx_public_media_expiry ON wa_public_media_operations(status,expires_at)',
];

function sourceIdentity(value) {
  const canonical = new URL(value); canonical.search = ''; canonical.hash = ''; canonical.hostname = 'www.instagram.com';
  canonical.pathname = canonical.pathname.replace(/^\/reels\//, '/reel/').replace(/\/?$/, '/');
  return canonical.href;
}

function validateRequest(input, env) {
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !['ownerPhone', 'agent', 'url', 'eventId', 'operationId'].includes(key))) fail('invalid_request');
  const ownerPhone = phone(input.ownerPhone), owner = phone(env.OWNER_WHATSAPP_NUMBER);
  if (!owner || ownerPhone !== owner) fail('owner_not_allowed');
  const agent = text(input.agent, 20).toLowerCase(), eventId = text(input.eventId, 200);
  if (!AGENTS.includes(agent) || !eventId || eventId !== input.eventId || /[\r\n]/.test(eventId)) fail('invalid_request');
  const parsed = publicInstagramResearchUrl(input.url);
  if (!parsed || parsed.sourceUrl !== input.url || input.url.length > 2048) fail('invalid_source_url');
  const operationId = input.operationId;
  if (operationId !== undefined && (typeof operationId !== 'string' || !/^pm-[a-f0-9]{64}$/.test(operationId))) fail('invalid_operation_id');
  return { ownerPhone, agent, eventId, sourceUrl: parsed.sourceUrl, sourceIdentity: sourceIdentity(parsed.sourceUrl), operationId };
}

export async function mediaOperationId(input) {
  return `pm-${await hash(JSON.stringify([input.ownerPhone, input.agent, input.eventId, input.sourceIdentity]))}`;
}

const privateArtifactKey = (id, file) => `public-media/${id.slice(3)}/${file}`;
const compactSource = (value, source) => value?.sourceUrl === source ? { ...value, sourceUrl: 0 } : value;
const expandSource = (value, source) => {
  if (value?.sourceUrl === 0) value.sourceUrl = source;
  return value;
};

// Analysis exposes the same evidence through several views. Persist the rows
// once when these views share references, then reconstruct every view on read.
// Unknown/older shapes are retained rather than assuming they are duplicates.
function compactAnalysis(result, source) {
  const flattened = [], visualIndexes = [];
  const media = (result.media || []).map((item, index) => {
    const analysis = item.analysis;
    if (!analysis) return item;
    const evidence = analysis.evidence || [];
    flattened.push(...evidence);
    const indexes = new Map(evidence.map((row, position) => [row, position]));
    const visual = analysis.observations?.visual;
    let observations = analysis.observations;
    if (Array.isArray(visual) && visual.every(row => indexes.has(row))) {
      visualIndexes[index] = visual.map(row => indexes.get(row));
      observations = { ...observations }; delete observations.visual;
    } else if (Array.isArray(visual)) observations = { ...observations, visual: visual.map(row => compactSource(row, source)) };
    return { ...item, analysis: { ...analysis, evidence: evidence.map(row => compactSource(row, source)), observations } };
  });
  const flat = Array.isArray(result.evidence) && result.evidence.length === flattened.length
    && result.evidence.every((row, index) => row === flattened[index]);
  const data = { ...compactSource(result, source), media };
  if (flat) delete data.evidence;
  else if (Array.isArray(data.evidence)) data.evidence = data.evidence.map(row => compactSource(row, source));
  return [data, flat, visualIndexes];
}

function expandAnalysis([result, flat, visualIndexes], source) {
  expandSource(result, source);
  for (const [index, item] of (result.media || []).entries()) {
    if (!item.analysis) continue;
    const evidence = item.analysis.evidence || [];
    evidence.forEach(row => expandSource(row, source));
    if (Array.isArray(visualIndexes[index])) {
      item.analysis.observations.visual = visualIndexes[index].map(position => evidence[position]);
    } else item.analysis.observations?.visual?.forEach(row => expandSource(row, source));
  }
  if (flat) result.evidence = (result.media || []).flatMap(item => item.analysis?.evidence || []);
  else result.evidence?.forEach(row => expandSource(row, source));
  return result;
}

// Thousands of frames must not repeat the exact (up to 2048-byte) source,
// coverage, or derivable private R2 path in every encrypted checkpoint.
function compactCheckpoint(checkpoint, id) {
  const manifest = checkpoint.manifest, source = manifest?.sourceUrl || '';
  const artifacts = manifest?.artifacts || [];
  const fileIndexes = new Map(artifacts.map((artifact, index) => [artifact.file, index]));
  const items = manifest?.items || [];
  const mediaIndexes = new Map(items.filter(item => !item.unavailable).map(item => [item.mediaId, items.indexOf(item)]));
  const fileIndex = file => fileIndexes.has(file) ? fileIndexes.get(file) : file;
  const data = { ...checkpoint,
    manifest: manifest ? { ...manifest, sourceUrl: 0, items: items.map(item => compactSource(item, source)),
      artifacts: artifacts.map(artifact => {
        const { file, type, max, mediaId, sourceUrl, coverage, durationSeconds, frames: frameRows, ...extra } = artifact;
        const base = mediaIndexes.has(mediaId) ? mediaIndexes.get(mediaId)
          : compactSource({ mediaId, sourceUrl, coverage, durationSeconds }, source);
        return [file, type, max, base, frameRows ? frameRows.map(frame => [frame.index, frame.timestampMs]) : null, extra];
      }) } : null,
    copied: Object.entries(checkpoint.copied || {}).map(([file, reference]) => {
      const row = [fileIndex(file), reference.size];
      if (reference.mimeType !== artifactMime(file)) row[2] = reference.mimeType;
      if (reference.key !== privateArtifactKey(id, file)) { row[2] ??= null; row[3] = reference.key; }
      return row;
    }),
    analyses: Object.entries(checkpoint.analyses || {}).map(([file, result]) => [fileIndex(file), compactAnalysis(result, source)]),
  };
  return { checkpointFormat: 1, source, data };
}

function expandCheckpoint(value, id) {
  if (value?.checkpointFormat !== 1) return value; // Previously saved expanded checkpoints remain valid.
  const { source, data } = value, manifest = data.manifest;
  if (manifest) {
    manifest.sourceUrl = source;
    manifest.items.forEach(item => expandSource(item, source));
    manifest.artifacts = manifest.artifacts.map(([file, type, max, metadata, frameRows, extra]) => {
      const item = typeof metadata === 'number' ? manifest.items[metadata] : expandSource(metadata, source);
      return { file, type, max, mediaId: item.mediaId, sourceUrl: item.sourceUrl, coverage: item.coverage,
        durationSeconds: item.durationSeconds, ...(frameRows ? { frames: frameRows.map(([index, timestampMs]) => ({ index, timestampMs })) } : {}), ...extra };
    });
  }
  const fileName = index => typeof index === 'number' ? manifest.artifacts[index].file : index;
  data.copied = Object.fromEntries(data.copied.map(([index, size, mimeType, key]) => {
    const file = fileName(index);
    return [file, { size, mimeType: mimeType ?? artifactMime(file), key: key ?? privateArtifactKey(id, file) }];
  }));
  data.analyses = Object.fromEntries(data.analyses.map(([index, result]) => [fileName(index), expandAnalysis(result, source)]));
  return data;
}

export function createMediaOperationStore(env, { now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  const db = env.MEDIA_DB || env.DB;
  let imported;
  async function key() {
    if (!imported) {
      let raw; try { raw = unbase64(env.MEDIA_ENCRYPTION_KEY); } catch { fail('media_encryption_not_configured'); }
      if (raw.length !== 32) fail('media_encryption_not_configured');
      imported = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    return imported;
  }
  async function seal(value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    if (encoded.length > 1400000) fail('operation_state_limit');
    return { cipher: base64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), encoded))), iv: base64(iv) };
  }
  async function open(cipher, iv) {
    if (!cipher) return null;
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv) }, await key(), unbase64(cipher))));
  }
  async function get(id) {
    const row = await db.prepare('SELECT * FROM wa_public_media_operations WHERE id=?').bind(id).first();
    if (!row) return null;
    return { ...row, request: await open(row.request_cipher, row.request_iv),
      checkpoint: expandCheckpoint(await open(row.checkpoint_cipher, row.checkpoint_iv), id), result: await open(row.result_cipher, row.result_iv) };
  }
  return {
    async ensureSchema() { await key(); await db.batch(MEDIA_SCHEMA.map(sql => db.prepare(sql))); },
    get,
    metadata(id) { return db.prepare('SELECT id,status,reason,lease_token,lease_until,expires_at,dispatch_until FROM wa_public_media_operations WHERE id=?').bind(id).first(); },
    async create(input) {
      const id = await mediaOperationId(input), encrypted = await seal(input), at = now();
      await db.prepare(`INSERT OR IGNORE INTO wa_public_media_operations
        (id,status,request_cipher,request_iv,created_at,updated_at,expires_at) VALUES (?,'pending',?,?,?,?,?)`)
        .bind(id, encrypted.cipher, encrypted.iv, at, at, at + MEDIA_LIMITS.lifetimeMs).run();
      return get(id);
    },
    async dispatch(id, { includeLeased = false } = {}) {
      const at = now();
      return changed(await db.prepare(`UPDATE wa_public_media_operations SET dispatch_until=MAX(?+30000,lease_until+30000) WHERE id=?
        AND (status='pending' OR (?=1 AND status IN ('downloading','analyzing')))
        AND dispatch_until<=? AND expires_at>?`).bind(at, id, Number(includeLeased), at, at).run());
    },
    async releaseDispatch(id, dispatchUntil) {
      await db.prepare(`UPDATE wa_public_media_operations SET dispatch_until=0 WHERE id=? AND dispatch_until=?
        AND status IN ('pending','downloading','analyzing')`).bind(id, dispatchUntil).run();
    },
    async claim(id) {
      const at = now(), token = uuid();
      await db.prepare(`UPDATE wa_public_media_operations SET status='blocked',reason=CASE WHEN expires_at<=? THEN 'operation_expired' ELSE 'processing_retry_limit' END,
        lease_token=NULL,lease_until=0 WHERE id=? AND status NOT IN ('ready','blocked','cancelled')
        AND (expires_at<=? OR (attempts>=3 AND lease_until<=?))`).bind(at, id, at, at).run();
      const result = await db.prepare(`UPDATE wa_public_media_operations SET status='downloading',lease_token=?,lease_until=MIN(?,expires_at),
        attempts=attempts+1,dispatch_until=0,updated_at=? WHERE id=? AND expires_at>? AND attempts<3 AND
        (status='pending' OR (status IN ('downloading','analyzing') AND lease_until<=?))`)
        .bind(token, at + MEDIA_LIMITS.leaseMs, at, id, at, at).run();
      return changed(result) ? { ...(await get(id)), token } : null;
    },
    async save(id, token, status, checkpoint) {
      const encrypted = await seal(compactCheckpoint(checkpoint, id)), at = now();
      return changed(await db.prepare(`UPDATE wa_public_media_operations SET status=?,checkpoint_cipher=?,checkpoint_iv=?,updated_at=?
        WHERE id=? AND lease_token=? AND status IN ('downloading','analyzing') AND lease_until>? AND expires_at>?`)
        .bind(status, encrypted.cipher, encrypted.iv, at, id, token, at, at).run());
    },
    // Deliberate batching is progress, not a failure or a new operation.
    async defer(id, token, checkpoint) {
      const encrypted = await seal(compactCheckpoint(checkpoint, id)), at = now();
      return changed(await db.prepare(`UPDATE wa_public_media_operations SET status='pending',checkpoint_cipher=?,checkpoint_iv=?,updated_at=?,
        attempts=MAX(0,attempts-1),lease_token=NULL,lease_until=0,dispatch_until=0
        WHERE id=? AND lease_token=? AND status IN ('downloading','analyzing') AND lease_until>? AND expires_at>?`)
        .bind(encrypted.cipher, encrypted.iv, at, id, token, at, at).run());
    },
    async finish(id, token, status, result = null, reason = null) {
      if (!TERMINAL.includes(status)) fail('invalid_operation_status');
      const encrypted = result ? await seal(result) : { cipher: null, iv: null }, at = now();
      return changed(await db.prepare(`UPDATE wa_public_media_operations SET status=?,result_cipher=?,result_iv=?,reason=?,updated_at=?,
        lease_token=NULL,lease_until=0,checkpoint_cipher=NULL,checkpoint_iv=NULL
        WHERE id=? AND lease_token=? AND status IN ('downloading','analyzing') AND expires_at>? AND lease_until>?`)
        .bind(status, encrypted.cipher, encrypted.iv, reason, at, id, token, at, at).run());
    },
    async blockPending(id, reason) {
      await db.prepare(`UPDATE wa_public_media_operations SET status='blocked',reason=?,updated_at=? WHERE id=? AND status='pending'`)
        .bind(reason, now(), id).run();
    },
    async cancel(id) {
      return changed(await db.prepare(`UPDATE wa_public_media_operations SET status='cancelled',reason='owner_cancelled',lease_token=NULL,
        lease_until=0,checkpoint_cipher=NULL,checkpoint_iv=NULL,updated_at=?
        WHERE id=? AND status IN ('pending','downloading','analyzing')`).bind(now(), id).run());
    },
  };
}

function processorOrigin(env) {
  if (env.MEDIA_PROCESSOR?.fetch && env.MEDIA_PROCESSOR_TOKEN) return 'https://processor.internal';
  if (!env.MEDIA_PROCESSOR_URL || !env.MEDIA_PROCESSOR_TOKEN) return null;
  try {
    const url = new URL(env.MEDIA_PROCESSOR_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
      || url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return null;
    return url.origin;
  } catch { return null; }
}

export function mediaHealth(env) {
  return json({ status: 'ok', capabilities: { privateServiceBinding: true, queued: !!env.MEDIA_JOBS,
    durable: !!(env.MEDIA_DB || env.DB) && !!env.MEDIA_ENCRYPTION_KEY, privateArtifacts: !!env.VETSA_MEDIA,
    processor: { configured: !!processorOrigin(env), verifiedConnection: false },
    vision: !!env.VETSA_INTELLIGENCE, transcription: !!env.AI,
    audioClassification: 'processor_if_configured' }, limits: { lifetimeMs: MEDIA_LIMITS.lifetimeMs,
    processingMs: MEDIA_LIMITS.processingMs, maxFrames: MEDIA_LIMITS.frames, selectedCollages: MEDIA_LIMITS.collages,
    selectedImages: MEDIA_LIMITS.images, selectedAudioChunks: MEDIA_LIMITS.audioChunks } });
}

async function boundedBytes(response, max) {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) { await response.body?.cancel(); fail('response_byte_limit'); }
  if (!response.body) fail('empty_response');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > max) fail('response_byte_limit'); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const result = new Uint8Array(total); let position = 0;
  for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
  return result;
}

async function boundedJson(response, max) {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); fail('processor_invalid_manifest'); }
  try { return JSON.parse(new TextDecoder().decode(await boundedBytes(response, max))); }
  catch (error) { if (error.message === 'response_byte_limit') throw error; fail('processor_invalid_manifest'); }
}

const receiptScope = input => ({ ownerPhone: input.ownerPhone, agent: input.agent, eventId: input.eventId, sourceUrl: input.sourceUrl });
function publicOperation(row, at = Date.now()) {
  const scope = row.request ? receiptScope(row.request) : {};
  if (row.expires_at <= at && row.status === 'ready') return { ...scope, status: 'blocked', verified: false, operationId: row.id, reason: 'operation_expired' };
  if (row.status === 'ready') return { ...row.result, ...scope, operationId: row.id, startedAt: new Date(row.created_at).toISOString() };
  if (['blocked', 'cancelled'].includes(row.status)) return { ...scope, status: row.status, verified: false, operationId: row.id,
    reason: row.reason || 'processor_unavailable', ...(row.reason === 'backend_not_connected' ? { textFallbackAllowed: true } : {}) };
  return { ...scope, status: 'pending', verified: true, operationId: row.id, startedAt: new Date(row.created_at).toISOString(),
    phase: row.status, retryAfterMs: 5000, expiresAt: new Date(row.expires_at).toISOString() };
}

async function dispatchMediaOperation(env, store, id, { now = Date.now, includeLeased = false, continuation = 0 } = {}) {
  if (!await store.dispatch(id, { includeLeased })) return false;
  const row = await store.metadata(id);
  if (!row || TERMINAL.includes(row.status)) return false;
  const delaySeconds = Math.max(0, Math.ceil((row.lease_until - now()) / 1000) + (row.lease_until > now() ? 1 : 0));
  try {
    await env.MEDIA_JOBS.send({ version: 1, operationId: id, ...(continuation ? { continuation } : {}) }, { delaySeconds });
  } catch (error) { await store.releaseDispatch(id, row.dispatch_until); throw error; }
  return true;
}

export async function handleMediaRequest(request, env, { now = Date.now } = {}) {
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/health') return mediaHealth(env);
  if (request.method !== 'POST' || !['/v1/analyze', '/v1/cancel'].includes(path)) return json({ error: 'not_found' }, 404);
  let input;
  try { input = validateRequest(await boundedJson(request, 8192), env); }
  catch (error) { return json({ status: 'blocked', verified: false, reason: error.message }, error.message === 'owner_not_allowed' ? 403 : 400); }
  const scope = { ...receiptScope(input), ...(input.operationId ? { operationId: input.operationId } : {}) };
  if (!(env.MEDIA_DB || env.DB) || !env.MEDIA_ENCRYPTION_KEY || !env.MEDIA_JOBS || !env.VETSA_MEDIA) return json({ ...scope, status: 'blocked', verified: false, reason: 'backend_not_connected', textFallbackAllowed: true });
  const store = createMediaOperationStore(env, { now });
  try {
    await store.ensureSchema();
    let row = input.operationId ? await store.get(input.operationId) : await store.create(input);
    const expected = await mediaOperationId(input);
    if (!row || row.id !== expected || row.request.ownerPhone !== input.ownerPhone || row.request.agent !== input.agent
      || row.request.eventId !== input.eventId || row.request.sourceIdentity !== input.sourceIdentity) return json({ ...scope, status: 'blocked', verified: false, reason: 'operation_scope_mismatch' }, 403);
    if (path === '/v1/cancel') { await store.cancel(row.id); return json(publicOperation(await store.get(row.id), now())); }
    if (row.expires_at <= now() && !TERMINAL.includes(row.status)) { await store.claim(row.id); row = await store.get(row.id); }
    if (row.status === 'pending' || ['downloading', 'analyzing'].includes(row.status) && row.lease_until <= now()) {
      if (!processorOrigin(env)) await store.blockPending(row.id, 'backend_not_connected');
      else try { await dispatchMediaOperation(env, store, row.id, { now, includeLeased: true,
        continuation: row.checkpoint?.continuation || 0 }); } catch { /* Scoped polling can retry dispatch without losing the checkpoint. */ }
      row = await store.get(row.id);
    }
    return json(publicOperation(row, now()));
  } catch { return json({ ...scope, status: 'blocked', verified: false, reason: 'backend_storage_unavailable' }, 503); }
}

function frames(value) {
  if (!Array.isArray(value) || !value.length || value.length > 64) fail('processor_invalid_frames');
  const seen = new Set();
  return value.map(frame => {
    if (!Number.isInteger(frame?.index) || frame.index < 0 || frame.index >= MEDIA_LIMITS.frames || seen.has(frame.index)
      || (frame.timestampMs !== null && (!finite(frame.timestampMs) || frame.timestampMs > 300000))) fail('processor_invalid_frames');
    seen.add(frame.index); return { index: frame.index, timestampMs: frame.timestampMs };
  });
}

export function decodeProcessorManifest(data, request) {
  if (!data || Array.isArray(data) || data.requestId !== request.id || data.sourceUrl !== request.request.sourceUrl
    || !['complete', 'partial', 'unavailable'].includes(data.status) || !Array.isArray(data.media) || data.media.length > MEDIA_LIMITS.media) fail('processor_scope_mismatch');
  const artifacts = new Map(), items = [], ids = new Set(); let extracted = 0;
  const add = (file, type, max, extra = {}) => {
    if (typeof file !== 'string' || !FILE.test(file)) fail('processor_invalid_artifact');
    const previous = artifacts.get(file);
    if (previous && (previous.type !== type || JSON.stringify(previous.frames || null) !== JSON.stringify(extra.frames || null))) fail('processor_artifact_conflict');
    if (!previous) artifacts.set(file, { file, type, max, ...extra });
    if (artifacts.size > 4800) fail('processor_artifact_limit');
    return file;
  };
  for (const item of data.media) {
    if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)
      || !['image', 'video'].includes(item.kind)) fail('processor_invalid_media');
    ids.add(item.id);
    if (item.status === 'unavailable') { items.push({ id: item.id, unavailable: true, reason: text(item.reason, 100) }); continue; }
    if (item.status !== 'processed') fail('processor_invalid_media');
    const sourceUrl = item.sourceUrl || data.sourceUrl;
    if (!publicInstagramResearchUrl(sourceUrl) || sourceUrl !== data.sourceUrl) fail('processor_invalid_source');
    if (item.kind === 'video' && (!finite(item.durationSeconds) || item.durationSeconds <= 0 || item.durationSeconds > 300)) fail('processor_invalid_media');
    const coverage = item.coverage;
    if (!coverage || typeof coverage.complete !== 'boolean' || !Number.isInteger(coverage.extractedFrames) || coverage.extractedFrames < 0
      || coverage.extractedFrames > MEDIA_LIMITS.frames || (coverage.totalFrames !== null && (!Number.isInteger(coverage.totalFrames) || coverage.totalFrames < coverage.extractedFrames))) fail('processor_invalid_coverage');
    const images = item.imageFiles || [], collages = item.collageFiles || [];
    if (!Array.isArray(images) || !Array.isArray(collages) || images.length > MEDIA_LIMITS.frames || collages.length > 188) fail('processor_artifact_limit');
    const imageFrames = images.map(frame => ({ file: frame.file, ...frames([{ index: frame.index, timestampMs: frame.timestampMs }])[0] }));
    if (item.kind === 'video' && imageFrames.some(frame => frame.timestampMs === null)) fail('processor_invalid_frames');
    if (new Set(imageFrames.map(frame => frame.index)).size !== imageFrames.length || images.length !== coverage.extractedFrames) fail('processor_invalid_coverage');
    extracted += images.length; if (extracted > MEDIA_LIMITS.frames) fail('processor_frame_limit');
    const known = new Map(imageFrames.map(frame => [frame.index, frame.timestampMs]));
    const base = { mediaId: item.id, sourceUrl, coverage, durationSeconds: finite(item.durationSeconds) ? item.durationSeconds : null };
    for (const frame of imageFrames) add(frame.file, 'image', MEDIA_LIMITS.visualBytes, { ...base, frames: [{ index: frame.index, timestampMs: frame.timestampMs }], staticImage: item.kind === 'image' });
    for (const collage of collages) {
      const selected = frames(collage.frames);
      if (selected.some(frame => !known.has(frame.index) || known.get(frame.index) !== frame.timestampMs)) fail('processor_invalid_frames');
      add(collage.file, 'framesheet', MEDIA_LIMITS.visualBytes, { ...base, frames: selected });
    }
    if (item.originalFile && item.originalFile !== item.videoFile) add(item.originalFile, 'original', MEDIA_LIMITS.artifactBytes, base);
    if (item.videoFile) add(item.videoFile, 'video', MEDIA_LIMITS.artifactBytes, base);
    const tracks = item.audio?.tracks || [];
    if (!Array.isArray(tracks) || tracks.length > 8) fail('processor_invalid_audio');
    for (const track of tracks) {
      if (!Number.isInteger(track.index) || track.index < 0) fail('processor_invalid_audio');
      if (track.originalFile) add(track.originalFile, 'original', MEDIA_LIMITS.artifactBytes, base);
      if (track.wav16kFile) add(track.wav16kFile, 'original', 10000000, base);
      const chunks = track.wav16kFiles || (track.wav16kFile && finite(item.durationSeconds) && item.durationSeconds <= 30
        ? [{ file: track.wav16kFile, startSeconds: 0, endSeconds: item.durationSeconds, classification: track.classification }] : []);
      if (!Array.isArray(chunks) || chunks.length > 10) fail('processor_invalid_audio');
      let last = 0;
      for (const chunk of chunks) {
        if (!finite(chunk.startSeconds) || !finite(chunk.endSeconds) || chunk.endSeconds <= chunk.startSeconds || chunk.startSeconds < last
          || chunk.endSeconds - chunk.startSeconds > 30.001 || chunk.endSeconds > 300 || (finite(item.durationSeconds) && chunk.endSeconds > item.durationSeconds + .02)) fail('processor_invalid_audio');
        last = chunk.endSeconds;
        const existing = artifacts.get(chunk.file); if (existing?.type === 'original') artifacts.delete(chunk.file);
        add(chunk.file, 'audio', MEDIA_LIMITS.chunkBytes, { ...base, trackIndex: track.index, startSeconds: chunk.startSeconds,
          endSeconds: chunk.endSeconds, audioClassification: chunk.classification || track.classification || { status: 'unknown' } });
      }
    }
    items.push({ ...base, kind: item.kind, audioPresent: item.audio?.present === true, audioTracks: tracks.length });
  }
  return { sourceUrl: data.sourceUrl, caption: text(data.caption, 12000), artifacts: [...artifacts.values()], items,
    processorCoverage: { complete: data.status === 'complete' && data.coverage?.complete === true,
      expectedMedia: Number.isInteger(data.coverage?.expectedMedia) ? data.coverage.expectedMedia : null,
      downloadedMedia: items.filter(item => !item.unavailable).length, extractedFrames: extracted,
      reasons: Array.isArray(data.coverage?.reasons) ? data.coverage.reasons.filter(value => typeof value === 'string').slice(0, 20).map(value => text(value, 100)) : [] } };
}

function artifactMime(file) {
  if (/\.(jpg|jpeg)$/.test(file)) return 'image/jpeg';
  if (/\.png$/.test(file)) return 'image/png';
  if (/\.webp$/.test(file)) return 'image/webp';
  if (/\.wav$/.test(file)) return 'audio/wav';
  if (/\.mp4$/.test(file)) return 'video/mp4';
  if (/\.webm$/.test(file)) return 'video/webm';
  if (/\.mka$/.test(file)) return 'audio/x-matroska';
  return 'application/octet-stream';
}
function validMagic(bytes, file) {
  const ascii = (at, str) => bytes.length >= at + str.length && [...str].every((char, i) => bytes[at + i] === char.charCodeAt(0));
  if (/\.(jpg|jpeg|img)$/.test(file) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/\.(png|img)$/.test(file) && bytes[0] === 137 && ascii(1, 'PNG\r\n\x1a\n')) return 'image/png';
  if (/\.(webp|img)$/.test(file) && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (/\.wav$/.test(file) && ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
  if (/\.mp4$/.test(file) && ascii(4, 'ftyp')) return 'video/mp4';
  if (/\.(webm|mka)$/.test(file) && [26,69,223,163].every((byte, i) => bytes[i] === byte)) return artifactMime(file);
  fail('processor_invalid_artifact_bytes');
}

async function copyArtifact(response, artifact, key, bucket, remaining, operation) {
  const length = response.headers.get('content-length');
  if (!length || !/^\d+$/.test(length) || Number(length) < 12 || Number(length) > Math.min(artifact.max, remaining)) { await response.body?.cancel(); fail('artifact_byte_limit'); }
  const expected = Number(length), reader = response.body?.getReader(); if (!reader) fail('empty_artifact');
  let first;
  try {
    const parts = []; let size = 0;
    while (size < 12) {
      const next = await reader.read(); if (next.done) fail('processor_invalid_artifact_bytes');
      size += next.value.length; if (size > expected) fail('artifact_byte_limit'); parts.push(next.value);
    }
    const value = new Uint8Array(size); let offset = 0;
    for (const part of parts) { value.set(part, offset); offset += part.length; }
    first = { value };
  }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  let mimeType;
  try { mimeType = validMagic(first.value, artifact.file); }
  catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const claimedType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (claimedType && !['application/octet-stream', mimeType, mimeType === 'audio/wav' ? 'audio/x-wav' : mimeType].includes(claimedType)) { await reader.cancel(); fail('processor_invalid_artifact_type'); }
  let count = first.value.length;
  const stream = new ReadableStream({
    start(controller) { if (count > expected) { controller.error(new Error('artifact_byte_limit')); reader.cancel(); } else controller.enqueue(first.value); },
    async pull(controller) {
      try { const { done, value } = await reader.read();
        if (done) { if (count !== expected) fail('artifact_length_mismatch'); controller.close(); return; }
        count += value.length; if (count > expected) fail('artifact_byte_limit'); controller.enqueue(value);
      } catch (error) { controller.error(error); await reader.cancel().catch(() => {}); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  // R2 requires a known-length stream. FixedLengthStream also rejects truncated or oversized bodies.
  const fixed = typeof FixedLengthStream === 'function' ? new FixedLengthStream(expected) : null;
  const piping = fixed ? stream.pipeTo(fixed.writable) : null;
  try {
    await bucket.put(key, fixed ? fixed.readable : stream, { httpMetadata: { contentType: mimeType },
      customMetadata: { operationId: operation.id, expiresAt: String(operation.expires_at) } });
    if (piping) await piping;
  } catch (error) { await reader.cancel().catch(() => {}); if (piping) await piping.catch(() => {}); throw error; }
  return { key, size: expected, mimeType };
}

async function deadlineCall(callback, ms, code = 'analysis_timeout') {
  if (ms <= 0) fail('processing_deadline');
  let timer;
  try { return await Promise.race([callback(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), ms); })]); }
  finally { clearTimeout(timer); }
}

function analysisClass(value, offset, duration) {
  const classification = value || { status: 'unknown' };
  return { ...classification, segments: (Array.isArray(classification.segments) ? classification.segments : [])
    .filter(segment => finite(segment.startSeconds) && finite(segment.endSeconds) && segment.endSeconds > offset && segment.startSeconds < offset + duration)
    .map(segment => ({ ...segment, startSeconds: Math.max(0, segment.startSeconds - offset), endSeconds: Math.min(duration, segment.endSeconds - offset),
      // YAMNet scores are uncalibrated. Keep observations, but ASR does not promote them to certain spoken words.
      confidence: ['high', 'medium', 'low'].includes(segment.confidence) ? segment.confidence : classification.processor === 'yamnet' ? 'low' : 'unknown' })) };
}

function offsetAudio(result, offset) {
  for (const item of result.media || []) {
    for (const evidence of item.analysis.evidence || []) if (evidence.kind === 'audio') {
      if (finite(evidence.timestampMs)) evidence.timestampMs += offset * 1000;
      if (finite(evidence.startSeconds)) evidence.startSeconds += offset;
      if (finite(evidence.endSeconds)) evidence.endSeconds += offset;
    }
    for (const name of ['audioClassification', 'observations']) {
      const rows = name === 'audioClassification' ? item.analysis.audioClassification.segments : item.analysis.observations.audio;
      for (const segment of rows || []) { segment.startSeconds += offset; segment.endSeconds += offset; }
    }
    item.audioOffsetSeconds = offset;
  }
  return result;
}

/** Fair quotas per media/track; each quota >=2 includes its first and last samples. */
export function sampleMediaArtifacts(artifacts, limits = MEDIA_LIMITS) {
  const distribute = (candidates, budget, grouping) => {
    const groups = new Map();
    for (const artifact of candidates) {
      const group = grouping(artifact); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(artifact);
    }
    const entries = [...groups.values()];
    const quotas = entries.map(() => 0); let allocated = 0;
    while (allocated < budget) {
      let progress = false;
      for (let i = 0; i < entries.length && allocated < budget; i++) if (quotas[i] < entries[i].length) { quotas[i]++; allocated++; progress = true; }
      if (!progress) break;
    }
    return entries.flatMap((values, group) => {
      const count = quotas[group];
      if (!count) return [];
      if (count === 1) return [values[Math.floor((values.length - 1) / 2)]];
      return Array.from({ length: count }, (_, index) => values[Math.round(index * (values.length - 1) / (count - 1))]);
    });
  };
  const collaged = new Set(artifacts.filter(item => item.type === 'framesheet').map(item => item.mediaId));
  return [...distribute(artifacts.filter(item => item.type === 'framesheet' || item.type === 'image' && !item.staticImage && !collaged.has(item.mediaId)),
    Math.min(48, limits.collages), item => item.mediaId),
  ...distribute(artifacts.filter(item => item.type === 'image' && item.staticImage), Math.min(20, limits.images), item => item.mediaId),
  ...distribute(artifacts.filter(item => item.type === 'audio'), Math.min(10, limits.audioChunks), item => `${item.mediaId}:${item.trackIndex}`)];
}

export async function processMediaOperation(env, operationId, { now = Date.now, fetchImpl = fetch, analysisServices } = {}) {
  const store = createMediaOperationStore(env, { now }); await store.ensureSchema();
  const operation = await store.claim(operationId);
  if (!operation) return publicOperation(await store.get(operationId) || { status: 'blocked', id: operationId, reason: 'operation_not_found' }, now());
  const token = operation.token;
  const origin = processorOrigin(env);
  if (!origin) { await store.finish(operation.id, token, 'blocked', null, 'backend_not_connected'); return publicOperation(await store.get(operation.id), now()); }
  const checkpoint = operation.checkpoint || { manifest: null, copied: {}, analyses: {}, failures: [] };
  const startsProcessing = checkpoint.processingStartedAt === undefined;
  checkpoint.processingStartedAt ??= now();
  checkpoint.analysisErrors ||= {};
  // Preserve one global deadline across all continuations and interrupted leases.
  const processingDeadline = Math.min(checkpoint.processingStartedAt + MEDIA_LIMITS.processingMs, operation.expires_at) - 2000;
  const deadline = Math.min(processingDeadline, operation.lease_until - 2000);
  const batchLimit = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0
    ? Math.min(fallback, Number(value)) : fallback;
  const copyBatch = batchLimit(env.MEDIA_COPY_BATCH_SIZE, MEDIA_LIMITS.copyBatch);
  const analysisBatch = batchLimit(env.MEDIA_ANALYSIS_BATCH_SIZE, MEDIA_LIMITS.analysisBatch);
  const active = async () => {
    const current = await store.metadata(operation.id);
    if (!current || current.lease_token !== token || current.lease_until <= now() || !['downloading', 'analyzing'].includes(current.status)) fail('operation_cancelled');
    if (now() >= deadline) fail('processing_deadline');
  };
  const save = async status => { if (!(await store.save(operation.id, token, status, checkpoint))) fail('operation_cancelled'); };
  const continueLater = async phase => {
    checkpoint.phase = phase;
    checkpoint.continuation = (checkpoint.continuation || 0) + 1;
    if (!await store.defer(operation.id, token, checkpoint)) fail('operation_cancelled');
    try { await dispatchMediaOperation(env, store, operation.id, { now, continuation: checkpoint.continuation }); }
    catch { /* Keep durable progress pending; owner polling or the consumer repairs queue dispatch. */ }
    // The request is unchanged; avoid decrypting and parsing the complete
    // checkpoint just written merely to construct a small pending receipt.
    const current = await store.metadata(operation.id);
    return publicOperation(current?.status === 'ready' ? await store.get(operation.id) : { ...operation, ...current }, now());
  };
  const requestProcessor = async (path, options = {}, maxMs = 30000) => {
    await active();
    const processorRequest = new Request(`${origin}${path}`, { ...options, redirect: 'manual',
      headers: { ...options.headers, authorization: `Bearer ${env.MEDIA_PROCESSOR_TOKEN}` },
      signal: AbortSignal.timeout(Math.max(1, Math.min(maxMs, deadline - now()))) });
    const response = env.MEDIA_PROCESSOR?.fetch ? await env.MEDIA_PROCESSOR.fetch(processorRequest) : await fetchImpl(processorRequest);
    if (!response.ok || response.redirected) { await response.body?.cancel();
      fail(response.status === 401 || response.status === 403 ? 'processor_auth_failed' : response.status >= 300 && response.status < 400 || response.redirected ? 'processor_redirect_rejected' : 'processor_unavailable'); }
    return response;
  };
  try {
    await active();
    if (startsProcessing) await save('downloading');
    if (!checkpoint.manifest) {
      const response = await requestProcessor('/v1/process', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUrl: operation.request.sourceUrl, requestId: operation.id }) }, 200000);
      checkpoint.manifest = decodeProcessorManifest(await boundedJson(response, MEDIA_LIMITS.jsonBytes), operation);
      if (!checkpoint.manifest.artifacts.length) fail('public_media_unavailable');
      return await continueLater('downloading');
    }
    const manifest = checkpoint.manifest;
    if (!manifest.artifacts.length) fail('public_media_unavailable');
    let copies = 0;
    let used = Object.values(checkpoint.copied).reduce((total, entry) => total + entry.size, 0);
    for (const artifact of manifest.artifacts) {
      if (checkpoint.copied[artifact.file]) continue;
      if (copies >= copyBatch || deadline - now() < 31000 && deadline !== processingDeadline) return await continueLater('downloading');
      await active();
      const artifactKey = privateArtifactKey(operation.id, artifact.file);
      // A crash after R2 accepted a complete copy can precede its D1 checkpoint.
      // Recover only our own exact private object; never copy it a second time.
      const existing = typeof env.VETSA_MEDIA.head === 'function' ? await env.VETSA_MEDIA.head(artifactKey) : null;
      if (existing?.customMetadata?.operationId === operation.id && existing.customMetadata.expiresAt === String(operation.expires_at)
        && Number.isInteger(existing.size) && existing.size >= 12 && existing.size <= Math.min(artifact.max, MEDIA_LIMITS.totalBytes - used)
        && (existing.httpMetadata?.contentType === artifactMime(artifact.file)
          || /\.img$/.test(artifact.file) && ['image/jpeg', 'image/png', 'image/webp'].includes(existing.httpMetadata?.contentType))) {
        checkpoint.copied[artifact.file] = { key: artifactKey, size: existing.size, mimeType: existing.httpMetadata.contentType };
        used += existing.size;
        copies++;
        continue;
      }
      const response = await requestProcessor(`/v1/artifacts/${encodeURIComponent(operation.id)}/${encodeURIComponent(artifact.file)}`);
      checkpoint.copied[artifact.file] = await copyArtifact(response, artifact, artifactKey,
        env.VETSA_MEDIA, MEDIA_LIMITS.totalBytes - used, operation);
      used += checkpoint.copied[artifact.file].size;
      copies++;
    }
    await save('analyzing');
    const boundedEnv = { ...env, ...(env.VETSA_INTELLIGENCE ? { VETSA_INTELLIGENCE_API_KEY: 'service-binding', VETSA_INTELLIGENCE: { fetch: request => env.VETSA_INTELLIGENCE.fetch(
      new Request(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - now())))]) })) } } : {}) };
    const services = analysisServices || createPublicMediaAnalysisServices(boundedEnv);
    const selected = sampleMediaArtifacts(manifest.artifacts);
    const plannedFrames = new Set(selected.flatMap(artifact => (artifact.frames || []).map(frame => `${artifact.mediaId}:${frame.index}`)));
    const plannedComplete = manifest.processorCoverage.complete && plannedFrames.size === manifest.processorCoverage.extractedFrames
      && selected.filter(item => item.type === 'audio').length === manifest.artifacts.filter(item => item.type === 'audio').length;
    let analyzed = 0;
    for (const artifact of selected) {
      if (checkpoint.analyses[artifact.file] || checkpoint.analysisErrors[artifact.file]) continue;
      if (analyzed >= analysisBatch || deadline - now() < 21000 && deadline !== processingDeadline) return await continueLater('analyzing');
      if (deadline - now() < 1000) { checkpoint.failures.push('processing_deadline'); break; }
      await active();
      const reference = checkpoint.copied[artifact.file];
      try {
        const object = await env.VETSA_MEDIA.get(reference.key);
        if (!object || (object.size !== undefined && object.size > artifact.max)) fail('private_artifact_unavailable');
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (bytes.length !== reference.size || bytes.length > artifact.max) fail('private_artifact_unavailable');
        const audio = artifact.type === 'audio', duration = audio ? artifact.endSeconds - artifact.startSeconds : artifact.durationSeconds;
        const result = await deadlineCall(() => analyzePublicMedia({ agent: operation.request.agent, owner: operation.request.ownerPhone,
          eventId: operation.request.eventId, sourceUrl: artifact.sourceUrl,
          media: [{ id: `${artifact.mediaId}-${artifact.file.replace(/\.[^.]+$/, '')}`, kind: artifact.type, bytes, mimeType: reference.mimeType,
            frames: artifact.frames, durationSeconds: duration, audioClassification: audio ? analysisClass(artifact.audioClassification, artifact.startSeconds, duration) : undefined,
            coverage: { ...artifact.coverage, complete: artifact.coverage.complete === true && plannedComplete } }] }, services),
          Math.min(20000, deadline - now()));
        if (['waiting_approval', 'blocked', 'cancelled'].includes(result.status)) fail('analysis_service_rejected');
        checkpoint.analyses[artifact.file] = audio ? offsetAudio(result, artifact.startSeconds) : result;
      } catch (error) {
        if (['operation_cancelled', 'analysis_service_rejected'].includes(error.message)) throw error;
        const reason = ['analysis_timeout', 'private_artifact_unavailable'].includes(error.message) ? error.message : 'analysis_unavailable';
        checkpoint.analysisErrors[artifact.file] = reason;
        checkpoint.failures.push(reason);
      }
      analyzed++;
      await save('analyzing');
    }
    const analyses = Object.values(checkpoint.analyses), media = analyses.flatMap(result => result.media || []);
    const selectedFrames = new Set();
    for (const artifact of selected) if (checkpoint.analyses[artifact.file]?.media?.length) for (const frame of artifact.frames || []) selectedFrames.add(`${artifact.mediaId}:${frame.index}`);
    const availableAudio = manifest.artifacts.filter(item => item.type === 'audio').length;
    const analyzedAudio = selected.filter(item => item.type === 'audio' && checkpoint.analyses[item.file]?.media?.length).length;
    const complete = manifest.processorCoverage.complete && selectedFrames.size === manifest.processorCoverage.extractedFrames && availableAudio === analyzedAudio
      && !checkpoint.failures.length && media.length > 0 && analyses.every(result => result.coverage?.complete);
    const limitations = [...new Set([...(analyses.flatMap(result => result.limitations || [])), ...checkpoint.failures,
      ...manifest.processorCoverage.reasons, ...(!complete ? ['partial_media_analysis', 'La cobertura indica qué fotogramas y audio se analizaron; no equivale a revisar toda la publicación.'] : []),
      ...(manifest.items.some(item => item.audioPresent && !availableAudio) ? ['audio_chunks_unavailable'] : [])])];
    if (!media.length) fail(checkpoint.failures.includes('analysis_timeout') ? 'analysis_timeout' : 'analysis_unavailable');
    const result = { status: 'ready', verified: true, ownerPhone: operation.request.ownerPhone, agent: operation.request.agent,
      eventId: operation.request.eventId, sourceUrl: operation.request.sourceUrl, caption: manifest.caption, media,
      coverage: { ...manifest.processorCoverage, complete, analysisCoverage: { selectedFrames: selectedFrames.size,
        totalFrames: manifest.items.reduce((total, item) => total + (item.coverage?.totalFrames ?? item.coverage?.extractedFrames ?? 0), 0),
        extractedFrames: manifest.processorCoverage.extractedFrames, selectedCollages: selected.filter(item => item.type === 'framesheet').length,
        selectedImages: selected.filter(item => item.type === 'image').length, audioChunks: analyzedAudio, availableAudioChunks: availableAudio,
        copiedArtifacts: Object.keys(checkpoint.copied).length } }, limitations };
    result.coverage.analysisCoverage.analyzedMedia = media.length;
    // Keep the service response below the client's 1 MiB bound, retaining audio first and declaring any omitted evidence.
    if (new TextEncoder().encode(JSON.stringify(result)).length > 950000) {
      result.media.sort((a, b) => Number(b.kind === 'audio') - Number(a.kind === 'audio'));
      while (result.media.length > 1 && new TextEncoder().encode(JSON.stringify(result)).length > 940000) result.media.pop();
      result.coverage.complete = false; result.limitations.push('report_evidence_byte_limit');
    }
    result.coverage.analysisCoverage.reportedMedia = result.media.length;
    if (await store.finish(operation.id, token, 'ready', result)) return publicOperation({ ...operation, status: 'ready', result }, now());
  } catch (error) {
    const reasons = ['backend_not_connected', 'processor_auth_failed', 'processor_redirect_rejected', 'processor_unavailable',
      'processor_scope_mismatch', 'processor_invalid_manifest', 'processor_invalid_artifact', 'processor_invalid_artifact_bytes',
      'processor_invalid_artifact_type', 'processor_invalid_frames', 'processor_invalid_coverage', 'processor_invalid_audio',
      'processor_artifact_conflict', 'processor_artifact_limit', 'processor_frame_limit', 'processor_invalid_media', 'processor_invalid_source',
      'response_byte_limit', 'artifact_byte_limit', 'artifact_length_mismatch', 'public_media_unavailable', 'processing_deadline',
      'analysis_unavailable', 'analysis_timeout', 'analysis_service_rejected'];
    if (error.message !== 'operation_cancelled') await store.finish(operation.id, token, 'blocked', null, reasons.includes(error.message) ? error.message : 'processor_unavailable');
  }
  return publicOperation(await store.get(operation.id), now());
}

export async function processMediaQueue(batch, env, options = {}) {
  for (const message of batch.messages) {
    if (message.body?.version !== 1 || !/^pm-[a-f0-9]{64}$/.test(message.body?.operationId || '')) { message.ack(); continue; }
    try {
      const result = await processMediaOperation(env, message.body.operationId, options);
      if (result.status === 'pending') {
        const store = createMediaOperationStore(env, options);
        const row = await store.metadata(message.body.operationId);
        if (row && !TERMINAL.includes(row.status)) await dispatchMediaOperation(env, store, row.id,
          { now: options.now || Date.now, includeLeased: true });
        // A distinct, durable continuation is queued; max_retries remains for actual failures.
        message.ack();
      } else message.ack();
    }
    catch { message.retry({ delaySeconds: 30 }); }
  }
}
