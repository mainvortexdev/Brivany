'use strict';
// Actual assets in Edge, substituted native capture; no real screen/clipboard/audio.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/workspace-recording-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,channel:'msedge'});
 const report={passed:false,mode:'real_edge_production_assets_substituted_recorder',external_calls:0,checks:[],limitations:'Native capture substituted. Real GDI capture is checked separately against an owned synthetic window.'};
 try{
  const errors=[],external=[],context=await browser.newContext({viewport:{width:1366,height:768}});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());let file;
   if(u.hostname!=='127.0.0.1'){external.push(u.origin);return route.abort()}
   if(u.pathname==='/work-widget')file=path.join(root,'desktop/experience/work-widget.html');else if(u.pathname.startsWith('/desktop-shell/'))file=path.join(root,'desktop/experience',path.basename(u.pathname));else if(u.pathname==='/typography.css')file=path.join(root,'web/typography.css');
   if(!file||!fs.existsSync(file))return route.fulfill({status:404,body:''});return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
  });
  await context.addInitScript(()=>{
   window.__recordCalls=[];window.__recordError=false;window.__recordRevision=0;
   const snapshot=(state,extra={})=>({state,revision:++window.__recordRevision,elapsed_ms:0,folder:'C:\\Videos\\Brivany',has_file:false,audio:false,...extra});
   window.pywebview={api:{work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}),work_island_pointer:async()=>null,work_island_keyboard:async()=>({ok:true}),spotify_status:async()=>({connected:false}),workspace_chat_state:async()=>({messages:[],listening:false}),workspace_files_state:async()=>({revision:0,items:[]}),
    workspace_recording_status:async()=>{window.__recordCalls.push(['status']);return snapshot('idle')},
    workspace_recording_sources:async()=>{window.__recordCalls.push(['sources']);return {available:true,folder:'C:\\Videos\\Brivany',sources:[{id:'screen',label:'Pantalla propia · 1920 × 1080',kind:'monitor'},{id:'window',label:'Título <script>propio</script>',kind:'window'}]}},
    workspace_recording_start:async(...args)=>{window.__recordCalls.push(['start',...args]);if(window.__recordError)throw Error('La fuente ya no está disponible.');return snapshot('recording',{source:'Pantalla propia'})},
    workspace_recording_stop:async()=>{window.__recordCalls.push(['stop']);return snapshot('saved',{elapsed_ms:3200,has_file:true,file_name:'Brivany-propia.mp4'})},
    workspace_recording_open:async folder=>{window.__recordCalls.push(['open',folder]);return {opened:true}}
   }};
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1/work-widget');await page.waitForFunction(()=>window.BrivanyWorkspaceRecorder);
  assert.deepEqual(await page.evaluate(()=>__recordCalls),[['status']]);assert.equal(await page.evaluate(()=>BrivanyWorkspaceRecorder.clockScheduled()),false);
  await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:280,clip_left:433,anchor_x:683}));
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Grabar'});await page.getByLabel('Fuente de grabación').selectOption('screen');
  assert.deepEqual(await page.evaluate(()=>__recordCalls),[['status'],['sources']]);assert.equal(await page.locator('#recording-source script').count(),0);
  await page.screenshot({path:path.join(out,'recording-ready-desktop.png')});
  await page.evaluate(()=>BrivanyWorkspacePreferences.setRecording({fps:15,cursor:false}));await page.getByRole('button',{name:'Grabar',exact:true}).click();
  await page.getByText('Grabando',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>BrivanyWorkspaceRecorder.clockScheduled()),true);
  assert.deepEqual(await page.evaluate(()=>__recordCalls.at(-1)),['start','screen',15,false]);
  await page.waitForTimeout(1100);assert.notEqual(await page.locator('#recording-elapsed').textContent(),'00:00');
  await page.screenshot({path:path.join(out,'recording-running-desktop.png')});
  // Switching away stops UI clock work; the explicit capture continues until Stop.
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Notas'});assert.equal(await page.evaluate(()=>BrivanyWorkspaceRecorder.clockScheduled()),false);
  const before=await page.evaluate(()=>__recordCalls.length);await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>__recordCalls.length),before);
  await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:false,panel:'widgets',width:500,height:280,clip_left:433,anchor_x:683}));
  await page.getByRole('button',{name:'Detener grabación de pantalla',exact:true}).click();
  assert.equal(await page.evaluate(()=>BrivanyWorkspaceRecorder.state().state),'saved');assert.equal(await page.evaluate(()=>BrivanyWorkspaceRecorder.clockScheduled()),false);
  await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:280,clip_left:433,anchor_x:683}));await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Grabar'});
  await page.getByRole('button',{name:'Abrir video',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>__recordCalls.slice(-1)),[['open',false]]);
  await page.evaluate(()=>BrivanyWorkspaceRecorder.receive({state:'recording',revision:0,elapsed_ms:0}));assert.equal(await page.evaluate(()=>BrivanyWorkspaceRecorder.state().state),'saved');
  await page.evaluate(()=>window.__recordError=true);await page.getByRole('button',{name:'Grabar',exact:true}).click();await page.locator('#recording-feedback').filter({hasText:'La fuente ya no está disponible.'}).waitFor();
  await page.evaluate(()=>window.__recordError=false);await page.evaluate(()=>BrivanyWorkspacePreferences.setRecording({fps:30}));await page.getByRole('button',{name:'Grabar',exact:true}).click();await page.getByText('Grabando',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>__recordCalls.at(-1)),['start','screen',30,false]);
  await page.setViewportSize({width:340,height:600});await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:324,height:280,clip_left:8,anchor_x:170}));
  await page.screenshot({path:path.join(out,'recording-running-340.png')});assert.equal(await page.locator('#workspace-widgets').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  await page.locator('#island-content').screenshot({path:path.join(out,'recording-panel-clean.png')});
  assert.equal(await page.locator('#recording-fps,#recording-cursor,#recording-destination,.widget-tabs,.widget-heading').count(),0);
  assert.equal(await page.getByRole('button',{name:'Actualizar pantallas y ventanas',exact:true}).count(),0);
  const stop=page.getByRole('button',{name:'Detener',exact:true});await stop.scrollIntoViewIfNeeded();await stop.click();await page.getByRole('button',{name:'Abrir video',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'recording-saved-340.png')});
  report.checks.push('Idle has no source enumeration, recording or clock.', 'Explicit source, cursor and 15/30fps selection.', 'No hidden clock or status polling; recording stop remains on the bar.', 'Saved file, error recovery and stale-event protection.', 'Real production layout at desktop and 340px; compact selector, no inline configuration.');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.passed=true;
 }catch(error){report.error=error.stack;console.error(error);process.exitCode=1}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close()}
})();
