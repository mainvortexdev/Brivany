import test from 'node:test';
import assert from 'node:assert/strict';
import {SKILLS,skillFor,socialReply,reminderContext,explicitNote} from '../melodi-skills.js';
import {interpretOwnerIntent,handleOwnerMessage} from '../owner-features.js';
test('skills have unique executable intents and restrict agents to their capabilities',()=>{
 assert.equal(new Set(SKILLS.map(s=>s.intent)).size,SKILLS.length);
 assert.equal(skillFor('stacy_command','melodi').agent,'melodi');assert.equal(skillFor('generate_document','melodi').agent,'melodi');assert.throws(()=>skillFor('invented_tool','melodi'));
});
test('the reported farewell and literal note are understood without a model',()=>{
 assert.equal(socialReply('No, es todo por hoy. Hasta mañana'),'Hasta mañana. Que descanses.');
 assert.equal(socialReply('Hasta mañana, apaga el PC'),null);
 assert.equal(explicitNote('Anota esto: siguiente implementación para Cognira, crear planos 3D a partir de imágenes'),'siguiente implementación para Cognira, crear planos 3D a partir de imágenes');
 assert.match(reminderContext('Para mañana a las 2:20 a.m',{title:'continuar con el proyecto Cognira'}),/continuar con el proyecto Cognira[\s\S]*mañana a las 2:20/);
});
test('a Spaik Pro outage falls back to a second model with the same skill catalog',async()=>{
 const calls=[];const env={TIME_ZONE:'America/La_Paz',VETSA_INTELLIGENCE:{async fetch(req){const body=await req.json();calls.push(body);if(calls.length===1)return Response.json({error:'Unavailable'},{status:503});return Response.json({text:JSON.stringify({intent:'create_reminder',agent:'melodi',title:'continuar con Cognira',local_datetime:'2026-10-02T02:20'})});}}};
 const result=await interpretOwnerIntent(env,'Para mañana a las 2:20 a.m',{pendingReminder:{title:'continuar con Cognira'}});assert.equal(result.intent,'create_reminder');assert.equal(calls.length,2);assert.notEqual(calls[0].model,calls[1].model);assert.match(calls[1].options.systemPrompt,/HABILIDADES EJECUTABLES/);
});
test('a farewell reaches the user even if inference is unavailable',async()=>{
 const replies=[];const env={VETSA_CLOUD:{prepare(){return {bind(){return {async first(){return null}}}}}},VETSA_INTELLIGENCE:{fetch(){assert.fail('No inference needed')}}};
 await handleOwnerMessage(env,{phone:'test',incoming:'No, es todo por hoy. Hasta mañana',message:{},markTyping:async()=>{},sendText:async(_env,_phone,text)=>replies.push(text)});
 assert.deepEqual(replies,['Hasta mañana. Que descanses.']);
});
test('a reminder clarification preserves the task across encrypted session persistence',async()=>{
 let session=null,turn=0;const requests=[],reminders=[],replies=[];
 const env={TIME_ZONE:'America/La_Paz',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64'),VETSA_CLOUD:{prepare(sql){return {bind(...args){return {
  async first(){if(sql.includes('FROM wa_owner_session'))return session;if(sql.includes('FROM wa_melodi_state'))return {active_agent:'melodi'};return null;},
  async all(){return {results:[]}},async run(){if(sql.includes('INSERT INTO wa_owner_session'))session={session_type:args[1],encrypted_state:args[2],state_iv:args[3]};if(sql.includes('DELETE FROM wa_owner_session'))session=null;return {meta:{changes:1}};}
 };}}}},VETSA_INTELLIGENCE:{async fetch(req){const body=await req.json();requests.push(body);const boundary=body.options.systemPrompt.includes('Verifica el límite');return Response.json({provider:'SiliconFlow',text:JSON.stringify(boundary?{category:'reminder',title:'continuar con el proyecto Cognira',local_datetime:turn?'2099-10-02T02:20':'2020-01-01T02:20',date_basis:turn?'explicit_future_day':'unknown'}:{intent:'create_reminder',agent:'melodi',title:'continuar con el proyecto Cognira'})});}}};
 const base={phone:'test',message:{type:'text'},markTyping:async()=>{},sendText:async(_e,_p,t)=>replies.push(t),addReminder:async(...args)=>{reminders.push(args);return {id:"reminder-test"}}};
 await handleOwnerMessage(env,{...base,incoming:'Recuérdame continuar con el proyecto Cognira'});assert.equal(session.session_type,'await_reminder_time');assert.equal(reminders.length,0);
 turn=1;await handleOwnerMessage(env,{...base,incoming:'Para mañana a las 2:20 a.m'});
 assert.equal(reminders.length,1);assert.equal(reminders[0][0],'continuar con el proyecto Cognira');assert.equal(session,null);
 assert.ok(requests.slice(2).every(r=>r.contents.includes('continuar con el proyecto Cognira')));
});
