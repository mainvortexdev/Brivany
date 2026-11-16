'use strict';
// Actual panel -> Python review -> gateway -> synthetic duplex session -> receipt.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),readline=require('node:readline');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'tmp/whatsapp-client-ui');
fs.mkdirSync(directory,{recursive:true});

(async()=>{
 const fixture=spawn(process.env.BRIVANY_TEST_PYTHON||'python',['-X','utf8','-B','-m','tools.whatsapp_client_fixture'],
  {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let sequence=0,readyResolve,readyReject,stderr='';const pending=new Map();
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject});
 readline.createInterface({input:fixture.stdout}).on('line',line=>{
  const message=JSON.parse(line);if(message.ready)return readyResolve();
  const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(Error(message.error)):item.resolve(message.value)}
 });
 fixture.stderr.on('data',chunk=>{stderr+=chunk.toString()});
 fixture.on('exit',code=>{if(code)readyReject(Error(stderr));for(const item of pending.values())item.reject(Error('Fixture closed'));pending.clear()});
 const request=(method,...args)=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Fixture timed out: '+method))},10000);
  pending.set(id,{resolve,reject,timer});fixture.stdin.write(JSON.stringify({id,method,args})+'\n');
 });
 let browser;const report={passed:false,mode:'Edge_to_Python_client_gateway_simulation',external_calls:0,checks:[]};
 try{
  await ready;browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1024,height:720}}),errors=[],external=[];
  await context.exposeBinding('telephoneBackend',(_,method,args)=>request(method,...args));
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.hostname!=='calls.test'){external.push(url.hostname);return route.abort()}
   const target=url.pathname==='/work-widget'?path.join(root,'desktop/experience/work-widget.html'):
    url.pathname==='/typography.css'?path.join(root,'web/typography.css'):
    /^\/desktop-shell\/workspace-locales\/(en|fr|pt-BR)\.json$/.test(url.pathname)?path.join(root,'desktop/experience/workspace-locales',path.basename(url.pathname)):
    url.pathname.startsWith('/desktop-shell/')?path.join(root,'desktop/experience',path.basename(url.pathname)):null;
   if(!target||!fs.existsSync(target))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(target),contentType:target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':target.endsWith('.json')?'application/json':'text/html'});
  });
  await context.addInitScript(()=>{
   const api={work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}),work_island_pointer:async()=>null,
    work_island_keyboard:async()=>({ok:true}),spotify_status:async()=>({connected:false}),workspace_chat_state:async()=>({messages:[]}),
    work_island_layout:async(expanded,_size,panel,_motion,_manual,x)=>({expanded,panel,width:Math.min(innerWidth-16,500),height:280,clip_left:8,anchor_x:x})};
   for(const method of ['channels','select_channel','info','prepare','discard','confirm','status','cancel','forget_receipt']){
    const name='workspace_telephone_'+method;api[name]=(...args)=>telephoneBackend(name,args);
   }
   window.pywebview={api};
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const open=async()=>{await page.getByRole('button',{name:'Herramientas',exact:true}).click();await page.getByLabel('Herramienta',{exact:true}).selectOption('telephone')};
  await page.goto('http://calls.test/work-widget');await page.waitForFunction(()=>window.BrivanyTelephone);await open();
  assert.equal(await page.evaluate(()=>BrivanyTelephone.fromText('Melodi, llama por WhatsApp al +18295550101 para Consulta de prueba.')),true);
  await page.getByRole('button',{name:'Revisar prueba',exact:true}).waitFor();
  assert.equal((await request('stats')).receipts,0);
  await page.locator('#telephone-number').fill('+1 (829) 555-0101');
  await page.locator('#telephone-objective').fill('Consulta de prueba con datos sintéticos.');
  await page.getByRole('button',{name:'Revisar prueba',exact:true}).click();
  await page.locator('#telephone-review-number').filter({hasText:'+18295550101'}).waitFor();
  assert.equal(await page.locator('#telephone-channel').isDisabled(),true);
  assert.equal((await request('stats')).receipts,0);
  await page.setViewportSize({width:340,height:640});
  await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:324,height:310,clip_left:8,anchor_x:170}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(directory,'review-340.png')});
  await page.getByRole('button',{name:'Probar ahora',exact:true}).click();
  await page.getByText('Simulación completada: 2 turnos de voz.',{exact:true}).waitFor({timeout:8000});
  assert.equal((await request('stats')).receipts,1);
  report.checks.push('An explicit WhatsApp chat command chooses the channel without dialing; panel review invokes the actual Python gateway once and completes two synthetic voice turns.');
  await page.evaluate(()=>localStorage.clear());await page.reload();await page.waitForFunction(()=>window.BrivanyTelephone);await open();
  await page.getByText('Simulación completada: 2 turnos de voz.',{exact:true}).waitFor();
  assert.equal(await page.locator('#telephone-channel').inputValue(),'whatsapp_client');
  report.checks.push('Disk selection and receipt recover after browser storage is cleared; no call is repeated.');
  await page.locator('#telephone-new').click();await request('hold',true);
  await page.locator('#telephone-number').fill('+18495550102');await page.locator('#telephone-objective').fill('Segunda prueba local.');
  await page.locator('#telephone-form button').click();await page.locator('#telephone-confirm').click();
  await page.locator('#telephone-cancel').click();
  await page.getByText('Simulación cancelada.',{exact:true}).waitFor({timeout:8000});
  report.checks.push('A second destination needs no registration; cancel closes the held synthetic session.');
  await page.locator('#telephone-new').click();
  for(const [locale,button] of [['en','Review test'],['fr','Vérifier le test'],['pt-BR','Revisar teste']]){
   await page.evaluate(locale=>{localStorage.setItem('brivany.workspace.interface.v1',JSON.stringify({locale}));dispatchEvent(new Event('brivany-workspace-settings'))},locale);
   await page.getByRole('button',{name:button,exact:true}).waitFor();
  }
  report.checks.push('New call controls translate into English, French and Brazilian Portuguese.');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  report.stats=await request('stats');report.passed=true;
 }finally{
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();
  fixture.stdin.end(JSON.stringify({id:++sequence,method:'close'})+'\n');
  await new Promise(resolve=>{if(fixture.exitCode!==null)return resolve();fixture.once('exit',resolve);setTimeout(()=>{fixture.kill();resolve()},5000).unref()});
 }
 console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.stack);process.exitCode=1});
