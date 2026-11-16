import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createGoogleCalendarStore } from '../google-calendar-store.js';
import { GOOGLE_CALENDAR_SCOPE } from '../google-calendar-client.js';
import { createGoogleCalendarLink, handleGoogleCalendarRoute, getGoogleCalendarAccessToken, disconnectGoogleCalendar, handleGoogleCalendarOwnerMessage } from '../google-calendar-auth.js';

const BASE='https://ia.vetsa.es',OWNER='18095550001',EMAIL='felixdanielluna40@gmail.com';
class D1 {
  constructor(){this.sql=new DatabaseSync(':memory:');}
  prepare(query){const db=this;const make=values=>({query,values,bind:(...next)=>make(next),async run(){return db.execute(query,values);},
    async all(){return db.execute(query,values);},async first(){return db.execute(query,values).results[0] || null;}});return make([]);}
  execute(query,values){const s=this.sql.prepare(query);return s.columns().length?{results:s.all(...values),meta:{changes:Number(this.sql.prepare('SELECT changes() AS n').get().n)}}:{results:[],meta:{changes:Number(s.run(...values).changes)}};}
  async batch(statements){this.sql.exec('BEGIN');try{const result=statements.map(s=>this.execute(s.query,s.values));this.sql.exec('COMMIT');return result;}catch(error){this.sql.exec('ROLLBACK');throw error;}}
}
async function harness(){const db=new D1(),env={VETSA_CLOUD:db,MEMORY_ENCRYPTION_KEY:'test-encryption-key-at-least32bytes-long',
  OWNER_WHATSAPP_NUMBER:OWNER,GOOGLE_CLIENT_ID:'test-oauth-client',GOOGLE_CLIENT_SECRET:'test-oauth-secret',GOOGLE_CALENDAR_OWNER_EMAIL:EMAIL};
  const store=createGoogleCalendarStore(env);await store.ensureSchema();return {db,env,store};}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const token=(changes={})=>({access_token:'test-access-token',refresh_token:'test-refresh-token',expires_in:3600,scope:`${GOOGLE_CALENDAR_SCOPE} openid email`,...changes});
