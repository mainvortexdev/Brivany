// Preferencia de voz del titular: si pide que le responda hablando, Melodi
// sigue haciéndolo hasta que pida texto otra vez.
//
// La preferencia es del propietario y vive en su propio ámbito; no la cambia un
// mensaje citado ni el contenido de un archivo, sólo una petición suya que el
// planificador reconoce. Si la síntesis falla, la respuesta sale escrita: una
// preferencia de formato nunca puede costarle una respuesta.

export const VOICE_MODE_SCHEMA = `CREATE TABLE IF NOT EXISTS melodi_voice_mode (
  owner_phone TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('voice','text')), updated_at INTEGER NOT NULL)`;

export const VOICE_MODES = Object.freeze(['voice', 'text']);
// Una respuesta con enlaces o muy larga se acompaña del texto: un enlace dicho
// en voz alta no se puede abrir, y un bloque largo no se recuerda de oído.
const SPOKEN_LIMIT = 1200;
const LINK = /https?:\/\/\S+/i;

const phoneOf = value => String(value || '').replace(/\D/g, '');

async function ensureSchema(db) { await db.prepare(VOICE_MODE_SCHEMA).run(); }

/** Modo vigente. Sin registro, el formato normal es el texto. */
export async function readVoiceMode(env, phone) {
  const owner = phoneOf(phone);
  if (!owner || !env?.VETSA_CLOUD?.prepare) return 'text';
  await ensureSchema(env.VETSA_CLOUD);
  const row = await env.VETSA_CLOUD.prepare('SELECT mode FROM melodi_voice_mode WHERE owner_phone=?').bind(owner).first();
  return VOICE_MODES.includes(row?.mode) ? row.mode : 'text';
}

/** Guarda el modo y devuelve el que quedó escrito, no el que se pidió. */
export async function setVoiceMode(env, phone, mode, { now = Date.now() } = {}) {
  const owner = phoneOf(phone);
  if (!owner) throw new TypeError('invalid_voice_mode_owner');
  if (!VOICE_MODES.includes(mode)) throw new TypeError('invalid_voice_mode');
  if (!env?.VETSA_CLOUD?.prepare) throw new Error('voice_mode_storage_required');
  await ensureSchema(env.VETSA_CLOUD);
  await env.VETSA_CLOUD.prepare(`INSERT INTO melodi_voice_mode(owner_phone,mode,updated_at) VALUES(?,?,?)
    ON CONFLICT(owner_phone) DO UPDATE SET mode=excluded.mode,updated_at=excluded.updated_at`).bind(owner, mode, now).run();
  return readVoiceMode(env, phone);
}

/** ¿Esta respuesta necesita además el texto, aunque el modo sea voz? */
export function needsWrittenCopy(body) {
  const text = String(body ?? '');
  return text.length > SPOKEN_LIMIT || LINK.test(text);
}

/**
 * Envuelve la entrega de respuestas del turno. Con el modo en voz, el texto se
 * dice; si la síntesis no sale, se entrega escrito y se informa del hecho.
 */
export function voiceAwareReply({ env, phone, sendText, sendVoice, onFallback }) {
  if (typeof sendText !== 'function') throw new TypeError('voice_mode_transport_required');
  return async (body, options = {}) => {
    const text = String(body ?? '').trim();
    if (!text) return sendText(body, options);
    // Una entrega marcada como escrita, por ejemplo un enlace de consentimiento,
    // conserva su formato aunque el modo sea voz.
    if (options.written === true || typeof sendVoice !== 'function') return sendText(body, options);
    let mode = 'text';
    try { mode = await readVoiceMode(env, phone); }
    catch { mode = 'text'; }
    if (mode !== 'voice') return sendText(body, options);
    try {
      const spoken = await sendVoice(text);
      if (spoken?.status !== 'sent') throw Object.assign(Error('voice_reply_unconfirmed'), { code: 'voice_reply_unconfirmed' });
      if (needsWrittenCopy(text)) await sendText(body, options);
      return spoken;
    } catch (error) {
      if (typeof onFallback === 'function') await onFallback(error);
      return sendText(body, options);
    }
  };
}
