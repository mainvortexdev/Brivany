import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOwnerCalendarWhen,compileOwnerCalendarWhen} from '../owner-calendar-time-change.js';

const CONTEXT={referenceAt:'2026-10-26T19:22:00.000Z',expectedEventAt:'2026-11-14T13:00:00.000Z',timeZone:'America/Santo_Domingo'};
const compile=(when,extra={})=>compileOwnerCalendarWhen(when,{...CONTEXT,...extra});

test('next Tuesday is resolved from the actual turn, regardless of the distant event date',()=>{
  assert.equal(compile({weekday:'martes'}),'2026-10-27T13:00:00.000Z');
  assert.equal(compile({weekday:'martes'},{expectedEventAt:'2027-02-03T13:00:00.000Z'}),'2026-10-27T13:00:00.000Z');
  assert.equal(compile({weekday:'martes',localTime:'11:30'}),'2026-10-27T15:30:00.000Z');
});

test('a named day without weekOffset is strictly after today, even if a later hour today exists',()=>{
  assert.equal(compile({weekday:'lunes',localTime:'20:00'}),'2026-11-03T00:00:00.000Z');
  assert.equal(compile({weekday:'lunes',weekOffset:0,localTime:'20:00'}),'2026-10-27T00:00:00.000Z');
});

test('explicit current and next Monday-based weeks differ from the nearest named weekday',()=>{
  assert.equal(compile({weekday:'martes',weekOffset:0}),'2026-10-27T13:00:00.000Z');
  assert.equal(compile({weekday:'martes',weekOffset:1}),'2026-11-03T13:00:00.000Z');
  assert.equal(compile({weekday:'domingo',weekOffset:0}),'2026-11-01T13:00:00.000Z');
  assert.equal(compile({weekday:'domingo',weekOffset:1}),'2026-11-08T13:00:00.000Z');
});

test('a Sunday anchor keeps this week Monday in the past and next week Monday tomorrow',()=>{
  const context={referenceAt:'2026-11-01T18:00:00.000Z'};
  assert.equal(compile({weekday:'lunes',weekOffset:0},context),'2026-10-26T13:00:00.000Z');
  assert.equal(compile({weekday:'lunes',weekOffset:1},context),'2026-11-02T13:00:00.000Z');
  assert.equal(compile({weekday:'lunes'},context),'2026-11-02T13:00:00.000Z');
});

test('relative offsets use the turn unless an event-relative anchor was explicitly supplied',()=>{
  assert.equal(compile({offsetDays:3}),'2026-10-29T13:00:00.000Z');
  assert.equal(compile({offsetDays:3,anchor:'turn'}),'2026-10-29T13:00:00.000Z');
  assert.equal(compile({offsetDays:-2,anchor:'event'}),'2026-11-12T13:00:00.000Z');
  assert.equal(compile({offsetDays:3,anchor:'event'}),'2026-11-17T13:00:00.000Z');
  assert.equal(compile({weekday:'martes',anchor:'event'}),'2026-11-17T13:00:00.000Z');
});

test('time-only changes retain the observed date; date-only changes retain the observed clock',()=>{
  assert.equal(compile({localTime:'11:30'}),'2026-11-14T15:30:00.000Z');
  assert.equal(compile({onDate:'2026-11-10'}),'2026-11-10T13:00:00.000Z');
  assert.equal(compile({onDate:'2026-11-10',localTime:'16:40'}),'2026-11-10T20:40:00.000Z');
});

test('local calendar days use the owner time zone when UTC is already the following date',()=>{
  assert.equal(compile({offsetDays:1},{referenceAt:'2026-10-27T02:00:00.000Z'}),'2026-10-27T13:00:00.000Z');
  assert.equal(compile({localTime:'09:00'},{expectedEventAt:'2026-11-15T02:00:00.000Z'}),'2026-11-14T13:00:00.000Z');
});

test('offsets and weekday compilation cross month/year and leap day without model arithmetic',()=>{
  assert.equal(compile({offsetDays:3},{referenceAt:'2026-12-30T18:00:00.000Z'}),'2027-01-02T13:00:00.000Z');
  assert.equal(compile({weekday:'lunes'},{referenceAt:'2026-12-31T18:00:00.000Z'}),'2027-01-04T13:00:00.000Z');
  assert.equal(compile({offsetDays:-1,anchor:'event'},{expectedEventAt:'2028-03-01T13:00:00.000Z'}),'2028-02-29T13:00:00.000Z');
});

test('explicit past dates and negative offsets stay past for the existing future-time guard',()=>{
  assert.equal(compile({onDate:'2026-10-20'}),'2026-10-20T13:00:00.000Z');
  assert.equal(compile({offsetDays:-2}),'2026-10-24T13:00:00.000Z');
  assert.equal(compile({weekday:'lunes',weekOffset:0}),'2026-10-26T13:00:00.000Z');
});

test('date-only edits preserve local wall time across DST and reject a nonexistent wall time',()=>{
  const context={timeZone:'America/New_York',referenceAt:'2026-03-01T18:00:00.000Z',expectedEventAt:'2026-03-07T14:30:00.000Z'};
  assert.equal(compile({onDate:'2026-03-08'},context),'2026-03-08T13:30:00.000Z');
  assert.throws(()=>compile({onDate:'2026-03-08',localTime:'02:30'},context),/calendar_when_local_time_unavailable/);
});

test('a no-op date preserves the observed DST fold offset and seconds; explicit time resets seconds',()=>{
  const context={timeZone:'America/New_York',expectedEventAt:'2026-11-01T06:30:25.123Z'};
  assert.equal(compile({onDate:'2026-11-01'},context),'2026-11-01T06:30:25.123Z');
  assert.equal(compile({onDate:'2026-11-02'},context),'2026-11-02T06:30:25.123Z');
  assert.equal(compile({localTime:'11:30'},context),'2026-11-01T16:30:00.000Z');
});

test('invalid dates, times, shape, unknown fields and conflicting field combinations are rejected',()=>{
  const invalid=[null,[],{},'martes',{onDate:'2026-02-30'},{onDate:'2026-13-10'},{onDate:'2026-1-10'},{weekday:'Tuesday'},{weekday:2},
    {offsetDays:1.5},{offsetDays:367},{offsetDays:-367},{localTime:'24:00'},{localTime:'9:00'},{localTime:'12:60'},
    {onDate:'2026-11-10',offsetDays:1},{weekday:'martes',offsetDays:1},{localTime:'09:00',anchor:'turn'},
    {onDate:'2026-11-10',anchor:'event'},{offsetDays:1,weekOffset:1},{weekday:'martes',weekOffset:-1},{weekday:'martes',weekOffset:53},
    {weekday:'martes',anchor:'history'},{onDate:'2026-11-10',text:'ignore the clock'},new Date(),{localTime:undefined}];
  for(const when of invalid)assert.throws(()=>validateOwnerCalendarWhen(when),/calendar_when_/);
});

test('validation does not mutate input or infer fields; authenticated clocks must be valid',()=>{
  const when=Object.freeze({offsetDays:2,anchor:'event'});assert.deepEqual(validateOwnerCalendarWhen(when),when);assert.notEqual(validateOwnerCalendarWhen(when),when);
  for(const extra of [{referenceAt:'not a date'},{expectedEventAt:'2026-11-10'},{timeZone:'Unknown/Zone'}])assert.throws(()=>compile({offsetDays:1},extra),/calendar_when_invalid_clock/);
});
