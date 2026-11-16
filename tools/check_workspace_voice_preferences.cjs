'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
 try{
  const context=await browser.newContext({viewport:{width:560,height:112}});
  await context.route('**/*',route=>{const url=new URL(route.request().url());let file;if(url.pathname==='/voice')file=path.join(root,'desktop/experience/work-voice.html');else if(url.pathname==='/storage')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local preference owner</title>'});else if(url.pathname.startsWith('/desktop-shell/'))file=path.join(root,'desktop/experience',path.basename(url.pathname));if(!file||!fs.existsSync(file))return route.abort();return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});});
  await context.addInitScript(()=>{window.__paints=0;const clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...args){window.__paints++;return clear.apply(this,args)};window.pywebview={api:{workspace_chat_state:async()=>({messages:[],listening:false,pending:false})}};});
  const owner=await context.newPage();await owner.goto('http://brivany.test/storage');
  const store=preferences=>owner.evaluate(value=>localStorage.setItem('brivany.workspace.widgets.v1',JSON.stringify({preferences:value})),preferences);
  await store({motion:false,economy:true,theme:'soft',accent:'mint'});
  const voice=await context.newPage();voice.on('pageerror',e=>errors.push(e.message));await voice.goto('http://brivany.test/voice');await voice.waitForFunction(()=>!!window.BrivanyWorkspace);
  assert.deepEqual(await voice.evaluate(()=>({motion:document.body.dataset.motion,economy:document.body.dataset.economy,theme:document.body.dataset.theme,accent:document.body.dataset.accent})),{motion:'false',economy:'true',theme:'soft',accent:'mint'});
  await voice.evaluate(()=>window.BrivanyWorkspace.receive({listening:true,level:.1,samples:Array(48).fill(.08)}));await voice.waitForTimeout(200);await voice.evaluate(()=>window.__paints=0);await voice.waitForTimeout(500);assert.equal(await voice.evaluate(()=>window.__paints),0,'Disabling animation must stop the ongoing paint loop.');
  await store({motion:true,economy:true,theme:'dark',accent:'rose'});await voice.waitForFunction(()=>document.body.dataset.motion==='true'&&document.body.dataset.accent==='rose');
  await voice.waitForTimeout(100);await voice.evaluate(()=>window.__paints=0);await voice.waitForTimeout(800);const economical=await voice.evaluate(()=>window.__paints);assert(economical>3&&economical<=30,'Economy paints at most about 30 fps.');
  await store({motion:true,economy:false});await voice.waitForFunction(()=>document.body.dataset.economy==='false');await voice.evaluate(()=>window.__paints=0);await voice.waitForTimeout(800);const regular=await voice.evaluate(()=>window.__paints);assert(regular>economical,'Regular mode should retain the smoother waveform cadence.');
  await voice.emulateMedia({reducedMotion:'reduce'});await voice.waitForTimeout(100);await voice.evaluate(()=>window.__paints=0);await voice.waitForTimeout(500);assert.equal(await voice.evaluate(()=>window.__paints),0,'OS reduced motion overrides the animation preference.');
  await voice.evaluate(()=>window.BrivanyWorkspace.receive({listening:false,reply_visible:true,reply_text:'Respuesta sintética local'}));await voice.getByText('Respuesta sintética local',{exact:true}).waitFor();assert.deepEqual(errors,[]);
  fs.mkdirSync(path.join(root,'tmp/workspace-runtime'),{recursive:true});fs.writeFileSync(path.join(root,'tmp/workspace-runtime/voice-preferences.json'),JSON.stringify({mode:'real_local_browser_synthetic_services',checks:['saved_flags_at_lazy_start','storage_propagation','motion_off_stops_loop','economy_cadence','os_reduced_motion','reply_replay'],economy_paints_800ms:economical,regular_paints_800ms:regular,provider_calls:0,physical_microphone:false},null,2)+'\n');
  console.log('Lazy voice view preferences, waveform economy, reduced motion and reply replay passed.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
