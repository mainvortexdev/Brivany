import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {persistSemanticCalendarEvents} from '../semantic-calendar-store.js';
const OWNER='18095550101',NOW=Date.parse('2026-10-26T12:22:00Z');
const events=[{title:'Boxeo',eventAt:'2026-10-26T13:10:00.000Z'},{title:'Grabación',eventAt:'2026-11-01T09:00:00.000Z'}];
function fixture(){const db=new FinanceD1();db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));return{db,env:{VETSA_CLOUD:db}};}
test('one or several events have immutable source IDs and a replay cannot overwrite or resurrect them',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});
  for(const set of [events.slice(0,1),events]){
    const{db,env}=fixture(),saved=await persistSemanticCalendarEvents(env,OWNER,'message',set);
    assert.equal(saved.status,'scheduled');assert.equal(saved.events.length,set.length);
    assert.deepEqual(await persistSemanticCalendarEvents(env,OWNER,'message',set),saved);
    await assert.rejects(persistSemanticCalendarEvents(env,OWNER,'message',set.map(e=>({...e,title:e.title+' changed'}))),/request_changed/);
    db.sql.prepare('UPDATE melodi_calendar_events SET title=? WHERE id=?').run('Owner edit',saved.events[0].id);
    await assert.rejects(persistSemanticCalendarEvents(env,OWNER,'message',set),/verification_failed/);
    assert.equal(db.sql.prepare('SELECT title FROM melodi_calendar_events WHERE id=?').get(saved.events[0].id).title,'Owner edit');
    db.sql.prepare('DELETE FROM melodi_calendar_events WHERE id=?').run(saved.events[0].id);
    await assert.rejects(persistSemanticCalendarEvents(env,OWNER,'message',set),/verification_failed/);
    assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,set.length-1);
  }
});
test('a failed insert rolls back the whole semantic request receipt and every event',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});const{db,env}=fixture();
  db.sql.exec("CREATE TRIGGER reject_second BEFORE INSERT ON melodi_calendar_events WHEN NEW.title='Grabación' BEGIN SELECT RAISE(ABORT,'fail_second'); END");
  await assert.rejects(persistSemanticCalendarEvents(env,OWNER,'message',events),/fail_second/);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM melodi_calendar_events').get().n,0);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM semantic_calendar_requests').get().n,0);
});
