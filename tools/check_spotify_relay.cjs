'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const requireWrangler=createRequire(process.env.BRIVANY_WRANGLER_PACKAGE||path.join(process.env.APPDATA,'npm/node_modules/wrangler/package.json'));
const {Miniflare,Log,LogLevel,convertV4MiniflareOptions}=requireWrangler('miniflare');
const BASE='https://brivany.vetsa.es',CLIENT='a'.repeat(32),SIGNING='synthetic-local-relay-signing-fixture-not-production-123456789';
const random=()=>crypto.randomBytes(32).toString('base64url'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{
 // The installed workerd supports 2026-09-04; production is checked separately.
 const runtime=mode=>new Miniflare(convertV4MiniflareOptions({log:new Log(LogLevel.ERROR),workers:[{name:'brivany-relay-fixture',modules:[{type:'ESModule',path:path.resolve('official-site/worker.mjs')},{type:'ESModule',path:path.resolve('official-site/pages.mjs')},{type:'ESModule',path:path.resolve('official-site/whatsapp.mjs')},{type:'ESModule',path:path.resolve('official-site/spotify-oauth.mjs')}],compatibilityDate:'2026-09-04',
  bindings:{SPOTIFY_CLIENT_ID:CLIENT,SPOTIFY_RELAY_SIGNING_KEY:SIGNING,...(mode===undefined?{}:{SPOTIFY_ACCESS_MODE:mode})},durableObjects:{SPOTIFY_OAUTH_SESSIONS:{className:'SpotifyOAuthSession',useSQLite:true}},
  ratelimits:{SPOTIFY_START_LIMIT:{namespace_id:'481736294',simple:{limit:8,period:60}},SPOTIFY_POLL_LIMIT:{namespace_id:'481736295',simple:{limit:180,period:60}}}}]}));
 const mf=runtime();
 let checks=0;
 const request=(route,options={})=>mf.dispatchFetch(BASE+route,{...options,redirect:'manual'});
 async function publicPages(){
  for(const route of ['/','/privacidad','/condiciones']){
   const r=await request(route+'?untrusted=ignored');assert.equal(r.status,200);const html=await r.text();assert(html.includes('lang="es"'));assert(html.includes('href="/privacidad"'));assert(html.includes('href="/condiciones"'));assert(html.includes('href="'+BASE+route+'"'));assert(!html.includes('untrusted=ignored'));assert(!r.headers.get('x-robots-tag')?.includes('noindex'));assert.equal(r.headers.get('set-cookie'),null);checks++;
   const head=await request(route,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');checks++;
  }
  let r=await request('/privacy');assert.equal(r.status,308);assert.equal(r.headers.get('location'),'/privacidad');checks++;
  r=await request('/missing-page');assert.equal(r.status,404);checks++;
  r=await request('/privacidad',{method:'POST'});assert.equal(r.status,405);checks++;
  r=await request('/robots.txt');const robots=await r.text();assert(robots.includes('Allow: /'));assert(robots.includes('Disallow: /spotify/'));checks++;
  r=await request('/sitemap.xml');assert.equal(r.status,200);assert(r.headers.get('content-type').startsWith('application/xml'));assert((await r.text()).includes(BASE+'/privacidad'));checks++;
 }
 const post=(route,data,secret,ip='198.51.100.4')=>request(route,{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':ip,...(secret?{Authorization:'Bearer '+secret}:{})},body:JSON.stringify(data)});
 async function start(ip){const reader=random(),launch=random(),nonce=random(),challenge=random();const r=await post('/api/spotify/oauth/start',{nonce,challenge,client_id:CLIENT,read_hash:hash(reader),launch_hash:hash(launch)},null,ip);assert.equal(r.status,201);return {reader,launch,nonce,challenge,...await r.json()};}
 async function launch(flow){const r=await request('/spotify/connect?'+new URLSearchParams({state:flow.state,launch:flow.launch}));assert.equal(r.status,303);const url=new URL(r.headers.get('Location'));assert.equal(url.origin,'https://accounts.spotify.com');assert.equal(url.searchParams.get('redirect_uri'),BASE+'/spotify/callback');assert.equal(url.searchParams.get('code_challenge'),flow.challenge);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('show_dialog'),'true');const cookie=r.headers.get('Set-Cookie');assert(cookie.includes('Secure')&&cookie.includes('HttpOnly')&&cookie.includes('SameSite=Lax'));return cookie.split(';')[0];}
 try{
  await publicPages();
  {const config=await (await request('/api/spotify/config')).json();assert.equal(config.access_mode,'development');assert.equal(config.premium_for_playback,true);assert.equal(config.application_name,'Brivany');checks++;}
  for(const [mode,status] of [['extended',200],['invalid-mode',503]]){
   const check=runtime(mode);try{const response=await check.dispatchFetch(BASE+'/api/spotify/config');assert.equal(response.status,status);if(status===200)assert.equal((await response.json()).access_mode,mode);checks++;}finally{await check.dispose()}
  }
  let r=await request('/');assert.equal(r.status,200);assert((await r.text()).includes('Brivany es una aplicación de escritorio'));checks++;
  r=await request('/spotify/callback');assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store, private');checks++;
  r=await request('/api/spotify/config');assert.equal((await r.json()).redirect_uri,BASE+'/spotify/callback');checks++;
  r=await request('/api/spotify/oauth/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'});assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);checks++;
  r=await post('/api/spotify/oauth/start',{nonce:'bad'});assert.equal(r.status,400);checks++;
  const flow=await start();r=await post('/api/spotify/oauth/poll',{state:flow.state},random());assert.equal(r.status,403);checks++;
  r=await post('/api/spotify/oauth/poll',{state:flow.state},flow.reader);assert.equal((await r.json()).status,'pending');checks++;
  const cookie=await launch(flow);checks++;
  r=await request('/spotify/connect?'+new URLSearchParams({state:flow.state,launch:flow.launch}));assert.equal(r.status,403);checks++;
  r=await request('/spotify/callback?'+new URLSearchParams({state:flow.state,code:'synthetic-code'}));assert.equal(r.status,400);checks++;
  r=await request('/spotify/callback?'+new URLSearchParams({state:flow.state,code:'synthetic-code'}),{headers:{Cookie:cookie}});assert.equal(r.status,200);assert(!(await r.text()).includes('synthetic-code'));assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');checks++;
  r=await request('/spotify/callback?'+new URLSearchParams({state:flow.state,code:'replacement-code'}),{headers:{Cookie:cookie}});assert([403,409].includes(r.status));checks++;
  for(let i=0;i<2;i++){r=await post('/api/spotify/oauth/poll',{state:flow.state},flow.reader);const data=await r.json();assert.equal(data.status,'ready');assert.equal(data.code,'synthetic-code');}checks++;
  r=await post('/api/spotify/oauth/ack',{state:flow.state},random());assert.equal(r.status,403);checks++;
  r=await post('/api/spotify/oauth/ack',{state:flow.state},flow.reader);assert.equal(r.status,200);r=await post('/api/spotify/oauth/poll',{state:flow.state},flow.reader);assert.equal(r.status,410);checks++;
  const denied=await start(),other=await start();const deniedCookie=await launch(denied),otherCookie=await launch(other);
  r=await request('/spotify/callback?'+new URLSearchParams({state:denied.state,error:'access_denied'}),{headers:{Cookie:otherCookie}});assert.equal(r.status,403);checks++;
  r=await request('/spotify/callback?'+new URLSearchParams({state:denied.state,error:'access_denied'}),{headers:{Cookie:deniedCookie}});assert.equal(r.status,200);r=await post('/api/spotify/oauth/poll',{state:denied.state},denied.reader);assert.equal((await r.json()).error,'access_denied');checks++;
  const expiredPayload=random()+'.'+(Math.floor(Date.now()/1000)-1);const expired=expiredPayload+'.'+crypto.createHmac('sha256',SIGNING).update(expiredPayload).digest('base64url');r=await post('/api/spotify/oauth/poll',{state:expired},random());assert.equal(r.status,410);checks++;
  r=await post('/api/spotify/oauth/poll',{state:other.state.slice(0,-1)+(other.state.endsWith('a')?'b':'a')},other.reader);assert.equal(r.status,410);checks++;
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',last=alphabet.indexOf(other.state.at(-1)),alias=other.state.slice(0,-1)+alphabet[last^1];assert(Buffer.from(alias.split('.')[2],'base64url').equals(Buffer.from(other.state.split('.')[2],'base64url')));r=await post('/api/spotify/oauth/poll',{state:alias},other.reader);assert.equal(r.status,410);checks++;
  r=await request('/spotify/return.js');assert((await r.text()).includes('replaceState'));checks++;
  r=await post('/api/spotify/oauth/start',{nonce:random(),challenge:random(),client_id:CLIENT,read_hash:hash(random()),launch_hash:hash(random()),redirect_uri:'https://untrusted.example'});assert.equal(r.status,400);checks++;
  for(let i=0;i<8;i++)await start('198.51.100.99');r=await post('/api/spotify/oauth/start',{nonce:random(),challenge:random(),client_id:CLIENT,read_hash:hash(random()),launch_hash:hash(random())},null,'198.51.100.99');assert.equal(r.status,429);checks++;
  const report={status:'passed',checks,runtime:'local workerd/Miniflare with SQLite Durable Objects and rate limit bindings',local_compatibility_date:'2026-09-04',production_compatibility_date:'2026-10-31',spotify_requests:0,real_accounts:false,notes:['HTTPS callback and fixed PKCE redirect','signed expiring state and single-use browser launch','separate read credential and browser cookie bound to flow','cross-flow, replay, expired, tampered and cross-origin rejection','retry-safe poll; acknowledgement clears authorization code','no-store/no-referrer, URL cleanup and bounded input']};
  fs.mkdirSync('tmp/spotify-https-relay',{recursive:true});fs.writeFileSync('tmp/spotify-https-relay/local-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
