'use strict';
// Actual PC and phone assets over an owned local HTTPS service. Native effects substituted.
const {chromium} = require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const root = path.resolve(__dirname,'..'), out = path.join(root,'tmp/phone-control-ui');

(async () => {
 fs.mkdirSync(out,{recursive:true});
 const fixture = spawn(process.env.BRIVANY_TEST_PYTHON || 'python', ['-X','utf8','-B','-m','tools.workspace_phone_fixture','--control'],
  {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 const pending = new Map();
 const errors = [];
 let sequence = 0, ready, unavailable, desktop, mobile, browser, link;
 const startup = new Promise((resolve,reject) => {ready=resolve;unavailable=reject;});
 const startupTimer = setTimeout(() => unavailable(Error('Control fixture startup timeout.')),12000);
 const lines = readline.createInterface({input:fixture.stdout});
 lines.on('line', line => {
  try {
   const result = JSON.parse(line);
   if (result.ready) { clearTimeout(startupTimer); ready(); }
   if (result.event && desktop) desktop.evaluate(value=>window.BrivanyPhoneControl?.receive(value),result.event).catch(()=>{});
   const slot = pending.get(result.id);
   if (slot) {
    pending.delete(result.id); clearTimeout(slot.timer);
    if (result.error) slot.reject(Error(result.error)); else slot.resolve(result.value);
   }
  } catch { unavailable(Error('Invalid fixture response.')); }
 });
 fixture.on('error', () => unavailable(Error('Fixture unavailable.')));
 fixture.stderr.on('data', () => {});
 fixture.on('exit', () => {
  unavailable(Error('Fixture exited.'));
  for (const slot of pending.values()) { clearTimeout(slot.timer); slot.reject(Error('Fixture exited.')); }
  pending.clear();
 });
 const ask = (action,args=[]) => new Promise((resolve,reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => {pending.delete(id);reject(Error('Fixture request timed out.'));},6000);
  pending.set(id,{resolve,reject,timer});
  fixture.stdin.write(JSON.stringify({id,action,args})+'\n');
 });
 async function waitObserved(check) {
  const until=Date.now()+3000;
  while(Date.now()<until) {
   const result=await ask('observed');
   if(check(result))return result;
   await new Promise(resolve=>setTimeout(resolve,70));
  }
  throw Error('Expected action not delivered to the fixture.');
 }

 const report = {passed:false,mode:'edge_mobile_viewport_real_https_simulated_windows_effects',external_calls:0,checks:[]};
 try {
  await startup;
  browser = await chromium.launch({channel:'msedge',headless:true});
  const pc = await browser.newContext({viewport:{width:340,height:650}});
  await pc.exposeBinding('controlFixture',async (_source, action,args) => ask(action,args));
  await pc.route('**/*',route => {
   const url = new URL(route.request().url());
   if (url.hostname!=='control.test') {errors.push('Unexpected PC origin.'); return route.abort();}
   const file = url.pathname==='/work-widget' ? path.join(root,'desktop/experience/work-widget.html') :
    url.pathname==='/typography.css' ? path.join(root,'web/typography.css') :
    url.pathname.startsWith('/desktop-shell/') ? path.join(root,'desktop/experience',path.basename(url.pathname)) : null;
   if (!file || !fs.existsSync(file)) return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  await pc.addInitScript(() => {
   window.pywebview = {api:{
    work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}), work_island_pointer:async()=>null,
    work_island_keyboard:async()=>({ok:true}), spotify_status:async()=>({connected:false}), workspace_chat_state:async()=>({messages:[]}),
    work_island_layout:async(expanded,_size,panel,_motion,_manual,x)=>({expanded,panel,width:324,height:280,clip_left:8,anchor_x:x}),
    workspace_phone_control_state:()=>controlFixture('state',[]), workspace_phone_control_start:()=>controlFixture('start',[]),
    workspace_phone_control_approve:(...args)=>controlFixture('approve',args), workspace_phone_control_stop:()=>controlFixture('stop',[]),
    workspace_phone_control_power:(...args)=>controlFixture('power',args),
   }};
  });
  desktop = await pc.newPage(); desktop.on('pageerror',e=>errors.push(e.message));
  await desktop.goto('http://control.test/work-widget');
  assert.equal((await ask('observed')).listening,false);
  await desktop.getByRole('button',{name:'Herramientas',exact:true}).click();
  await desktop.getByLabel('Herramienta',{exact:true}).selectOption('phone-control');
  await desktop.getByRole('button',{name:'Vincular teléfono',exact:true}).click();
  await desktop.getByAltText('QR para vincular el teléfono',{exact:true}).waitFor();
  assert.ok(await desktop.getByAltText('QR para vincular el teléfono').evaluate(img=>img.complete&&img.naturalWidth>100));
  link = await ask('link');
  const origin = new URL(link).origin;
  const handheld = await browser.newContext({viewport:{width:390,height:780},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});
  await handheld.route('**/*',route => {
   if (new URL(route.request().url()).origin===origin) return route.continue();
   errors.push('Unexpected phone origin.'); return route.abort();
  });
  mobile = await handheld.newPage(); mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto(link);
  assert.equal(new URL(mobile.url()).hash,'');
  await mobile.getByRole('button',{name:'Vincular',exact:true}).click();
  const code = mobile.getByLabel('Código de vinculación',{exact:true});
  await code.waitFor();
  assert.match(await code.textContent(),/^\d{6}$/);
  await desktop.getByLabel('Código del teléfono',{exact:true}).waitFor();
  assert.equal(await mobile.getByRole('button',{name:'Música',exact:true}).isVisible(),false);
  await desktop.getByLabel('Código del teléfono',{exact:true}).fill(await code.textContent());
  for (const name of ['Teclado y trackpad','Pantalla principal','Música','Diapositivas','Energía']) await desktop.getByRole('checkbox',{name,exact:true}).check();
  await desktop.getByRole('button',{name:'Autorizar',exact:true}).click();
  await desktop.getByText('Teléfono conectado',{exact:true}).waitFor();
  await mobile.getByRole('button',{name:'Ver pantalla',exact:true}).waitFor();
  assert.equal((await ask('observed')).frames,0);
  report.checks.push('Real TLS QR session with code and five explicit permissions. No capture before screen is opened.');

  await mobile.getByRole('button',{name:'Ver pantalla',exact:true}).click();
  const screen = mobile.getByAltText('Pantalla principal del PC',{exact:true});
  await screen.waitFor();
  await mobile.waitForFunction(()=>document.querySelector('#screen').naturalWidth===420);
  await screen.tap();
  const pad = await mobile.getByRole('group',{name:'Trackpad'}).boundingBox();
  await mobile.mouse.move(pad.x+36,pad.y+45); await mobile.mouse.down();
  await mobile.mouse.move(pad.x+119,pad.y+72,{steps:4}); await mobile.mouse.up();
  await mobile.getByLabel('Texto para el PC',{exact:true}).fill('Nota propia 🙂');
  await mobile.getByRole('button',{name:'Enviar',exact:true}).click();
  const input=await waitObserved(value=>['tap-screen','move','text'].every(kind=>value.events.some(event=>event[0]===kind)));
  assert.equal(input.events.find(row=>row[0]==='text')[1].text,'Nota propia 🙂');
  await mobile.screenshot({path:path.join(out,'desktop-390.png')});
  await mobile.getByRole('button',{name:'Música',exact:true}).click();
  await mobile.getByRole('button',{name:'Reproducir o pausar',exact:true}).click();
  await mobile.getByRole('button',{name:'Diapositivas',exact:true}).click();
  await mobile.getByRole('button',{name:'Siguiente →',exact:true}).click();
  await waitObserved(value=>['music','slides'].every(kind=>value.events.some(event=>event[0]===kind)));
  await new Promise(resolve=>setTimeout(resolve,600));
  const frames=(await ask('observed')).frames;
  await new Promise(resolve=>setTimeout(resolve,620));
  assert.equal((await ask('observed')).frames,frames);
  report.checks.push('Screen preview, absolute tap, relative trackpad, Unicode text, media and slide actions reach the driver substitute. Capture stops on leaving screen.');

  await mobile.getByRole('button',{name:'Energía',exact:true}).click();
  await mobile.getByRole('button',{name:'Apagar PC',exact:true}).click();
  await desktop.getByRole('button',{name:'Rechazar',exact:true}).waitFor();
  assert.deepEqual((await ask('observed')).power,[]);
  await desktop.getByRole('button',{name:'Rechazar',exact:true}).click();
  await mobile.waitForFunction(()=>!document.querySelector('[data-pane="power"]').inert);
  await mobile.getByRole('button',{name:'Bloquear PC',exact:true}).click();
  await desktop.getByRole('button',{name:'Bloquear',exact:true}).click();
  const finished=await waitObserved(value=>value.power.includes('lock'));
  assert.deepEqual(finished.power,['lock']); assert.equal(finished.listening,false);
  await desktop.getByRole('button',{name:'Vincular teléfono',exact:true}).waitFor();
  await mobile.getByText(/^Conexión (finalizada|interrumpida)\.$/).waitFor();
  assert.equal(await mobile.locator('#controls').isVisible(),false);
  report.checks.push('Remote power is pending until desktop approval. Rejecting shutdown and approving lock execute exactly one substituted action and close the listener.');
  assert.deepEqual(errors,[]);
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  report.passed=true;
 } catch (error) {
  const detail=String(error.stack||error.message);
  throw Error(link ? detail.replaceAll(link,'<owned pairing URL>').replaceAll(new URL(link).origin,'<owned TLS origin>') : detail);
 } finally {
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  if (browser) await browser.close();
  fixture.stdin.end();
  if (fixture.exitCode===null) await new Promise(resolve=>{
   const timer=setTimeout(()=>{fixture.kill();resolve();},3000);
   fixture.once('exit',()=>{clearTimeout(timer);resolve();});
  });
  lines.close(); clearTimeout(startupTimer);
 }
 console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
