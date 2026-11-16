import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {searchOwnerCalendar} from '../owner-calendar-search.js';
import {ownerAutonomyServices} from '../owner-features.js';
import {createRoutineStore} from '../melodi-routines.js';
const OWNER='18095550101',AT='2026-10-26T18:59:00.000Z';
function fixture(){
  const db=new FinanceD1();db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
  const add=(id,title,eventAt,owner=OWNER)=>db.sql.prepare("INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,created_at,updated_at) VALUES(?,?,?,?,'REMINDER',?,?)").run(id,owner,title,eventAt,AT,AT);
  return{db,env,add};
}
test('semantic lookup reaches a later application event even with a daily routine and preserves its real date',async()=>{
  const f=fixture(),services=ownerAutonomyServices(f.env),routines=createRoutineStore(f.db,services);await routines.ensureSchema();
  await routines.create({owner:OWNER,agent:'melodi',kind:'motivational_message',title:'Frase diaria de boxeo',brief:'Una frase nueva',frequency:'daily',hour:'10:00',eventKey:'daily',channel:'whatsapp'});
  f.add('app','Iniciar la creación de una app para aprender boxeo','2026-11-14T13:00:00.000Z');f.add('foreign','Aplicación de otro usuario','2026-11-13T13:00:00.000Z','18095559999');
  const before=f.db.sql.prepare('SELECT * FROM melodi_calendar_events').all();
  const result=await searchOwnerCalendar(f.env,OWNER,{query:'La creación de mi aplicación de boxeo'},{referenceAt:AT,services,generate:async request=>{
    const input=JSON.parse(request.contents);assert.ok(input.candidates.some(event=>event.id==='app'));assert.equal(input.candidates.filter(event=>event.id.startsWith('routine:')).length,1);
    assert.doesNotMatch(request.contents,/otro usuario|foreign/);return{text:JSON.stringify({eventIds:['app']})};
  }});
  assert.equal(result.complete,true);assert.equal(result.matches[0].eventAt,'2026-11-14T13:00:00.000Z');assert.deepEqual(f.db.sql.prepare('SELECT * FROM melodi_calendar_events').all(),before);
});

test('unknown result IDs and model failures cannot fabricate an event or prove that it is absent',async()=>{
  const f=fixture();f.add('app','Crear una aplicación de boxeo','2026-11-14T13:00:00.000Z');
  for(const generate of [async()=>({eventIds:['invented']}),async()=>{throw Error('unavailable');},async()=>({eventIds:['app','app']})]){
    const result=await searchOwnerCalendar(f.env,OWNER,{query:'App de boxeo'},{referenceAt:AT,generate});
    assert.equal(result.status,'unresolved');assert.equal(result.complete,false);assert.deepEqual(result.matches,[]);
  }
});

test('a bounded index reports partial coverage and never calls another owner agenda',async()=>{
  const f=fixture();
  for(let i=0;i<352;i++)f.add('activity-'+i,'Actividad '+i,new Date(Date.parse(AT)+(i+1)*60000).toISOString());
  const result=await searchOwnerCalendar(f.env,OWNER,{query:'App de boxeo'},{referenceAt:AT,generate:async()=>({eventIds:[]})});
  assert.equal(result.complete,false);assert.deepEqual(result.matches,[]);
  await assert.rejects(searchOwnerCalendar(f.env,'18095559999',{query:'App'},{referenceAt:AT}),/authenticated_context_required/);
});
