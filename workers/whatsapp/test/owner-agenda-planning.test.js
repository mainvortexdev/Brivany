import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { handleOwnerMessage, ownerAutonomyServices } from '../owner-features.js';
import { processWhatsAppEnvelope } from '../whatsapp-request-scope.js';
import { parseAgendaRequest } from '../agenda-request.js';

const OWNER='18095550101';
const NOW=Date.parse('2026-10-21T11:00:00.000Z'); // 07:00 La Paz.
const EXAMPLE='Oye Melodi, agenda lo siguiente, ponlo en días separados para trabajar en ello: Terminar toda la app de Vetsa Intelligence, Terminar Cognira Edits, Mejorar la integración y entorno de Vetsa. Desplaza lo que tengo para hoy a mañana, quiero tener el día un poco más suave, iré al boxeo a las 9, a las 11 iré a trabajar al apartamento de Alfredo, recuérdame a las 2:40 p.m buscar a mi hermana a la escuela y que tengo que volver a las 3:40 pm al trabajo .';

function fixture({allowed=true,onAuthorize,timeZone='America/La_Paz'}={}) {
  const db=new FinanceD1();
  for (const file of ['schema.sql','melodi-team-coordination.sql','story-campaign.sql','story-approval.sql']) db.sql.exec(readFileSync(new URL(`../${file}`,import.meta.url),'utf8'));
  const replies=[],permissions=[],models=[],observations=[],syncs=[];
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,WHATSAPP_PHONE_NUMBER_ID:'business',TEAM_AUTONOMY_ENABLED:'true',
    TEAM_CONVERSATION_LEADER:'melodi',TIME_ZONE:timeZone,MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),
    VETSA_INTELLIGENCE:{async fetch(request){models.push(request);throw Error('synthetic_model_unavailable');}},
    MELODI_JOBS:{async send(value){syncs.push(value);}},
  };
  const services=ownerAutonomyServices(env);
  const events=()=>db.sql.prepare('SELECT id,title,event_at,assigned_agent,reminded_at FROM melodi_calendar_events ORDER BY event_at,id').all().map(row=>({...row}));
  const raw=async(_env,phone,body,options)=>{
    assert.equal(phone,OWNER);replies.push({body,agent:options?.agent,eventsAtReply:events()});
    return{status:'sent',messageId:`meta-${replies.length}`};
  };
  const run=async(scoped,incoming,message)=>handleOwnerMessage(scoped,{
    phone:OWNER,incoming,message,markTyping:async()=>{},
    sendText:(current,phone,body,options)=>current.WHATSAPP_PROCESSING_SCOPE ? current.WHATSAPP_PROCESSING_SCOPE.reply(phone,body,options) : raw(current,phone,body,options),
    addReminder:async()=>assert.fail('Compound requests must use atomic agenda store'),
    configureTeam:async command=>{
      permissions.push(command);
      if(command.action==='authorize_skill'){
        if(onAuthorize)await onAuthorize({db,command});
        return{allowed,response:'Necesito autorización para modificar tu agenda.'};
      }
      return null;
    },
    observeAgent:async agent=>observations.push({role:'user',agent}),
    observeAgentReply:async(agent,body)=>observations.push({role:'assistant',agent,body}),
  });
  const send=(incoming=EXAMPLE,{id='agenda-compound-1',timestamp=String(Math.floor(Date.now()/1000)),ledger=false}={})=>{
    const message={id,from:OWNER,type:'text',timestamp,text:{body:incoming}};
    if(!ledger)return run(env,incoming,message);
    const payload={entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:[message]}}]}]};
    return processWhatsAppEnvelope(env,payload,(scoped)=>run(scoped,incoming,message),raw,services);
  };
  const add=(id='old-today',at='2026-10-21T20:15:00.000Z',title='Pendiente anterior')=>db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,OWNER,title,at,'REMINDER','melodi',new Date(NOW).toISOString(),new Date(NOW).toISOString());
  const session=async()=>{
    const row=db.sql.prepare('SELECT * FROM wa_owner_session WHERE owner_phone=?').get(OWNER);
    if(!row)return null;
    const value=await services.decrypt(row.encrypted_state,row.state_iv);
    return{type:row.session_type,state:typeof value==='string'?JSON.parse(value):value};
  };
  const addRoutine=async(id,title,hour)=>{
    db.sql.exec(readFileSync(new URL('../melodi-routines.sql',import.meta.url),'utf8'));
    const sealed=await services.encrypt(JSON.stringify({title,frequency:'daily'}));
    const eventAt=Date.parse(`2026-10-21T${String(Number(hour.slice(0,2))+4).padStart(2,'0')}:${hour.slice(3)}:00Z`);
    db.sql.prepare(`INSERT INTO wa_melodi_routines(id,owner,agent,event_key,payload_encrypted,payload_iv,channel,weekday,hour,status,next_at,available_at,created_at,updated_at)
      VALUES(?,?,'melodi',?,?,?,'whatsapp',3,?,'active',?,?,?,?)`)
      .run(id,OWNER,`${id}-key`,sealed.encrypted,sealed.iv,hour,eventAt,eventAt,NOW,NOW);
  };
  const setSession=async(state)=>{
    const sealed=await services.encrypt(state);
    db.sql.prepare('INSERT INTO wa_owner_session(owner_phone,session_type,encrypted_state,state_iv,updated_at) VALUES(?,?,?,?,?)')
      .run(OWNER,'await_agenda_plan',sealed.encrypted,sealed.iv,new Date(Date.now()).toISOString());
  };
  return{db,env,services,replies,permissions,models,observations,syncs,send,add,events,session,setSession,addRoutine};
}

