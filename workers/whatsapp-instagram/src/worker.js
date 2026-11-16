/**
 * Vetsa Instagram Operations
 *
 * This Worker deliberately separates Meta's public webhook from Dona's private
 * WhatsApp workflow. It stores event payloads encrypted, acknowledges webhooks
 * quickly and never publishes or sends a message without an owner operation
 * that has reached the approved state.
 *
 * Required secrets (set with `wrangler secret put`, never committed):
 * - INSTAGRAM_APP_SECRET
 * - INSTAGRAM_VERIFY_TOKEN
 * - INSTAGRAM_INTERNAL_TOKEN
 * - IG_STATE_ENCRYPTION_KEY
 * - INSTAGRAM_ACCESS_TOKEN (only after the test account is connected)
 */

const MAX_WEBHOOK_BYTES = 512_000;
const MAX_COMMAND_BYTES = 32_000;
const DELIVERY_WINDOW_MINUTES = 45;
const OWNER_ACTIONS = new Set([
  'prepare_post',
  'prepare_story',
  'prepare_reel',
  'prepare_campaign',
  'prepare_reply',
  'approve_operation',
  'operation_status',
  'grant_reply_access',
  'revoke_reply_access',
  'dashboard_snapshot',
  'upsert_keyword_rule',
  'toggle_keyword_rule',
  'delete_keyword_rule',
  'release_follow_reward',
  'authorized_inbox',
  'send_authorized_reply',
  'marketing_insights',
]);

function isoNow() {
  return new Date().toISOString();
}

