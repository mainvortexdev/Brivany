'use strict';
// Production desktop and phone assets, actual loopback HTTPS; native picker substituted.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process'),readline=require('node:readline');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/workspace-phone-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const fixture=spawn(process.env.BRIVANY_TEST_PYTHON||'python',['-X','utf8','-B','-m','tools.workspace_phone_fixture'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const pending=new Map();let sequence=0,desktop=null,secrets=[];
 const report={passed:false,mode:'real_local_https_mobile_viewport_and_production_assets',external_provider_calls:0,checks:[],limitations:'Owned text file, loopback and emulated phone viewport; no physical phone, Wi-Fi/firewall reachability or phone certificate confirmation is certified.'};
 let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject});
 const timeout=setTimeout(()=>readyReject(Error('Local fixture did not start.')),15000);
 const lines=readline.createInterface({input:fixture.stdout});
 lines.on('line',line=>{
  try{const message=JSON.parse(line);if(message.ready){clearTimeout(timeout);readyResolve()}
   if(message.event){if(message.event.link)secrets.push(message.event.link);desktop?.evaluate(value=>window.BrivanyWorkspacePhone?.receive(value),message.event).catch(()=>{})}
   if(message.id&&pending.has(message.id)){if(message.value?.link)secrets.push(message.value.link);const entry=pending.get(message.id);clearTimeout(entry.timer);entry.resolve(message.value);pending.delete(message.id)}
  }catch{readyReject(Error('Unexpected local fixture output.'))}
 });
 fixture.stderr.on('data',()=>{});
 fixture.on('exit',code=>{if(code)readyReject(Error('Local fixture exited.'));for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('Local fixture exited.'))}pending.clear()});
 const request=(action,extra={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Local fixture request timed out.'))},10000);pending.set(id,{resolve,reject,timer});fixture.stdin.write(JSON.stringify({id,action,...extra})+'\n')});
 let browser;
 try{
  await ready;browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1366,height:768},ignoreHTTPSErrors:true,acceptDownloads:true}),errors=[],external=[];
  await context.exposeBinding('phoneFixture',async(source,action,arg)=>request(action,action==='settings'?{address:arg}:action==='share'?{locale:arg}:{}));
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.protocol==='https:')return route.continue();
   if(u.hostname!=='workspace.test'){external.push(u.origin);return route.abort()}
   if(u.pathname.startsWith('/api/')){const value=u.pathname==='/api/computer/status'?{enabled:false,roots:[],jobs:[],access:{mode:'normal'},edits:{}}:u.pathname==='/api/computer/capabilities'?{capabilities:[],human_skills:[]}:u.pathname==='/api/desktop/services'?{services:[]}:{};return route.fulfill({contentType:'application/json',body:JSON.stringify(value)})}
   let file;if(u.pathname==='/work-widget')file=path.join(root,'desktop/experience/work-widget.html');else if(u.pathname==='/settings')file=path.join(root,'desktop/experience/settings.html');else if(/^\/desktop-shell\/workspace-locales\/(en|fr|pt-BR)\.json$/.test(u.pathname))file=path.join(root,'desktop/experience/workspace-locales',path.basename(u.pathname));else if(u.pathname.startsWith('/desktop-shell/'))file=path.join(root,'desktop/experience',path.basename(u.pathname));else if(u.pathname==='/typography.css')file=path.join(root,'web/typography.css');
   if(!file||!fs.existsSync(file))return route.fulfill({status:404,body:''});return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html',body:fs.readFileSync(file)});
  });
  await context.addInitScript(()=>{
   if(location.hostname!=='workspace.test')return;
   window.pywebview={api:{work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}),work_island_pointer:async()=>null,work_island_keyboard:async()=>({ok:true}),spotify_status:async()=>({connected:false}),workspace_chat_state:async()=>({messages:[],listening:false}),
    work_island_layout:async(expanded,size,panel,motion,manual,x,chatHeight,toolHeight)=>{
     const width=Math.min(innerWidth-16,376),height=toolHeight??160;
     return {expanded,panel,width,height,anchor_x:x,clip_left:Math.max(8,Math.min(innerWidth-width-8,x-width/2))};
    },
    workspace_files_state:async()=>({revision:1,items:[{id:'owned',name:'Documento propio.txt',size:2120,kind:'txt',temporary:true}]}),
    workspace_phone_state:async()=>phoneFixture('state'),workspace_phone_share:async(id,locale)=>phoneFixture('share',locale),workspace_phone_stop:async()=>phoneFixture('stop'),workspace_phone_settings:async address=>phoneFixture('settings',address),workspace_app_settings:async section=>{window.__settingsOpened=section;return {ok:true}}
   }};
  });
  desktop=await context.newPage();desktop.on('pageerror',error=>errors.push(error.message));await desktop.goto('http://workspace.test/work-widget');await desktop.waitForFunction(()=>window.BrivanyWorkspacePhone);
  await desktop.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'files',width:440,height:360,clip_left:463,anchor_x:683}));
  await desktop.locator('.shelf-more summary').click();await desktop.getByRole('button',{name:'Teléfono',exact:true}).click();await desktop.locator('#phone-qr').waitFor();
  const state=await request('state');assert(state.active&&state.qr&&state.link);secrets.push(state.link);
  assert.equal(await desktop.getByRole('button',{name:'Archivos · Envío activo',exact:true}).count(),1);
  await desktop.getByRole('button',{name:'Ajustes de envío',exact:true}).click();assert.equal(await desktop.evaluate(()=>__settingsOpened),'work');
  await desktop.locator('#island-content').screenshot({path:path.join(out,'desktop-qr.png')});
  await desktop.setViewportSize({width:340,height:600});await desktop.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'files',width:324,height:360,clip_left:8,anchor_x:170}));
  assert.equal(await desktop.locator('#workspace-files').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  await desktop.locator('#island-content').screenshot({path:path.join(out,'desktop-qr-340.png')});
  const scanned=spawnSync(process.env.BRIVANY_TEST_PYTHON||'python',['-c','import cv2,sys; print(cv2.QRCodeDetector().detectAndDecode(cv2.imread(sys.argv[1]))[0])',path.join(out,'desktop-qr-340.png')],{windowsHide:true,encoding:'utf8'});assert.equal(scanned.status,0);assert.equal(scanned.stdout.trim()===state.link,true);
  const settings=await context.newPage();settings.on('pageerror',error=>errors.push(error.message));await settings.goto('http://workspace.test/settings#work');await settings.locator('#settings-phone-fingerprint').filter({hasText:/^[A-F0-9]{64}$/}).waitFor();
  assert.equal(await settings.getByLabel('Red del teléfono',{exact:true}).isDisabled(),true);
  await settings.setViewportSize({width:340,height:700});await settings.getByLabel('Red del teléfono',{exact:true}).scrollIntoViewIfNeeded();assert.equal(await settings.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await settings.screenshot({path:path.join(out,'phone-settings-340.png')});
  const phone=await context.newPage();phone.on('pageerror',error=>errors.push(error.message));await phone.setViewportSize({width:390,height:844});await phone.goto(state.link);
  await phone.getByRole('link',{name:'Descargar',exact:true}).waitFor();assert.equal(new URL(phone.url()).hash,'');
  await phone.screenshot({path:path.join(out,'phone-download.png')});assert.equal(await phone.locator('h1').textContent(),'Documento propio.txt');
  const downloadPromise=phone.waitForEvent('download');await phone.getByRole('link',{name:'Descargar',exact:true}).click();const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'Documento propio.txt');
  const target=path.join(out,'owned-download.txt');await download.saveAs(target);
  const expected=Buffer.from('Contenido propio para verificar transferencia local.\n'.repeat(40),'utf8');assert.equal(fs.readFileSync(target).equals(expected),true);
  await desktop.getByText('Descarga enviada',{exact:true}).waitFor();await desktop.getByRole('button',{name:'Cancelar envío',exact:true}).click();await desktop.locator('.shelf-list').waitFor();
  const final=await request('state');assert.equal(final.active,false);assert.equal(final.link,null);assert.equal(final.qr,null);
  assert.equal(await desktop.getByRole('button',{name:'Archivos',exact:true}).count(),1);
  assert.equal(await desktop.locator('.shelf-more').evaluate(el=>el.open),false);
  await desktop.waitForFunction(()=>document.activeElement===document.querySelector('.shelf-more summary'));
  await desktop.locator('#island-content').screenshot({path:path.join(out,'files-panel-clean-340.png')});
  for(const [locale,phoneButton,downloadLabel,expired,offline] of [
   ['en','Phone','Download','The transfer ended. Create another QR code in Brivany.','Could not connect to Brivany.'],
   ['fr','Téléphone','Télécharger','Le transfert est terminé. Générez un nouveau QR code dans Brivany.','Impossible de se connecter à Brivany.'],
   ['pt-BR','Celular','Baixar','A transferência terminou. Gere outro código QR no Brivany.','Não foi possível conectar ao Brivany.']
  ]){
   await desktop.evaluate(code=>BrivanyWorkspacePreferences.setLocale(code),locale);
   await desktop.waitForFunction(code=>document.documentElement.lang===code,locale);
   await desktop.locator('.shelf-more summary').click();
   await desktop.getByRole('button',{name:phoneButton,exact:true}).click();
   await desktop.locator('#phone-qr').waitFor();
   const shared=await request('state');
   await phone.goto(shared.link);
   await phone.getByRole('link',{name:downloadLabel,exact:true}).waitFor();
   assert.equal(await phone.locator('html').getAttribute('lang'),locale);
   assert.equal(await phone.locator('h1').textContent(),'Documento propio.txt');
   assert.equal(new URL(phone.url()).hash,'');
   await phone.screenshot({path:path.join(out,'phone-'+locale+'.png')});
   const event=phone.waitForEvent('download');
   await phone.getByRole('link',{name:downloadLabel,exact:true}).click();
   const next=await event;
   assert.equal(next.suggestedFilename(),'Documento propio.txt');
   assert(fs.readFileSync(await next.path()).equals(expected));
   await phone.reload();
   await phone.getByRole('link',{name:downloadLabel,exact:true}).waitFor();
   await phone.route('**/info',route=>route.abort());
   await phone.reload();
   await phone.getByText(offline,{exact:true}).waitFor();
   assert.equal(await phone.locator('#download').isVisible(),false);
   await phone.unroute('**/info');
   await context.clearCookies();
   await phone.reload();
   await phone.getByText(expired,{exact:true}).waitFor();
   assert.equal(await phone.locator('#download').isVisible(),false);
   await desktop.locator('#phone-cancel').click();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  report.checks.push('Actual loopback HTTPS listener starts for the chosen fixture file.', 'Desktop QR card fits 340px; network/certificate details stay in Settings.', 'Mobile page consumes the fragment capability, uses a secure cookie and downloads the exact owned bytes.', 'PC receives connection/completion events and cancellation removes the listener capability.');
  report.checks.push('The selected WorkSpace locale reaches the HTTPS phone page in four languages. Names and bytes survive download and reload; connection and expired-session messages are localized.');
  report.downloaded_bytes=expected.length;report.passed=true;
 }catch(error){let text=error.stack||error.message||String(error);for(const value of secrets){text=text.split(value).join('[temporary link redacted]');const token=new URL(value).hash.slice(1);if(token)text=text.split(token).join('[redacted]')}report.error=text;console.error(text);process.exitCode=1}
 finally{
  clearTimeout(timeout);if(browser)await browser.close();fixture.stdin.end();
  await new Promise(resolve=>{if(fixture.exitCode!==null)return resolve();const timer=setTimeout(()=>{fixture.kill();resolve()},5000);fixture.once('exit',()=>{clearTimeout(timer);resolve()})});
  // Protocol envelopes, capabilities, cookies, private keys and stderr are not evidence.
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
})();
