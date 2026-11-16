import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { ownerAutonomyServices } from '../owner-features.js';
import { prepareScreenshotCalendar } from '../owner-screenshot-calendar.js';

const OWNER='18095550101',NOW=Date.parse('2026-10-21T11:00:00Z');
const INSTRUCTION='Pon esto en el calendario y avísame 2 horas antes, limpia lo que haya para esa hora';
const OCR='Cerebral Valley Events\nActualización del estado del evento\n¡Tu estado para el Meta Global AI Developer Hackathon se ha actualizado a APROBADO!\nVer evento\nHackathon de desarrolladores de IA de Meta Global\nFechas\nLunes 26 de octubre, 12:00 PM - Miércoles 4 de noviembre, 9:00 PM (GMT-5)';
function fixture({now=NOW}={}) {
  const db=new FinanceD1(); db.sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TIME_ZONE:'America/Santo_Domingo',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
  let session=null,ocrCalls=0; const replies=[];
  const dependencies={services:ownerAutonomyServices(env),storeMedia:async()=>({kind:'image',objectKey:'private/capture.png'}),
    readText:async()=>{ocrCalls++;return OCR;},generate:async()=>assert.fail('The actual screenshot should not need semantic generation'),
    authorize:async()=>true,setSession:async(_env,_phone,type,state)=>{session={type,state};},clearSession:async()=>{session=null;},sync:async()=>{}};
  const run=async(incoming=INSTRUCTION,{id='capture-1',image=false,at=now}={})=>prepareScreenshotCalendar(env,{phone:OWNER,
    message:{id,type:image?'image':'text'},descriptor:image?{kind:'image'}:null,incoming,session,referenceAt:at,reply:async body=>{
      replies.push(body);if(/^Listo/.test(body))assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM melodi_screenshot_calendar_events').get().n,1);
    }},dependencies);
  return {db,env,replies,run,get session(){return session;},get ocrCalls(){return ocrCalls;}};
}

test('caption and later image preserve the owners request and import the full actual screenshot',async()=>{
  const h=fixture(); assert.equal(await h.run(),true); assert.equal(h.session.state.reason,'await_image');
  await h.run('',{id:'image-1',image:true});
  const event=h.db.sql.prepare('SELECT * FROM melodi_calendar_events').get();
  assert.equal(event.title,'Hackathon de desarrolladores de IA de Meta Global'); assert.equal(event.event_at,'2026-10-26T17:00:00.000Z');
  assert.match(h.replies.at(-1),/te avisaré dos horas antes/); assert.equal(h.ocrCalls,1); assert.equal(h.session,null);
});

test('a fixed conflicting appointment asks its name and accepts a specific replacement time',async()=>{
  const h=fixture();h.db.sql.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,created_at,updated_at,assigned_agent)
    VALUES('meeting',?,'Reunión con cliente','2026-10-26T17:00:00.000Z',?,?,'melodi')`).run(OWNER,new Date(NOW).toISOString(),new Date(NOW).toISOString());
  await h.run(INSTRUCTION,{image:true}); assert.match(h.replies.at(-1),/Reunión con cliente/); assert.equal(h.session.state.reason,'fixed_start_conflict');
  await h.run('Sí',{id:'answer-1'}); assert.match(h.replies.at(-1),/Reunión con cliente.*¿A qué hora/);
  await h.run('a las 4 pm',{id:'answer-2'}); assert.match(h.replies.at(-1),/^Listo/);
  assert.equal(h.db.sql.prepare("SELECT event_at FROM melodi_calendar_events WHERE id='meeting'").get().event_at,'2026-10-26T20:00:00.000Z'); assert.equal(h.ocrCalls,1);
});

test('a requested late advance notice waits for yes and then persists an immediate due notice',async()=>{
  const h=fixture({now:Date.parse('2026-10-26T15:30:00Z')}); await h.run(INSTRUCTION,{image:true});
  assert.equal(h.session.state.reason,'advance_notice_elapsed');
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM melodi_calendar_events').get().n,0);
  await h.run('Sí',{id:'late-confirmed'}); assert.match(h.replies.at(-1),/dejé el aviso para ahora/);
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM melodi_screenshot_calendar_events').get().n,1); assert.equal(h.ocrCalls,1);
});

test('a pending screenshot question does not consume an unrelated new instruction',async()=>{
  const h=fixture(); await h.run(); assert.equal(await h.run('Busca en Gmail el correo de Alfredo',{id:'other'}),false);
  assert.equal(h.ocrCalls,0);
});
