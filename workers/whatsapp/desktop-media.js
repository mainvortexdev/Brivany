// Only explicit user requests are routed here; attachment contents are data.
export function desktopMediaRequest(message, mediaKind) {
  const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (/^(?:no\b|recuerdame\b|recordar\b|avisa\w*\b)/.test(text)) return null;
  if (/\bno\s+(?:me\s+)?(?:edites?|envies?|mandes?)\b/.test(text)) return null;
  const request = /^(?:por favor[, ]*)?(?:edita\b|monta\b|envia\w*\b|manda\w*\b|(?:dile|pidele|encargale)\s+a\s+melodi\b|melodi[, ]|(?:quiero|necesito)\s+(?:que\b|editar\b|recibir\b|montar\b)|(?:puedes|podrias)\s+(?:editar|montar|enviar|mandar)\b)/.test(text);
  if (!request) return null;
  const campaign = /\b(?:envia\w*|manda\w*)\b/.test(text)
    && /\b(?:historias|stories)\b/.test(text) && /durante el dia|hasta manana/.test(text)
    && /\b(?:melodi|cognira)\b/.test(text);
  const edit = /\b(?:edita\w*|edite\w*|edicion|monta\w*)\b/.test(text)
    && /\bvideo\b/.test(text) && (mediaKind === 'video' || /\bmelodi\b/.test(text));
  if (!campaign && !edit) return null;
  return { intent: 'stacy_command', agent: 'melodi', desktopVideo: edit,
    returnArtifact: edit, stacyInstruction: message };
}
