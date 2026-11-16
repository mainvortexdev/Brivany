import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerAgendaContinuationSummary,resolveSemanticAgendaContinuation} from '../owner-agenda-continuation.js';
const NOW='2026-10-26T18:00:00.000Z';
const session=()=>({type:'await_agenda_plan',state:{reason:'past_fixed',directive:{kind:'compound_agenda',referenceAt:'2026-10-26T10:00:00.000Z',timeZone:'America/Santo_Domingo',relaxToday:true,
  actions:{distribute:['Terminar Vetsa','Terminar Cognira'],moveDay:{from:'today',to:'tomorrow'},fixed:[{title:'Boxeo',day:'today',localTime:'05:00',assumedPeriod:false},{title:'Trabajar con Alfredo',day:'today',localTime:'06:00',assumedPeriod:false}]}},
  conflict:{events:[{id:'real-consultation',title:'Consulta',kind:'melodi_calendar_events',eventAt:'2026-10-27T17:00:00.000Z',previousEventAt:'2026-10-26T17:00:00.000Z'}]}}});

test('typed clarification preserves the complete original plan and its clock while changing only selected dates',()=>{
  const original=session(),before=structuredClone(original);
  const result=resolveSemanticAgendaContinuation(original,{decision:'apply',fixedChanges:[{index:0,day:'2026-10-28'},{index:1,day:'2026-10-28'}]},{now:NOW});
  assert.equal(result.status,'resolved');assert.equal(result.directive.referenceAt,before.state.directive.referenceAt);assert.equal(result.directive.effectiveAt,NOW);
  assert.deepEqual(result.directive.actions.distribute,['Terminar Vetsa','Terminar Cognira']);
  assert.deepEqual(result.directive.actions.fixed.map(item=>[item.title,item.day,item.localTime]),[['Boxeo','2026-10-28','05:00'],['Trabajar con Alfredo','2026-10-28','06:00']]);
  assert.deepEqual(original,before);
});

test('an explicit event move is restricted to the actual pending conflict and requires a future zoned instant',()=>{
  const original=session();
  for(const move of [{id:'invented',eventAt:'2026-10-27T18:00:00Z'},{id:'real-consultation',eventAt:'2026-10-27T18:00'},{id:'real-consultation',eventAt:'2026-10-25T18:00:00Z'}])
    assert.throws(()=>resolveSemanticAgendaContinuation(original,{decision:'apply',eventMoves:[move]},{now:NOW}),/invalid_agenda_event_resolution/);
  const result=resolveSemanticAgendaContinuation(original,{decision:'apply',eventMoves:[{id:'real-consultation',eventAt:'2026-10-27T14:00:00-04:00'}]},{now:NOW});
  assert.deepEqual(result.directive.eventMoves,[{id:'real-consultation',eventAt:'2026-10-27T18:00:00.000Z',previousEventAt:'2026-10-26T17:00:00.000Z'}]);
});

test('a duplicate item, impossible date or missing activity cannot silently change the saved agenda',()=>{
  for(const fixedChanges of [[{index:0,day:'2026-02-30'}],[{index:4,day:'2026-10-28'}],[{index:0,day:'2026-10-28'},{index:0,localTime:'08:00'}]])
    assert.throws(()=>resolveSemanticAgendaContinuation(session(),{decision:'apply',fixedChanges},{now:NOW}));
  assert.deepEqual(resolveSemanticAgendaContinuation(session(),{decision:'cancel'},{now:NOW}),{status:'cancelled'});
  assert.throws(()=>resolveSemanticAgendaContinuation(session(),{decision:'cancel',onlyCalendarEvents:true},{now:NOW}));
});

test('the planner summary contains agenda facts without saved credentials or arbitrary event fields',()=>{
  const current=session();current.state.directive.actions.fixed[0].credential='private-synthetic';current.state.conflict.events[0].objectKey='private/reference';
  const summary=ownerAgendaContinuationSummary(current);assert.doesNotMatch(JSON.stringify(summary),/private-synthetic|private\/reference|credential|objectKey/);
  assert.equal(summary.fixed[1].index,1);assert.equal(summary.conflicts[0].id,'real-consultation');assert.equal(ownerAgendaContinuationSummary({type:'capture',state:{}}),null);
});
