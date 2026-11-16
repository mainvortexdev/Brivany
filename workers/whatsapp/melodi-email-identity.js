import { ownerActionReceipt, ownerSocialReply } from './owner-message-boundaries.js';
import { stripAgentAddress } from './melodi-address.js';
import { shortReminderTime } from './reminder-language.js';

const NAMES = Object.freeze({ melodi: 'Melodi' });
const BUSINESS_SENDERS = ['ceo@vetsa.es', 'daniel@vetsa.es'];
// Existing verified transport mailbox; display identity is Melodi in Brivany.
export const MELODI_MAILBOX = 'emily@vetsa.es';

export const AGENT_EMAIL_SENDERS = Object.freeze([MELODI_MAILBOX]);
export const VETSA_EMAIL_SENDERS = Object.freeze([...AGENT_EMAIL_SENDERS, ...BUSINESS_SENDERS]);

export function agentForEmail(address) {
  const value = String(address || '').trim().toLowerCase();
  if (value === MELODI_MAILBOX) return 'melodi';
  const local = value.endsWith('@vetsa.es') ? value.slice(0, -9) : value;
  return Object.hasOwn(NAMES, local) ? local : null;
}

/** Sender changes belong to the owner's first command, never model output or supplied content. */
export function literalEmailSender(value) {
  const raw = String(value || '').trimStart().split(/\r?\n/, 1)[0];
  if (/^[“"'«]/.test(raw)) return '';
  const first = stripAgentAddress(raw, { includeStacy: true });
  const boundary = first.search(/[“"«]|:\s+(?![A-Z0-9._%+-]+@)/i);
  const command = boundary === -1 ? first : first.slice(0, boundary);
  const sender = command.match(/\b(?:desde|from)\s+(?:(?:el\s+correo|la\s+cuenta|la\s+direcci[oó]n)(?:\s+de)?\s+)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|melodi|ceo|daniel)\b/i)?.[1];
  return sender ? sender.toLowerCase() : '';
}

/** A waiting body owns supplied prose, not a new action, question, refusal or approval. */
export function ownerEmailBodyContinuation(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const label = raw.match(/^(?:cuerpo(?:\s+del\s+correo)?|texto\s+del\s+correo|contenido\s+del\s+correo)\s*:\s*/i);
  if (label) return Boolean(raw.slice(label[0].length).trim());
  if (ownerActionReceipt(raw) || ownerSocialReply(raw)) return false;
  const text = stripAgentAddress(raw, { includeStacy: true }).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[.!]+$/, '').trim();
  if (/[?¿]/.test(text) || /^(?:no\s+(?:envies|enviar|mandes|hagas|continues|lo envies|lo mandes|autorizo|quiero)|cancela\w*|deten\w*|stop|ayuda|help)\b/.test(text)) return false;
  if (/^(?:apruebo|aprobar|rechazo|rechazar|autorizo|deniego|acepto|confirmo)\b/.test(text)) return false;
  if (/^(?:(?:por favor[, :]+|me\s+|puedes\s+|podrias\s+|quiero\s+(?:que\s+)?|necesito\s+(?:que\s+)?)*)?(?:crea\w*|genera\w*|prepara\w*|haz\w*|arma\w*|elabora\w*|convierte\w*|exporta\w*|envia\w*|manda\w*|redacta\w*|responde\w*|investiga\w*|busca\w*|analiza\w*|revisa\w*|estudia\w*|recuerda\w*|reanuda\w*|retoma\w*|reintenta\w*|continua\w*|vuelve\s+a\s+intentar|cuentame|hablame|explica\w*|dime|consulta\w*|muestra\w*|abre\w*|borra\w*|elimina\w*|guarda\w*)\b/.test(text)) return false;
  if (/^(?:me\s+)?(?:puedes|podrias|quiero|necesito|que\s+(?:hora|es|paso|hiciste|haces)|como\s+(?:va|esta|puedo|hago))\b/.test(text)) return false;
  return !/^(?:si|no|ok|okay|vale|perfecto|entendido|listo|de acuerdo|esta bien|para|gracias|muchas gracias|mil gracias|hola|buenos dias|buenas tardes|buenas noches|hasta manana|hasta luego|adios)$/.test(text);
}

/** A requested sender is either honored exactly or rejected; never replaced by Melodi. */
export function agentEmailIdentity(agent = 'melodi', { from, senderName } = {}) {
  if (!Object.hasOwn(NAMES, agent)) throw new Error('email_unknown_agent');
  const requested = from === undefined || from === null || from === '' ? MELODI_MAILBOX : String(from).trim().toLowerCase();
  const address = requested==='melodi'?MELODI_MAILBOX:requested.includes('@') ? requested : `${requested}@vetsa.es`;
  if (!VETSA_EMAIL_SENDERS.includes(address)) throw new Error('email_sender_not_allowed');
  const name = NAMES[agent];
  return { agent, from: address, name,
    senderName: typeof senderName === 'string' && senderName.trim() ? senderName.trim().slice(0, 120) : `${name} · Brivany` };
}

export function documentAcceptedReply({ agent = 'melodi', format = 'pdf', emailDelivery, deliveryAt } = {}) {
  agentEmailIdentity(agent);
  const document = format === 'pdf' ? 'PDF' : format === 'docx' ? 'documento Word' : 'documento de texto';
  const destination = emailDelivery?.to ? `lo enviaré a ${emailDelivery.to}` : 'te lo compartiré por aquí';
  const when = deliveryAt ? shortReminderTime(deliveryAt, 'America/Santo_Domingo').replace(/\.$/, '') : 'en cuanto termine';
  return `Vale, prepararé el ${document} y ${destination} ${when}.${deliveryAt ? ' La entrega quedó en el calendario.' : ''}`;
}
