'use strict';
// Actual WorkSpace HTML/assets, real Edge layout and events, substituted native bridge.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/workspace-design');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const report={mode:'local_browser_substituted_native_bridge',external_calls:0,checks:[],limitations:'Native file dialogs, WebView memory, real accounts and device functionality are outside this UI test.'};
 try{
  const errors=[],external=[],context=await browser.newContext({viewport:{width:1366,height:768}});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());let file;
   if(url.hostname!=='workspace.test'){external.push(url.origin);return route.abort();}
   if(url.pathname==='/work-widget')file=path.join(root,'desktop/experience/work-widget.html');
   else if(url.pathname.startsWith('/desktop-shell/'))file=path.join(root,'desktop/experience',path.basename(url.pathname));
   else if(url.pathname==='/typography.css')file=path.join(root,'web/typography.css');
   if(!file||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
  });
  await context.addInitScript(()=>{
   window.__calls=[];window.__revision=0;window.__files={revision:0,items:[]};
   window.__game={state:'idle',revision:0};
   window.__mic={available:true,muted:false,token:'a'.repeat(32),revision:1,message:''};
   window.__work={active:true,capturing:false,monitoring:false,translation_state:'idle',jobs:[],schedules:[],live:{listening:false,speaking:false,pending:false}};
   window.pywebview={api:{
    work_status:async()=>window.__work,work_island_pointer:async()=>null,work_island_keyboard:async()=>({ok:true}),work_island_gaze:async()=>({x:0,y:0}),
    work_island_layout:async(open,size,panel,animate,manual,x,chatHeight,toolHeight)=>{
     window.__calls.push(['layout',open,panel,size,toolHeight]);const ratio={compact:.92,normal:1,large:1.08}[size]||1;
     const width=Math.min(innerWidth-16,Math.round(({widgets:360,files:376,chat:388,melodi:250,music:336,notice:336,auditory:400,result:520,agent:336}[panel]||336)*ratio));
     const height=Math.min(innerHeight-46,toolHeight??chatHeight??({widgets:152,files:142,chat:148,melodi:104,music:212,notice:104,auditory:320,result:340,agent:244}[panel]||300));
     return {expanded:open,panel,width,height,clip_left:Math.max(8,Math.min(innerWidth-width-8,x-width/2)),anchor_x:x,revision:++window.__revision};
    },
    spotify_status:async()=>({connected:false,configured:false}),spotify_playback:async()=>({connected:false}),
    workspace_chat_state:async()=>({messages:[],pending:false,listening:false,speaking:false}),
    work_sync_translation_status:async()=>({available:false,active_sessions:0}),
    workspace_files_state:async()=>structuredClone(window.__files),
    workspace_files_upload:async(name,payload)=>{window.__files.items.push({id:String(++window.__files.revision),name,size:atob(payload).length,kind:'txt',temporary:true});return structuredClone(window.__files);},
    workspace_file_draft:async()=>({draft:'Documento de prueba. Mi pregunta: ',message:'Revisa antes de enviar.'}),
    workspace_chat_command:async(...args)=>{window.__calls.push(['send',...args]);return {accepted:true};},
    workspace_files_remove:async id=>{window.__files.items=window.__files.items.filter(item=>item.id!==id);window.__files.revision++;return structuredClone(window.__files);},
    workspace_control_open:async action=>({opened:true,action}),workspace_clipboard_state:async()=>({items:[]}),
    workspace_game_state:async()=>{window.__calls.push(['game-state']);return {...window.__game}},
    workspace_game_options:async()=>({windows:[{id:'fixture',label:'Ventana sintética'}],ready:false,supported:true}),
    workspace_game_start:async id=>{window.__calls.push(['game-start',id]);return window.__game={revision:1,state:'running',fps:null,cpu:12,gpu:8,ram:44,message:'Prepara PresentMon para medir FPS.'}},
    workspace_game_stop:async()=>window.__game={revision:2,state:'idle'},
    workspace_call_mute_state:async()=>{window.__calls.push(['mic-state']);return {...window.__mic}},
    workspace_call_mute_set:async(muted,token)=>{
     window.__calls.push(['mic-set',muted]);
     if(token!==window.__mic.token)return {...window.__mic,message:'El micrófono o su estado cambió. Vuelve a pulsar.'};
     window.__mic={...window.__mic,muted,revision:window.__mic.revision+1,token:String(window.__mic.revision+1).repeat(32)};return {...window.__mic};
    },
    workspace_diagnostics:async()=>({pid:123,process_cpu_seconds:1,memory_rss_bytes:10485760})
   }};
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://workspace.test/work-widget');await page.waitForFunction(()=>window.BrivanyWorkspaceWidgets&&window.BrivanyIsland);
  assert.equal(await page.evaluate(()=>__calls.some(c=>c[0]==='mic-state')),false);
  await page.getByRole('button',{name:'Herramientas',exact:true}).click();
  await page.waitForFunction(()=>document.body.dataset.panel==='widgets'&&document.body.dataset.expanded==='true');
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Enfoque'});
  await page.waitForFunction(()=>__calls.some(call=>call[2]==='widgets'&&Number.isInteger(call[4])));
  report.timerDesktop=await page.locator('#island-content').evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight}));
  assert.equal(report.timerDesktop.width,360);
  assert(report.timerDesktop.height<=175);
  await page.getByLabel('Minutos',{exact:true}).fill('0');await page.getByLabel('Segundos',{exact:true}).fill('1');await page.getByRole('button',{name:'Iniciar',exact:true}).click();
  const deadline=await page.evaluate(()=>BrivanyWorkspaceWidgets.state().deadline);
  await page.getByRole('button',{name:'Silenciar micrófono de llamadas',exact:true}).click();
  const unmute=page.getByRole('button',{name:'Reactivar micrófono de llamadas',exact:true});await unmute.waitFor();
  assert.equal(await unmute.getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>BrivanyWorkspaceWidgets.state().deadline),deadline);
  await page.screenshot({path:path.join(out,'call-muted.png')});
  await page.evaluate(()=>{__mic={...__mic,muted:false,revision:__mic.revision+1,token:'x'.repeat(32)}});
  await unmute.click();await page.getByText('El micrófono o su estado cambió. Vuelve a pulsar.',{exact:true}).waitFor();
  const mute=page.getByRole('button',{name:'Silenciar micrófono de llamadas',exact:true});await mute.click();await unmute.click();
  await mute.waitFor();assert.equal(await mute.getAttribute('aria-pressed'),'false');
  report.checks.push('Call mute is read only when the timer opens, shows confirmed state, handles a stale device and preserves the running deadline. Native device substituted.');
  await page.waitForFunction(()=>window.BrivanyWorkspaceWidgets.state().state==='finished');
  await page.waitForFunction(()=>!document.querySelector('.workspace-sparks'));
  report.checks.push('Real one-second timer completes and finite particles clean up.');
  await page.getByRole('button',{name:'Restablecer temporizador'}).click();
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Calcular'});await page.getByLabel('Una cuenta rápida').fill('25 × (12 + 8)');await page.getByRole('button',{name:'Calcular expresión'}).click();assert.equal(await page.locator('#widget-answer').textContent(),'500');
  assert.equal(await page.locator('#widget-call-mute').isVisible(),false);
  await page.evaluate(()=>BrivanyWorkspacePreferences.setWidgets({accent:'mint',size:'compact'}));
  await page.waitForFunction(()=>window.__calls.some(c=>c[0]==='layout'&&c[2]==='widgets'&&c[3]==='compact'));
  await page.screenshot({path:path.join(out,'widgets-desktop.png')});
  assert.equal(await page.locator('.workspace-waves').first().evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
  report.checks.push('Calculator, appearance, compact geometry and default economy mode work together.');
  await page.evaluate(()=>window.BrivanyIsland.expand('files',innerWidth/2));
  await page.waitForFunction(()=>document.querySelector('#island-content').offsetHeight<145);
  await page.locator('.shelf-picker').setInputFiles({name:'nota-propia.txt',mimeType:'text/plain',buffer:Buffer.from('Contenido sintético propio.')});
  await page.getByText('nota-propia.txt',{exact:true}).waitFor();await page.waitForTimeout(100);
  await page.screenshot({path:path.join(out,'files-desktop.png')});
  await page.getByRole('button',{name:'Preguntar',exact:true}).click();
  await page.waitForFunction(()=>document.body.dataset.panel==='chat');assert.equal(await page.locator('#workspace-chat-input').inputValue(),'Documento de prueba. Mi pregunta: ');
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c[0]==='send').length),0);
  report.checks.push('File ingestion opens an editable chat draft without sending it.');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.body.dataset.expanded==='false');assert(await page.locator('#island-content').evaluate(el=>el.inert));
  await page.setViewportSize({width:340,height:600});await page.evaluate(()=>window.BrivanyIsland.expand('widgets',170));
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Enfoque'});await page.waitForTimeout(260);await page.locator('#island-content').screenshot({path:path.join(out,'widgets-340.png')});
  const micBounds=await mute.boundingBox(),timerBounds=await page.locator('#widget-timer-value').boundingBox();
  assert(micBounds.x+micBounds.width<=340&&micBounds.y>=timerBounds.y);
  const bounds=await page.locator('#island-content').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=341);
  const startBounds=await page.locator('#widget-timer-action').boundingBox();
  report.timerNarrow={width:bounds.width,height:bounds.height,buttonHeight:startBounds.height,muteHeight:micBounds.height,footerSpace:bounds.y+bounds.height-startBounds.y-startBounds.height};
  assert(bounds.height<=175&&startBounds.height===26&&micBounds.height===26);
  assert(report.timerNarrow.footerSpace>=8&&report.timerNarrow.footerSpace<=17);
  assert.equal(await page.locator('#workspace-widgets').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  report.checks.push('The timer fits its controls at desktop and 340px widths, with 26px buttons and no horizontal overflow.');
  const transition=await page.evaluate(()=>{
   const tools=window.BrivanyWorkspaceWidgets;
   tools.selectTab('notes');
   document.querySelector('#widget-note').focus();
   tools.selectTab('calculator');
   tools.selectTab('clock');
   return {
    animated:document.querySelector('#widget-pane-clock').getAnimations().length,
    hiddenAnimations:[...document.querySelectorAll('[data-widget-pane][hidden]')].reduce((count,pane)=>count+pane.getAnimations().length,0),
    focus:document.activeElement.id
   };
  });
  assert.deepEqual(transition,{animated:1,hiddenAnimations:0,focus:'widget-tool-picker'});
  await page.waitForFunction(()=>document.querySelector('#widget-pane-clock').getAnimations().length===0);
  report.checks.push('Rapid tool changes cancel hidden animations and preserve keyboard focus on the picker.');
  assert.equal(await page.evaluate(()=>__calls.some(call=>call[0]==='game-state')),false);
  const tools=page.getByLabel('Herramienta',{exact:true});
  await tools.selectOption('game');
  await page.getByRole('option',{name:'Ventana sintética',exact:true}).waitFor({state:'attached'});
  await page.getByLabel('Ventana del juego',{exact:true}).selectOption('fixture');
  await page.getByRole('button',{name:'Preparar FPS',exact:true}).waitFor();
  await page.getByRole('button',{name:'Mostrar franja',exact:true}).click();
  await page.getByText('Prepara PresentMon para medir FPS.',{exact:true}).waitFor();
  assert.equal(await page.locator('#game-fps').textContent(),'—');
  assert.equal(await page.locator('#game-cpu').textContent(),'12%');
  assert.equal(await page.locator('#workspace-widgets').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  await page.screenshot({path:path.join(out,'game-340.png')});
  await tools.selectOption('timer');
  const reads=await page.evaluate(()=>__calls.filter(call=>call[0]==='game-state').length);
  await page.waitForTimeout(1150);
  assert.equal(await page.evaluate(()=>__calls.filter(call=>call[0]==='game-state').length),reads);
  await tools.selectOption('game');
  await page.getByRole('button',{name:'Ocultar franja',exact:true}).click();
  await page.getByRole('button',{name:'Mostrar franja',exact:true}).waitFor();
  report.checks.push('Game panel stays compact, displays missing FPS accurately and stops sampling the bridge while hidden. Native data substituted.');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.body.dataset.motion==='false');await page.evaluate(()=>window.BrivanyWorkspacePolish.burst(document.querySelector('#island-content')));
  assert.equal(await page.locator('.workspace-sparks').count(),0);assert.equal(await page.locator('body').getAttribute('data-motion'),'false');
  await tools.selectOption('notes');assert.equal(await page.locator('#widget-pane-notes').evaluate(el=>el.getAnimations().length),0);
  report.checks.push('Reduced motion removes particle and entry animation.');
  await page.evaluate(()=>{
   const items=Array.from({length:12},(_,i)=>({id:String(i+1),name:'Ejemplo '+(i+1)+'.txt',size:5,kind:'txt',temporary:true}));
   __files={revision:100,items};
   BrivanyWorkspaceFiles.receive(__files);
   BrivanyIsland.expand('files',170);
  });
  const fileView=page.locator('[data-view=files]');
  await page.waitForFunction(()=>document.querySelector('#island-content').offsetHeight===344);
  const lastFile=page.getByText('Ejemplo 12.txt',{exact:true});
  await lastFile.scrollIntoViewIfNeeded();
  assert(await fileView.evaluate(el=>el.scrollTop>0&&el.scrollWidth===el.clientWidth));
  const lastBounds=await lastFile.boundingBox(),viewBounds=await fileView.boundingBox();
  assert(lastBounds.y>=viewBounds.y&&lastBounds.y+lastBounds.height<=viewBounds.y+viewBounds.height);
  const fits=await page.evaluate(()=>__calls.filter(call=>call[2]==='files'&&Number.isInteger(call[4])).length);
  await page.waitForTimeout(160);
  assert.equal(await page.evaluate(()=>__calls.filter(call=>call[2]==='files'&&Number.isInteger(call[4])).length),fits);
  report.checks.push('A long shelf caps at 344px, scrolls to the last file and settles without repeated layout requests.');
  await page.evaluate(()=>{window.BrivanyWorkspaceWidgets.dispose();window.BrivanyWorkspacePolish.dispose();window.BrivanyIsland.dispose();});
  for(const surface of ['panel','bar']){
   const dock=await context.newPage();
   await dock.setViewportSize({width:780,height:404});
   dock.on('pageerror',error=>errors.push(error.message));
   await dock.goto('http://workspace.test/work-widget?surface='+surface);
   await dock.evaluate(()=>{
    BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:360,height:152,clip_left:210,anchor_x:390,host_height:404,revision:++__revision});
   });
   if(surface==='panel'){
    await dock.waitForFunction(()=>__calls.some(call=>call[2]==='widgets'&&call[4]===167));
    assert.equal(await dock.locator('#island-content').evaluate(el=>el.offsetHeight),167);
   }else{
    assert.equal(await dock.locator('#island-content').isVisible(),false);
    assert.equal(await dock.evaluate(()=>__calls.some(call=>call[0]==='layout')),false);
   }
   await dock.close();
  }
  report.checks.push('The docked panel measures and reports its content; the separate toolbar stays hidden and makes no fit request.');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.passed=true;report.errors=errors;
 }catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error);}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
})();
