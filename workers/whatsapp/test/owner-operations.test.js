import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { financeFixture,OWNER,OTHER,NOW } from './finance-fixture.js';
import { executeOwnerOperation,validateOwnerOperationInput,ownerOperationTools } from '../owner-operations.js';

const ctx=env=>({env,phone:OWNER,agent:'melodi'});
const expense={action:'create',entries:[{kind:'transaction',data:{name:'Almuerzo',amount:50000,currency:'DOP',date:'2026-10-08',direction:'expense'}}]};
test('semantic financial operation writes the real encrypted store once and reports observed totals',async()=>{
  const h=await financeFixture(),options={services:h.services,requestKey:'expense-semantic-1',now:NOW};
  for(let i=0;i<2;i++){
    const result=await executeOwnerOperation('finance.record',expense,ctx(h.env),options);
    assert.equal(result.state,'committed');assert.equal(result.receipt.verified,true);assert.doesNotMatch(result.messages[0],/^Melodi:/);
  }
  assert.equal((await h.store.list(OWNER)).length,1);
  await assert.rejects(()=>executeOwnerOperation('finance.record',{...expense,entries:[{...expense.entries[0],data:{...expense.entries[0].data,amount:60000}}]},ctx(h.env),options),/request_key_reused/);
  assert.doesNotMatch(JSON.stringify(h.db.sql.prepare('SELECT * FROM wa_finance_records').all()),/Almuerzo|DOP/);
  const read=await executeOwnerOperation('finance.read',{month:'2026-10',section:'transactions'},ctx(h.env),{...options,requestKey:'read-1'});
  assert.equal(read.state,'observed');assert.match(read.data.report,/DOP 500.00/);assert.equal(read.data.recordCount,1);
});
test('typed financial validation rejects invalid cents, mismatched actions, hidden IDs and incomplete batches before writing',async()=>{
  const h=await financeFixture();
  const bad=[{...expense,entries:[...expense.entries,{kind:'transaction',data:{...expense.entries[0].data,amount:1.2}}]},
    {...expense,entries:[{kind:'transaction',data:{...expense.entries[0].data,targetId:'injected'}}]},
    {action:'status',reference:'F001'}, {action:'correct',reference:'F001'},
    {action:'contribute',kind:'contribution',reference:'F001',amount:100,currency:'DOP',date:'2026-02-30'},
    {...expense,reference:'F001'}];
  for(const value of bad)await assert.rejects(()=>executeOwnerOperation('finance.record',value,ctx(h.env),{services:h.services,requestKey:'bad',now:NOW}));
  assert.equal((await h.store.list(OWNER)).length,0);
  assert.throws(()=>validateOwnerOperationInput('finance.read',{month:'2026-13'}));
});
test('unknown linked account causes a concrete waiting response with no claimed financial mutation',async()=>{
  const h=await financeFixture();
  const result=await executeOwnerOperation('finance.record',{...expense,entries:[{...expense.entries[0],data:{...expense.entries[0].data,account:'Banco inexistente'}}]},ctx(h.env),{services:h.services,requestKey:'missing-account',now:NOW});
  assert.equal(result.state,'observed');assert.equal(result.data.status,'waiting');assert.match(result.data.question,/No encontré/);
  assert.equal((await h.store.list(OWNER)).length,0);
});
test('financial corrections and status changes use reference ledger and preserve replay history',async()=>{
  const h=await financeFixture(),run=(input,key)=>executeOwnerOperation('finance.record',input,ctx(h.env),{services:h.services,requestKey:key,now:NOW});
  await run(expense,'initial');const row=(await h.store.list(OWNER))[0];
  for(let i=0;i<2;i++)assert.equal((await run({action:'correct',reference:row.reference,amount:60000},'correction')).state,'committed');
  assert.equal((await h.store.list(OWNER))[0].data.amount,60000);
  assert.equal((await run({action:'status',reference:row.reference,status:'void'},'cancel')).state,'committed');
  assert.equal((await h.store.list(OWNER))[0].status,'void');
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM wa_finance_changes').get().n,2);
});
test('monthly subscription reminders remain typed, durable and separate from paid expenses',async()=>{
  const h=await financeFixture(),input={action:'create',entries:[{kind:'subscription',data:{name:'Google One',amount:199,currency:'USD',frequency:'monthly'}}],routine:{frequency:'monthly',dayOfMonth:7,hour:'09:00'}};
  assert.deepEqual(validateOwnerOperationInput('finance.record',validateOwnerOperationInput('finance.record',input)),validateOwnerOperationInput('finance.record',input));
  const result=await executeOwnerOperation('finance.record',input,ctx(h.env),{services:h.services,requestKey:'subscription',now:NOW});
  assert.equal(result.state,'committed');assert.equal((await h.routines.list(OWNER)).length,1);assert.match(result.messages[0],/cuota registrada, sin registrar un pago/);
});
async function usageFixture(){const h=await financeFixture();h.db.sql.exec(readFileSync(new URL('../cognira-reports.sql',import.meta.url),'utf8'));
  h.db.sql.exec("CREATE TABLE cognira_daily_activity(user_id TEXT,activity_day TEXT,edition TEXT,requests INTEGER); INSERT INTO cognira_daily_activity VALUES('private-user-1','2026-10-09','full',9),('private-user-2','2026-10-08','beta',4)");return h;}
