import test from 'node:test';
import assert from 'node:assert/strict';
import {financeFixture} from './finance-fixture.js';
import {runOwnerConversationTurn} from '../owner-turn-runtime.js';
import {processWhatsAppEnvelope} from '../whatsapp-request-scope.js';
import {searchOwnerCalendar} from '../owner-calendar-search.js';
import {readOwnerAgenda} from '../owner-agenda.js';
import {createRoutineStore} from '../melodi-routines.js';
import {clockContext} from '../event-time.js';

// These tests exercise the actual inbox fence, immutable encrypted plans,
// permission gate, calendar SQL mutations and receipt-backed renderer. Model
// decisions are supplied fixtures; separate live-model evaluations establish
// semantic understanding. No Google/Meta request or owner calendar is touched.
const OWNER='18095550101',OTHER='18095559999';
const AT='2026-10-26T19:22:00.000Z',NOW=Date.parse(AT);
const ORIGINAL='2026-11-14T13:00:00.000Z',MOVED='2026-11-10T13:00:00.000Z';
const TITLE='Iniciar la creación de una app para aprender boxeo';
const RANGE={start:'2026-11-01T04:00:00.000Z',end:'2026-12-01T04:00:00.000Z'};
const answer=(text,route='reply')=>({version:1,route,agent:'melodi',contextRelation:'continuation',answer:text,actions:[]});
const action=(tool,input,source,extra={})=>({...answer('','execute'),actions:[{id:'step',tool,input,dependsOn:[],requestSource:source}],...extra});

async function fixture(t,decide,{select=()=>['app'],failReplies=0,failTransport=0}={}){
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const {db,services:crypt}=await financeFixture();
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,WHATSAPP_PHONE_NUMBER_ID:'business',TEAM_CONVERSATION_LEADER:'melodi',
    OWNER_TURN_PRO_FALLBACK:'false',TIME_ZONE:'America/Santo_Domingo'};
  const sends=[],plans=[],grants=[],history=[];
  const services={...crypt,
    readOwnerAgenda:(_env,owner,input)=>readOwnerAgenda(_env,owner,{...input,decrypt:crypt.decrypt}),
    searchOwnerCalendar:(_env,owner,input,options)=>searchOwnerCalendar(_env,owner,input,{...options,generate:async request=>{
      const data=JSON.parse(request.contents);
      assert.ok(data.candidates.every(row=>row.id!=='foreign'),'another owner must never reach the selector');
      return{eventIds:select(data).filter(id=>data.candidates.some(row=>row.id===id))};
    }}),
  };
  const add=(id='app',title=TITLE,eventAt=ORIGINAL,owner=OWNER)=>db.sql.prepare("INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,'REMINDER','melodi',?,?)")
    .run(id,owner,title,eventAt,AT,AT);
  const send=async(text,id,extra={})=>{
    const message={id,type:'text',from:OWNER,timestamp:String(NOW/1000),text:{body:text}};
    const payload={entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:[message]}}]}]};
    return processWhatsAppEnvelope(env,payload,scoped=>runOwnerConversationTurn(scoped,
      {phone:OWNER,message,incoming:text,referenceAt:AT,recent:history,...extra},
      {crypto:crypt,services,authorize:async attempted=>{grants.push(attempted);return true;},
        infer:async request=>{assert.equal(request.options.purpose,'owner_turn','calendar responses must not require another writer');
          const data=JSON.parse(request.contents);plans.push(data);return decide(data,{db,services,sends,plans});},
        reply:(body,options)=>{if(failReplies-->0)throw Error('synthetic_pretransport_crash');return scoped.WHATSAPP_PROCESSING_SCOPE.reply(OWNER,body,options);},
        remember:async({message,answer:body})=>history.push({role:'user',content:message,at:AT},{role:'assistant',content:body,at:AT})}),
      async(_env,phone,body)=>{assert.equal(phone,OWNER);if(failTransport-->0)throw Error('synthetic_transport_failure');sends.push(body);return{messageId:'sent-'+sends.length,status:'sent'};},crypt);
  };
  const row=(id='app')=>db.sql.prepare('SELECT * FROM melodi_calendar_events WHERE id=?').get(id);
  return{db,env,services,sends,plans,grants,history,add,send,row};
}

