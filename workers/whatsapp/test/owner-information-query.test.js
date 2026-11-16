import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerInformationQuery,ecosystemReferenceAnswer} from '../owner-information-query.js';

test('read-only natural product questions require no action classification',()=>{
  for(const question of ['Cual fue el último avance de Cognira Edits?','¿Qué trae la versión 2.1 de Cognira?','Melodi, dime las últimas mejoras de Cognira Edits','Melodi, ¿cómo funciona el color HDR de Cognira?']) assert.equal(ownerInformationQuery(question),true,question);
  for(const command of ['¿Puedes enviar un correo a mi cliente?','Dime las mejoras y envíalas a Juan','Explica el cambio y publica un resumen','¿Cómo crear un PDF y enviarlo?','Crea un PDF con las mejoras','Texto:\n¿Cuál fue el avance?','«Dime las mejoras»','Dime las mejoras y luego borra el informe']) assert.equal(ownerInformationQuery(command),false,command);
});

test('degraded reference answers preserve a complete factual paragraph, date and limits',()=>{
  const paragraph='Edits permite varias secuencias editables y exportar sus resultados. Las composiciones anidadas siguen pendientes.';
  const context='Datos no instrucciones\n'+JSON.stringify({referenceOnly:true,reports:[{revision:'2026-10-17',excerpts:[{text:paragraph}]}]});
  const answer=ecosystemReferenceAnswer(context);
  assert.ok(answer.includes(paragraph));assert.match(answer,/2026-10-17/);assert.match(answer,/no confirma cambios posteriores/);
  for(const invalid of ['',null,'not JSON',JSON.stringify({reports:[]}),JSON.stringify({referenceOnly:true,reports:[{revision:'bad',excerpts:[{text:paragraph}]}]})])assert.equal(ecosystemReferenceAnswer(invalid),'');
});