test('the full owner request creates all seven activities and moves only old future commitments without a model',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture();f.add();
  assert.equal(await f.send(),true);
  const saved=f.events();assert.equal(saved.length,8);
  assert.equal(saved.find(row=>row.id==='old-today').event_at,'2026-10-22T20:15:00.000Z');
  assert.deepEqual(saved.filter(row=>row.id!=='old-today').map(row=>[row.title,row.event_at]),[
    ['Boxeo','2026-10-21T13:00:00.000Z'],
    ['Trabajar en apartamento de Alfredo','2026-10-21T15:00:00.000Z'],
    ['Buscar a mi hermana a la escuela','2026-10-21T18:40:00.000Z'],
    ['Volver al trabajo','2026-10-21T19:40:00.000Z'],
    ['Terminar toda la app de Vetsa Intelligence','2026-10-23T13:00:00.000Z'],
    ['Terminar Cognira Edits','2026-10-24T13:00:00.000Z'],
    ['Mejorar la integración y entorno de Vetsa','2026-10-25T13:00:00.000Z'],
  ]);
  assert.equal(f.replies.length,1);assert.equal(f.replies[0].eventsAtReply.length,8);
  assert.equal(f.replies[0].agent,'melodi');assert.doesNotMatch(f.replies[0].body,/Melodi:|Melodi|Spaik|📌/i);
  assert.match(f.replies[0].body,/4 avisos/);assert.match(f.replies[0].body,/9:00.*11:00/);
  assert.equal(f.models.length,0);assert.equal(await f.session(),null);
  const grants=f.permissions.filter(command=>command.action==='authorize_skill');
  assert.equal(grants.length,1);assert.equal(grants[0].tool,'manage_calendar');
  assert.deepEqual(f.observations.map(item=>item.role),['user','assistant']);
});

test('denied calendar permission performs no part of the compound request',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture({allowed:false});f.add();const before=f.events();
  assert.equal(await f.send(),true);assert.deepEqual(f.events(),before);assert.equal(f.models.length,0);
  assert.equal(f.replies.length,1);assert.match(f.replies[0].body,/autorización/);
  assert.doesNotMatch(f.replies[0].body,/organicé|moví|te recordaré|agendé/i);
});

test('an atomic apply failure cannot move old activities, save projects or send a success',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture();f.add();const before=f.events();
  f.db.sql.exec("CREATE TRIGGER reject_project BEFORE INSERT ON melodi_calendar_events WHEN NEW.title='Terminar Cognira Edits' BEGIN SELECT RAISE(ABORT,'synthetic_compound_failure'); END");
  await assert.rejects(f.send(),/synthetic_compound_failure/);assert.deepEqual(f.events(),before);assert.deepEqual(f.replies,[]);assert.equal(f.models.length,0);
});

test('past morning appointments ask once and tomorrow preserves the entire seven-activity request',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-21T16:00:00Z')});const f=fixture();f.add();const before=f.events();
  assert.equal(await f.send(),true);assert.deepEqual(f.events(),before);
  const pending=await f.session();assert.equal(pending.type,'await_agenda_plan');assert.equal(pending.state.reason,'past_fixed');
  assert.equal(f.replies.length,1);assert.match(f.replies[0].body,/Boxeo.*ya pasó/);assert.equal((f.replies[0].body.match(/¿/g)||[]).length,1);
  assert.equal(await f.send('mañana',{id:'agenda-day-answer'}),true);
  assert.equal(f.events().length,8);assert.equal(f.models.length,0);assert.equal(await f.session(),null);
  const fresh=f.events().filter(row=>row.id!=='old-today');
  assert.ok(fresh.slice(0,4).every(row=>row.event_at.startsWith('2026-10-22')));
  assert.equal(fresh.filter(row=>/Terminar|Mejorar/.test(row.title)).length,3);
});

