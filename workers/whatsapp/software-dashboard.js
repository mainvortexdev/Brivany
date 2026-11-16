const OWNER_EMAILS = ['daniel@vetsa.es', 'ceo@vetsa.es'];
async function authorizedEmail(email) { return (await Promise.all(OWNER_EMAILS.map(allowed=>safeEqual(email,allowed)))).some(Boolean); }
const SESSION_HOURS = 12;
const CODE_MINUTES = 10;
const OWNER_PHONE = '18495205246';
import { workspacePage } from './software-workspace.js';
import { createAgentRuntime } from './melodi-autonomy.js';
import { handleSoftwareMail } from './software-mail.js';

function nowIso() { return new Date().toISOString(); }
function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
function clean(value, max = 1000) { return String(value || '').replace(/\u0000/g, '').trim().slice(0, max); }
async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function safeEqual(left, right) {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}
function randomHex(size = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(size)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function sixDigitCode() {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(100000 + (bytes[0] % 900000));
}
function cookieValue(request, name) {
  const match = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : '';
}
function sessionCookie(token, maxAge = SESSION_HOURS * 3600) {
  return `vetsa_software_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}
async function instagramCommand(env, payload) {
  if (!env.VETSA_INSTAGRAM_OPERATIONS || !env.INSTAGRAM_INTERNAL_TOKEN) throw new Error('Instagram operations are unavailable.');
  const response = await env.VETSA_INSTAGRAM_OPERATIONS.fetch(new Request('https://instagram.internal/internal/owner-command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vetsa-internal-token': env.INSTAGRAM_INTERNAL_TOKEN },
    body: JSON.stringify({ ownerPhone: OWNER_PHONE, instagramAccountId: env.INSTAGRAM_ACCOUNT_ID || '', ...payload }),
  }));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Instagram operations returned ${response.status}`);
  return data;
}
async function sessionEmailHash(env, request) {
  const token = cookieValue(request, 'vetsa_software_session');
  if (!token) return '';
  const row = await env.VETSA_CLOUD.prepare(`
    SELECT email_hash FROM software_sessions WHERE token_hash = ? AND expires_at > ?
  `).bind(await sha256(token), nowIso()).first();
  if (!row) return '';
  await env.VETSA_CLOUD.prepare('UPDATE software_sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(nowIso(), await sha256(token)).run();
  return row.email_hash;
}
export async function hasSoftwareDashboardSession(env, request) {
  return Boolean(await sessionEmailHash(env, request));
}
async function audit(env, emailHash, action, targetId = '') {
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO software_audit_log (id, actor_email_hash, action, target_id, created_at) VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), emailHash, action, clean(targetId, 96) || null, nowIso()).run();
}