function moveDecision(data,{when={onDate:'2026-11-10'},title}={}){
  const source=data.message.text;
  if(!data.observations.length)return action('calendar.search',{query:'Creación de la aplicación de boxeo'},source,{followUpTools:['calendar.update_event']});
  const found=data.observations.find(item=>item.tool==='calendar.search').data.matches;
  assert.equal(found.length,1);
  return action('calendar.update_event',{eventId:found[0].id,expectedEventAt:found[0].eventAt,
    ...(when?{when}:{}),...(title?{title}:{})},source);
}

async function boxingRoutine(f){
  const routines=createRoutineStore(f.db,{...f.services,now:()=>NOW,uuid:()=> 'boxing-routine'});await routines.ensureSchema();
  const create=()=>routines.create({owner:OWNER,agent:'melodi',eventKey:'weekday-boxing',title:'Boxeo',brief:'Practicar la técnica de boxeo',kind:'recurring_reminder',channel:'whatsapp',frequency:'weekly',weekdays:[1,2,3,4,5],hour:'09:00'});
  const created=await create(),row=()=>f.db.sql.prepare('SELECT * FROM wa_melodi_routines WHERE owner=? AND id=?').get(OWNER,created.id);
  const payload=async()=>JSON.parse(await f.services.decrypt(row().payload_encrypted,row().payload_iv));
  return{created,row,payload,create};
}

const selectRoutines=data=>data.candidates.filter(event=>event.id.startsWith('routine:')).map(event=>event.id);
function routineDecision(data,{operation='update',scope='series',offset=3600000}={}){
  const tool=operation==='cancel'?'calendar.cancel_event':'calendar.update_event';
  if(!data.observations.length)return action('calendar.search',{query:'La rutina de boxeo'},data.message.text,{followUpTools:[tool]});
  const match=data.observations.find(item=>item.tool==='calendar.search').data.matches[0];
  assert.ok(match,'routine selector must return the real scheduled occurrence');
  const civil=clockContext(Date.parse(match.eventAt)+offset,'America/Santo_Domingo').now_local;
  return action(tool,{eventId:match.id,expectedEventAt:match.eventAt,...(scope?{scope}:{}),
    ...(operation==='update'?{when:{onDate:civil.slice(0,10),localTime:civil.slice(11,16)}}:{} )},data.message.text);
}

test('the reported conversation reads November 14, moves that same event to November 10, and reads the changed date',async t=>{
  const query='Revisa mi agenda si tengo ya programada la creación de la app de boxeo';
  const move='Bien, es posible que inicie antes su creación, muévelo al día 10 de noviembre';
  const f=await fixture(t,data=>data.message.text===move?moveDecision(data):action('calendar.search',{query:'Creación de la aplicación de boxeo'},data.message.text));
  f.add();f.add('foreign','Otro proyecto privado',ORIGINAL,OTHER);
  assert.equal((await f.send(query,'query')).status,'done');
  assert.match(f.sends[0],/14 de noviembre.*9:00/);
  assert.equal((await f.send(move,'move')).status,'done');
  assert.match(f.sends[1],/10 de noviembre.*9:00/);
  assert.doesNotMatch(f.sends[1],/14 de noviembre|No pude|ya tengo tu mensaje|Melodi:/);
  assert.equal(f.row().event_at,MOVED);assert.equal(f.row().title,TITLE);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events WHERE phone=?').get(OWNER).n,1);
  assert.equal(f.row('foreign').event_at,ORIGINAL);
  const count=f.plans.length;
  await f.send(move,'move');assert.equal(f.plans.length,count);assert.equal(f.sends.length,2,'duplicate delivery cannot send a second confirmation');
  await f.send('¿En qué fecha quedó entonces?','verify');
  assert.match(f.sends[2],/10 de noviembre.*9:00/);assert.doesNotMatch(f.sends[2],/14 de noviembre/);
  assert.ok(f.plans.some(plan=>plan.recent.some(turn=>turn.content.includes('14 de noviembre'))),'the actual prior conversation reaches the next planner');
});

