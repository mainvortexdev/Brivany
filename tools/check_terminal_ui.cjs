'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/terminal-ui';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:1120,height:760}}),errors=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.addInitScript(()=>{if(parent!==window)return;window.__opened=[];window.pywebview={api:{authorize_computer:async()=>{const response=await fetch('/__computer-test/arm',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return response.json();},open_terminal_evidence:async(id,kind)=>{window.__opened.push({id,kind});return {ok:true};}}};});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/brivany-shell');
  const ui=page.frameLocator('#module-frame');await ui.locator('#chat-message').waitFor();
  const frame=page.frames().find(f=>new URL(f.url()).pathname==='/app');
  await frame.evaluate(()=>window.__mic=document.querySelector('#mic-toggle'));
  await ui.locator('#chat-message').fill('fixture terminal');await ui.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
  await page.locator('.agent-alert').filter({hasText:'Agente de terminal'}).waitFor();
  await page.locator('.agent-alert').getByRole('button',{name:'Ver resultado',exact:true}).click();
  for(const label of ['Ver captura','Abrir informe','Abrir carpeta']){await ui.getByRole('button',{name:label,exact:true}).click();}
  assert.deepEqual(await page.evaluate(()=>window.__opened.map(v=>v.kind)),['capture','notes','folder']);
  for(const [width,height] of [[1120,760],[390,568],[320,568]]){
   await page.setViewportSize({width,height});assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert(await frame.evaluate(()=>window.__mic===document.querySelector('#mic-toggle')));
   await page.screenshot({path:dir+'/result-'+width+'.png'});
  }
  await ui.getByRole('button',{name:'Cerrar resultado de terminal',exact:true}).click();
  assert(await frame.evaluate(()=>window.__mic===document.querySelector('#mic-toggle')));assert.deepEqual(errors,[]);
  const result={status:'passed',checks:['terminal result announced and reviewed','capture/report/folder IDs passed to native bridge','three widths fit without horizontal overflow','microphone node preserved'],models_and_native:'substituted',external_calls:0};
  fs.writeFileSync(dir+'/report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
