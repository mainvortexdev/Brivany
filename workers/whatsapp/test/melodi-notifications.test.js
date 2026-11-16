import test from 'node:test';
import assert from 'node:assert/strict';
import {financeFixture} from './finance-fixture.js';
import {notifyMelodiOwner,recordServiceNoticeStatuses,checkGoogleConsentStarts} from '../melodi-notifications.js';
import {melodiEnvironment} from '../melodi-identity.js';
import worker from '../worker.js';
const OWNER='18095550101';
async function setup(){const f=await financeFixture(),sent=[];const env=melodiEnvironment({...f.env,WHATSAPP_PHONE_NUMBER_ID:'business-phone',MEMORY_ENCRYPTION_KEY:'test-encryption-key-32bytes-at-least'});
 return{...f,env,sent,job:{type:'melodi_notify',ownerPhone:OWNER,release:'test-release',kind:'ready'},async sendText(_env,to,body){sent.push({to,body});return{messageId:'wamid.test'};}};}
test('the authorized completion message is sent once to the configured operator with conditional integrations',async()=>{
 const f=await setup(),options={sendText:f.sendText,services:f.services};
 assert.equal((await notifyMelodiOwner(f.env,f.job,options)).status,'accepted');
 assert.equal((await notifyMelodiOwner(f.env,f.job,options)).status,'already_attempted');assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].to,OWNER);assert.match(f.sent[0].body,/Melodi de Brivany/);assert.match(f.sent[0].body,/Google necesita una nueva autorización/);
 assert.match(f.sent[0].body,/cuando esté conectado y me autorices/);
 assert.ok(f.sent[0].body.length<=4096,'completion notice must fit in one WhatsApp message');
 assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM brivany_whatsapp_service_notices').all()),/Mis herramientas|Documentos PDF/);
});

test('cloud calls are explained with Cartesia and retired WhatsApp Calling cannot be promoted',async()=>{
 const f=await setup();f.env.MELODI_CALLS={info:async()=>({configured:true})};
 await notifyMelodiOwner(f.env,{...f.job,kind:'cloud-calls'},{sendText:f.sendText,services:f.services});
 assert.match(f.sent[0].body,/PC esté apagado/);assert.match(f.sent[0].body,/Cartesia/);assert.match(f.sent[0].body,/Retiré las llamadas por WhatsApp/);
 await assert.rejects(notifyMelodiOwner(f.env,{...f.job,kind:'calls-availability'},{sendText:f.sendText,services:f.services}),/invalid_service_notice/);
});
test('an uncertain provider send never causes an automatic duplicate',async()=>{
 const f=await setup();let calls=0;const options={services:f.services,sendText:async()=>{calls++;throw Error('network timeout');}};
 assert.equal((await notifyMelodiOwner(f.env,f.job,options)).status,'uncertain');
 assert.equal((await notifyMelodiOwner(f.env,f.job,options)).status,'already_attempted');assert.equal(calls,1);
});
test('no notice can be directed to a different phone',async()=>{
 const f=await setup();await assert.rejects(notifyMelodiOwner(f.env,{...f.job,ownerPhone:'18095559999'},{sendText:f.sendText,services:f.services}),/invalid_service_notice/);assert.equal(f.sent.length,0);
});
test('signed delivery processing checks business identity and recipient and never downgrades a read receipt',async()=>{
 const f=await setup();await notifyMelodiOwner(f.env,f.job,{sendText:f.sendText,services:f.services});
 const status=(delivery,recipient=OWNER,business='business-phone')=>({entry:[{changes:[{value:{metadata:{phone_number_id:business},statuses:[{id:'wamid.test',status:delivery,recipient_id:recipient}]}}]}]});
 const stored=()=>f.db.sql.prepare('SELECT delivery_status FROM brivany_whatsapp_service_notices').get().delivery_status;
 await recordServiceNoticeStatuses(f.env,status('read','18095559999'));assert.equal(stored(),null);
 await recordServiceNoticeStatuses(f.env,status('read',OWNER,'wrong'));assert.equal(stored(),null);
 await recordServiceNoticeStatuses(f.env,status('delivered'));assert.equal(stored(),'delivered');
 await recordServiceNoticeStatuses(f.env,status('sent'));assert.equal(stored(),'delivered');
 await recordServiceNoticeStatuses(f.env,status('read'));await recordServiceNoticeStatuses(f.env,status('failed'));assert.equal(stored(),'read');
});
test('a separate public-route preflight checks all three Google starts without entering Google or sending a message',async()=>{
 const f=await setup();Object.assign(f.env,{GOOGLE_CLIENT_ID:'brivany-web-client',GOOGLE_CLIENT_SECRET:'synthetic'});let requests=0;
 const result=await checkGoogleConsentStarts(f.env,{ownerPhone:OWNER,release:'probe-test'},{fetchImpl:(url,options)=>{requests++;return worker.fetch(new Request(url,options),f.env,{waitUntil(){}});}});
 assert.equal(requests,6);assert.equal(result.length,3);assert.ok(result.every(item=>item.status==='passed'&&item.httpStatus===302));assert.equal(f.sent.length,0);
 assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM brivany_whatsapp_integration_checks').all()),/oauth\/|token|link=/);
});
test('a bad public consent route blocks distributing fresh links to the operator',async t=>{
 const f=await setup();Object.assign(f.env,{GOOGLE_CLIENT_ID:'brivany-web-client',GOOGLE_CLIENT_SECRET:'synthetic'});
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'synthetic outage'},{status:500}));
 const result=await notifyMelodiOwner(f.env,{...f.job,kind:'google-approval'},{sendText:f.sendText,services:f.services});
 assert.equal(result.status,'preflight_failed');assert.equal(f.sent.length,0);
});