for(const text of [
  'Adelántalo al 10 de noviembre.',
  'Que sea el diez de noviembre, a la misma hora.',
  'Prefiero comenzar esa app el 10/11; cambia la fecha.',
  'Lo de crear la aplicación, pásalo al martes 10 de noviembre.',
  'Ya no el 14. Déjalo para el 10 de noviembre.',
  'Organízame eso para el próximo 10 de noviembre sin tocar la hora.',
])test('the inbox carries the complete natural change request unchanged: '+text,async t=>{
  const f=await fixture(t,data=>{assert.equal(data.message.text,text);return moveDecision(data);});f.add();
  await f.send(text,'variant');assert.equal(f.row().event_at,MOVED);assert.equal(f.row().title,TITLE);
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/10 de noviembre/);assert.doesNotMatch(f.sends[0],/14 de noviembre|No pude/);
});

test('a request changing only the time preserves the event, date, title, owner and assigned agent',async t=>{
  const f=await fixture(t,data=>moveDecision(data,{when:{localTime:'11:30'}}));f.add();const before=f.row();
  await f.send('Ese día mejor a las 11:30 de la mañana.','time');const after=f.row();
  assert.equal(after.event_at,'2026-11-14T15:30:00.000Z');
  for(const key of ['id','title','phone','assigned_agent','created_at','event_type'])assert.equal(after[key],before[key]);
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/14 de noviembre.*11:30/);
});

test('the next Tuesday resolves from the current turn instead of retaining the old event November date',async t=>{
  const f=await fixture(t,data=>moveDecision(data,{when:{weekday:'martes'}}));f.add();
  await f.send('Pásalo al próximo martes, a la misma hora.','next-tuesday');
  assert.equal(f.row().event_at,'2026-10-27T13:00:00.000Z');assert.equal(f.row().title,TITLE);
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/9:00/);assert.doesNotMatch(f.sends[0],/14 de noviembre|10 de noviembre|No pude/);
});

test('within three days uses the turn date October 29 and preserves the observed local time',async t=>{
  const f=await fixture(t,data=>moveDecision(data,{when:{offsetDays:3,anchor:'turn'}}));f.add();
  await f.send('Mejor dentro de tres días, sin cambiar la hora.','three-days');
  assert.equal(f.row().event_at,'2026-10-29T13:00:00.000Z');assert.equal(f.row().title,TITLE);
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/29 de octubre.*9:00/);assert.doesNotMatch(f.sends[0],/noviembre|No pude/);
});

test('delayed processing keeps the original message clock when compiling a relative date',async t=>{
  const f=await fixture(t,data=>{
    assert.ok(data.clock.now_local.startsWith('2026-10-26'),'the received clock must remain the authority');
    return moveDecision(data,{when:{offsetDays:3,anchor:'turn'}});
  });f.add();t.mock.timers.setTime(NOW+36*3600000);
  await f.send('Ponlo dentro de tres días a la misma hora.','delayed-turn');
  assert.equal(f.row().event_at,'2026-10-29T13:00:00.000Z');assert.equal(f.sends.length,1);
  assert.doesNotMatch(f.sends[0],/No pude|31 de octubre|noviembre/);
});

test('two days earlier explicitly anchors to the observed event and produces November 12',async t=>{
  const f=await fixture(t,data=>moveDecision(data,{when:{offsetDays:-2,anchor:'event'}}));f.add();
  await f.send('Adelántalo dos días respecto a cuando estaba previsto.','event-relative');
  assert.equal(f.row().event_at,'2026-11-12T13:00:00.000Z');assert.equal(f.sends.length,1);
  assert.match(f.sends[0],/12 de noviembre.*9:00/);assert.doesNotMatch(f.sends[0],/14 de noviembre|No pude/);
});

