import { documentArtifactRequest } from './document-workflow.js';
import { documentRequestLine } from './document-timing.js';
import {stripAgentAddress} from './melodi-address.js';
const fold=value=>String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const plain=value=>String(value || '').replace(/[\r\n\u0000*_`|<>]/g,' ').trim();
export function projectDocumentRequest(text) {
  const line=stripAgentAddress(documentRequestLine(text)),value=fold(line);
  if(/[“"«\n]/.test(text) || /^\s*(?:no|nunca|cancela|olvida)\b/.test(value)) return null;
  const artifact=documentArtifactRequest(line.replace(/^(investiga|analiza|estudia)(?:\s+y)?\s+(?:crea|prepara|elabora|haz)/i,'crea'));
  if(!artifact || !/\b(?:proyecto|cognira(?: desktop)?)\b/.test(value)) return null;
  return {...artifact,projectDocument:true,impactReport:/\b(?:impact\w*|vida|para que (?:sirve|servir\w*))\b/.test(value)};
}
/** Project selection uses the exact quoted message or the selected agent's own context. */
export async function resolveProjectDocument(env,owner,text,{agent,replyContext,recent=[],decrypt}={}) {
  if(owner!==String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'') || typeof decrypt!=='function') throw Error('invalid_project_document_owner');
  const projects=[];
  for(let page=0;page<11;page++) {
    const rows=(await env.VETSA_CLOUD.prepare('SELECT id,encrypted_state,payload_iv,updated_at FROM wa_owner_projects WHERE owner_phone=? ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?').bind(owner,page*100).all()).results;
    if(page===10 && rows.length) throw Error('project_document_limit');
    for(const row of rows){const decoded=await decrypt(row.encrypted_state,row.payload_iv),p=typeof decoded==='string' ? JSON.parse(decoded) : decoded;
      if(typeof p?.name!=='string' || !p.name.trim())throw Error('project_document_invalid_record');
      projects.push({...p,id:row.id,updatedAt:row.updated_at});}
    if(rows.length<100)break;
  }
  const matches=value=>projects.filter(p=>{
    const escaped=fold(p.name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,'u').test(fold(value));
  });
  const direct=matches(documentRequestLine(text));
  if(direct.length===1)return {project:direct[0],source:'owner_command'};
  if(direct.length>1)return {clarification:'¿Sobre cuál de esos proyectos preparo el documento?'};
  if(/\bproyecto(?: llamado)?\s+[A-ZÁÉÍÓÚÑ][\p{L}\p{N}]*/u.test(documentRequestLine(text)))return {clarification:'No identifico ese proyecto en tus registros. Indícame su nombre registrado o envíame su descripción.'};
  if(replyContext?.status==='unavailable')return {clarification:'No pude recuperar el proyecto del mensaje citado. Dime su nombre para preparar el documento correcto.'};
  if(replyContext?.status==='resolved') {
    const quoted=matches(replyContext.body);
    return quoted.length===1 ? {project:quoted[0],source:'quoted_message'} : {clarification:'¿Qué proyecto quieres que analice? El mensaje citado no identifica uno de forma única.'};
  }
  // No search through other agents or stale offers, even if only one project exists.
  const turn=recent.at(-1),prefix=String(turn?.message || '').match(/^(Melodi|Melodi|Melodi|Melodi):/i)?.[1]?.toLowerCase();
  const age=Date.now()-Date.parse(turn?.at),selected=turn?.role==='assistant' && (!prefix || prefix===agent) && age>=0 && age<=2*3600000 ? matches(turn.message) : [];
  return selected.length===1 ? {project:selected[0],source:'selected_agent_context'} : {clarification:'¿De qué proyecto quieres el documento? Necesito identificarlo antes de redactar.'};
}

/** Researched product facts and qualitative interpretation; no invented measurements. */
export function cogniraImpactReport(project) {
  if(fold(project?.name)!=='cognira desktop')throw Error('unsupported_project_impact_report');
  return [
    '# Utilidad e impacto de Cognira Desktop',
    'Cognira Desktop es un entorno de asistencia para trabajar con el ordenador mediante Melodi y la inteligencia de Vetsa. Su utilidad para una persona consiste en ayudarla a convertir una petición en tareas concretas sobre documentos, aplicaciones y recursos del equipo, conservando la revisión y el control del usuario. El valor esperado se encuentra en reducir trabajo repetitivo y facilitar el uso de herramientas digitales; su impacto real debe medirse en tareas de usuarios.',
    'Este análisis identifica capacidades descritas en la documentación técnica local revisada el 9 de octubre de 2026. Esa documentación describe desarrollo y pruebas; no confirma por sí sola que todas las funciones estén habilitadas en la instalación de cada persona. Los efectos en la vida diaria que se plantean son hipótesis de utilidad, no resultados medidos de Cognira.',
    '## Estado del proyecto registrado por el equipo',
    `Proyecto: ${plain(project.name)}. Estado registrado: ${{in_progress:'En curso',planned:'Planificado',completed:'Completado',paused:'En pausa'}[project.status] || plain(project.status) || 'Sin estado registrado'}. Próximo paso anotado: ${plain(project.nextStep) || 'Sin próximo paso registrado'}.`,
    'El estado de una tarea en la agenda y la existencia de una función en el repositorio son cosas distintas. Por ejemplo, el equipo conserva la creación de planos 3D a partir de imágenes como próximo paso; la documentación local ya describe un estudio 3D conceptual. Es necesario comprobar la versión instalada y el cierre de esa tarea antes de presentarla como entregada.',
    '## Para qué sirve en situaciones concretas',
    '### Documentos y presentaciones',
    'La documentación de Melodi describe creación y edición acotada de archivos Word y PowerPoint, lectura del documento activo, resúmenes basados en su contenido y exportación para revisión. Una persona que prepara una propuesta, un informe o una presentación puede delegar el primer trabajo de organización y conservar un archivo editable. El beneficio esperado es reducir la preparación manual; todavía necesita comprobar datos, redacción y destinatarios. La integración de Office descrita requiere las aplicaciones compatibles en Windows. [F1 y F2]',
    '### Trabajo repetitivo en el ordenador',
    'Melodi dispone de control de escritorio, operaciones sobre herramientas observadas y creación de dibujos en Paint según la documentación de capacidades. Puede ser útil para seguir un flujo guiado o producir una primera versión de un recurso visual. La persona mantiene la decisión sobre el resultado y debe poder detener o corregir la acción. Esto no equivale al dominio de cualquier aplicación ni permite actuar sin las autorizaciones correspondientes. [F1]',
    '### Acceso remoto al propio equipo',
    'Cognira documenta conexión entre un navegador y el equipo de la misma cuenta, para ver la pantalla y realizar controles remotos. Un profesional que está fuera puede retomar una operación en su ordenador si la aplicación y la conexión necesarias están disponibles. La utilidad depende de la red y del estado del equipo; no hay evidencia aquí de disponibilidad permanente ni de acceso a las superficies protegidas de Windows. [F3]',
    '### Programación y visualización de ideas',
    'La documentación local describe tareas programadas y un estudio de modelos y planos 3D conceptuales desde texto o imágenes. Una persona puede explorar la distribución de un espacio o una propuesta visual antes de invertir más trabajo en ella. Las medidas no visibles son estimaciones; los resultados descritos no son planos constructivos certificados. Las tareas locales programadas necesitan el ordenador encendido y Cognira en ejecución. [F4]',
    '## Qué puede cambiar en la vida de una persona',
    'Para un trabajador independiente, la ayuda puede concentrarse en propuestas, presentaciones y organización de recursos. Para quien administra un pequeño negocio, puede facilitar informes editables y revisión de archivos. Para un estudiante, puede apoyar la organización de material y la preparación de una exposición, sin sustituir la comprobación de fuentes ni el aprendizaje. Para una persona con poca experiencia en algunas herramientas, las peticiones en lenguaje natural pueden facilitar el inicio de una tarea; no se ha verificado aquí accesibilidad universal ni compatibilidad con todas las necesidades.',
    'Son inferencias a partir de las funciones documentadas. No se atribuyen a Cognira mejoras de salud, seguridad física, empleo o inclusión que no estén demostradas. Tampoco se promete un ahorro de tiempo concreto ni una mejora económica automática.',
    '## Evidencia externa y alcance de la conclusión',
    'El estudio Generative AI at Work de Brynjolfsson, Li y Raymond analiza un asistente de IA en atención al cliente y encuentra efectos de productividad que varían según la experiencia. Es un antecedente para estudiar la asistencia en el trabajo; no evalúa Cognira Desktop ni demuestra que este proyecto obtenga los mismos resultados. [F5]',
    '## Cómo comprobar si ayuda de verdad',
    'Se propone una prueba con tareas representativas: preparar un informe, resumir un documento real, crear una presentación y retomar un archivo mediante el acceso remoto. Para cada tarea conviene registrar tiempo total, correcciones necesarias, exactitud del resultado y si la persona pudo revisar o detener el proceso. Hay que comparar la tarea con y sin Cognira en condiciones similares, contar los intentos fallidos y no medir solo el tiempo de generación de la IA.',
    'La decisión de adopción debe basarse en esos resultados y en la disponibilidad de las funciones necesarias para el usuario. Antes de generalizar el beneficio, deben revisarse privacidad de los archivos, permisos de actuación, compatibilidad de aplicaciones y recuperación después de un fallo.',
    '## Conclusión',
    'Cognira Desktop sirve principalmente para asistir el trabajo digital de una persona en su ordenador. Su aporte potencial es hacer más fácil la preparación de materiales y la ejecución de tareas concretas, con supervisión. La documentación permite describir usos plausibles; demostrar cuánto mejora la vida de sus usuarios requiere pruebas reales del producto y resultados verificables.',
    '## Fuentes revisadas',
    '[F1] Documentación técnica local de Cognira Desktop: docs/capacidades-melodi.md. Revisada el 9 de octubre de 2026.',
    '[F2] Documentación técnica local de Cognira Desktop: docs/melodi-office.md. Describe funciones, requisitos y límites de Word y PowerPoint.',
    '[F3] Documentación técnica local de Cognira Desktop: docs/remote-control.md. Describe conexión por cuenta, requisitos de red y límites del control remoto.',
    '[F4] Documentación técnica local de Cognira Desktop: docs/melodi-scheduling-3d.md. Describe tareas programadas y modelos conceptuales con sus supuestos.',
    '[F5] Brynjolfsson, E.; Li, D.; Raymond, L. Generative AI at Work. Stanford Digital Economy Lab: https://digitaleconomy.stanford.edu/publication/generative-ai-at-work/ . NBER Working Paper 31161: https://www.nber.org/papers/w31161 . Antecedente externo, no evaluación de Cognira.',
  ].join('\n\n');
}
