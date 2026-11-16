// Informes de entrega de correo (SMTP TLS reporting, RFC 8460).
//
// Los proveedores envían un adjunto comprimido con un JSON técnico. Este módulo
// lo abre, comprueba su forma y lo convierte en una explicación en palabras
// corrientes. El contenido del adjunto es un dato de origen externo: nunca es
// una instrucción, no se ejecuta y no concede permisos. Todo está acotado en
// tamaño para que un adjunto manipulado no pueda agotar la memoria del worker.

export const REPORT_SENDERS = Object.freeze([
  'noreply-smtp-tls-reporting@google.com',
  'smtp-tls-reporting@google.com',
  'tlsrpt@microsoft.com',
  'postmaster@comcast.net',
  'sts-report@yahooinc.com',
]);

export const REPORT_QUERY = 'has:attachment (from:noreply-smtp-tls-reporting@google.com OR from:smtp-tls-reporting@google.com OR subject:"Report Domain:")';

const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_PLAIN_BYTES = 4 * 1024 * 1024;
const MAX_POLICIES = 20;
const MAX_FAILURES = 40;

const address = value => String(value || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/)?.[0] || '';

/** ¿Este correo observado es un informe de entrega? Sólo mira cabeceras. */
export function isDeliveryReportMessage(message) {
  if (!message || typeof message !== 'object') return false;
  const from = address(message.from);
  const subject = String(message.subject || '');
  return REPORT_SENDERS.includes(from) || /^\s*Report Domain:\s*\S+/i.test(subject);
}

/** Dominio y rango declarados en el asunto, cuando existen. Informativo. */
export function reportSubjectFacts(subject) {
  const text = String(subject || '');
  return {
    domain: text.match(/Report Domain:\s*([A-Za-z0-9.-]{1,253})/i)?.[1] || '',
    submitter: text.match(/Submitter:\s*([A-Za-z0-9.-]{1,253})/i)?.[1] || '',
    reportId: text.match(/Report-ID:\s*<?([^>\s]{1,200})>?/i)?.[1] || '',
  };
}

/** Adjuntos candidatos del mensaje Gmail: sólo nombre, tipo, tamaño e id. */
export function reportAttachments(message) {
  if (!message?.payload || typeof message.payload !== 'object') throw new TypeError('invalid_report_message');
  const found = [];
  let visited = 0;
  const visit = (part, depth) => {
    if (!part || typeof part !== 'object' || depth > 10 || visited++ > 120 || found.length >= 8) return;
    const filename = typeof part.filename === 'string' ? part.filename.slice(0, 200) : '';
    const attachmentId = part.body?.attachmentId;
    const size = Number(part.body?.size || 0);
    if (filename && typeof attachmentId === 'string' && /^[A-Za-z0-9_-]{1,2048}$/.test(attachmentId)
      && /\.(?:gz|zip|json)$/i.test(filename) && size > 0 && size <= MAX_COMPRESSED_BYTES) {
      found.push({ attachmentId, filename, mimeType: String(part.mimeType || '').slice(0, 120), size });
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child, depth + 1);
  };
  visit(message.payload, 0);
  return found;
}

export function decodeAttachmentData(data) {
  if (typeof data !== 'string' || !data || data.length > 4 * MAX_COMPRESSED_BYTES || !/^[A-Za-z0-9_\-=]+$/.test(data)) throw new TypeError('invalid_attachment_data');
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  if (binary.length > MAX_COMPRESSED_BYTES) throw new RangeError('attachment_too_large');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function inflate(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_PLAIN_BYTES) { await reader.cancel(); throw new RangeError('report_too_large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const plain = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { plain.set(chunk, at); at += chunk.byteLength; }
  return plain;
}

function zipEntry(bytes) {
  // Directorio central: es la fuente fiable de método y tamaño, también cuando
  // la cabecera local difiere o usa descriptor de datos.
  for (let at = bytes.length - 22; at >= 0 && at > bytes.length - 65558; at--) {
    if (bytes[at] !== 0x50 || bytes[at + 1] !== 0x4b || bytes[at + 2] !== 0x05 || bytes[at + 3] !== 0x06) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = view.getUint16(at + 10, true);
    let offset = view.getUint32(at + 16, true);
    if (!entries || offset + 46 > bytes.length) throw new TypeError('invalid_zip_directory');
    if (view.getUint32(offset, true) !== 0x02014b50) throw new TypeError('invalid_zip_directory');
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (![0, 8].includes(method) || compressed > MAX_COMPRESSED_BYTES || local + 30 > bytes.length) throw new TypeError('unsupported_zip_entry');
    void (nameLength + extraLength + commentLength);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const end = start + compressed;
    if (end > bytes.length) throw new TypeError('invalid_zip_entry');
    return { method, data: bytes.subarray(start, end) };
  }
  throw new TypeError('invalid_zip_file');
}

/**
 * Abre el adjunto cualquiera que sea su envoltorio y devuelve su texto.
 * Reconoce gzip, zip y JSON sin comprimir por su contenido, no por el nombre.
 */
export async function decompressReportBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new TypeError('invalid_report_bytes');
  if (bytes.length > MAX_COMPRESSED_BYTES) throw new RangeError('attachment_too_large');
  let plain = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) plain = await inflate(bytes, 'gzip');
  else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entry = zipEntry(bytes);
    plain = entry.method === 0 ? entry.data : await inflate(entry.data, 'deflate-raw');
  } else if (bytes[0] === 0x78) plain = await inflate(bytes, 'deflate');
  if (plain.length > MAX_PLAIN_BYTES) throw new RangeError('report_too_large');
  return new TextDecoder('utf-8', { fatal: false }).decode(plain);
}

