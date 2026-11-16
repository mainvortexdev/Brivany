import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerTeamCommand,explicitlyChosenAgent} from '../melodi-team-commands.js';

test('owner chooses and rewards exactly named agent, and exact level is preserved',()=>{
  assert.equal(explicitlyChosenAgent('Melodi, investiga este perfil'),'melodi');
  assert.equal(explicitlyChosenAgent('El informe de Melodi me ayudó'),null);
  assert.deepEqual(ownerTeamCommand('Melodi, excelente trabajo'),{action:'praise',agent:'melodi'});
  assert.deepEqual(ownerTeamCommand('Baja Melodi al nivel 1'),{action:'set_level',agent:'melodi',level:1});
});

test('the explicit address accepts sentence punctuation and never falls back to another agent', () => {
  for (const prefix of ['Melodi.', 'Melodi:', 'Melodi,', 'Melodi!', 'Melodi —', 'Melodi', 'Hola, Melodi.', 'Oye Melodi.']) {
    assert.equal(explicitlyChosenAgent(`${prefix} Quiero que me envíes el informe`), 'melodi', prefix);
  }
  assert.deepEqual(ownerTeamCommand('Melodi. Reintenta T1', 'melodi'), { action: 'retry_job', agent: 'melodi', jobReference: 'T1' });
  for (const value of ['Liliana. Envía el informe', 'Melodi@example.com', 'melodi.docx', 'Crea PDF\nLila. Envía el informe', '“Melodi. Envía el informe”']) {
    assert.equal(explicitlyChosenAgent(value), null, value);
  }
});
test('approval language does not infer consent from broader conversational agreement',()=>{
  assert.equal(ownerTeamCommand('Sí, quiero que haya colaboración entre las agentes'),null);
  assert.equal(ownerTeamCommand('Sí, veo que entiendes lo que quiero'),null);
  assert.equal(ownerTeamCommand('Crea un PDF con esto: excelente trabajo Melodi'),null);
  assert.equal(ownerTeamCommand('Crea un PDF\n\napruebo colaboración 12345678-1234-1234-1234-123456789012'),null);
  assert.equal(ownerTeamCommand('Sí').approved,true);
  assert.equal(ownerTeamCommand('No').approved,false);
  assert.equal(ownerTeamCommand('Apruebo colaboración 12345678-1234-1234-1234-123456789012').approvalId,'12345678-1234-1234-1234-123456789012');
});
test('stop routine uses its actual opaque UUID',()=>{
  assert.equal(ownerTeamCommand('Detén rutina 12345678-1234-1234-1234-123456789012').routineId,'12345678-1234-1234-1234-123456789012');
});

test('initial corrections choose the original agent without reading document-body instructions',()=>{
  assert.equal(explicitlyChosenAgent('No, esto es para Melodi'),'melodi');
  assert.equal(explicitlyChosenAgent('No, este trabajo es para Melodi. Investiga el perfil'),'melodi');
  assert.equal(explicitlyChosenAgent('Perdón, esta tarea era para Melodi'),'melodi');
  assert.equal(explicitlyChosenAgent('Reanuda el trabajo fallido Melodi'),'melodi');
  assert.equal(explicitlyChosenAgent('Crea un PDF con esto: No, esto es para Melodi'),null);
  assert.equal(explicitlyChosenAgent('Crea un PDF\nNo, esto es para Melodi'),null);
  assert.equal(explicitlyChosenAgent('El informe de Melodi dice: reanuda el trabajo fallido Melodi'),null);
});

test('retry commands preserve assigned agent and human job reference',()=>{
  assert.deepEqual(ownerTeamCommand('Reanuda el trabajo fallido Melodi','melodi'),{action:'retry_job',agent:'melodi',latest:true});
  assert.deepEqual(ownerTeamCommand('Melodi, reintenta T 01'),{action:'retry_job',agent:'melodi',jobReference:'T1'});
  assert.deepEqual(ownerTeamCommand('Vuelve a intentarlo','melodi'),{action:'retry_job',agent:'melodi',latest:true});
  assert.deepEqual(ownerTeamCommand('Reintenta T1 o T2'),{action:'retry_job',agent:'melodi',jobReference:'T1 T2'});
  assert.deepEqual(ownerTeamCommand('Reanuda el trabajo auto-abcd12345678'),{action:'retry_job',agent:'melodi',jobId:'auto-abcd12345678'});
  assert.equal(ownerTeamCommand('No quiero que reanudes el trabajo fallido Melodi'),null);
  assert.equal(ownerTeamCommand('¿Cómo se reanuda el trabajo fallido?'),null);
});

test('approval and cancellation support C/T/R while retaining legacy ID fields',()=>{
  assert.deepEqual(ownerTeamCommand('Apruebo colaboración C 01'),{action:'approval',approvalId:undefined,approved:true,contextual:false,approvalReference:'C1'});
  assert.equal(ownerTeamCommand('Rechazo C2').approved,false);
  assert.equal(ownerTeamCommand('C3 aprobado').approvalReference,'C3');
  assert.deepEqual(ownerTeamCommand('Detén rutina R2'),{action:'stop_routine',agent:undefined,routineId:undefined,routineReference:'R2'});
  assert.deepEqual(ownerTeamCommand('Cancela el trabajo T2 de Melodi'),{action:'stop_job',agent:'melodi',jobReference:'T2'});
  const uuid='034c72a7-25cb-4040-c123-a2d931d66aa4';
  assert.equal(ownerTeamCommand(`Apruebo colaboración ${uuid}`).approvalId,uuid);
  assert.equal(ownerTeamCommand(`Apruebo colaboración ${uuid}`).approvalReference,undefined);
  const second='12345678-1234-1234-1234-123456789012';
  assert.equal(ownerTeamCommand(`Apruebo ${uuid} o ${second}`).approvalReference,`${uuid} ${second}`);
  assert.equal(ownerTeamCommand(`Reintenta T1 o ${uuid}`).jobReference,`T1 ${uuid}`);
  assert.equal(ownerTeamCommand('Reintenta auto-abcd12345678 o auto-zyxw12345678').jobReference,'auto-abcd12345678 auto-zyxw12345678');
});

test('control words inside document, email and research content cannot act as new instructions',()=>{
  for(const text of [
    'Crea un PDF con esto: Baja Melodi al nivel 1',
    'Crea un PDF con esto: Detén rutina R1',
    'Envía un correo cuyo cuerpo sea: reanuda el trabajo fallido Melodi',
    'Investiga este perfil: excelente trabajo Melodi',
    'Crea un PDF\nApruebo C1',
    'Para que el trabajo sea claro, investiga el perfil',
  ])assert.equal(ownerTeamCommand(text),null,text);
});