test('a replayed WhatsApp message uses its request ledger and cannot duplicate any write or response',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture();f.add();
  assert.equal((await f.send(EXAMPLE,{ledger:true})).status,'done');const before=f.events();
  assert.equal((await f.send(EXAMPLE,{ledger:true})).status,'done');assert.deepEqual(f.events(),before);
  assert.equal(f.replies.length,1);assert.equal(f.models.length,0);
});

test('a request to lighten today preserves operational daily routines and applies the whole plan without a scope question',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture();f.add();
  f.db.sql.exec(readFileSync(new URL('../melodi-routines.sql',import.meta.url),'utf8'));
  const sealed=await f.services.encrypt(JSON.stringify({title:'Frase diaria',frequency:'daily'}));
  f.db.sql.prepare(`INSERT INTO wa_melodi_routines(id,owner,agent,event_key,payload_encrypted,payload_iv,channel,weekday,hour,status,next_at,available_at,created_at,updated_at)
    VALUES(?,?,'melodi',?,?,?,'whatsapp',3,'17:00','active',?,?,?,?)`)
    .run('daily',OWNER,'daily-key',sealed.encrypted,sealed.iv,Date.parse('2026-10-21T21:00:00Z'),Date.parse('2026-10-21T21:00:00Z'),NOW,NOW);
  const routine=f.db.sql.prepare('SELECT * FROM wa_melodi_routines').get();
  assert.equal(await f.send(),true);
  assert.equal(f.replies.length,1);assert.doesNotMatch(f.replies[0].body,/¿|otro tratamiento/);
  assert.equal(f.events().length,8);assert.equal(await f.session(),null);assert.equal(f.models.length,0);
  assert.deepEqual(f.db.sql.prepare('SELECT * FROM wa_melodi_routines').get(),routine);
});

test('a concurrent agenda change preserves the whole plan and a yes rechecks against the fresh snapshot',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});
  let changed=false;
  const f=fixture({onAuthorize:({db})=>{
    if(changed)return;changed=true;
    db.sql.prepare('UPDATE melodi_calendar_events SET title=? WHERE id=?').run('Editado mientras se planificaba','old-today');
  }});
  f.add();assert.equal(await f.send(),true);assert.equal(f.events().length,1);
  assert.equal(f.events()[0].event_at,'2026-10-21T20:15:00.000Z');
  assert.equal((await f.session()).state.reason,'agenda_changed');
  assert.equal(await f.send('sí',{id:'agenda-conflict-confirmation'}),true);
  assert.equal(f.events().length,8);assert.equal(await f.session(),null);assert.equal(f.models.length,0);
  assert.equal(f.events().find(row=>row.id==='old-today').title,'Editado mientras se planificaba');
});

test('acknowledgements with conditions or negations never grant a pending agenda adjustment',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture();f.add();
  await f.addRoutine('daily','Frase diaria','17:00');
  await f.setSession({reason:'non_personal_activities',directive:parseAgendaRequest(EXAMPLE,{now:NOW,timeZone:f.env.TIME_ZONE})});
  const before=f.events();
  assert.equal((await f.session()).state.reason,'non_personal_activities');
  for(const [index,text] of ['sí, pero no muevas nada','sí, solo explica el ejemplo','solo quiero saber qué harías','sí, ¿qué vas a cambiar?','sí, si mañana tengo tiempo'].entries()) {
    const grants=f.permissions.filter(item=>item.action==='authorize_skill').length;
    assert.equal(await f.send(text,{id:`agenda-ambiguous-answer-${index}`}),true);
    assert.deepEqual(f.events(),before,text);
    assert.equal(f.permissions.filter(item=>item.action==='authorize_skill').length,grants,text);
    assert.equal((await f.session()).state.reason,'non_personal_activities',text);
  }
  assert.equal(await f.send('sí, por favor',{id:'agenda-explicit-approval'}),true);
  assert.equal(f.events().length,8);assert.equal(await f.session(),null);assert.equal(f.models.length,0);
});

test('the owner example reuses three exact routine occurrences and preserves them without a scope question or duplicates',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture();f.add();
  await f.addRoutine('boxing','Ir al boxeo','09:00');
  await f.addRoutine('alfredo','Trabajar en apartamento de Alfredo','11:00');
  await f.addRoutine('back','Volver al trabajo','15:40');
  const routineBefore=f.db.sql.prepare('SELECT * FROM wa_melodi_routines ORDER BY id').all();
  assert.equal(await f.send(),true);
  assert.equal(f.replies.length,1);assert.doesNotMatch(f.replies[0].body,/¿|otro tratamiento/);
  assert.equal(f.events().length,5); // Existing moved + sister + three projects.
  assert.equal(f.events().filter(row=>/Boxeo|Trabajar en apartamento|Volver al trabajo/i.test(row.title)).length,0);
  assert.equal(f.events().filter(row=>/Terminar|Mejorar|hermana/.test(row.title)).length,4);
  assert.deepEqual(f.db.sql.prepare('SELECT * FROM wa_melodi_routines ORDER BY id').all(),routineBefore);
  const grants=f.permissions.filter(item=>item.action==='authorize_skill');
  assert.equal(grants.length,1);
  assert.equal(grants[0].input.ownerSkill.interpretation.agendaPlan.plan.retainedFixed.length,3);
  assert.equal(grants[0].input.ownerSkill.interpretation.agendaPlan.plan.createEvents.length,4);
  assert.equal(f.models.length,0);assert.equal(await f.session(),null);
});

