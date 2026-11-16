import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseOwnerAgendaQuery, readOwnerAgenda, ownerAgendaAnswer } from '../owner-agenda.js';
import { askSpaik } from '../worker.js';
import { ownerAutonomyServices } from '../owner-features.js';
import { createEcosystemReportKnowledge } from '../ecosystem-report-knowledge.js';
import { createRoutineStore } from '../melodi-routines.js';
import { GOOGLE_CALENDAR_SCHEMA } from '../google-calendar-store.js';
import { GOOGLE_CALENDAR_SCHEDULE_SCHEMA } from '../google-calendar-schedules.js';
const OWNER='18095550101', NOW='2026-10-08T22:00:00.000Z';
class D1 {
  constructor(){this.sql=new DatabaseSync(':memory:');this.readOnly=false;}
  prepare(query){
    if(this.readOnly) assert.match(query.trim(),/^SELECT\b/i);
    const db=this, make=values=>({query,values,bind:(...next)=>make(next),
      async all(){return {results:db.sql.prepare(query).all(...values)};},
      async first(){return db.sql.prepare(query).get(...values)||null;},
      async run(){return {meta:{changes:db.sql.prepare(query).run(...values).changes}};}});
    return make([]);
  }
  async batch(statements){return Promise.all(statements.map(row=>row.run()));}
}
function fixture(){
  const db=new D1();db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TIME_ZONE:'America/Santo_Domingo'};
  const event=(id,at,title='Crear planos 3D a partir de imágenes (Cognira Desktop)',agent='melodi',phone=OWNER)=>
    db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,phone,title,at,agent,NOW,NOW);
  return {db,env,event};
}
test('the reported day query resolves October 16 using Dominican midnight boundaries',()=>{
  const q=parseOwnerAgendaQuery('Que es lo que está programado para el 16?',{now:NOW});
  assert.equal(q.start,'2026-10-16T04:00:00.000Z');assert.equal(q.end,'2026-10-17T04:00:00.000Z');
  assert.match(q.dateLabel,/16 de octubre de 2026/);
});
test('owner questions support today, tomorrow, explicit dates, weekdays and the next month',()=>{
  assert.equal(parseOwnerAgendaQuery('Melodi, qué hay en la agenda hoy?',{now:'2026-10-09T02:00:00Z'}).start,'2026-10-08T04:00:00.000Z');
  assert.equal(parseOwnerAgendaQuery('Qué tengo para mañana?',{now:NOW}).start,'2026-10-09T04:00:00.000Z');
  assert.equal(parseOwnerAgendaQuery('Qué tiene Melodi para el 16?',{now:NOW}).start,'2026-10-16T04:00:00.000Z');
  assert.equal(parseOwnerAgendaQuery('Qué hay en la agenda el 16 de octubre de 2026?',{now:NOW}).start,'2026-10-16T04:00:00.000Z');
  assert.equal(parseOwnerAgendaQuery('Qué hay en la agenda el 16?',{now:'2026-10-31T22:00:00Z'}).start,'2026-11-16T04:00:00.000Z');
  assert.equal(parseOwnerAgendaQuery('Qué citas tengo el viernes?',{now:NOW}).start,'2026-10-09T04:00:00.000Z');
  assert.ok(parseOwnerAgendaQuery('Qué hay en la agenda el 31 de febrero de 2027?',{now:NOW}).clarification);
});
test('the agenda reader never captures reminders, independent mutations or quoted documents',()=>{
  for(const text of ['Melodi, agenda para el 16 continuar con Cognira','Qué hay en la agenda el 16 y cancela todo',
    'Escribe un correo: qué está programado para el 16','"Qué hay en la agenda hoy?"','Recuerda preguntarme qué hay en la agenda mañana'])
    assert.equal(parseOwnerAgendaQuery(text,{now:NOW}),null,text);
});
test('Melodi reads the same owner agenda across members, with exact day bounds and no writes',async()=>{
  const f=fixture();f.event('before','2026-10-16T03:59:00.000Z');f.event('melodi','2026-10-16T13:00:00.000Z');
  f.event('melodi','2026-10-16T20:00:00.000Z','Revisar contenido','melodi');f.event('after','2026-10-17T04:00:00.000Z');
  f.event('foreign','2026-10-16T13:00:00.000Z','Private foreign activity','melodi','18095559999');
  f.db.readOnly=true;
  const q=parseOwnerAgendaQuery('Qué está programado para el 16?',{now:NOW});
  const result=await readOwnerAgenda(f.env,OWNER,q);assert.deepEqual(result.events.map(row=>row.id),['melodi']);
  const answer=ownerAgendaAnswer(result,{agent:'melodi',dateLabel:q.dateLabel});assert.match(answer,/^Esto está programado/);assert.match(answer,/Crear planos/);
  assert.doesNotMatch(answer,/Melodi:|Melodi:|Melodi:|Melodi:|Melodi:/);
  assert.match(answer,/9:00\s*a\.\s*m\./);assert.doesNotMatch(answer,/Private foreign|UTC|uuid/);
  assert.equal(f.db.sql.prepare('SELECT assigned_agent FROM melodi_calendar_events WHERE id=?').get('melodi').assigned_agent,'melodi');
  assert.deepEqual((await readOwnerAgenda(f.env,OWNER,{...q,targetAgent:'melodi'})).events.map(row=>row.id),['melodi']);
  await assert.rejects(readOwnerAgenda(f.env,'18095559999',q),/invalid_agenda_owner/);
});

