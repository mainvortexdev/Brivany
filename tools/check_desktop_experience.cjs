'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/desktop-presentation';fs.mkdirSync(dir,{recursive:true});
 assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const checks=[],errors=[],external=[],failures=[];
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol.startsWith('http') && url.origin!==base){external.push(url.origin);return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    if(window.parent!==window)return;
    window.__nativeCalls=[];
    const methods=['status','pick_project_folder','save_current_project','save_open_project','export_open_project','get_floorplan','save_floorplan','get_presentation','save_presentation'];
    window.pywebview={api:Object.fromEntries(methods.map(name=>[name,async()=>{window.__nativeCalls.push(name);return {ok:true,desktop:true,project:null,cancelled:true};}]))};
  });
  for(const size of [{width:1440,height:900},{width:1120,height:760},{width:1024,height:600},{width:768,height:600},{width:390,height:844},{width:320,height:568}]){
   await page.setViewportSize(size);await page.goto(base+'/brivany-shell');
   await page.waitForFunction(()=>document.querySelector('#service-summary').textContent!=='Local');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Shell horizontal overflow '+size.width);
   for(const key of ['melodi','spaces','skills','practice','video','sous','connections','activity','notes','social','services']){
    const button=page.locator(`[data-key="${key}"]`);await button.scrollIntoViewIfNeeded();await button.click();
    const f=page.frameLocator('#module-frame');await f.locator('body').waitFor();
    await page.waitForFunction(()=>{const f=document.querySelector('iframe');return f.contentDocument?.readyState==='complete' && f.contentDocument?.body?.innerText.length>15;});
    assert(await page.locator('#home-view').isHidden(),'Home remained visible '+key);
    const metrics=await f.locator('body').evaluate(body=>({width:innerWidth,scroll:document.documentElement.scrollWidth,title:document.title}));
    if(metrics.scroll>metrics.width+1)failures.push({...size,key,...metrics});
    if(key==='activity'){
      await page.waitForFunction(()=>{const d=document.querySelector('iframe').contentDocument;return d.querySelectorAll('.activity-item').length===Number(d.querySelector('#entry-count').textContent.replace(/\D/g,''));},{},{timeout:30000});
    }
    if(key==='melodi')assert(await f.locator('#mic-toggle').isVisible(),'Live button unavailable');
    if(key==='spaces'){
      await page.waitForFunction(()=>window.__nativeCalls.includes('status'));
      assert(await f.locator('#desktop-project-actions').isVisible(),'Native project actions missing');
    }
    checks.push({viewport:size,key,...metrics});
    if(size.width===1120 || (size.width===390 && ['melodi','spaces','connections'].includes(key)))await page.screenshot({path:`${dir}/${key}-${size.width}.png`});
   }
  }
  const config=await (await context.request.get(base+'/api/desktop/services')).json();
  const apiChecks=[];
  for(const path of ['/api/status','/api/translation/status','/api/spatial/spaces','/api/spatial/reconstruction/status','/api/human-skills','/api/sous/inventory','/api/sous/catalog','/api/sous/voice/status','/api/integrations/status','/api/personal/notes','/api/personal/reminders','/api/activity']){
    const response=await context.request.get(base+path);apiChecks.push({path,status:response.status()});assert.equal(response.status(),200,'Local API '+path);
  }
  const report={checks,api_checks:apiChecks,native_bridge:'forwarded to synthetic parent; no native chooser or project write',overflow_failures:failures,page_errors:errors,blocked_external_origins:[...new Set(external)],configuration:config,external_calls:0,provider_inference_calls:0,physical_microphone_verified:false};
  fs.writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:checks.length,overflow_failures:failures,page_errors:errors,configured_services:config.services.filter(x=>x.configured).length},null,2));
  assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