test('Cognira statistics use actual aggregate activity and never disclose customer identities',async()=>{
  const h=await usageFixture(),result=await executeOwnerOperation('usage.read',{},ctx(h.env),{requestKey:'usage-read',now:NOW});
  assert.equal(result.state,'observed');assert.match(result.data.report,/hoy 1/);assert.match(result.data.report,/hoy: 9/);assert.doesNotMatch(result.data.report,/private-user/);
});
test('Cognira daily scheduling uses stable IDs, preserves local hour and readback, with no external send',async()=>{
  const h=await usageFixture(),input={channel:'email',email:'owner@example.test',timeZone:'America/Santo_Domingo',schedules:[{startAt:'2026-10-10T13:00:00Z',recurring:true},{startAt:'2026-10-10T22:00:00Z',recurring:false}]};
  for(let i=0;i<2;i++){
    const result=await executeOwnerOperation('usage.schedule',input,ctx(h.env),{requestKey:'usage-two',now:NOW});
    assert.equal(result.state,'committed');assert.deepEqual(result.data.schedules.map(row=>row.local_hour),['09:00','18:00']);
    assert.doesNotMatch(result.messages[0],/envié|enviado/i);
  }
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM cognira_report_schedules').get().n,2);
  const bad={...input,schedules:[{startAt:'2026-10-10T14:00:00Z',recurring:true}]};
  await assert.rejects(()=>executeOwnerOperation('usage.schedule',bad,ctx(h.env),{requestKey:'usage-two',now:NOW}),/readback_mismatch/);
});
test('scheduled usage cancellation is owner scoped and can select observed IDs',async()=>{
  const h=await usageFixture(),input={channel:'whatsapp',timeZone:'America/Santo_Domingo',schedules:[{startAt:'2026-10-10T13:00:00Z',recurring:true}]};
  const first=await executeOwnerOperation('usage.schedule',input,ctx(h.env),{requestKey:'usage-one',now:NOW});
  h.db.sql.prepare("INSERT INTO cognira_report_schedules(id,owner_phone,channel,target,next_at,time_zone,local_hour) VALUES('other',?,'whatsapp',?,'2026-10-10T13:00:00Z','America/Santo_Domingo','09:00')").run(OTHER,OTHER);
  const result=await executeOwnerOperation('usage.cancel',{ids:[first.data.schedules[0].id]},ctx(h.env),{requestKey:'cancel-1',now:NOW});
  assert.equal(result.state,'committed');assert.equal(result.data.removed,1);
  assert.equal(h.db.sql.prepare('SELECT owner_phone FROM cognira_report_schedules').get().owner_phone,OTHER);
});
test('operations enforce owner scope, explicit email target and future schedules before effects',async()=>{
  const h=await usageFixture();
  await assert.rejects(()=>executeOwnerOperation('usage.read',{}, {...ctx(h.env),phone:OTHER},{requestKey:'forbidden',now:NOW}),/authenticated/);
  assert.throws(()=>validateOwnerOperationInput('usage.schedule',{channel:'email',timeZone:'America/Santo_Domingo',schedules:[{startAt:'2026-10-10T13:00:00Z',recurring:false}]}),/target/);
  const result=await executeOwnerOperation('usage.schedule',{channel:'whatsapp',timeZone:'America/Santo_Domingo',schedules:[{startAt:'2026-10-08T13:00:00Z',recurring:false}]},ctx(h.env),{requestKey:'past',now:NOW});
  assert.equal(result.state,'observed');assert.equal(result.data.status,'waiting');assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM cognira_report_schedules').get().n,0);
  assert.equal(Object.keys(ownerOperationTools).length,5);
});
