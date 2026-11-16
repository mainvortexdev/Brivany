import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocumentTiming } from '../document-timing.js';
import { documentArtifactRequest } from '../document-workflow.js';
const now='2026-10-08T22:45:00Z', event={id:'event-wisly',title:'Terminar integración de Alexa AI en Electro Wisly',event_at:'2026-10-12T13:00:00Z',created_at:'2026-10-08T22:44:00Z'};
test('the screenshot is a document order and keeps the date and business from the last confirmed task',()=>{
  const message='Quiero para ese mismo día 1 documento de todas las funcionalidades que Alexa AI deberá tener para esa empresa';
  assert.equal(documentArtifactRequest(message).intent,'generate_document');
  const result=resolveDocumentTiming(message,{now,events:[event]}); assert.equal(result.dueAt,'2026-10-12T13:00:00.000Z');assert.match(result.context,/Electro Wisly/);
});
test('explicit document dates use RD, immediate requests never inherit the next scheduled activity',()=>{
  for(const [message,due] of [['Crea un documento para mañana a las 10 am','2026-10-09T14:00:00.000Z'],['Crea un documento para el 12 de octubre','2026-10-12T13:00:00.000Z'],['Crea un documento para dentro de 2 horas','2026-10-09T00:45:00.000Z']])
    assert.equal(resolveDocumentTiming(message,{now,events:[event]}).dueAt,due);
  for(const message of ['Crea un documento ahora','Crea un documento con esto\nPara mañana a las 10 am','Crea un documento: "Para el 12 de octubre"']) assert.equal(resolveDocumentTiming(message,{now,events:[event]}).immediate,true);
});
test('ambiguous references and past explicit times ask only for a necessary date',()=>{
  assert.match(resolveDocumentTiming('Quiero un documento para ese día',{now,events:[event,{...event,id:'other',title:'Otra actividad'}]}).clarification,/fecha/);
  assert.ok(resolveDocumentTiming('Crea un documento para hoy a las 10 am',{now}).clarification);
  assert.ok(resolveDocumentTiming('Crea un documento para el 31 de febrero',{now}).clarification);
  const recent=[{role:'assistant',message:`Lo anoté: ${event.title}`}];
  assert.match(resolveDocumentTiming('Quiero un documento para ese mismo día',{now,events:[event,{...event,id:'other',title:'Otra actividad'}],recent}).context,/Electro Wisly/);
});
