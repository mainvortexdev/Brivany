import test from 'node:test';
import assert from 'node:assert/strict';
import {financeFixture} from './finance-fixture.js';
import {parseCallRequest,handleCallMessage,dispatchDueCalls,ensureCalls,deliverCallFailures} from '../melodi-calls.js';
import {ensureDesktop} from '../melodi-desktop.js';
import worker from '../worker.js';
const NOW=Date.parse('2026-11-14T05:30:00Z'),PHONE='18095550101';
test('telephone requests default to Telnyx, keep the owner time zone and refuse WhatsApp Calling',()=>{
 assert.equal(parseCallRequest('Llámame en 20 minutos',{now:NOW}).dueAt,NOW+20*60000);
 assert.equal(parseCallRequest('Llámame por teléfono en una hora',{now:NOW}).dueAt,NOW+3600000);
 assert.equal(parseCallRequest('Llámame mañana a las 9',{now:NOW,timeZone:'America/La_Paz'}).dueAt,Date.parse('2026-11-15T13:00:00Z'));
 assert.match(parseCallRequest('Llámame por WhatsApp en 20 minutos',{now:NOW}).error,/Telnyx/);
 for(const text of ['No me llames en 20 minutos','Recuérdame que alguien me llame','"Llámame en 20 minutos"'])assert.equal(parseCallRequest(text,{now:NOW}),null);
 assert.ok(parseCallRequest('Llámame cada 20 minutos',{now:NOW}).error);
});
test('a text request reaches the cloud without looking up or requiring an online PC',async()=>{
 const f=await financeFixture(),replies=[],calls=[];f.env.TIME_ZONE='America/La_Paz';
 f.env.MELODI_CALLS={async info(){return {configured:true};},async schedule(value){calls.push(value);return {...value,state:'scheduled',created:true};}};
 const input={phone:PHONE,incoming:'Llámame en 20 minutos sobre una prueba ficticia',message:{type:'text',id:'message-1'},reply:body=>replies.push(body),now:NOW};
 assert.equal(await handleCallMessage(f.env,input),true);assert.equal(calls.length,1);assert.equal(calls[0].phone,PHONE);assert.equal(calls[0].dueAt,NOW+1200000);
 assert.match(replies[0],/ordenador esté apagado/);assert.match(replies[0],/Cartesia/);assert.equal(f.db.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='brivany_desktop_devices'").get().n,0);
});
test('a failed cloud reservation is not announced as scheduled and a different sender cannot call',async()=>{
 const f=await financeFixture(),replies=[];f.env.MELODI_CALLS={info:async()=>({configured:true}),schedule:async()=>{throw Error('synthetic timeout');}};
 await handleCallMessage(f.env,{phone:PHONE,incoming:'Llámame en 20 minutos',message:{type:'text',id:'failed'},reply:body=>replies.push(body),now:NOW});assert.match(replies[0],/No pude confirmar/);assert.doesNotMatch(replies[0],/Guardé/);
 assert.equal(await handleCallMessage(f.env,{phone:'18095559999',incoming:'Llámame ahora',message:{type:'text'}}),false);
});
test('cloud list and exact cancellation remain available while the PC is offline',async()=>{
 const f=await financeFixture(),replies=[],id=crypto.randomUUID(),cancelled=[];f.env.MELODI_CALLS={info:async()=>({configured:true}),list:async()=>[{id,state:'scheduled',dueAt:NOW+60000,timeZone:'America/La_Paz'}],cancel:async(phone,value)=>{cancelled.push([phone,value]);return {id,state:'cancelled'};}};
 await handleCallMessage(f.env,{phone:PHONE,incoming:'Mis llamadas',message:{type:'text'},reply:b=>replies.push(b)});
 await handleCallMessage(f.env,{phone:PHONE,incoming:'Cancela llamada '+id,message:{type:'text'},reply:b=>replies.push(b)});
 assert.deepEqual(cancelled,[[PHONE,id]]);assert.match(replies[0],/programada/);assert.equal(replies[1],'Cancelé esa llamada.');
});
test('the old desktop scheduler is withdrawn and cannot dial on future PC polls',async()=>{
 const f=await financeFixture();await ensureDesktop(f.env);await ensureCalls(f.env);
 await dispatchDueCalls(f.env,f.services,{now:NOW});assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM brivany_desktop_commands').get().n,0);
});
test('cloud terminal receipts are reserved once and uncertain delivery is explicitly recorded',async()=>{
 const f=await financeFixture(),records=[],id=crypto.randomUUID();let sent=false;
 f.env.MELODI_CALLS={reserveNotices:async()=>sent?[]:(sent=true,[{id,state:'failed'}]),recordNotice:async(...args)=>records.push(args)};
 await deliverCallFailures(f.env,async()=>{throw Error('window closed');});await deliverCallFailures(f.env,async()=>{throw Error('must not retry');});assert.deepEqual(records,[[PHONE,id,false]]);
});
test('public voice ingress only forwards to the fixed cloud service; retired signaling is unavailable',async()=>{
 const f=await financeFixture(),seen=[];f.env.MELODI_CALLS={fetch:async request=>{seen.push(new URL(request.url).pathname);return new Response('Unauthorized',{status:401});}};
 const result=await worker.fetch(new Request('https://ia.vetsa.es/webhooks/telnyx-cloud',{method:'POST',body:'{}'}),f.env,{waitUntil(){}});assert.equal(result.status,401);assert.deepEqual(seen,['/webhooks/telnyx-cloud']);
});
