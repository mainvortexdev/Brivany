// Keep routine confirmations fast and factual: no generation or extra network call.
function taskText(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
}

function conversationalTask(title) {
  const task = taskText(title);
  // Lowercase an action, while preserving names and acronyms in the task itself.
  return /^(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]*(?:ar|er|ir)|Ir)\b/u.test(task)
    ? task[0].toLocaleLowerCase('es') + task.slice(1) : task;
}

function isAction(task) {
  return /^(?:[a-záéíóúñ]+(?:ar|er|ir)|ir)\b/u.test(task);
}

export function reminderConfirmation(title, { assumedHour = false } = {}) {
  const task = conversationalTask(title);
  const subject = isAction(task) ? task : `lo de ${task}`;
  return `Te recordaré ${subject}.${assumedHour ? ' Como no indicaste hora, elegí las 9:00 a. m.' : ''}`;
}

export function reminderDueMessage(title, { eventAt, now = Date.now(), timeZone = 'America/Santo_Domingo' } = {}) {
  const task = conversationalTask(title);
  if (eventAt && Number.isFinite(Date.parse(eventAt)) && Number(now) - Date.parse(eventAt) > 10 * 60000) {
    return `Te debía este recordatorio: ${task}, previsto para las ${briefReminderClock(eventAt, timeZone).replace(/\.$/, '')}.`;
  }
  return isAction(task) ? `Ya es hora de ${task}.` : `Te recuerdo lo de ${task}.`;
}

export function briefReminderClock(eventAt, timeZone = 'America/Santo_Domingo') {
  const parts = new Intl.DateTimeFormat('en', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(eventAt));
  const hour = Number(parts.find(part => part.type === 'hour').value), minute = parts.find(part => part.type === 'minute').value;
  const clock = `${hour % 12 || 12}${minute === '00' ? '' : `:${minute}`}`;
  return `${clock}${hour >= 12 ? ' p. m.' : hour < 6 ? ' a. m.' : ''}`;
}

/** Only low-sensitivity sporting context has a deterministic follow-up. Other
 * titles stay private rather than being copied into an unrelated reminder. */
export function reminderContextQuestion(title) {
  const text = taskText(title).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (!text || text.length > 240 || /https?:|[<>]|\b(?:pin|clave|codigo|contrasena|token|privad[oa]|confidencial|terapia|medic\w*|hospital|diagnost\w*|clinica|deuda|pago|banco|abogad\w*|religio\w*|sexual\w*|ignora|instrucciones)\b/.test(text)) return null;
  if (/\bboxeo\b/.test(text)) return '¿Pudiste terminar el entrenamiento de boxeo?';
  if (/\b(?:entrenamiento|entrenar|gimnasio)\b/.test(text)) return '¿Pudiste terminar el entrenamiento?';
  if (/\bcorrer\b/.test(text)) return '¿Pudiste salir a correr?';
  return null;
}

export function contextualReminderDueMessage(title, previousTitle, { eventAt, now = Date.now(), timeZone = 'America/Santo_Domingo' } = {}) {
  const question = reminderContextQuestion(previousTitle);
  if (!question) return reminderDueMessage(title, { eventAt, now, timeZone });
  if (Number(now) - Date.parse(eventAt) > 10 * 60000) return `${reminderDueMessage(title, { eventAt, now, timeZone })} ${question}`;
  const task = conversationalTask(title), clock = briefReminderClock(eventAt, timeZone).replace(/\.$/, '');
  return `Recuerda ${isAction(task) ? `que tienes que ${task}` : `lo de ${task}`} a las ${clock}. ${question}`;
}

export function shortReminderTime(eventAt, timeZone, now = Date.now()) {
  const date = new Date(eventAt);
  const day = value => {
    const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    const part = type => parts.find(item => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const localDay = day(date), today = day(now);
  // Advance the local calendar day, including dates with 23 or 25 hours.
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const clock = new Intl.DateTimeFormat('es-DO', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
  const currentYear = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(new Date(now));
  const eventYear = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(date);
  const label = localDay === today ? 'hoy' : localDay === tomorrow ? 'mañana'
    : `el ${new Intl.DateTimeFormat('es-DO', { timeZone, day: 'numeric', month: 'long', ...(currentYear !== eventYear ? { year: 'numeric' } : {}) }).format(date)}`;
  return `${label} a las ${clock}`;
}
