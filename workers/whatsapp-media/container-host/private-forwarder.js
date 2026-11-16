async function equalSecret(actual, expected) {
  if (typeof actual !== 'string' || !expected || actual.length > 1024) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encode.encode(actual)), crypto.subtle.digest('SHA-256', encode.encode(expected))]);
  const one = new Uint8Array(a), two = new Uint8Array(b); let difference = 0;
  for (let i = 0; i < one.length; i++) difference |= one[i] ^ two[i];
  return difference === 0;
}

export async function forwardProcessorRequest(request, env, container) {
  const url = new URL(request.url);
  const allowed = request.method === 'POST' && url.pathname === '/v1/process'
    || request.method === 'GET' && (url.pathname === '/health' || /^\/v1\/artifacts\/pm-[a-f0-9]{64}\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|img|mp4|webm|mka|wav)$/.test(url.pathname));
  if (!allowed || url.search) return Response.json({ error: 'not_found' }, { status: 404 });
  if (!await equalSecret(request.headers.get('authorization'), `Bearer ${env.MEDIA_PROCESSOR_TOKEN || ''}`) || !env.MEDIA_PROCESSOR_TOKEN)
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  let body;
  if (request.method === 'POST') {
    const declared = request.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) <= 0 || Number(declared) > 8192))
      return Response.json({ error: 'invalid_request_size' }, { status: 400 });
    const reader = request.body?.getReader(); if (!reader) return Response.json({ error: 'invalid_request_size' }, { status: 400 });
    const chunks = []; let length = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break;
        length += value.length; if (length > 8192) { await reader.cancel(); return Response.json({ error: 'invalid_request_size' }, { status: 400 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!length || declared && length !== Number(declared)) return Response.json({ error: 'invalid_request_size' }, { status: 400 });
    body = new Uint8Array(length); let at = 0; for (const chunk of chunks) { body.set(chunk, at); at += chunk.length; }
  }
  const headers = new Headers(); headers.set('authorization', `Bearer ${env.MEDIA_PROCESSOR_TOKEN}`);
  for (const key of ['content-type', 'content-length']) if (request.headers.has(key)) headers.set(key, request.headers.get(key));
  if (body) headers.set('content-length', String(body.length));
  return container.fetch(new Request(`http://container${url.pathname}`, { method: request.method, headers,
    ...(body ? { body } : {}), signal: request.signal, redirect: 'manual' }));
}
