import test from 'node:test';
import assert from 'node:assert/strict';
import {executeOwnerActionPlan,ownerActionToolCatalog,validateOwnerActionInput} from '../owner-action-plan-executor.js';
import {renderOwnerActionResponse} from '../owner-turn-response.js';

const owner='18095550123';
const context=()=>({env:{OWNER_WHATSAPP_NUMBER:owner},phone:owner,message:{id:'calendar-connect-regression'},normalized:'Quiero conectar Google Calendar',agent:'melodi'});
const action={id:'calendar-link',tool:'calendar.connect',input:{},dependsOn:[]};
const plan={agent:'melodi',actions:[action]};
const url='https://ia.vetsa.es/oauth/google/start?link='+'a'.repeat(64);
const wrongService=()=>assert.fail('Calendar connection must never call Gmail, Drive, an event reader or writer');

test('Calendar connection is in the semantic catalog and only creates a verified Calendar consent link',async()=>{
 let calls=0;const services={createGoogleCalendarLink:async(env,agent)=>{calls++;assert.equal(env.OWNER_WHATSAPP_NUMBER,owner);assert.equal(agent,'melodi');return{configured:true,url};},createGmailLink:wrongService,createDriveLink:wrongService,readOwnerAgenda:wrongService,persistSemanticCalendarEvents:wrongService};
 const catalog=ownerActionToolCatalog(context(),services);assert.equal(catalog.find(x=>x.name==='calendar.connect').status,'available');
 assert.deepEqual(validateOwnerActionInput('calendar.connect',{}),{});
 const outcome=await executeOwnerActionPlan(plan,context(),{services,authorize:async()=>true});
 assert.equal(calls,1);assert.equal(outcome.results[0].state,'committed');
 assert.equal(outcome.results[0].receipt.status,'consent_link_created');assert.equal(outcome.results[0].data.connected,false);
 const answer=await renderOwnerActionResponse({}, {message:'Quiero conectar Google Calendar',plan,outcome,referenceAt:'2026-11-14T21:00:00Z'}, {infer:wrongService});
 assert.equal(answer,'Conecta Google Calendar aquí: '+url);assert.doesNotMatch(answer,/Gmail|Drive|conectado/);
});

test('Calendar connection rejects another connector, another host and a malformed private link',async()=>{
 for(const bad of [url.replace('/google/','/gmail/'),url.replace('ia.vetsa.es','example.invalid'),url.replace('a'.repeat(64),'short')]){
  const outcome=await executeOwnerActionPlan(plan,context(),{services:{createGoogleCalendarLink:async()=>({configured:true,url:bad})},authorize:async()=>true});
  assert.equal(outcome.results[0].state,'uncertain');assert.equal(outcome.results[0].error,'calendar_link_unverified');
  assert.notEqual(outcome.results[0].receipt?.status,'consent_link_created');
  assert.equal(outcome.results[0].data?.url,undefined);
 }
});

test('Calendar connection cannot run without owner authorization and reports an unavailable configuration',async()=>{
 let calls=0;const services={createGoogleCalendarLink:async()=>{calls++;return{configured:false};}};
 const blocked=await executeOwnerActionPlan(plan,context(),{services,authorize:async()=>false});assert.equal(calls,0);assert.equal(blocked.results[0].state,'blocked');
 const unavailable=await executeOwnerActionPlan(plan,context(),{services,authorize:async()=>true});assert.equal(calls,1);assert.equal(unavailable.results[0].error,'calendar_not_configured');
});