async function withFetch(mock,callback){const original=globalThis.fetch;globalThis.fetch=mock;try{return await callback();}finally{globalThis.fetch=original;}}
async function start(h){const link=await createGoogleCalendarLink(h.env,'melodi'),linkToken=new URL(link.url).searchParams.get('link');
  const request=new Request(`${BASE}/oauth/google/start`,{method:'POST',headers:{origin:BASE,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({link:linkToken})});
  const response=await handleGoogleCalendarRoute(request,h.env,new URL(request.url));assert.equal(response.status,302);
  return {linkToken,state:new URL(response.headers.get('location')).searchParams.get('state'),cookie:response.headers.get('set-cookie').split(';')[0],response};}
async function callback(h,auth,services={}){const request=new Request(`${BASE}/oauth/google/callback?code=code-for-test&state=${auth.state}`,{headers:{cookie:auth.cookie}});
  return handleGoogleCalendarRoute(request,h.env,new URL(request.url),services);}
function provider(calls,overrides={}){return async(url,options={})=>{calls.push({url,options});
  if(url==='https://oauth2.googleapis.com/token')return json(overrides.token || token());
  if(url==='https://openidconnect.googleapis.com/v1/userinfo')return json(overrides.profile || {sub:'owner-sub',email:EMAIL,email_verified:true});
  if(url==='https://www.googleapis.com/calendar/v3/calendars'){if(overrides.calendarError)throw new Error('network-failed');return json({id:'team-calendar@example.com'});}
  if(url==='https://oauth2.googleapis.com/revoke'){if(overrides.revokeError)throw new Error('revoke-network-failed');return new Response(null,{status:200});}
  throw new Error('unexpected endpoint');};}

test('changing from the previous Google client creates a Brivany calendar and never reuses its refresh token or mappings',async()=>{
 const h=await harness();h.env.MELODI_GOOGLE_CLIENT_REQUIRED=true;
 await h.store.putConnection(OWNER,{subject:'owner-sub',email:EMAIL,clientId:'old-client',refreshToken:'OLD_PRIVATE_REFRESH',calendarId:'old-calendar',calendarProvisionState:'uncertain',status:'connected'});
 await h.store.putMapping(OWNER,{owner:OWNER,kind:'melodi_calendar_events',id:'existing-local-event',agent:'melodi',googleEventId:'old-remote-event',status:'active'});
 const calls=[];
 await withFetch(provider(calls,{token:token({refresh_token:undefined})}),async()=>{
  const auth=await start(h);assert.equal((await callback(h,auth)).status,502);
 });
 await withFetch(provider(calls),async()=>{const auth=await start(h);assert.equal((await callback(h,auth)).status,200);});
 const saved=await h.store.getConnection(OWNER);
 assert.equal(saved.clientId,h.env.GOOGLE_CLIENT_ID);assert.equal(saved.calendarId,'team-calendar@example.com');assert.equal(saved.refreshToken,'test-refresh-token');
 assert.equal((await h.store.listMappings(OWNER)).length,0);
 const created=calls.find(call=>call.url==='https://www.googleapis.com/calendar/v3/calendars');assert.equal(JSON.parse(created.options.body).summary,'Brivany · Melodi');
 assert.ok(calls.every(call=>!call.url.includes('old-calendar')));
});

test('WhatsApp previews only display an interstitial and a same-origin POST consumes the owner link once',async()=>{
  const h=await harness(),link=await createGoogleCalendarLink(h.env,'melodi');
  for(let i=0;i<2;i++){const request=new Request(link.url);const response=await handleGoogleCalendarRoute(request,h.env,new URL(request.url));
    assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);assert.match(await response.text(),/method="post"/);}
  assert.equal(h.db.sql.prepare('SELECT consumed_at FROM google_calendar_oauth').get().consumed_at,null);
  const body=new URLSearchParams({link:new URL(link.url).searchParams.get('link')});
  const request=new Request(`${BASE}/oauth/google/start`,{method:'POST',headers:{origin:BASE,'content-type':'application/x-www-form-urlencoded'},body});
  const response=await handleGoogleCalendarRoute(request,h.env,new URL(request.url));assert.equal(response.status,302);
  const redirect=new URL(response.headers.get('location'));assert.equal(redirect.searchParams.get('login_hint'),EMAIL);assert.equal(redirect.searchParams.get('code_challenge_method'),'S256');
  assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
  const again=new Request(request.url,{method:'POST',headers:{origin:BASE,'content-type':'application/x-www-form-urlencoded'},body});
  assert.equal((await handleGoogleCalendarRoute(again,h.env,new URL(again.url))).status,400);
});

