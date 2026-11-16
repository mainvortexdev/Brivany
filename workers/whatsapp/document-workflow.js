import { stripAgentAddress } from './melodi-address.js';
import { parseOwnerFileRequest } from './owner-file-request.js';

const addressPattern = '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}';

export function validDocumentEmail(value) {
  const address = String(value || '').trim();
  return new RegExp(`^${addressPattern}$`, 'i').test(address) ? address.toLowerCase() : '';
}

function folded(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// This narrow fast path recognises an explicit artifact order at the start of
// the owner's message. Everything after the request line is source material,
// even if it describes a video, includes instructions, or names recipients.
// Open-ended requests continue through the semantic classifier.
export function documentArtifactRequest(value) {
  if (parseOwnerFileRequest(value)) return null;
  const message = stripAgentAddress(value);
  if (!message.trim()) return null;
  const newline = message.search(/\r?\n/);
  const firstLine = newline === -1 ? message : message.slice(0, newline);
  const inlineSource = firstLine.search(/[“"]|:\s+(?![A-Z0-9._%+-]+@)/i);
  const requestLine = inlineSource === -1 ? firstLine : firstLine.slice(0, inlineSource);
  const request = folded(requestLine);
  const action = /^(?:por favor[, :]*)?(?:(?:puedes|podrias)\s+)?(?:crea(?:me)?|genera(?:me)?|prepara(?:me)?|haz(?:me)?|convierte|exporta|redacta(?:me)?|elabora(?:me)?|quiero|necesito)\b/;
  if (!action.test(request) || !/\b(?:pdf|docx|txt|documento)\b/.test(request)) return null;
  // Preserve established quotation/template workflows and avoid interpreting
  // an order to create a video with a PDF reference as document generation.
  if (/\b(?:cotizacion|factura|plantilla)\b/.test(request)) return null;
  const artifact = request.match(/\b(?:pdf|docx|txt|documento)\b/);
  const beforeArtifact = request.slice(0, artifact.index);
  if (/\b(?:video|reel|animacion|imagen)\b/.test(beforeArtifact)) return null;
  if (/\b(?:un|una|el|la)\s+(?:video|reel|animacion|imagen)\b/.test(request.slice(artifact.index))) return null;

  const format = request.match(/\b(pdf|docx|txt)\b/)?.[1] || 'docx';
  const deliverByEmail = /\b(?:email|e-mail|correo)\b/.test(request)
    && /\b(?:envia\w*|manda\w*|remite\w*|entrega\w*)\b/.test(request);
  const explicitTo = requestLine.match(new RegExp(`\\b(?:a|para)\\s+(${addressPattern})`, 'i'))?.[1]
    || requestLine.match(new RegExp(`(?:email|e-mail|correo)(?:\\s+electronico)?\\s*:?\\s*(${addressPattern})`, 'i'))?.[1];
  const emailFrom = requestLine.match(new RegExp(`\\bdesde\\s+(${addressPattern})`, 'i'))?.[1] || '';
  const recipients = (requestLine.match(new RegExp(addressPattern, 'gi')) || [])
    .map(validDocumentEmail).filter(address => address !== validDocumentEmail(emailFrom));
  if (new Set(recipients).size > 1) return null;
  const namedTarget = !explicitTo && deliverByEmail
    ? requestLine.match(/\b(?:env[ií]a\w*|manda\w*|remite\w*|entrega\w*)\s+(?:(?:por\s+)?(?:email|e-mail|correo)(?:\s+electr[oó]nico)?\s+)?(?:a|para)\s+(.+?)(?=\s+por\s+(?:email|e-mail|correo)|$)/i)?.[1]?.trim()
    : '';
  const contactName = namedTarget && !/^(?:mi(?:\s+correo)?|m[ií])$/i.test(namedTarget) ? namedTarget : '';
  const emailToSelf = deliverByEmail && !explicitTo && !contactName
    && /\b(?:enviamelo|mandamelo|enviame|mandame|mi\s+correo|a\s+mi)\b/.test(request);

  const tail = newline === -1 ? '' : message.slice(newline).replace(/^\r?\n/, '');
  const inline = inlineSource === -1 ? '' : firstLine.slice(inlineSource).replace(/^:\s*/, '');
  // Remove only the separator around the request. Never trim, rewrite, or
  // classify the interior of the supplied document.
  const lineBreak = newline === -1 ? '' : message.slice(newline).startsWith('\r\n') ? '\r\n' : '\n';
  const sourceContent = inline ? `${inline}${lineBreak}${tail}` : tail.replace(/^\r?\n/, '');
  return {
    intent: 'generate_document', agent: 'melodi', format, documentKind: 'document',
    deliverByEmail, emailToSelf, emailTo: validDocumentEmail(explicitTo),
    emailFrom: validDocumentEmail(emailFrom), contactName: contactName || '',
    ...(sourceContent ? { sourceContent, preserveSourceContent: true } : {}),
  };
}

export function documentNeedsEmail(interpretation) {
  return Boolean(interpretation.deliverByEmail || interpretation.emailToSelf
    || interpretation.emailTo || interpretation.contactEmail || interpretation.contactName);
}

export function documentRecipientRequest(env, interpretation) {
  return {
    contactName: interpretation.contactName || '',
    contactEmail: interpretation.emailTo || interpretation.contactEmail
      || (interpretation.emailToSelf && !interpretation.contactName
        ? validDocumentEmail(env.OWNER_EMAIL_FORWARD_TO) : ''),
  };
}

export function issuedDocumentRow(document) {
  // Storage returns camelCase while provider services consume database rows.
  return {
    ...document,
    file_name: document.file_name || document.fileName,
    object_key: document.object_key || document.objectKey,
    mime_type: document.mime_type || document.mimeType,
  };
}
