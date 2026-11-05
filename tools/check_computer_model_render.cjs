'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,scene=process.env.BRIVANY_MODEL_SCENE,dir='tmp/computer-model-real';
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const context=await browser.newContext({viewport:{width:1120,height:760},serviceWorkers:'block'}),errors=[],external=[];
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.protocol.startsWith('http')&&u.origin!==base){external.push(u.origin);return route.abort();}return route.continue();});
  await context.addInitScript(()=>{if(parent!==window)return;window.pywebview={api:{authorize_computer:async()=>{const r=await fetch('/__computer-test/arm',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.json();}}};});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/brivany-shell');await page.locator('#live-launch').click();
  const ui=page.frameLocator('#module-frame');await ui.getByRole('button',{name:'Activar control',exact:true}).click();
  await ui.getByRole('button',{name:'Ver modelo',exact:true}).click();
  const live=page.frames().find(f=>new URL(f.url()).pathname==='/app');await ui.locator('.computer-preview iframe').waitFor();
  const viewer=live.childFrames()[0];await viewer.waitForFunction(()=>document.querySelector('#spatial-canvas')?.dataset.ready==='true',{},{timeout:30000});
  assert.equal(await viewer.locator('.object-button').count(),5);assert((await viewer.locator('#space-origin').textContent()).includes('Demo'));
  const mic=await live.locator('#mic-toggle').boundingBox();assert(mic);const dimensions=await live.evaluate(()=>({width:innerWidth,height:innerHeight}));
  const micInViewport=mic.x>=0&&mic.y>=0&&mic.x+mic.width<=1120&&mic.y+mic.height<=760;
  await page.screenshot({path:dir+'/live-model-desktop.png'});await viewer.locator('#spatial-canvas canvas').screenshot({path:dir+'/model-canvas.png'});
  await viewer.getByText('Piezas del modelo',{exact:true}).click();await viewer.locator('.object-button').first().click();assert((await viewer.locator('#selected-label').textContent()).length>0);
  await viewer.getByText('Piezas del modelo',{exact:true}).click();
  await ui.getByRole('button',{name:'Notas y contexto',exact:true}).click();await ui.getByRole('button',{name:'Cerrar notas y contexto',exact:true}).click();
  await ui.getByText('Opciones',{exact:true}).click();assert(await ui.getByRole('button',{name:'Elegir carpeta',exact:true}).isVisible());await live.locator('body').press('Escape');assert(!(await ui.getByRole('button',{name:'Elegir carpeta',exact:true}).isVisible()));
  const viewports=[];
  for(const [width,height] of [[768,844],[390,844],[320,844],[390,568],[640,480]]){
   await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const mic=await live.locator('#mic-toggle').boundingBox(),canvas=await viewer.locator('#spatial-canvas').boundingBox();
   viewports.push({width,height,mic,canvas});assert(mic&&mic.x>=0&&mic.y>=0&&mic.x+mic.width<=width+1&&mic.y+mic.height<=height+1,'Mic outside '+width+'x'+height);assert(canvas&&canvas.width>=100&&canvas.height>=60,'Canvas too small '+width+'x'+height);
   assert(await ui.locator('#voice-notice').isVisible(),'El estado o error de voz debe seguir visible.');
  }
  await page.setViewportSize({width:320,height:844});await page.screenshot({path:dir+'/live-model-320.png'});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={status:micInViewport?'passed':'failed',native_bridge:'substituted',renderer:'real WebGL; software permitted',physical_gpu_verified:false,microphone_activated:false,model_scene_matches:viewer.url().includes(scene),object_count:5,mic_in_desktop_viewport:micInViewport,mic_bounds:mic,live_dimensions:dimensions,viewports,object_selection_verified:true,options_and_context_close_verified:true,errors,external_requests:external};
  assert(report.model_scene_matches);fs.writeFileSync(dir+'/render-report.json',JSON.stringify(report,null,2));
  assert(micInViewport,'El micrófono debe quedar dentro de la ventana junto al modelo.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
