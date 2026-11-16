import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {handleOwnerMessage,ownerAutonomyServices} from '../owner-features.js';
import {processWhatsAppEnvelope} from '../whatsapp-request-scope.js';
const OWNER='18095550101',REFERENCE='2026-10-26T12:22:00Z',NOW='2026-10-26T12:30:00Z';
const REQUEST='Melodi, me toca ir al boxeo a las 9:10 a.m. Recuérdamelo. hoy empieza el Hackaton de Meta, el live iniciará a las 12 p.m, recuérdame también decirle esto a Alfredo a las 11:30 a.m “Primerísimo primer plano (ojos), plano detalle número en la espalda (7 tomas)” correspondiente a la grabación que tenemos el domingo 1 de noviembre, también anota ese evento de la grabación para las 5 a.m del domingo';
test('the real owner handler semantically schedules all four despite a stale question and replays no actions',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});
  const db=new FinanceD1();for(const file of ['schema.sql','melodi-team-coordination.sql','story-campaign.sql','story-approval.sql'])db.sql.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
  db.sql.exec(`CREATE TABLE google_calendar_connections(owner TEXT PRIMARY KEY,status TEXT); INSERT INTO google_calendar_connections VALUES('${OWNER}','connected')`);
  const sends=[],grants=[],models=[],syncs=[];
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,WHATSAPP_PHONE_NUMBER_ID:'business',TEAM_CONVERSATION_LEADER:'melodi',TEAM_AUTONOMY_ENABLED:'true',
    ASSISTANT_NATIVE_AI_ENABLED:'true',ASSISTANT_SEMANTIC_CALENDAR_ENABLED:'true',TIME_ZONE:'America/Santo_Domingo',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),
    GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',MELODI_JOBS:{send:async value=>syncs.push(value)},
    AI:{run:async(model,input)=>{models.push(model);const payload=JSON.parse(input.messages.at(-1).content);assert.equal(payload.message,REQUEST);
      assert.equal(payload.oldSession.title,'Old reminder');return{response:readFileSync(new URL('./fixtures/semantic-calendar-2026-10-26.json',import.meta.url),'utf8')};}}};
  const services=ownerAutonomyServices(env),sealed=await services.encrypt({title:'Old reminder'});
  await db.prepare('INSERT INTO wa_owner_session(owner_phone,session_type,encrypted_state,state_iv,updated_at) VALUES(?,?,?,?,?)')
    .bind(OWNER,'await_reminder_time',sealed.encrypted,sealed.iv,'2026-10-26T03:23:11.574Z').run();
  const raw=async(_env,phone,body)=>{assert.equal(phone,OWNER);sends.push(body);return{status:'sent',messageId:'final-message'};};
  const payload={entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:[{id:'semantic-owner-original',from:OWNER,type:'text',timestamp:String(Date.parse(REFERENCE)/1000),text:{body:REQUEST}}]}}]}]};
  const run=(scoped,envelope)=>{const message=envelope.entry[0].changes[0].value.messages[0];return handleOwnerMessage(scoped,{phone:OWNER,message,incoming:REQUEST,markTyping:async()=>{},
    sendText:(current,phone,body,opts)=>current.WHATSAPP_PROCESSING_SCOPE.reply(phone,body,opts),configureTeam:async command=>{grants.push(command);return{allowed:true};},
    addReminder:async()=>assert.fail('must persist atomically')});};
  assert.equal((await processWhatsAppEnvelope(env,payload,run,raw,services)).status,'done');
  assert.equal((await processWhatsAppEnvelope(env,payload,run,raw,services)).status,'done');
  const rows=db.sql.prepare('SELECT title,event_at FROM melodi_calendar_events ORDER BY event_at').all();
  assert.deepEqual(rows.map(e=>e.event_at),['2026-10-26T13:10:00.000Z','2026-10-26T15:30:00.000Z','2026-10-26T16:00:00.000Z','2026-11-01T09:00:00.000Z']);
  assert.ok(rows[1].title.includes('(7 tomas)'));assert.equal(models.length,2);assert.ok(models.every(model=>/deepseek-v4-pro/.test(model)));
  assert.equal(sends.length,1);assert.doesNotMatch(sends[0],/¿|Melodi:|Melodi|Alfredo/);
  assert.equal(grants.filter(c=>c.action==='authorize_skill').length,1);assert.ok(syncs.some(c=>c.type==='calendar_sync'));
});