test('a title-only edit preserves the original time and returns the verified new title',async t=>{
  const title='Diseñar el primer prototipo de la app de boxeo';
  const f=await fixture(t,data=>moveDecision(data,{when:null,title}));f.add();
  await f.send('Ponle como título: Diseñar el primer prototipo de la app de boxeo.','rename');
  assert.equal(f.row().title,title);assert.equal(f.row().event_at,ORIGINAL);
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/primer prototipo/);assert.doesNotMatch(f.sends[0],/Iniciar la creación|No pude/);
});

test('cancellation removes the selected pending event from later searches and does not duplicate effects or replies',async t=>{
  const cancel='Ya no voy a hacer esa aplicación; quita ese evento de mi agenda.';
  const f=await fixture(t,data=>{
    if(data.message.text!==cancel)return action('calendar.search',{query:'Creación de la aplicación de boxeo'},data.message.text);
    if(!data.observations.length)return action('calendar.search',{query:'Creación de la aplicación de boxeo'},cancel,{followUpTools:['calendar.cancel_event']});
    const found=data.observations[0].data.matches[0];return action('calendar.cancel_event',{eventId:found.id,expectedEventAt:found.eventAt},cancel);
  });f.add();
  await f.send(cancel,'cancel');await f.send(cancel,'cancel');
  assert.equal(f.sends.length,1);assert.doesNotMatch(f.sends[0],/Sí, tienes|No pude|14 de noviembre/);
  await f.send('Comprueba si todavía aparece la app de boxeo.','after-cancel');
  assert.match(f.sends[1],/No encontré/);
  assert.equal((await readOwnerAgenda(f.env,OWNER,{...RANGE,decrypt:f.services.decrypt})).events.length,0);
});

test('two actual matches lead to a named clarification with no partial calendar change',async t=>{
  const f=await fixture(t,data=>!data.observations.length
    ?action('calendar.search',{query:'La aplicación'},data.message.text,{followUpTools:['calendar.update_event']})
    :answer('¿Quieres mover la app de boxeo del 14 o la app de edición del 15 de noviembre?','clarify'),{select:()=>['app','edits']});
  f.add();f.add('edits','Crear app de edición','2026-11-15T13:00:00.000Z');
  const before=f.db.sql.prepare('SELECT * FROM melodi_calendar_events ORDER BY id').all();
  await f.send('Pon la app para el 10 de noviembre.','ambiguous');
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/boxeo.*14.*edición.*15/);
  assert.deepEqual(f.db.sql.prepare('SELECT * FROM melodi_calendar_events ORDER BY id').all(),before);
  assert.equal(f.grants.some(grant=>grant.tool==='calendar.update_event'),false);
});

test('an invented event ID cannot turn remembered conversation into authority to mutate the calendar',async t=>{
  const f=await fixture(t,data=>action('calendar.update_event',{eventId:'app',expectedEventAt:ORIGINAL,when:{onDate:'2026-11-10'}},data.message.text));f.add();
  f.history.push({role:'assistant',content:'Sí, tienes la app el 14 de noviembre.',at:AT});
  await f.send('Muévelo al 10 de noviembre.','unobserved');
  assert.equal(f.row().event_at,ORIGINAL);assert.equal(f.sends.length,1);
  assert.doesNotMatch(f.sends[0],/Moví|Dejé|quedó.*10|10 de noviembre/);
});

test('a stale search observation cannot overwrite a concurrent change or echo the obsolete date as the answer',async t=>{
  const concurrent='2026-11-12T13:00:00.000Z';
  const f=await fixture(t,(data,{db})=>{
    if(data.observations.length)db.sql.prepare('UPDATE melodi_calendar_events SET event_at=? WHERE id=?').run(concurrent,'app');
    return moveDecision(data);
  });f.add();
  await f.send('Adelanta la app al 10 de noviembre.','stale');
  assert.equal(f.row().event_at,concurrent);assert.equal(f.sends.length,1);
  assert.doesNotMatch(f.sends[0],/Moví|Sí, tienes|14 de noviembre/);
  assert.match(f.sends[0],/app|aplicación/);assert.match(f.sends[0],/¿.*\?/);
});