function cleanText(value, max = 4_000) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizedMatchText(value) {
  return cleanText(value, 4_000)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

function responseJson(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function plainText(value, status = 200) {
  return new Response(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function readBodyText(request, maxBytes) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('request_too_large');
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('request_too_large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function sha256Hex(value) {
  return Array.from(await sha256(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function timingSafeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([sha256(left || ''), sha256(right || '')]);
  // SHA-256 makes both values fixed-length before the comparison. Avoid the
  // Node-only crypto API here so the same constant-time loop is exercised in
  // local tests and in the Workers runtime.
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index] ^ rightHash[index];
  }
  return difference === 0;
}

async function verifyMetaSignature(rawBody, signature, appSecret) {
  if (!appSecret || !signature?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return timingSafeEqual(signature, expected);
}

async function encryptionKey(env) {
  if (!env.IG_STATE_ENCRYPTION_KEY) throw new Error('missing_ig_state_encryption_key');
  return crypto.subtle.importKey(
    'raw',
    await sha256(env.IG_STATE_ENCRYPTION_KEY),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function sealPayload(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), plaintext);
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function openPayload(env, ciphertext, iv) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    await encryptionKey(env),
    base64ToBytes(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function nestedValue(value, path) {
  return path.reduce((current, key) => current && typeof current === 'object' ? current[key] : undefined, value);
}

function eventTimestamp(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return isoNow();
  return new Date(timestamp > 10_000_000_000 ? timestamp : timestamp * 1000).toISOString();
}

/**
 * Meta uses more than one webhook envelope for comments and DMs. Normalize
 * their meaningful fields without treating their content as instructions.
 */
function normalizeWebhookEvents(payload) {
  const events = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const accountId = cleanText(entry?.id, 96);
    const occurredAt = eventTimestamp(entry?.time);
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const item of messaging) {
      const message = item?.message || item?.postback || {};
      const participantId = cleanText(item?.sender?.id, 128);
      const sourceId = cleanText(message?.mid || item?.message_id || item?.id, 192);
      if (!participantId || !sourceId || item?.message?.is_echo) continue;
      events.push({
        kind: 'direct_message',
        accountId,
        sourceId,
        participantId,
        occurredAt: eventTimestamp(item?.timestamp || entry?.time),
        content: cleanText(message?.text || message?.payload || '', 4_000),
      });
    }

    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const field = cleanText(change?.field, 80).toLowerCase();
      const isComment = field.includes('comment');
      const sourceId = cleanText(value?.id || value?.comment_id || value?.media_id || change?.id, 192);
      if (!sourceId) continue;
      events.push({
        kind: isComment ? 'comment' : `meta_${field || 'event'}`,
        accountId,
        sourceId,
        participantId: cleanText(value?.from?.id || value?.sender?.id || '', 128),
        mediaId: cleanText(value?.media?.id || value?.media_id || '', 128),
        occurredAt,
        content: cleanText(value?.text || value?.message || '', 4_000),
      });
    }
  }
  return events;
}

async function eventKey(event) {
  return `ig_${await sha256Hex(JSON.stringify({
    accountId: event.accountId,
    kind: event.kind,
    sourceId: event.sourceId,
    participantId: event.participantId,
    occurredAt: event.occurredAt,
  }))}`;
}

async function queueWebhookEvents(env, payload) {
  const events = normalizeWebhookEvents(payload);
  for (const event of events) {
    const key = await eventKey(event);
    const previous = await env.VETSA_CLOUD.prepare(
      'SELECT status FROM ig_webhook_events WHERE event_key = ?',
    ).bind(key).first();
    if (previous?.status === 'queued' || previous?.status === 'processed') continue;

    if (!previous) {
      const sealed = await sealPayload(env, event);
      await env.VETSA_CLOUD.prepare(`
        INSERT INTO ig_webhook_events
          (event_key, instagram_account_id, event_kind, payload_ciphertext, payload_iv, status, received_at)
        VALUES (?, ?, ?, ?, ?, 'received', ?)
      `).bind(key, event.accountId || 'unknown', event.kind, sealed.ciphertext, sealed.iv, isoNow()).run();
    }

    try {
      await env.INSTAGRAM_JOBS.send({ type: 'process_webhook', eventKey: key });
      await env.VETSA_CLOUD.prepare(
        "UPDATE ig_webhook_events SET status = 'queued', error_code = NULL WHERE event_key = ?",
      ).bind(key).run();
    } catch (error) {
      await env.VETSA_CLOUD.prepare(
        "UPDATE ig_webhook_events SET status = 'received', error_code = ? WHERE event_key = ?",
      ).bind(cleanText(error instanceof Error ? error.message : error, 160), key).run();
      throw error;
    }
  }
  return events.length;
}

async function createOwnerOperation(env, {
  ownerPhone,
  action,
  accountId = '',
  text = '',
  media = null,
  operationId = '',
  metadata = {},
}) {
  const id = operationId || crypto.randomUUID();
  const sealed = await sealPayload(env, {
    text: cleanText(text, 8_000),
    media: media && typeof media === 'object' ? media : null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });
  await env.VETSA_CLOUD.prepare(`
    INSERT OR IGNORE INTO ig_owner_operations
      (id, owner_phone, instagram_account_id, operation_kind, status, payload_ciphertext, payload_iv, created_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
  `).bind(id, ownerPhone, cleanText(accountId, 128) || null, action, sealed.ciphertext, sealed.iv, isoNow()).run();
  const existing = await env.VETSA_CLOUD.prepare('SELECT owner_phone,operation_kind,status FROM ig_owner_operations WHERE id=?').bind(id).first();
  if (existing?.owner_phone !== ownerPhone || existing?.operation_kind !== action) throw new Error('Operation identity collision.');
  return { id, status: existing.status, action };
}

async function createCampaignDraft(env, { ownerPhone, accountId = '', text = '', metadata = {} }) {
  const id = crypto.randomUUID();
  const now = isoNow();
  const sealed = await sealPayload(env, {
    brief: cleanText(text, 8_000),
    message: cleanText(metadata?.automationMessage, 1_000),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO ig_automation_policies
      (id, owner_phone, instagram_account_id, policy_kind, status, payload_ciphertext, payload_iv, created_at, updated_at)
    VALUES (?, ?, ?, 'comment_to_dm', 'draft', ?, ?, ?, ?)
  `).bind(id, ownerPhone, cleanText(accountId, 128) || null, sealed.ciphertext, sealed.iv, now, now).run();
  await createOwnerOperation(env, {
    ownerPhone,
    action: 'prepare_campaign',
    accountId,
    text,
    operationId: id,
    metadata: { ...(metadata && typeof metadata === 'object' ? metadata : {}), policyId: id },
  });
  return { id, operation_kind: 'prepare_campaign', status: 'draft' };
}

async function latestOwnerOperation(env, ownerPhone, operationId = '', draftOnly = false) {
  if (operationId) {
    return env.VETSA_CLOUD.prepare(`
      SELECT id, operation_kind, status FROM ig_owner_operations WHERE id = ? AND owner_phone = ?
    `).bind(operationId, ownerPhone).first();
  }
  return env.VETSA_CLOUD.prepare(`
    SELECT id, operation_kind, status FROM ig_owner_operations
    WHERE owner_phone = ? ${draftOnly ? "AND status = 'draft'" : ''}
    ORDER BY created_at DESC LIMIT 1
  `).bind(ownerPhone).first();
}

async function replyGrant(env, ownerPhone, accountId = '') {
  return env.VETSA_CLOUD.prepare(`
    SELECT status, expires_at FROM ig_reply_grants
    WHERE owner_phone = ? AND status = 'active' AND expires_at > ?
      AND (instagram_account_id IS NULL OR instagram_account_id = ?)
  `).bind(ownerPhone, isoNow(), cleanText(accountId, 128) || env.INSTAGRAM_ACCOUNT_ID).first();
}

async function grantReplyAccess(env, ownerPhone, accountId, hours) {
  const safeHours = Math.min(Math.max(Number(hours) || 4, 1), 24);
  const now = isoNow();
  const expiresAt = new Date(Date.now() + safeHours * 3_600_000).toISOString();
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO ig_reply_grants
      (owner_phone, instagram_account_id, status, granted_at, expires_at, revoked_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, NULL, ?)
    ON CONFLICT(owner_phone) DO UPDATE SET
      instagram_account_id = excluded.instagram_account_id,
      status = 'active', granted_at = excluded.granted_at,
      expires_at = excluded.expires_at, revoked_at = NULL,
      updated_at = excluded.updated_at
  `).bind(ownerPhone, cleanText(accountId, 128) || null, now, expiresAt, now).run();
  return { active: true, expiresAt };
}

async function dashboardSnapshot(env, ownerPhone, accountId) {
  const resolvedAccountId = cleanText(accountId, 128) || env.INSTAGRAM_ACCOUNT_ID;
  const [ruleRows, inboxRows, gateRows, grant] = await Promise.all([
    env.VETSA_CLOUD.prepare(`
      SELECT id, status, payload_ciphertext, payload_iv, created_at, updated_at
      FROM ig_keyword_rules
      WHERE owner_phone = ? AND (instagram_account_id IS NULL OR instagram_account_id = ?)
      ORDER BY updated_at DESC LIMIT 100
    `).bind(ownerPhone, resolvedAccountId).all(),
    env.VETSA_CLOUD.prepare(`
      SELECT id, participant_id, status, payload_ciphertext, payload_iv, received_at, replied_at, updated_at
      FROM ig_inbox_items WHERE instagram_account_id = ?
      ORDER BY received_at DESC LIMIT 100
    `).bind(resolvedAccountId).all(),
    env.VETSA_CLOUD.prepare(`
      SELECT id, policy_id, participant_id, status, baseline_followers, observed_followers, created_at, claimed_at, verified_heuristically_at, updated_at
      FROM ig_follow_gates WHERE instagram_account_id = ?
      ORDER BY updated_at DESC LIMIT 100
    `).bind(resolvedAccountId).all(),
    replyGrant(env, ownerPhone, resolvedAccountId),
  ]);
  const rules = [];
  for (const row of ruleRows.results || []) {
    const payload = await openPayload(env, row.payload_ciphertext, row.payload_iv);
    rules.push({ id: row.id, status: row.status, keyword: payload.keyword || '', response: payload.response || '', followRequired: payload.followRequired === true, followAccount: payload.followAccount || '@d.luna.ai', createdAt: row.created_at, updatedAt: row.updated_at });
  }
  const inbox = [];
  for (const row of inboxRows.results || []) {
    const payload = await openPayload(env, row.payload_ciphertext, row.payload_iv);
    inbox.push({ id: row.id, participantId: row.participant_id, status: row.status, message: payload.message || '', receivedAt: row.received_at, repliedAt: row.replied_at, updatedAt: row.updated_at });
  }
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const followGates = (gateRows.results || []).map((row) => ({
    id: row.id, policyId: row.policy_id, participantId: row.participant_id, status: row.status,
    keyword: ruleById.get(row.policy_id)?.keyword || '', followAccount: ruleById.get(row.policy_id)?.followAccount || '@d.luna.ai',
    baselineFollowers: row.baseline_followers, observedFollowers: row.observed_followers,
    createdAt: row.created_at, claimedAt: row.claimed_at, verifiedAt: row.verified_heuristically_at, updatedAt: row.updated_at,
  }));
  return { accountId: resolvedAccountId, grant: grant ? { active: true, expiresAt: grant.expires_at } : { active: false, expiresAt: null }, rules, inbox, followGates };
}

async function upsertKeywordRule(env, ownerPhone, accountId, input) {
  const id = cleanText(input?.ruleId, 96) || crypto.randomUUID();
  const keyword = cleanText(input?.keyword, 120);
  const response = cleanText(input?.response, 1_000);
  const followRequired = input?.followRequired === true;
  const followAccount = cleanText(input?.followAccount, 80) || '@d.luna.ai';
  if (keyword.length < 2 || !response) throw new Error('Keyword and response are required.');
  const sealed = await sealPayload(env, { keyword, response, followRequired, followAccount });
  const now = isoNow();
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO ig_keyword_rules
      (id, owner_phone, instagram_account_id, status, payload_ciphertext, payload_iv, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload_ciphertext = excluded.payload_ciphertext,
      payload_iv = excluded.payload_iv,
      status = 'active', updated_at = excluded.updated_at
  `).bind(id, ownerPhone, cleanText(accountId, 128) || null, sealed.ciphertext, sealed.iv, now, now).run();
  return { id, status: 'active', keyword, response, followRequired, followAccount, updatedAt: now };
}

async function activeKeywordRules(env, accountId) {
  const rows = await env.VETSA_CLOUD.prepare(`
    SELECT id, payload_ciphertext, payload_iv FROM ig_keyword_rules
    WHERE status = 'active' AND (instagram_account_id IS NULL OR instagram_account_id = ?)
    ORDER BY updated_at DESC
  `).bind(accountId).all();
  return rows.results || [];
}

function isFollowClaim(text) {
  return /\b(ya\s+te\s+sigo|te\s+sigo|seguido|i['’]?m\s+following|i\s+followed)\b/i.test(normalizedMatchText(text));
}

async function registerFollowClaim(env, event, inboxItemId) {
  if (!isFollowClaim(event.content)) return false;
  const gate = await env.VETSA_CLOUD.prepare(`
    SELECT id, policy_id, participant_id, baseline_followers FROM ig_follow_gates
    WHERE instagram_account_id = ? AND participant_id = ? AND status = 'awaiting_follow'
    ORDER BY created_at DESC LIMIT 1
  `).bind(event.accountId || env.INSTAGRAM_ACCOUNT_ID, event.participantId).first();
  if (!gate) return false;
  const now = isoNow();
  const observed = await followerCount(env, event.accountId);
  if (observed > Number(gate.baseline_followers)) {
    await releaseFollowReward(env, gate, event.accountId, observed, 'heuristic');
    await env.VETSA_CLOUD.prepare(`UPDATE ig_inbox_items SET status = 'follow_rewarded', replied_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, inboxItemId).run();
    return true;
  }
  await env.VETSA_CLOUD.batch([
    env.VETSA_CLOUD.prepare(`UPDATE ig_follow_gates SET status = 'awaiting_follow', claimed_at = ?, observed_followers = ?, updated_at = ? WHERE id = ?`)
      .bind(now, observed, now, gate.id),
    env.VETSA_CLOUD.prepare(`UPDATE ig_inbox_items SET status = 'follow_pending', updated_at = ? WHERE id = ?`)
      .bind(now, inboxItemId),
  ]);
  await sendInstagramText(env, { id: event.participantId }, 'Aún no veo el cambio. Espera un momento y vuelve a escribirme “Ya te sigo”; te lo enviaré automáticamente en cuanto se refleje.', event.accountId);
  return true;
}

async function createFollowGate(env, event, eventKey, inboxItemId, rule, payload) {
  const existing = await env.VETSA_CLOUD.prepare(`
    SELECT id, status FROM ig_follow_gates WHERE policy_id = ? AND participant_id = ?
  `).bind(rule.id, event.participantId).first();
  if (existing) return { id: existing.id, status: existing.status, created: false };
  const id = crypto.randomUUID();
  const now = isoNow();
  const baselineFollowers = await followerCount(env, event.accountId);
  const account = cleanText(payload.followAccount, 80) || '@d.luna.ai';
  const handle = account.replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '');
  const profileLink = handle ? `https://instagram.com/${handle}` : '';
  const invitation = `¡Gracias por tu interés! Para recibirlo, sigue ${account}${profileLink ? `: ${profileLink}` : ''} y luego escríbeme “Ya te sigo”.`;
  const sent = await sendInstagramText(env, { id: event.participantId }, invitation, event.accountId);
  await env.VETSA_CLOUD.batch([
    env.VETSA_CLOUD.prepare(`
      INSERT INTO ig_follow_gates (id, policy_id, instagram_account_id, participant_id, source_event_key, status, baseline_followers, invitation_message_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'awaiting_follow', ?, ?, ?, ?)
    `).bind(id, rule.id, event.accountId || env.INSTAGRAM_ACCOUNT_ID, event.participantId, eventKey, baselineFollowers, cleanText(sent?.message_id, 160) || null, now, now),
    env.VETSA_CLOUD.prepare(`UPDATE ig_inbox_items SET status = 'follow_required', matched_policy_id = ?, replied_at = ?, updated_at = ? WHERE id = ?`)
      .bind(rule.id, now, now, inboxItemId),
  ]);
  return { id, status: 'awaiting_follow', created: true };
}

async function handleOwnerCommand(request, env) {
  if (!env.INSTAGRAM_INTERNAL_TOKEN) return responseJson({ error: 'Instagram Worker not fully configured.' }, 503);
  const allowed = await timingSafeEqual(request.headers.get('x-vetsa-internal-token') || '', env.INSTAGRAM_INTERNAL_TOKEN);
  if (!allowed) return responseJson({ error: 'Unauthorized internal command.' }, 401);

  let input;
  try {
    input = JSON.parse(await readBodyText(request, MAX_COMMAND_BYTES));
  } catch {
    return responseJson({ error: 'Invalid command payload.' }, 400);
  }
  const ownerPhone = cleanText(input?.ownerPhone, 32);
  const action = cleanText(input?.action, 64);
  if (!ownerPhone || ownerPhone !== cleanText(env.OWNER_WHATSAPP_NUMBER, 32) || !OWNER_ACTIONS.has(action)) {
    return responseJson({ error: 'Invalid owner command.' }, 400);
  }

  if (['prepare_post', 'prepare_story', 'prepare_reel'].includes(action) && (!input.media || typeof input.media !== 'object')) {
    return responseJson({ error: 'Attach an image or video before preparing this publication.' }, 400);
  }
  if (action === 'prepare_campaign' && !cleanText(input?.metadata?.automationMessage, 1_000)) {
    return responseJson({ error: 'Define the private reply that this campaign should send.' }, 400);
  }

  const accountId = cleanText(input?.instagramAccountId, 128) || env.INSTAGRAM_ACCOUNT_ID;
  if (action === 'marketing_insights') {
    return responseJson({ accountAnalytics: await marketingInsights(env, accountId) });
  }
  if (action === 'grant_reply_access') {
    return responseJson({ grant: await grantReplyAccess(env, ownerPhone, accountId, input?.metadata?.hours) });
  }
  if (action === 'revoke_reply_access') {
    const now = isoNow();
    await env.VETSA_CLOUD.prepare(`
      UPDATE ig_reply_grants SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE owner_phone = ?
    `).bind(now, now, ownerPhone).run();
    return responseJson({ grant: { active: false, expiresAt: null } });
  }
  if (action === 'dashboard_snapshot') {
    return responseJson(await dashboardSnapshot(env, ownerPhone, accountId));
  }
  if (action === 'upsert_keyword_rule') {
    return responseJson({ rule: await upsertKeywordRule(env, ownerPhone, accountId, input?.metadata || {}) }, 201);
  }
  if (action === 'toggle_keyword_rule') {
    const ruleId = cleanText(input?.metadata?.ruleId, 96);
    const status = input?.metadata?.enabled === true ? 'active' : 'paused';
    const result = await env.VETSA_CLOUD.prepare(`
      UPDATE ig_keyword_rules SET status = ?, updated_at = ? WHERE id = ? AND owner_phone = ?
    `).bind(status, isoNow(), ruleId, ownerPhone).run();
    return responseJson({ updated: result.meta.changes > 0, id: ruleId, status }, result.meta.changes > 0 ? 200 : 404);
  }
  if (action === 'delete_keyword_rule') {
    const ruleId = cleanText(input?.metadata?.ruleId, 96);
    const result = await env.VETSA_CLOUD.prepare('DELETE FROM ig_keyword_rules WHERE id = ? AND owner_phone = ?')
      .bind(ruleId, ownerPhone).run();
    return responseJson({ deleted: result.meta.changes > 0, id: ruleId }, result.meta.changes > 0 ? 200 : 404);
  }
  if (action === 'release_follow_reward') {
    const gateId = cleanText(input?.metadata?.gateId, 96);
    const gate = await env.VETSA_CLOUD.prepare(`
      SELECT id, policy_id, participant_id, status, observed_followers FROM ig_follow_gates
      WHERE id = ? AND instagram_account_id = ?
    `).bind(gateId, accountId).first();
    if (!gate || !['awaiting_follow', 'claimed'].includes(gate.status)) return responseJson({ error: 'Follow gate is not eligible for release.' }, 409);
    const sent = await releaseFollowReward(env, gate, accountId, Number(gate.observed_followers), 'owner');
    return responseJson({ released: true, id: gate.id, providerMessageId: cleanText(sent?.message_id, 160) || null });
  }
  if (action === 'authorized_inbox') {
    const grant = await replyGrant(env, ownerPhone, accountId);
    if (!grant) return responseJson({ grant: { active: false }, items: [] });
    const rows = await env.VETSA_CLOUD.prepare(`
      SELECT id, participant_id, payload_ciphertext, payload_iv, received_at
      FROM ig_inbox_items WHERE instagram_account_id = ? AND status = 'pending'
      ORDER BY received_at ASC LIMIT 12
    `).bind(accountId).all();
    const items = [];
    for (const row of rows.results || []) {
      const payload = await openPayload(env, row.payload_ciphertext, row.payload_iv);
      items.push({ id: row.id, participantId: row.participant_id, message: payload.message || '', receivedAt: row.received_at });
    }
    return responseJson({ grant: { active: true, expiresAt: grant.expires_at }, items });
  }
  if (action === 'send_authorized_reply') {
    const grant = await replyGrant(env, ownerPhone, accountId);
    if (!grant) return responseJson({ error: 'Reply authorization is not active.' }, 403);
    const itemId = cleanText(input?.metadata?.inboxItemId, 96);
    const item = await env.VETSA_CLOUD.prepare(`
      SELECT id, participant_id, received_at, status FROM ig_inbox_items
      WHERE id = ? AND instagram_account_id = ?
    `).bind(itemId, accountId).first();
    if (!item || item.status !== 'pending') return responseJson({ error: 'Inbox item is not pending.' }, 409);
    if (Date.parse(item.received_at) < Date.now() - 24 * 60 * 60 * 1000) return responseJson({ error: 'Reply window expired.' }, 409);
    const sent = await sendInstagramText(env, { id: item.participant_id }, input?.text, accountId);
    const now = isoNow();
    await env.VETSA_CLOUD.prepare(`
      UPDATE ig_inbox_items SET status = 'replied', provider_message_id = ?, replied_at = ?, updated_at = ? WHERE id = ?
    `).bind(cleanText(sent?.message_id, 160) || null, now, now, itemId).run();
    return responseJson({ item: { id: itemId, status: 'replied', repliedAt: now } });
  }

  if (action === 'operation_status') {
    const operation = await latestOwnerOperation(env, ownerPhone, cleanText(input?.operationId, 96));
    return responseJson({ operation: operation || null });
  }

  if (action === 'approve_operation') {
    const operation = await latestOwnerOperation(env, ownerPhone, cleanText(input?.operationId, 96), true);
    if (!operation) return responseJson({ error: 'No draft operation is awaiting confirmation.' }, 404);
    if (operation.status !== 'draft') return responseJson({ error: `Operation is ${operation.status}.` }, 409);
    await env.VETSA_CLOUD.prepare(`
      UPDATE ig_owner_operations SET status = 'approved', approved_at = ?, error_code = NULL WHERE id = ?
    `).bind(isoNow(), operation.id).run();
    await env.INSTAGRAM_JOBS.send({ type: 'execute_operation', operationId: operation.id });
    return responseJson({ operation: { id: operation.id, action: operation.operation_kind, status: 'approved' } });
  }

  const payload = {
    ownerPhone,
    accountId: cleanText(input?.instagramAccountId, 128),
    text: input?.text,
    operationId: cleanText(input?.operationId, 96),
    media: input?.media,
    metadata: input?.metadata,
  };
  const operation = action === 'prepare_campaign'
    ? await createCampaignDraft(env, payload)
    : await createOwnerOperation(env, { ...payload, action });
  return responseJson({ operation, requiresConfirmation: true }, 202);
}

async function saveInboundConversation(env, event, eventKey) {
  if (!event.participantId || event.kind !== 'direct_message') return;
  const now = isoNow();
  const sealed = await sealPayload(env, {
    lastMessage: event.content,
    occurredAt: event.occurredAt,
  });
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO ig_conversations
      (id, instagram_account_id, participant_id, last_event_key, last_message_at, encrypted_summary, summary_iv, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instagram_account_id, participant_id) DO UPDATE SET
      last_event_key = excluded.last_event_key,
      last_message_at = excluded.last_message_at,
      encrypted_summary = excluded.encrypted_summary,
      summary_iv = excluded.summary_iv,
      updated_at = excluded.updated_at
  `).bind(
    crypto.randomUUID(),
    event.accountId || 'unknown',
    event.participantId,
    eventKey,
    event.occurredAt,
    sealed.ciphertext,
    sealed.iv,
    now,
  ).run();
}

async function saveInboxItem(env, event, eventKey) {
  if (!event.participantId || event.kind !== 'direct_message') return null;
  const existing = await env.VETSA_CLOUD.prepare('SELECT id, status FROM ig_inbox_items WHERE event_key = ?')
    .bind(eventKey).first();
  if (existing) return existing;
  const id = crypto.randomUUID();
  const now = isoNow();
  const sealed = await sealPayload(env, { message: event.content, occurredAt: event.occurredAt });
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO ig_inbox_items
      (id, event_key, instagram_account_id, participant_id, payload_ciphertext, payload_iv, status, received_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(id, eventKey, event.accountId || env.INSTAGRAM_ACCOUNT_ID, event.participantId, sealed.ciphertext, sealed.iv, event.occurredAt, now).run();
  return { id, status: 'pending' };
}

async function deliverKeywordReply(env, event, eventKey, inboxItemId) {
  const incoming = normalizedMatchText(event.content);
  if (!incoming) return false;
  if (await registerFollowClaim(env, event, inboxItemId)) return true;
  const rules = await activeKeywordRules(env, event.accountId || env.INSTAGRAM_ACCOUNT_ID);
  for (const rule of rules) {
    const payload = await openPayload(env, rule.payload_ciphertext, rule.payload_iv);
    const keyword = normalizedMatchText(payload.keyword);
    if (!keyword || !incoming.includes(keyword)) continue;
    if (payload.followRequired === true) {
      await createFollowGate(env, event, eventKey, inboxItemId, rule, payload);
      return true;
    }
    const prior = await env.VETSA_CLOUD.prepare('SELECT status FROM ig_policy_deliveries WHERE policy_id = ? AND event_key = ?')
      .bind(rule.id, eventKey).first();
    if (prior?.status === 'sent') return true;
    const now = isoNow();
    await env.VETSA_CLOUD.prepare(`
      INSERT INTO ig_policy_deliveries (policy_id, event_key, status, created_at)
      VALUES (?, ?, 'sending', ?)
      ON CONFLICT(policy_id, event_key) DO UPDATE SET status = 'sending', error_code = NULL
    `).bind(rule.id, eventKey, now).run();
    try {
      const sent = await sendInstagramText(env, { id: event.participantId }, payload.response, event.accountId);
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_policy_deliveries SET status = 'sent', provider_message_id = ?, sent_at = ?, error_code = NULL
        WHERE policy_id = ? AND event_key = ?
      `).bind(cleanText(sent?.message_id, 160) || null, now, rule.id, eventKey).run();
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_inbox_items SET status = 'keyword_replied', matched_policy_id = ?, provider_message_id = ?, replied_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(rule.id, cleanText(sent?.message_id, 160) || null, now, now, inboxItemId).run();
      return true;
    } catch (error) {
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_policy_deliveries SET status = 'failed', error_code = ? WHERE policy_id = ? AND event_key = ?
      `).bind(cleanText(error instanceof Error ? error.message : error, 240), rule.id, eventKey).run();
      throw error;
    }
  }
  return false;
}

async function processWebhookEvent(env, eventKey) {
  const row = await env.VETSA_CLOUD.prepare(`
    SELECT event_key, status, payload_ciphertext, payload_iv FROM ig_webhook_events WHERE event_key = ?
  `).bind(eventKey).first();
  if (!row || row.status === 'processed') return;

  const event = await openPayload(env, row.payload_ciphertext, row.payload_iv);
  await saveInboundConversation(env, event, row.event_key);
  const inboxItem = await saveInboxItem(env, event, row.event_key);
  if (inboxItem) await deliverKeywordReply(env, event, row.event_key, inboxItem.id);
  if (event.kind === 'comment') await deliverActiveCommentPolicies(env, event, row.event_key);
  // Incoming comments and DMs are retained as reviewable events until the
  // owner explicitly activates a policy. This prevents an accidental public
  // reply or DM while Meta review and account testing are still in progress.
  await env.VETSA_CLOUD.prepare(`
    UPDATE ig_webhook_events SET status = 'processed', processed_at = ?, error_code = NULL WHERE event_key = ?
  `).bind(isoNow(), row.event_key).run();
  console.log(JSON.stringify({ event: 'instagram_webhook_processed', kind: event.kind, eventKey: row.event_key }));
}

async function activeCommentPolicies(env, instagramAccountId) {
  const rows = await env.VETSA_CLOUD.prepare(`
    SELECT id, payload_ciphertext, payload_iv
    FROM ig_automation_policies
    WHERE status = 'active' AND policy_kind = 'comment_to_dm'
      AND (instagram_account_id IS NULL OR instagram_account_id = ?)
    ORDER BY activated_at DESC
  `).bind(instagramAccountId).all();
  return rows.results || [];
}

async function sendInstagramText(env, recipient, text, accountId = '') {
  const message = cleanText(text, 1_000);
  if (!message) throw new Error('A text message is required.');
  return instagramGraph(env, `${cleanText(accountId, 128) || env.INSTAGRAM_ACCOUNT_ID}/messages`, {
    recipient,
    message: { text: message },
  });
}

async function deliverActiveCommentPolicies(env, event, eventKey) {
  const policies = await activeCommentPolicies(env, event.accountId);
  for (const policy of policies) {
    const delivery = await env.VETSA_CLOUD.prepare(`
      SELECT status FROM ig_policy_deliveries WHERE policy_id = ? AND event_key = ?
    `).bind(policy.id, eventKey).first();
    if (delivery?.status === 'sent') continue;

    const payload = await openPayload(env, policy.payload_ciphertext, policy.payload_iv);
    const message = cleanText(payload.message, 1_000);
    if (!message) {
      await env.VETSA_CLOUD.prepare(`
        INSERT INTO ig_policy_deliveries (policy_id, event_key, status, error_code, created_at)
        VALUES (?, ?, 'failed', 'policy_has_no_message', ?)
        ON CONFLICT(policy_id, event_key) DO UPDATE SET status = 'failed', error_code = 'policy_has_no_message'
      `).bind(policy.id, eventKey, isoNow()).run();
      continue;
    }
    await env.VETSA_CLOUD.prepare(`
      INSERT INTO ig_policy_deliveries (policy_id, event_key, status, created_at)
      VALUES (?, ?, 'sending', ?)
      ON CONFLICT(policy_id, event_key) DO UPDATE SET status = 'sending', error_code = NULL
    `).bind(policy.id, eventKey, isoNow()).run();
    try {
      // Meta permits one private reply to a comment within seven days. It is
      // intentionally not a follower check: the public API does not expose
      // follower state for this use case.
      const sent = await sendInstagramText(env, { comment_id: event.sourceId }, message, event.accountId);
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_policy_deliveries
        SET status = 'sent', provider_message_id = ?, sent_at = ?, error_code = NULL
        WHERE policy_id = ? AND event_key = ?
      `).bind(cleanText(sent?.message_id, 160) || null, isoNow(), policy.id, eventKey).run();
    } catch (error) {
      const messageText = cleanText(error instanceof Error ? error.message : error, 240);
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_policy_deliveries SET status = 'failed', error_code = ?
        WHERE policy_id = ? AND event_key = ?
      `).bind(messageText, policy.id, eventKey).run();
      throw error;
    }
  }
}

async function mediaDeliveryUrl(env, requestOrigin, media) {
  if (!media?.objectKey) throw new Error('A media file is required for this publication.');
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + DELIVERY_WINDOW_MINUTES * 60_000).toISOString();
  await env.VETSA_CLOUD.prepare(`
    INSERT INTO ig_media_delivery (id, object_key, mime_type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)
  `).bind(id, cleanText(media.objectKey, 600), cleanText(media.mimeType, 160) || 'application/octet-stream', expiresAt, isoNow()).run();
  const origin = cleanText(env.INSTAGRAM_PUBLIC_ORIGIN, 300) || requestOrigin;
  if (!origin.startsWith('https://')) throw new Error('A public HTTPS origin is required before publishing media.');
  return `${origin.replace(/\/$/, '')}/media/${id}`;
}

async function instagramGraph(env, path, body) {
  if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_ACCOUNT_ID) {
    throw new Error('Instagram access token or account ID is not configured.');
  }
  const base = cleanText(env.INSTAGRAM_GRAPH_BASE_URL, 300) || 'https://graph.instagram.com';
  const response = await fetch(`${base.replace(/\/$/, '')}/${env.META_GRAPH_VERSION || 'v24.0'}/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Instagram Graph API returned ${response.status}${result?.error?.message ? `: ${cleanText(result.error.message, 180)}` : ''}`);
  return result;
}

async function instagramGraphGet(env, path, params = {}) {
  if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_ACCOUNT_ID) throw new Error('Instagram access token or account ID is not configured.');
  const base = cleanText(env.INSTAGRAM_GRAPH_BASE_URL, 300) || 'https://graph.instagram.com';
  const query = new URLSearchParams(params);
  const response = await fetch(`${base.replace(/\/$/, '')}/${env.META_GRAPH_VERSION || 'v24.0'}/${path.replace(/^\//, '')}?${query.toString()}`, {
    headers: { Authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Instagram Graph API returned ${response.status}${result?.error?.message ? `: ${cleanText(result.error.message, 180)}` : ''}`);
  return result;
}

async function followerCount(env, accountId = '') {
  const profile = await instagramGraphGet(env, cleanText(accountId, 128) || env.INSTAGRAM_ACCOUNT_ID, { fields: 'followers_count' });
  const count = Number(profile?.followers_count);
  if (!Number.isFinite(count) || count < 0) throw new Error('Instagram did not return a usable follower count.');
  return Math.floor(count);
}

async function marketingInsights(env, accountId) {
  if (!env.INSTAGRAM_ACCESS_TOKEN || !accountId) {
    return { connected: false, reason: 'Falta la cuenta profesional conectada o su autorización vigente.' };
  }
  const profile = await instagramGraphGet(env, accountId, { fields: 'id,username,followers_count,media_count' });
  const mediaResult = await instagramGraphGet(env, `${accountId}/media`, {
    fields: 'id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count',
    limit: '8',
  });
  const media = (Array.isArray(mediaResult?.data) ? mediaResult.data : []).slice(0, 8);
  const posts = await Promise.all(media.map(async (item) => {
    let insights = [];
    let insightStatus = 'unavailable';
    try {
      const result = await instagramGraphGet(env, `${cleanText(item.id, 128)}/insights`, {
        metric: 'views,reach,likes,comments,saved,shares,total_interactions',
      });
      insights = (Array.isArray(result?.data) ? result.data : []).map((entry) => ({
        name: cleanText(entry.name, 64),
        values: (Array.isArray(entry.values) ? entry.values : []).slice(0, 2).map((value) => value.value),
      }));
      insightStatus = 'available';
    } catch (error) {
      insightStatus = cleanText(error instanceof Error ? error.message : error, 180);
    }
    return {
      id: cleanText(item.id, 128),
      caption: cleanText(item.caption, 260),
      type: cleanText(item.media_product_type || item.media_type, 40),
      timestamp: cleanText(item.timestamp, 40),
      permalink: cleanText(item.permalink, 400),
      visibleLikes: Number.isFinite(Number(item.like_count)) ? Number(item.like_count) : null,
      visibleComments: Number.isFinite(Number(item.comments_count)) ? Number(item.comments_count) : null,
      insightsStatus: insightStatus,
      insights,
    };
  }));

  let stories = [];
  let storiesStatus = 'unavailable';
  try {
    const result = await instagramGraphGet(env, `${accountId}/stories`, { fields: 'id,media_type,timestamp,permalink' });
    const currentStories = (Array.isArray(result?.data) ? result.data : []).slice(0, 8);
    stories = await Promise.all(currentStories.map(async (story) => {
      try {
        const data = await instagramGraphGet(env, `${cleanText(story.id, 128)}/insights`, {
          metric: 'views,reach,replies,shares,navigation',
        });
        return {
          id: cleanText(story.id, 128),
          type: cleanText(story.media_type, 40),
          timestamp: cleanText(story.timestamp, 40),
          insights: (Array.isArray(data?.data) ? data.data : []).map((entry) => ({
            name: cleanText(entry.name, 64),
            values: (Array.isArray(entry.values) ? entry.values : []).slice(0, 2).map((value) => value.value),
          })),
        };
      } catch (error) {
        return { id: cleanText(story.id, 128), timestamp: cleanText(story.timestamp, 40), insightError: cleanText(error instanceof Error ? error.message : error, 180) };
      }
    }));
    storiesStatus = 'available';
  } catch (error) {
    storiesStatus = cleanText(error instanceof Error ? error.message : error, 180);
  }
  return {
    connected: true,
    account: {
      username: cleanText(profile.username, 80),
      followers: Number.isFinite(Number(profile.followers_count)) ? Number(profile.followers_count) : null,
      mediaCount: Number.isFinite(Number(profile.media_count)) ? Number(profile.media_count) : null,
    },
    posts,
    stories,
    storiesStatus,
    ads: { status: 'not_connected', note: 'El análisis de anuncios requiere enlazar permisos y una cuenta publicitaria.' },
    collectedAt: isoNow(),
  };
}

async function releaseFollowReward(env, gate, accountId, observedFollowers, verificationMode = 'owner') {
  const policy = await env.VETSA_CLOUD.prepare('SELECT payload_ciphertext, payload_iv FROM ig_keyword_rules WHERE id = ?')
    .bind(gate.policy_id).first();
  if (!policy) throw new Error('Automation rule was not found.');
  const payload = await openPayload(env, policy.payload_ciphertext, policy.payload_iv);
  const sent = await sendInstagramText(env, { id: gate.participant_id }, payload.response, accountId);
  const now = isoNow();
  await env.VETSA_CLOUD.prepare(`
    UPDATE ig_follow_gates SET status = 'released', observed_followers = ?, verified_heuristically_at = ?, released_at = ?, updated_at = ? WHERE id = ?
  `).bind(Number.isFinite(observedFollowers) ? observedFollowers : null, verificationMode === 'heuristic' ? now : null, now, now, gate.id).run();
  return sent;
}

async function latestReplyTarget(env, accountId) {
  return env.VETSA_CLOUD.prepare(`
    SELECT participant_id, last_message_at FROM ig_conversations
    WHERE instagram_account_id = ?
    ORDER BY last_message_at DESC LIMIT 1
  `).bind(accountId).first();
}

async function executeApprovedOperation(env, operationId, requestOrigin) {
  const row = await env.VETSA_CLOUD.prepare(`
    SELECT id, instagram_account_id, operation_kind, status, approved_at, payload_ciphertext, payload_iv, provider_container_id
    FROM ig_owner_operations WHERE id = ?
  `).bind(operationId).first();
  if (!row || row.status === 'completed') return;
  if (row.status !== 'approved') throw new Error(`Operation ${operationId} is not approved.`);

  const payload = await openPayload(env, row.payload_ciphertext, row.payload_iv);
  try {
    const accountId = cleanText(row.instagram_account_id, 128) || cleanText(env.INSTAGRAM_ACCOUNT_ID, 128);
    if (row.operation_kind === 'prepare_campaign') {
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_automation_policies SET status = 'active', activated_at = ?, updated_at = ? WHERE id = ?
      `).bind(isoNow(), isoNow(), row.id).run();
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_owner_operations SET status = 'completed', completed_at = ?, error_code = NULL WHERE id = ?
      `).bind(isoNow(), row.id).run();
      console.log(JSON.stringify({ event: 'instagram_campaign_activated', operationId: row.id }));
      return;
    }
    if (row.operation_kind === 'prepare_reply') {
      const target = payload.metadata?.participantId
        ? { participant_id: cleanText(payload.metadata.participantId, 128), last_message_at: payload.metadata.lastMessageAt }
        : await latestReplyTarget(env, accountId);
      if (!target?.participant_id || !target.last_message_at || Date.parse(target.last_message_at) < Date.now() - 24 * 60 * 60 * 1000) {
        throw new Error('No active Instagram conversation is eligible for a reply.');
      }
      const sent = await sendInstagramText(env, { id: target.participant_id }, payload.text, accountId);
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_owner_operations
        SET status = 'completed', provider_media_id = ?, completed_at = ?, error_code = NULL WHERE id = ?
      `).bind(cleanText(sent?.message_id, 160) || null, isoNow(), row.id).run();
      console.log(JSON.stringify({ event: 'instagram_reply_completed', operationId: row.id }));
      return;
    }
    if (!['prepare_post', 'prepare_story', 'prepare_reel'].includes(row.operation_kind)) {
      throw new Error('This operation type is not eligible for automatic execution.');
    }
    const isVideo = cleanText(payload.media?.mimeType).startsWith('video/');
    const isStory = row.operation_kind === 'prepare_story';
    const isReel = row.operation_kind === 'prepare_reel';
    let containerId = cleanText(row.provider_container_id, 128);
    if (!containerId) {
      const mediaUrl = await mediaDeliveryUrl(env, requestOrigin, payload.media);
      const container = await instagramGraph(env, `${accountId}/media`, {
        ...(isVideo ? { video_url: mediaUrl } : { image_url: mediaUrl }),
        ...(isStory ? { media_type: 'STORIES' } : {}),
        ...(isReel ? { media_type: 'REELS', share_to_feed: true } : {}),
        ...(!isStory && payload.text ? { caption: cleanText(payload.text, 2_200) } : {}),
      });
      containerId = cleanText(container.id, 128);
      if (!containerId) throw new Error('Instagram did not return a media container.');
      await env.VETSA_CLOUD.prepare(`
        UPDATE ig_owner_operations SET provider_container_id = ? WHERE id = ?
      `).bind(containerId, row.id).run();
    }
    const container = await instagramGraphGet(env, containerId, { fields: 'status_code,status' });
    const containerStatus = cleanText(container.status_code, 40).toUpperCase();
    if (containerStatus === 'IN_PROGRESS' || !containerStatus) {
      if (Date.now() - Date.parse(row.approved_at || isoNow()) < 10 * 60_000) {
        throw new Error('instagram_container_processing');
      }
      throw new Error('Instagram media container did not become ready within ten minutes.');
    }
    if (containerStatus !== 'FINISHED') {
      throw new Error(`Instagram media container is ${containerStatus}; publication was not attempted.`);
    }
    let publish;
    try {
      publish = await instagramGraph(env, `${accountId}/media_publish`, { creation_id: containerId });
    } catch (error) {
      const message = cleanText(error instanceof Error ? error.message : error, 240);
      if (message.includes('Media ID is not available') && Date.now() - Date.parse(row.approved_at || isoNow()) < 10 * 60_000) {
        throw new Error('instagram_container_processing');
      }
      throw error;
    }
    await env.VETSA_CLOUD.prepare(`
      UPDATE ig_owner_operations
      SET status = 'completed', provider_container_id = ?, provider_media_id = ?, completed_at = ?, error_code = NULL
      WHERE id = ?
    `).bind(containerId, cleanText(publish.id, 128), isoNow(), row.id).run();
    console.log(JSON.stringify({ event: 'instagram_publication_completed', operationId: row.id, kind: row.operation_kind }));
  } catch (error) {
    const message = cleanText(error instanceof Error ? error.message : error, 240);
    if (message === 'instagram_container_processing') throw error;
    await env.VETSA_CLOUD.prepare(`
      UPDATE ig_owner_operations SET status = 'failed', error_code = ? WHERE id = ?
    `).bind(message, row.id).run();
    throw error;
  }
}

