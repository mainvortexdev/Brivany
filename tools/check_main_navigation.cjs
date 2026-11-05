'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL || 'http://127.0.0.1:8765',directory=path.resolve('tmp/brivany-main-ui');fs.mkdirSync(directory,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'}),page=await context.newPage(),errors=[],external=[];let sockets=0;
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(new URL(route.request().url()).origin);return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));page.on('websocket',()=>sockets++);
  await page.goto(base+'/');await page.screenshot({path:path.join(directory,'main-1440.png'),fullPage:true});
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(directory,'main-390.png'),fullPage:true});
  await page.getByRole('link',{name:'Abrir traducción',exact:false}).click();assert.equal(new URL(page.url()).pathname,'/dubbing');
  await page.waitForFunction(()=>!document.querySelector('#status').textContent.includes('Preparando conexión'));
  assert.equal(await page.locator('#voice-mode').inputValue(),'masculine');assert.equal(await page.locator('button').count(),3);
  assert.equal(await page.locator('#remaining').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(directory,'dubbing-390.png'),fullPage:true});
  assert.equal(sockets,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={status:'passed',main_url:base+'/',canonical_translation_url:base+'/dubbing',checks:['main homepage and canonical translation render at desktop/mobile sizes','home CTA opens the integrated translator','masculine Daniel selected; no daily quotas','opening main pages starts no provider socket or remote request'],websocket_connections:sockets,external_calls:0,provider_inference_calls:0,physical_playback_verified:false,errors};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
