import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinanceD1 } from './finance-fixture.js';
import { handleOwnerMessage,ownerAutonomyServices } from '../owner-features.js';
import { processWhatsAppEnvelope } from '../whatsapp-request-scope.js';

const OWNER='18095550101',REFERENCE='2026-10-26T03:22:00Z',NOW='2026-10-26T04:01:00Z';
const REQUEST='Melodi, mañana me toca correr 7:00 a.m e ir al boxeo a las 9:10 a.m. Recuérdamelo. Mañana empieza el Hackaton de Meta, el live iniciará a las 12 p.m, recuérdame también decirle esto a Alfredo a las 11:30 a.m “Primerísimo primer plano (ojos), plano detalle número en la espalda (7 tomas)” correspondiente a la grabación que tenemos el domingo 1 de noviembre';
function fixture(){
  const db=new FinanceD1();for(const file of ['schema.sql','melodi-team-coordination.sql','story-campaign.sql','story-approval.sql'])db.sql.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
  db.sql.exec(`CREATE TABLE google_calendar_connections(owner TEXT PRIMARY KEY,status TEXT); INSERT INTO google_calendar_connections VALUES('${OWNER}','connected')`);
  const sends=[],grants=[],syncs=[];
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,WHATSAPP_PHONE_NUMBER_ID:'business',TEAM_CONVERSATION_LEADER:'melodi',
    TEAM_AUTONOMY_ENABLED:'true',ASSISTANT_NATIVE_AI_ENABLED:'true',TIME_ZONE:'America/Santo_Domingo',MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),
    GOOGLE_CLIENT_ID:'synthetic-oauth-client',GOOGLE_CLIENT_SECRET:'synthetic-oauth-secret',
    AI:{run:async()=>assert.fail('The literal message must not require a model')},MELODI_JOBS:{send:async value=>syncs.push(value)}};
  const raw=async(_env,phone,body)=>{assert.equal(phone,OWNER);sends.push(body);return{status:'sent',messageId:'test-final-'+sends.length};};
  const run=async(scoped,payload)=>{
    const message=payload.entry[0].changes[0].value.messages[0];
    return handleOwnerMessage(scoped,{phone:OWNER,message,incoming:message.text.body,markTyping:async()=>{},
      sendText:(current,phone,body,opts)=>current.WHATSAPP_PROCESSING_SCOPE ? current.WHATSAPP_PROCESSING_SCOPE.reply(phone,body,opts) : raw(current,phone,body),
      addReminder:async()=>assert.fail('must use an atomic batch'),configureTeam:async command=>{grants.push(command);return{allowed:true};}});
  };
  const envelope={entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:[{id:'reported-mixed-message',from:OWNER,type:'text',timestamp:String(Date.parse(REFERENCE)/1000),text:{body:REQUEST}}]}}]}]};
  return{db,env,sends,grants,syncs,envelope,send:()=>processWhatsAppEnvelope(env,envelope,run,raw,ownerAutonomyServices(env))};
}

test('actual owner route no longer overwrites supplied tasks as unresolved history and replays no effects',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(NOW)});const h=fixture();
  assert.equal((await h.send()).status,'done');assert.equal((await h.send()).status,'done');
  const rows=h.db.sql.prepare('SELECT title,event_at FROM melodi_calendar_events ORDER BY event_at').all();
  assert.equal(rows.length,4);assert.deepEqual(rows.map(row=>row.event_at),['2026-10-26T11:00:00.000Z','2026-10-26T13:10:00.000Z','2026-10-26T15:30:00.000Z','2026-10-26T16:00:00.000Z']);
  assert.match(rows[2].title,/Primerísimo primer plano \(ojos\), plano detalle número en la espalda \(7 tomas\)/);
  assert.equal(h.sends.length,1);assert.doesNotMatch(h.sends[0],/¿Qué tarea concreta|Melodi|Melodi:|te envié|he enviado/);
  assert.equal(h.grants.filter(row=>row.action==='authorize_skill').length,1);assert.ok(h.syncs.some(row=>row.type==='calendar_sync'));
});

test('processing after a requested hour does not roll tomorrow forward or silently drop part of the batch',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-26T11:10:00Z')});const h=fixture();
  await h.send();assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM melodi_calendar_events').get().n,0);
  assert.match(h.sends[0],/Correr.*ya pasó/);assert.equal(h.syncs.length,0);
});
