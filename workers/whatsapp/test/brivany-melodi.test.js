import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {FinanceD1} from './finance-fixture.js';
import {AGENTS,agentPersona} from '../melodi-system.js';
import {AUTONOMY_PROFILES,autonomyToolCatalog,executeAutonomyTool} from '../melodi-autonomy-tools.js';
import {SKILLS,skillFor} from '../melodi-skills.js';
import {melodiEnvironment,melodiRecord} from '../melodi-identity.js';
import {ownerActionToolCatalog} from '../owner-action-plan-executor.js';
import {createPermissionStore} from '../melodi-permissions.js';
import {melodiSchemaPlan,copySql} from '../tools/melodi-schema.mjs';
import worker from '../worker.js';
import {executeApprovedOwnerTask} from '../owner-features.js';
import {createGmailStore} from '../gmail-store.js';
import {GMAIL_SCOPE} from '../gmail-client.js';

test('one Melodi identity owns every installed skill and the original tool families',()=>{
  assert.deepEqual(Object.keys(AGENTS),['melodi']);
  assert.deepEqual(Object.keys(AUTONOMY_PROFILES),['melodi']);
  assert.deepEqual(AUTONOMY_PROFILES.melodi.scheduledTimes,[]);
  assert.match(agentPersona(),/compañera de Brivany/);
  assert.doesNotMatch(agentPersona(),/Dona|Emily|Lila|Mora|Stacy/);
  for(const group of ['conversation','team','memory','documents','calendar','email','creative','social','projects','research','desktop']) assert.ok(SKILLS.some(skill=>skill.id.startsWith(group+'.')),group);
  for(const skill of SKILLS){assert.deepEqual(skill.agents,['melodi']);assert.equal(skillFor(skill.intent,'melodi').agent,'melodi');}
  const tools=ownerActionToolCatalog().map(item=>item.name);
  for(const name of ['calendar.create_events','calendar.plan_agenda','gmail.search','gmail.send','drive.read','drive.create_document','document.generate','project.update','memory.save','research.web','desktop.command','finance.read','usage.read','contact.preferences']) assert.ok(tools.includes(name),name);
  assert.ok(!autonomyToolCatalog('melodi').some(item=>item.name==='delegate_agent_event'));
});

test('retired actors cannot wake or receive delegated work',async()=>{
  let acknowledgements=0,retries=0;
  await worker.queue({messages:[{body:{type:'autonomy_agent',agent:'dona'},ack(){acknowledgements++;},retry(){retries++;}}]}, {}, {waitUntil(){assert.fail('no background work');}});
  assert.equal(acknowledgements,1);assert.equal(retries,0);
  const result=await executeAutonomyTool({agent:'melodi',name:'delegate_agent_event',input:{target:'melodi'}});
  assert.equal(result.ok,false);assert.equal(result.error,'retired_agent_delegation');
  assert.equal(autonomyToolCatalog('dona').length,0);
});

test('reuse the original queue without enabling old bootstrap or email registrations',async()=>{
  const sent=[],queue={send(body){sent.push(body);}};const env=melodiEnvironment({DONA_JOBS:queue,OWNER_WHATSAPP_NUMBER:'18095550101',TEAM_CONVERSATION_LEADER:'dona',TEAM_AUTONOMY_BOOTSTRAP:'old',TEAM_AGENT_EMAIL_SETUP:'old'});
  await env.MELODI_JOBS.send({type:'autonomy_agent',agent:'melodi',ownerPhone:'forged'});
  assert.equal(sent[0].ownerPhone,'18095550101');assert.equal(env.TEAM_CONVERSATION_LEADER,'melodi');
  assert.equal(env.TEAM_AUTONOMY_BOOTSTRAP,'');assert.equal(env.TEAM_AGENT_EMAIL_SETUP,'');
});

test('migration changes identity metadata and preserves literal notes, addresses and credentials',()=>{
  const value={agent:'emily',note:'Dona, escribe a emily@vetsa.es',credentials:{password:'dona'},nested:{assigned_agent:'lila'},requester:'dona'};
  const migrated=melodiRecord(value);
  assert.equal(migrated.agent,'melodi');assert.equal(migrated.nested.assigned_agent,'melodi');
  assert.equal(migrated.note,value.note);assert.equal(migrated.credentials.password,'dona');assert.equal(value.agent,'emily');
});

test('new schema copies an existing appointment with the same ID, retaining the old table for recovery',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE calendar_events(id TEXT PRIMARY KEY,phone TEXT,title TEXT,assigned_agent TEXT CHECK(assigned_agent IN ('dona','emily')));CREATE INDEX old_calendar_idx ON calendar_events(phone);INSERT INTO calendar_events VALUES('same-id','owner','PRIVATE_NOTE','emily')");
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL").all();
  const plan=melodiSchemaPlan(schema);
  for(const sql of plan.create)db.exec(sql);
  const columns=db.prepare('PRAGMA table_info(calendar_events)').all().map(row=>row.name);
  const copy=copySql(plan.tables[0],columns);db.exec(copy);db.exec(copy);
  assert.deepEqual({...db.prepare('SELECT * FROM melodi_calendar_events').get()},{id:'same-id',phone:'owner',title:'PRIVATE_NOTE',assigned_agent:'melodi'});
  assert.equal(db.prepare('SELECT count(*) AS n FROM calendar_events').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM melodi_calendar_events').get().n,1);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='melodi_calendar_events'").all().length>=2);
  assert.equal(copySql({from:'wa_agent_personal_goals',to:'wa_melodi_personal_goals'},['owner_phone','agent']),null);
});

