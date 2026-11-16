'use strict';
// Production browser assets + real canonical Python state over a private pipe.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),readline=require('node:readline');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/desktop-widgets-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const child=spawn(process.env.BRIVANY_TEST_PYTHON||'python',['-X','utf8','-B','-m','tools.workspace_widget_fixture'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let sequence=0,readyResolve,readyReject,browser,bar,panel;const pending=new Map(),pages=new Map(),calls=[],errors=[];
 const report={passed:false,mode:'real_edge_two_views_production_python_state_substituted_native_windows',external_calls:0,gpu_seconds:null,checks:[]};
 const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j}),startGuard=setTimeout(()=>readyReject(Error('Local widget fixture did not start.')),10000);
 const lines=readline.createInterface({input:child.stdout});
 lines.on('line',line=>{try{const m=JSON.parse(line);if(m.ready){clearTimeout(startGuard);readyResolve()}
  if(m.event==='state')for(const [editor,page] of pages)page.evaluate(value=>{if(!window.__holdState)window.BrivanyDesktopWidgets?.receive(value)},m.views[editor]).catch(()=>{});
  if(m.id&&pending.has(m.id)){const v=pending.get(m.id);pending.delete(m.id);clearTimeout(v.guard);m.error?v.reject(Error(m.error)):v.resolve(m.value)}
 }catch{readyReject(Error('Unexpected fixture response.'))}});
 child.stderr.on('data',()=>{});child.on('error',()=>readyReject(Error('Local Python fixture unavailable.')));
 child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.guard);p.reject(Error('Local fixture exited.'))}pending.clear()});
 function request(method,args=[]){return new Promise((resolve,reject)=>{const id=++sequence,guard=setTimeout(()=>{pending.delete(id);reject(Error('Fixture request timed out: '+method))},8000);pending.set(id,{resolve,reject,guard});child.stdin.write(JSON.stringify({id,method,args})+'\n')})}
 async function settled(page){await page.waitForFunction(()=>window.BrivanyDesktopWidgets?.state().connected&&!window.BrivanyDesktopWidgets.state().pending)}
 try{
  await ready;browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1000,height:760}});
  await context.exposeBinding('widgetFixture',async({page},method,args)=>{
   calls.push(method);
   if(method==='workspace_desktop_widget_note'&&await page.evaluate(()=>!!window.__rejectNote)){await page.evaluate(()=>window.__rejectNote=false);throw Error('Owned simulated delivery failure')}
   const value=await request(method,args);
   if(method==='workspace_desktop_widget_note'){const delay=await page.evaluate(()=>{const n=window.__delayNote||0;window.__delayNote=0;return n});if(delay)await new Promise(r=>setTimeout(r,delay))}
   return value;
  });
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='widgets.test'){errors.push('External request');return route.abort()}
   if(u.pathname.startsWith('/api/'))return route.fulfill({contentType:'application/json',body:JSON.stringify(u.pathname.endsWith('/status')?{enabled:false,roots:[],jobs:[],access:{mode:'normal'},edits:{}}:u.pathname.endsWith('/capabilities')?{capabilities:[],human_skills:[]}:{services:[]})});
   let file;if(u.pathname==='/work-widget')file='work-widget.html';else if(u.pathname==='/settings')file='settings.html';else if(u.pathname.startsWith('/desktop-shell/'))file=path.basename(u.pathname);
   const target=u.pathname==='/typography.css'?path.join(root,'web/typography.css'):file&&path.join(root,'desktop/experience',file);
   if(!target||!fs.existsSync(target))return route.fulfill({status:404,body:''});return route.fulfill({body:fs.readFileSync(target),contentType:target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html'});
  });
  await context.addInitScript(()=>{
   if(!localStorage.getItem('brivany.workspace.widgets.v1'))localStorage.setItem('brivany.workspace.widgets.v1',JSON.stringify({note:'Nota de migración propia.',timer:{state:'idle',duration:300000,remaining:300000,deadline:0},preferences:{}}));
   window.__finished=0;window.addEventListener('brivany-timer-finished',()=>window.__finished++);
   const api={work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}),work_island_pointer:async()=>null,work_island_keyboard:async()=>({ok:true}),spotify_status:async()=>({connected:false}),workspace_chat_state:async()=>({messages:[],listening:false}),workspace_files_state:async()=>({revision:0,items:[]}),workspace_recording_status:async()=>({state:'idle',revision:0,elapsed_ms:0,folder:''})};
   for(const name of ['workspace_desktop_widgets_connect','workspace_desktop_widget_open','workspace_desktop_widget_timer','workspace_desktop_widget_note','workspace_desktop_widget_discard','workspace_desktop_widgets_preferences','workspace_desktop_widgets_settings','workspace_desktop_widgets_close'])api[name]=(...args)=>widgetFixture(name,args);
   window.pywebview={api};
  });
  async function view(editor){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));pages.set(editor,p);await p.goto('http://widgets.test/work-widget?surface='+(editor==='workspace-bar'?'bar':'panel'));await settled(p);await p.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:280,clip_left:250,anchor_x:500}));await p.getByLabel('Herramienta',{exact:true}).selectOption('notes');return p}
  bar=await view('workspace-bar');panel=await view('workspace-panel');
  assert.equal(await panel.locator('#widget-note').inputValue(),'Nota de migración propia.');assert.deepEqual((await request('inspect')).windows,[]);
  await panel.locator('#widget-note').fill('Edición compartida propia.');await settled(panel);await bar.waitForFunction(()=>document.querySelector('#widget-note').value==='Edición compartida propia.');
  await panel.getByRole('button',{name:'Abrir Notas en el escritorio'}).click();await panel.getByRole('button',{name:'Abrir Notas en el escritorio'}).click();assert.deepEqual((await request('inspect')).windows,['notes']);
  let current=await request('inspect');await request('native_edit',['Edición nativa propia.',current.note_revision]);await panel.waitForFunction(()=>document.querySelector('#widget-note').value==='Edición nativa propia.');await bar.waitForFunction(()=>document.querySelector('#widget-note').value==='Edición nativa propia.');
  report.checks.push('Legacy note migrates once; bar, panel and production native-editor state synchronize; repeated open reuses one widget.');
  await bar.evaluate(()=>__holdState=true);current=await request('inspect');await request('native_edit',['Versión remota propia.',current.note_revision]);await bar.locator('#widget-note').fill('Borrador simultáneo propio.');await settled(bar);
  await bar.locator('#widget-note-conflict').waitFor({state:'visible'});assert.equal((await request('inspect')).note,'Versión remota propia.');assert.equal(await panel.locator('#widget-note-conflict').isVisible(),false);
  await bar.getByRole('button',{name:'Guardar ésta',exact:true}).click();await bar.locator('#widget-note-conflict').waitFor({state:'hidden'});await bar.evaluate(()=>__holdState=false);assert.equal((await request('inspect')).note,'Borrador simultáneo propio.');
  await panel.waitForFunction(()=>document.querySelector('#widget-note').value==='Borrador simultáneo propio.');report.checks.push('A stale editor creates its own recoverable draft; other views receive no draft; explicit Save resolves the conflict.');
  await bar.evaluate(()=>__delayNote=350);await bar.locator('#widget-note').fill('Base propia A.');await bar.waitForFunction(()=>BrivanyDesktopWidgets.state().pending);await new Promise(r=>setTimeout(r,100));
  current=await request('inspect');await request('native_edit',['Cambio remoto durante respuesta.',current.note_revision]);await bar.locator('#widget-note').fill('Base propia A con continuación.');await settled(bar);await bar.locator('#widget-note-conflict').waitFor({state:'visible'});
  assert.equal((await request('inspect')).note,'Cambio remoto durante respuesta.');assert.equal(await bar.locator('#widget-note').inputValue(),'Base propia A con continuación.');await bar.getByRole('button',{name:'Cargar actual',exact:true}).click();await bar.locator('#widget-note-conflict').waitFor({state:'hidden'});assert.equal(await bar.locator('#widget-note').inputValue(),'Cambio remoto durante respuesta.');
  report.checks.push('Delayed acknowledgements plus a remote edit preserve the text being typed and detect the actual editing base instead of overwriting the remote change.');
  await panel.evaluate(()=>__rejectNote=true);await panel.locator('#widget-note').fill('Edición pendiente recuperable propia.');await panel.waitForFunction(()=>document.querySelector('#widget-feedback').textContent.includes('edición pendiente'));
  await panel.reload();await settled(panel);await panel.waitForFunction(()=>document.querySelector('#widget-note').value==='Edición pendiente recuperable propia.');await settled(panel);assert.equal((await request('inspect')).note,'Edición pendiente recuperable propia.');
  assert.equal(await panel.evaluate(()=>localStorage.getItem('brivany.workspace.note-recovery.v1.workspace-panel')),null);report.checks.push('A simulated delivery failure retains a bounded private recovery; reload delivers it and removes it only after acknowledgement.');
  await panel.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:280,clip_left:250,anchor_x:500}));await panel.getByLabel('Herramienta',{exact:true}).selectOption('timer');
  await panel.getByLabel('Minutos',{exact:true}).fill('0');await panel.getByLabel('Segundos',{exact:true}).fill('2');await panel.getByRole('button',{name:'Iniciar',exact:true}).click();await panel.waitForFunction(()=>BrivanyWorkspaceWidgets.state().state==='running');
  assert.equal(await panel.evaluate(()=>BrivanyWorkspaceWidgets.scheduling().alarmPending),false);assert.equal(await bar.evaluate(()=>BrivanyWorkspaceWidgets.scheduling().alarmPending),false);
  await request('native_timer',['pause']);await panel.waitForFunction(()=>BrivanyWorkspaceWidgets.state().state==='paused');await panel.getByRole('button',{name:'Reanudar',exact:true}).click();await panel.waitForFunction(()=>BrivanyWorkspaceWidgets.state().state==='finished');await bar.waitForFunction(()=>__finished===1);assert.equal(await panel.evaluate(()=>__finished),0);
  report.checks.push('One real backend deadline drives both views; native pause/resume syncs; no browser deadline alarms and exactly one completion notification.');
  const settings=await context.newPage();settings.on('pageerror',e=>errors.push(e.message));await settings.goto('http://widgets.test/settings#work');await settings.getByRole('switch',{name:'Mantener encima',exact:true}).check();assert.equal((await request('inspect')).topmost,true);
  await settings.getByLabel('Acento de WorkSpace',{exact:true}).selectOption('mint');await panel.waitForFunction(()=>document.body.dataset.accent==='mint');assert.equal((await request('inspect')).note,'Edición pendiente recuperable propia.');
  await settings.getByRole('button',{name:'Cerrar todas',exact:true}).click();assert.deepEqual((await request('inspect')).windows,[]);report.checks.push('TopMost and Close all stay in Settings; appearance changes preserve the canonical note and timer.');
  await panel.getByLabel('Herramienta',{exact:true}).selectOption('calculator');assert.equal(await panel.locator('#widget-desktop-open').isVisible(),false);await panel.getByLabel('Herramienta',{exact:true}).selectOption('notes');
  await panel.setViewportSize({width:340,height:650});await panel.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:324,height:280,clip_left:8,anchor_x:170}));await panel.screenshot({path:path.join(out,'notes-340.png')});assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const before=calls.length;await panel.waitForTimeout(450);assert.equal(calls.length,before);report.checks.push('Only separable tools show the desktop icon; 340 px layout fits and idle views issue no widget RPC polling.');
  assert.deepEqual(errors,[]);report.passed=true;console.log(JSON.stringify(report,null,2));
 }finally{
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();if(child.exitCode===null){try{await request('stop')}catch{}child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve()},3000);child.once('exit',()=>{clearTimeout(timer);resolve()})})}
  clearTimeout(startGuard);lines.close();for(const p of pending.values())clearTimeout(p.guard);
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
