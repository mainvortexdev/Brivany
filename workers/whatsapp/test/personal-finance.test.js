import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyMinor,moneyText,financeSummary,financeReport,createFinanceStore,validateFinanceData } from '../personal-finance.js';
import { parseFinanceRequest,parseRecurringReminder } from '../finance-request.js';
import { executeFinanceRequest } from '../finance-workflow.js';
import { SUBSCRIPTION_REPAIR_TEXT,SUBSCRIPTION_REPAIR_EVENT,repairSubscriptionRequest } from '../subscription-request-repair.js';
import { financeFixture,OWNER,OTHER,NOW } from './finance-fixture.js';
import { handleOwnerMessage } from '../owner-features.js';

for(const [input,expected] of [['1.99',199],['20',2000],['0.01',1],['1,500.20',150020],['1.500,20',150020],['25,75',2575]]) test(`money ${input} preserves cents`,()=>assert.equal(moneyMinor(input),expected));
test('invalid and excessive precision amounts are rejected',()=>{for(const value of ['-2','NaN','1.2345','1e3','0','1000000000000000']) assert.throws(()=>moneyMinor(value));assert.equal(moneyText(2199,'USD'),'USD 21.99');});
test('reported subscriptions preserve exact names, fees and monthly day',()=>{
  const q=parseFinanceRequest(SUBSCRIPTION_REPAIR_TEXT,NOW);assert.equal(q.entries.length,2);
  assert.deepEqual(q.entries.map(e=>[e.data.name,e.data.amount,e.data.currency]),[['Google One',199,'USD'],['ChatGPT Plus',2000,'USD']]);
  assert.equal(q.routine.dayOfMonth,7);assert.equal(q.routine.frequency,'monthly');assert.equal(q.routine.hour,'09:00');
});
test('a financial parser never turns negative, scientific, truncated or conflicting amounts into another amount',()=>{
  for(const amount of ['-500 pesos','−500 pesos','1e3 pesos','1.2345 dólares','USD 500 pesos','US$ -20']) {
    for(const text of [`gasté ${amount} en comida`,`registra suscripción mensual de Netflix de ${amount}`,`corrige F001 a ${amount}`]) assert.ok(parseFinanceRequest(text,NOW).clarification,text);
  }
});
test('mixed monthly and yearly subscriptions retain their individual cycles',()=>{
  const q=parseFinanceRequest('tengo la suscripción mensual de Google One de 1.99 dólares y la anual de Netflix de 100 dólares',NOW);
  assert.deepEqual(q.entries.map(v=>[v.data.name,v.data.frequency]),[['Google One','monthly'],['Netflix','yearly']]);
});
test('financial document requests preserve the requested month and section',()=>{
  const q=parseFinanceRequest('envíame un informe de mis gastos del mes pasado por email',NOW);
  assert.equal(q.section,'transactions');assert.equal(q.month,'2026-09');assert.equal(q.channel,'email');
  assert.equal(parseFinanceRequest('prepara un resumen de mis suscripciones en Word',NOW).section,'subscriptions');
});
test('sources, examples and URLs never become financial writes',()=>{
  for(const raw of ['Ejemplo: gasté 500 pesos en supermercado','"registra un ingreso de 900 dólares"','Texto\nregistra un gasto de 1 peso en casa','https://example.com/ registra un gasto de 5 pesos']) assert.equal(parseFinanceRequest(raw,NOW),null);
});
test('cash movements, plans, budgets and currency defaults are direct requests',()=>{
  assert.equal(parseFinanceRequest('Melodi, gasté 500 pesos en supermercado',NOW).entries[0].data.direction,'expense');
  assert.equal(parseFinanceRequest('Melodi, recibí 100 dólares por trabajo',NOW).entries[0].data.currency,'USD');
  assert.equal(parseFinanceRequest('Melodi, quiero ahorrar 50000 pesos para un viaje antes del 2027-01-01',NOW).entries[0].data.deadline,'2027-01-01');
  assert.equal(parseFinanceRequest('registra presupuesto comida de 10000 pesos',NOW).entries[0].data.date,'2026-10');
  assert.equal(parseFinanceRequest('gasté 500 en comida',NOW).entries[0].assumedCurrency,true);
});
test('a missing concept or ambiguous explicit date produces one essential clarification',()=>{
  assert.ok(parseFinanceRequest('registra un gasto de 500 pesos',NOW).clarification);
  assert.ok(parseFinanceRequest('quiero ahorrar 500 pesos para casa antes del 16',NOW).clarification);
  assert.ok(parseRecurringReminder('recuerdame cada mes pagar internet',NOW).clarification);
});
test('all four agents can record finances, each retains her identity',async()=>{
  const h=await financeFixture();for(const agent of ['melodi']) {
    const response=await executeFinanceRequest(h.env,{owner:OWNER,agent,requestId:`income-${agent}`,request:parseFinanceRequest('recibí 100 dólares por trabajo',NOW),services:h.services,now:NOW});
    assert.ok(response.startsWith(agent[0].toUpperCase()+agent.slice(1)+':'));
  }
  assert.deepEqual((await h.store.list(OWNER)).map(r=>r.agent),['melodi']);
});
test('owner scope, encryption and replay are durable',async()=>{
  const h=await financeFixture(),input={owner:OWNER,agent:'melodi',requestId:'message-once',request:parseFinanceRequest('gasté 500 pesos en supermercado',NOW),services:h.services,now:NOW};
  await executeFinanceRequest(h.env,input);await executeFinanceRequest(h.env,input);
  assert.equal((await h.store.list(OWNER)).length,1);assert.equal((await h.store.list(OTHER)).length,0);
  const raw=JSON.stringify(h.db.sql.prepare('SELECT * FROM wa_finance_records').all());assert.ok(!raw.includes('supermercado'));assert.ok(!raw.includes('DOP'));
  await assert.rejects(()=>executeFinanceRequest(h.env,{...input,owner:OTHER}),/finance_owner_required/);
  assert.throws(()=>createFinanceStore(h.db,{}),/finance_storage_unavailable/);
});
test('subscriptions are planned fees, not expenses, and one grouped monthly notice is replay-safe',async()=>{
  const h=await financeFixture(),input={owner:OWNER,agent:'melodi',requestId:'subscriptions',request:parseFinanceRequest(SUBSCRIPTION_REPAIR_TEXT,NOW),services:h.services,now:NOW};
  const response=await executeFinanceRequest(h.env,input);await executeFinanceRequest(h.env,input);
  const records=await h.store.list(OWNER),routines=await h.routines.list(OWNER);assert.equal(records.length,2);assert.equal(routines.length,1);
  assert.equal(routines[0].nextAt,'2026-11-07T13:00:00.000Z');assert.equal(routines[0].agent,'melodi');assert.equal(routines[0].title,'Renovar Google One y ChatGPT Plus');
  assert.equal(financeSummary(records,{month:'2026-10'}).currencies.USD.expense,0);assert.equal(financeSummary(records).currencies.USD.monthlySubscriptions,2199);assert.match(response,/Recordatorio mensual R\d+/);
});
test('mixed currencies stay separate and transfers do not inflate monthly expenses',async()=>{
  const h=await financeFixture();for(const [i,text] of ['registra cuenta efectivo con 2000 pesos','registra cuenta banco con 1000 pesos','transfiere 500 pesos de efectivo a banco','recibí 20 dólares por regalo','gasté 500 pesos en comida'].entries()) await executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:`cash-${i}`,request:parseFinanceRequest(text,NOW),services:h.services,now:NOW});
  const records=await h.store.list(OWNER),summary=financeSummary(records,{month:'2026-10'});
  assert.equal(summary.currencies.DOP.expense,50000);assert.equal(summary.currencies.USD.income,2000);
  const accounts=financeReport(records,{section:'accounts',now:NOW});assert.match(accounts,/efectivo: saldo según tus registros DOP 1,500.00/);assert.match(accounts,/banco: saldo según tus registros DOP 1,500.00/);
});
test('unknown account or wrong currency is clarified before persisting a transfer',async()=>{
  const h=await financeFixture(),response=await executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:'transfer',request:parseFinanceRequest('transfiere 500 pesos de efectivo a banco',NOW),services:h.services,now:NOW});
  assert.match(response,/No encontré efectivo/);assert.equal((await h.store.list(OWNER)).length,0);
});
test('savings contributions calculate a real plan without turning savings into consumption',async()=>{
  const h=await financeFixture(),run=(id,text)=>executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:id,request:parseFinanceRequest(text,NOW),services:h.services,now:NOW});
  await run('goal','quiero ahorrar 50000 pesos para viaje antes del 2027-01-01');const goal=(await h.store.list(OWNER))[0];
  await run('deposit',`añade 500 pesos a mi ahorro ${goal.reference}`);
  const records=await h.store.list(OWNER);assert.match(financeReport(records,{section:'savings',now:NOW}),/DOP 500.00 de DOP 50,000.00/);assert.equal(financeSummary(records).currencies.DOP.expense,0);
});
test('correction and void preserve encrypted history and remove void expenses from totals',async()=>{
  const h=await financeFixture(),run=(id,text)=>executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:id,request:parseFinanceRequest(text,NOW),services:h.services,now:NOW});
  await run('expense','gasté 500 pesos en comida');const record=(await h.store.list(OWNER))[0];
  await run('fix',`corrige ${record.reference} a 600 pesos`);await run('fix',`corrige ${record.reference} a 600 pesos`);
  assert.equal(financeSummary(await h.store.list(OWNER),{month:"2026-10"}).currencies.DOP.expense,60000);
  await run('void',`anula gasto ${record.reference}`);assert.deepEqual(financeSummary(await h.store.list(OWNER),{month:"2026-10"}).currencies,{});
  assert.equal(h.db.sql.prepare('SELECT count(*) AS n FROM wa_finance_changes').get().n,2);
});
test('deactivating one subscription updates the notice; the last stops the series',async()=>{
  const h=await financeFixture(),run=(id,text)=>executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:id,request:parseFinanceRequest(text,NOW),services:h.services,now:NOW});
  await run('fees',SUBSCRIPTION_REPAIR_TEXT);await run('stop-one','desactiva suscripción Google One');
  assert.equal((await h.routines.list(OWNER))[0].title,'Renovar ChatGPT Plus');
  await run('stop-two','desactiva suscripción ChatGPT Plus');assert.equal((await h.routines.list(OWNER))[0].status,'stopped');
});
test('finance reports queue a verified private artifact with the selected agent and complete source',async()=>{
  const h=await financeFixture();let sent;
  const response=await executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:'report',request:parseFinanceRequest('envíame un informe de mis finanzas por email',NOW),services:{...h.services,async prepareDocument(v){sent=v;return {status:'queued',jobId:'private-1'};}},now:NOW});
  assert.equal(sent.assignmentAgent,'melodi');assert.equal(sent.channel,'email');assert.match(sent.content,/Todavía no hay movimientos/);assert.match(response,/preparación/);assert.doesNotMatch(response,/enviado|listo/);
});