async function serveMedia(env, id) {
  const record = await env.VETSA_CLOUD.prepare(`
    SELECT object_key, mime_type FROM ig_media_delivery WHERE id = ? AND expires_at > ?
  `).bind(id, isoNow()).first();
  if (!record) return plainText('Not found', 404);
  const object = await env.VETSA_MEDIA.get(record.object_key);
  if (!object) return plainText('Not found', 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': record.mime_type || object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function handleWebhookGet(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';
  const valid = mode === 'subscribe' && await timingSafeEqual(token, env.INSTAGRAM_VERIFY_TOKEN || '');
  return valid ? plainText(challenge) : plainText('Forbidden', 403);
}

function dataDeletionInstructions() {
  return new Response(`<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eliminación de datos · Vetsa Manager</title></head>
<body style="max-width:760px;margin:48px auto;padding:0 20px;font:16px/1.6 system-ui,sans-serif;color:#17202a">
<main><h1>Eliminación de datos de Vetsa Manager</h1>
<p>Para eliminar los datos asociados a tu cuenta de Instagram, revoca el acceso de Vetsa Manager desde la configuración de aplicaciones y sitios web de Meta y envía una solicitud a <a href="mailto:ceo@vetsa.es?subject=Solicitud%20de%20eliminaci%C3%B3n%20de%20datos%20-%20Vetsa%20Manager">ceo@vetsa.es</a>.</p>
<p>Incluye tu nombre de usuario de Instagram y una dirección desde la cual podamos verificar que administras la cuenta. No envíes contraseñas ni códigos de acceso.</p>
<p>Eliminaremos tokens de acceso, identificadores de integración, mensajes, comentarios, medios temporales y registros operativos vinculados a la cuenta dentro de 30 días tras verificar la titularidad, salvo los datos mínimos que debamos conservar por obligaciones legales o de seguridad.</p>
<p><a href="https://ia.vetsa.es/privacy">Política de privacidad</a> · <a href="https://ia.vetsa.es/terms">Condiciones del servicio</a></p></main>
</body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/ping')) {
        return responseJson({
          status: 'ok',
          service: 'vetsa-instagram-operations',
          webhookReady: Boolean(env.INSTAGRAM_VERIFY_TOKEN && env.INSTAGRAM_APP_SECRET),
          mediaDeliveryReady: Boolean(env.INSTAGRAM_PUBLIC_ORIGIN),
          publishingReady: Boolean(env.INSTAGRAM_ACCESS_TOKEN && env.INSTAGRAM_ACCOUNT_ID),
        });
      }
      if (request.method === 'GET' && url.pathname === '/instagram/webhook') return handleWebhookGet(request, env);
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/instagram/data-deletion') return dataDeletionInstructions();
      if (request.method === 'POST' && url.pathname === '/instagram/webhook') {
        const rawBody = await readBodyText(request, MAX_WEBHOOK_BYTES);
        const valid = await verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256') || '', env.INSTAGRAM_APP_SECRET);
        if (!valid) return plainText('Invalid signature', 401);
        const payload = JSON.parse(rawBody);
        const eventCount = await queueWebhookEvents(env, payload);
        console.log(JSON.stringify({ event: 'instagram_webhook_received', eventCount }));
        return plainText('EVENT_RECEIVED');
      }
      if (request.method === 'POST' && url.pathname === '/internal/owner-command') return handleOwnerCommand(request, env);
      const mediaMatch = url.pathname.match(/^\/media\/([a-f0-9-]{36})$/i);
      if (request.method === 'GET' && mediaMatch) return serveMedia(env, mediaMatch[1]);
      return plainText('Not found', 404);
    } catch (error) {
      const message = cleanText(error instanceof Error ? error.message : error, 240);
      console.error(JSON.stringify({ event: 'instagram_request_error', path: url.pathname, error: message }));
      return responseJson({ error: 'Instagram operation could not be processed.' }, message === 'request_too_large' ? 413 : 500);
    }
  },

  async queue(batch, env, ctx) {
    const publicOrigin = cleanText(env.INSTAGRAM_PUBLIC_ORIGIN, 300);
    for (const message of batch.messages) {
      try {
        if (message.body?.type === 'process_webhook') await processWebhookEvent(env, cleanText(message.body.eventKey, 128));
        if (message.body?.type === 'execute_operation') await executeApprovedOperation(env, cleanText(message.body.operationId, 96), publicOrigin);
        message.ack();
      } catch (error) {
        const errorText = cleanText(error instanceof Error ? error.message : error, 240);
        console.error(JSON.stringify({
          event: 'instagram_queue_error',
          messageType: cleanText(message.body?.type, 64),
          error: errorText,
        }));
        if (message.body?.type === 'execute_operation' && errorText !== 'instagram_container_processing') {
          message.ack(); // executeApprovedOperation already persisted the failure for owner review.
        } else {
          message.retry({ delaySeconds: errorText === 'instagram_container_processing' ? 20 : 5 });
        }
      }
    }
  },
};

export const __test = { cleanText, normalizedMatchText, normalizeWebhookEvents, verifyMetaSignature, timingSafeEqual };
