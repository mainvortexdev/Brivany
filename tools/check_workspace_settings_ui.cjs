'use strict';
// Actual Settings + WorkSpace pages sharing storage. Native/REST operations substituted.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const os=require('node:os'),{spawn}=require('node:child_process'),readline=require('node:readline');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/workspace-settings-ui');

async function restartFixture(browser, directory, visit) {
 const worker=spawn(process.env.BRIVANY_TEST_PYTHON||'python',
  ['-X','utf8','-B','-m','tools.workspace_settings_fixture',directory],
  {cwd:root,windowsHide:true,stdio:['pipe','pipe','ignore']});
 const finished=new Promise(resolve=>{
  worker.once('exit',resolve);
  worker.once('error',()=>resolve(-1));
 });
 const lines=readline.createInterface({input:worker.stdout});
 let context, deadline;
 try {
  const configuration=await Promise.race([
   new Promise(resolve=>lines.once('line',line=>resolve(JSON.parse(line)))),
   finished.then(()=>{throw Error('El servidor local de ajustes se cerró antes de iniciar.')}),
   new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('El servidor local de ajustes no respondió.')),10000)})
  ]);
  context=await browser.newContext({extraHTTPHeaders:{[configuration.header]:configuration.capability}});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==configuration.origin)return route.abort();
   if(['/api/computer/status','/api/computer/capabilities','/api/desktop/services'].includes(url.pathname))
    return route.fulfill({json:{roots:[],jobs:[],capabilities:[],human_skills:[],services:[]}});
   return route.continue();
  });
  await context.addInitScript(()=>{
   window.pywebview={api:{work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}),
    work_island_pointer:async()=>null,spotify_status:async()=>({connected:false}),
    work_island_layout:async(expanded,size,panel,animate,manual,anchor,chatHeight,toolHeight)=>{
     const width=Math.min(innerWidth-16,{files:376,widgets:360,chat:388,auditory:400}[panel]||336);
     const height=Math.min(innerHeight-46,toolHeight??chatHeight??160);
     return {expanded,panel,width,height,anchor_x:anchor,clip_left:Math.max(8,Math.min(innerWidth-width-8,anchor-width/2))};
    },
    workspace_chat_state:async()=>({messages:[],listening:false}),
    work_audio_translation_mode:async mode=>({mode}),
    work_audio_translation_target:async target=>({target}),
    work_audio_translation_voice:async voice=>({voice}),
    work_voice_cloning:async(enabled,language)=>({enabled,language}),
    workspace_weather_search:async()=>({locations:[{label:'Santo Domingo, República Dominicana',latitude:18.48,longitude:-69.91}]}),
    workspace_weather_current:async()=>({temperature:28,apparent:29,humidity:76,code:0,wind_kmh:12,
     local_time:'2026-11-07T18:00',timezone:'America/Santo_Domingo'})}};
  });
  await visit(context,configuration.origin);
 } finally {
  clearTimeout(deadline);
  if(context)await context.close();
  lines.close();worker.stdin.end();
  const guard=setTimeout(()=>worker.kill(),3000);
  await finished;
  clearTimeout(guard);
 }
}

