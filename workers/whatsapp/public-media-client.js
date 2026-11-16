import { publicInstagramResearchUrl } from './owner-research-request.js';

const AGENTS = ['melodi'];
const operationPattern = /^pm-[a-f0-9]{48,64}$/;

async function boundedJson(response, limit = 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('media_response_empty');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > limit) { await reader.cancel(); throw new Error('media_response_too_large'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** The shared reader retains the requesting agent; neither a URL nor a model can choose its owner. */
export function createPublicMediaClient(env) {
  const owner = String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  return async function extractPublicMedia({ ownerPhone, agent, url, eventId, operationId } = {}) {
    const source = publicInstagramResearchUrl(url);
    if (!owner || ownerPhone !== owner || !AGENTS.includes(agent) || !source
      || typeof eventId !== 'string' || !/^[A-Za-z0-9_.:-]{1,180}$/.test(eventId)
      || (operationId !== undefined && !operationPattern.test(operationId)))
      return { status: 'blocked', reason: 'media_scope_invalid', verified: false };
    if (!env.VETSA_PUBLIC_MEDIA || env.PUBLIC_MEDIA_ANALYSIS_ENABLED !== 'true')
      return { status: 'blocked', reason: 'backend_not_connected', textFallbackAllowed: true, verified: false };
    let response, result;
    try {
      response = await env.VETSA_PUBLIC_MEDIA.fetch(new Request('https://media.internal/v1/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerPhone: owner, agent, url: source.sourceUrl, eventId, ...(operationId ? { operationId } : {}) }),
        signal: AbortSignal.timeout(12000),
      }));
      result = await boundedJson(response);
    } catch { return { status: 'blocked', reason: 'media_backend_unavailable', verified: false }; }
    if (!response.ok || result.ownerPhone !== owner || result.agent !== agent || result.eventId !== eventId
      || result.sourceUrl !== source.sourceUrl || !['pending', 'ready', 'blocked', 'cancelled'].includes(result.status)
      || (operationId && result.operationId !== operationId))
      return { status: 'blocked', reason: 'media_scope_mismatch', verified: false };
    if (result.status === 'pending' && (result.verified !== true || !operationPattern.test(result.operationId)))
      return { status: 'blocked', reason: 'media_operation_unverified', verified: false };
    if (result.status === 'ready' && (result.verified !== true || !Array.isArray(result.media) || !result.media.length))
      return { status: 'blocked', reason: 'media_result_unverified', verified: false };
    // A connected processor failing cannot be silently described as full media access.
    if (result.status === 'blocked') result.textFallbackAllowed = result.reason === 'backend_not_connected' && result.textFallbackAllowed === true;
    return result;
  };
}