export async function handleSoftwareDashboard(request, env, url, sendWhatsApp) {
  if (request.method !== 'GET' && !sameOrigin(request, url)) return json({ error: 'Origen no permitido.' }, 403);
  if(['/correo','/emails'].includes(url.pathname)||url.pathname.startsWith('/api/mail/')) {
    return handleSoftwareMail(request,env,url,{authenticated:await hasSoftwareDashboardSession(env,request)});
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) {
    return env.ASSETS.fetch(new Request(new URL('/software-login.html', request.url), request));
  }
  if (request.method === 'GET' && url.pathname === '/workspace') {
    if (!await hasSoftwareDashboardSession(env, request)) return new Response('Not found', { status: 404 });
    return workspacePage();
  }
  if (request.method === 'GET' && url.pathname === '/software.html') {
    return new Response('Not found', { status: 404 });
  }
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

  if (request.method === 'POST' && url.pathname === '/api/auth/request') {
    const body = await request.json().catch(() => ({}));
    const email = clean(body.email, 160).toLocaleLowerCase('es');
    const generic = { ok: true, message: 'Si la dirección está autorizada, el código llegará por WhatsApp.' };
    if (!await authorizedEmail(email)) return json(generic);
    const emailHash = await sha256(`${email}:${env.SOFTWARE_AUTH_PEPPER}`);
    const recent = await env.VETSA_CLOUD.prepare(`
      SELECT created_at FROM software_auth_codes WHERE email_hash = ? ORDER BY created_at DESC LIMIT 1
    `).bind(emailHash).first();
    if (recent && Date.parse(recent.created_at) > Date.now() - 60_000) return json(generic, 202);
    const code = sixDigitCode();
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
    await env.VETSA_CLOUD.prepare(`
      INSERT INTO software_auth_codes (id, email_hash, code_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, emailHash, await sha256(`${id}:${code}:${env.SOFTWARE_AUTH_PEPPER}`), expiresAt, nowIso()).run();
    await sendWhatsApp(env, OWNER_PHONE, `🔐 Código de acceso a Vetsa Software: *${code}*\n\nCaduca en ${CODE_MINUTES} minutos. Si no lo solicitaste, ignóralo.`);
    return json(generic, 202);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/verify') {
    const body = await request.json().catch(() => ({}));
    const email = clean(body.email, 160).toLocaleLowerCase('es');
    const code = clean(body.code, 6);
    if (!await authorizedEmail(email) || !/^\d{6}$/.test(code)) return json({ error: 'Código inválido o vencido.' }, 401);
    const emailHash = await sha256(`${email}:${env.SOFTWARE_AUTH_PEPPER}`);
    const record = await env.VETSA_CLOUD.prepare(`
      SELECT id, code_hash, attempts FROM software_auth_codes
      WHERE email_hash = ? AND used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(emailHash, nowIso()).first();
    if (!record || record.attempts >= 5) return json({ error: 'Código inválido o vencido.' }, 401);
    const valid = await safeEqual(record.code_hash, await sha256(`${record.id}:${code}:${env.SOFTWARE_AUTH_PEPPER}`));
    if (!valid) {
      await env.VETSA_CLOUD.prepare('UPDATE software_auth_codes SET attempts = attempts + 1 WHERE id = ?').bind(record.id).run();
      return json({ error: 'Código inválido o vencido.' }, 401);
    }
    const token = randomHex();
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString();
    await env.VETSA_CLOUD.batch([
      env.VETSA_CLOUD.prepare('UPDATE software_auth_codes SET used_at = ? WHERE id = ?').bind(nowIso(), record.id),
      env.VETSA_CLOUD.prepare(`INSERT INTO software_sessions (token_hash, email_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(await sha256(token), emailHash, expiresAt, nowIso(), nowIso()),
    ]);
    await audit(env, emailHash, 'login');
    return json({ ok: true, expiresAt }, 200, { 'Set-Cookie': sessionCookie(token) });
  }

  const emailHash = await sessionEmailHash(env, request);
  if (!emailHash) return json({ error: 'Sesión inválida o expirada.' }, 401);
  if (request.method === 'GET' && url.pathname === '/api/team') {
    const team = createAgentRuntime(env);
    await team.initialize();
    return json(await team.status());
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = cookieValue(request, 'vetsa_software_session');
    await env.VETSA_CLOUD.prepare('DELETE FROM software_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    await audit(env, emailHash, 'logout');
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (request.method === 'GET' && url.pathname === '/api/dashboard') {
    return json(await instagramCommand(env, { action: 'dashboard_snapshot' }));
  }
  if (request.method === 'POST' && url.pathname === '/api/rules') {
    const body = await request.json().catch(() => ({}));
    const result = await instagramCommand(env, { action: 'upsert_keyword_rule', metadata: { ruleId: clean(body.id, 96), keyword: clean(body.keyword, 120), response: clean(body.response, 1000) } });
    await audit(env, emailHash, body.id ? 'rule_update' : 'rule_create', result.rule?.id);
    return json(result, 201);
  }
  const ruleMatch = url.pathname.match(/^\/api\/rules\/([a-f0-9-]{36})$/i);
  if (ruleMatch && request.method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    const result = await instagramCommand(env, { action: 'toggle_keyword_rule', metadata: { ruleId: ruleMatch[1], enabled: body.enabled === true } });
    await audit(env, emailHash, body.enabled === true ? 'rule_enable' : 'rule_pause', ruleMatch[1]);
    return json(result);
  }
  if (ruleMatch && request.method === 'DELETE') {
    const result = await instagramCommand(env, { action: 'delete_keyword_rule', metadata: { ruleId: ruleMatch[1] } });
    await audit(env, emailHash, 'rule_delete', ruleMatch[1]);
    return json(result);
  }
  if (request.method === 'POST' && url.pathname === '/api/grant') {
    const body = await request.json().catch(() => ({}));
    const hours = Math.min(Math.max(Number(body.hours) || 4, 1), 24);
    const result = await instagramCommand(env, { action: 'grant_reply_access', metadata: { hours } });
    await audit(env, emailHash, 'reply_access_grant');
    return json(result);
  }
  if (request.method === 'DELETE' && url.pathname === '/api/grant') {
    const result = await instagramCommand(env, { action: 'revoke_reply_access' });
    await audit(env, emailHash, 'reply_access_revoke');
    return json(result);
  }
  const followGateMatch = url.pathname.match(/^\/api\/follow-gates\/([a-f0-9-]{36})\/release$/i);
  if (followGateMatch && request.method === 'POST') {
    const result = await instagramCommand(env, { action: 'release_follow_reward', metadata: { gateId: followGateMatch[1] } });
    await audit(env, emailHash, 'follow_reward_release', followGateMatch[1]);
    return json(result);
  }
  return json({ error: 'Ruta no encontrada.' }, 404);
}
