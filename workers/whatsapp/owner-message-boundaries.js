import { stripAgentAddress } from './melodi-address.js';

const AGENTS = ['melodi'];
const MEMBERS = AGENTS.join('|');

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function directBody(value) {
  return stripAgentAddress(value, { includeStacy: true }).trim();
}

/** A pending reminder only owns an actual time/date answer, never the next message. */
export function ownerReminderContinuation(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > 180 || /[\r\n]/.test(text)) return false;
  if (/^\d{4}-\d{2}-\d{2}(?:[tT]\d{2}:\d{2}(?::\d{2})?(?:[zZ]|[+-]\d{2}:\d{2}))?$/.test(text)) return Number.isFinite(Date.parse(text));
  const s = normalized(text).replace(/\b([ap])\s*\.\s*m\s*\.?/g, '$1m').replace(/[.,!?¿¡]+$/g, '').trim();
  if (!s || !/^(?:[\p{L}\d\s:/-]+)$/u.test(s)) return false;
  const words = s.replace(/[\d:/-]+/g, ' ').split(/\s+/).filter(Boolean);
  const vocabulary = new Set(('a al el la las los de del por para en dentro y con hoy manana pasado lunes martes miercoles jueves viernes sabado domingo este esta proximo proxima siguiente dia dias semana semanas mes meses ano anos enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre mediodia medianoche tarde noche madrugada am pm h hora horas minuto minutos segundo segundos un una uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte veintiuna veintidos treinta cuarenta cincuenta media cuarto dominicana dominicano republica rd').split(' '));
  if (words.some(word => !vocabulary.has(word))) return false;
  const hasTime = /\d/.test(s) || /\b(?:hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|mediodia|medianoche|tarde|noche|madrugada|am|pm)\b/.test(s)
    || /\b(?:un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|treinta)\b.*\b(?:hora|horas|minuto|minutos|dia|dias|semana|semanas)\b/.test(s);
  return hasTime;
}

/** Recipient clarification accepts an address or a short contact name only. */
export function ownerRecipientContinuation(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length > 120 || /[\r\n]/.test(text)) return false;
  const stripped = text.replace(/[, ]*por favor[.! ]*$/i, '').replace(/[.!]+$/, '').trim();
  if (/^(?:(?:a|para|al correo|el correo es|su correo es)\s+)?[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(stripped)) return true;
  const name = stripped.replace(/^(?:a|para)\s+/i, '').trim();
  if (name.length > 65 || !/^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,4}$/u.test(name)) return false;
  const s = normalized(name);
  if (AGENTS.includes(s)) return false;
  if (/^(?:me|te|se|esto|eso|es|el|la|pero|y)\b/.test(s)
    || /\b(?:envia(?:r|me|lo|la|los|las|s)?|envi(?:o|aste|aron)|manda(?:r|me|lo|la|los|las)?|haz(?:me|lo|la)?|avisa(?:me|r|ste)?|revisa(?:r|me|lo)?|ayuda(?:me|r)?|dame|hace|hacer|hice|puedo|podemos|explica(?:me|r|ste)|reporte|informe)\b/.test(s)) return false;
  const excluded = /\b(?:si|no|ok|okay|vale|gracias|perfecto|entendido|listo|hola|oye|buenos|buenas|mal|error|fallo|fallido|fallida|funciona|funciono|entiendo|entiendes|equivocaste|equivocado|otra|nuevo|nueva|ahora|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|hora|horas|minutos|tarde|noche|crea|crear|creame|genera|generar|haz|hazme|prepara|preparar|envia|enviar|enviame|mandame|manda|enviar|investiga|investigar|analiza|recuerda|recuerdame|recordatorio|reanuda|reanudar|reintenta|reintentar|intenta|continua|retoma|trabajo|tarea|documento|correo|pdf|historia|apruebo|rechazo|cancela|cancelar|deten|detener|para|detenlo|necesito|quiero|puedes|debes|incorrecto|incorrecta|porque|serio)\b/;
  return !excluded.test(s);
}

/** Only standalone social messages are answered without creating an action. */
export function ownerSocialReply(raw) {
  let s = normalized(directBody(raw));
  if (!s || s.length > 140 || /[\r\n]/.test(s)) return null;
  s = s.replace(new RegExp(`[, ]+(?:${MEMBERS})[.! ]*$`), '').replace(/[.!?¿¡\s]+$/g, '').trim();
  if (/^(?:muchas )?gracias(?: por (?:enviarmelo|enviarlo|mandarmelo|el envio))?[, ]+(?:pero )?no me avisaste(?: del envio| que lo enviaste)?$/.test(s)) return 'Tienes razón: faltó avisarte en este chat. Gracias por decírmelo.';
  if (/^(?:muchas |mil )?gracias(?: por todo)?$/.test(s)) return 'De nada. Aquí estaré cuando me necesites.';
  if (/^(?:ok|okay|vale|perfecto|entendido|listo|de acuerdo|esta bien)$/.test(s)) return 'Entendido.';
  if (/^(?:hola|buenos dias|buenas tardes)$/.test(s)) return 'Hola. Aquí estoy.';
  if (/^(?:no[,!\s]*)?(?:es todo por hoy[.!\s]*)?(?:hasta manana|hasta luego|adios|buenas noches)$/.test(s)) return 'Hasta mañana. Que descanses.';
  return null;
}

/** Receipt confirms the request was read; execution/delivery still needs evidence. */
export function ownerActionReceipt(raw, agent = 'melodi') {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let first = normalized(directBody(raw).split(/\r?\n/, 1)[0]);
  first = first.replace(new RegExp(`^(?:(?:no|perdon|corrijo)[, :]+)?(?:esto|eso|esta tarea|este trabajo|este documento|este encargo) (?:es|era) para (?:la agente )?(?:${MEMBERS})\\s*[.:,]\\s*`), '');
  first = first.replace(/^(?:por favor[, ]+|puedes\s+|quiero (?:que\s+)?|necesito (?:que\s+)?)/, '').replace(/^(?:me\s+|que\s+)/, '');
  const identity = AGENTS.includes(agent) ? agent[0].toUpperCase() + agent.slice(1) : 'Melodi';
  if (/^(?:reanuda|reanudar|retoma|retomar|reintenta|reintentar|continua|continuar|vuelve a intentar(?:lo)?|intenta(?:lo)? (?:de nuevo|otra vez))\b/.test(first)) return `${identity}: Recibí tu petición de reintentar el trabajo. Voy a revisar el fallo y recuperar el encargo original.`;
  if (/^(?:crea|crear|creame|genera|generar|generame|prepara|preparar|haz|hazme|arma|elabora|convierte|convertir|exporta)\b/.test(first)
    && /\b(?:pdf|documento|docx|word|informe|reporte|presentacion|pptx)\b/.test(first.slice(0, 220))) return `${identity}: Recibí tu solicitud. Voy a preparar el documento con el contenido que enviaste y te avisaré del resultado.`;
  if (/^(?:envia|enviar|enviame|mandame|manda|mandar|redacta|redactar|prepara|preparar|responde|responder)\b/.test(first)
    && /\b(?:correo|email|e-mail|mail)\b/.test(first.slice(0, 220))) return `${identity}: Recibí tu petición de correo. Voy a comprobar el destinatario y el contenido antes de enviarlo.`;
  if (/^(?:investiga|investigar|investigues|investigame|busca|buscar|analiza|analizar|analices|revisa|revisar|estudia|estudiar)\b/.test(first)) return `${identity}: Recibí tu encargo de investigación. Voy a revisar las fuentes y preparar el resultado.`;
  return null;
}
