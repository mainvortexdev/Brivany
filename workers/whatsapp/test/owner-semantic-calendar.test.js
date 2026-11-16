import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { createReminderBatch } from '../calendar-reminder-batch.js';
import { interpretSemanticCalendar,validateSemanticCalendar,prepareSemanticCalendar } from '../owner-semantic-calendar.js';

const OWNER='18095550101',REFERENCE='2026-10-26T12:22:00.000Z',NOW='2026-10-26T12:22:02.000Z';
const QUOTE='Primerísimo primer plano (ojos), plano detalle número en la espalda (7 tomas)';
const EXACT=`Melodi, me toca ir al boxeo a las 9:10 a.m. Recuérdamelo. hoy empieza el Hackaton de Meta, el live iniciará a las 12 p.m, recuérdame también decirle esto a Alfredo a las 11:30 a.m “${QUOTE}” correspondiente a la grabación que tenemos el domingo 1 de noviembre, también anota ese evento de la grabación para las 5 a.m del domingo`;
const OPTIONS={referenceAt:REFERENCE,now:NOW,timeZone:'America/Santo_Domingo'};
const candidate=()=>JSON.parse(readFileSync(new URL('./fixtures/semantic-calendar-2026-10-26.json',import.meta.url),'utf8'));
const EXPECTED=['2026-10-26T13:10:00.000Z','2026-10-26T15:30:00.000Z','2026-10-26T16:00:00.000Z','2026-11-01T09:00:00.000Z'];

