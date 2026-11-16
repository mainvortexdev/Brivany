// Application skills: declared capabilities backed by existing handlers.
const groups=[
 ['conversation',['melodi'],['chat','cancel','capabilities'],'Responde en contexto. Una conversación no ejecuta acciones ni confirma guardados.','text'],
 ['team',['melodi'],['team_control'],'Configura iniciativa y objetivos personales. Un objetivo pertenece únicamente a la integrante elegida; no lo delegues. Confirma solo el resultado persistido.','storage'],
 ['memory',['melodi'],['capture_start','stage_memory','save_memory','store_credential','recall_memory','store_contact'],'Guarda solo lo solicitado. Confirma persistencia después de escribir y conserva literalmente las notas.','storage'],
 ['documents',['melodi'],['retrieve_document','register_document_template','generate_document'],'Lee o genera documentos mediante herramientas; entrega el archivo generado, sin inventar rutas.','artifact'],
 ['calendar',['melodi'],['create_reminder','set_calendar_pin'],'Conserva la tarea durante aclaraciones. Resuelve la fecha en la zona horaria configurada y confirma solo tras guardar.','storage'],
 ['email',['melodi'],['send_email','retrieve_email_code','retrieve_email_data'],'Usa el correo conectado y su resultado. Distingue borrador, encolado y enviado.','provider'],
 ['creative',['melodi'],['generate_image','edit_image','video_request','transcribe_audio'],'Usa capacidades disponibles. Si vídeo no está habilitado, informa la limitación sin prometer generarlo.','artifact'],
 ['social',['melodi'],['instagram_operation','story_portrait','story_visual_reference_save','story_visual_reference_stop','story_campaign_start','story_campaign_pause','story_campaign_status','story_single_create','story_auto_on','story_auto_off'],'Respeta aprobación de publicación y distingue vista previa de publicación confirmada.','provider'],
 ['projects',['melodi'],['project_update','project_query','project_list'],'Usa IDs observados. Guarda avances solo por solicitud explícita y no inventes avances.','storage'],
 ['research',['melodi'],['marketing_review'],'Melodi: fuentes públicas; Melodi: métricas propias conectadas. Expón datos faltantes.','sources'],
 ['desktop',['melodi'],['stacy_screenshot','stacy_command','stacy_status'],'Conserva la instrucción completa y envíala al PC vinculado. No confirmes hasta recibir el resultado verificado del equipo.','desktop'],
];
export const SKILLS=Object.freeze(groups.flatMap(([group,agents,intents,instructions,evidence])=>intents.map(intent=>Object.freeze({id:`${group}.${intent}`,intent,agents: group==='desktop'?['melodi']:group==='conversation'?agents:['melodi'],instructions,evidence}))));
export function skillFor(intent,agent){const skill=SKILLS.find(s=>s.intent===intent);if(!skill)throw Error('La habilidad solicitada no existe.');return {...skill,agent:(['melodi'].includes(agent)&&!skill.id.startsWith('desktop.'))||skill.agents.includes(agent)?agent:skill.agents[0]};}
export function skillCatalog(){return SKILLS.map(s=>`${s.id} | intent=${s.intent} | agentes=${s.agents.join(',')} | ${s.instructions} Evidencia requerida: ${s.evidence}.`).join('\n');}
export function socialReply(text){
 const n=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(/^(?:no[,!\s]*)?(?:es todo por hoy[.!\s]*)?(?:hasta manana|hasta luego|adios|buenas noches)[.!\s]*$/.test(n))return 'Hasta mañana. Que descanses.';
 if(/^(?:muchas )?gracias[.!\s]*$/.test(n))return 'De nada. Aquí estaré cuando me necesites.';
 return null;
}
export function reminderContext(message,pending){return pending?.title?`Solicitud pendiente de recordatorio: ${pending.title}\nAclaración actual del usuario: ${message}`:message;}
export function explicitNote(text){return String(text||'').match(/^(?:anota|guarda|recuerda)\s+esto\s*:\s*([\s\S]+)$/i)?.[1]?.trim()||null;}
