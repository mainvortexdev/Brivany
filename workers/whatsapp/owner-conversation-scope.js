const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Conversation can consult records; records cannot create new work. */
export function ownerConversationScope(message, projects = []) {
  const text = fold(message);
  const allProjects = /\b(?:mis|los|todos (?:mis|los))\s+proyectos\b/.test(text)
    && /\b(?:cuales|lista|listar|resumen|estado|pendientes|tengo|muestra|dime|ver|revisa)\b/.test(text);
  const matching = projects.filter(project => {
    const name = fold(project.name).trim();
    return name.length > 2 && text.includes(name);
  });
  return {
    projects: allProjects ? projects : matching,
    agenda: /\b(?:agenda|calendario|citas|recordatorios|eventos|que tengo (?:hoy|manana|pendiente)|proximas? (?:citas|reuniones))\b/.test(text)
      || /\b(?:dime|consulta|muestra|revisa)\b.*\b(?:actividad|actividades)\b/.test(text),
    taskStatus: /\b(?:como (?:va|van|sigue|siguen)|estado (?:del|de la|de los|de mi)|progreso|terminaste|acabaste|ya (?:esta|quedo)|no (?:he )?recibi|que (?:paso|ocurrio) con|trabajos? pendientes?|tareas? pendientes?)\b/.test(text),
    ecosystem: /\b(?:vetsa|cognira|spaik|alexa|wisly|que (?:puedes|sabes) hacer|capacidades)\b/.test(text),
  };
}

/** Narrow declarative fast path: a progress announcement does not request a reminder. */
export function ownerProgressAnnouncement(message) {
  const text = fold(message).trim();
  if (!text || text.length > 1000 || /[\r\n?¿]/.test(text)) return false;
  if (/\b(?:recuerda(?:me)?|recorda(?:r|me)|avisa(?:me)?|anota|registra|guarda|programa|agenda|marca|crea(?:me)?|genera(?:me)?|envia(?:me|lo)?|manda(?:me|lo)?|necesito que|quiero que|debes|tienes que|no olvides|ayuda(?:me)?|podrias|puedes|investiga|busca|haz(?:me)?|prepara|cancela|pausa|deten|olvida)\b/.test(text)) return false;
  return /^(?:(?:oye|hola)[, ]+)?(?:(?:melodi)[, :]+)?(?:hoy |manana |ahora |ya |por cierto[, ]+)?(?:yo )?(?:empezare|comenzare|iniciare|voy a empezar|voy a comenzar|voy a iniciar|empece|comence|inicie|estoy (?:creando|trabajando|terminando)|termine|he terminado)\b/.test(text);
}