test('agenda formatting preserves user titles and assignment metadata without exposing internal labels',()=>{
  const snapshot={events:[{id:'appointment',title:'Reunión con Melodi de Electro Wisly',event_at:'2026-10-16T13:00:00.000Z',assigned_agent:'melodi'}],hasMore:false};
  const answer=ownerAgendaAnswer(snapshot,{agent:'melodi',dateLabel:'el viernes'});
  assert.match(answer,/Reunión con Melodi de Electro Wisly/);
  assert.doesNotMatch(answer,/Melodi:|Melodi:| · Melodi/);
  assert.equal(snapshot.events[0].assigned_agent,'melodi');
  assert.equal(snapshot.events[0].title,'Reunión con Melodi de Electro Wisly');
});
test('reports and approved story schedules share the agenda with Calendar titles and paused markers',async()=>{
  const f=fixture();for(const file of ['story-campaign.sql','story-approval.sql','cognira-reports.sql']) f.db.sql.exec(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'));
  f.db.sql.exec([...GOOGLE_CALENDAR_SCHEMA,...GOOGLE_CALENDAR_SCHEDULE_SCHEMA].join(';'));
  f.db.sql.prepare("INSERT INTO cognira_report_schedules VALUES('report',?,'email','owner@example.test','2026-10-09T13:00:00.000Z',1,'America/Santo_Domingo','09:00',NULL)").run(OWNER);
  f.db.sql.prepare("INSERT INTO wa_story_campaigns VALUES('campaign',?,'active','Do not reveal campaign brief',?,?)").run(OWNER,NOW,NOW);
  f.db.sql.prepare("INSERT INTO wa_story_slots(id,campaign_id,owner_phone,day_index,stage,scheduled_at,status,updated_at) VALUES('story','campaign',?,0,'afternoon','2026-10-16T19:00:00.000Z','ready',?)").run(OWNER,NOW);
  f.db.sql.prepare("INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,status,updated_at) VALUES(?,'story_slot','story','melodi','google-story','unsupported',0)").run(OWNER);
  f.db.sql.prepare("INSERT INTO melodi_google_calendar_schedule_overrides VALUES(?,'story_slot','story','melodi',?,'test','active',NULL,0)").run(OWNER,Buffer.from(JSON.stringify({title:'Mi historia de diseño'})).toString('base64'));
  const result=await readOwnerAgenda(f.env,OWNER,{...parseOwnerAgendaQuery('Qué hay en la agenda el 16?',{now:NOW}),decrypt:async value=>JSON.parse(Buffer.from(value,'base64').toString())});
  assert.equal(result.events.length,2);assert.equal(result.events[0].event_at,'2026-10-16T13:00:00.000Z');assert.equal(result.events[1].title,'Mi historia de diseño');assert.equal(result.events[1].paused,true);
  assert.match(ownerAgendaAnswer(result),/en pausa/);assert.doesNotMatch(JSON.stringify(result),/campaign brief|owner@example/);
});
test('empty, limited and failed readings have distinct outcomes',async()=>{
  const f=fixture(),q=parseOwnerAgendaQuery('Qué tengo para el 16?',{now:NOW});
  assert.match(ownerAgendaAnswer(await readOwnerAgenda(f.env,OWNER,q)),/No hay actividades pendientes/);
  f.event('a','2026-10-16T13:00:00.000Z');f.event('b','2026-10-16T14:00:00.000Z');
  const limited=await readOwnerAgenda(f.env,OWNER,{...q,limit:1});assert.equal(limited.hasMore,true);assert.equal(limited.events.length,1);
  assert.match(ownerAgendaAnswer(limited),/Hay más actividades/);
  f.db.sql.exec('DROP TABLE melodi_calendar_events');await assert.rejects(readOwnerAgenda(f.env,OWNER,q));
});
test('daily routines are visible to the owner without disclosing their encrypted brief',async()=>{
  const f=fixture(),services={encrypt:async value=>({encrypted:Buffer.from(value).toString('base64'),iv:'test'}),decrypt:async value=>Buffer.from(value,'base64').toString()};
  const store=createRoutineStore(f.db,{...services,now:()=>Date.parse(NOW)});await store.ensureSchema();
  await store.create({owner:OWNER,agent:'melodi',eventKey:'daily',kind:'motivational_message',frequency:'daily',title:'Frase diaria',brief:'Private instructions excluded',hour:'10:00'});
  const q=parseOwnerAgendaQuery('Qué hay en la agenda el 16?',{now:NOW});f.db.readOnly=true;
  const result=await readOwnerAgenda(f.env,OWNER,{...q,decrypt:services.decrypt});
  assert.equal(result.events.length,1);assert.equal(result.events[0].event_at,'2026-10-16T14:00:00.000Z');assert.equal(result.events[0].assigned_agent,'melodi');
  assert.doesNotMatch(JSON.stringify(result),/Private instructions/);
});
test('an explicit activity query receives shared current agenda context, public chats do not',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});
  const f=fixture();f.event('melodi','2026-10-16T13:00:00.000Z');const requests=[];
  f.env.VETSA_INTELLIGENCE={async fetch(req){requests.push(await req.json());return Response.json({text:'Respuesta breve.'});}};
  for(const agent of ['melodi','melodi-owner','melodi','melodi']) {
    await askSpaik(f.env,OWNER,'Dime la actividad de Cognira',agent);assert.match(requests.at(-1).contents,/Crear planos 3D/);assert.match(requests.at(-1).contents,/"assigned_agent":"melodi"/);
  }
  await askSpaik(f.env,'18095559999','Qué hay en la agenda?', 'public');assert.doesNotMatch(requests.at(-1).contents,/Crear planos 3D|AGENDA Y ESTADO/);
});

