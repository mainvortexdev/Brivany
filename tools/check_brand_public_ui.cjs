'use strict';
const {chromium}=require('../motion-studio/node_modules/playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const origin='https://brivany.vetsa.es',checks=[],out='tmp/brand-public-ui';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1100,height:800},reducedMotion:'reduce'}),page=await context.newPage(),external=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  for(const [route,selector]of [['/','h1'],['/privacidad','h1'],['/transfer/','h1'],['/transfer/drop/','h1']]){
   const response=await page.goto(origin+route);assert.equal(response.status(),200,route);await page.locator(selector).waitFor();
   await page.evaluate(async()=>{await Promise.all([300,400,500].map(w=>document.fonts.load(w+' 24px "Brivany Editorial"')));await document.fonts.ready});
   const faces=await page.evaluate(()=>[...document.fonts].filter(f=>f.family.includes('Brivany Editorial')&&f.status==='loaded').length);assert.equal(faces,3,route);
   const session=await context.newCDPSession(page);await session.send('DOM.enable');await session.send('CSS.enable');const {root}=await session.send('DOM.getDocument');const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});const {fonts}=await session.send('CSS.getPlatformFontsForNode',{nodeId});await session.detach();assert(fonts.some(f=>f.familyName==='Brivany Editorial'&&f.isCustomFont&&f.glyphCount>0),route);
   checks.push({route,status:200,real_custom_font:true,faces_loaded:faces});await page.screenshot({path:path.join(out,route==='/'?'home.png':route.includes('drop')?'qr-paired.png':route.includes('transfer')?'qr-file.png':'privacy.png')});
  }
  assert.deepEqual(external,[]);const report={passed:true,mode:'real_public_https_owned_headless_browser_no_accounts',checks,model_requests:0,tts_requests:0,transfer_sessions_created:0,personal_files:0};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