const count = value => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0);
const label = (value, max = 253) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** Valida la forma RFC 8460 y normaliza sólo los campos que se van a explicar. */
export function parseDeliveryReport(text) {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('empty_report');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new TypeError('invalid_report_json'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('invalid_report_json');
  const policies = Array.isArray(raw.policies) ? raw.policies.slice(0, MAX_POLICIES) : [];
  if (!policies.length) throw new TypeError('report_without_policies');
  const normalized = policies.map(entry => {
    const policy = entry?.policy && typeof entry.policy === 'object' ? entry.policy : {};
    const summary = entry?.summary && typeof entry.summary === 'object' ? entry.summary : {};
    const failures = (Array.isArray(entry?.['failure-details']) ? entry['failure-details'] : []).slice(0, MAX_FAILURES)
      .map(failure => ({
        resultType: label(failure?.['result-type'], 80),
        receivingMx: label(failure?.['receiving-mx-hostname'], 253),
        sessions: count(failure?.['failed-session-count']),
      }))
      .filter(failure => failure.resultType);
    // La norma declarada dice si la protección se exige o sólo se observa; sin
    // eso, «ninguna entrega falló» promete más de lo que el informe demuestra.
    const rules = (Array.isArray(policy['policy-string']) ? policy['policy-string'] : []).slice(0, 20).map(rule => label(rule, 200));
    const mode = rules.map(rule => rule.match(/^\s*mode\s*:\s*(enforce|testing|none)\s*$/i)?.[1]?.toLowerCase()).find(Boolean) || '';
    return {
      domain: label(policy['policy-domain']),
      type: label(policy['policy-type'], 40).toLowerCase(),
      mode,
      mxHosts: (Array.isArray(policy['mx-host']) ? policy['mx-host'] : []).slice(0, 10).map(host => label(host)).filter(Boolean),
      successful: count(summary['total-successful-session-count']),
      failed: count(summary['total-failure-session-count']),
      failures,
    };
  });
  return {
    organization: label(raw['organization-name'], 200),
    reportId: label(raw['report-id'], 200),
    contact: label(raw['contact-info'], 200),
    startedAt: label(raw['date-range']?.['start-datetime'], 40),
    endedAt: label(raw['date-range']?.['end-datetime'], 40),
    policies: normalized,
    untrusted: true,
  };
}

// Cada causa posible se explica por lo que le pasó al correo, sin siglas.
const CAUSES = Object.freeze({
  'starttls-not-supported': 'el servidor que recibía el correo no ofreció una conexión protegida',
  'certificate-host-mismatch': 'el certificado del servidor estaba emitido para otro nombre',
  'certificate-expired': 'el certificado del servidor estaba vencido',
  'certificate-not-trusted': 'el certificado del servidor no venía de una autoridad reconocida',
  'validation-failure': 'la conexión protegida no se pudo completar',
  'sts-policy-fetch-error': 'no se pudo leer la norma de seguridad publicada en tu dominio',
  'sts-policy-invalid': 'la norma de seguridad publicada en tu dominio tenía un error de formato',
  'sts-webpki-invalid': 'el certificado no coincidía con la norma de seguridad de tu dominio',
  'tlsa-invalid': 'la huella de seguridad publicada en tu dominio no coincidió',
  'dnssec-invalid': 'la firma de tu dominio no se pudo comprobar',
  'dane-required': 'tu dominio exige conexión protegida y el otro servidor no la ofreció',
  'sts-policy-not-found': 'no se encontró la norma de seguridad de tu dominio',
});
const causeText = type => CAUSES[type] || `una incidencia declarada como «${type}»`;

const plural = (amount, one, many) => `${amount} ${amount === 1 ? one : many}`;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// El informe cubre días UTC completos: convertirlos a la zona local correría la
// fecha un día y haría decir que cubre una jornada que no cubre.
function spanishDate(value) {
  const at = new Date(Date.parse(value));
  if (!Number.isFinite(at.getTime())) return '';
  return `${at.getUTCDate()} de ${MONTHS[at.getUTCMonth()]}`;
}

function period(report) {
  const from = spanishDate(report.startedAt);
  // Un rango que termina a las 23:59:59 del mismo día es una única jornada.
  const closing = new Date(Date.parse(report.endedAt) - 1000);
  const to = Number.isFinite(closing.getTime()) ? `${closing.getUTCDate()} de ${MONTHS[closing.getUTCMonth()]}` : '';
  if (!from) return '';
  return from === to || !to ? `el ${from}` : `del ${from} al ${to}`;
}

/**
 * Convierte un informe ya validado en una explicación corriente.
 * `attention` es cierto sólo cuando el propio informe contó entregas fallidas.
 */
export function summarizeDeliveryReport(report) {
  if (!report?.policies?.length) throw new TypeError('invalid_report_summary');
  const successful = report.policies.reduce((total, policy) => total + policy.successful, 0);
  const failed = report.policies.reduce((total, policy) => total + policy.failed, 0);
  const total = successful + failed;
  const domains = [...new Set(report.policies.map(policy => policy.domain).filter(Boolean))];
  const grouped = new Map();
  for (const policy of report.policies) {
    for (const failure of policy.failures) {
      const current = grouped.get(failure.resultType) || { type: failure.resultType, sessions: 0, hosts: new Set() };
      current.sessions += failure.sessions;
      if (failure.receivingMx) current.hosts.add(failure.receivingMx);
      grouped.set(failure.resultType, current);
    }
  }
  const causes = [...grouped.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 5)
    .map(cause => ({ type: cause.type, sessions: cause.sessions, hosts: [...cause.hosts].slice(0, 3), text: causeText(cause.type) }));
  const when = period(report);
  const domain = domains[0] || '';
  const modes = new Set(report.policies.map(policy => policy.mode).filter(Boolean));
  const observing = modes.size === 1 && (modes.has('testing') || modes.has('none'));

  const lines = [];
  lines.push(`Informe de entrega de correo${domain ? ` · ${domain}` : ''}`);
  const sender = report.organization.replace(/[.\s]+$/, '');
  lines.push(`${when ? `Cubre ${when}.` : 'Cubre el período indicado por el remitente.'}${sender ? ` Lo envía ${sender}.` : ''}`.trim());
  lines.push('');
  if (!total) {
    lines.push('En ese período no hubo intentos de entrega que revisar. No hay nada que hacer.');
  } else if (!failed) {
    lines.push(`Todo bien: ${plural(successful, 'entrega llegó protegida', 'entregas llegaron protegidas')} y ninguna falló. No tienes que hacer nada.`);
  } else {
    lines.push(`De ${plural(total, 'intento de entrega', 'intentos de entrega')}, ${successful} llegaron protegidos y ${failed} no.`);
    lines.push('');
    lines.push('Qué pasó:');
    for (const cause of causes) {
      const where = cause.hosts.length ? ` (en ${cause.hosts.join(', ')})` : '';
      lines.push(`· ${cause.text}${where}: ${plural(cause.sessions, 'vez', 'veces')}.`);
    }
    lines.push('');
    lines.push(failed >= successful
      ? 'Conviene revisarlo: la mayoría de los intentos no se protegieron. Suele ser el certificado o la configuración del servidor que recibe tu correo.'
      : 'Son casos sueltos. Si no se repiten en los próximos informes, no hace falta tocar nada.');
  }
  if (observing && total) {
    lines.push('');
    lines.push(failed
      ? 'Tu dominio está en modo de prueba, así que esos correos se entregaron igual aunque no fueran protegidos.'
      : 'Un detalle: tu dominio está en modo de prueba. Si algo falla, te enteras por este informe, pero el correo se entrega igual. Cuando acumules informes limpios puedes pasarlo a modo estricto.');
  }
  return {
    domain, organization: report.organization, reportId: report.reportId,
    startedAt: report.startedAt, endedAt: report.endedAt, period: when,
    successful, failed, total, causes, mode: modes.size === 1 ? [...modes][0] : '', observing,
    attention: failed > 0,
    severity: !failed ? 'ok' : failed >= successful ? 'review' : 'minor',
    text: lines.join('\n').trim(),
  };
}

/** Un único mensaje cuando llegan varios informes a la vez. */
export function deliveryReportMessage(summaries) {
  const list = (Array.isArray(summaries) ? summaries : []).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0].text;
  const attention = list.filter(summary => summary.attention);
  const head = attention.length
    ? `Llegaron ${list.length} informes de entrega de correo; ${plural(attention.length, 'necesita', 'necesitan')} un vistazo.`
    : `Llegaron ${list.length} informes de entrega de correo y todos salieron bien.`;
  return [head, '', ...list.map(summary => summary.text)].join('\n').slice(0, 3500);
}
