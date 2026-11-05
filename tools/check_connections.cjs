'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,artifacts=path.resolve(__dirname,'../tmp/connections');
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[],external=[],posts=[],checks=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
 await page.goto(base+'/connections');await page.waitForFunction(()=>document.querySelectorAll('.account').length===4);assert.equal(posts.length,0);
 for(const selector of ['#google-config','#operation-form','#enable-execution','#chat-requests','#social-connections','#personal-reminders'])assert.equal(await page.locator(selector).count(),0);
 checks.push('opening accounts is read-only and removed configuration/action/social/reminder surfaces are absent');
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/integrations/google/begin');await page.locator('.account[data-connector=drive] button').click();const begin=await(await pending).json(),url=new URL(begin.authorization_url);
 assert.equal(url.hostname,'accounts.google.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert(!JSON.stringify(begin).includes('code_verifier'));
 const callback=base+'/api/integrations/google/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code',iss:'https://accounts.google.com'});
 assert.equal((await page.request.get(callback)).status(),200);assert.equal((await page.request.get(callback)).status(),403);
 await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('.account[data-connector=drive]').textContent.includes('simulada'));assert(await page.locator('#disconnect-google').isVisible());
 checks.push('explicit account linking preserves PKCE, callback replay rejection and honest simulated status');
 const post=async(route,data)=>{const r=await page.request.post(base+route,{data,headers:{Origin:base}});assert(r.ok(),route+': '+r.status());return r.json();};
 await post('/api/integrations/settings',{execution_enabled:true});
 for(let i=0;i<2;i++){
  const p=await post('/api/integrations/proposals',{operation:'drive.search',parameters:{query:'Plano'},request_id:crypto.randomUUID()});
  const a=await post('/api/integrations/approve',{proposal_id:p.id,action_sha256:p.action_sha256});
  const r=await post('/api/integrations/execute',{proposal_id:p.id,parameters:p.parameters,approval_id:a.approval_id,execute:true});
  assert.equal(r.state,'succeeded_test_stub');assert.equal(r.result_persisted,false);assert(JSON.stringify(r.result).includes('Plano sintético'));
 }
 checks.push('removing forms preserves reviewed backend operations and ephemeral results');
 const rejected=await page.request.post(base+'/api/integrations/proposals',{headers:{Origin:'https://unrelated.invalid'},data:{operation:'drive.search',parameters:{query:'blocked'}}});assert.equal(rejected.status(),403);
 await page.reload();await page.waitForFunction(()=>document.querySelector('.account[data-connector=drive]')?.textContent.includes('simulada'));
 assert((await page.locator('h1').evaluate(el=>getComputedStyle(el).fontFamily)).includes('Georgia'));
 assert((await page.locator('#refresh').evaluate(el=>getComputedStyle(el).fontFamily)).includes('Segoe UI'));
 checks.push('reloading retains account state; headings use Georgia and controls use Segoe UI');
 fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'connections-1440.png'),fullPage:true});
 for(const width of [320,390,768]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await page.screenshot({path:path.join(artifacts,'connections-390.png'),fullPage:true});checks.push('accounts fit desktop and narrow viewports');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:'passed',scope:'Loopback HTTP, OAuth state/DPAPI and account UI; provider and browser launch substituted.',checks,screenshots:['tmp/connections/connections-1440.png','tmp/connections/connections-390.png']},null,2));await context.close();
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
