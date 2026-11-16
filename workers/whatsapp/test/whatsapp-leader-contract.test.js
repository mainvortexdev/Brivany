import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {handleOwnerMessage} from '../owner-features.js';
import {currentOwnerSpeaker,selectOwnerSpeaker} from '../owner-speaker.js';
import {ownerConversationScope,ownerProgressAnnouncement} from '../owner-conversation-scope.js';
import {whatsappMessageEnvelopes} from '../whatsapp-inbox.js';

const OWNER='18095550101';
function fixture() {
  const db=new FinanceD1();
  for(const file of ['schema.sql','melodi-team-coordination.sql','melodi-artifact-tracking.sql','story-campaign.sql','story-approval.sql']) db.sql.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
  const replies=[],controls=[],reminders=[],requests=[];
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TEAM_AUTONOMY_ENABLED:'true',TEAM_CONVERSATION_LEADER:'melodi',
    MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),
    VETSA_INTELLIGENCE:{async fetch(request){const body=await request.json();requests.push(body);return Response.json({text:JSON.stringify(body.options.systemPrompt.includes('Verifica el límite') ? {category:'other'}:{intent:'chat',agent:'melodi'})});}}};
  let count=0;
  const send=(incoming,context)=>handleOwnerMessage(env,{phone:OWNER,incoming,message:{type:'text',id:'leader-'+(++count),...(context?{context}: {})},
    markTyping:async()=>{},sendText:async(_env,phone,body,options)=>{assert.equal(phone,OWNER);replies.push({body,agent:options.agent});},
    addReminder:async(...args)=>{reminders.push(args);return{id:'new-reminder'};},
    configureTeam:async command=>{controls.push(command);return command.action==='contact_preference'?'Preferencia guardada.':null;},observeAgent:async()=>{},observeAgentReply:async()=>{}});
  return{db,env,send,replies,controls,reminders,requests};
}

test('Melodi is the default even when legacy automatic messages selected another specialist',async()=>{
  const f=fixture();
  f.db.sql.prepare('INSERT INTO wa_melodi_chat_state VALUES(?,?,?)').run(OWNER,'melodi',new Date().toISOString());
  f.db.sql.prepare('INSERT INTO wa_melodi_coordination(owner_phone,conversation_agent,conversation_until,updated_at) VALUES(?,?,?,?)').run(OWNER,'melodi',new Date(Date.now()+600000).toISOString(),new Date().toISOString());
  await f.send('Hola');
  assert.deepEqual(f.replies,[{body:'Hola. Aquí estoy.',agent:'melodi'}]);
  assert.equal(f.requests.length,0);
});

test('only an explicit agent address changes the interlocutor and a direct Melodi address returns leadership',async()=>{
  const f=fixture();await f.send('Melodi, hola');await f.send('Gracias');await f.send('Melodi, hola');
  assert.deepEqual(f.replies.map(row=>row.agent),['melodi']);
  assert.equal(await currentOwnerSpeaker(f.env,OWNER),'melodi');
});

test('a model assigning a specialist cannot transfer the human conversation',async()=>{
  const f=fixture();const result=await f.send('¿Por qué vemos las nubes blancas?');
  assert.equal(result.handled,false);assert.equal(result.agent,'melodi');
  assert.equal(await currentOwnerSpeaker(f.env,OWNER),'melodi');
  assert.equal(f.reminders.length,0);
});

test('the reported progress announcement never asks for a reminder date or creates work',async()=>{
  const f=fixture();
  for(const text of ['Hoy empezaré a crear el nuevo proyecto Cognira Edits','Oye Melodi, ya inicié la creación de Cognira Edits']) {
    const result=await f.send(text);assert.equal(result.handled,false);assert.equal(result.agent,'melodi');
  }
  assert.equal(f.requests.length,0);assert.equal(f.reminders.length,0);assert.equal(f.replies.length,0);
  assert.equal(f.controls.length,0);
});

test('an announcement containing an actual reminder request keeps its requested action',()=>{
  for(const text of ['Hoy empezaré a crear el proyecto; recuérdame a las 10','Ya inicié el proyecto, quiero que guardes ese avance','Crea un PDF con esto:\nHoy empezaré el proyecto']) assert.equal(ownerProgressAnnouncement(text),false,text);
});

