/** Google Drive v3 only. API text and metadata are untrusted source data. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const DRIVE_REQUIRED_SCOPES=Object.freeze(['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/drive.file']);
export const DRIVE_AUTH_SCOPES = Object.freeze([...DRIVE_REQUIRED_SCOPES, 'openid', 'email']);
export const hasDriveAccess=scopes=>Array.isArray(scopes)&&(scopes.includes(DRIVE_SCOPE)||DRIVE_REQUIRED_SCOPES.every(scope=>scopes.includes(scope)));
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,trashed,ownedByMe,capabilities(canDownload,canEdit),appProperties,permissions(id,type,role,emailAddress)';
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json']);
const MAX_TEXT_BYTES = 128 * 1024;

export class DriveError extends Error {
  constructor(code, { status = 0, uncertain = false, retryable = false } = {}) {
    super(`Drive: ${code}`); this.name = 'DriveError'; Object.assign(this, { code, status, uncertain, retryable });
  }
}
function value(text, max = 200) {
  if (typeof text !== 'string' || !text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new TypeError('invalid_drive_value');
  return text;
}
export function driveFileId(text) {
  if (typeof text !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(text)) throw new TypeError('invalid_drive_id');
  return text;
}
function address(text) {
  if (typeof text !== 'string' || text.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[a-zA-Z]{2,}$/.test(text)) throw new TypeError('invalid_drive_email');
  return text;
}
/** Only literals are accepted: callers cannot supply arbitrary Drive q expressions. */
export function driveQueryLiteral(text) { return `'${value(text, 1000).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`; }
export function validateDriveDocument({ name, text } = {}) {
  value(name, 250);
  if (typeof text !== 'string' || !text.trim() || /\u0000/.test(text) || new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new TypeError('invalid_drive_text');
  return { name, text };
}
async function readBytes(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new DriveError('response_too_large'); }
  const reader = response.body?.getReader(); if (!reader) throw new DriveError('invalid_response');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new DriveError('response_too_large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export async function readDriveJson(response, maxBytes = 256 * 1024) {
  const bytes = await readBytes(response, maxBytes);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch { throw new DriveError('invalid_response'); }
}
async function transport(fetcher, url, options, { timeoutMs = 10000, maxBytes = 256 * 1024, text = false } = {}) {
  const mutation = ['POST', 'PUT', 'PATCH'].includes(options.method);
  try {
    const response = await fetcher(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new DriveError('redirect_rejected', { status: response.status, uncertain: mutation }); }
    if (!response.ok) {
      let body;
      try { body = await readDriveJson(response, 65536); } catch { body = {}; }
      const status = response.status;
      const disabled = body.error?.errors?.some(item => item.reason === 'accessNotConfigured') || body.error?.details?.some(item => item.reason === 'SERVICE_DISABLED');
      const code = disabled ? 'api_disabled' : status === 401 || body.error === 'invalid_grant' ? 'authorization_required' : status === 404 ? 'not_found' : status === 409 ? 'already_exists' : status === 429 || status >= 500 ? 'temporarily_unavailable' : 'provider_rejected';
      throw new DriveError(code, { status, uncertain: mutation && status >= 500, retryable: !mutation && (status === 429 || status >= 500) });
    }
    if (text) {
      const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (mime && !TEXT_TYPES.has(mime)) { await response.body?.cancel(); throw new DriveError('unsupported_content'); }
      const bytes = await readBytes(response, maxBytes);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new DriveError('unsupported_encoding'); }
    }
    return await readDriveJson(response, maxBytes);
  } catch (error) {
    if (error instanceof DriveError) { if (mutation && !error.status) error.uncertain = true; throw error; }
    throw new DriveError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'request_timeout' : 'network_error', { uncertain: mutation, retryable: !mutation });
  }
}
export function buildDriveAuthorizationUrl({ clientId, redirectUri, state, codeChallenge, expectedEmail }) {
  if (redirectUri !== 'https://ia.vetsa.es/oauth/google/callback' || !/^drive\.[a-f0-9]{64}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new TypeError('invalid_drive_authorization');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  const fields = { client_id: value(clientId, 512), redirect_uri: redirectUri, response_type: 'code', scope: DRIVE_AUTH_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: codeChallenge, code_challenge_method: 'S256' };
  if(expectedEmail!==undefined&&expectedEmail!=='')fields.login_hint=address(expectedEmail);
  for (const [key, entry] of Object.entries(fields)) url.searchParams.set(key, entry);
  return url.href;
}
export function exchangeDriveCode({ clientId, clientSecret, redirectUri, code, codeVerifier, fetcher = fetch }) {
  if (redirectUri !== 'https://ia.vetsa.es/oauth/google/callback' || !/^[a-f0-9]{64}$/.test(codeVerifier)) throw new TypeError('invalid_drive_exchange');
  return transport(fetcher, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: value(clientId, 512), client_secret: value(clientSecret, 2048), redirect_uri: redirectUri, code: value(code, 8192), code_verifier: codeVerifier, grant_type: 'authorization_code' }) }, { maxBytes: 65536 });
}
export function refreshDriveToken({ clientId, clientSecret, refreshToken, fetcher = fetch }) {
  return transport(fetcher, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: value(clientId, 512), client_secret: value(clientSecret, 2048), refresh_token: value(refreshToken, 8192), grant_type: 'refresh_token' }) }, { maxBytes: 65536 });
}
function fileMetadata(file) {
  if (!file || typeof file !== 'object' || typeof file.name !== 'string' || typeof file.mimeType !== 'string') throw new DriveError('invalid_file');
  const result = { id: driveFileId(file.id), name: file.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1000), mimeType: file.mimeType.slice(0, 150), untrusted: true };
  result.webViewLink = `https://drive.google.com/file/d/${result.id}/view`;
  for (const key of ['modifiedTime', 'size']) if (typeof file[key] === 'string') result[key] = file[key].slice(0, 100);
  for (const key of ['trashed', 'ownedByMe']) if (typeof file[key] === 'boolean') result[key] = file[key];
  if (file.capabilities && typeof file.capabilities === 'object') result.capabilities = { canDownload: file.capabilities.canDownload === true, canEdit: file.capabilities.canEdit === true };
  return result;
}
export function createDriveClient({ accessToken, fetcher = fetch, timeoutMs = 10000 } = {}) {
  if (typeof fetcher !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new TypeError('invalid_drive_transport');
  const call = async (path, { method = 'GET', body, contentType, query, upload = false, text = false, maxBytes } = {}) => {
    const token = typeof accessToken === 'function' ? await accessToken() : accessToken; value(token, 8192);
    const url = new URL((upload ? UPLOAD : API) + path);
    for (const [key, entry] of Object.entries(query || {})) if (entry !== undefined) url.searchParams.set(key, String(entry));
    return transport(fetcher, url.href, { method, headers: { authorization: `Bearer ${token}`, ...(contentType ? { 'content-type': contentType } : {}) }, ...(body !== undefined ? { body } : {}) }, { timeoutMs, maxBytes, text });
  };
  const rawFile = fileId => call(`/files/${driveFileId(fileId)}`, { query: { fields: FILE_FIELDS } });
  const getFile = async fileId => fileMetadata(await rawFile(fileId));
  const listFiles = async ({ name, fullText, pageSize = 10, pageToken } = {}) => {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new TypeError('invalid_drive_page');
    if (pageToken !== undefined) value(pageToken, 2048);
    const query = ['trashed = false'];
    if (name !== undefined) query.push(`name contains ${driveQueryLiteral(name)}`);
    if (fullText !== undefined) query.push(`fullText contains ${driveQueryLiteral(fullText)}`);
    const result = await call('/files', { query: { q: query.join(' and '), spaces: 'drive', corpora: 'user', pageSize, pageToken, orderBy: 'modifiedTime desc', fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})` } });
    if (!Array.isArray(result.files) || result.files.length > pageSize) throw new DriveError('invalid_response');
    const nextPageToken = result.nextPageToken === undefined ? undefined : value(result.nextPageToken, 2048);
    return { files: result.files.map(fileMetadata), ...(nextPageToken ? { nextPageToken } : {}), incompleteSearch: result.incompleteSearch === true, untrusted: true };
  };
  const readFile = async fileId => {
    const file = await getFile(fileId);
    if (file.trashed || file.capabilities?.canDownload === false) return { file, status: 'unsupported', reason: file.trashed ? 'file_trashed' : 'download_forbidden', untrusted: true };
    const googleDoc = file.mimeType === 'application/vnd.google-apps.document';
    if (!googleDoc && !TEXT_TYPES.has(file.mimeType)) return { file, status: 'unsupported', reason: 'unsupported_mime_type', untrusted: true };
    if (file.size && Number(file.size) > MAX_TEXT_BYTES) return { file, status: 'unsupported', reason: 'file_too_large', untrusted: true };
    try {
      const text = await call(`/files/${driveFileId(fileId)}${googleDoc ? '/export' : ''}`, { query: googleDoc ? { mimeType: 'text/plain' } : { alt: 'media' }, text: true, maxBytes: MAX_TEXT_BYTES });
      return { file, status: 'read', text, untrusted: true };
    } catch (error) {
      if (['response_too_large', 'unsupported_content', 'unsupported_encoding'].includes(error.code)) return { file, status: 'unsupported', reason: error.code, untrusted: true };
      throw error;
    }
  };
  const generateFileId = async () => {
    const result = await call('/files/generateIds', { query: { count: 1, space: 'drive', type: 'files' } });
    if (!Array.isArray(result.ids) || result.ids.length !== 1) throw new DriveError('invalid_response');
    return driveFileId(result.ids[0]);
  };
  const createDocument = async ({ name, text, fileId, requestHash } = {}) => {
    validateDriveDocument({ name, text }); driveFileId(fileId);
    if (requestHash !== undefined && !/^[a-f0-9]{64}$/.test(requestHash)) throw new TypeError('invalid_drive_request_hash');
    const boundary = `vetsa_drive_${crypto.randomUUID().replace(/-/g, '')}`;
    const metadata = { id: fileId, name, mimeType: 'text/plain', ...(requestHash ? { appProperties: { vetsaDriveRequest: requestHash } } : {}) };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--\r\n`;
    const result = await call('/files', { upload: true, method: 'POST', contentType: `multipart/related; boundary=${boundary}`, body, query: { uploadType: 'multipart', ignoreDefaultVisibility: 'true', fields: FILE_FIELDS } });
    if (result.id !== fileId || result.mimeType !== 'text/plain' || result.ownedByMe !== true || !Array.isArray(result.permissions) || !result.permissions.length || result.permissions.some(permission => permission.type !== 'user' || permission.role !== 'owner')) throw new DriveError('create_unconfirmed', { uncertain: true });
    return fileMetadata(result);
  };
  const verifyCreatedDocument = async (fileId, { name, text, requestHash }) => {
    validateDriveDocument({ name, text });
    if (!/^[a-f0-9]{64}$/.test(requestHash || '')) throw new TypeError('invalid_drive_request_hash');
    const file = await rawFile(fileId);
    if (file.name !== name || file.mimeType !== 'text/plain' || file.ownedByMe !== true || file.trashed === true || file.appProperties?.vetsaDriveRequest !== requestHash || !Array.isArray(file.permissions) || !file.permissions.length || file.permissions.some(permission => permission.type !== 'user' || permission.role !== 'owner')) throw new DriveError('create_unconfirmed', { uncertain: true });
    const content = await call(`/files/${driveFileId(fileId)}`, { query: { alt: 'media' }, text: true, maxBytes: MAX_TEXT_BYTES });
    if (content !== text) throw new DriveError('create_unconfirmed', { uncertain: true });
    return fileMetadata(file);
  };
  /** Explicit opt-in is required even for a text replacement; no deletion or sharing API exists. */
  const updateTextFile = async (fileId, { text, explicit = false } = {}) => {
    if (explicit !== true) throw new DriveError('explicit_update_required');
    validateDriveDocument({ name: 'existing-document', text });
    const before = await getFile(fileId);
    if (before.mimeType !== 'text/plain' || before.trashed || before.capabilities?.canEdit !== true) throw new DriveError('unsupported_update');
    const result = await call(`/files/${driveFileId(fileId)}`, { upload: true, method: 'PATCH', body: text, contentType: 'text/plain; charset=UTF-8', query: { uploadType: 'media', fields: FILE_FIELDS } });
    if (result.id !== fileId || result.mimeType !== 'text/plain') throw new DriveError('update_unconfirmed', { uncertain: true });
    return fileMetadata(result);
  };
  return {
    listFiles, searchFiles: ({ query, searchIn = 'name', ...options } = {}) => {
      if (!['name', 'fullText'].includes(searchIn)) throw new TypeError('invalid_drive_search');
      value(query, 1000); return listFiles({ ...options, [searchIn]: query });
    }, getFile, readFile, generateFileId, createDocument, verifyCreatedDocument, updateTextFile,
    getAccount: () => call('/about', { query: { fields: 'user(emailAddress,permissionId)' } }),
  };
}
