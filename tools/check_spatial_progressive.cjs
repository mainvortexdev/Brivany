'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const base=process.env.BRIVANY_TEST_URL,id=process.env.BRIVANY_PROGRESSIVE_SCENE,context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),external=[],errors=[],checks=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const payload=await (await page.request.get(base+'/api/spatial/scenes/'+id)).json();assert.ok(payload.scene.assets.length>=2);
  const last=payload.scene.assets.at(-1).id;let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/spatial/assets/'+id+'/'+last+'?**',async route=>{await gate;await route.continue().catch(()=>{});});
  await page.goto(base+'/spaces?space='+id);await page.waitForFunction(()=>document.querySelector('#viewport-shell').dataset.loadPhase==='partial');
  assert.equal(await page.locator('#viewport-loading').isHidden(),true);assert.equal(await page.locator('#viewport-progress').isVisible(),true);
  const canvas=page.locator('#spatial-canvas');assert.equal(await canvas.getAttribute('data-ready'),'false');assert.ok(Number(await canvas.getAttribute('data-objects'))>0);
  assert.equal(await page.locator('#export-space').isDisabled(),true);assert.equal(await page.locator('#mode-move').isDisabled(),true);
  const before=Date.now();release();await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true');
  const releaseToReadyMs=Date.now()-before;
  assert.equal(await page.locator('#viewport-progress').isHidden(),true);assert.equal(await page.locator('#export-space').isEnabled(),true);
  checks.push('partial geometry is rendered before the last GLB arrives; UI gates editing/export until all assets finish');
  await page.evaluate(async payload=>{
   const {SpatialViewer}=await import('/spatial-viewer.js');const holder=document.createElement('div');holder.style.cssText='position:fixed;inset:0;width:600px;height:400px';document.body.append(holder);
   const events=[];window.progressiveViewer=new SpatialViewer(holder,{onProgress:event=>events.push(event)});window.progressiveEvents=events;
   const viewer=window.progressiveViewer;await viewer.load(payload);window.progressiveResourceStats=viewer.renderStats();
  },payload);
  const stats=await page.evaluate(()=>window.progressiveResourceStats);assert.ok(stats.load.firstVisibleMs<=stats.load.elapsedMs);assert.ok(stats.resources.geometryArrayBufferBytes>0);assert.equal(stats.resources.gpuMemoryMeasured,false);
  checks.push('load timings and retained geometry bytes are reported with GPU memory explicitly unmeasured');
  await page.evaluate(async payload=>{
   const viewer=window.progressiveViewer;const fetchOriginal=window.fetch;let seen=0,release;const gate=new Promise(resolve=>release=resolve);
   window.fetch=async (...args)=>{if(++seen===2)await gate;return fetchOriginal(...args);};
   const pending=viewer.load(payload);while(viewer.entries.size===0)await new Promise(resolve=>setTimeout(resolve,5));
   viewer.cancelLoad();release();const result=await pending;window.fetch=fetchOriginal;
   if(!result.cancelled || viewer.entries.size || viewer.container.dataset.ready==='true')throw Error('Cancelled load became visible');
  },payload);
  checks.push('cancel during a later request removes the partial scene and cannot publish late geometry');
  await page.evaluate(async payload=>{
   const viewer=window.progressiveViewer,fetchOriginal=window.fetch;let count=0;
   window.fetch=async (...args)=>++count===2?new Response('fixture failure',{status:503}):fetchOriginal(...args);
   let rejected=false;try{await viewer.load(payload);}catch{rejected=true;}finally{window.fetch=fetchOriginal;}
   if(!rejected || viewer.entries.size || viewer.container.dataset.ready==='true')throw Error('Incomplete load retained geometry');
   await viewer.load(payload);if(viewer.container.dataset.ready!=='true')throw Error('Explicit reload failed');
   viewer.dispose();viewer.dispose();
  },payload);
  checks.push('later asset failure clears partial geometry; an explicit reload succeeds and resources can be released');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const directory=path.resolve('tmp/spatial-progressive');fs.mkdirSync(directory,{recursive:true});
  const report={status:'passed',checks,scope:'Loopback HTTP, generated GLBs and actual WebGL with software rendering permitted; gated transfer is synthetic.',external_calls:0,gpu_inference:false,physical_devices_tested:false,gpu_memory_measured:false,last_asset_release_to_ready_ms:releaseToReadyMs,load:stats.load,resources:stats.resources};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