test('an occupied destination returns the real conflicting activity and keeps both original events',async t=>{
  const f=await fixture(t,data=>moveDecision(data));f.add();f.add('consultation','Consulta con Alfredo',MOVED);
  await f.send('Pasa la creación de la app al 10 de noviembre, conservando la hora.','conflict');
  assert.equal(f.row().event_at,ORIGINAL);assert.equal(f.row('consultation').event_at,MOVED);
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/Consulta con Alfredo/);assert.match(f.sends[0],/¿.*hora.*\?/);
  assert.doesNotMatch(f.sends[0],/Sí, tienes|14 de noviembre|Moví/);
});

test('a post-commit transport crash resumes the immutable answer without another search or mutation',async t=>{
  const f=await fixture(t,data=>moveDecision(data),{failReplies:1});f.add();
  const text='Muévelo al 10 de noviembre a la misma hora.';
  assert.equal((await f.send(text,'crash')).status,'retryable');
  assert.equal(f.row().event_at,MOVED);assert.equal(f.sends.length,0);
  const inferences=f.plans.length;
  assert.equal((await f.send(text,'crash')).status,'done');
  assert.equal(f.plans.length,inferences);assert.equal(f.sends.length,1);assert.match(f.sends[0],/10 de noviembre/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts WHERE owner=?').get(OWNER).n,1);
});

test('an uncertain provider send never repeats the already committed calendar effect or risks a duplicate message',async t=>{
  const f=await fixture(t,data=>moveDecision(data),{failTransport:1});f.add();
  const text='Muévelo al 10 de noviembre a la misma hora.';
  assert.equal((await f.send(text,'uncertain-transport')).status,'uncertain');
  const inferences=f.plans.length;
  assert.equal((await f.send(text,'uncertain-transport')).status,'uncertain');
  assert.equal(f.plans.length,inferences);assert.equal(f.row().event_at,MOVED);assert.equal(f.sends.length,0);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts WHERE owner=?').get(OWNER).n,1);
});

test('a real readback depending on the update sees the committed date and cannot repeat its obsolete observation',async t=>{
  const f=await fixture(t,data=>{
    if(!data.observations.length)return action('calendar.search',{query:'La app de boxeo'},data.message.text,{followUpTools:['calendar.update_event','calendar.read']});
    const plan=moveDecision(data);
    plan.actions.push({id:'readback',tool:'calendar.read',input:RANGE,dependsOn:['step'],requestSource:data.message.text});return plan;
  });f.add();
  await f.send('Muévelo al 10 de noviembre y comprueba cómo queda mi agenda.','readback');
  assert.equal(f.row().event_at,MOVED);assert.equal(f.sends.length,1);
  assert.match(f.sends[0],/10 de noviembre/);assert.doesNotMatch(f.sends[0],/14 de noviembre|No pude/);
  const readGrant=f.grants.find(grant=>grant.id==='readback');assert.deepEqual(readGrant.dependsOn,['step']);
});

test('a combined agenda query keeps unrelated requested activities while suppressing the moved event old date',async t=>{
  const f=await fixture(t,data=>{
    if(data.observations.length)return moveDecision(data);
    const plan=action('calendar.search',{query:'La app de boxeo'},data.message.text,{followUpTools:['calendar.update_event']});
    plan.actions.push({id:'other',tool:'calendar.read',input:RANGE,dependsOn:[],requestSource:data.message.text});return plan;
  });f.add();f.add('dentist','Dentista','2026-11-11T15:00:00.000Z');
  await f.send('Dime lo que tengo en noviembre y adelanta la creación de la app al día 10.','combined-query');
  assert.equal(f.row().event_at,MOVED);assert.equal(f.sends.length,1);
  assert.match(f.sends[0],/Dentista.*11 de noviembre/);assert.match(f.sends[0],/10 de noviembre/);
  assert.doesNotMatch(f.sends[0],/14 de noviembre|No pude/);
});

test('a retrieved owner event cannot authorize changing another owner event ID',async t=>{
  const f=await fixture(t,data=>{
    if(!data.observations.length)return action('calendar.search',{query:'La app de boxeo'},data.message.text,{followUpTools:['calendar.update_event']});
    return action('calendar.update_event',{eventId:'foreign',expectedEventAt:ORIGINAL,when:{onDate:'2026-11-10'}},data.message.text);
  });f.add();f.add('foreign','Proyecto privado de otro dueño',ORIGINAL,OTHER);
  await f.send('Adelanta ese proyecto al 10 de noviembre.','foreign');
  assert.equal(f.row().event_at,ORIGINAL);assert.equal(f.row('foreign').event_at,ORIGINAL);
  assert.equal(f.sends.length,1);assert.doesNotMatch(f.sends[0],/Proyecto privado|Moví|10 de noviembre/);
});

test('a database failure leaves the source event intact and never sends the preparatory read as a final result',async t=>{
  const f=await fixture(t,data=>moveDecision(data));f.add();
  const execute=f.db.execute.bind(f.db);f.db.execute=(sql,values)=>{
    if(/UPDATE\s+melodi_calendar_events\s+SET/i.test(sql))throw Error('synthetic_calendar_write_failure');
    return execute(sql,values);
  };
  await f.send('Cambia la creación de la app al 10 de noviembre.','failed');
  assert.equal(f.row().event_at,ORIGINAL);assert.equal(f.sends.length,1);
  assert.doesNotMatch(f.sends[0],/Moví|Sí, tienes|14 de noviembre/);
  assert.match(f.sends[0],/No pude|No cambié|no.*confirmar/);
});

test('negative and hypothetical conversation can finish without any calendar service or effect',async t=>{
  const text='Quizás adelante la app al 10 de noviembre, pero todavía no cambies nada.';
  const f=await fixture(t,data=>{assert.equal(data.message.text,text);return answer('Puedes pensarlo con calma; cuando decidas la fecha, la ajustamos.');});f.add();
  const execute=f.db.execute.bind(f.db);f.db.execute=(sql,values)=>{
    assert.doesNotMatch(sql,/SELECT[^;]+FROM\s+melodi_calendar_events\b/i,'a conversational fixture must not load private agenda');return execute(sql,values);
  };
  await f.send(text,'hypothesis');assert.equal(f.row().event_at,ORIGINAL);assert.equal(f.grants.length,0);assert.equal(f.sends.length,1);
});

test('changing a whole boxing series confirms its new next occurrence and preserves all original weekdays',async t=>{
  const change='Desde ahora cambia toda la rutina de boxeo a las 10 de la mañana; conserva los mismos días.';
  const f=await fixture(t,data=>data.message.text===change?routineDecision(data)
    :action('calendar.search',{query:'La rutina de boxeo'},data.message.text),{select:selectRoutines});
  const routine=await boxingRoutine(f),before=routine.row();
  await f.send(change,'routine-hour');await f.send(change,'routine-hour');
  const after=routine.row(),payload=await routine.payload();
  assert.equal(after.id,before.id);assert.equal(after.status,'active');assert.equal(after.hour,'10:00');assert.equal(after.next_at,before.next_at+3600000);
  assert.equal(payload.frequency,'weekly');assert.deepEqual(payload.weekdays,[1,2,3,4,5]);assert.equal(payload.kind,'recurring_reminder');assert.equal(payload.brief,'Practicar la técnica de boxeo');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,0,'a series edit must not clone a one-off event');
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/rutina.*Boxeo.*10:00/);assert.doesNotMatch(f.sends[0],/9:00|09:00|No pude|¿/);
  await f.send('Comprueba cuál es ahora mi próximo entrenamiento.','routine-readback');
  assert.match(f.sends[1],/Boxeo.*10:00/);assert.doesNotMatch(f.sends[1],/9:00|09:00/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,1);
});

