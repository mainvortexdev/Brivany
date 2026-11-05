'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/media-ui';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:1120,height:760}}),errors=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.addInitScript(()=>{if(parent!==window)return;window.__opened=[];window.pywebview={api:{
   authorize_computer:async()=>{const response=await fetch('/__computer-test/arm',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return response.json();},
   choose_edits_media:async()=>({ok:true,selected:['Video-de-prueba-con-un-nombre-largo-para-comprobar-la-legibilidad.mp4']}),
   clear_selected_media:async()=>({ok:true,selected:[]}),open_media_result:async(id,kind)=>{window.__opened.push({id,kind});return {ok:true};}
  }};});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/brivany-shell');
  const ui=page.frameLocator('#module-frame');await ui.locator('#chat-message').waitFor();
  const frame=page.frames().find(f=>new URL(f.url()).pathname==='/app');
  await frame.evaluate(()=>window.__mic=document.querySelector('#mic-toggle'));
  await ui.getByRole('button',{name:'Adjuntar video o audio',exact:true}).click();
  await ui.locator('.chat-media-selection').filter({hasText:'Video-de-prueba'}).waitFor();
  await page.evaluate(async()=>{const grant=await window.pywebview.api.authorize_computer();window.BrivanyComputerSession.token=grant.token;await window.BrivanyAgents.refresh();});
  await ui.locator('#chat-message').fill('fixture media');await ui.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
  await page.locator('.agent-alert').filter({hasText:'Agente de medios'}).waitFor();await page.locator('.agent-alert').getByRole('button',{name:'Ver resultado',exact:true}).click();
  await ui.getByRole('button',{name:'Abrir archivo',exact:true}).click();await ui.getByRole('button',{name:'Abrir carpeta',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.__opened.map(v=>v.kind)),['file','folder']);
  for(const [width,height] of [[1120,760],[390,568],[320,568]]){
   await page.setViewportSize({width,height});assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert(await frame.evaluate(()=>window.__mic===document.querySelector('#mic-toggle')));await page.screenshot({path:dir+'/media-'+width+'.png'});
  }
  await ui.getByRole('button',{name:'Cerrar resultado de medios',exact:true}).click();
  await ui.getByRole('button',{name:'Quitar videos y audios adjuntos',exact:true}).click();assert(await ui.locator('.chat-media-selection').isHidden());
  await ui.locator('#chat-message').fill('fixture soporte');await ui.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
  await page.locator('.agent-alert').filter({hasText:'Agente de documentación'}).waitFor();await page.locator('.agent-alert').getByRole('button',{name:'Ver resultado',exact:true}).click();
  assert.equal(await ui.getByRole('link',{name:'Manual · página 94',exact:true}).getAttribute('href'),'https://files.support.epson.com/docid/cpd6/cpd60186.pdf#page=94');
  assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  const result={status:'passed',checks:['video attachment names and removal','media background result and native IDs','official manual citation','1120/390/320 widths fit','microphone node retained'],models_and_native:'substituted',external_calls:0};
  fs.writeFileSync(dir+'/report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