async function permissionsFixture(){
  const db=new FinanceD1();let now=Date.parse('2026-11-13T16:00:00Z');
  // Local simulated cryptography: no provider calls, plaintext is not written to the DB.
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const store=createPermissionStore(db,{now:()=>now,async encrypt(value){const iv=crypto.getRandomValues(new Uint8Array(12));return{iv:Buffer.from(iv).toString('base64'),encrypted:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)))).toString('base64')};},async decrypt(value,iv){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64')},key,Buffer.from(value,'base64'))));}});
  await store.ensureSchema();await store.ensureAgent('owner','melodi');
  return{db,store,advance(){now+=25*3600000;}};
}
const request=store=>store.authorizeOrRequest({owner:'owner',agent:'melodi',tool:'desktop_action',eventKey:'one-task',input:{instruction:'PRIVATE_ACTION'}});

test('a stronger tool waits for the owner and grants exactly one execution without raising the level',async()=>{
  const {db,store}=await permissionsFixture();const pending=await request(store);
  assert.equal(pending.allowed,false);assert.equal(pending.status,'waiting_approval');
  const id=pending.waitingApproval.id;
  assert.equal((await store.claimApproved({owner:'owner',approvalId:id,helper:'melodi',eventKey:'early'})).allowed,false);
  assert.equal((await store.approve({owner:'other',approvalId:id,approved:true,eventKey:'foreign'})).status,'not_found');
  assert.equal((await store.approve({owner:'owner',approvalId:id,approved:true,eventKey:'yes'})).status,'approved');
  const first=await store.claimApproved({owner:'owner',approvalId:id,helper:'melodi',eventKey:'run'});
  assert.equal(first.allowed,true);assert.equal(first.request.input.instruction,'PRIVATE_ACTION');
  assert.equal((await store.claimApproved({owner:'owner',approvalId:id,helper:'melodi',eventKey:'run-again'})).allowed,false);
  assert.equal(await store.finishApproval({owner:'owner',approvalId:id,token:first.grant.token,status:'complete'}),true);
  assert.equal((await store.getTeam('owner'))[0].level,3);
  assert.doesNotMatch(JSON.stringify(db.sql.prepare('SELECT * FROM wa_melodi_permission_requests').all()),/PRIVATE_ACTION/);
});

for(const reason of ['denied','expired','revoked'])test(`owner approval cannot execute when ${reason}`,async()=>{
  const {store,advance}=await permissionsFixture();const pending=await request(store),id=pending.waitingApproval.id;
  if(reason==='denied')await store.approve({owner:'owner',approvalId:id,approved:false,eventKey:'no'});
  else if(reason==='expired')advance();
  else await store.adjustLevel({owner:'owner',agent:'melodi',level:2,eventKey:'revoke'});
  await store.approve({owner:'owner',approvalId:id,approved:true,eventKey:'later-yes'});
  assert.equal((await store.claimApproved({owner:'owner',approvalId:id,helper:'melodi',eventKey:'run'})).allowed,false);
});
test('praise and ordinary conversation never raise tool permissions',async()=>{
  const {store}=await permissionsFixture();
  for(let i=0;i<20;i++)await store.reward({owner:'owner',agent:'melodi',eventKey:'praise-'+i,kind:'praised'});
  assert.equal((await store.getTeam('owner'))[0].level,3);
  assert.equal((await request(store)).allowed,false);
});
test('an approved structured mail action preserves the exact recipient and body and cannot send twice',async t=>{
 const f=new FinanceD1(),owner='18095550101',env={VETSA_CLOUD:f,OWNER_WHATSAPP_NUMBER:owner,MEMORY_ENCRYPTION_KEY:'test-only-encryption-key',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'synthetic'};
 const store=createGmailStore(env);await store.ensureSchema();await store.putConnection(owner,{status:'connected',clientId:'client',email:'owner@example.com',subject:'own-account',accessToken:'synthetic-token',refreshToken:'synthetic-refresh',accessTokenExpiresAt:Date.now()+3600000,scopes:[GMAIL_SCOPE]});
 let sends=0,raw;
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');sends++;raw=JSON.parse(options.body).raw;return Response.json({id:'provider-receipt'});});
 const input={message:{id:'approved-exact-action'},normalized:'Envía el correo solicitado',authorityText:'Envía el correo solicitado',interpretation:{agent:'melodi'},action:{id:'mail',tool:'gmail.send',input:{to:'recipient@example.com',subject:'Asunto autorizado',body:'Texto exacto aprobado.'},dependsOn:[],requestSource:{start:0,end:25}}};
 for(let i=0;i<2;i++)assert.equal((await executeApprovedOwnerTask(env,{phone:owner,helper:'melodi',input,sendText:async()=>{}})).ok,true);
 assert.equal(sends,1);const mail=Buffer.from(raw,'base64url').toString('utf8');assert.match(mail,/recipient@example.com/);assert.ok(mail.includes(Buffer.from('Texto exacto aprobado.').toString('base64'))||mail.includes('Texto exacto aprobado.'));
});