test('an explicit topic correction reaches persistent policy before a model can ignore it',async()=>{
  const f=fixture();await f.send('Melodi, olvida Instagram');
  assert.deepEqual(f.controls,[{action:'contact_preference',topic:'instagram',blocked:true}]);
  assert.equal(f.requests.length,0);assert.equal(f.replies[0].body,'Preferencia guardada.');
});

test('the reported local file request cannot become a newly generated refusal PDF',async()=>{
  const f=fixture();await f.send('Melodi, necesito que te comuniques con Melodi por que necesito este documento que está en esta ubicación E:\\GitHub\\alexa-ai\\output\\pdf\\Auditoria_Electro_Wisly_2026-10-12.pdf');
  assert.equal(f.requests.length,0);assert.equal(f.reminders.length,0);
  assert.match(f.replies[0].body,/ruta local no me da acceso/);assert.doesNotMatch(f.replies[0].body,/Preparé el documento/);
});

test('speaker selections expire and are scoped to one verified owner',async()=>{
  const f=fixture(),at=new Date('2026-10-17T12:00:00Z');
  await selectOwnerSpeaker(f.env,OWNER,'melodi','human-message-1',at);
  assert.equal(await currentOwnerSpeaker(f.env,OWNER,at),'melodi');
  assert.equal(await currentOwnerSpeaker(f.env,'19999999999',at),'melodi');
  assert.equal(await currentOwnerSpeaker(f.env,OWNER,new Date(at.getTime()+91*60000)),'melodi');
});

test('context supplies only relevant projects and does not inspect an agenda during ordinary chat',()=>{
  const projects=[{name:'Cognira Desktop',nextStep:'Crear planos 3D'},{name:'Electro Wisly',nextStep:'Inventario'}];
  assert.deepEqual(ownerConversationScope('Dame opciones para el nombre del producto',projects).projects,[]);
  const scope=ownerConversationScope('Explícame las funciones reales de Cognira Desktop',projects);
  assert.equal(scope.projects.length,1);assert.equal(scope.ecosystem,true);assert.equal(scope.agenda,false);
  assert.equal(ownerConversationScope('Gracias').taskStatus,false);
});

test('product progress questions bypass the action classifier even when its model is unavailable',async()=>{
  const f=fixture();
  f.env.VETSA_INTELLIGENCE.fetch=async()=>{throw Error('synthetic_router_outage');};
  for(const question of ['Cual fue el último avance de Cognira Edits?','Melodi, ¿qué mejoras tiene Cognira Desktop?','Melodi, explícame las funciones de Vetsa']){
    const result=await f.send(question);
    assert.equal(result.handled,false);assert.equal(result.agent,question.startsWith('Melodi')?'melodi':'melodi');
  }
  assert.equal(f.replies.length,0,'the conversation layer supplies the factual answer, no routing error is delivered');
  assert.equal(f.controls.some(item=>!['selected'].includes(item.action)),false);
  assert.equal(f.reminders.length,0);
});

test('an unclassified action remains retryable and never emits the old assignment error or executes tools',async()=>{
  const f=fixture();f.env.VETSA_INTELLIGENCE.fetch=async()=>{throw Error('synthetic_router_outage');};
  await assert.rejects(f.send('Necesito que reserves mañana una sala de reunión'),/owner_routing_temporarily_unavailable/);
  assert.equal(f.replies.length,0);assert.equal(f.reminders.length,0);assert.equal(f.controls.length,0);
});

test('all valid messages in a batched Meta webhook are queued once without status or foreign-phone events',()=>{
  const value=(id,messages)=>({metadata:{phone_number_id:id},messages});
  const one={id:'wa-1',from:OWNER,type:'text',text:{body:'Hola'}};
  const two={id:'wa-2',from:OWNER,type:'text',text:{body:'Gracias'}};
  const payload={entry:[{changes:[{value:value('official',[one,two])},{value:value('foreign',[{...two,id:'foreign'}])}]},{changes:[{value:value('official',[one,{id:'bad',from:'not-a-phone'}])}]}]};
  const envelopes=whatsappMessageEnvelopes(payload,'official');
  assert.deepEqual(envelopes.map(e=>e.entry[0].changes[0].value.messages[0].id),['wa-1','wa-2']);
  assert.equal(whatsappMessageEnvelopes({entry:[{changes:[{value:{statuses:[{id:'sent'}]}}]}]},'official').length,0);
});
