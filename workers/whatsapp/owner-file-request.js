import { stripAgentAddress } from './melodi-address.js';

function folded(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Parse only the owner's request line. A path or an instruction inside a
// supplied document is source material and never authorizes another action.
export function parseOwnerFileRequest(value) {
  const message = stripAgentAddress(value, { includeStacy: true });
  const line = message.split(/\r?\n/, 1)[0].trim();
  const requestBlock = message.split(/\r?\n\s*\r?\n/, 1)[0];
  const text = folded(line);
  if (!text || /^["“«>]/.test(text)
    || /^(?:no\b|recuerdame\b|recordar\b|avisa\w*\b|ayer\b|hoy\s+(?:empece|empezare|voy)\b)/.test(text)) return null;
  const prefix = '^[¿¡]?\\s*(?:por favor[, :]*\\s*)?(?:(?:me\\s+)?(?:puedes|podrias)\\s+)?';
  // Explicit authorship/conversion owns its following source block. Preserve
  // literal conversion, including texts which happen to describe a refusal.
  if (new RegExp(prefix + '(?:crea(?:me)?|genera(?:me)?|redacta(?:me)?|elabora(?:me)?|convierte|exporta|haz(?:me)?)\\b').test(text)) return null;
  const requested = new RegExp(prefix + '(?:necesito|quiero|envia\\w*|manda\\w*|trae\\w*|busca\\w*|recupera\\w*|abre\\w*|descarga\\w*|consigue\\w*|pasa\\w*|dame|dile\\b|pidele\\b|comunica\\w*|habla\\b)\\b').test(text);
  if (!requested) return null;

  const local = requestBlock.match(/(?<![a-z0-9])(?:[a-z]:[\\/]|\\\\[\w.-]+[\\/])[^\r\n<>"|?*]+/i)?.[0]?.trim();
  const drive = requestBlock.match(/https:\/\/(?:drive|docs)\.google\.com\/[^\s<>"“”]+/i)?.[0]?.replace(/[.,;!?)]*$/, '');
  const existing = /\b(?:este|ese|aquel|el|la|mi|nuestro|nuestra)\s+(?:mismo\s+)?(?:archivo|documento|pdf|docx|informe|reporte|factura|cotizacion|video)\b/.test(text)
    || /\b(?:archivo|documento|pdf|informe|reporte)\b.{0,100}\b(?:ya existe|guardad[oa]|emitid[oa]|esta (?:en|aqui)|ubicacion|ruta)\b/.test(text)
    || /\b[\w .-]+\.(?:pdf|docx?|txt|xlsx?|pptx?|mp4|mov|zip)\b/i.test(line);
  if (!local && !drive && !existing) return null;
  return { kind: 'existing_file', source: local ? 'local' : drive ? 'drive' : 'private',
    query: line, ...(local ? { path: local } : {}), ...(drive ? { url: drive } : {}) };
}

export function ownerFileRequestReply(request) {
  if (request?.source === 'local') {
    return 'Ese archivo ya existe en tu ordenador. La ruta local no me da acceso a su contenido desde este chat. Adjunta el archivo aquí para recuperarlo; no he creado un documento sustituto.';
  }
  if (request?.source === 'drive') {
    return 'Me estás pidiendo un archivo que ya existe en Drive. Todavía no tengo acceso confirmado a su contenido desde este chat. Adjunta el archivo o autoriza una conexión de Drive disponible antes de recuperarlo; no he descargado ni creado un sustituto.';
  }
  return 'Me estás pidiendo un documento que ya existe. Voy a buscar el original entre tus documentos privados; no crearé un sustituto.';
}

// A model's refusal is an execution failure, never the requested artifact.
// This guard applies only to newly inferred prose; literal owner content is
// intentionally allowed through the conversion path.
export function assertGeneratedDocumentContent(value) {
  const head = folded(value).replace(/^[\s#>*_`-]+/, '').slice(0, 900);
  const prefix = '(?:(?:melodi)\\s*:\\s*)?(?:(?:lo siento|lamentablemente|disculpa|sorry|i am sorry|i\\x27m sorry)[,.:;!\\s]*(?:pero\\s+|but\\s+)?)?';
  const refusal = new RegExp('^' + prefix + '(?:(?:no (?:puedo|tengo acceso|me es posible|estoy autorizad[oa])|no se puede)\\b.{0,220}\\b(?:cumplir|solicitud|peticion|acceder|archivo|documento|recuperar|ayudar|abrir|generar|crear)|(?:i (?:cannot|can\\x27t|do not have access)|i am unable)\\b.{0,180}\\b(?:request|file|document|access|help|create))');
  if (refusal.test(head)) throw new Error('document_generation_refused');
  return value;
}
