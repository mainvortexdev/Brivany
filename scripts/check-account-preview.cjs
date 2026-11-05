const {chromium}=require('../motion-studio/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:1050}}),errors=[],calls=[],polled=new Set();
 let account={id:'fixture-account-a',name:'Cuenta A',email:'fixture-a@brivany.test'},release;
 const desktop=id=>({id,name:'Ordenador '+id,kind:'desktop',online:true,enabled:true});
 const devices=[desktop('A'),desktop('B'),{...desktop('Revocado'),enabled:false}];
 const ndjson=events=>events.map(e=>JSON.stringify(e)).join('\n')+'\n';
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:8788'?route.continue():route.abort());
 await page.route('**/api/account',r=>r.fulfill({json:account?{signed_in:true,account,devices}:{signed_in:false,devices:[]}}));
 await page.route('**/api/account/logout',r=>{account=null;return r.fulfill({json:{signed_in:false,devices:[]}})});
 await page.route('**/api/account/login',r=>{account={id:'fixture-account-b',name:'Cuenta B',email:'fixture-b@brivany.test'};return r.fulfill({json:{signed_in:true,account,devices:[]}})});
 await page.route('**/api/chat',async route=>{
  const body=route.request().postDataJSON();calls.push(body);const text=body.messages.at(-1).content;
  if(text==='Tarea A')await new Promise(resolve=>release=resolve);
  const id=text==='Tarea A'?'job-a':'job-b';
  const events=text==='Elegir equipo'?[{type:'computer_choice',command:{id:'choice',computers:devices.slice(0,2)}}]:[{type:'computer_job',command:{id}}];
  await route.fulfill({contentType:'application/x-ndjson',body:ndjson([...events,{type:'delta',text:text==='Elegir equipo'?'¿En qué ordenador?':'Recibida '+text},{type:'done'}])});
 });
 await page.route('**/api/commands/select',route=>{assert.equal(route.request().postDataJSON().computer,'B');return route.fulfill({json:{command:{id:'job-choice',state:'offered',message:'Enviado al ordenador B'}}})});
 await page.route('**/api/commands/*',route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1);if(id==='select')return route.fallback();polled.add(id);return route.fulfill({json:{command:{id,state:'succeeded',message:'Terminada '+id}}})});
 page.on('pageerror',e=>errors.push(e.message));
 const send=async text=>{await page.getByRole('textbox',{name:'Mensaje para Melodi'}).fill(text);await page.getByRole('button',{name:'Enviar mensaje',exact:true}).click()};
 try{
  await page.goto('http://127.0.0.1:8788/');await page.waitForFunction(()=>window.BrivanyAccountPreview?.signedIn);
  await send('Tarea A');await page.waitForFunction(()=>document.querySelector('.message.user')?.textContent==='Tarea A');
  await page.getByRole('button',{name:'Nueva conversación'}).click();await send('Tarea B');
  await page.getByText('Recibida Tarea B',{exact:true}).waitFor();release();await page.getByText('Terminada job-b',{exact:true}).waitFor();
  assert.equal(await page.getByText('Recibida Tarea A',{exact:true}).count(),0);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('brivany.iphone.preview.chats.fixture-account-a')).some(c=>c.messages.some(m=>m.text==='Terminada job-a')));
  assert.notEqual(calls[0].conversation_id,calls[1].conversation_id);assert.equal(calls[0].source,'chat');assert(polled.has('job-a')&&polled.has('job-b'));
  await page.getByRole('button',{name:'Nueva conversación'}).click();await send('Elegir equipo');await page.getByRole('button',{name:'Ordenador B',exact:true}).click();await page.getByText('Enviado al ordenador B',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Iniciar modo de voz',exact:true}).click();await page.getByRole('textbox',{name:'Escribe a Melodi'}).fill('Voz de prueba');await page.getByRole('button',{name:'Enviar en Live'}).click();await page.waitForFunction(()=>document.querySelector('.live-status')?.textContent!=='Pensando…');assert.equal(calls.at(-1).source,'voice');
  await page.getByRole('button',{name:'Finalizar conversación'}).click();
  await page.getByRole('button',{name:'Ajustes',exact:true}).click();await page.locator('[data-detail=connection]').click();
  assert.equal(await page.getByText('Ordenador Revocado',{exact:true}).count(),0);
  fs.mkdirSync('tmp/account-remote',{recursive:true});await page.screenshot({path:'tmp/account-remote/account-ui-fixture.png'});
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
  await page.getByLabel('Correo',{exact:true}).fill('fixture-b@brivany.test');await page.getByLabel('Contraseña',{exact:true}).fill('fixture-only-not-a-real-password');
  await page.waitForTimeout(10300);assert.equal(await page.getByLabel('Contraseña',{exact:true}).inputValue(),'fixture-only-not-a-real-password');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.getByText('Cuenta B',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Melodi',exact:true}).click();assert.equal(await page.locator('.message').count(),0);
  assert.deepEqual(errors,[]);const report={passed:true,scope:'isolated_browser_fixture_not_physical_iPhone',external_calls:0,checks:['conversation_ownership_during_async_reply','parallel_job_monitoring','multi_computer_selection','voice_source_routing','revoked_device_hidden','login_fields_preserved','account_history_isolation'],errors};
  fs.writeFileSync('tmp/account-remote/preview-fixture.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{if(release)release();await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
