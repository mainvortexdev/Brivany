'use strict';
// Off-screen browser only: GPU disabled, all providers/bridges mocked. No OS input.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../motion-studio/node_modules/playwright-core');
const root=path.resolve(__dirname,'..'),experience=path.join(root,'desktop/experience'),out=path.join(root,'tmp/companions-music-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--disable-background-networking']});
 const report={passed:false,mode:'headless_software_rendering_synthetic_jobs_music_and_spectrum',native_windows_opened:0,OS_input_sent:false,audio_devices_opened:0,external_calls:0,gpu_seconds:null,checks:[]};
 const errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1280,height:760}});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(['i.ytimg.com','i.scdn.co'].includes(url.hostname))return route.fulfill({contentType:'image/jpeg',body:fs.readFileSync(path.join(experience,'music-assets/moon.jpg'))});
   if(url.hostname!=='scene.test')return route.abort();
   if(url.pathname.startsWith('/api/'))return route.fulfill({contentType:'application/json',body:'{}'});
   let file=url.pathname==='/work-widget'?path.join(experience,'work-widget.html'):url.pathname==='/workspace-music-expansion'?path.join(experience,'music-expansion.html'):url.pathname.startsWith('/desktop-shell/')?path.join(experience,url.pathname.slice('/desktop-shell/'.length)):url.pathname==='/typography.css'?path.join(root,'web/typography.css'):null;
   if(!file||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   const headers=url.pathname==='/workspace-music-expansion'?{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://i.ytimg.com https://i.scdn.co https://mosaic.scdn.co; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'"}:{};
   return route.fulfill({headers,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.json')?'application/json':'text/html',body:fs.readFileSync(file)});
  });
  await context.addInitScript(()=>{
   window.__jobs=[];window.__calls=[];window.__closeCount=0;
   window.__prefs={music:{expansion:true,style:'orbital'},appearance:{motion:true}};if(location.pathname==='/workspace-music-expansion')window.BrivanyDesktopPreferenceStore={current:group=>__prefs[group]};
   window.__music={track:{id:'fixture-song',source:'spotify',title:'Órbita tranquila',artist:'Sesión de prueba',duration_ms:180000,progress_ms:2300,playing:true,artwork:'https://i.scdn.co/image/fixture'},lyrics:{status:'ready',synced:true,lines:[{ms:1000,text:'Un lugar para volver'},{ms:5000,text:'Todo sigue su órbita'},{ms:8500,text:'Dejamos que la noche nos encuentre'},{ms:13000,text:'Ahora'},{ms:16000,text:'Y las luces giran despacio'},{ms:20000,text:'Algo pequeño se vuelve infinito'}]},spectrum:{state:'audio',bins:Array.from({length:64},(_,i)=>.15+.55*Math.sin(i*.2)**2)}};
   const methods={state:async()=>__music,spectrum:async()=>__music.spectrum,ready:async()=>({ready:true}),close:async()=>{__closeCount++;return {closed:true}},work_status:async()=>({active:true,jobs:__jobs,live:{}}),spotify_status:async()=>({connected:false}),workspace_files_state:async()=>({revision:0,items:[]}),workspace_phone_state:async()=>({revision:0,active:false}),workspace_chat_state:async()=>({messages:[],listening:false}),work_agent_select:async id=>{__calls.push(['select',id]);return __jobs.find(job=>job.id===id)},work_agent_review:async id=>{__calls.push(['review',id]);return {ok:true}},cancel_assistant_job:async id=>{__calls.push(['cancel',id]);return {ok:true}},work_island_layout:async(open,size,panel,motion,manual,x)=>({expanded:open,panel,width:panel==='team'?500:336,height:panel==='team'?356:244,clip_left:Math.max(0,(innerWidth-(panel==='team'?500:336))/2),anchor_x:x,revision:Date.now()})};
   window.pywebview={api:new Proxy(methods,{get:(target,name)=>name in target?target[name]:async()=>({})})};
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('http://scene.test/work-widget?surface=preview');
  await page.waitForFunction(()=>window.BrivanyWorkspaceAgents&&window.BrivanyIsland&&document.querySelector('#workspace-team'));
  const jobs=['research','document','image','motion','terminal','model'].map((kind,index)=>({id:'job-'+index,agent_key:'team:'+kind,kind,state:'running',title:['Revisar las fuentes','Preparar el documento','Dibujar la propuesta','Montar la escena','Comprobar los cambios','Organizar el modelo'][index],phase:'Melodi está coordinando esta tarea',attempt:1}));
  await page.evaluate(jobs=>{__jobs=jobs;BrivanyWorkspaceAgents.receive({jobs})},jobs);
  await page.locator('#workspace-team').click();await page.waitForFunction(()=>document.body.dataset.panel==='team'&&document.body.dataset.expanded==='true');
  assert.equal(await page.locator('.team-task').count(),6);assert.equal(await page.locator('.team-planet:not([hidden])').count(),6);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-view=team]').screenshot({path:path.join(out,'melodi-team.png')});
  const portrait=await page.locator('.team-task [data-agent-avatar]').first().getAttribute('data-agent-avatar');
  await page.evaluate(()=>{__jobs[0]={...__jobs[0],id:'retry',attempt:2};BrivanyWorkspaceAgents.receive({jobs:__jobs})});
  assert.equal(await page.locator('.team-task [data-agent-avatar]').first().getAttribute('data-agent-avatar'),portrait);
  await page.locator('.team-task').first().click();await page.waitForFunction(()=>document.body.dataset.panel==='agent');assert.equal(await page.locator('#agent-title').textContent(),jobs[0].title);
  await page.locator('#agent-cancel').click();assert.deepEqual(await page.evaluate(()=>__calls.at(-1)),['cancel','retry']);
  for(const width of [1280,800,375]){await page.setViewportSize({width,height:760});assert(await page.locator('.melodi-family').evaluate(node=>{const rect=node.getBoundingClientRect();return rect.left>=-.5&&rect.right<=innerWidth+.5}))}
  report.checks.push('Real team jobs, six soft portraits, shared retry identity, orbit/list/detail, native action dispatch and bar bounds');
  await page.close();
  const music=await context.newPage();music.on('pageerror',error=>errors.push(error.message));await music.setViewportSize({width:1280,height:760});await music.goto('http://scene.test/workspace-music-expansion');await music.waitForFunction(()=>window.BrivanyMusicExpansion?.snapshot().track==='fixture-song');
  await music.waitForTimeout(230);await music.screenshot({path:path.join(out,'expansion-monument.png')});
  const layouts=new Set();
  for(const at of [2000,5500,9000,14000,17000,21000]){await music.evaluate(at=>BrivanyMusicExpansion.seek(at),at);layouts.add(await music.locator('#lyric-composition').getAttribute('data-composition'))}
  assert.equal(layouts.size,6);
  await music.evaluate(()=>BrivanyMusicExpansion.seek(9000));await music.waitForTimeout(220);await music.screenshot({path:path.join(out,'expansion-staircase.png')});
  await music.emulateMedia({reducedMotion:'reduce'});
  for(const width of [1280,800,640]){
   await music.setViewportSize({width,height:760});await music.waitForTimeout(30);
   assert(await music.locator('#lyric-composition').evaluate(node=>{const box=node.getBoundingClientRect(),area=node.parentElement.getBoundingClientRect();return box.right<=area.right+1&&box.bottom<=area.bottom+1&&node.scrollWidth<=node.clientWidth+1}),'Lyric composition leaves its safe frame');
  }
  await music.evaluate(()=>{__music={...__music,track:{...__music.track,id:'youtube:abcdefghijk',source:'youtube',artwork:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'}};BrivanyMusicExpansion.receive(__music)});
  assert.equal(await music.locator('#expansion-source').textContent(),'YouTube');assert.equal(await music.locator('#expansion-cover').getAttribute('src'),'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  await music.waitForFunction(()=>document.querySelector('#expansion-cover').naturalWidth>0);
  await music.setViewportSize({width:1280,height:760});await music.emulateMedia({reducedMotion:'no-preference'});
  await music.evaluate(()=>{__prefs.music.style='amber';BrivanyMusicExpansion.receive(__music)});
  assert.equal(await music.locator('body').getAttribute('data-style'),'amber');assert(await music.locator('#expansion-time').textContent());assert(await music.locator('.amber-aura').isVisible());assert.equal(await music.locator('.music-orbit').isVisible(),false);
  for(const at of [2000,5500,9000,17000,21000])for(const width of [1280,800,375]){
   await music.setViewportSize({width,height:760});await music.evaluate(at=>BrivanyMusicExpansion.seek(at),at);await music.waitForTimeout(250);
   const layout=await music.locator('#lyric-composition').evaluate(node=>{const area=node.parentElement.getBoundingClientRect();return {area:area.toJSON(),rows:[...node.querySelectorAll('.lyric-phrase')].map(row=>row.getBoundingClientRect().toJSON())}});
   assert(layout.rows.every(box=>box.left>=layout.area.left-1&&box.right<=layout.area.right+1&&box.top>=layout.area.top-1&&box.bottom<=layout.area.bottom+1),'Amber lyric phrase or band leaves its safe frame: '+JSON.stringify({at,width,...layout}));
  }
  await music.setViewportSize({width:1280,height:760});await music.evaluate(()=>BrivanyMusicExpansion.seek(5500));await music.waitForTimeout(250);await music.screenshot({path:path.join(out,'expansion-amber.png')});
  await music.emulateMedia({reducedMotion:'reduce'});assert.equal(await music.locator('.lyric-row').first().evaluate(node=>getComputedStyle(node).animationName),'none');
  report.checks.push('Amber reference: centered changing typography, highlighted bands, local clock, warm aura, real thumbnail under strict CSP, frame bounds at 375/800/1280 px and reduced motion');
  await music.evaluate(()=>BrivanyMusicExpansion.receive({...__music,lyrics:{status:'unavailable',synced:false,lines:[]}}));assert.equal(await music.locator('#lyric-composition').textContent(),'');assert.equal(await music.locator('#lyric-availability').textContent(),'Letra sincronizada no disponible.');
  await music.keyboard.press('Escape');assert.equal(await music.evaluate(()=>__closeCount),1);await music.evaluate(()=>BrivanyMusicExpansion.dispose());
  report.checks.push('Six timestamp-driven lyric compositions and sizes, software-rendered lunar audio ring, safe layout, YouTube thumbnail/source, unavailable lyrics, reduced motion and close');
  assert.deepEqual(errors,[]);report.passed=true;
 }catch(error){report.reason=String(error.stack).slice(0,2200);report.errors=errors;process.exitCode=1}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
})().catch(error=>{console.error(error);process.exitCode=1});
