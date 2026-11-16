// Lectura de informes de entrega de correo sobre un cliente Gmail ya autorizado.
//
// Separa el acceso al proveedor de la interpretación: aquí sólo se localiza el
// correo, se baja el adjunto y se delega en `mail-report-digest.js`. El estado
// devuelto distingue siempre «no hay informe», «no se pudo abrir» y «listo»;
// nunca se inventa un resultado cuando el adjunto no se pudo leer.

import {
  REPORT_QUERY, isDeliveryReportMessage, reportSubjectFacts, reportAttachments,
  decodeAttachmentData, decompressReportBytes, parseDeliveryReport, summarizeDeliveryReport,
} from './mail-report-digest.js';

const header = (message, name) => {
  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
  return String(headers.find(item => String(item.name).toLowerCase() === name)?.value || '').replace(/[\r\n\u0000]/g, ' ').slice(0, 500);
};

/** Abre un correo ya recuperado. Devuelve el resumen o el motivo exacto del fallo. */
export async function digestReportMessage(api, message) {
  const facts = reportSubjectFacts(header(message, 'subject'));
  const base = { messageId: message?.id || '', subject: header(message, 'subject'), from: header(message, 'from'), date: header(message, 'date'), ...facts };
  if (!isDeliveryReportMessage({ from: base.from, subject: base.subject })) return { ...base, status: 'not_a_report' };
  const attachments = reportAttachments(message);
  if (!attachments.length) return { ...base, status: 'without_attachment' };
  for (const attachment of attachments) {
    try {
      const payload = await api.getAttachment(message.id, attachment.attachmentId);
      const text = await decompressReportBytes(decodeAttachmentData(payload?.data));
      const summary = summarizeDeliveryReport(parseDeliveryReport(text));
      return { ...base, status: 'ready', attachment: attachment.filename, ...summary };
    } catch (error) {
      base.failure = /^[a-z_]{1,60}$/.test(error?.message || '') ? error.message : 'unreadable_attachment';
    }
  }
  return { ...base, status: 'unreadable' };
}

/**
 * Informe más reciente, o el que indique `messageId`.
 * `limit` acota cuántos candidatos se abren cuando el buzón mezcla otros correos.
 */
export async function readDeliveryReport(api, { messageId, limit = 3 } = {}) {
  if (messageId) return digestReportMessage(api, await api.getMessage(messageId));
  const listed = await api.listMessages({ q: REPORT_QUERY, maxResults: Math.min(Math.max(limit, 1), 5) });
  const rows = Array.isArray(listed?.messages) ? listed.messages.filter(row => typeof row?.id === 'string') : [];
  if (!rows.length) return { status: 'not_found' };
  let last = { status: 'not_found' };
  for (const row of rows) {
    last = await digestReportMessage(api, await api.getMessage(row.id));
    if (last.status === 'ready') return last;
  }
  return last;
}

/**
 * Informes recibidos después de `sinceSeconds` (segundos epoch de Gmail).
 * Devuelve los legibles en orden de llegada, del más antiguo al más reciente.
 */
export async function listNewDeliveryReports(api, { sinceSeconds, limit = 5 } = {}) {
  if (!Number.isInteger(sinceSeconds) || sinceSeconds < 0) throw new TypeError('invalid_report_since');
  const listed = await api.listMessages({ q: `${REPORT_QUERY} after:${sinceSeconds}`, maxResults: Math.min(Math.max(limit, 1), 10) });
  const rows = Array.isArray(listed?.messages) ? listed.messages.filter(row => typeof row?.id === 'string') : [];
  const digests = [];
  for (const row of rows.slice(0, limit)) {
    const message = await api.getMessage(row.id);
    const receivedAt = Number(message?.internalDate || 0);
    if (Number.isFinite(receivedAt) && receivedAt > 0 && receivedAt <= sinceSeconds * 1000) continue;
    digests.push({ ...await digestReportMessage(api, message), receivedAt });
  }
  return digests.sort((first, second) => first.receivedAt - second.receivedAt);
}
