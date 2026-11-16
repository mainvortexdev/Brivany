import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS } from '../melodi-skills.js';
import { skillExecutors } from '../executors/registry.js';
import { runExecutor, executeOwnerJob, executeOwnerSkills, verifyExecutionResult } from '../executors/index.js';
import { literalNote, save_memory } from '../executors/memory.js';
import { generate_image } from '../executors/creative.js';

test('every advertised skill has a concrete executor, including image editing', () => {
  for (const skill of SKILLS) assert.equal(typeof skillExecutors[skill.intent], 'function', skill.id);
  assert.equal(skillExecutors.edit_image.name, 'edit_image');
});

test('dispatch refuses unknown jobs and agents outside the selected skill', async () => {
  await assert.rejects(executeOwnerJob('invented', {}, {}), /Unknown owner job/);
  await assert.rejects(executeOwnerSkills({ interpretation: { intent: 'generate_document', agent: 'melodi' } }, {}), /Agent is not assigned/);
});

test('a failure after preparing a reply does not send a false confirmation', async () => {
  const sent=[];
  await assert.rejects(runExecutor(async ({reply}) => { await reply('Guardado'); throw Error('write failed'); }, {reply:async text=>sent.push(text)}, {}), /write failed/);
  assert.deepEqual(sent, []);
});

test('a queue receipt is pending work, not a completed image', async () => {
  const sent=[];
  const context={interpretation:{intent:'generate_image'},normalized:'una casa',env:{},phone:'owner',reply:async text=>sent.push(text)};
  const result=await runExecutor(generate_image, context, {enqueueOwnerJob:async()=> 'job-1'});
  assert.equal(result.status,'queued');assert.equal(sent.length,1);
  await assert.rejects(runExecutor(generate_image, context, {enqueueOwnerJob:async()=> null}), /Unverified/);
  assert.equal(sent.length,1);
});

test('notes cannot confirm persistence when readback differs', async () => {
  const sent=[];
  const context={note:'crear planos 3D',env:{},phone:'owner',reply:async text=>sent.push(text)};
  await runExecutor(literalNote,context,{storeExactMemory:async()=> 'note-1',getMemoryItem:async()=>({payload:{text:'wrong',refs:[]}})});
  assert.match(sent[0],/No pude comprobar/);
  sent.length=0;
  await assert.rejects(runExecutor(save_memory,{...context,normalized:context.note,interpretation:{intent:'save_memory'}},{storeExactMemory:async()=> 'note-1',getMemoryItem:async()=>null}),/comprobación/);
  assert.equal(sent.length,0);
});

test('completed action claims require matching verified evidence', () => {
  assert.throws(()=>verifyExecutionResult({status:'persisted',receipts:[]}),/evidence/);
  assert.throws(()=>verifyExecutionResult({status:'scheduled',receipts:[{status:'queued',verified:true}]}),/evidence/);
});

test('calendar refuses success without a persisted event ID', async () => {
  const sent=[];
  await assert.rejects(runExecutor(async ({addReminder,reply})=>{await addReminder('Cognira','2099-01-01');await reply('Guardado');return true;},{addReminder:async()=>null,reply:async text=>sent.push(text)},{}),/identificador/);
  assert.equal(sent.length,0);
});

test('a failed image job sends no media or completion', async () => {
  let sent=false;
  await assert.rejects(executeOwnerJob('generate_image',{env:{},row:{owner_phone:'owner'},payload:{prompt:'casa'},jobId:'job'}, {
    ownerImageGenerationReferences:async()=>({}), callVetsa:async()=>({text:'Ya está lista'}),
    sendWhatsAppMedia:async()=>{sent=true;},
  }),/no media/);
  assert.equal(sent,false);
});

test('document retries reuse the issued file instead of regenerating it', async () => {
  const existing={id:'job',file_name:'Cognira.pdf'};let sent;
  await executeOwnerJob('generate_document',{env:{},row:{owner_phone:'owner'},payload:{},jobId:'job'}, {
    getIssuedDocument:async()=>existing, sendIssuedDocument:async(_env,_owner,file)=>{sent=file;},
    callVetsa:async()=>assert.fail('An issued document must not be regenerated'),
  });
  assert.equal(sent,existing);
});