test('cancelling a boxing series stops the real routine and later edits or delivery retries cannot reactivate it',async t=>{
  const cancel='Cancela por completo mi rutina de boxeo.';let original;
  const f=await fixture(t,data=>{
    if(data.message.text===cancel)return routineDecision(data,{operation:'cancel'});
    if(data.message.text.startsWith('Adelanta'))return action('calendar.update_event',{eventId:original.id,expectedEventAt:original.eventAt,when:{onDate:original.eventAt.slice(0,10),localTime:'10:00'},scope:'series'},data.message.text);
    return action('calendar.search',{query:'La rutina de boxeo'},data.message.text);
  },{select:selectRoutines});
  const routine=await boxingRoutine(f);original={id:`routine:${routine.created.id}:${routine.row().next_at}`,eventAt:new Date(routine.row().next_at).toISOString()};
  await f.send(cancel,'routine-cancel');await f.send(cancel,'routine-cancel');
  assert.equal(routine.row().status,'stopped');assert.equal(f.sends.length,1);assert.match(f.sends[0],/Cancelé la rutina.*Boxeo/);
  assert.doesNotMatch(f.sends[0],/Sí, tienes|No pude/);
  await f.send('Comprueba si queda algún entrenamiento de boxeo programado.','routine-after-cancel');assert.match(f.sends[1],/No encontré/);
  await f.send('Adelanta esa rutina una hora.','routine-stopped-edit');assert.equal(routine.row().status,'stopped');assert.doesNotMatch(f.sends[2],/Actualicé|Dejé/);
  assert.equal((await routine.create()).status,'stopped','replaying original create key must also preserve cancellation');
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_melodi_routines').get().n,1);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,1);
});

