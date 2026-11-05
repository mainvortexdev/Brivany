'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),base=process.env.BRIVANY_TEST_URL,dir='tmp/motion-ui';fs.mkdirSync(dir,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1120,height:760}});await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.addInitScript(()=>{if(parent!==window)return;window.__opened=[];window.pywebview={api:{authorize_computer:async()=>(await fetch('/__computer-test/arm',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json(),open_motion_result:async(id,kind)=>{window.__opened.push({id,kind});return {ok:true};}}};});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/brivany-shell');const ui=page.frameLocator('#module-frame');await ui.locator('#chat-message').fill('fixture motion');await ui.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
  await page.locator('.agent-alert').filter({hasText:'Agente de motion graphics'}).waitFor();await page.locator('.agent-alert').getByRole('button',{name:'Ver resultado',exact:true}).click();
  const video=ui.getByLabel('Video creado por Melodi');await video.waitFor();await page.waitForFunction(()=>document.querySelector('#module-frame')?.contentDocument?.querySelector('video')?.readyState>=1);
  const filmFrame=page.frames().find(item=>new URL(item.url()).pathname==='/app');await filmFrame.evaluate(()=>document.querySelector('video').play());
  await page.waitForFunction(()=>document.querySelector('#module-frame')?.contentDocument?.querySelector('video')?.currentTime>1);
  const playback=await filmFrame.evaluate(()=>{const v=document.querySelector('video');return {currentTime:v.currentTime,duration:v.duration,muted:v.muted,volume:v.volume,audioDecodedBytes:v.webkitAudioDecodedByteCount||0};});
  assert.equal(playback.muted,false);assert(playback.volume>0);if(process.env.BRIVANY_MOTION_TEST_FILE)assert(playback.audioDecodedBytes>0);
  await filmFrame.evaluate(()=>document.querySelector('video').pause());
  await ui.getByRole('button',{name:'Abrir video',exact:true}).click();await ui.getByRole('button',{name:'Abrir proyecto',exact:true}).click();await ui.getByRole('button',{name:'Abrir carpeta',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.__opened.map(item=>item.kind)),['video','project','folder']);
  for(const width of [1120,768,390,320]){await page.setViewportSize({width,height:760});const frame=page.frames().find(item=>new URL(item.url()).pathname==='/app');assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:dir+'/motion-'+width+'.png'});}
  assert.deepEqual(errors,[]);fs.writeFileSync(dir+'/report.json',JSON.stringify({passed:true,type:'real_local_UI_and_MP4_with_substituted_motion_and_bridge',widths:[1120,768,390,320],playback,physical_output_heard:false,model_calls:0},null,2));console.log('Motion preview, MP4 metadata and three result actions passed at four widths.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