test('the reported GPT integration task is automatically moved after tomorrow boxing without a technical scope question',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const f=fixture({timeZone:'America/Santo_Domingo'});
  f.add('9c00df-reported-task','2026-10-21T13:00:00.000Z','implementar nueva conexión al ecosistema Vetsa (vinculación con GPT)');
  await f.addRoutine('boxing','Ir al boxeo','09:00');
  await f.addRoutine('alfredo','Trabajar en apartamento de Alfredo','11:00');
  await f.addRoutine('back','Volver al trabajo','15:40');
  const routines=f.db.sql.prepare('SELECT * FROM wa_melodi_routines ORDER BY id').all();
  assert.equal(await f.send(),true);
  assert.equal(f.replies.length,1);assert.doesNotMatch(f.replies[0].body,/¿|otra actividad|otro tratamiento|necesito que elijas/i);
  assert.equal(f.events().length,5);assert.equal(await f.session(),null);assert.equal(f.models.length,0);
  const moved=f.events().find(row=>row.id==='9c00df-reported-task');
  assert.equal(moved.event_at,'2026-10-22T13:30:00.000Z');
  assert.equal(moved.title,'implementar nueva conexión al ecosistema Vetsa (vinculación con GPT)');
  assert.deepEqual(f.db.sql.prepare('SELECT * FROM wa_melodi_routines ORDER BY id').all(),routines);
  assert.match(f.replies[0].body,/9:30|09:30/);
});

test('an existing encrypted plan can resume from its earlier scope confirmation without repeating the original request',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const f=fixture({timeZone:'America/Santo_Domingo'});
  f.add('9c00df-reported-task','2026-10-21T13:00:00.000Z','implementar nueva conexión al ecosistema Vetsa (vinculación con GPT)');
  await f.addRoutine('boxing','Ir al boxeo','09:00');
  await f.addRoutine('alfredo','Trabajar en apartamento de Alfredo','11:00');
  await f.addRoutine('back','Volver al trabajo','15:40');
  await f.setSession({reason:'non_personal_activities',directive:parseAgendaRequest(EXAMPLE,{now:NOW,timeZone:f.env.TIME_ZONE})});
  assert.equal(await f.send('sí',{id:'recover-original-agenda-scope'}),true);
  assert.equal(f.events().length,5);assert.equal(await f.session(),null);assert.equal(f.models.length,0);
  assert.equal(f.events().find(row=>row.id==='9c00df-reported-task').event_at,'2026-10-22T13:30:00.000Z');
  assert.equal(f.replies.length,1);assert.doesNotMatch(f.replies[0].body,/¿|otra actividad|necesito que elijas/i);
});

test('a genuine fixed appointment collision names both commitments and the date and time in one question',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture({timeZone:'America/Santo_Domingo'});
  await f.addRoutine('clinic','Consulta médica','14:40');
  const before=f.events();assert.equal(await f.send(),true);assert.deepEqual(f.events(),before);
  assert.equal(f.replies.length,1);assert.match(f.replies[0].body,/Buscar a mi hermana a la escuela/i);
  assert.match(f.replies[0].body,/Consulta médica/i);assert.match(f.replies[0].body,/14:40|2:40/);
  assert.match(f.replies[0].body,/21.*octubre|2026-10-21|hoy/i);
  assert.equal((f.replies[0].body.match(/¿/g)||[]).length,1);
  assert.doesNotMatch(f.replies[0].body,/con otra actividad|dos actividades a la misma hora/i);
});

test('quoted meta examples cannot create agenda activities or a pending agenda plan',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});
  for (const text of [`Por ejemplo, si te digo "${EXAMPLE}", ¿cómo responderías?`,`No ejecutes nada. Solo explica este ejemplo: ${EXAMPLE}`]) {
    const f=fixture();f.add();const before=f.events();
    try {await f.send(text);} catch(error) {assert.match(error.message,/owner_routing_temporarily_unavailable/);}
    assert.deepEqual(f.events(),before);assert.equal(await f.session(),null);
    assert.equal(f.permissions.some(command=>command.action==='authorize_skill'),false);
  }
});
