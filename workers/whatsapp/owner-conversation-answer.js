/** Conversation output is never evidence that a tool action took place. */
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const NAME = '(?:Melodi|Melodi|Melodi|Melodi|Melodi|Cipher)';
const LEADING_NAME = new RegExp(`^\\s*(?:\\*{1,2})?(${NAME})\\s*:\\s*(?:\\*{1,2})?\\s*`, 'i');

/** The transport owns the visible agent label; repeated labels are model noise. */
export function normalizeAgentAnswer(answer) {
  let text = String(answer || '').trim();
  for (let i = 0; i < 12 && LEADING_NAME.test(text); i++) text = text.replace(LEADING_NAME, '').trim();
  return text;
}

// No model-supplied flag can bypass this guard. Execution/status messages use
// their own verified result path; this function is for text-only conversation.
const CLAIMS = [
  /\b(?:voy a|vamos a|me encargare de|nos encargaremos de|procedere a|seguire|continuare)\s+(?:coordinar|enviar|investigar|preparar|ejecutar|registrar|programar|trabajar|revisar|descargar|subir|crear|generar|editar|montar|publicar|buscar|consultar|comprobar|guardar|analizar|organizar|avisar)\b/g,
  /\b(?:empezare|comenzare|me pondre|me pongo)\s+a\s+(?:trabajar|preparar|crear|coordinar|investigar|revisar|ejecutar|descargar|subir|editar|montar)\b/g,
  /\b(?:estoy|estamos|he estado|hemos estado|seguimos|sigo|estare)\s+(?:ya\s+)?(?:coordinando|enviando|investigando|preparando|ejecutando|registrando|programando|trabajando|revisando|descargando|subiendo|creando|generando|editando|montando|publicando|buscando|consultando|comprobando|guardando|analizando|organizando)\b/g,
  /\b(?:he|hemos)\s+(?:ya\s+)?(?:enviado|mandado|registrado|programado|coordinado|terminado|completado|preparado|creado|generado|descargado|subido|revisado|investigado|analizado|consultado|guardado|publicado|editado|montado|comprobado|trabajado|organizado|pedido|solicitado)\b/g,
  /(?:^|[,:]\s*|\b(?:ya|yo)\s+)(?:(?:te|le|lo|la|los|las|se)\s+)*(?:envie|mande|registre|programe|coordine|termine|complete|prepare|cree|genere|descargue|subi|revise|investigue|analice|consulte|guarde|publique|edite|monte|comprobe|trabaje|organice)\b/g,
  /\b(?:(?:te|le|lo|la|los|las|se)\s+)+(?:enviare|mandare|entregare|adjunto|envio|comparto|dejare|mantendre informado)\b/g,
  /(?:^|[,:]\s*)(?:adjunto|adjunte|envio|enviare|mandare|entregare|publicare|preparare|generare|creare|investigare|revisare|descargare|guardare)\b/g,
  /\b(?:el|tu|su|este|ese)\s+(?:archivo|documento|informe|reporte|video|montaje|pdf|proyecto|trabajo|correo|mensaje|encargo|resultado|solicitud)\s+(?:ya\s+)?(?:esta|quedo|se encuentra)\s+(?:listo|lista|terminado|terminada|completado|completada|preparado|preparada|enviado|enviada|subido|subida|entregado|entregada|guardado|guardada)\b/g,
  /\b(?:ya\s+)?se\s+(?:ha\s+|han\s+)?(?:enviado|generado|creado|subido|entregado|registrado|programado|guardado|publicado|completado)\b/g,
  /\b(?:ya (?:esta|quedo) (?:listo|lista|hecho|hecha|enviado|enviada)|lo tienes en (?:drive|tu correo)|te mantendre informado)\b/g,
  /\bya\s+(?:(?:te|le|lo|la|los|las|se)\s+)*(?:hice|hicimos|mande|envie|prepare|termine|complete|cree|guarde|publique|descargue|subi)\b/g,
];

function negatedClaim(prefix) {
  // Scope negation to this clause so “no pude enviarlo, pero ya lo envié”
  // still requires real evidence for its second claim.
  const local = prefix.split(/\b(?:pero|aunque|sin embargo|ademas)\b|[,;.!?\n]/).at(-1).trim();
  return /\b(?:no|nunca|jamas|tampoco|sin)\b\s*(?:(?:aun|todavia|ya|te|le|lo|la|los|las|se|nos)\s+)*(?:(?:puedo|podemos|pude|podria|hay forma de)\s+)?(?:(?:afirmar|confirmar|decir|garantizar|asegurar|prometer)\s+(?:que\s*)?)?$/.test(local)
    || /\b(?:si|cuando|hasta que)\b\s*(?:(?:te|le|lo|la|los|las|se|yo)\s+)*$/.test(local);
}

function quotedDraft(text) {
  // A wording example is a text deliverable, not an actual email or upload.
  // Ignore only its delimited block, not the surrounding response.
  return text.replace(/(?:texto|respuesta|mensaje|redaccion|borrador|ejemplo)\s+(?:sugerid[oa]|propuest[oa])\s*:\s*["“«]([^"”»]*)["”»]/gi, 'borrador');
}

function claimsUnverifiedAction(text) {
  const scanned = quotedDraft(fold(text));
  for (const pattern of CLAIMS) {
    pattern.lastIndex = 0;
    for (const match of scanned.matchAll(pattern)) {
      if (!negatedClaim(scanned.slice(0, match.index))) return true;
    }
  }
  // An internal permission description is not an actual authorization result.
  return /\b(?:mi|nuestro|su)\s+nivel\s+(?:actual\s+)?(?:es|esta)\s*\d+\b/.test(scanned)
    || /\b(?:herramienta|tool)\s+[`"']?[a-z]+_[a-z_]+[`"']?\s+(?:requiere|necesita|exige)\s+(?:un\s+)?nivel\b/.test(scanned);
}

function optionalFollowUp(sentence) {
  const line = fold(sentence);
  return /(?:quieres|te gustaria|deseas)\s+que\s+(?:(?:te|yo)\s+)?(?:mantenga|informe|envie (?:un )?resumen|avise|coordine)\b/.test(line)
    || /(?:quieres|te gustaria|deseas)\s+que\s+(?:te\s+)?(?:ayude|priorice|presente (?:algunas )?opciones|siga (?:sugiriendo|proponiendo))\b/.test(line)
    || /(?:puedo ayudarte|te ayudo)\s+con\s+(?:algo mas|algo relacionado|alguno de ellos)\b/.test(line);
}

export function ownerConversationAnswer(answer) {
  const text = normalizeAgentAnswer(answer);
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(sentence => !optionalFollowUp(sentence));
  const cleaned = kept.join(' ').trim();
  if (claimsUnverifiedAction(cleaned)) return { needsTaskStatus: true, answer: null };
  return { needsTaskStatus: false, answer: cleaned || 'Entendido.' };
}