test('all owner-facing agents receive the same current product reports; public and unrelated chats do not',async()=>{
  const f=fixture(),requests=[];
  f.env.MEMORY_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
  const services=ownerAutonomyServices(f.env),reports=createEcosystemReportKnowledge(f.db,services);
  await reports.ensureSchema();
  await reports.upsert({owner:OWNER,id:'products',revision:'2026-10-17',title:'Avances privados Cognira',
    markdown:'# Cognira\n\nPRIVATE_REPORT_CURRENT: Desktop 2.1 privado; Edits varias secuencias verificadas.\n\nPendiente: no hay E2E WhatsApp-PC verificado.'});
  f.env.VETSA_INTELLIGENCE={async fetch(req){requests.push(await req.json());return Response.json({text:'Respuesta breve.'});}};
  for(const agent of ['melodi','melodi-owner','melodi','melodi','melodi']){
    await askSpaik(f.env,OWNER,'¿Qué avances actuales tiene Cognira?',agent);
    assert.match(requests.at(-1).contents,/PRIVATE_REPORT_CURRENT/);
    assert.match(requests.at(-1).contents,/2026-10-17/);
    assert.match(requests.at(-1).contents,/no hay E2E/);
  }
  await askSpaik(f.env,'18095559999','¿Qué avances tiene Cognira?','public');
  assert.doesNotMatch(requests.at(-1).contents,/PRIVATE_REPORT_CURRENT/);
  await askSpaik(f.env,OWNER,'¿Por qué las nubes son blancas?','melodi');
  assert.doesNotMatch(requests.at(-1).contents,/PRIVATE_REPORT_CURRENT/);
  assert.equal(await services.ecosystemReportContext({ownerPhone:'18095559999',query:'Cognira'}),'');
});
