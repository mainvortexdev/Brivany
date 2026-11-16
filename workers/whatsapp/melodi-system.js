import { MELODI_ID, MELODI_VOICE } from './melodi-identity.js';

// One Brivany interlocutor owns every installed capability. Tools are not personas.
export const AGENTS = Object.freeze({
  [MELODI_ID]: Object.freeze({ name: 'Melodi', model: 'spaik-flash',
    role: 'Compañera de Brivany. Conversa, organiza agenda y proyectos, trabaja con correo y documentos, investiga, crea contenido y usa el escritorio vinculado mediante herramientas verificadas y permisos del propietario.' }),
});
export function agentModel() { return AGENTS[MELODI_ID].model; }
export const SPAIK_ORCHESTRATOR_MODEL = 'spaik-pro';
export function spaikRoleCatalog() { return `${MELODI_ID} (Melodi): ${AGENTS[MELODI_ID].role}`; }
export function agentPersona() { return MELODI_VOICE; }
