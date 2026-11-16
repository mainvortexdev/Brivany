import { documentArtifactRequest } from './document-workflow.js';
import { documentRequestLine } from './document-timing.js';
import { readOwnerAgenda } from './owner-agenda.js';
import { localEventTime } from './event-time.js';

const names = { melodi:'Melodi' };
const fold = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const workspace = /\b(?:proyectos?|trabajos? pendientes|tareas? pendientes|pendientes del equipo)\b/;

/** Only a direct owner order, or the selected agent's immediately preceding offer. */
export function workspaceSummaryCandidate(text) {
  const line = fold(documentRequestLine(text));
  return /^(?:por favor[, :]*)?(?:(?:puedes|podrias)\s+)?(?:haz(?:me)?|prepara(?:me)?|crea(?:me)?|genera(?:me)?|quiero|necesito)\b/.test(line)
    && /\b(?:resumen|informe|reporte)\b/.test(line)
    && !/\b(?:no|cancel[ae]\w*|olvida\w*|deten\w*)\b/.test(line)
    && !/\b(?:abre|ejecuta|instala|enciende|apaga|captura|controla)\b/.test(line);
}
export function workspaceSummaryRequest(text, { agent, recent = [], now = Date.now() } = {}) {
  if (!names[agent] || !workspaceSummaryCandidate(text)) return null;
  const line = documentRequestLine(text), command = fold(line);
  if (String(text).includes('\n') || /[“"«]/.test(text) || /https?:\/\//i.test(text)) return null;
  const explicit = workspace.test(command);
  const otherSubject = /\b(?:de|del|sobre|acerca)\b/.test(command.replace(/\bdentro de \d+ (?:minutos?|horas?|dias?)\b/g,''))
    || /\b(?:videos?|contratos?|finanzas|gastos|instagram|articulos?|correo recibido)\b/.test(command);
  if (!explicit && otherSubject) return null;
  const turn = recent.at(-1);
  const prefix = String(turn?.message || '').match(/^(Melodi|Melodi|Melodi|Melodi):/i)?.[1]?.toLowerCase();
  const offered = turn?.role === 'assistant' && Number.isFinite(Date.parse(turn.at))
    && now >= Date.parse(turn.at) && now - Date.parse(turn.at) <= 2*3600000
    && (!prefix || prefix === agent) && /\b(?:resumen|informe|reporte)\b/.test(fold(turn.message)) && workspace.test(fold(turn.message));
  if (!explicit && !offered) return { clarification:'¿De qué tema quieres el resumen?' };
  const artifact = documentArtifactRequest(line.replace(/\b(?:resumen|informe|reporte)\b/i,'documento PDF'));
  if (!artifact || (artifact.deliverByEmail && !artifact.emailToSelf && !artifact.emailTo && !artifact.contactName)) return null;
  return { ...artifact, agent, format:/\b(?:word|docx)\b/i.test(line) ? 'docx' : /\btxt\b/i.test(line) ? 'txt' : 'pdf',
    title:'Resumen de proyectos y trabajos pendientes', workspaceSummary:true };
}

/** Fail closed: unreadable records cannot turn into a misleading empty report. */
export async function readWorkspaceSummary(env, owner, { decrypt, now = new Date() } = {}) {
  if (!owner || owner !== String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'') || typeof decrypt !== 'function') throw Error('invalid_workspace_summary_owner');
  const db=env.VETSA_CLOUD, projects=[],jobs=[];
  for (let page=0;page<11;page++) {
    const rows=(await db.prepare('SELECT id,encrypted_state,payload_iv,updated_at FROM wa_owner_projects WHERE owner_phone=? ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?').bind(owner,page*100).all()).results;
    if (page===10 && rows.length) throw Error('workspace_summary_project_limit');
    for (const row of rows) {
      const decoded=await decrypt(row.encrypted_state,row.payload_iv), value=typeof decoded==='string' ? JSON.parse(decoded) : decoded;
      if (!value || typeof value.name!=='string' || !value.name.trim()) throw Error('workspace_summary_invalid_project');
      projects.push({name:value.name,status:value.status,nextStep:value.nextStep,lastUpdate:value.lastUpdate,updatedAt:row.updated_at});
    }
    if (rows.length<100) break;
  }
  const tables=new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(r=>r.name));
  const tracked=tables.has('wa_melodi_artifact_tracking'),refs=tables.has('wa_melodi_task_references');
  for (let page=0;page<11;page++) {
    const rows=(await db.prepare(`SELECT j.job_type,${tracked ? "CASE WHEN j.status='complete' THEN 'ready_for_delivery' ELSE j.status END" : 'j.status'} AS status,j.created_at,${tracked ? 'a.agent' : 'NULL'} AS agent,${refs ? 'r.short_ref' : 'NULL'} AS short_ref
      FROM wa_owner_jobs j ${tracked ? 'LEFT JOIN wa_melodi_artifact_tracking a ON a.owner=j.owner_phone AND a.job_id=j.id' : ''}
      ${refs ? "LEFT JOIN wa_melodi_task_references r ON r.owner=j.owner_phone AND r.type='job' AND r.task_id=j.id" : ''}
      WHERE j.owner_phone=? AND (j.status IN ('pending','waiting','processing','failed')${tracked ? " OR (j.status='complete' AND a.status IN ('pending','claiming','enqueued'))" : ''})
      ${tracked ? "AND COALESCE(a.status,'pending')<>'cancelled'" : ''} ORDER BY j.created_at DESC,j.id LIMIT 100 OFFSET ?`).bind(owner,page*100).all()).results;
    if (page===10 && rows.length) throw Error('workspace_summary_job_limit');
    jobs.push(...rows);if(rows.length<100) break;
  }
  const start=new Date(now).toISOString(),end=new Date(Date.parse(start)+90*86400000).toISOString();
  const calendar=await readOwnerAgenda(env,owner,{start,end,limit:50,decrypt});
  return {projects,jobs,calendar,start,end};
}
const plain = value => String(value || '').replace(/[\r\n\u0000]/g,' ').replace(/[\\*_#`|<>]/g,'').trim();
const status = value => ({pending:'Pendiente',waiting:'En espera',processing:'En preparación',failed:'Fallido',ready_for_delivery:'Preparado; entrega pendiente',active:'Activo',in_progress:'En curso',complete:'Completado',completed:'Completado',paused:'En pausa'}[value] || plain(value) || 'Sin estado registrado');
const type = value => ({generate_document:'Preparación de documento',generate_story:'Preparación de historia',send_email:'Envío de correo',research_report:'Investigación'}[value] || 'Trabajo registrado');
export function workspaceSummaryContent(snapshot) {
  const lines=['# Resumen de proyectos y trabajos pendientes',`Actualizado: ${localEventTime(snapshot.start)} · República Dominicana.`,
    'Este informe recoge el estado registrado al prepararlo. Las tareas pendientes no se dan por realizadas.',
    '## Proyectos',`Proyectos registrados: ${snapshot.projects.length}.`];
  for (const [i,p] of snapshot.projects.entries()) lines.push(`### ${i+1}. ${plain(p.name)}`,`Estado: ${status(p.status)}.`,
    `Próximo paso: ${plain(p.nextStep) || 'Sin próximo paso registrado'}.`,
    ...(p.lastUpdate ? [`Última actualización: ${plain(p.lastUpdate)}.`] : []));
  lines.push('## Trabajos pendientes',`Trabajos pendientes o fallidos registrados: ${snapshot.jobs.length}.`);
  for (const [i,j] of snapshot.jobs.entries()) lines.push(`- ${plain(j.short_ref) || `Trabajo ${i+1}`} · ${type(j.job_type)} · ${status(j.status)}${names[j.agent] ? ` · Responsable: ${names[j.agent]}` : ' · Responsable no registrado'}.`);
  lines.push('## Agenda del equipo',`Actividades desde ${localEventTime(snapshot.start)} hasta ${localEventTime(snapshot.end)}, hora dominicana.`);
  for (const event of snapshot.calendar.events) lines.push(`- ${localEventTime(event.event_at)} · ${names[event.assigned_agent] || 'Responsable no registrado'} · ${plain(event.title)}${event.paused ? ' · En pausa' : ''}.`);
  if (!snapshot.calendar.events.length) lines.push('No hay actividades pendientes registradas en este período.');
  if (snapshot.calendar.hasMore) lines.push('Se muestran las primeras 50 actividades del período. Consulta el resto en Vetsa · Equipo de Google Calendar.');
  lines.push('## Seguimiento','Los trabajos fallidos requieren revisar su causa antes de reanudarlos.');
  return lines.join('\n\n');
}
