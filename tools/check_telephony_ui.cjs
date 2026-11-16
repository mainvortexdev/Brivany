'use strict';
// Production WorkSpace in Edge, with substituted desktop/telephone operations.
const {chromium} = require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
 const audio = execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','0.30','-f','mp3','pipe:1'], {windowsHide:true}).toString('base64');
 const browser = await chromium.launch({channel:'msedge', headless:true});
 const directory = path.join(root, 'tmp/telephony-ui');
 fs.mkdirSync(directory, {recursive:true});
 const report = {passed:false, mode:'real_edge_substituted_telephone_bridge', external_calls:0, checks:[]};
 try {
  const context = await browser.newContext({viewport:{width:1024,height:720}});
  const errors = [];
  await context.route('**/*', route => {
   const url = new URL(route.request().url());
   if (url.protocol === 'blob:') return route.continue();
   if (url.hostname !== 'calls.test') { errors.push('External request'); return route.abort(); }
   const target = url.pathname === '/work-widget' ? path.join(root,'desktop/experience/work-widget.html') :
    url.pathname === '/typography.css' ? path.join(root,'web/typography.css') :
    url.pathname.startsWith('/desktop-shell/') ? path.join(root,'desktop/experience',path.basename(url.pathname)) : null;
   if (!target || !fs.existsSync(target)) return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(target),contentType:target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html'});
  });
  await context.addInitScript(audio => {
   const identifier = '00000000-0000-4000-8000-000000000001';
   const destination = '+18295550101';
   window.__telephoneCalls = [];
   window.__connected = false;
   window.__mobileIncoming = false;
   window.__record = null;
   window.pywebview = {api:{
    work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}), work_island_pointer:async()=>null,
    work_island_keyboard:async()=>({ok:true}), spotify_status:async()=>({connected:false}), workspace_chat_state:async()=>({messages:[]}),
    workspace_phone_state:async()=>({paired:false}),
    workspace_chat_command:async()=>{__telephoneCalls.push('chat-send');return {ok:true}},
    work_island_layout:async(expanded,_size,panel,_motion,_manual,x)=>({expanded,panel,width:Math.min(innerWidth-16,500),height:280,clip_left:8,anchor_x:x}),
    workspace_telephone_info:async()=>{__telephoneCalls.push('info');return {configured:__connected,outbound:__connected,voicemail:__connected&&!__mobileIncoming,incoming:__mobileIncoming?'mobile':'gateway'}},
    workspace_telephone_prepare:async(_number,objective)=>{__telephoneCalls.push('prepare');const entered=_number.replace(/[ .()-]/g,'');window.__reviewDestination=entered.startsWith('+')?entered:'+1'+entered;return {id:identifier,destination:__reviewDestination,objective}},
    workspace_telephone_discard:async()=>{__telephoneCalls.push('discard');return {discarded:true}},
    workspace_telephone_confirm:async()=>{__telephoneCalls.push('confirm');__record={id:identifier,destination:__reviewDestination,state:'ringing'};return __record},
    workspace_telephone_status:async()=>{__telephoneCalls.push('status');return __record},
    workspace_telephone_cancel:async()=>{__telephoneCalls.push('cancel');__record={...__record,state:'canceled',result:'Llamada detenida.'};return __record},
    workspace_telephone_mailbox:async()=>({messages:[{id:'RE'+'1'.repeat(32),caller:destination,seconds:1,created:1794090000}]}),
    workspace_telephone_recording:async()=>{__telephoneCalls.push('recording');return {audio}},
   }};
  }, audio);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://calls.test/work-widget');
  await page.waitForFunction(() => window.BrivanyTelephone);
  assert.deepEqual(await page.evaluate(() => __telephoneCalls), []);
  await page.getByRole('button',{name:'Herramientas',exact:true}).click();
  const picker = page.getByLabel('Herramienta',{exact:true});
  await picker.selectOption('telephone');
  await page.getByText('La conexión de llamadas todavía no está configurada.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Revisar llamada'}).isDisabled(),true);
  await picker.selectOption('timer');
  await page.evaluate(()=>{__connected=true;BrivanyIsland.expand('chat',400)});
  const chat = page.getByLabel('Escribir a Melodi',{exact:true});
  await chat.fill('Melodi, llama al (829) 555-0101 para preguntar el horario.');
  await chat.press('Enter');
  await page.getByRole('button',{name:'Revisar llamada'}).waitFor();
  assert.equal(await page.locator('#telephone-number').inputValue(),'(829) 555-0101');
  assert.equal(await page.locator('#telephone-objective').inputValue(),'preguntar el horario.');
  assert.equal(await page.evaluate(()=>__telephoneCalls.includes('chat-send')),false);
  await page.getByRole('button',{name:'Revisar llamada'}).click();
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  assert.equal(await page.evaluate(()=>__telephoneCalls.filter(value=>value==='confirm').length),0);
  await page.getByRole('button',{name:'Revisar llamada'}).click();
  await page.getByText('+18295550101',{exact:true}).waitFor();
  await page.setViewportSize({width:340,height:640});
  await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:324,height:280,clip_left:8,anchor_x:170}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(directory,'review-340.png')});
  await page.getByRole('button',{name:'Llamar ahora'}).click();
  await page.getByText('Sonando',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>__telephoneCalls.filter(value=>value==='confirm').length),1);
  await page.getByRole('button',{name:'Colgar',exact:true}).click();
  await page.getByText('Llamada cancelada',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Nueva llamada',exact:true}).click();
  report.checks.push('Explicit chat command pre-fills a draft, local review can be edited, only confirm dials, and cancellation is shown at 340 px.');
  await page.locator('#telephone-number').fill('+18495550102');
  await page.locator('#telephone-objective').fill('Consulta a un contacto nuevo de prueba.');
  await page.getByRole('button',{name:'Revisar llamada'}).click();
  await page.getByText('+18495550102',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>__telephoneCalls.filter(value=>value==='confirm').length),1);
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  report.checks.push('A new destination can be reviewed directly without a registration step or a call.');
  await page.getByRole('button',{name:'Buzón',exact:true}).click();
  await page.getByRole('button',{name:'Escuchar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#telephone-audio').readyState>=2);
  assert.ok(await page.locator('#telephone-audio').evaluate(element=>element.src.startsWith('blob:')));
  await picker.selectOption('timer');
  assert.equal(await page.locator('#telephone-audio').getAttribute('src'),null);
  report.checks.push('Mailbox playback decodes a synthetic MP3 and clears its audio when the view is left.');
  await page.evaluate(()=>{__mobileIncoming=true});
  await picker.selectOption('telephone');
  await page.waitForFunction(()=>document.querySelector('[data-telephone-tab="mail"]').hidden);
  assert.equal(await page.locator('#telephone-mailbox').isVisible(),false);
  report.checks.push('A Telnyx connection with incoming calls on the mobile hides the unused Melodi mailbox.');
  assert.deepEqual(errors,[]);
  report.passed=true;
 } finally {
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  await browser.close();
 }
 console.log(JSON.stringify(report));
})().catch(error => {console.error(error.stack);process.exitCode=1});