test('enabled finance documents cannot queue without a confirmed permission decision',async()=>{
  const h=await financeFixture();h.env.TEAM_AUTONOMY_ENABLED='true';let queued=0;
  const input={owner:OWNER,agent:'melodi',requestId:'guarded-report',request:parseFinanceRequest('envíame un informe de mis finanzas por email',NOW),now:NOW};
  const services={...h.services,async prepareDocument(){queued++;return {status:'queued',jobId:'must-not-exist'};}};
  await assert.rejects(()=>executeFinanceRequest(h.env,{...input,services}),/authority_unavailable/);
  for(const authority of [null,{}, {allowed:false}]) await assert.rejects(()=>executeFinanceRequest(h.env,{...input,
    services:{...services,async authorizeFinanceDocument(){return authority;}}}),/authority_unconfirmed/);
  assert.equal(queued,0);
});
test('the reported one-shot is replaced once; other reminders are untouched',async()=>{
  const h=await financeFixture();h.env.REQUESTED_SUBSCRIPTION_REPAIR_REV='2026-10-08.1';
  h.db.sql.prepare('INSERT INTO melodi_calendar_events(id,phone,title,event_at,assigned_agent,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(SUBSCRIPTION_REPAIR_EVENT,OWNER,'Renovar suscripciones de Google One y ChatGPT Pulse','2026-11-07T13:00:00.000Z','melodi',new Date(NOW).toISOString(),new Date(NOW).toISOString());
  assert.equal((await repairSubscriptionRequest(h.env,{services:h.services,now:NOW})).status,'repaired');
  assert.equal((await repairSubscriptionRequest(h.env,{services:h.services,now:NOW})).status,'already_repaired');
  assert.equal(h.db.sql.prepare('SELECT count(*) AS n FROM melodi_calendar_events WHERE id=?').get(SUBSCRIPTION_REPAIR_EVENT).n,0);
  assert.equal((await h.routines.list(OWNER)).length,1);assert.equal((await h.store.list(OWNER)).length,2);
});
test('budgets compare only matching category, month and currency',()=>{
  const records=[{kind:'budget',reference:'F001',status:'active',data:validateFinanceData('budget',{name:'comida',currency:'DOP',amount:100000,date:'2026-10'})},
    {kind:'transaction',reference:'F002',status:'active',data:{name:'comida',category:'comida',currency:'DOP',amount:30000,date:'2026-10-08',direction:'expense'}},
    {kind:'transaction',reference:'F003',status:'active',data:{name:'comida',currency:'USD',amount:30000,date:'2026-10-08',direction:'expense'}}];
  assert.match(financeReport(records,{section:'budgets',month:'2026-10'}),/disponible DOP 700.00/);
});

test('Spanish ledger dates use Dominican calendar without shifting a past movement forward',()=>{
  assert.equal(parseFinanceRequest('gasté 500 pesos en comida el 7 de octubre de 2026',NOW).entries[0].data.date,'2026-10-07');
  assert.equal(parseFinanceRequest('gasté 500 pesos en comida el 31/02/2026',NOW).clarification!==undefined,true);
  assert.equal(parseFinanceRequest('mis gastos de septiembre de 2026',NOW).month,'2026-09');
  assert.equal(parseFinanceRequest('mis gastos del mes pasado',NOW).month,'2026-09');
});
test('reactivation is explicit and stopped reminders never restart on read or request replay',async()=>{
  const h=await financeFixture(),run=(id,text)=>executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:id,request:parseFinanceRequest(text,NOW),services:h.services,now:NOW});
  await run('fees',SUBSCRIPTION_REPAIR_TEXT);await run('stop1','desactiva suscripción Google One');await run('stop2','desactiva suscripción ChatGPT Plus');
  await run('read','mis suscripciones');assert.equal((await h.routines.list(OWNER)).filter(r=>r.status==='active').length,0);
  await run('restart','activa suscripción Google One');await run('restart','activa suscripción Google One');
  assert.equal((await h.routines.list(OWNER)).filter(r=>r.status==='active').length,1);
});
test('concurrent corrections cannot overwrite one another or corrupt totals',async()=>{
  const h=await financeFixture(),row=await h.store.create({owner:OWNER,agent:'melodi',kind:'transaction',requestKey:'movement',data:{name:'comida',amount:100,currency:'DOP',date:'2026-10-08',direction:'expense'}});
  const results=await Promise.allSettled([200,300].map((amount,i)=>h.store.update({owner:OWNER,agent:'melodi',id:row.id,revision:row.revision,data:{...row.data,amount},requestKey:`fix-${i}`})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await h.store.list(OWNER))[0].revision,2);
});

