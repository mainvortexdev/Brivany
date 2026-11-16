'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'../motion-studio/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/agent-avatars-ui');fs.mkdirSync(out,{recursive:true});
const html='<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/blobatar-motion.css"><link rel="stylesheet" href="/agent-avatars.css"><style>body{background:#101215;color:#eef1f3;font:13px Segoe UI;margin:32px}.gallery{display:flex;gap:14px}.card{width:90px;text-align:center;border:1px solid #ffffff15;border-radius:14px;padding:14px 8px}.face{width:64px;height:64px;margin:0 auto 10px}button{color:inherit;background:transparent;border:0}.agent-alert{margin-top:24px;display:flex;gap:10px;align-items:center;padding:12px;border:1px solid #ffffff20;border-radius:12px}.agent-alert[hidden]{display:none}button:focus-visible{outline:1px solid #8bc1ff}</style><body data-motion="true"><div class="gallery"></div><script src="/agent-avatars.js" defer></script><script src="/agents.js" defer></script></body></html>';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:760,height:250}}),errors=[],external=[];
 try{
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.hostname!=='avatars.test'){external.push(u.hostname);return route.abort()}
   if(u.pathname==='/brivany-shell')return route.fulfill({contentType:'text/html',body:html.replace('<style>','<style nonce="avatar-fixture">'),headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'nonce-avatar-fixture'; style-src-attr 'none'; img-src 'self' data:; object-src 'none'"}});
   const name=path.basename(u.pathname);if(!['blobatar-motion.css','agent-avatars.css','agent-avatars.js','agents.js'].includes(name))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:name.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(path.join(root,'desktop/experience',name))});
  });
  await context.addInitScript(()=>{window.__styleViolations=[];addEventListener('securitypolicyviolation',event=>{if(event.effectiveDirective.startsWith('style-src'))__styleViolations.push(event.effectiveDirective)})});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://avatars.test/brivany-shell');await page.waitForFunction(()=>window.BrivanyAgentAvatars&&window.BrivanyAgents);
  await page.evaluate(()=>{
   window.__jobs=['document','image','research','terminal','model','personal'].map((kind,index)=>({id:'fixture-'+index,agent_key:'team:'+kind,kind,state:'running',title:kind,agent:kind}));
   for(const job of __jobs){const button=document.createElement('button');button.className='card';const face=document.createElement('span');face.className='face';button.append(face,document.createTextNode(job.kind));document.querySelector('.gallery').append(button);BrivanyAgentAvatars.render(face,job)}
  });
  await page.waitForFunction(()=>document.querySelectorAll('[data-avatar-motion=running]').length===6);
  const before=await page.locator('.face .mo-breathe').first().evaluate(element=>getComputedStyle(element).transform);
  await page.waitForTimeout(220);
  const after=await page.locator('.face .mo-breathe').first().evaluate(element=>getComputedStyle(element).transform);assert.notEqual(before,after);
  const motion=await page.locator('.face').first().evaluate(host=>{
   const float=host.querySelector('.mo-breathe').getAnimations().find(a=>a.animationName==='briva-agent-float'),eye=host.querySelector('.mo-eyes'),blink=host.querySelector('.mo-eye>*').getAnimations().find(a=>a.animationName==='briva-agent-blink');
   const samples=[0,.25,.46,.5,.75,1].map(t=>{float.pause();float.currentTime=t*float.effect.getTiming().duration;return {eye:getComputedStyle(eye).translate,pose:getComputedStyle(eye).transform,float:getComputedStyle(host.querySelector('.mo-breathe')).transform}});
   blink.pause();const duration=blink.effect.getTiming().duration,delay=blink.effect.getTiming().delay;blink.currentTime=delay+duration*.2;const open=getComputedStyle(blink.effect.target).transform;blink.currentTime=delay+duration*.46;const closed=getComputedStyle(blink.effect.target).transform;float.play();blink.play();return {samples,open,closed};
  });
  assert(motion.samples.every(sample=>sample.eye==='none'&&sample.pose==='none'),'Eyes must not dart separately from the body');assert.notEqual(motion.open,motion.closed,'Eyes must still blink');
  assert(motion.samples.every(sample=>{const values=sample.float.slice(7,-1).split(',').map(Number);return Math.abs(values[4])<.7&&Math.abs(values[5])<1.7&&Math.abs(Math.atan2(values[1],values[0])*180/Math.PI)<1.3}),'Float must remain subtle');
  await page.screenshot({path:path.join(out,'gallery.png')});
  await page.evaluate(()=>{BrivanyAgentAvatars.render(document.querySelector('.face'),{...__jobs[0],state:'succeeded'});BrivanyAgents.observe([__jobs[2]]);BrivanyAgents.observe([{...__jobs[2],state:'succeeded',reviewed:false}]);window.__successNotice=!!document.querySelector('.agent-alert:not([hidden])');BrivanyAgents.observe([{...__jobs[2],state:'failed',reviewed:false}])});
  await page.locator('.agent-alert-avatar svg').waitFor();assert.equal(await page.locator('.agent-alert-avatar').isVisible(),true);
  const pair=await page.evaluate(()=>[document.querySelectorAll('.face')[2].dataset.agentAvatar,document.querySelector('.agent-alert-avatar').dataset.agentAvatar]);assert.equal(pair[0],pair[1]);
  await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'expressions.png')});
  assert(await page.locator('[data-agent-avatar] svg').evaluateAll(nodes=>nodes.every(svg=>{
   const head=svg.querySelector('.mo-bob>g').getBoundingClientRect();
   return [...svg.querySelectorAll('.mo-eye')].every(eye=>{const rect=eye.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;return x>=head.left&&x<=head.right&&y>=head.top&&y<=head.bottom});
  })),'Eye centers must stay within their own face under the app CSP');
  assert.deepEqual(await page.evaluate(()=>__styleViolations),[]);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'))});
  assert(await page.locator('[data-agent-avatar]').evaluateAll(nodes=>nodes.every(node=>node.dataset.avatarMotion==='paused')));
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-agent-avatar]')].every(node=>node.dataset.avatarMotion==='paused'));
  assert.equal(await page.locator('.gallery').evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length),0);
  await page.evaluate(()=>{document.querySelector('.agent-dismiss').click();BrivanyAgentAvatars.close()});
  assert.equal(await page.evaluate(()=>BrivanyAgentAvatars.count()),0);assert.equal(await page.locator('[data-agent-avatar]').count(),0);
  assert.equal(await page.evaluate(()=>__successNotice),false);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={passed:true,scope:'owned_DOM_local_Blobatar_and_actual_notification_script',agents:6,external_calls:0,checks:['distinct_renderers','gentle_float_without_scaling','stationary_gaze','blink_preserved','notification_identity','CSP_without_style_attributes','eye_containment','visibility_event_pause','reduced_motion','cleanup'],errors};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(error=>{console.error(error.stack);process.exitCode=1});
