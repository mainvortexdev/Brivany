import test from 'node:test';
import assert from 'node:assert/strict';
import {financeFixture} from './finance-fixture.js';
import {appAgentSchema,handleBrivanyWhatsApp,consumeAppAgentLink} from '../vetsa-app-agents.js';
import {linkedTenant,tenantEnvironment,queuedTenantEnvironment,oauthTenantEnvironment} from '../melodi-tenants.js';
import {getDriveAccessToken,createDriveLink,withDriveClient} from '../drive-auth.js';
import {DRIVE_SCOPE,DRIVE_REQUIRED_SCOPES} from '../drive-client.js';
import {createDriveStore} from '../drive-store.js';
import {GMAIL_REQUIRED_SCOPES,GMAIL_AUTH_SCOPES} from '../gmail-client.js';
import {getGmailAccessToken} from '../gmail-auth.js';
import {getGoogleCalendarAccessToken} from '../google-calendar-auth.js';
import {melodiEnvironment} from '../melodi-identity.js';
import {usageReport,runUsageReports} from '../cognira-reports.js';
import worker from '../worker.js';
import {ownerAutonomyServices} from '../owner-features.js';

const A='18095550101',B='18095550202',BUSINESS='18095559999';
async function fixture(){
 const f=await financeFixture();await f.db.batch(appAgentSchema.map(sql=>f.db.prepare(sql)));
 const identities={a:{id:'user-A',name:'Ana',email:'ana@example.com'},b:{id:'user-B',name:'Bea',email:'bea@example.com'}};
 const requests=[],queued=[];
 const env=melodiEnvironment({VETSA_CLOUD:f.db,OWNER_WHATSAPP_NUMBER:A,ASSISTANT_WHATSAPP_NUMBER:BUSINESS,TIME_ZONE:'UTC',
  MEMORY_ENCRYPTION_KEY:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
  GOOGLE_CLIENT_ID:'web-client',GOOGLE_CLIENT_SECRET:'web-secret',BREVO_API_KEY:'PRIMARY_PRIVATE',INSTAGRAM_INTERNAL_TOKEN:'PRIMARY_PRIVATE',
  OWNER_EMAIL_FORWARD_TO:'primary-private@example.com',MELODI_JOBS:{async send(body){queued.push(body);}},
  VETSA_IDENTITY:{async fetch(request){requests.push(request);const token=request.headers.get('authorization')?.slice(7);const user=identities[token];return Response.json(user?{authenticated:true,client:token==='foreign'?'cognira-app':'brivany-desktop',user}:{authenticated:false});}}});
 const invoke=async(path,token='a',body)=>handleBrivanyWhatsApp(new Request('https://ia.vetsa.es/api/brivany/whatsapp'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env,f.services);
 const begin=async(token)=>{const response=await invoke('/link',token,{timeZone:'America/La_Paz'});assert.equal(response.status,200);return(await response.json()).url;};
 const consume=async(url,phone)=>consumeAppAgentLink(env,phone,new URL(url).searchParams.get('text'));
 return{...f,env,invoke,begin,consume,requests,queued,identities};
}

test('the public Melodi number exposes no account or provider credentials',async()=>{
 const f=await fixture(),response=await f.invoke('/number',null),result=await response.json();
 assert.deepEqual(result,{number:BUSINESS,name:'Melodi',url:'https://wa.me/'+BUSINESS});assert.equal(f.requests.length,0);
 assert.equal((await f.invoke('/status',null)).status,401);
});
test('the original operator keeps phone-owned access until an explicit account unlink revokes it',async()=>{
 const f=await fixture();const previous=await linkedTenant(f.env,A,f.services);
 assert.equal(previous.legacy,true);assert.equal(previous.phone,A);
 assert.equal(await linkedTenant(f.env,B,f.services),null);
 await f.consume(await f.begin('a'),A);assert.equal((await linkedTenant(f.env,A,f.services)).userId,'user-A');
 await f.invoke('/unlink','a',{});assert.equal(await queuedTenantEnvironment(f.env,A,f.services),null);
});
test('linking requires a Brivany account session, not a different application token',async()=>{
 const f=await fixture();f.identities.foreign=f.identities.a;
 f.env.VETSA_IDENTITY.fetch=async()=>Response.json({authenticated:true,client:'cognira-app',user:f.identities.a});
 assert.equal((await f.invoke('/link','foreign',{})).status,401);
 assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM vetsa_app_agent_codes').get().n,0);
});
test('two accounts prove their own WhatsApp numbers and retain separate encrypted profiles',async()=>{
 const f=await fixture(),a=await f.begin('a'),b=await f.begin('b');
 assert.match(await f.consume(a,A),/vinculado a Brivany/);assert.match(await f.consume(b,B),/vinculado a Brivany/);
 const sa=await(await f.invoke('/status','a')).json(),sb=await(await f.invoke('/status','b')).json();
 assert.equal(sa.phone,'••••0101');assert.equal(sb.phone,'••••0202');assert.equal(sa.linked,true);assert.equal(sa.agents.length,1);
 const pa=await linkedTenant(f.env,A,f.services),pb=await linkedTenant(f.env,B,f.services);
 assert.equal(pa.email,'ana@example.com');assert.equal(pb.email,'bea@example.com');assert.notEqual(pa.userId,pb.userId);
 assert.doesNotMatch(JSON.stringify(f.db.sql.prepare('SELECT * FROM brivany_whatsapp_profiles').all()),/ana@example|bea@example/);
 assert.match(await f.consume(a,B),/caducó|ya se utilizó/);
});
test('unlinking stops queued private work and cannot transfer old private data to another account',async()=>{
 const f=await fixture(),first=await f.begin('a');await f.consume(first,A);
 assert.equal((await f.invoke('/unlink','a',{})).status,200);
 assert.equal(await linkedTenant(f.env,A,f.services),null);
 assert.equal(await queuedTenantEnvironment(f.env,A,f.services),null);
 const second=await f.begin('b');assert.match(await f.consume(second,A),/otra cuenta|titular/);
 assert.equal((await(await f.invoke('/status','b')).json()).linked,false);
 assert.equal((await f.invoke('/google/drive','b',{})).status,403);
 // A non-primary account's detached number cannot receive private queue jobs.
 f.db.sql.prepare("UPDATE vetsa_app_agent_links SET next_link_at=0 WHERE user_id='user-B'").run();
 await f.consume(await f.begin('b'),B);await f.invoke('/unlink','b',{});
 assert.equal(await queuedTenantEnvironment(f.env,B,f.services),null);
});
test('a linked account never receives the original business integrations or queue identity',async()=>{
 const f=await fixture();await f.consume(await f.begin('b'),B);
 const tenant=await linkedTenant(f.env,B,f.services),env=tenantEnvironment(f.env,tenant);
 assert.equal(env.OWNER_WHATSAPP_NUMBER,B);assert.equal(env.OWNER_EMAIL_FORWARD_TO,'bea@example.com');
 assert.equal(env.MELODI_BUSINESS_ADMIN,false);await assert.rejects(usageReport(env),/business_metrics_not_authorized/);
 await runUsageReports(env,()=>assert.fail('corporate report leaked'),()=>assert.fail('corporate report leaked'));
 for(const key of ['BREVO_API_KEY','INSTAGRAM_INTERNAL_TOKEN','OWNER_COGNIRA_DEVICE_ID'])assert.ok(!env[key],key);
 await env.MELODI_JOBS.send({type:'autonomy_agent',agent:'melodi',ownerPhone:A});assert.equal(f.queued[0].ownerPhone,B);
 const twice=melodiEnvironment(env);await twice.MELODI_JOBS.send({type:'autonomy_outbox'});assert.equal(f.queued[1].ownerPhone,B);
});
test('Drive consent resolves the owner from the nonce and ignores an injected phone',async()=>{
 const f=await fixture();await f.consume(await f.begin('b'),B);
 const tenant=await linkedTenant(f.env,B,f.services),env=tenantEnvironment(f.env,tenant);
 const link=await createDriveLink(env);assert.equal(link.configured,true);
 const url=new URL(link.url);url.searchParams.set('owner',A);
 const resolved=await oauthTenantEnvironment(new Request(url),f.env,url,f.services);
 assert.equal(resolved.OWNER_WHATSAPP_NUMBER,B);
 const form=new Request('https://ia.vetsa.es/oauth/drive/start',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({link:new URL(link.url).searchParams.get('link')}).toString()});
 assert.equal((await oauthTenantEnvironment(form,f.env,new URL(form.url),f.services)).OWNER_WHATSAPP_NUMBER,B);
});
test('tokens issued to the previous Google app never run under the Brivany client',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('old token must not be refreshed or used'));
 const env={MELODI_GOOGLE_CLIENT_REQUIRED:true,GOOGLE_CLIENT_ID:'brivany-client'},connection={clientId:'old-vetsa-client',accessToken:'PRIVATE_OLD_TOKEN',accessTokenExpiresAt:Date.now()+3600000,scopes:[DRIVE_SCOPE]};
 for(const getToken of [getDriveAccessToken,getGmailAccessToken,getGoogleCalendarAccessToken])await assert.rejects(getToken(env,connection,{},{}),error=>error.code==='authorization_required');
});
test('a different verified Drive account can use the reduced grant without a fixed personal email',async()=>{
 const f=await fixture(),env=tenantEnvironment(f.env,{phone:B,userId:'user-B',email:'bea@example.com',timeZone:'UTC'});
 const store=createDriveStore(env);await store.ensureSchema();
 await store.putConnection(B,{status:'connected',clientId:env.GOOGLE_CLIENT_ID,email:'different-google@example.com',subject:'own-google-account',scopes:[...DRIVE_REQUIRED_SCOPES],accessToken:'synthetic-access',accessTokenExpiresAt:Date.now()+3600000});
 let requests=0;const result=await withDriveClient(env,B,api=>api.listFiles({}),{store,fetcher:async()=>{requests++;return Response.json({files:[]});}});
 assert.equal(requests,1);assert.deepEqual(result.files,[]);
 await store.putConnection(B,{status:'connected',clientId:env.GOOGLE_CLIENT_ID,email:'different-google@example.com',scopes:[DRIVE_REQUIRED_SCOPES[0]],accessToken:'synthetic-access',accessTokenExpiresAt:Date.now()+3600000});
 await assert.rejects(withDriveClient(env,B,()=>assert.fail('partial grant must not run'),{store}),error=>error.code==='authorization_required');
});
test('Gmail requests read and draft/send scopes and refuses an incomplete cached grant',async t=>{
 assert.deepEqual(GMAIL_AUTH_SCOPES,[...GMAIL_REQUIRED_SCOPES,'openid','email']);assert.ok(!GMAIL_AUTH_SCOPES.includes('https://mail.google.com/'));
 t.mock.method(globalThis,'fetch',()=>assert.fail('partial grant must not reach Gmail'));
 await assert.rejects(getGmailAccessToken({GOOGLE_CLIENT_ID:'client'},{clientId:'client',scopes:[GMAIL_REQUIRED_SCOPES[0]],accessToken:'cached',accessTokenExpiresAt:Date.now()+3600000},{}),error=>error.code==='authorization_required');
});
for(const connector of ['calendar','drive','gmail'])test(`${connector}: an arbitrary linked Brivany account can reach Google consent without a fixed email`,async()=>{
 const f=await fixture();
 f.env=melodiEnvironment({...f.env,BRIVANY_GOOGLE_WEB_CLIENT_ID:'125198900429-brivany-web.apps.googleusercontent.com',BRIVANY_GOOGLE_WEB_CLIENT_SECRET:'synthetic-web-secret'});
 const services=ownerAutonomyServices(f.env);
 const call=(path,method='GET',body)=>worker.fetch(new Request('https://ia.vetsa.es'+path,{method,headers:{Authorization:'Bearer b',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),f.env,{waitUntil(){}});
 const link=await(await call('/api/brivany/whatsapp/link','POST',{timeZone:'UTC'})).json();
 await consumeAppAgentLink(f.env,B,new URL(link.url).searchParams.get('text'));
 const google=await(await call('/api/brivany/whatsapp/google/'+connector,'POST',{})).json();assert.equal(google.configured,true);
 const page=await call(new URL(google.url).pathname+new URL(google.url).search);assert.equal(page.status,200);assert.match(await page.text(),/method="post"/);
 const start=new URL(google.url);const response=await worker.fetch(new Request(start.origin+start.pathname,{method:'POST',headers:{Origin:start.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({link:start.searchParams.get('link')})}),f.env,{waitUntil(){}});
 assert.equal(response.status,302);const destination=new URL(response.headers.get('location'));
 assert.equal(destination.origin,'https://accounts.google.com');assert.equal(destination.searchParams.get('client_id'),f.env.GOOGLE_CLIENT_ID);
 assert.equal(destination.searchParams.has('login_hint'),false);assert.equal(destination.searchParams.get('redirect_uri'),'https://ia.vetsa.es/oauth/google/callback');
 assert.equal(destination.searchParams.get('code_challenge_method'),'S256');assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
});