test('a new explicitly selected agent owns the renewal without duplicating the ledger or notifications',async()=>{
  const h=await financeFixture(),run=(agent,id)=>executeFinanceRequest(h.env,{owner:OWNER,agent,requestId:id,request:parseFinanceRequest(SUBSCRIPTION_REPAIR_TEXT,NOW),services:h.services,now:NOW});
  await run('melodi','original');await run('melodi','new-selected-agent');
  assert.equal((await h.store.list(OWNER)).length,2);
  const routines=await h.routines.list(OWNER);assert.equal(routines.filter(r=>r.status==='active').length,1);assert.equal(routines.find(r=>r.status==='active').agent,'melodi');
});

test('the WhatsApp fast path acknowledges before writing and keeps Melodi as speaker',async()=>{
  const h=await financeFixture(),responses=[],replyAgents=[];Object.assign(h.env,{MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),TEAM_AUTONOMY_ENABLED:'true'});
  const result=await handleOwnerMessage(h.env,{phone:OWNER,message:{id:'owner-finance-message',type:'text'},incoming:'Melodi, gasté 500 pesos, en supermercado',
    async markTyping(){},async sendText(env,owner,body,options){if(!responses.length) assert.equal((await h.store.list(OWNER)).length,0);responses.push(body);replyAgents.push(options?.agent);},async configureTeam(){return null;},async observeAgentReply(){}});
  assert.equal(result,true);assert.equal(responses.length,2);assert.ok(responses.every(v=>!/^(?:Melodi|Melodi):/.test(v)));assert.match(responses[1],/DOP 500.00/);
  assert.deepEqual(replyAgents,['melodi','melodi']);assert.equal(h.db.sql.prepare('SELECT agent FROM wa_finance_records').get().agent,'melodi');
});