async function checkPersistentSettings(browser) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'brivany-settings-test-'));
 async function workspace(context,origin){
  const panel=await context.newPage(),errors=[];
  panel.on('pageerror',error=>errors.push(error.message));
  const response=await panel.goto(origin+'/work-widget');
  assert.equal(response.status(),200);
  try{await panel.waitForFunction(()=>window.BrivanyIsland&&window.BrivanyWorkspaceLocale,{},{timeout:8000});}
  catch(error){throw new Error(error.message+' '+errors.join(' | '));}
  return panel;
 }
 try {
  await restartFixture(browser,directory,async(context,origin)=>{
   const settings=await context.newPage();
   const response=await settings.goto(origin+'/settings');
   assert.equal(response.status(),200);
   await settings.locator('select[data-pref="theme"]').selectOption('dark');
   await settings.waitForFunction(()=>BrivanyPreferences.get().theme==='dark');
   await settings.getByRole('button',{name:'Voz y conversación',exact:true}).click();
   await settings.locator('select[data-pref="language"]').selectOption('en-US');
   await settings.waitForFunction(()=>BrivanyPreferences.get().language==='en-US');
   await settings.getByRole('switch',{name:'Voz baja'}).check();
   await settings.waitForFunction(()=>BrivanyPreferences.get().quiet);
   await settings.getByRole('button',{name:'Melodi WorkSpace',exact:true}).click();
   await settings.getByLabel('Acento de WorkSpace',{exact:true}).selectOption('mint');
   await settings.waitForFunction(()=>BrivanyWorkspacePreferences.widgets().accent==='mint');
   await settings.getByLabel('Fluidez de grabación',{exact:true}).selectOption('30');
   await settings.waitForFunction(()=>BrivanyWorkspacePreferences.recording().fps===30);
   const panel=await workspace(context,origin);
   await panel.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'auditory',width:400,height:320,clip_left:200,anchor_x:400}));
   await panel.getByRole('button',{name:'Preproducción',exact:true}).click();
   await panel.waitForFunction(()=>BrivanyDesktopPreferenceStore.current('auditory').mode==='preproduction');
   await panel.getByRole('button',{name:'Français',exact:true}).click();
   await panel.waitForFunction(()=>BrivanyDesktopPreferenceStore.current('auditory').target==='fr');
   await panel.getByRole('button',{name:'Femenina',exact:true}).click();
   await panel.waitForFunction(()=>BrivanyDesktopPreferenceStore.current('auditory').voice==='feminine');
   await panel.getByLabel('Clonar voces autorizadas').click();
   await panel.waitForFunction(()=>document.querySelector('#auditory-clone-enabled').checked);
   await panel.locator('[data-clone-language="fr"]').click();
   await panel.waitForFunction(()=>BrivanyDesktopPreferenceStore.current('auditory').cloningLanguage==='fr');
   await panel.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:330,clip_left:200,anchor_x:400}));
   await panel.getByLabel('Herramienta',{exact:true}).selectOption('weather');
   await panel.locator('#daily-weather-city').fill('Santo Domingo');
   await panel.getByRole('button',{name:'Buscar ciudad',exact:true}).click();
   await panel.getByRole('button',{name:'Santo Domingo, República Dominicana',exact:true}).click();
   await panel.waitForFunction(()=>BrivanyDesktopPreferenceStore.current('weather').location?.label.startsWith('Santo Domingo'));
   const picker=panel.locator('#widget-tool-picker');
   await picker.selectOption('notes');
   await panel.locator('#widget-note').fill('Nota original');
   await picker.selectOption('timer');
   await panel.getByRole('button',{name:'Iniciar',exact:true}).click();
   const deadline=await panel.evaluate(()=>BrivanyWorkspaceWidgets.state().deadline);
   assert(deadline>Date.now());
   await settings.getByLabel('Idioma de WorkSpace',{exact:true}).selectOption('en');
   await panel.waitForFunction(()=>document.documentElement.lang==='en');
   await panel.getByRole('button',{name:'Pause',exact:true}).waitFor();
   assert.equal(await panel.evaluate(()=>BrivanyWorkspaceWidgets.state().deadline),deadline);
   assert.equal(await settings.evaluate(()=>BrivanyPreferences.get().language),'en-US');
   await picker.selectOption('notes');
   assert.equal(await panel.locator('#widget-note').inputValue(),'Nota original');
   assert.equal(await panel.locator('#widget-note').getAttribute('placeholder'),'Write a note…');
   await picker.selectOption('calculator');
   await panel.locator('#widget-expression').fill('1000.5');
   await panel.getByRole('button',{name:'Calculate expression'}).click();
   assert.equal(await panel.locator('#widget-answer').textContent(),'1,000.5');
   await settings.getByLabel('Idioma de WorkSpace',{exact:true}).selectOption('es');
   await panel.waitForFunction(()=>document.documentElement.lang==='es');
   assert.equal(await panel.locator('#widget-answer').textContent(),'1000,5');
   await settings.getByLabel('Idioma de WorkSpace',{exact:true}).selectOption('en');
   await panel.waitForFunction(()=>document.documentElement.lang==='en');
   await panel.setViewportSize({width:340,height:600});
   await panel.evaluate(()=>{
    BrivanyIsland.receiveLayout({expanded:true,panel:'files',width:324,height:160,clip_left:8,anchor_x:170});
    BrivanyWorkspaceFiles.receive({revision:1,items:[{id:'fixture',name:'Nota original.txt',size:15,kind:'txt'}]});
   });
   await panel.getByRole('button',{name:'Ask',exact:true}).waitFor();
   assert.equal(await panel.locator('.shelf-copy strong').textContent(),'Nota original.txt');
   assert.equal(await panel.locator('#panel-label').textContent(),'Files');
   assert.equal(await panel.locator('#work-status').textContent(),'');
   assert.equal(await panel.locator('[data-view=files]').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   await panel.locator('#island-content').screenshot({path:path.join(out,'workspace-en-340.png')});
   await panel.evaluate(()=>{
    BrivanyPhoneControl.receive({state:'review',revision:1,scopes:[]});
    document.querySelector('#remote-code').value='123456';
    document.querySelector('#remote-review input[value=input]').checked=true;
   });
   for(const [locale,labels] of Object.entries({
    fr:{tools:'Outils',ask:'Demander',start:'Mettre en pause',note:'Écrire une note…',clock:'Horloge'},
    'pt-BR':{tools:'Ferramentas',ask:'Perguntar',start:'Pausar',note:'Escrever nota…',clock:'Relógio'}
   })){
    await settings.getByLabel('Idioma de WorkSpace',{exact:true}).selectOption(locale);
    await panel.waitForFunction(code=>document.documentElement.lang===code,locale);
    await panel.evaluate(()=>BrivanyIsland.expand('files',170));
    await panel.getByRole('button',{name:labels.ask,exact:true}).waitFor();
    assert.equal(await panel.locator('.shelf-copy strong').textContent(),'Nota original.txt');
    await panel.evaluate(()=>BrivanyIsland.expand('widgets',170));
    await picker.selectOption('timer');
    assert.equal(await panel.locator('#panel-label').textContent(),labels.tools);
    await panel.getByRole('button',{name:labels.start,exact:true}).waitFor();
    assert.equal(await panel.evaluate(()=>BrivanyWorkspaceWidgets.state().deadline),deadline);
    assert.equal(await panel.locator('[data-view=widgets]').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
    await panel.locator('#island-content').screenshot({path:path.join(out,'workspace-'+locale+'-340.png')});
    await picker.selectOption('notes');
    assert.equal(await panel.locator('#widget-note').getAttribute('placeholder'),labels.note);
    assert.equal(await panel.locator('#widget-note').inputValue(),'Nota original');
    await picker.selectOption('phone-control');
    assert.equal(await panel.locator('#remote-code').inputValue(),'123456');
    assert.equal(await panel.locator('#remote-review input[value=input]').isChecked(),true);
    await picker.selectOption('clock');
    assert.equal(await panel.locator('#widget-tool-picker option:checked').textContent(),labels.clock);
    assert.equal(await panel.locator('#widget-date').textContent(),await panel.evaluate(code=>new Intl.DateTimeFormat(code,{weekday:'long',day:'numeric',month:'long'}).format(new Date()),locale));
   }
   let releaseFrench,seenFrench;
   const pausedFrench=new Promise(resolve=>{releaseFrench=resolve;});
   const frenchRequested=new Promise(resolve=>{seenFrench=resolve;});
   await panel.route('**/workspace-locales/fr.json',async route=>{
    seenFrench();await pausedFrench;
    try{await route.continue();}catch{}
   });
   await settings.getByLabel('Idioma de WorkSpace',{exact:true}).selectOption('fr');
   await frenchRequested;
   await settings.getByLabel('Idioma de WorkSpace',{exact:true}).selectOption('en');
   await panel.waitForFunction(()=>document.documentElement.lang==='en');
   releaseFrench();
   await panel.unrouteAll({behavior:'wait'});
   assert.equal(await panel.locator('html').getAttribute('lang'),'en');
   await settings.getByLabel('Idioma de WorkSpace',{exact:true}).selectOption('fr');
   await panel.waitForFunction(()=>document.documentElement.lang==='fr');
  });
  await restartFixture(browser,directory,async(context,origin)=>{
   const settings=await context.newPage();
   await settings.goto(origin+'/settings#work');
   assert.equal(await settings.getByLabel('Acento de WorkSpace',{exact:true}).inputValue(),'mint');
   assert.equal(await settings.getByLabel('Fluidez de grabación',{exact:true}).inputValue(),'30');
   assert.equal(await settings.getByLabel('Idioma de WorkSpace',{exact:true}).inputValue(),'fr');
   assert.equal(await settings.evaluate(()=>BrivanyPreferences.get().theme),'dark');
   assert.equal(await settings.evaluate(()=>BrivanyPreferences.get().language),'en-US');
   assert.equal(await settings.evaluate(()=>BrivanyPreferences.get().quiet),true);
   const panel=await workspace(context,origin);
   assert.equal(await panel.locator('html').getAttribute('lang'),'fr');
   assert.equal(await panel.locator('meta[name="brivany-workspace-catalog"]').getAttribute('data-locale'),'fr');
   assert.equal(await panel.locator('script[src*="workspace-locales"]').count(),0);
   await settings.getByLabel('Idioma de WorkSpace',{exact:true}).selectOption('en');
   await panel.waitForFunction(()=>document.documentElement.lang==='en');
   await panel.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'auditory',width:400,height:320,clip_left:200,anchor_x:400}));
   assert.equal(await panel.locator('html').getAttribute('lang'),'en');
   for(const name of ['Preprocessing','Français','Female'])
    assert.equal(await panel.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
   assert.equal(await panel.getByLabel('Clone voices with permission').isChecked(),false);
   assert.equal(await panel.locator('[data-clone-language="fr"]').getAttribute('aria-pressed'),'true');
   await panel.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:330,clip_left:200,anchor_x:400}));
   await panel.getByLabel('Tool',{exact:true}).selectOption('weather');
   assert.equal(await panel.locator('#daily-weather-city').inputValue(),'Santo Domingo');
   assert.equal(await panel.getByRole('button',{name:'Refresh weather',exact:true}).isVisible(),true);
   assert.equal(await panel.locator('#daily-weather-card').isVisible(),false);
   await settings.getByRole('button',{name:'General',exact:true}).click();
   await settings.getByRole('button',{name:'Restablecer preferencias',exact:true}).click();
   await settings.getByText('Preferencias restablecidas.',{exact:true}).waitFor();
   assert.equal(await settings.evaluate(()=>BrivanyPreferences.get().theme),'light');
   assert.equal(await settings.evaluate(()=>BrivanyPreferences.get().language),'es-ES');
   assert.equal(await settings.evaluate(()=>BrivanyWorkspacePreferences.widgets().accent),'mint');
   assert.equal(await settings.evaluate(()=>BrivanyWorkspacePreferences.locale()),'en');
  });
  const persisted=JSON.parse(fs.readFileSync(path.join(directory,'preferences.json'),'utf8'));
  assert.equal(persisted.values.general.theme,'light');
  assert.equal(persisted.values.recording.fps,30);
  assert.equal(persisted.values.auditory.mode,'preproduction');
  assert.equal(persisted.values.interface.locale,'en');
 } finally {
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('brivany-settings-test-'));
  fs.rmSync(directory,{recursive:true,force:true});
 }
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,channel:'msedge'});
 const report={passed:false,mode:'real_edge_two_pages_shared_local_storage_substituted_native',external_calls:0,checks:[],limitations:'Settings controls and cross-view persistence, not an existing personal Desktop instance.'};
 try{
  const context=await browser.newContext({viewport:{width:1000,height:780}}),errors=[],external=[];
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'){external.push(u.origin);return route.abort()}
   if(u.pathname.startsWith('/api/')){
    const value=u.pathname==='/api/computer/status'?{enabled:false,roots:[],jobs:[],access:{mode:'normal'},edits:{}}:u.pathname==='/api/computer/capabilities'?{capabilities:[],human_skills:[]}:u.pathname==='/api/desktop/services'?{services:[]}:{};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
   }
   let file;if(u.pathname==='/work-widget')file=path.join(root,'desktop/experience/work-widget.html');else if(u.pathname==='/settings')file=path.join(root,'desktop/experience/settings.html');else if(u.pathname.startsWith('/desktop-shell/'))file=path.join(root,'desktop/experience',path.basename(u.pathname));else if(u.pathname==='/typography.css')file=path.join(root,'web/typography.css');
   if(!file||!fs.existsSync(file))return route.fulfill({status:404,body:''});return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
  });
  await context.addInitScript(()=>{
   window.__settingsCalls=[];const folders={roots:['C:/Work','C:/Documents'],saved_folders:['C:/Documents']};
   window.pywebview={api:{work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}),work_island_pointer:async()=>null,work_island_keyboard:async()=>({ok:true}),spotify_status:async()=>({connected:false}),workspace_chat_state:async()=>({messages:[],listening:false}),workspace_files_state:async()=>({revision:0,items:[]}),
    computer_folder_settings:async()=>folders,
    forget_computer_folder:async path=>{window.__settingsCalls.push(['forget-folder',path]);folders.roots=['C:/Work'];folders.saved_folders=[];return folders},
    workspace_recording_status:async()=>({state:'idle',revision:0,elapsed_ms:0,folder:'C:\\Videos\\Brivany',has_file:false}),
    workspace_app_settings:async section=>{window.__settingsCalls.push(['settings',section]);return {ok:true}},
    workspace_recording_open:async folder=>{window.__settingsCalls.push(['folder',folder]);return {opened:true}}
   }};
  });
  const panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.goto('http://127.0.0.1/work-widget');await panel.waitForFunction(()=>window.BrivanyWorkspaceWidgets);
  await panel.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:280,clip_left:250,anchor_x:500}));
  const picker=panel.getByLabel('Herramienta',{exact:true});await picker.selectOption({label:'Notas'});await panel.getByLabel('Lo que no quieres olvidar').fill('Nota propia conservada al cambiar ajustes.');await panel.waitForTimeout(500);
  await picker.selectOption({label:'Enfoque'});await panel.getByRole('button',{name:'Iniciar',exact:true}).click();
  const before=await panel.evaluate(()=>JSON.parse(localStorage.getItem('brivany.workspace.widgets.v1')));
  await panel.getByRole('button',{name:'Ajustes de WorkSpace',exact:true}).click();assert.deepEqual(await panel.evaluate(()=>__settingsCalls),[['settings','work']]);
  const settings=await context.newPage();settings.on('pageerror',e=>errors.push(e.message));await settings.goto('http://127.0.0.1/settings#work');
  await settings.getByLabel('Acento de WorkSpace',{exact:true}).selectOption('mint');await settings.getByLabel('Tamaño de WorkSpace',{exact:true}).selectOption('compact');await settings.getByRole('switch',{name:'Animaciones de WorkSpace',exact:true}).uncheck();
  await settings.getByLabel('Fluidez de grabación',{exact:true}).selectOption('30');await settings.getByRole('switch',{name:'Incluir cursor',exact:true}).uncheck();
  await panel.waitForFunction(()=>document.body.dataset.accent==='mint'&&document.body.dataset.size==='compact');
  const after=await panel.evaluate(()=>JSON.parse(localStorage.getItem('brivany.workspace.widgets.v1')));
  assert.equal(after.note,before.note);assert.deepEqual(after.timer,before.timer);assert.equal(after.preferences.motion,false);
  assert.deepEqual(await panel.evaluate(()=>BrivanyWorkspacePreferences.recording()),{fps:30,cursor:false});
  await settings.getByRole('button',{name:'Abrir carpeta',exact:true}).click();assert.deepEqual(await settings.evaluate(()=>__settingsCalls),[['folder',true]]);
  await settings.getByRole('button',{name:'Ordenador y agentes',exact:true}).click();
  await settings.getByRole('button',{name:'Quitar carpeta C:/Documents',exact:true}).click();
  await settings.getByText('Carpeta quitada. Se cerró el acceso de esta sesión.',{exact:true}).waitFor();
  assert.equal(await settings.getByRole('button',{name:'Quitar carpeta C:/Documents',exact:true}).count(),0);
  await settings.getByRole('button',{name:'Melodi WorkSpace',exact:true}).click();
  await settings.screenshot({path:path.join(out,'settings-workspace-desktop.png')});await settings.reload();assert.equal(await settings.getByLabel('Fluidez de grabación',{exact:true}).inputValue(),'30');assert.equal(await settings.getByRole('switch',{name:'Incluir cursor',exact:true}).isChecked(),false);
  await settings.setViewportSize({width:340,height:700});await settings.getByLabel('Fluidez de grabación',{exact:true}).scrollIntoViewIfNeeded();await settings.screenshot({path:path.join(out,'settings-recording-340.png')});assert.equal(await settings.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await picker.selectOption({label:'Reloj'});await panel.locator('#widget-clock').waitFor();assert.equal(await panel.locator('.widget-heading,.widget-tabs,[data-widget-pane="appearance"]').count(),0);
  await picker.focus();await panel.keyboard.press('Home');await panel.keyboard.press('ArrowDown');assert.equal(await picker.inputValue(),'notes');
  report.checks.push('Tool selector and Settings shortcut replace the permanent clock and scrolling tab row.', 'Existing Settings owns appearance, recording FPS/cursor and destination.', 'Real storage events apply settings across views without losing a note or running timer.', 'An explicitly saved folder can be removed from Settings.', 'Settings survive reload and fit 340px; tool selector remains keyboard usable.');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await checkPersistentSettings(browser);
  report.checks.push('General, voice, WorkSpace locale, appearance, recording, translation and city survive a new local server and an empty profile. General reset preserves WorkSpace locale. Voice cloning consent stays session-only.');
  report.checks.push('Four WorkSpace locales preserve the timer deadline, notes, file names and pending phone permissions, localize numbers and accessibility labels, and fit at 340px. A late catalog response cannot replace the last selection.');
  report.passed=true;
 }catch(error){report.error=error.stack;console.error(error);process.exitCode=1}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close()}
})();