test('an explicit single-occurrence change gives its supported-limit notice without a question loop or series mutation',async t=>{
  const f=await fixture(t,data=>routineDecision(data,{scope:'occurrence'}),{select:selectRoutines});
  const routine=await boxingRoutine(f),before=routine.row();
  await f.send('Solo el próximo entrenamiento cámbialo a las diez; los demás déjalos igual.','routine-one');
  assert.deepEqual(routine.row(),before);assert.equal(f.sends.length,1);assert.match(f.sends[0],/solo esa ocasión.*Google Calendar/);
  assert.doesNotMatch(f.sends[0],/¿|Actualicé|Sí, tienes|Cancelé/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,0);
});

test('an unspecified recurring change asks one concrete series-scope question before changing any schedule',async t=>{
  const f=await fixture(t,data=>routineDecision(data,{scope:null}),{select:selectRoutines});
  const routine=await boxingRoutine(f),before=routine.row();
  await f.send('Cambia el boxeo a las diez.','routine-unspecified');
  assert.deepEqual(routine.row(),before);assert.equal(f.sends.length,1);assert.match(f.sends[0],/¿Quieres cambiar toda la rutina de «Boxeo»\?/);
  assert.doesNotMatch(f.sends[0],/Sí, tienes|Actualicé/);
});

test('an unsupported multi-day recurrence pattern change cannot silently remove the original weekdays',async t=>{
  const f=await fixture(t,data=>routineDecision(data,{offset:4*86400000}),{select:selectRoutines});
  const routine=await boxingRoutine(f),before=routine.row();
  await f.send('Mueve toda la serie de boxeo al sábado.','routine-pattern');
  assert.deepEqual(routine.row(),before);assert.deepEqual((await routine.payload()).weekdays,[1,2,3,4,5]);
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/varios días por semana.*Google Calendar/);assert.doesNotMatch(f.sends[0],/¿|Actualicé/);
});

test('a linked automatic delivery cannot be cloned or retimed by the ordinary event adapter',async t=>{
  const f=await fixture(t,data=>moveDecision(data));f.add();f.db.sql.prepare("UPDATE melodi_calendar_events SET event_type='DOCUMENT_DELIVERY' WHERE id='app'").run();
  const before=f.row();await f.send('Mueve esa entrega al 10 de noviembre.','linked-delivery');
  assert.deepEqual(f.row(),before);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,1);
  assert.equal(f.sends.length,1);assert.match(f.sends[0],/entrega automática/);assert.doesNotMatch(f.sends[0],/Dejé|Moví|10 de noviembre/);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM owner_calendar_mutation_receipts').get().n,0);
});
