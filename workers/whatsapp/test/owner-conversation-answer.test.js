import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentAnswer, ownerConversationAnswer } from '../owner-conversation-answer.js';
import { ownerTeamCommand } from '../melodi-team-commands.js';

test('text conversation cannot substitute promises for a durable execution', () => {
  for (const answer of ['Voy a coordinar con Melodi para que envíe los formatos por correo.',
    'Te mantendré informado sobre la coordinación con Melodi.', 'Te enviaré un resumen cuando esté listo.',
    'Ya envié el documento.', 'Estoy preparando tu informe.']) {
    assert.equal(ownerConversationAnswer(answer).needsTaskStatus, true, answer);
  }
  assert.deepEqual(ownerConversationAnswer('Ese formato usa un cambio de plano y un título breve.'),
    { needsTaskStatus: false, answer: 'Ese formato usa un cambio de plano y un título breve.' });
});

test('optional progress questions are removed without inventing actions', () => {
  assert.equal(ownerConversationAnswer('Entendido. ¿Quieres que te mantenga informado sobre el progreso?').answer, 'Entendido.');
  assert.equal(ownerConversationAnswer('¿Quieres que yo coordine con Melodi para enviar el informe?').answer, 'Entendido.');
  assert.equal(ownerConversationAnswer('¿Cuál es el correo del destinatario?').answer, '¿Cuál es el correo del destinatario?');
});

test('screenshot proceed and missing delivery go through recorded task state', () => {
  assert.deepEqual(ownerTeamCommand('Adelante Melodi', 'melodi'), { action: 'approval', approved: true, contextual: true, agent: 'melodi' });
  assert.deepEqual(ownerTeamCommand('No he recibido nada', 'melodi'), { action: 'task_progress', agent: 'melodi' });
  assert.deepEqual(ownerTeamCommand('Cómo va el informe Melodi', 'melodi'), { action: 'task_progress', agent: 'melodi' });
  assert.equal(ownerTeamCommand('Crea un PDF con esto:\nAdelante Melodi', 'melodi'), null);
});

test('WhatsApp screenshot failures cannot be presented as actual reviews, work or permission checks', () => {
  const screenshots = [
    'Melodi: He estado revisando el estado de los proyectos y trabajos. El proyecto Cognira Desktop está en progreso y el siguiente paso es crear planos 3D a partir de imágenes.',
    'Melodi: Daniel, he estado trabajando en el proyecto Cognira Edits y quería conversar sobre una propuesta concreta para avanzar.',
    'Melodi: He revisado el proyecto Cognira Desktop y veo que el siguiente paso es crear planos 3D a partir de imágenes.',
    'Melodi: Daniel, necesito obtener métricas de Instagram, pero mi nivel actual es 1 y la herramienta account_metrics requiere un nivel 2.',
    'Melodi: Preparé el documento solicitado, redactado por Melodi.',
    'Melodi: Melodi: Estoy revisando el proyecto Cognira Desktop.',
  ];
  for (const answer of screenshots) assert.deepEqual(ownerConversationAnswer(answer), { needsTaskStatus:true, answer:null }, answer);
});

test('historical, passive, future and ready-artifact claims all require a tool result', () => {
  for (const answer of [
    'He creado el PDF y lo tienes en Drive.', 'Hemos enviado el correo solicitado.',
    'Ya te lo envié.', 'Te adjunto el video.', 'Adjunto el archivo.',
    'El video ya está listo.', 'Tu documento quedó guardado.', 'Ya quedó hecho.',
    'Se ha enviado el correo.', 'Ya lo hice.', 'Prepararé el informe.',
    'Me pondré a trabajar en el proyecto.', 'Sigo revisando las cuentas conectadas.',
    'No he enviado el video, pero ya lo subí a Drive.',
    'Texto sugerido: «Hola». Ya envié el mensaje.',
  ]) assert.equal(ownerConversationAnswer(answer).needsTaskStatus,true,answer);
});

test('truthful limits, factual explanation and clearly delimited text drafts remain readable', () => {
  for (const answer of [
    'No he enviado ningún correo.', 'Todavía no he preparado ese documento.',
    'No se ha enviado el video.', 'No puedo confirmar que he creado el archivo.',
    'El video no está listo.', 'No tengo acceso confirmado a esas métricas.',
    'Cuando el archivo esté listo, se podrá comprobar la exportación.',
    'Si he creado confusión con esa explicación, podemos aclararla.',
    'Texto sugerido: «He preparado el informe y lo enviaré mañana».',
    'Mensaje propuesto: "Tu video está listo".',
    'Una subida requiere comprobar el archivo y el destino.', 'Estoy lista para ayudarte.',
  ]) assert.deepEqual(ownerConversationAnswer(answer), {needsTaskStatus:false,answer},answer);
});

test('transport labels are removed even when repeated and real attribution inside a reply is retained', () => {
  for (const answer of ['Melodi: Melodi: Ese corte funciona.', '**Melodi:** **Melodi:** Ese corte funciona.', 'Melodi: Melodi: Ese corte funciona.']) {
    assert.equal(normalizeAgentAnswer(answer),'Ese corte funciona.');
    assert.equal(ownerConversationAnswer(answer).answer,'Ese corte funciona.');
  }
  assert.equal(normalizeAgentAnswer('La responsable es Melodi: prepara documentos.'),'La responsable es Melodi: prepara documentos.');
});

test('generic follow-up loops disappear while a missing essential detail can still be asked once', () => {
  for (const ending of ['¿Quieres que te ayude con algo relacionado?', '¿Quieres que priorice alguno de ellos?', '¿Te gustaría que siga sugiriendo nombres?']) {
    assert.equal(ownerConversationAnswer('Ese nombre es más corto. '+ending).answer,'Ese nombre es más corto.');
  }
  assert.equal(ownerConversationAnswer('¿Cuál es la carpeta de destino?').answer,'¿Cuál es la carpeta de destino?');
});
