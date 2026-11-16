import test from 'node:test';
import assert from 'node:assert/strict';
import {runScheduledTick} from '../worker.js';

function tasks(){
  const calls=[],overrides={};
  for(const name of ['project_repair','workspace_repair','subscription_repair','calendar_invite','team','usage_reports','story_campaign','single_stories','reminders','images','memory','subscription','instagram','jobs','melodi']) overrides[name]=async options=>{calls.push({name,...options});};
  return{calls,overrides};
}
for(const status of ['retrying','busy','continuing','reconnect_required','provisioning_needed']){
  test(`Calendar ${status} holds dated work while independent assignments and maintenance continue`,async()=>{
    const f=tasks();await runScheduledTick({}, {syncCalendar:async()=>({status}),tasks:f.overrides});
    assert.deepEqual(f.calls.find(x=>x.name==='team'),{name:'team',calendarReady:false});
    assert.equal(f.calls.some(x=>['reminders','story_campaign','single_stories'].includes(x.name)),false);
    for(const name of ['memory','jobs','usage_reports'])assert.ok(f.calls.some(x=>x.name===name));
  });
}
test('sync and preflight exceptions cannot discard unrelated owner work',async()=>{
  const f=tasks();f.overrides.project_repair=async()=>{throw Error('synthetic_database_busy');};
  await runScheduledTick({}, {syncCalendar:async()=>{throw Error('synthetic_google_timeout');},tasks:f.overrides});
  assert.deepEqual(f.calls.find(x=>x.name==='team'),{name:'team',calendarReady:false});
  assert.ok(f.calls.some(x=>x.name==='memory'));
});
