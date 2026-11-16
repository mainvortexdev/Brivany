'use strict';
const {chromium}=require('../motion-studio/node_modules/playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:8891',out=path.join(root,'tmp/chat-progress-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
 try{
  const context=await browser.newContext({viewport:{width:900,height:750}});await context.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/chat-activity.css"><script src="/chat-activity.js" defer></script><body><main id="mount"></main></body>'});
   const file=path.join(root,'desktop/experience',path.basename(url.pathname));if(!fs.existsSync(file))return route.fulfill({status:404,body:''});return route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(file)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto(base);await page.waitForFunction(()=>window.BrivanyChatActivity);
  for(const kind of ['image','motion']){
   await page.evaluate(kind=>{window.__entry={id:'pending-'+kind,kind,state:'running',phase:'Estoy creando el archivo',progress:{percent:1,estimated:true},events:[]};document.querySelector('#mount').replaceChildren(BrivanyChatActivity.card(__entry,window));window.__spinner=document.querySelector('.execution-video-loading')._loaderSpin},kind);
   const preview=page.locator('.execution-video-loading'),percent=preview.getByRole('progressbar'),initial=await preview.boundingBox();assert.equal(await percent.getAttribute('aria-valuenow'),'1');assert.match(await percent.getAttribute('title')||await percent.evaluate(e=>e.title),/estimado/i);
   await page.clock.runFor(1000);await page.clock.fastForward(14000);await page.clock.runFor(700);const moving=Number(await percent.getAttribute('aria-valuenow'));assert.ok(moving>1&&moving<90);
   await page.evaluate(()=>{BrivanyChatActivity.update(__entry,{...__entry,progress:{percent:1,estimated:true}});document.querySelector('#mount').append(BrivanyChatActivity.card(__entry,window))});assert.equal(await page.evaluate(()=>document.querySelector('.execution-video-loading')._loaderSpin===__spinner),true);
   assert.deepEqual(await preview.boundingBox(),initial);
   await page.clock.fastForward(600000);await page.clock.runFor(2000);const capped=Number(await percent.getAttribute('aria-valuenow'));assert.ok(capped>=moving&&capped<=90);assert.equal(await page.locator('[data-state="running"]').count(),1);
   await page.evaluate(()=>{BrivanyChatActivity.update(__entry,{...__entry,state:'succeeded',result:{verified:true},progress:{percent:100,estimated:false}});document.querySelector('#mount').append(BrivanyChatActivity.card(__entry,window))});assert.equal(await preview.count(),0);checks.push(kind+': starts at one, advances as an estimate without provider updates, stays bounded, preserves geometry and spinner, clears on completion');
  }
  assert.deepEqual(errors,[]);const report={passed:true,mode:'owned_headless_browser_accelerated_clock',external_calls:0,checks,errors};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
