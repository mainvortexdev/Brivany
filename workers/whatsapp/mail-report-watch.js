// Aviso automático de informes de entrega de correo.
//
// En cada tick se consulta el buzón conectado por los informes llegados desde
// la última revisión y se avisa una sola vez por informe. El registro guarda
// únicamente identificadores y marcas de tiempo: no se guarda el contenido del
// correo ni el adjunto. Si el buzón no está conectado o el adjunto no se puede
// abrir, se declara el hecho y no se anuncia un resultado inventado.

import { withGmailClient } from './gmail-auth.js';
import { listNewDeliveryReports } from './mail-report-reader.js';
import { deliveryReportMessage } from './mail-report-digest.js';

export const DELIVERY_REPORT_SCHEMA = `CREATE TABLE IF NOT EXISTS melodi_delivery_report_watch (
  owner_phone TEXT NOT NULL, report_key TEXT NOT NULL, checked_at INTEGER NOT NULL,
  announced_at INTEGER, PRIMARY KEY(owner_phone, report_key))`;

const WATERMARK = '\u0000watermark';
const LOOKBACK_MS = 7 * 86_400_000;
const phoneOf = value => String(value || '').replace(/\D/g, '');

async function ensureSchema(db) { await db.prepare(DELIVERY_REPORT_SCHEMA).run(); }

async function watermark(db, phone, now) {
  const row = await db.prepare('SELECT checked_at FROM melodi_delivery_report_watch WHERE owner_phone=? AND report_key=?').bind(phone, WATERMARK).first();
  const stored = Number(row?.checked_at || 0);
  return Number.isFinite(stored) && stored > 0 ? stored : now - LOOKBACK_MS;
}

async function moveWatermark(db, phone, at) {
  await db.prepare(`INSERT INTO melodi_delivery_report_watch(owner_phone,report_key,checked_at) VALUES(?,?,?)
    ON CONFLICT(owner_phone,report_key) DO UPDATE SET checked_at=MAX(checked_at,excluded.checked_at)`).bind(phone, WATERMARK, at).run();
}

/** Reserva el aviso antes de enviarlo: un reintento no repite el mensaje. */
async function claim(db, phone, key, now) {
  const result = await db.prepare('INSERT OR IGNORE INTO melodi_delivery_report_watch(owner_phone,report_key,checked_at) VALUES(?,?,?)').bind(phone, key, now).run();
  return Boolean(result?.meta?.changes);
}

async function markAnnounced(db, phone, key, now) {
  await db.prepare('UPDATE melodi_delivery_report_watch SET announced_at=? WHERE owner_phone=? AND report_key=?').bind(now, phone, key).run();
}

/**
 * Revisa el buzón y avisa por WhatsApp los informes nuevos.
 * Devuelve siempre el estado observado; no lanza por un buzón sin conectar.
 */
export async function announceDeliveryReports(env, sendText, { now = Date.now(), withClient = withGmailClient } = {}) {
  const phone = phoneOf(env.OWNER_WHATSAPP_NUMBER);
  if (!/^\d{8,15}$/.test(phone) || !env.VETSA_CLOUD) return { status: 'unconfigured', announced: 0 };
  const db = env.VETSA_CLOUD;
  await ensureSchema(db);
  const since = await watermark(db, phone, now);

  let digests;
  try {
    digests = await withClient(env, phone, api => listNewDeliveryReports(api, { sinceSeconds: Math.floor(since / 1000) }));
  } catch (error) {
    // Una desconexión o un fallo del proveedor no mueve la marca: el informe
    // se volverá a mirar en el siguiente tick.
    return { status: error?.code === 'authorization_required' ? 'disconnected' : 'retrying', announced: 0 };
  }

  // Un informe que no se pudo abrir también se cuenta: se dice que llegó y que
  // su adjunto no se pudo leer, en vez de dejarlo en silencio.
  const notable = digests.filter(digest => ['ready', 'unreadable'].includes(digest.status)).map(digest => digest.status === 'ready' ? digest : {
    ...digest, attention: true,
    text: `Informe de entrega de correo${digest.domain ? ` · ${digest.domain}` : ''}\nLlegó${digest.date ? ` el ${digest.date.slice(0, 16)}` : ''}, pero no pude abrir su adjunto. Queda en tu correo por si quieres revisarlo.`,
  });
  const pending = [];
  for (const digest of notable) {
    const key = digest.reportId || digest.messageId;
    if (!key || !await claim(db, phone, key, now)) continue;
    pending.push({ ...digest, key });
  }

  let announced = 0;
  if (pending.length) {
    const body = deliveryReportMessage(pending);
    try {
      await sendText(env, phone, body);
      for (const digest of pending) await markAnnounced(db, phone, digest.key, now);
      announced = pending.length;
    } catch (error) {
      // El aviso no salió: se libera la reserva para reintentarlo más tarde.
      for (const digest of pending) await db.prepare('DELETE FROM melodi_delivery_report_watch WHERE owner_phone=? AND report_key=? AND announced_at IS NULL').bind(phone, digest.key).run();
      console.error(JSON.stringify({ event: 'delivery_report_announce_failed', reason: String(error?.message || '').slice(0, 120) }));
      return { status: 'retrying', announced: 0, pending: pending.length };
    }
  }

  const latest = digests.reduce((top, digest) => Math.max(top, Number(digest.receivedAt) || 0), 0);
  if (latest > since) await moveWatermark(db, phone, latest);
  else if (!digests.length) await moveWatermark(db, phone, now - 60_000);
  return { status: 'checked', announced, reviewed: digests.length, unreadable: digests.filter(digest => digest.status === 'unreadable').length };
}