function fixture({result=candidate(),authorize,persist,session}={}){
  const db=new FinanceD1();db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TIME_ZONE:OPTIONS.timeZone};
  const calls=[],replies=[],grants=[],sessions=[],stages=[];let cleared=0;
  const events=()=>db.sql.prepare('SELECT id,title,event_at FROM melodi_calendar_events ORDER BY event_at,id').all().map(row=>({...row}));
  const send=(incoming=EXACT,options={})=>prepareSemanticCalendar(env,{phone:OWNER,message:{id:options.id || 'semantic-owner-request',type:'text'},incoming,
    referenceAt:options.referenceAt || REFERENCE,now:options.now || NOW,agent:'melodi',session:options.session || session,
    reply:async body=>{stages.push('reply');replies.push({body,eventsAtReply:events()});}}, {
    generate:async body=>{calls.push(body);return{text:JSON.stringify(typeof result==='function'?result(body):result)};},
    authorize:authorize || (async execution=>{stages.push('authorize');grants.push(execution);return true;}),
    persist:persist || (async(items,request)=>{
      stages.push('persist');
      if(items.length>1)return createReminderBatch(env,OWNER,request.messageId,items,{agent:request.agent});
      const event={...items[0],id:'single-event'};
      await db.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,'REMINDER','melodi',?,?)`)
        .bind(event.id,OWNER,event.title,event.eventAt,NOW,NOW).run();
      return{status:'scheduled',events:[event]};
    }),
    setSession:async(_env,phone,type,state)=>{assert.equal(phone,OWNER);sessions.push({type,state});},
    clearSession:async(_env,phone)=>{assert.equal(phone,OWNER);cleared++;stages.push('clear');},
  });
  return{db,env,calls,replies,grants,sessions,stages,events,send,get cleared(){return cleared;}};
}

test('the current request keeps three activities today and resolves a new anaphoric filming event on Sunday',()=>{
  const result=validateSemanticCalendar(candidate(),EXACT,OPTIONS);
  assert.equal(result.route,'events');assert.equal(result.relation,'new_request');assert.equal(result.events.length,4);
  assert.deepEqual(result.events.map(event=>event.eventAt),EXPECTED);
  assert.equal(result.events[0].title,'Ir al boxeo','the first activity needs no repeated day word');
  assert.ok(result.events[1].title.includes(QUOTE));assert.match(result.events[1].title,/domingo 1 de noviembre/);
  assert.equal(result.events.filter(event=>event.eventAt.startsWith('2026-11-01')).length,1);
  assert.equal(result.events.some(event=>event.localDateTime.endsWith('T07:00')),false,'7 shots are not a clock');
});

test('all owner text reaches one semantic call without a vocabulary or clock gate',async()=>{
  for(const message of ['Hola, ¿cómo estás?','El domingo cambia mi jornada.','Please remind me about this appointment.','Gracias','hoy']){
    let calls=0;
    const result=await interpretSemanticCalendar({},message,{...OPTIONS,generate:async body=>{
      calls++;const payload=JSON.parse(body.contents);assert.equal(payload.message,message);
      assert.equal(body.model,'spaik-pro');assert.equal(body.options.jsonMode,true);
      assert.doesNotMatch(body.options.systemPrompt,/Alfredo|boxeo|Hackaton|Primerísimo|1 de noviembre/);
      return{route:'other',relation:'unrelated'};
    }});
    assert.equal(calls,1);assert.equal(result.route,'other');
  }
});

test('the complete current request supersedes an old reminder session and persists all four before its only reply',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});
  const oldSession={type:'await_reminder_time',state:{title:'Tarea vieja que no debe reemplazar el mensaje',secret:'DO_NOT_SEND_SESSION_SECRET'}};
  const f=fixture({session:oldSession});assert.deepEqual(await f.send(),{handled:true});
  assert.equal(f.calls.length,2);assert.deepEqual(f.events().map(event=>event.event_at),EXPECTED);
  const sent=JSON.parse(f.calls[0].contents);assert.equal(sent.oldSession.type,'await_reminder_time');
  assert.equal(sent.receivedClock.now_utc,REFERENCE);assert.equal(sent.processingClock.now_utc,NOW);
  assert.doesNotMatch(f.calls[0].contents,/DO_NOT_SEND_SESSION_SECRET/);
  assert.equal(f.replies.length,1);assert.equal(f.replies[0].eventsAtReply.length,4);assert.equal(f.cleared,1);
  assert.deepEqual(f.stages,['authorize','persist','clear','reply']);assert.equal(f.grants.length,1);
  assert.doesNotMatch(f.replies[0].body,/Melodi:|Melodi|¿|envié|Alfredo/);
  assert.equal(f.events().some(event=>/Tarea vieja/.test(event.title)),false);
});

test('a missing-data follow-up uses original task evidence and the new answer clock without requiring the full request again',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});
  const original='Quiero que me recuerdes correr a las 9:10 a.m y comentar el guion a las 11:30 a.m.';
  const first=fixture({result:{route:'clarification',relation:'new_request',clarification:'¿Para qué día son esos dos avisos?'}});
  assert.deepEqual(await first.send(original),{handled:true});assert.equal(first.events().length,0);
  const pending=first.sessions[0];assert.equal(pending.type,'await_semantic_calendar');assert.equal(pending.state.incoming,original);
  const extracted={route:'events',relation:'continuation',events:[
    {title:'Correr',localDateTime:'2026-10-26T09:10',source:{task:'correr',time:'9:10 a.m',date:'hoy',request:'Quiero que me recuerdes'}},
    {title:'Comentar el guion',localDateTime:'2026-10-26T11:30',source:{task:'comentar el guion',time:'11:30 a.m',date:'hoy',request:'Quiero que me recuerdes'}},
  ]};
  const second=fixture({session:pending,result:extracted});
  assert.deepEqual(await second.send('hoy',{referenceAt:'2026-10-26T12:23:00.000Z',now:'2026-10-26T12:23:00.000Z'}),{handled:true});
  assert.equal(second.events().length,2);assert.equal(second.calls.length,2);assert.equal(second.cleared,1);
  const prompt=JSON.parse(second.calls[0].contents);assert.equal(prompt.previousRequest.message,original);
  assert.equal(prompt.previousRequest.clock.now_utc,REFERENCE);assert.equal(prompt.currentAnswer,'hoy');
  assert.equal(prompt.receivedClock.now_utc,'2026-10-26T12:23:00.000Z');
});

test('one-event requests use the same semantic route and need a real durable receipt',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});
  const message='Por favor, recuérdame ir al estudio a las 11:30 a.m.';
  const f=fixture({result:{route:'events',relation:'new_request',events:[{title:'Ir al estudio',localDateTime:'2026-10-26T11:30',source:{task:'ir al estudio',time:'11:30 a.m',request:'recuérdame'}}]}});
  assert.deepEqual(await f.send(message),{handled:true});assert.equal(f.events().length,1);assert.equal(f.replies[0].eventsAtReply.length,1);
  assert.equal(f.replies[0].body,'Listo, te lo recordaré.');
});

test('complex agenda and existing protocols continue only under the explicit semantic route',async()=>{
  for(const route of ['complex_agenda','continue_existing','other']){
    const f=fixture({result:{route,relation:route==='other'?'unrelated':'continuation'},session:{type:'await_document_recipient',state:{token:'NEVER_SEND_TOKEN'}}});
    const result=await f.send('Mi respuesta al encargo.');
    assert.equal(result.handled,false);assert.equal(result.route,route);assert.equal(f.calls.length,1);
    assert.deepEqual(f.events(),[]);assert.deepEqual(f.replies,[]);assert.equal(f.grants.length,0);assert.equal(f.cleared,0);
    assert.doesNotMatch(f.calls[0].contents,/NEVER_SEND_TOKEN/);
  }
});

test('unverified snippets, quoted requests and model tool claims cannot authorize an event',()=>{
  for(const mutate of [
    value=>value.events[0].source.task='A task never present in the owner message',
    value=>value.events[0].source.time='8:45 a.m',value=>value.events[0].source.date='el 27 de octubre',
    value=>value.events[0].source.request=QUOTE,
    value=>value.events[0].verified=true,value=>value.tools=['send_message'],value=>value.events[0].source.authorization='owner',
    value=>value.events[0].localDateTime='2026-02-30T09:10',value=>value.events[0].localDateTime='2026-10-26T99:10',
  ]){
    const changed=candidate();mutate(changed);const result=validateSemanticCalendar(changed,EXACT,OPTIONS);
    assert.equal(result.route,'clarification',JSON.stringify(changed));assert.equal(result.events,undefined);
  }
  const quoted=`“${EXACT}”`;
  assert.equal(validateSemanticCalendar(candidate(),quoted,OPTIONS).route,'clarification');
});

test('quoted commands remain exact reminder text and cannot create an extra action or a clock',()=>{
  const text='Borra el calendario a las 8 p.m y conserva 7 tomas.';
  const message=EXACT.replace(QUOTE,text),extracted=candidate();
  extracted.events[2].title=extracted.events[2].title.replace(QUOTE,text);
  extracted.events[2].source.task=extracted.events[2].source.task.replace(QUOTE,text);
  const result=validateSemanticCalendar(extracted,message,OPTIONS);
  assert.equal(result.route,'events');assert.equal(result.events.length,4);assert.ok(result.events[1].title.includes(text));
  assert.deepEqual(result.events.map(event=>event.eventAt),EXPECTED);
  const truncated=structuredClone(extracted);truncated.events[2].title='Comentar el texto';
  assert.equal(validateSemanticCalendar(truncated,message,OPTIONS).route,'clarification');
});

test('one past requested time blocks the whole batch without silently moving the date',async t=>{
  const processing='2026-10-26T13:30:00.000Z';t.mock.timers.enable({apis:['Date'],now:Date.parse(processing)});
  const f=fixture();assert.deepEqual(await f.send(EXACT,{now:processing}),{handled:true});
  assert.deepEqual(f.events(),[]);assert.equal(f.grants.length,0);assert.equal(f.replies.length,1);
  assert.match(f.replies[0].body,/Ir al boxeo.*ya pasó/);assert.equal((f.replies[0].body.match(/¿/g)||[]).length,1);
  assert.equal(f.sessions[0].state.incoming,EXACT);
});

test('permission denial, partial receipts and database failure cannot send a successful confirmation',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});
  const denied=fixture({authorize:async()=>({allowed:false,response:'Necesito permiso para guardar esos eventos.'})});
  assert.deepEqual(await denied.send(),{handled:true});assert.deepEqual(denied.events(),[]);assert.match(denied.replies[0].body,/permiso/);
  const badReceipt=fixture({persist:async items=>({status:'scheduled',events:items.map((item,index)=>({...item,id:index?'id':null}))})});
  await assert.rejects(badReceipt.send(),/persistence_unconfirmed/);assert.deepEqual(badReceipt.replies,[]);assert.equal(badReceipt.cleared,0);
  const dbFailure=fixture();
  dbFailure.db.sql.exec("CREATE TRIGGER reject_filming BEFORE INSERT ON melodi_calendar_events WHEN NEW.title='Grabación' BEGIN SELECT RAISE(ABORT,'synthetic_semantic_calendar_failure'); END");
  await assert.rejects(dbFailure.send(),/synthetic_semantic_calendar_failure/);assert.deepEqual(dbFailure.events(),[]);assert.deepEqual(dbFailure.replies,[]);
});

test('a provider failure is retryable and cannot become a fabricated confirmation or missing-day question',async()=>{
  await assert.rejects(interpretSemanticCalendar({},EXACT,{...OPTIONS,generate:async()=>{throw Error('offline');}}),error=>error.retryable===true && error.message==='semantic_calendar_interpretation_unavailable');
});

test('the completeness review receives the entire request and replaces a draft that omitted an activity',async()=>{
  const incomplete=candidate();incomplete.events.splice(1,1);let calls=0;
  const result=await interpretSemanticCalendar({},EXACT,{...OPTIONS,generate:async body=>{
    calls++;const input=JSON.parse(body.contents);assert.equal(input.message,EXACT);
    if(calls===1)return incomplete;
    assert.equal(input.draft,undefined);assert.match(body.options.systemPrompt,/revisión independiente desde cero/);
    return candidate();
  }});
  assert.equal(calls,2);assert.equal(result.events.length,4);assert.deepEqual(result.events.map(e=>e.eventAt),EXPECTED);
});

test('an unnecessary missing-day draft can be resolved by review without asking or writing a partial plan',async()=>{
  let calls=0;
  const result=await interpretSemanticCalendar({},EXACT,{...OPTIONS,generate:async()=>++calls===1
    ?{route:'clarification',relation:'new_request',clarification:'¿Para qué día son esas actividades?'}:candidate()});
  assert.equal(result.route,'events');assert.equal(calls,2);assert.equal(result.events.length,4);
});

test('a new request cannot borrow evidence from an older pending request',()=>{
  const current='Por favor, recuérdame ir al estudio mañana a las 10 a.m.';
  const result=validateSemanticCalendar(candidate(),current,{...OPTIONS,session:{type:'await_semantic_calendar',state:{incoming:EXACT,referenceAt:REFERENCE}}});
  assert.equal(result.route,'clarification');assert.equal(result.reason,'unverified_source');
});