test('a foreign-origin POST cannot consume the link',async()=>{
  const h=await harness(),link=await createGoogleCalendarLink(h.env);const value=new URL(link.url).searchParams.get('link');
  const request=new Request(`${BASE}/oauth/google/start`,{method:'POST',headers:{origin:'https://foreign.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({link:value})});
  assert.equal((await handleGoogleCalendarRoute(request,h.env,new URL(request.url))).status,403);assert.ok(await h.store.peekNonce(value,'link'));
});

test('the native form allows only local submission and Google redirect while errors remain closed',async()=>{
  const h=await harness(),link=await createGoogleCalendarLink(h.env,'melodi');
  const assertFormPolicy=(response,formAction)=>{
    const directives=response.headers.get('content-security-policy').split(';').map(value=>value.trim()).filter(Boolean);
    const policy=new Map(directives.map(value=>{const [name,...sources]=value.split(/\s+/);return [name,sources.join(' ')];}));
    assert.equal(policy.size,directives.length,'the policy has no ambiguous duplicate directives');
    assert.equal(policy.get('default-src'),"'none'");assert.equal(policy.get('base-uri'),"'none'");assert.equal(policy.get('frame-ancestors'),"'none'");
    assert.equal(policy.get('form-action'),formAction,'OAuth permits the exact Google origin only on the interstitial');
  };
  const landingRequest=new Request(link.url),landing=await handleGoogleCalendarRoute(landingRequest,h.env,new URL(landingRequest.url));
  assert.equal(landing.status,200);assert.equal(landing.headers.get('referrer-policy'),'same-origin');
  assert.equal(landing.headers.get('cache-control'),'no-store');assertFormPolicy(landing,"'self' https://accounts.google.com");
  const markup=await landing.text(),action=markup.match(/<form\s+method="post"\s+action="([^"]+)"/),hidden=markup.match(/name="link"\s+value="([^"]+)"/);
  assert.ok(action,'the continuation uses a native POST form');assert.ok(hidden,'the form retains the one-use link');
  const actionUrl=new URL(action[1],landingRequest.url);assert.equal(actionUrl.origin,BASE);assert.equal(actionUrl.pathname,'/oauth/google/start');
  for(const headers of [
    {origin:'null','content-type':'application/x-www-form-urlencoded'},
    {origin:'https://foreign.example','content-type':'application/x-www-form-urlencoded'},
    {'content-type':'application/x-www-form-urlencoded'},
    {origin:BASE,'content-type':'text/plain'},
  ]){
    const request=new Request(actionUrl,{method:'POST',headers,body:new URLSearchParams({link:hidden[1]})});
    const rejected=await handleGoogleCalendarRoute(request,h.env,new URL(request.url));
    assert.equal(rejected.status,403);assert.equal(rejected.headers.get('location'),null);
    assertFormPolicy(rejected,"'self'");assert.equal(rejected.headers.get('referrer-policy'),'no-referrer');
    assert.ok(await h.store.peekNonce(hidden[1],'link'),'an invalid origin or MIME type cannot consume the link');
    assert.equal(h.db.sql.prepare("SELECT COUNT(*) AS n FROM google_calendar_oauth WHERE kind='consent'").get().n,0);
  }
  const request=new Request(actionUrl,{method:'POST',headers:{origin:BASE,'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},body:new URLSearchParams({link:hidden[1]})});
  const redirect=await handleGoogleCalendarRoute(request,h.env,new URL(request.url));
  assert.equal(redirect.status,302);assert.equal(redirect.headers.get('referrer-policy'),'no-referrer');
  assert.equal(redirect.headers.get('cache-control'),'no-store');assert.equal(new URL(redirect.headers.get('location')).origin,'https://accounts.google.com');
  assert.equal(await h.store.peekNonce(hidden[1],'link'),null);
  assert.equal(h.db.sql.prepare("SELECT COUNT(*) AS n FROM google_calendar_oauth WHERE kind='consent'").get().n,1);
  const staleRequest=new Request(link.url),stale=await handleGoogleCalendarRoute(staleRequest,h.env,new URL(staleRequest.url));
  assert.equal(stale.status,400);assert.equal(stale.headers.get('location'),null);assertFormPolicy(stale,"'self'");
  assert.equal(h.db.sql.prepare("SELECT COUNT(*) AS n FROM google_calendar_oauth WHERE kind='consent'").get().n,1,'an interrupted flow cannot recreate consent from a consumed link');
});

test('a callback without the browser cookie leaves consent usable and verified callback cannot be replayed',async()=>{
  const h=await harness(),auth=await start(h),calls=[],notices=[];
  const missing=new Request(`${BASE}/oauth/google/callback?code=x&state=${auth.state}`);
  assert.equal((await handleGoogleCalendarRoute(missing,h.env,new URL(missing.url))).status,400);
  assert.ok(await h.store.peekNonce(auth.state,'consent'));
  const normal=provider(calls);
  await withFetch(async(url,options)=>{
    if(options.redirect==='error')throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
    assert.equal(options.redirect,'manual');
    return normal(url,options);
  },async()=>{const response=await callback(h,auth,{sendWhatsApp:async(...args)=>notices.push(args)});
    assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await callback(h,auth)).status,400);});
  assert.equal(calls.filter(c=>c.url.includes('/token')).length,1);assert.equal(notices.length,1);
  assert.equal(calls.filter(c=>c.url==='https://openidconnect.googleapis.com/v1/userinfo').length,1);
  const exchange=calls.find(c=>c.url.includes('/token'));const consentRow=h.db.sql.prepare("SELECT * FROM google_calendar_oauth WHERE kind='consent'").get();
  assert.equal(JSON.stringify(consentRow).includes(exchange.options.body.get('code_verifier')),false);
  const linked=await h.store.getConnection(OWNER);assert.equal(linked.subject,'owner-sub');assert.equal(linked.agent,'melodi');assert.equal(linked.calendarId,'team-calendar@example.com');
  assert.equal(h.db.sql.prepare('SELECT lease_token FROM google_calendar_connections').get().lease_token,null);
});

test('wrong cookie hash cannot consume consent or make any provider request',async()=>{
  const h=await harness(),auth=await start(h);let calls=0;
  await withFetch(async()=>{calls++;throw new Error();},async()=>{const response=await callback(h,{...auth,cookie:`vetsa_calendar_oauth=${'a'.repeat(64)}`});assert.equal(response.status,400);});
  assert.equal(calls,0);assert.ok(await h.store.peekNonce(auth.state,'consent'));
});

test('wrong or unverified account is rejected even when token revocation is unavailable',async()=>{
  for(const profile of [{sub:'other',email:'other@example.com',email_verified:true},{sub:'owner-sub',email:EMAIL,email_verified:false},{email:EMAIL,email_verified:true}]){
    const h=await harness(),auth=await start(h),calls=[];
    await withFetch(provider(calls,{profile,revokeError:true}),async()=>assert.equal((await callback(h,auth)).status,403));
    assert.equal(await h.store.getConnection(OWNER),null);assert.equal(calls.some(c=>c.url.includes('/calendar/v3')),false);
  }
});

test('missing identity/calendar scopes, invalid expiration or refresh token prevent persistence',async()=>{
  for(const [value,status] of [[token({scope:`${GOOGLE_CALENDAR_SCOPE} email`}),403],[token({scope:'openid email'}),403],[token({expires_in:'not-a-number'}),502],[token({expires_in:-1}),502],[token({refresh_token:undefined}),502]]){
    const h=await harness(),auth=await start(h),calls=[];
    await withFetch(provider(calls,{token:value}),async()=>assert.equal((await callback(h,auth)).status,status));
    assert.equal(await h.store.getConnection(OWNER),null);assert.equal(calls.some(c=>c.url.includes('/calendar/v3')),false);
  }
});

test('token and identity redirects neither follow foreign destinations nor persist a Calendar connection',async()=>{
  for(const endpoint of ['https://oauth2.googleapis.com/token','https://openidconnect.googleapis.com/v1/userinfo']){
    for(const status of [302,307]){
      const h=await harness(),auth=await start(h),calls=[],notices=[],normal=provider(calls);
      const destination='https://foreign.example/credential-target';let rejectedResponseReturned=false,bodyReads=0;
      await withFetch(async(url,options)=>{
        if(options.redirect==='follow')calls.push({url:destination,options});
        if(options.redirect==='error')throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
        assert.equal(options.redirect,'manual');
        if(url!==endpoint)return normal(url,options);
        calls.push({url,options});rejectedResponseReturned=true;
        return {status,ok:false,headers:new Headers({location:destination}),
          get body(){bodyReads++;throw new Error('redirect body must not be read');}};
      },async()=>{
        const response=await callback(h,auth,{sendWhatsApp:async(...args)=>notices.push(args)});
        assert.equal(response.status,502);assert.equal(response.headers.get('location'),null);
        const beforeReplay=calls.length;assert.equal((await callback(h,auth)).status,400);assert.equal(calls.length,beforeReplay);
      });
      assert.equal(rejectedResponseReturned,true,'the runtime-compatible transport reached the provider response');
      assert.equal(bodyReads,0);assert.equal(calls.some(call=>call.url===destination),false);
      assert.equal(calls.some(call=>call.url.includes('/calendar/v3')),false);assert.equal(notices.length,0);
      if(endpoint.endsWith('/token'))assert.equal(calls.some(call=>call.url.endsWith('/userinfo')),false);
      assert.equal(await h.store.getConnection(OWNER),null);
      assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM google_calendar_connections').get().n,0);
      assert.equal(await h.store.peekNonce(auth.state,'consent'),null);
    }
  }
});

test('disconnect while the token is exchanged prevents a late OAuth callback from reconnecting',async()=>{
  const h=await harness(),auth=await start(h),calls=[];const normal=provider(calls);
  await withFetch(async(url,options)=>{if(url.includes('/token'))await h.store.disconnect(OWNER);return normal(url,options);},async()=>assert.equal((await callback(h,auth)).status,502));
  assert.equal(await h.store.getConnection(OWNER),null);assert.equal(calls.some(c=>c.url.includes('/calendar/v3')),false);
});

test('uncertain calendar creation is durable and a second consent never blindly creates a duplicate',async()=>{
  const h=await harness(),auth=await start(h),calls=[];
  await withFetch(provider(calls,{calendarError:true}),async()=>assert.equal((await callback(h,auth)).status,502));
  assert.equal((await h.store.getConnection(OWNER)).calendarProvisionState,'uncertain');
  const second=await start(h);
  await withFetch(provider(calls),async()=>assert.equal((await callback(h,second)).status,502));
  assert.equal(calls.filter(c=>c.url==='https://www.googleapis.com/calendar/v3/calendars').length,1);
});

test('durable OAuth success is not reported as a failed link when sync or WhatsApp transport fails',async()=>{
  const h=await harness(),auth=await start(h),calls=[];
  await withFetch(provider(calls),async()=>assert.equal((await callback(h,auth,{sync:async()=>{throw new Error('temporary');},sendWhatsApp:async()=>{throw new Error('temporary');}})).status,200));
  assert.equal((await h.store.getConnection(OWNER)).calendarId,'team-calendar@example.com');
});

test('token refresh requires the connection lease, preserves missing refresh tokens and encrypts new access',async()=>{
  const h=await harness();await h.store.putConnection(OWNER,{status:'connected',refreshToken:'old-refresh',accessToken:'expired-access',accessTokenExpiresAt:0});
  const linked=await h.store.getConnection(OWNER);await assert.rejects(getGoogleCalendarAccessToken(h.env,linked,h.store),/lease_required/);
  const leaseToken=await h.store.acquireLease(OWNER);
  await withFetch(async()=>json(token({access_token:'renewed-access',refresh_token:undefined})),async()=>assert.equal(await getGoogleCalendarAccessToken(h.env,linked,h.store,{leaseToken}),'renewed-access'));
  assert.equal((await h.store.getConnection(OWNER)).refreshToken,'old-refresh');
  assert.equal(JSON.stringify(h.db.sql.prepare('SELECT * FROM google_calendar_connections').get()).includes('renewed-access'),false);
});

test('disconnect during refresh never recreates or replaces the deleted connection',async()=>{
  const h=await harness();await h.store.putConnection(OWNER,{status:'connected',refreshToken:'old-refresh',accessTokenExpiresAt:0});
  const linked=await h.store.getConnection(OWNER),leaseToken=await h.store.acquireLease(OWNER);
  await withFetch(async()=>{await h.store.disconnect(OWNER);return json(token());},async()=>await assert.rejects(getGoogleCalendarAccessToken(h.env,linked,h.store,{leaseToken}),/lease_lost/));
  assert.equal(await h.store.getConnection(OWNER),null);assert.equal(linked.accessToken,undefined);
});

test('local disconnect completes even when the provider revocation request fails',async()=>{
  const h=await harness();await h.store.putConnection(OWNER,{status:'connected',refreshToken:'old-refresh'});
  await withFetch(async()=>{throw new Error('offline');},async()=>assert.deepEqual(await disconnectGoogleCalendar(h.env),{disconnected:true}));
  assert.equal(await h.store.getConnection(OWNER),null);
});

test('document headings preserve Calendar commands in supplied inline and multiline content without effects',async()=>{
  const h=await harness(),notices=[],calls=[];
  await h.store.putConnection(OWNER,{status:'connected',calendarId:'existing-calendar',refreshToken:'existing-refresh'});
  const messages=[
    'Crea un PDF con esto:\nConecta Google Calendar',
    'Crea un PDF con esto: Conecta Google Calendar',
    'Melodi, crea un documento PDF y envíamelo por correo:\nDesconecta Google Calendar',
    'Prepara un documento con este contenido: Desconecta Google Calendar',
    'Quiero que prepares un documento con esto: Desconecta Google Calendar',
    'Crea una factura con este texto: Desconecta Google Calendar',
    'Crea un PDF con esto:\r\nRevoca Google Calendar\r\nConecta Google Calendar',
  ];
  await withFetch(async(url)=>{calls.push(url);throw new Error('unexpected provider request');},async()=>{
    for(const message of messages) assert.equal(await handleGoogleCalendarOwnerMessage(h.env,OWNER,message,'melodi',async(...args)=>notices.push(args)),false,message);
  });
  assert.equal(calls.length,0);assert.equal(notices.length,0);
  assert.equal((await h.store.getConnection(OWNER)).calendarId,'existing-calendar');
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM google_calendar_oauth').get().n,0);
});

test('Calendar negations still leave the connection and OAuth nonces untouched',async()=>{
  const h=await harness(),notices=[];
  await h.store.putConnection(OWNER,{status:'connected',calendarId:'existing-calendar'});
  for(const message of ['No conectes Google Calendar','No desconectes Google Calendar','Nunca revoca Google Calendar','Melodi, no quiero que desconectes Google Calendar'])
    assert.equal(await handleGoogleCalendarOwnerMessage(h.env,OWNER,message,'melodi',async(...args)=>notices.push(args)),false,message);
  assert.equal((await h.store.getConnection(OWNER)).calendarId,'existing-calendar');
  assert.equal(h.db.sql.prepare('SELECT COUNT(*) AS n FROM google_calendar_oauth').get().n,0);assert.equal(notices.length,0);
});

test('the principal Calendar command wins over opposite commands in later supplied lines',async()=>{
  const h=await harness(),notices=[],calls=[];
  await h.store.putConnection(OWNER,{status:'connected',calendarId:'existing-calendar',refreshToken:'existing-refresh'});
  const send=async(...args)=>notices.push(args);
  assert.equal(await handleGoogleCalendarOwnerMessage(h.env,OWNER,'Melodi, conecta Google Calendar\nDesconecta Google Calendar','melodi',send),true);
  assert.equal((await h.store.getConnection(OWNER)).calendarId,'existing-calendar');
  assert.equal(h.db.sql.prepare("SELECT COUNT(*) AS n FROM google_calendar_oauth WHERE kind='link'").get().n,1);
  assert.match(notices[0][2],/^Melodi: Vincula tu cuenta/);
  await withFetch(async(url)=>{calls.push(url);return new Response(null,{status:200});},async()=>{
    assert.equal(await handleGoogleCalendarOwnerMessage(h.env,OWNER,'Desconecta Google Calendar\nConecta Google Calendar','melodi',send),true);
  });
  assert.deepEqual(calls,['https://oauth2.googleapis.com/revoke']);assert.equal(await h.store.getConnection(OWNER),null);
  assert.match(notices[1][2],/^Melodi: Desvinculé Google Calendar/);
});

test('an explicit Calendar link request in the main heading remains available',async()=>{
  const h=await harness(),notices=[];
  assert.equal(await handleGoogleCalendarOwnerMessage(h.env,OWNER,'Melodi, envíame un enlace para Google Calendar','melodi',async(...args)=>notices.push(args)),true);
  assert.equal(notices.length,1);assert.match(notices[0][2],/^Melodi: Vincula tu cuenta/);
  assert.equal(h.db.sql.prepare("SELECT COUNT(*) AS n FROM google_calendar_oauth WHERE kind='link'").get().n,1);
});
