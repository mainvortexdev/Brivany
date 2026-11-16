import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FinanceD1} from './finance-fixture.js';
import {ownerAutonomyServices} from '../owner-features.js';
import {parseAgendaRequest} from '../agenda-request.js';
import {createRoutineStore} from '../melodi-routines.js';
import {repairRequestedAgenda,AGENDA_REPAIR_SESSION_AT,AGENDA_REPAIR_CONFIRMATION} from '../agenda-request-repair.js';

const OWNER='18495205246',NOW=Date.parse('2026-10-21T10:15:00Z');
const TEXT='Oye Melodi, agenda lo siguiente, ponlo en días separados para trabajar en ello: Terminar toda la app de Vetsa Intelligence, Terminar Cognira Edits, Mejorar la integración y entorno de Vetsa. Desplaza lo que tengo para hoy a mañana, quiero tener el día un poco más suave, iré al boxeo a las 9, a las 11 iré a trabajar al apartamento de Alfredo, recuérdame a las 2:40 p.m buscar a mi hermana a la escuela y que tengo que volver a las 3:40 pm al trabajo';
async function fixture() {
  const db=new FinanceD1();
  for(const file of ['schema.sql','melodi-team-coordination.sql','melodi-routines.sql'])db.sql.exec(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
  db.sql.exec(`CREATE TABLE wa_message_processing(owner TEXT,message_id TEXT,status TEXT,response_encrypted TEXT,response_iv TEXT)`);
  const queue=[];
  const env={VETSA_CLOUD:db,OWNER_WHATSAPP_NUMBER:OWNER,TIME_ZONE:'America/Santo_Domingo',
    MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,17).toString('base64'),REQUESTED_AGENDA_REPAIR_REV:'2026-10-21.1',
    MELODI_JOBS:{async send(body){queue.push(body);}}};
  const services=ownerAutonomyServices(env),routines=createRoutineStore(db,{...services,now:()=>NOW});
  for(const [title,hour] of [['Ir al boxeo','09:00'],['Trabajar en apartamento de Alfredo','11:00'],['Volver al trabajo','15:40']])
    await routines.create({owner:OWNER,agent:'melodi',eventKey:title,title,hour,kind:'recurring_reminder',frequency:'weekly',weekdays:[1,2,3,4,5,6],channel:'whatsapp'});
  const state={reason:'non_personal_activities',directive:parseAgendaRequest(TEXT,{now:AGENDA_REPAIR_SESSION_AT,timeZone:env.TIME_ZONE})};
  const sealed=await services.encrypt(JSON.stringify(state));
  db.sql.prepare('INSERT INTO wa_owner_session VALUES(?,?,?,?,?)').run(OWNER,'await_agenda_plan',sealed.encrypted,sealed.iv,AGENDA_REPAIR_SESSION_AT);
  const response=await services.encrypt(JSON.stringify({body:'Hay dos actividades a la misma hora. Necesito que elijas cuál cambiar antes de mover la agenda.',agent:'melodi'}));
  db.sql.prepare('INSERT INTO wa_message_processing VALUES(?,?,?,?,?)').run(OWNER,AGENDA_REPAIR_CONFIRMATION,'done',response.encrypted,response.iv);
  db.sql.prepare(`INSERT INTO melodi_calendar_events(id,phone,title,event_at,event_type,assigned_agent,created_at,updated_at)
    VALUES('integration',?,'implementar nueva conexión al ecosistema Vetsa (vinculación con GPT)','2026-10-21T13:00:00.000Z','REMINDER','melodi',?,?)`).run(OWNER,AGENDA_REPAIR_SESSION_AT,AGENDA_REPAIR_SESSION_AT);
  const options={services,authorize:async()=>({allowed:true}),now:NOW};
  const events=()=>db.sql.prepare('SELECT id,title,event_at FROM melodi_calendar_events ORDER BY id').all();
  return{env,db,services,options,events,queue};
}

test('the exact confirmed owner request is repaired once without another message or model',async()=>{
  const f=await fixture(),result=await repairRequestedAgenda(f.env,f.options);
  assert.equal(result.status,'repaired');assert.equal(result.created,4);assert.equal(result.moved,1);
  assert.equal(f.events().find(item=>item.id==='integration').event_at,'2026-10-22T13:30:00.000Z');
  assert.equal(f.events().length,5);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_owner_session').get().n,0);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_melodi_delivery_notices').get().n,1);
  assert.equal((await repairRequestedAgenda(f.env,f.options)).status,'already_repaired');
  assert.equal(f.events().length,5);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_melodi_delivery_notices').get().n,1);
});

test('a crash after the atomic commit reuses its frozen receipt and cannot reschedule or duplicate work',async()=>{
  const f=await fixture(),original=f.db.prepare.bind(f.db);let failed=false;
  f.db.prepare=sql=>{
    if(!failed && sql.startsWith('CREATE TABLE IF NOT EXISTS wa_melodi_delivery_notices')){failed=true;throw Error('synthetic_post_commit_crash');}
    return original(sql);
  };
  await assert.rejects(repairRequestedAgenda(f.env,f.options),/synthetic_post_commit_crash/);
  const committed=f.events();assert.equal(committed.length,5);
  f.db.prepare=original;
  assert.equal((await repairRequestedAgenda(f.env,f.options)).status,'repaired');
  assert.deepEqual(f.events(),committed);assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM wa_melodi_delivery_notices').get().n,1);
});

test('a newer pending request, a different reply or revoked authority cannot be repaired',async()=>{
  for(const condition of ['new_session','reply_mismatch','denied']) {
    const f=await fixture();
    if(condition==='new_session')f.db.sql.prepare('UPDATE wa_owner_session SET updated_at=?').run('2026-10-21T10:00:00Z');
    if(condition==='reply_mismatch'){
      const other=await f.services.encrypt(JSON.stringify({body:'De acuerdo, cancelo el cambio.'}));
      f.db.sql.prepare('UPDATE wa_message_processing SET response_encrypted=?,response_iv=?').run(other.encrypted,other.iv);
    }
    if(condition==='denied')f.options.authorize=async()=>({allowed:false});
    const before=f.events();const result=await repairRequestedAgenda(f.env,f.options);
    assert.ok(['source_changed','source_mismatch','approval_required'].includes(result.status));assert.deepEqual(f.events(),before);
  }
});

test('a cancellation while preparing is covered by the same atomic snapshot guard',async()=>{
  const f=await fixture(),encrypt=f.services.encrypt;let cancel=true;
  f.services.encrypt=async value=>{
    const sealed=await encrypt(value);
    if(cancel && String(value).includes('"snapshot"')) {cancel=false;f.db.sql.prepare('DELETE FROM wa_owner_session WHERE owner_phone=?').run(OWNER);}
    return sealed;
  };
  const before=f.events();assert.equal((await repairRequestedAgenda(f.env,f.options)).status,'unconfirmed');
  assert.deepEqual(f.events(),before);
});
