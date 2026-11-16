const MAX_API_BYTES = 16 * 1024;
const SAFE_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const ATTACK_PATTERNS = [
  /(?:<script\b|javascript\s*:|on(?:error|load|click)\s*=)/i,
  /(?:\.\.\/|\.\.\\|%2e%2e(?:%2f|%5c)|\/etc\/(?:passwd|shadow)|\/proc\/self)/i,
  /(?:\bunion\s+(?:all\s+)?select\b|\bdrop\s+(?:table|database)\b|\bor\s+['"]?\d+['"]?\s*=\s*['"]?\d+)/i,
  /(?:\$where|__proto__|constructor\.prototype)/i,
];

function response(data, status, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

function routeClass(url) {
  if (url.pathname.startsWith('/api/auth/')) return { key: 'auth', limit: 12, windowMs: 15 * 60_000 };
  if (url.pathname.startsWith('/api/')) return { key: 'api', limit: 120, windowMs: 60_000 };
  return null;
}

async function securityEvent(env, request, kind, detail = '') {
  const ipHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${clientIp(request)}:${env.SOFTWARE_AUTH_PEPPER || ''}`));
  const id = crypto.randomUUID();
  const hash = Array.from(new Uint8Array(ipHash), (b) => b.toString(16).padStart(2, '0')).join('');
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO software_security_events (id, ip_hash, event_type, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, hash, kind, String(detail).slice(0, 120), new Date().toISOString()).run().catch(() => {});
}

async function applyRateLimit(env, request, url) {
  const type = routeClass(url);
  if (!type) return null;
  const now = Date.now();
  const bucket = `${type.key}:${clientIp(request)}`;
  const row = await env.VETSA_CLOUD.prepare(
    'SELECT requests, window_started_at, blocked_until FROM software_rate_limits WHERE bucket = ?',
  ).bind(bucket).first();
  if (row?.blocked_until && Date.parse(row.blocked_until) > now) {
    await securityEvent(env, request, 'rate_limit_block', type.key);
    return response({ error: 'No se pudo completar la solicitud.' }, 429, { 'Retry-After': String(Math.ceil((Date.parse(row.blocked_until) - now) / 1000)) });
  }
  const fresh = !row || now - Date.parse(row.window_started_at) >= type.windowMs;
  const requests = fresh ? 1 : Number(row.requests) + 1;
  const blockedUntil = requests > type.limit ? new Date(now + type.windowMs).toISOString() : null;
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO software_rate_limits (bucket, requests, window_started_at, blocked_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bucket) DO UPDATE SET requests = excluded.requests, window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until, updated_at = excluded.updated_at
  `).bind(bucket, requests, fresh ? new Date(now).toISOString() : row.window_started_at, blockedUntil, new Date(now).toISOString()).run();
  if (blockedUntil) {
    await securityEvent(env, request, 'rate_limit_block', type.key);
    return response({ error: 'No se pudo completar la solicitud.' }, 429, { 'Retry-After': String(Math.ceil(type.windowMs / 1000)) });
  }
  return null;
}

export async function vetseAccessSecurity(request, env, url) {
  if (!SAFE_METHODS.has(request.method)) return response({ error: 'Método no permitido.' }, 405, { Allow: 'GET, POST, PATCH, DELETE' });
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  const maxBytes = /^\/api\/mail\/messages\/[a-zA-Z0-9_-]{1,200}\/(reply|draft)$/.test(url.pathname) ? 8 * 1024 * 1024 : MAX_API_BYTES;
  if (url.pathname.startsWith('/api/') && (!Number.isFinite(contentLength) || contentLength > maxBytes)) {
    await securityEvent(env, request, 'payload_rejected', url.pathname);
    return response({ error: 'No se pudo completar la solicitud.' }, 413);
  }
  let decodedQuery = url.search;
  try { decodedQuery = decodeURIComponent(url.search); } catch { /* malformed encoding is handled as ordinary input */ }
  const surface = `${url.pathname}?${decodedQuery} ${request.headers.get('User-Agent') || ''}`;
  if (ATTACK_PATTERNS.some((pattern) => pattern.test(surface))) {
    await securityEvent(env, request, 'request_rejected', url.pathname);
    return response({ error: 'No se pudo completar la solicitud.' }, 403);
  }
  return applyRateLimit(env, request, url);
}

export function secureSoftwareResponse(original) {
  const headers = new Headers(original.headers);
  headers.set('Cache-Control', 'no-store, private');
  headers.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return new Response(original.body, { status: original.status, statusText: original.statusText, headers });
}
