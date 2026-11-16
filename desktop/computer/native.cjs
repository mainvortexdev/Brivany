/* Brivany adapter. Reuses the user's Cognira native executors without modifying them. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const blocked=/consent(?:\.exe)?|user account control|control de cuentas|winlogon|brivany|melodi\s*(?:work|·)|powershell|pwsh|cmd\.exe|command prompt|terminal|regedit|taskmgr|security|privacy|privacidad|permission|permisos|defender|credential|password|contrase[nñ]a|authentication|autenticaci[oó]n|sign in|iniciar sesi[oó]n|codex|chatgpt/i;
const launchBlocked=new RegExp(blocked.source.replace('|chatgpt',''),'i');
const actions=new Set(['launch_app','focus_window','click_control','type_text','press_key','list_files','create_directory','copy_file','move_file','delete_file','replace_file','write_note','draw_paint','save_paint','paint_text','open_file','open_folder','create_office','browser_observe','browser_select_tab','browser_pause','browser_resume','browser_navigate','browser_new_tab','browser_read','browser_youtube_search','browser_search','browser_open_login','browser_scroll','browser_open_link']);
function scoped(candidate,roots){
 if(typeof candidate!=='string'||candidate.length>1000)throw Error('Ruta inválida');
 const resolved=path.resolve(candidate);
 const allowed=roots.some(root=>{const rel=path.relative(root,resolved);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);});
 if(!allowed)throw Error('Elige una carpeta autorizada desde Brivany.');
 for(let current=resolved;;current=path.dirname(current)){
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('No se admiten enlaces ni junctions.');
  if(current===path.dirname(current))break;
 }
 return resolved;
}
function validateStep(step){
 if(!step||!actions.has(step.action)||!step.params||typeof step.params!=='object'||Array.isArray(step.params))throw Error('Acción inválida');
 const fields={launch_app:['app'],focus_window:['handle','process_id'],click_control:['handle','process_id','control_id'],type_text:['handle','process_id','control_id','text'],press_key:['handle','process_id','key'],list_files:['path'],create_directory:['path'],copy_file:['source','destination'],move_file:['source','destination'],write_note:['name','text'],draw_paint:['instruction'],paint_text:['text'],save_paint:['handle','process_id'],open_file:['path'],open_folder:['path'],create_office:['plan'],browser_observe:['handle','process_id'],browser_select_tab:['handle','process_id','tab_id'],browser_pause:['handle','process_id','tab_id'],browser_resume:['handle','process_id','tab_id'],browser_navigate:['handle','process_id','url'],browser_new_tab:['handle','process_id','url'],browser_read:['handle','process_id'],browser_youtube_search:['handle','process_id','query'],browser_search:['handle','process_id','query'],browser_open_login:['handle','process_id','url'],browser_scroll:['handle','process_id','tab_id','document_id','scroll_id','direction'],browser_open_link:['handle','process_id','tab_id','document_id','control_id']};
 fields.delete_file=['path'];fields.replace_file=['source','destination'];
 if(Object.keys(step).some(k=>!['action','params'].includes(k))||Object.keys(step.params).some(k=>!fields[step.action].includes(k))||fields[step.action].some(k=>step.params[k]===undefined))throw Error('Parámetros no admitidos');
 for(const [key,value] of Object.entries(step.params)){
  if(key==='plan'){if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>60000)throw Error('Plan Office inválido');continue;}
  if(key==='process_id'? !Number.isInteger(value):typeof value!=='string'||!value.trim()||value.length>(key==='text'?10000:1200))throw Error('Parámetro inválido');
 }
 if(step.params.handle&&!/^\d+$/.test(step.params.handle))throw Error('Ventana inválida');
 if(step.params.control_id&&!/^(?:-?\d+(?:\.-?\d+)+|win32:\d+)$/.test(step.params.control_id))throw Error('Control inválido');
 if(step.params.tab_id&&!/^-?\d+(?:\.-?\d+)+$/.test(step.params.tab_id))throw Error('Pestaña inválida');
 for(const key of ['document_id','scroll_id'])if(step.params[key]&&!/^-?\d+(?:\.-?\d+)+$/.test(step.params[key]))throw Error('Identidad de documento inválida.');
 if(step.action==='browser_open_link'&&!/^-?\d+(?:\.-?\d+)+$/.test(step.params.control_id))throw Error('Enlace inválido.');
 if(step.action==='browser_scroll'&&!['up','down'].includes(step.params.direction))throw Error('Dirección de desplazamiento inválida.');
 if(step.params.query&&step.params.query.length>500)throw Error('La búsqueda admite hasta quinientos caracteres.');
 if(['browser_navigate','browser_new_tab','browser_open_login'].includes(step.action)){
  const url=new URL(step.params.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('La navegación requiere una URL HTTP/HTTPS sin credenciales.');
  if(step.action==='browser_open_login'&&url.protocol!=='https:'&&url.hostname!=='127.0.0.1')throw Error('Iniciar sesión requiere HTTPS.');
 }
 if(step.action==='launch_app'&&launchBlocked.test(step.params.app))throw Error('Aplicación protegida');
 if(step.action==='press_key'&&!['enter','tab','escape','backspace','delete','left','right','up','down','home','end'].includes(step.params.key.toLowerCase()))throw Error('Tecla no admitida');
 return step;
}
module.exports={scoped,validateStep,actions,blocked};
if(require.main===module || process.versions.electron){
 const {app,BrowserWindow,screen,globalShortcut}=require('electron');
 const root=path.resolve(process.env.BRIVANY_COMPUTER_SOURCE||''),workspace=path.resolve(process.env.BRIVANY_COMPUTER_WORKSPACE||'');
 const requireSource=relative=>require(path.join(root,'electron',relative));
 fs.mkdirSync(path.join(workspace,'runtime'),{recursive:true});
 app.setName('Melodi · Brivany');app.setPath('userData',path.join(workspace,'runtime'));
 app.on('window-all-closed',()=>{});
 const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
 // Source executor diagnostics can contain user text. Never relay or persist them.
 console.log=()=>{};console.warn=()=>{};console.error=()=>{};
 app.whenReady().then(()=>{
  if(process.platform!=='win32')throw Error('El ejecutor de Cognira requiere Windows.');
  const {AutomationEngine}=requireSource('automation/automationEngine.cjs');
  const {SystemAgent}=requireSource('automation/systemAgent.cjs');
  const {tasks,assertActive}=requireSource('intelligence/taskRuntime.cjs');
  const {DesktopControlOverlay}=requireSource('automation/desktopControlOverlay.cjs');
  const {ApplicationResolver}=requireSource('intelligence/applicationResolver.cjs');
  const automation=new AutomationEngine(),system=new SystemAgent();let controller=null,activeId=null,nativeSession=null,busy=false;
  let applications=null,applicationTime=0,applicationPending=null;const resolvedApplications=new Map();
  async function observedApplications(){
   if(applications&&Date.now()-applicationTime<300000)return applications;
   if(applicationPending)return applicationPending;
   applicationPending=(async()=>{const entries=JSON.parse(await automation.run(require('./installedApplications.cjs').catalogScript,15000));applications=(Array.isArray(entries)?entries:[entries]).filter(e=>e?.id&&e.name);applicationTime=Date.now();return applications;})();
   try{return await applicationPending;}finally{applicationPending=null;}
  }
  async function resolveApplication(name){
   if(typeof name!=='string'||!name.trim()||name.length>100||/[\r\n\\/:]/.test(name)||launchBlocked.test(name))throw Error('Aplicación no admitida.');
   const candidates=await observedApplications(),choice=require('./applicationChoice.cjs').chooseObserved;
   let selected=choice(name,candidates);
   if(!selected&&name.toLowerCase().endsWith('.exe')){
    const possible=candidates.filter(e=>e.id.includes('!')&&e.name.toLowerCase()===name.slice(0,-4).toLowerCase());
    if(possible.length===1){Object.assign(possible[0],JSON.parse(await automation.run(require('./installedApplications.cjs').packageMetadataScript(possible[0]),15000)));selected=choice(name,candidates);}
   }
   if(!selected)return {installed:false,verified:false,reason:'No hay una coincidencia instalada e inequívoca para esa aplicación.'};
   if(selected.id.includes('!')&&!selected.executableName)Object.assign(selected,JSON.parse(await automation.run(require('./installedApplications.cjs').packageMetadataScript(selected),15000)));
   if(launchBlocked.test(selected.executableName||''))throw Error('Aplicación protegida.');
   resolvedApplications.set(name,{selected,time:Date.now()});
   return {installed:true,verified:true,application:selected.name,executable_name:selected.executableName||null,source:selected.source};
  }
  const nativeBrowserObservation=automation.observeBrowser.bind(automation);
  automation.observeBrowser=async options=>{
   const started=Date.now();
   const observed=await nativeBrowserObservation(options);
   if((options?.searchOnly||options?.playbackOnly)&&!observed.tabs.length){
    const complete=JSON.parse(await automation.run(require('./browserObservation.cjs').tabsScript,options.timeoutMs||8000));
    if(complete.windowHandle!==observed.windowHandle)throw Error('La ventana cambió durante la observación del navegador.');
    observed.tabs=complete.tabs;
   }
   if(process.env.BRIVANY_COMPUTER_TEST_DIAGNOSTICS==='1')send({event:'diagnostic',phase:'browser_observation',ms:Date.now()-started,tab_count:observed.tabs.length,player_present:!!observed.player});
   return observed;
  };
  const diagnostics=process.env.BRIVANY_COMPUTER_TEST_DIAGNOSTICS==='1';
  if(diagnostics)for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,()=>send({event:'diagnostic',phase:event}));
  class MelodiWindow extends BrowserWindow {
   constructor(options){super(options);if(diagnostics){this.webContents.on('render-process-gone',(_event,details)=>send({event:'diagnostic',phase:'render-process-gone',reason:details.reason}));this.on('closed',()=>send({event:'diagnostic',phase:'window-closed'}));}}
   loadFile(file,...args){
    if(path.basename(file)==='desktop-control-overlay.html')return this.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(fs.readFileSync(path.join(__dirname,'overlay.html'),'utf8')));
    return super.loadFile(file,...args);
   }
  }
  class MelodiOverlay extends DesktopControlOverlay {
   showState(state){
    const text={locked:'Melodi controla el cursor · Doble clic para tomar el control · Esc para detener',pausing:'Melodi está liberando el cursor…',paused:'Melodi en pausa · Cursor libre · Ctrl+Alt+S para reanudar · Esc para detener','release-buttons':'Suelta los botones y pulsa Ctrl+Alt+S para continuar'}[state];
    if(text)for(const win of this.active?.windows||[])if(!win.isDestroyed())win.webContents.executeJavaScript(`document.querySelector('.status').textContent=${JSON.stringify(text)}`).catch(()=>{});
   }
  }
  const topology=()=>JSON.stringify(screen.getAllDisplays().map(display=>({id:display.id,bounds:display.bounds,scale:display.scaleFactor,rotation:display.rotation})).sort((a,b)=>a.id-b.id));
  const metricsListeners=new Map();
  const guardedScreen=new Proxy(screen,{get(target,key){
   if(key==='on')return (event,listener)=>{
    if(event!=='display-metrics-changed')return target.on(event,listener);
    let previous=topology();const wrapped=(...args)=>{const current=topology();if(current!==previous){previous=current;listener(...args);}};
    metricsListeners.set(listener,wrapped);return target.on(event,wrapped);
   };
   if(key==='removeListener')return (event,listener)=>{const wrapped=event==='display-metrics-changed'?metricsListeners.get(listener):null;if(wrapped)metricsListeners.delete(listener);return target.removeListener(event,wrapped||listener);};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  const overlay=new MelodiOverlay({BrowserWindow:MelodiWindow,screen:guardedScreen,globalShortcut,onCancel:()=>{if(!diagnostics)send({event:'cancelled',id:activeId});}});
  automation.desktopControl=overlay;
  async function decide(prompt,input){
   const response=await fetch(process.env.BRIVANY_COMPUTER_PROXY,{method:'POST',signal:controller?.signal,headers:{'Content-Type':'application/json','X-Brivany-Bridge':process.env.BRIVANY_COMPUTER_TOKEN},body:JSON.stringify({prompt,input})});
   if(!response.ok)throw Error('El planificador no está disponible.');return (await response.json()).text;
  }
  const resolver=new ApplicationResolver({automation,system,decide});
  const browserSessions=new Map();
  const rawChoose=resolver.choose.bind(resolver);
  resolver.choose=(request,candidates,context)=>rawChoose(request,candidates.filter(c=>!blocked.test([c.name,c.title,c.processName,c.id].join(' '))),context);
  async function controls(){
   const raw=await automation.run(`Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
$h=[CogniraInput]::GetForegroundWindow();$root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$items=New-Object System.Collections.Generic.List[object]
foreach($n in $nodes){if($items.Count -ge 180){break};try{$c=$n.Current;if($c.IsOffscreen -or !$c.IsEnabled -or $c.IsPassword){continue};$r=$c.ControlType.ProgrammaticName;if($r -notmatch '(Edit|Document|Button|MenuItem|ListItem|ComboBox|TabItem|TreeItem|CheckBox|RadioButton)$'){continue};$rect=$c.BoundingRectangle;if($rect.IsEmpty){continue};$name=[string]$c.Name;$items.Add(@{id=($n.GetRuntimeId() -join '.');name=$name.Substring(0,[Math]::Min(160,$name.Length));role=$r;point=@{x=[Math]::Round($rect.Left+$rect.Width/2);y=[Math]::Round($rect.Top+$rect.Height/2)}})}catch{}}
ConvertTo-Json -InputObject @($items.ToArray()) -Compress -Depth 3`,8000);
   const items=JSON.parse(raw||'[]');
   if(!items.some(control=>/\.(Edit|Document)$/.test(control.role))){
    const extra=await automation.run(require('./win32Text.cjs').bootstrap()+`\n$h=[CogniraInput]::GetForegroundWindow().ToInt64();ConvertTo-Json -InputObject @([BrivanyWin32Text]::Observe($h).ToArray()) -Compress -Depth 3`,8000);
    items.push(...JSON.parse(extra||'[]'));
   }
   return items;
  }
  async function controlProbe(){
   const raw=await automation.run(`Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
$h=[CogniraInput]::GetForegroundWindow();$root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$items=New-Object System.Collections.Generic.List[object]
foreach($n in $nodes){try{$c=$n.Current;$items.Add(@{role=$c.ControlType.ProgrammaticName;offscreen=$c.IsOffscreen;enabled=$c.IsEnabled;password=$c.IsPassword;runtime=($n.GetRuntimeId() -join '.')})}catch{$items.Add(@{error=$_.Exception.Message})}}
ConvertTo-Json -InputObject @{handle=$h.ToInt64().ToString();rootName=$root.Current.Name;rootClass=$root.Current.ClassName;items=@($items.ToArray())} -Compress -Depth 4`,8000);
   return JSON.parse(raw||'[]');
  }
  async function observe(){
   await automation.init();const windows=(await system.listWindows()).filter(w=>!blocked.test([w.title,w.processName].join(' '))).slice(0,60).map(w=>({...w,handle:String(w.handle)}));
   const foreground=await automation.getForegroundIdentity();
   const safe=!blocked.test([foreground.title,foreground.windowTitle,foreground.processName].join(' '));
   return {windows,foreground:safe?foreground:null,controls:safe?await controls():[],roots:currentRoots};
  }
  let currentRoots=[workspace];
  const fileApprovals=new (require('./fileApproval.cjs').FileApproval)({scoped,workspace,trashItem:file=>require('electron').shell.trashItem(file)});
  async function target(params){
   const fresh=(await system.listWindows()).find(w=>String(w.handle)===params.handle&&w.processId===params.process_id);
   if(fresh&&/password|contrase[nñ]a|authentication|autenticaci[oó]n|sign in|iniciar sesi[oó]n|permission|permisos|privacy|privacidad/i.test([fresh.title,fresh.processName].join(' ')))throw Error('HUMAN_INTERVENTION_REQUIRED');
   if(!fresh||blocked.test([fresh.title,fresh.processName].join(' ')))throw Error('Ventana ausente o protegida.');
   await automation.run(require('./windowGuard.cjs').windowGuardScript(params.handle),8000);
   if(!await system.focusWindow(fresh))throw Error('No se pudo enfocar la ventana.');
   const actual=await automation.getForegroundIdentity();if(String(actual.windowHandle)!==params.handle)throw Error('El foco cambió.');
   return actual;
  }
  async function execute(step,referenceImage,privateOptions={}){
   validateStep(step);const p=step.params;assertActive();
   if(step.action==='launch_app'){
    if(!nativeSession?.background)return resolver.launch(p.app,{});
    let saved=resolvedApplications.get(p.app);
    if(!saved||Date.now()-saved.time>30000){const result=await resolveApplication(p.app);if(!result.installed)throw Error(result.reason);saved=resolvedApplications.get(p.app);}
    const selected=saved.selected;assertActive();
    if(selected.id.includes('!'))return JSON.parse(await automation.run(require('./installedApplications.cjs').packageLaunchScript(selected),20000));
    return JSON.parse(await automation.run(require('./backgroundLaunch.cjs').launchScript(selected),20000));
   }
   if(step.action==='focus_window'){await target(p);return {verified:true,method:'observed-window'};}
   if(step.action.startsWith('browser_')){
    const window=await target(p);
    if(!/^(msedge|chrome|brave|firefox|opera|vivaldi)$/i.test(window.processName||''))throw Error('El objetivo no es un navegador admitido.');
    let session=browserSessions.get(p.handle);
    if(!session){
     const browser=requireSource('intelligence/browserSession.cjs');
     session=new browser.BrowserSession({automation,browser:window.processName,decide});
     require('./youtube.cjs').attachYouTube(session,{
      playerState:browser.playerState,isPlay:browser.isPlay,isPause:browser.isPause,assertActive,
      wait:requireSource('intelligence/taskRuntime.cjs').taskWait,
      diagnostic:details=>{if(diagnostics)send({event:'diagnostic',phase:'youtube-playback',...details});},
      withVisiblePlayer:async(snapshot,run)=>{
       const p=snapshot.player,target={windowHandle:snapshot.windowHandle,id:p.id,point:{x:Math.round(p.x+p.width/2),y:Math.round(p.y+p.height/2)}};
       // Keep only the observed pointer point unobstructed while reading progress.
       // Escape and the cursor guard remain active; the read loop sends no input.
       return overlay.withUnobstructedInput(async()=>{
        await automation._observedInput(target,false,true);
        const refreshed=await automation.run(require('./playerHover.cjs').playerHoverScript(target),8000);
        if(refreshed.trim()!=='OK')throw Error('No se pudo mantener visible el reproductor observado.');
        return run();
       },target);
      }
     });
     browserSessions.set(p.handle,session);
    }
    const type=async text=>{
      const raw=await automation.run(`Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
if([CogniraInput]::GetForegroundWindow().ToInt64().ToString() -ne '${p.handle}'){throw 'STALE_WINDOW'}
$node=[System.Windows.Automation.AutomationElement]::FocusedElement
if(!$node -or $node.Current.IsPassword -or $node.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit){throw 'NO_OBSERVED_ADDRESS_FIELD'}
$parent=$node;$owned=$false
for($i=0;$parent -and $i -lt 30;$i++){if($parent.Current.NativeWindowHandle -eq [long]${p.handle}){$owned=$true;break};$parent=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($parent)}
if(!$owned){throw 'ADDRESS_FIELD_OWNER_CHANGED'}
Write-Output ($node.GetRuntimeId() -join '.')`,8000);
      await automation.run(require('./textInput.cjs').textScript(p.handle,raw.trim(),text,{replace:true}),10000);
     };
    session.navigateSelectedTab=url=>require('./browserNavigation.cjs').navigateObserved({session,automation,type,assertActive,
     readPage:async()=>JSON.parse(await automation.run(require('./browserObservation.cjs').pageUrlScript,8000)),
     wait:requireSource('intelligence/taskRuntime.cjs').taskWait,handoff:step.action==='browser_open_login',diagnostic:details=>{if(diagnostics)send({event:'diagnostic',phase:'browser-navigation',...details});}},url);
    const observed=await session.observe(step.action==='browser_observe'?{}:undefined);
    if(step.action==='browser_observe')return {windowHandle:observed.windowHandle,processName:observed.processName,tabs:observed.tabs.map(t=>({id:t.id,name:t.name.slice(0,180),selected:t.selected})),player:observed.player,observedAt:observed.observedAt};
    if(['browser_read','browser_scroll','browser_open_link'].includes(step.action)){
     require('./browserPageActions.cjs').attachPageActions(session,{
      readPage:async()=>JSON.parse(await automation.run(require('./webPage.cjs').pageScript(requireSource('automation/webPageObservation.cjs').webPageScript),15000)),
      readUrl:async()=>JSON.parse(await automation.run(require('./browserObservation.cjs').pageUrlScript,8000)),
      readTabs:async()=>JSON.parse(await automation.run(require('./browserObservation.cjs').tabsScript,8000)),
      run:script=>automation.run(script,8000),assertActive,wait:requireSource('intelligence/taskRuntime.cjs').taskWait
     });
     if(step.action==='browser_read'){
      const tabs=observed.tabs.filter(t=>t.selected);if(tabs.length!==1)throw Error('No se observó una pestaña seleccionada inequívoca.');
      session.tabId=tabs[0].id;return session.readObservedPage();
     }
     session.tabId=p.tab_id;session.requireSelectedTab(observed);
     return step.action==='browser_scroll'?session.scrollObservedPage(p):session.openObservedLink(p);
    }
    if(['browser_youtube_search','browser_search'].includes(step.action)){
     await automation.guardedHotkey(p.handle,['ctrl','t']);
     await new Promise(resolve=>setTimeout(resolve,400));
     const fresh=await session.observe();if(fresh.tabs.length!==observed.tabs.length+1)throw Error('No se confirmó una nueva pestaña; no se repetirá la apertura.');
     await session.selectCurrentTabForNavigation();
     if(step.action==='browser_youtube_search')return session.searchAndPlay(p.query);
     return session.navigateSelectedTab('https://www.google.com/search?q='+encodeURIComponent(p.query));
    }
    if(['browser_navigate','browser_new_tab','browser_open_login'].includes(step.action)){
     if(['browser_new_tab','browser_open_login'].includes(step.action)){
      await automation.guardedHotkey(p.handle,['ctrl','t']);
      await new Promise(resolve=>setTimeout(resolve,400));
      const after=await session.observe();if(after.tabs.length!==observed.tabs.length+1)throw Error('No se confirmó una nueva pestaña; no se repetirá la apertura.');
     }
     await session.selectCurrentTabForNavigation();
     const result=await session.navigateSelectedTab(p.url);
     return step.action==='browser_open_login'?{...result,requires_user:true,handoff_reason:'Introduce tus credenciales y la verificación directamente en el navegador. Melodi no las lee ni las escribe.'}:result;
    }
    if(!observed.tabs.some(tab=>tab.id===p.tab_id))throw Error('La pestaña ya no está observada.');
    if(step.action==='browser_select_tab'){
     await session.clickObserved(p.tab_id,'tabs');session.tabId=p.tab_id;const after=await session.observe();session.requireSelectedTab(after);
     return {verified:true,selected_tab_id:p.tab_id,tabs_preserved:after.tabs.length===observed.tabs.length};
    }
    session.tabId=p.tab_id;session.requireSelectedTab(observed);
    return step.action==='browser_pause'?session.pause():session.resume();
   }
   if(['click_control','type_text','press_key'].includes(step.action)){
    const window=await target(p);
    if(!p.control_id)require('./fileUiPolicy.cjs').protectFileUI(step.action,window.processName,p,'',privateOptions.newDocument===true);
    if(p.control_id){const fresh=(await controls()).find(c=>c.id===p.control_id);if(!fresh)throw Error('El control cambió.');
     require('./fileUiPolicy.cjs').protectFileUI(step.action,window.processName,p,fresh.name,privateOptions.newDocument===true);
     if(step.action==='click_control'&&/\b(send|enviar|delete|borrar|eliminar|replace|overwrite|sobrescribir|reemplazar|publish|publicar|buy|comprar|pagar|autorizar|allow|permitir)\b/i.test(fresh.name))throw Error('Esta acción necesita una revisión específica y no se ejecutará desde el control general.');
     if(step.action==='type_text'&&!/\.(Edit|Document)$/.test(fresh.role))throw Error('Selecciona un campo de texto observado.');
     if(p.control_id.startsWith('win32:')){if(step.action==='click_control'){const helper=require('./win32Text.cjs');await automation.run((fresh.role==='ControlType.Button'?helper.clickScript:helper.focusScript)(p.handle,p.control_id),8000);}}
     else await (step.action==='click_control'?automation.clickObservedControl({windowHandle:p.handle,id:p.control_id,point:fresh.point}):automation.focusObservedControl({windowHandle:p.handle,id:p.control_id}));}
    if(step.action==='type_text'){
     if(/[\r\n]/.test(p.text)&&!/^(notepad|wordpad|winword)$/i.test(window.processName||''))throw Error('El texto multilínea necesita un editor de documentos.');
     const script=p.control_id.startsWith('win32:')?require('./win32Text.cjs').appendScript(p.handle,p.control_id,p.text):require('./textInput.cjs').textScript(p.handle,p.control_id,p.text);
     const result=await automation.run(script,15000);
     if(!['VERIFIED','INPUT_SENT'].includes(result.trim()))throw Error('La escritura no se pudo comprobar.');
     return {input_sent:true,text_value_verified:result.trim()==='VERIFIED',semantic_verification:false};
    }
    if(step.action==='press_key'){
     if(p.key.toLowerCase()==='enter'&&!/^(notepad|wordpad|winword|mspaint|paint)$/i.test(window.processName||''))throw Error('Enter puede enviar datos en esta aplicación; no se ejecutará desde el control general.');
     if(['delete','backspace'].includes(p.key.toLowerCase())&&!/^(notepad|wordpad|winword)$/i.test(window.processName||''))throw Error('Esta tecla sólo se admite en un editor de documentos.');
     await automation.guardedHotkey(p.handle,[p.key]);
    }
    return {input_sent:true,semantic_verification:false};
   }
   if(step.action==='draw_paint'){
    const {drawInPaint}=requireSource('services/paintDrawingService.cjs');
    if(referenceImage!==undefined&&(typeof referenceImage!=='string'||referenceImage.length>2200000||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(referenceImage)))throw Error('Referencia visual inválida.');
    return drawInPaint(p.instruction,{automation,...(referenceImage?{referenceImage,outputDirectory:path.join(workspace,'paint')}:{}),apiKey:'local-bridge',apiUrl:process.env.BRIVANY_COMPUTER_PROXY,signal:controller.signal,openPaint:()=>resolver.launch('Paint',{}),fetcher:async(url,options)=>fetch(url,{...options,headers:{...options.headers,'X-Brivany-Bridge':process.env.BRIVANY_COMPUTER_TOKEN}}),onProgress:()=>send({event:'progress',id:activeId,phase:'drawing'})});
   }
   if(step.action==='paint_text'){
    if(p.text.length>2500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(p.text))throw Error('PAINT_TEXT_INVALID');
    return require('./paintText.cjs').writePaintText(p.text,{automation,system,overlay,target,assertActive});
   }
   if(step.action==='save_paint'){
    const window=await target(p);if(!/^(mspaint|paint)$/i.test(window.processName||''))throw Error('La ventana elegida no es Paint.');
    return requireSource('services/paintExportService.cjs').exportOpenPaint({automation,system,signal:controller.signal,folder:path.join(workspace,'paint'),preferredWindowHandle:p.handle});
   }
   if(step.action==='create_office'){
    const office=requireSource('services/officeService.cjs'),plan=office.validateOfficePlan(p.plan);
    if((plan.sections||plan.slides).some(item=>item.imageQuery))throw Error('Las imágenes Office necesitan una fuente revisada; este adaptador sólo admite texto, tablas y animaciones.');
    const result=await office.createOfficeDocument(plan,{outputDirectory:path.join(workspace,'office'),signal:controller.signal,timeoutMs:110000,onProgress:()=>send({event:'progress',id:activeId,phase:'office'})});
    return {success:result.success,status:result.status,localPath:result.localPath,pdfPath:result.pdfPath,application:result.application,verification:result.verification};
   }
   if(step.action==='write_note'){
    if(!/^[\p{L}\p{N} _-]{1,90}\.txt$/u.test(p.name))throw Error('La nota debe tener un nombre .txt sencillo.');
    const destination=scoped(path.join(workspace,p.name),currentRoots);fs.writeFileSync(destination,p.text,{encoding:'utf8',flag:'wx'});return {verified:true,path:destination,method:'new-local-note'};
   }
   if(['open_file','open_folder'].includes(step.action)){
    const destination=currentRoots.includes(path.resolve(p.path))&&step.action==='open_folder'?path.resolve(p.path):scoped(p.path,currentRoots);
    const stat=fs.lstatSync(destination);
    if(stat.isSymbolicLink()||(step.action==='open_folder'?!stat.isDirectory():!stat.isFile()))throw Error('Destino no disponible.');
    if(step.action==='open_file'&&!/\.(txt|md|pdf|docx|pptx|xlsx|png|jpe?g|webp|glb)$/i.test(destination))throw Error('Este tipo de archivo necesita un adaptador específico.');
    const error=await require('electron').shell.openPath(destination);if(error)throw Error('El sistema no pudo abrir el archivo o carpeta.');
    return {opened:true,path:destination,window_verification_pending:true};
   }
   if(step.action==='list_files'){
    const folder=currentRoots.includes(path.resolve(p.path))?path.resolve(p.path):scoped(p.path,currentRoots);
    if(fs.lstatSync(folder).isSymbolicLink())throw Error('Enlace no admitido');
    return {files:fs.readdirSync(folder,{withFileTypes:true}).slice(0,200).map(e=>({name:e.name,directory:e.isDirectory()}))};
   }
   if(step.action==='create_directory'){const destination=scoped(p.path,currentRoots);fs.mkdirSync(destination);return {verified:true,path:destination};}
   if(['delete_file','replace_file'].includes(step.action))throw Error('Esta acción sólo puede ejecutarse tras su aprobación concreta en Brivany.');
   if(step.action==='move_file'){const prepared=fileApprovals.prepare(step,currentRoots);return fileApprovals.commit(prepared.ticket,currentRoots,assertActive);}
   if(['move_file','copy_file'].includes(step.action)){
    const source=scoped(p.source,currentRoots),destination=scoped(p.destination,currentRoots);
    const original=fs.statSync(source);
    if(!original.isFile()||original.size>128*1024*1024||fs.existsSync(destination)||/\.(exe|dll|ps1|cmd|bat|lnk|sh|js|cjs|py|env)$/i.test(source)||path.basename(source).startsWith('.'))throw Error('Usa un archivo personal de hasta 128 MiB y un destino nuevo.');
    fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
    const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if(digest(source)!==digest(destination))throw Error('La copia no coincide; se conserva el original.');
    if(step.action==='move_file'){
     assertActive();const fresh=fs.statSync(source);
     if(fresh.ino!==original.ino||fresh.size!==original.size||fresh.mtimeMs!==original.mtimeMs)throw Error('El original cambió; se conservan ambos archivos.');
     fs.unlinkSync(source);
    }
    return {verified:true,method:'hash-checked-file-transfer',destination};
   }
   throw Error('Acción no disponible');
  }
  async function request(message){
   if(message.method==='cancel'){controller?.abort();automation.ps.stop();overlay.stop();send({id:message.id,result:{cancelled:true}});return;}
   if(message.method==='probe'){send({id:message.id,result:{platform:process.platform,source_available:true,executor:'cognira-native',window_input_tested:false}});return;}
   if(message.method==='system_process_count'){const result=JSON.parse(await automation.run("@{count=@(Get-Process).Count;observed_at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress",10000));send({id:message.id,result});return;}
   if(message.method==='system_query'){const result=JSON.parse(await automation.run(require('./systemQuery.cjs').queryScript(message.query),15000));send({id:message.id,result});return;}
   if(message.method==='resolve_application'){send({id:message.id,result:await resolveApplication(message.name)});return;}
   if(message.method==='warm_up'){
    if(busy||nativeSession){send({id:message.id,result:{warmed:false}});return;}
    const entries=await observedApplications();send({id:message.id,result:{warmed:true,applications:entries.length}});return;
   }
   if(message.method==='begin_task'){
    if(controller||busy)throw Error('Hay una tarea en curso');
    if(message.background!==undefined&&typeof message.background!=='boolean')throw Error('Modo de ejecución inválido');
    controller=new AbortController();nativeSession={controller,background:message.background===true};browserSessions.clear();
    if(!nativeSession.background)nativeSession.cursorGuard=await tasks.run(nativeSession,()=>overlay.start(()=>{controller?.abort();automation.ps.stop();}));
    send({id:message.id,result:{started:true,escape_reserved:!nativeSession.background,background:nativeSession.background}});return;
   }
   if(message.method==='end_task'){
    if(busy)throw Error('Hay una acción terminando');
    overlay.stop();nativeSession=null;controller=null;browserSessions.clear();send({id:message.id,result:{ended:true}});return;
   }
   if(busy||(!nativeSession&&controller))throw Error('Hay una acción en curso');
   const session=nativeSession;
   if(!session)controller=new AbortController();busy=true;activeId=message.id;currentRoots=[workspace,...(message.roots||[])].map(r=>fs.realpathSync(r));
   await tasks.run(session||{controller},async()=>{let started=false;try{
    if(message.method==='observe'){send({id:message.id,result:await observe()});return;}
    if(message.method==='desktop_capture'){
     const display=screen.getPrimaryDisplay();
     const sources=await require('electron').desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1920,height:1080}});
     const source=sources.find(item=>item.display_id===String(display.id));
     if(!source||source.thumbnail.isEmpty())throw Error('No se pudo capturar la pantalla principal.');
     send({id:message.id,result:{png_base64:source.thumbnail.toPNG().toString('base64'),primary_display:true}});return;
    }
    if(message.method==='inspect_window'){
     const params=validateStep({action:'focus_window',params:message.target}).params;
     const check=async()=>{
      const rows=await system.listWindows();
      const window=rows.find(row=>String(row.handle)===params.handle&&row.processId===params.process_id);
      if(!window||blocked.test([window.title,window.processName].join(' ')))throw Error('Ventana ausente o protegida.');
      await automation.run(require('./windowGuard.cjs').windowGuardScript(params.handle),8000);
      return window;
     };
     const before=await check();
     const sources=await require('electron').desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1100,height:900}});
     const source=sources.find(item=>item.id.split(':')[0]==='window'&&item.id.split(':')[1]===params.handle);
     const after=await check();
     if(!source||source.thumbnail.isEmpty()||before.title!==after.title)throw Error('No se pudo observar la ventana seleccionada.');
     send({id:message.id,result:{image:'data:image/jpeg;base64,'+source.thumbnail.toJPEG(80).toString('base64')}});
     return;
    }
    if(message.method==='file_action_prepare'){
     validateStep(message.step);send({id:message.id,result:fileApprovals.prepare(message.step,currentRoots)});return;
    }
    if(message.method==='file_action_commit'){
     const result=await fileApprovals.commit(message.ticket,currentRoots,assertActive);send({id:message.id,result});return;
    }
    if(message.method==='terminal_project_capture'){
     const result=await require('./terminalUi.cjs').captureProject({BrowserWindow,screen,url:message.url,destination:message.destination,proof:message.proof,scoped,roots:currentRoots});
     send({id:message.id,result});return;
    }
    if(message.method==='terminal_notepad_evidence'){
     await automation.init();
     const result=await require('./terminalUi.cjs').writeNotepad({destination:message.destination,text:message.text,scoped,roots:currentRoots,automation,system,observe,execute:step=>execute(step,undefined,{newDocument:true}),target});
     send({id:message.id,result});return;
    }
    if(message.method==='terminal_editor_run'){
     await automation.init();
     const result=await require('./ideControl.cjs').runObservedEditor({workspace:message.workspace,editorPath:message.editor_path,scoped,roots:currentRoots,automation,assertActive,onStage:stage=>send({id:message.id,event:'progress',stage})});
     send({id:message.id,result});return;
    }
    if(message.method==='terminal_editor_probe'&&diagnostics){
     await automation.init();const helper=require('./ideControl.cjs'),run=helper.workspaceRun(message.workspace,scoped,currentRoots);
     send({id:message.id,result:{configuration:run.name,candidates:JSON.parse(await automation.run(helper.listScript(run.title),10000))}});return;
    }
    if(message.method==='control_probe'&&diagnostics){await automation.init();send({id:message.id,result:await controlProbe()});return;}
    if(message.method==='fixture_snapshot'&&diagnostics){
     await automation.init();const foreground=await automation.getForegroundIdentity();
     if(!/^Melodi browser fixture /.test(foreground.title||'')||String(foreground.windowHandle)!==String(message.handle))throw Error('La captura necesita la fixture de navegador identificada.');
     const capture=requireSource('services/paintDrawingService.cjs').cropPaintCapture(await automation.captureScreenForCords(),foreground);
     const cursor=await automation.getMousePosition();send({id:message.id,result:{png_base64:capture.base64,cursor}});return;
    }
    if(message.method==='paint_snapshot'){
     await automation.init();const foreground=await automation.getForegroundIdentity();
     if(!/^(mspaint|paint)$/i.test(foreground.processName||'')||String(foreground.windowHandle)!==String(message.handle))throw Error('La captura requiere la ventana Paint identificada.');
     const capture=requireSource('services/paintDrawingService.cjs').cropPaintCapture(await automation.captureScreenForCords(),foreground);
     send({id:message.id,result:{png_base64:capture.base64,width:capture.imageWidth,height:capture.imageHeight,paint_window_only:true}});return;
    }
    if(message.method==='inspect_control'){
     validateStep({action:'click_control',params:message.target});await automation.init();await target(message.target);
     const p=message.target;
     if(p.control_id.startsWith('win32:')){send({id:message.id,result:JSON.parse(await automation.run(require('./win32Text.cjs').readScript(p.handle,p.control_id),10000))});return;}
     const raw=await automation.run(`Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${p.handle}))
$runtimeIds=[int[]]('${p.control_id}'.Split('.')|ForEach-Object{[int]$_})
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::RuntimeIdProperty,$runtimeIds)
$target=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
if(!$target -or $target.Current.IsPassword -or $target.Current.IsOffscreen){throw 'STALE_CONTROL'}
$pattern=$null
if($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$text=$pattern.Current.Value}
elseif($target.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){$text=$pattern.DocumentRange.GetText(10000)}
else{throw 'CONTROL_UNREADABLE'}
ConvertTo-Json -InputObject @{text=$text} -Compress`,10000);
     send({id:message.id,result:JSON.parse(raw)});return;
    }
    if(message.method!=='execute')throw Error('Método inválido');
    const backgroundSafe=session?.background&&['launch_app','list_files','create_directory','copy_file','write_note','create_office'].includes(message.step?.action);
    if(backgroundSafe){send({id:message.id,result:await execute(message.step,message.reference_image)});return;}
    const guard=session?.cursorGuard||await overlay.start(()=>{controller?.abort();automation.ps.stop();});started=!session;if(session)session.cursorGuard=guard;
    const result=await tasks.run({controller,cursorGuard:guard},()=>execute(message.step,message.reference_image));
    assertActive();send({id:message.id,result});
   }finally{if(started)overlay.stop();if(!session)controller=null;activeId=null;busy=false;}});
  }
  let connected=false;
  const server=require('node:net').createServer(socket=>{
   if(connected){socket.destroy();return;}connected=true;
   let buffer='';socket.setEncoding('utf8');
   socket.on('data',chunk=>{
    buffer+=chunk;if(buffer.length>2400000){socket.destroy();return;}
    let newline;
    while((newline=buffer.indexOf('\n'))>=0){
     const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let message;try{message=JSON.parse(line);}catch{socket.destroy();return;}
     const token=process.env.BRIVANY_COMPUTER_TOKEN;
     if(typeof message._token!=='string'||message._token.length!==token.length||!crypto.timingSafeEqual(Buffer.from(message._token),Buffer.from(token))){socket.destroy();return;}
     request(message).catch(error=>{
      const license=/licen[cs]|licencia|ha expirado/i.test(String(error.message));
      const handoff=/HUMAN_INTERVENTION_REQUIRED|MODAL_WINDOW_REQUIRES_USER/.test(String(error.message));
      const paint=message.step?.action==='paint_text';
      const paintMessage=/NEW_WINDOW/.test(error.message)?'Paint no abrió un lienzo nuevo.':
       /BUTTON|TOOL/.test(error.message)?'No pude identificar o activar la herramienta Texto de Paint.':
       /CANVAS/.test(error.message)?'No pude confirmar una zona libre del lienzo para el cuadro de texto.':
       'No pude comprobar el texto en el cuadro de Paint.';
      if(paint&&!handoff){
       send({id:message.id,error_code:'paint_text_failed',error:diagnostics?String(error.message):paintMessage});
       controller?.abort();nativeSession=null;controller=null;activeId=null;busy=false;overlay.stop();
       return;
      }
      send({id:message.id,error_code:handoff?'human_intervention':license?'office_license':'native_action_failed',error:diagnostics?String(error.message):handoff?'Hay un diálogo o una pantalla protegida. Completa la intervención directamente en el navegador.':license?'Office informó un problema de licencia. Revisa su activación antes de crear el documento.':'La acción no se completó. Comprueba el objetivo, los permisos y la ventana.'});
      controller?.abort();nativeSession=null;controller=null;activeId=null;busy=false;overlay.stop();
     });
    }
   });
   socket.on('error',()=>{});socket.on('close',()=>{controller?.abort();automation.destroy();overlay.stop();server.close();app.quit();});
  });
  server.listen(0,'127.0.0.1',()=>send({event:'ready',port:server.address().port}));
 }).catch(error=>{send({event:'unavailable',reason:String(error.message).slice(0,300)});app.quit();});
}
