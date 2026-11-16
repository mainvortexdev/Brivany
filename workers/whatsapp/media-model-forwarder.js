import { PUBLIC_VISUAL_PROMPT } from './public-media-analysis.js';

const MAX_BODY = 8_200_000;
const MAX_IMAGE = 6_000_000;
const reply = (error, status) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });

async function readLimited(stream, max) {
  if (!stream) throw new Error('empty_body');
  const reader = stream.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > max) { await reader.cancel(); throw new Error('body_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

function validImage(value) {
  if (typeof value !== 'string') return false;
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > 8_000_000 || match[2].length % 4 !== 0) return false;
  let binary; try { binary = atob(match[2]); } catch { return false; }
  if (binary.length < 12 || binary.length > MAX_IMAGE) return false;
  const magic = (at, str) => binary.slice(at, at + str.length) === str;
  if (match[1] === 'image/jpeg') return magic(0, '\xff\xd8\xff');
  if (match[1] === 'image/png') return magic(0, '\x89PNG\r\n\x1a\n');
  if (match[1] === 'image/webp') return magic(0, 'RIFF') && magic(8, 'WEBP');
  return magic(0, 'GIF87a') || magic(0, 'GIF89a');
}

/** Only the private MediaModels entrypoint calls this function. Provider secrets stay in the assistant. */
export async function forwardPublicMediaModel(request, env) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/generate') return reply('not_found', 404);
  let input;
  try { input = JSON.parse(new TextDecoder().decode(await readLimited(request.body, MAX_BODY))); }
  catch { return reply('invalid_media_request', 400); }
  const options = input?.options;
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !['model', 'contents', 'options'].includes(key))
    || input.model !== 'spaik-sight' || typeof input.contents !== 'string' || input.contents.length > 32000
    || !options || Array.isArray(options) || Object.keys(options).some(key => !['image', 'systemPrompt', 'temperature', 'max_tokens', 'jsonMode'].includes(key))
    || !validImage(options.image) || (options.max_tokens !== undefined && (!Number.isInteger(options.max_tokens) || options.max_tokens < 100 || options.max_tokens > 2400)))
    return reply('invalid_media_request', 400);
  if (!env.VETSA_INTELLIGENCE?.fetch || !env.VETSA_INTELLIGENCE_API_KEY) return reply('media_models_unavailable', 503);
  try {
    const upstream = await env.VETSA_INTELLIGENCE.fetch(new Request('https://vetsa.internal/v1/generate', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.VETSA_INTELLIGENCE_API_KEY },
      body: JSON.stringify({ model: 'spaik-sight', contents: input.contents,
        options: { image: options.image, systemPrompt: PUBLIC_VISUAL_PROMPT, temperature: 0, max_tokens: options.max_tokens || 1800, jsonMode: true } }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
    }));
    if (!upstream.ok) { await upstream.body?.cancel(); return reply('media_models_unavailable', 503); }
    const bytes = await readLimited(upstream.body, 1_000_000);
    return new Response(bytes, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch { return reply('media_models_unavailable', 503); }
}
