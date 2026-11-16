'use strict';
// Real browser execution with synthetic bridge snapshots. No account or audio.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/workspace-runtime');
const {execFileSync}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function measure(browser,baseline,active){
 const processSession=await browser.newBrowserCDPSession();
 async function resources(){const snapshot=await processSession.send('SystemInfo.getProcessInfo'),processes=snapshot.processInfo.map(p=>({pid:p.id,type:p.type,cpu_seconds:p.cpuTime}));let workingSet=null;try{const ids=processes.map(p=>p.pid).join(',');const command="$ErrorActionPreference='Stop'; $ids=@("+ids+"); [double](Get-Process -Id $ids | Measure-Object WorkingSet64 -Sum).Sum";const sampled=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim());if(Number.isFinite(sampled)&&sampled>0)workingSet=sampled;}catch{}return {processes,sum_working_set_bytes:workingSet};}
 const errors=[],context=await browser.newContext({viewport:{width:1280,height:600}});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());let file;
  if(url.pathname==='/work-widget')file=path.join(root,'desktop/experience/work-widget.html');
  else if(url.pathname.startsWith('/desktop-shell/'))file=path.join(root,'desktop/experience',path.basename(url.pathname));
  else if(url.pathname==='/typography.css')file=path.join(root,'web/typography.css');
  if(baseline&&url.pathname.endsWith('/island.js'))file=path.join(out,'island-before.js');
  if(baseline&&url.pathname.endsWith('/workspace-translation.js'))file=path.join(out,'translation-before.js');
  if(baseline&&url.pathname.endsWith('/workspace-companion.js'))file=path.join(out,'companion-before.js');
  if(!file||!fs.existsSync(file))return route.fulfill({status:404,body:''});
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
  await route.fulfill({contentType:type,body:fs.readFileSync(file)});
 });
 await context.addInitScript(({active})=>{
  window.__calls={};window.__raf=0;window.__mutations=0;
  const request=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>request(time=>{window.__raf++;callback(time)});
  document.addEventListener('DOMContentLoaded',()=>new MutationObserver(items=>window.__mutations+=items.length).observe(document.documentElement,{subtree:true,attributes:true,childList:true,characterData:true}));
  const playback={id:'aaaaaaaaaaaaaaaaaaaaaa',type:'track',title:'Fixture local',artist:'Sin proveedor',duration_ms:180000,progress_ms:1000,playing:active,device:'speaker',volume:50,supports_volume:true,disallows:{}};
  const connection={connected:active,configured:true,streaming_access:false,pending:false};
  const work={active:true,jobs:active?[{id:'fixture',agent:'Melodi',kind:'research',state:'running',title:'Tarea sintética'}]:[],live:{},audio_translation:{active:false,state:'idle'}};
  const snapshot=()=>({...connection,playback,devices:[{id:'speaker',name:'Dispositivo sintético'}]});
  const api={work_status:()=>work,work_island_pointer:()=>null,work_island_gaze:()=>({x:0,y:0}),workspace_chat_state:()=>({messages:[],pending:false,listening:false,speaking:false}),spotify_status:()=>connection,spotify_playback:snapshot,spotify_lyrics:()=>({track_id:playback.id,status:'ready',synced:true,lines:[{ms:0,text:'Primera línea'},{ms:6000,text:'Segunda línea'}]}),work_island_layout:(expanded,size,panel,animate,manual,x)=>({expanded,size,panel,width:720,height:232,clip_left:20,anchor_x:x})};
  window.pywebview={api:new Proxy(api,{get:(target,key)=>(...args)=>{window.__calls[key]=(window.__calls[key]||0)+1;return Promise.resolve(target[key]?.(...args)||{});}})};
 },{active});
 const pages=await Promise.all(['bar','panel'].map(async surface=>{const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('http://brivany.test/work-widget?surface='+surface);await page.waitForFunction(()=>!!window.BrivanyIsland);return page;}));
 if(active)await pages[1].evaluate(()=>window.BrivanyIsland.expand('music',500));
 await pause(1200);
 const sessions=await Promise.all(pages.map(page=>context.newCDPSession(page)));
 await Promise.all(sessions.map(session=>session.send('Performance.enable')));
 const metrics=async()=>Promise.all(sessions.map(async session=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))));
 const resourcesBefore=await resources();const before=await metrics();await Promise.all(pages.map(page=>page.evaluate(()=>{window.__calls={};window.__raf=0;window.__mutations=0})));
 const started=performance.now();await pause(8500);const seconds=(performance.now()-started)/1000,after=await metrics(),resourcesAfter=await resources();
 const surfaces=await Promise.all(pages.map(async(page,i)=>({...await page.evaluate(()=>({surface:document.body.dataset.surface,calls:window.__calls,raf_callbacks:window.__raf,dom_mutations:window.__mutations,title:document.querySelector('#track-title').textContent})),renderer_task_seconds:after[i].TaskDuration-before[i].TaskDuration,js_heap_bytes:after[i].JSHeapUsedSize})));
 assert.deepEqual(errors,[],JSON.stringify(errors));
 if(active)assert.equal(surfaces[1].title,'Fixture local','The shared playback snapshot must reach the open music panel.');
 if(!baseline){assert.equal(surfaces.reduce((n,s)=>n+s.raf_callbacks,0),0,'Idle voice canvases must not run animation frames.');assert.equal(surfaces[1].calls.work_status||0,0,'The panel must share the bar work snapshot.');if(active)assert.equal(surfaces[1].calls.spotify_playback||0,0,'The open panel must share owner playback.');}
 const byPid=new Map(resourcesBefore.processes.map(p=>[p.pid,p.cpu_seconds])),cpuSeconds=resourcesAfter.processes.reduce((n,p)=>n+Math.max(0,p.cpu_seconds-(byPid.get(p.pid)||0)),0);
 const result={browser_process_cpu_seconds:cpuSeconds,browser_process_cpu_percent_one_core:100*cpuSeconds/seconds,sum_working_set_before_bytes:resourcesBefore.sum_working_set_bytes,sum_working_set_after_bytes:resourcesAfter.sum_working_set_bytes,browser_process_count:resourcesAfter.processes.length,variant:baseline?'before':'after',scenario:active?'music_and_job':'idle_closed',seconds,surfaces,total_calls:surfaces.reduce((n,s)=>n+Object.values(s.calls).reduce((a,b)=>a+b,0),0)};
 // Hidden documents cancel timers; dispose permanently cancels both surfaces.
 if(!baseline){await Promise.all(pages.map(page=>page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})));await pause(250);await Promise.all(pages.map(page=>page.evaluate(()=>{window.__calls={};window.__raf=0})));await pause(750);for(const page of pages){const hidden=await page.evaluate(()=>({calls:window.__calls,frames:window.__raf}));assert.equal(hidden.frames,0);assert.equal(Object.values(hidden.calls).reduce((a,b)=>a+b,0),0);}result.hidden_bridge_calls=0;await Promise.all(pages.map(page=>page.evaluate(()=>{window.BrivanyIsland.dispose();window.BrivanyWorkspace.dispose();window.__calls={}})));await pause(1000);assert.equal((await Promise.all(pages.map(page=>page.evaluate(()=>Object.values(window.__calls).reduce((a,b)=>a+b,0))))).reduce((a,b)=>a+b,0),0);result.disposed_bridge_calls=0;}
 await context.close();return result;
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});let browser;const results=[];
 try{const compare=fs.existsSync(path.join(out,'island-before.js'))&&fs.existsSync(path.join(out,'companion-before.js'));for(const baseline of compare?[true,false]:[false])for(const active of [false,true]){browser=await chromium.launch({channel:'msedge',headless:true});try{const result=await measure(browser,baseline,active);results.push(result);console.log(JSON.stringify(result));}finally{await browser.close();browser=null;}}}
 finally{if(browser)await browser.close();}
 const report={mode:'real_local_browser_synthetic_services',external_calls:0,gpu_seconds:null,results,limitations:['Bridge responses, work and playback are synthetic; no physical audio or native WebView was exercised.','Renderer TaskDuration is sampled browser task time, not total Windows process CPU. JS heap is a sample, not total process RAM or a peak.','Before/after runs are sequential short windows with separate headless browser launches; host load is uncontrolled, not a statistical performance benchmark.','Browser process CPU time comes from CDP SystemInfo, percentage uses one CPU core; exited processes between samples are not included. Summed Windows Get-Process working sets can count shared pages more than once and are not private RAM or a peak.'],source_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'desktop/experience/island.js'))).digest('hex')};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 const old=results.find(r=>r.variant==='before'&&r.scenario==='idle_closed'),current=results.find(r=>r.variant==='after'&&r.scenario==='idle_closed');if(old)assert(current.total_calls<old.total_calls,'Idle bridge calls must decrease.');assert(current.surfaces.every(surface=>!surface.calls.work_island_pointer),'Closed surfaces must not poll the pointer.');console.log('Workspace runtime checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
