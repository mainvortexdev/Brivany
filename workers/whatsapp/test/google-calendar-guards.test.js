import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { calendarActivityPaused } from '../google-calendar-guards.js';
import { GOOGLE_CALENDAR_SCHEMA } from '../google-calendar-store.js';
import { createRoutineStore, ROUTINE_SCHEMA } from '../melodi-routines.js';
import { runUsageReports } from '../cognira-reports.js';

const OWNER='18095550101',OTHER='18095559999';
const CREATED=Date.parse('2026-10-08T12:00:00Z'),DUE=Date.parse('2026-10-09T13:00:00Z');
class D1 {
  constructor(){this.sql=new DatabaseSync(':memory:');}
  prepare(query){const db=this,make=values=>({query,values,bind:(...next)=>make(next),
    async first(){return db.execute(query,values).results[0] || null;},
    async all(){return db.execute(query,values);},async run(){return db.execute(query,values);}});return make([]);}
  execute(query,values){const statement=this.sql.prepare(query);return statement.columns().length
    ? {results:statement.all(...values),meta:{changes:Number(this.sql.prepare('SELECT changes() AS n').get().n)}}
    : {results:[],meta:{changes:Number(statement.run(...values).changes)}};}
  async batch(statements){this.sql.exec('BEGIN');try{const results=statements.map(item=>this.execute(item.query,item.values));this.sql.exec('COMMIT');return results;}
    catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
function calendarDatabase(){const db=new D1();db.sql.exec(GOOGLE_CALENDAR_SCHEMA.join(';'));return db;}
function map(db,kind,id,{owner=OWNER,status='unsupported'}={}){
  db.sql.prepare(`INSERT INTO melodi_google_calendar_activity_map(owner,kind,source_id,agent,google_event_id,status,updated_at)
    VALUES(?,?,?,'melodi',?,?,?)`).run(owner,kind,id,`google-${owner}-${kind}-${id}`,status,CREATED);
}

test('Calendar quarantine scopes the owner, source kind and exact activity without pausing other states',async()=>{
  const db=calendarDatabase();map(db,'melodi_calendar_events','paused');map(db,'melodi_calendar_events','another-owner',{owner:OTHER});
  for(const status of ['active','cancelled','completed'])map(db,'melodi_calendar_events',status,{status});
  assert.equal(await calendarActivityPaused(db,OWNER,'melodi_calendar_events','paused'),true);
  assert.equal(await calendarActivityPaused(db,OTHER,'melodi_calendar_events','paused'),false);
  assert.equal(await calendarActivityPaused(db,OWNER,'story_single','paused'),false);
  assert.equal(await calendarActivityPaused(db,OWNER,'melodi_calendar_events','another-owner'),false);
  for(const id of ['active','cancelled','completed','missing'])assert.equal(await calendarActivityPaused(db,OWNER,'melodi_calendar_events',id),false,id);
  db.sql.prepare("UPDATE melodi_google_calendar_activity_map SET status='active' WHERE source_id='paused'").run();
  assert.equal(await calendarActivityPaused(db,OWNER,'melodi_calendar_events','paused'),false);
});

test('legacy databases without Calendar mapping keep running, while unrelated database errors fail closed',async()=>{
  assert.equal(await calendarActivityPaused(new D1(),OWNER,'melodi_calendar_events','legacy'),false);
  const fail=message=>({prepare(){throw new Error(message);}});
  await assert.rejects(calendarActivityPaused(fail('database unavailable'),OWNER,'melodi_calendar_events','legacy'),/database unavailable/);
  await assert.rejects(calendarActivityPaused(fail('no such table: melodi_calendar_events'),OWNER,'melodi_calendar_events','legacy'),/melodi_calendar_events/);
});

test('an unrelated adapter row cannot falsely quarantine a different activity',async()=>{
  const db={prepare(){return {bind(){return {async first(){return {source_id:'another-activity'};}};}};}};
  assert.equal(await calendarActivityPaused(db,OWNER,'melodi_calendar_events','expected'),false);
});

async function routineFixture({calendar=true}={}){
  const db=calendar ? calendarDatabase() : new D1();db.sql.exec(ROUTINE_SCHEMA.join(';'));
  let now=CREATED,index=0;
  const store=createRoutineStore(db,{now:()=>now,uuid:()=>`routine-${++index}`,
    encrypt:async value=>({encrypted:value,iv:'fixture'}),decrypt:async value=>value});
  const create=eventKey=>store.create({owner:OWNER,agent:'melodi',eventKey,title:eventKey,brief:'Investigar formatos',profile:'@perfil',channel:'email'});
  return {db,store,create,due(){now=DUE;}};
}

test('routine claim limits count executable sources and skip the first quarantined row without consuming its attempts',async()=>{
  const f=await routineFixture(),paused=await f.create('first-paused'),active=await f.create('second-active');
  map(f.db,'agent_routine',paused.id);f.due();
  const claimed=await f.store.claimDue({owner:OWNER,limit:1});assert.deepEqual(claimed.map(row=>row.id),[active.id]);
  const frozen=f.db.sql.prepare('SELECT attempts,lease_token,next_at FROM wa_melodi_routines WHERE id=?').get(paused.id);
  assert.equal(frozen.attempts,0);assert.equal(frozen.lease_token,null);assert.equal(frozen.next_at,DUE);
  assert.equal(await f.store.complete({owner:OWNER,id:active.id,leaseToken:claimed[0].leaseToken,success:true}),true);
  f.db.sql.prepare("UPDATE melodi_google_calendar_activity_map SET status='active' WHERE source_id=?").run(paused.id);
  assert.deepEqual((await f.store.claimDue({owner:OWNER,limit:1})).map(row=>row.id),[paused.id]);
});

test('legacy routine claims remain executable without installing the Calendar schema',async()=>{
  const f=await routineFixture({calendar:false}),routine=await f.create('legacy');f.due();
  assert.deepEqual((await f.store.claimDue({owner:OWNER,limit:1})).map(row=>row.id),[routine.id]);
});

test('quarantined Cognira sources do not fill the delivery batch or prevent another due report',async()=>{
  const db=calendarDatabase();db.sql.exec(readFileSync(new URL('../cognira-reports.sql',import.meta.url),'utf8'));
  db.sql.exec('CREATE TABLE cognira_daily_activity(user_id TEXT,activity_day TEXT,edition TEXT,requests INTEGER)');
  const insert=db.sql.prepare(`INSERT INTO cognira_report_schedules(id,owner_phone,channel,target,next_at,recurring,time_zone,local_hour)
    VALUES(?,?,'email',?,? ,0,'America/Santo_Domingo','09:00')`);
  for(let index=0;index<5;index++){const id=`paused-${index}`;insert.run(id,OWNER,`${id}@example.test`,new Date(DUE-60000+index).toISOString());map(db,'cognira_report',id);}
  insert.run('active',OWNER,'active@example.test',new Date(DUE-1000).toISOString());
  const sent=[];await runUsageReports({VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TIME_ZONE:'America/Santo_Domingo'},async()=>assert.fail('Email channel changed'),
    async(_env,_owner,_id,input)=>{sent.push(input.to);return {status:'sent'};},new Date(DUE));
  assert.deepEqual(sent,['active@example.test']);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM cognira_report_schedules').get().n,5);
  assert.ok(db.sql.prepare('SELECT lease_until FROM cognira_report_schedules').all().every(row=>row.lease_until===null));
});