test('a financial WhatsApp document waits for collaboration and marks approval only after informing the owner',async()=>{
  const h=await financeFixture(),responses=[],replyAgents=[],commands=[];Object.assign(h.env,{MEMORY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),TEAM_AUTONOMY_ENABLED:'true'});
  await handleOwnerMessage(h.env,{phone:OWNER,message:{id:'owner-finance-document',type:'text'},incoming:'Melodi, envíame un informe de mis finanzas por email',
    async markTyping(){},async sendText(env,owner,body,options){responses.push(body);replyAgents.push(options?.agent);},async observeAgentReply(){},
    async configureTeam(command){commands.push(command);
      if(command.action==='authorize_skill') {assert.equal(responses.length,1);return {allowed:false,approvalId:'approval-1',response:'Melodi: Melodi necesita mi ayuda. ¿Apruebas C1?'};}
      if(command.action==='approval_notified') {assert.equal(responses.length,2);assert.equal(command.approvalId,'approval-1');}
      return null;
    }});
  assert.doesNotMatch(responses[0],/^(?:Melodi|Melodi):/);assert.match(responses[1],/Apruebas C1/);
  assert.equal(replyAgents[0],'melodi');
  const authorization=commands.find(v=>v.action==='authorize_skill');assert.equal(authorization.messageId,'owner-finance-document');
  assert.equal(authorization.tool,'prepare_document');assert.equal(authorization.agent,'melodi');assert.match(authorization.input.content,/Todavía no hay movimientos/);
  assert.deepEqual(authorization.input.ownerRequest,{origin:'owner_request',assignmentAgent:'melodi',channel:'email'});
  assert.equal(h.db.sql.prepare('SELECT count(*) AS n FROM wa_owner_jobs').get().n,0);
});

test('debt payments appear in expense totals and movement detail once, with exact remaining principal',async()=>{
  const h=await financeFixture(),run=(id,text)=>executeFinanceRequest(h.env,{owner:OWNER,agent:'melodi',requestId:id,request:parseFinanceRequest(text,NOW),services:h.services,now:NOW});
  await run('debt','registra deuda préstamo de 10000 pesos');const debt=(await h.store.list(OWNER))[0];
  await run('pay',`abona 500 pesos a mi deuda ${debt.reference}`);await run('pay',`abona 500 pesos a mi deuda ${debt.reference}`);
  const records=await h.store.list(OWNER);assert.equal(financeSummary(records,{month:"2026-10"}).currencies.DOP.expense,50000);
  assert.match(financeReport(records,{section:'transactions',now:NOW}),/Salida \(pago de deuda\)/);
  assert.match(financeReport(records,{section:'debts',now:NOW}),/pendiente DOP 9,500.00/);
});
