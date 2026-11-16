'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('../motion-studio/node_modules/playwright-core');
(async()=>{
 const root=path.resolve(__dirname,'..'),process=spawn(path.join(root,'.venv/Scripts/python.exe'),['-X','utf8','-B','-m','tools.preview_agents','--serve-only'],{cwd:root,stdio:['ignore','pipe','pipe']});
 let browser;try{
  const base=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Preview server did not start')),10000);process.stdout.on('data',data=>{text+=data;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n')[0]).url)}});process.on('error',reject)});
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1120,height:800}}),external=[],errors=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(external.push(route.request().url()),route.abort()));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('.preview-agent').first().waitFor();assert.equal(await page.locator('.preview-agent').count(),4);
  const frame=page.frameLocator('#preview-chat');await frame.getByLabel('Video en preparación').waitFor();await frame.getByLabel('Imagen en preparación').waitFor();
  const chat=page.frames().find(f=>new URL(f.url()).pathname==='/app');
  const geometry=await chat.evaluate(async()=>{
   const previews=[...document.querySelectorAll('.execution-video-loading')],before=previews.map(el=>({kind:el.dataset.mediaKind,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})),samples=[],mutations=[];
   const observer=new MutationObserver(records=>{for(const record of records)for(const removed of record.removedNodes)if(previews.some(el=>removed===el||removed.contains?.(el)))mutations.push('preview detached')});observer.observe(document.querySelector('#chat-messages'),{childList:true,subtree:true});
   for(let i=0;i<30;i++){
    if(i%6===0)BrivanyChat.observeImageJob({id:'geometry-'+i},'Texto local con aparición progresiva. '.repeat(12));
    if(i===10||i===20)await parent.fetch('/api/demo/next',{method:'POST'});
    await new Promise(resolve=>setTimeout(resolve,70));samples.push(previews.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
   }
   observer.disconnect();return {before,samples,mutations,retained:previews.every(el=>el.isConnected&&el===document.querySelector('[data-task-id="'+el.closest('.execution-card').dataset.taskId+'"] .execution-video-loading'))};
  });
  assert.equal(geometry.retained,true);assert.deepEqual(geometry.mutations,[]);assert(geometry.samples.every(sample=>sample.every((size,i)=>Math.abs(size.width-geometry.before[i].width)<.1&&Math.abs(size.height-geometry.before[i].height)<.1)),'Image and video preview dimensions must stay fixed through text and progress updates');
  await page.setViewportSize({width:320,height:720});assert(await frame.locator('.execution-video-loading').evaluateAll(nodes=>nodes.every(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.right<=innerWidth&&Math.abs(r.height/r.width-(el.dataset.mediaKind==='image'?1:16/9))<.01})));await page.setViewportSize({width:1120,height:800});
  await page.getByRole('button',{name:'Siguiente etapa'}).click();await page.getByRole('button',{name:'Pausar',exact:true}).click();await page.waitForFunction(()=>document.body.dataset.motion==='false');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.waitForFunction(()=>document.body.dataset.motion==='true');
  fs.mkdirSync('tmp/agents-preview-ui',{recursive:true});await page.screenshot({path:'tmp/agents-preview-ui/preview.png'});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={passed:true,scope:'isolated_native_preview_UI_in_owned_headless_browser',agents:4,real_jobs_started:0,external_requests:0,checks:['actual_avatar_components','actual_chat_components','image_and_video_loading','stable_geometry_over_30_samples','retained_DOM_during_streaming_and_progress','aspect_ratios_at_320px','pause_and_continue','synthetic_progress'],geometry:geometry.before,errors};fs.writeFileSync('tmp/agents-preview-ui/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();process.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
