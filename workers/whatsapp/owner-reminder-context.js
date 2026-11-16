function plain(value) {
  return String(value || '').trim();
}

function normalized(value) {
  return plain(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function hasReferenceCue(message) {
  const text = normalized(message);
  return /\b(?:eso|esto|aquello|lo que|lo mencionado|lo pendiente|esa tarea|ese trabajo|ese proyecto|el siguiente paso|el proximo paso)\b/.test(text)
    || /\b(?:agendalo|programalo|recuerdamelo|anotalo)\b/.test(text);
}

function suppliedTask(value) {
  const text = normalized(value).replace(/^(?:un|una|unos|unas|el|la|los|las)\s+/, '');
  if (text.length < 3 || hasReferenceCue(text)) return false;
  const withoutTiming = text
    .replace(/\b[ap]\s*$/, '') // The period in a.m./p.m. can end this clause.
    .replace(/\b(?:hoy|manana|pasado|el|la|los|las|a|en|para|por|de|del|este|esta|proximo|proxima|lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|am|pm)\b/g, ' ')
    .replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  // These descriptions still require an antecedent; a concrete noun such as
  // "rodaje" does not. Do not turn a scheduling pronoun into a guessed title.
  return Boolean(withoutTiming)
    && !/^(?:(?:algo|otr[oa]s?|cosas?|tareas?|eventos?|trabajos?|proyectos?|pendientes?|nuev[oa]s?|mas|que hacer)\s*)+$/.test(withoutTiming)
    && !/\b(?:que (?:mencionaste|dijiste|comentaste)|lo de|lo anterior)\b/.test(text);
}

/** A scheduling pronoun may point to a task in this very message. */
function suppliesCurrentTask(message) {
  const text = plain(message);
  const command = /\b(?:ag[eé]ndalo|progr[aá]malo|recu[eé]rdamelo|an[oó]talo)\b/iu.exec(text);
  if (!command) return false;
  const before = text.slice(0, command.index);
  for (const match of before.matchAll(/\b(?:tengo|tenemos|tendr[eé]|tendremos)\s+([^,;.!?\n]+)/giu)) {
    const prefix = normalized(before.slice(0, match.index));
    // A negation or a report of an earlier statement is not a new owner event.
    if (/\b(?:no|nunca|tampoco|sin|si|dijo|dice|dijiste|mencionaste|segun|recuerdas|ayer|antes|anterior|texto|mensaje|ejemplo)\b/.test(prefix)) continue;
    if (suppliedTask(match[1])) return true;
  }
  // Also accept an explicitly supplied title after a labelled instruction,
  // without trying to extract dates or split multiple calendar events here.
  const after = text.slice(command.index + command[0].length);
  const labelled = after.match(/^\s*(?:(?:en|a)\s+(?:mi|la)\s+agenda\s*)?:\s*([^\n]+)/iu);
  return Boolean(labelled && suppliedTask(labelled[1]));
}

/** A reference is resolved only when the current message needs an antecedent. */
export function reminderHasTaskReference(message) {
  return hasReferenceCue(message) && !suppliesCurrentTask(message);
}

function containsName(message, name) {
  const source = ` ${normalized(message)} `;
  const target = normalized(name);
  return target.length >= 3 && source.includes(` ${target} `);
}

function concreteAction(value) {
  const text = plain(value).replace(/^[•*\-\s]+/, '').replace(/[.!]+$/, '').trim();
  if (!text || text.length > 400 || hasReferenceCue(text)) return '';
  return text;
}

function titleFor(action, project) {
  return containsName(action, project.name) ? action : `${action} (${project.name})`;
}

/** Extract explicitly labelled next steps, never an arbitrary calendar title. */
function mentionedSteps(message, projects) {
  const entries = [];
  const multipleTopics = /\b(?:recordatorio|evento|trabajo fallido|tarea fallida)\b/i.test(message);
  for (const line of plain(message).split(/\r?\n/)) {
    const labelled = line.match(/(?:siguiente paso|pr[oó]ximo paso|pr[oó]xima tarea)\s*(?::|[—–-]|es\b)\s*([^\n]+)/i);
    if (!labelled) continue;
    const action = concreteAction(labelled[1].split(/(?<=[.!?])\s+(?=[¿¡A-ZÁÉÍÓÚ])/u, 1)[0]);
    if (!action) continue;
    const leadingSentence = line.slice(0, labelled.index).split(/[.!?]\s+/).at(-1);
    const sameLine = projects.filter(project => containsName(leadingSentence, project.name) || containsName(action, project.name));
    const inMessage = projects.filter(project => containsName(message, project.name));
    // Multi-project messages need an association on the same line.
    const project = sameLine.length === 1 ? sameLine[0] : !multipleTopics && inMessage.length === 1 ? inMessage[0] : null;
    entries.push({ action, project });
  }
  return entries;
}

/**
 * The caller supplies only this owner's selected-agent conversation. Shared
 * project records are data; other agents' private goals/history are excluded.
 */
export function resolveReminderTaskReference(message, { projects = [], recent = [], agent } = {}) {
  if (!reminderHasTaskReference(message)) return { requested: false };
  const known = projects.filter(project => plain(project?.name)).slice(0, 40);
  const named = known.filter(project => containsName(message, project.name));
  if (named.length > 1) return { requested: true, clarification: '¿Qué tarea concreta de esos proyectos quieres que agende?' };

  const ownAssistant = recent.filter(turn => turn?.role === 'assistant' && (!turn.agent || turn.agent === agent)).slice(-4);
  // Use the last substantive message, ignoring receipts and short confirmations.
  const last = [...ownAssistant].reverse().find(turn => mentionedSteps(turn.message, known).length > 0);
  const mentions = last ? mentionedSteps(last.message, known) : [];
  if (named.length === 1) {
    const project = named[0];
    const explicit = mentions.filter(item => item.project === project);
    if (explicit.length > 1) return { requested: true, clarification: `¿Qué tarea concreta de ${project.name} quieres que agende?` };
    const action = explicit[0]?.action || concreteAction(project.nextStep);
    if (action) return { requested: true, title: titleFor(action, project), projectId: project.id || '', source: explicit.length ? 'own_conversation' : 'project_next_step' };
    return { requested: true, clarification: `¿Qué tarea concreta de ${project.name} quieres que agende?` };
  }

  if (mentions.length === 1 && !/\b(?:recordatorio|evento|trabajo fallido|tarea fallida)\b/i.test(last.message)) {
    const { action, project } = mentions[0];
    return { requested: true, title: project ? titleFor(action, project) : action, projectId: project?.id || '', source: 'own_conversation' };
  }
  return { requested: true, clarification: '¿Qué tarea concreta de lo que mencioné quieres que agende?' };
}

export function reminderRoutingContext({ agent, projects = [], recent = [], reference } = {}) {
  return {
    selected_agent: agent,
    projects: projects.slice(0, 40).map(({ id, name, status, nextStep }) => ({ id, name, status, nextStep: plain(nextStep).slice(0, 400) })),
    own_recent_conversation: recent.filter(turn => ['assistant', 'user'].includes(turn?.role) && (!turn.agent || turn.agent === agent)).slice(-8)
      .map(({ role, message }) => ({ role, message: plain(message).slice(0, 1800) })),
    reminder_reference: reference?.requested ? reference : null,
  };
}
