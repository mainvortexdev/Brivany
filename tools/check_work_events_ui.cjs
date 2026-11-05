'use strict';
// Real local HTTP and DOM; ASR, output, editor, native windows and delivery substituted.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/work-events-ui';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const context=await browser.newContext({viewport:{width:1120,height:760}}),errors=[],external=[];
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol.startsWith('http')&&url.origin!==base){external.push(url.origin);return route.abort();}return route.continue();});
  await context.addInitScript(()=>{
   if(parent!==window)return;
   window.__workFixture={active:false,capturing:false,monitoring:false,translation_state:'idle',offer:null};window.__nativeCalls=[];
   window.pywebview={api:{
    authorize_computer:async()=>(await fetch('/__computer-test/arm',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json(),
    open_edits:async()=>{window.__nativeCalls.push('open_edits');return {tools:48};},
    start_work:async()=>{window.__nativeCalls.push('start_work');window.__workFixture.active=true;return {ok:true};},
    work_status:async()=>window.__workFixture,
    work_audio:async(enabled,consent)=>{window.__nativeCalls.push(['work_audio',enabled,consent]);window.__workFixture.capturing=enabled;return window.__workFixture;},
    work_translation_decision:async(id,accept)=>{window.__nativeCalls.push(['decision',id,accept]);window.__workFixture.offer=null;window.__workFixture.translation_state=accept?'recording':'idle';return window.__workFixture;},
    work_finish_translation:async()=>{window.__nativeCalls.push('finish');window.__workFixture.translation_state='translating';return window.__workFixture;},
    begin_work_region:async()=>{window.__nativeCalls.push('begin_region');return {ok:true};},
    return_to_chat:async()=>{window.__nativeCalls.push('return');return {ok:true};},stop_work:async()=>{window.__nativeCalls.push('stop');return {ok:true};},
    work_region_preview:async()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;canvas.getContext('2d').fillRect(0,0,600,400);return {preview:canvas.toDataURL(),width:600,height:400};},
    use_work_region:async(...args)=>{window.__nativeCalls.push(['region',...args]);return {ok:true};},cancel_work_region:async()=>{window.__nativeCalls.push('cancel_region');return {ok:true};}
   }};
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/brivany-shell');
  const ui=page.frameLocator('#module-frame');await ui.locator('#chat-message').waitFor();const frame=page.frames().find(f=>new URL(f.url()).pathname==='/app');
  await page.route('**/api/status',route=>route.fulfill({json:{voice:{asr:{available:true},tts:{configured:true},websocket_url:'ws://fixture.invalid/live'}}}));
  await frame.evaluate(()=>{
   window.__micNode=document.querySelector('#mic-toggle');window.__spoken=[];window.__audio=new AudioContext();const output=window.__audio.createMediaStreamDestination();navigator.mediaDevices.getUserMedia=async()=>output.stream;
   BrivanyLive.MuseCapture.prototype.start=async function(){window.__asr=this;return true;};BrivanyLive.PCMPlayer.prototype.prepare=async()=>{};
   BrivanyLive.MelodiOutput.prototype.speak=function(segments){this.onState(true);return (async()=>{try{for await(const p of segments)window.__spoken.push(p.text);}finally{this.onState(false);}})();};
  });
  await ui.getByRole('button',{name:'Iniciar voz live'}).click();await ui.locator('#mic-toggle[aria-pressed=true]').waitFor();
  await frame.evaluate(()=>window.__asr.onTranscript({id:'edits-fixture',text:'fixture edición',final:true}));
  const edits=page.locator('.agent-monitor li').filter({hasText:'Agente de edición de video'});await edits.getByText('Agente de edición de video · Listo para revisar',{exact:true}).waitFor({state:'attached'});
  await page.locator('.agent-monitor summary').click();await edits.getByRole('button',{name:'Revisar resultado',exact:true}).click();await ui.getByRole('button',{name:'Abrir Cognira Edits',exact:true}).click();
  assert((await page.evaluate(()=>window.__nativeCalls)).includes('open_edits'));await ui.getByRole('button',{name:'Cerrar resultado de edición'}).click();
  await frame.evaluate(()=>window.__asr.onTranscript({id:'skill-fixture',text:'fixture habilidad',final:true}));await ui.getByRole('button',{name:'Cerrar módulo junto al chat'}).waitFor();
  assert.equal(await frame.evaluate(()=>window.__micNode===document.querySelector('#mic-toggle')&&document.querySelector('#mic-toggle').getAttribute('aria-pressed')==='true'),true);
  await ui.getByRole('button',{name:'Cerrar módulo junto al chat'}).click();
  await frame.evaluate(()=>window.__asr.onTranscript({id:'schedule-fixture',text:'fixture espera',final:true}));
  const scheduler=page.locator('.agent-monitor li').filter({hasText:'Coordinador de esperas'});await scheduler.getByText('Coordinador de esperas · Listo para revisar',{exact:true}).waitFor({state:'attached'});
  await page.locator('.agent-monitor summary').click();await scheduler.getByRole('button',{name:'Revisar resultado',exact:true}).click();await ui.getByRole('button',{name:'Activar esta espera y sus entregas'}).waitFor();
  await ui.getByText('Subir la exportación comprobada a Drive · Fixture',{exact:true}).waitFor();await ui.getByRole('button',{name:'Activar esta espera y sus entregas'}).click();await ui.getByRole('button',{name:'Espera activada'}).waitFor();
  await ui.getByRole('button',{name:'Cancelar espera',exact:true}).click();await ui.getByText('Espera cancelada. Comprueba operaciones que ya estuvieran en curso.',{exact:true}).waitFor();await ui.getByRole('button',{name:'Cerrar espera'}).click();
  await page.getByRole('button',{name:'Ajustes',exact:true}).click();const settings=page.frameLocator('#settings-frame');await settings.getByRole('button',{name:'Capacidades',exact:true}).click();await settings.getByText('Esperas por hora y finalización de tareas',{exact:true}).waitFor();await settings.getByRole('button',{name:'Conectar editor'}).click();await settings.getByText('MCP conectado · 48 herramientas del editor.',{exact:true}).waitFor();
  await settings.getByRole('button',{name:'Melodi WorkSpace',exact:true}).click();await settings.getByRole('button',{name:'Abrir WorkSpace'}).click();assert((await page.evaluate(()=>window.__nativeCalls)).includes('start_work'));await page.getByRole('button',{name:'Cerrar ajustes'}).click();
  assert(await frame.evaluate(()=>document.querySelector('#mic-toggle')===window.__micNode));await page.screenshot({path:dir+'/live-capabilities.png'});await ui.getByRole('button',{name:'Terminar voz live'}).click();await frame.evaluate(()=>window.__audio.close());
  const widget=await context.newPage();widget.on('pageerror',e=>errors.push(e.message));await widget.goto(base+'/work-widget');await widget.evaluate(()=>window.BrivanyIsland.expand('screen'));await widget.getByRole('button',{name:'Seleccionar región ↗'}).waitFor();assert.deepEqual(await widget.evaluate(()=>window.__nativeCalls),[]);await widget.evaluate(()=>window.BrivanyIsland.expand('translation'));
  await widget.getByRole('switch',{name:/Detectar otro idioma/}).check();assert.deepEqual(await widget.evaluate(()=>window.__nativeCalls[0]),['work_audio',true,true]);
  await widget.evaluate(()=>{window.__workFixture.offer={id:'fixture-offer',question:'¿Traducir el audio sintético?'};});await widget.getByRole('button',{name:'Conservar y traducir'}).click();await widget.getByRole('button',{name:'Finalizar grabación y traducir'}).waitFor();await widget.getByRole('button',{name:'Finalizar grabación y traducir'}).click();await widget.getByText('Traduciendo la grabación conservada…',{exact:true}).waitFor();
  for(const [width,height] of [[360,370],[280,240],[390,568]]){await widget.setViewportSize({width,height});assert(await widget.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}await widget.screenshot({path:dir+'/work-widget.png'});
  const region=await context.newPage();region.on('pageerror',e=>errors.push(e.message));await region.goto(base+'/work-capture');await region.locator('#region-image').waitFor();await region.waitForFunction(()=>document.querySelector('#region-image').naturalWidth===600);
  const box=await region.locator('#region-image').boundingBox();await region.mouse.move(box.x+20,box.y+20);await region.mouse.down();await region.mouse.move(box.x+box.width/2,box.y+box.height/2);await region.mouse.up();await region.getByRole('button',{name:'Traducir',exact:true}).click();
  const selected=await region.evaluate(()=>window.__nativeCalls.find(item=>Array.isArray(item)&&item[0]==='region'));assert.equal(selected[5],'translate');assert(selected.slice(1,5).every(v=>v>0&&v<1));await region.keyboard.press('Escape');assert((await region.evaluate(()=>window.__nativeCalls)).includes('cancel_region'));
  for(const [width,height] of [[1120,760],[390,568],[320,568]]){await region.setViewportSize({width,height});assert(await region.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}await region.screenshot({path:dir+'/region-selector.png'});
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  const report={status:'passed',checks:['live transcript dispatches actual independent edit job through substituted MCP','skill opens alongside same live microphone node','scheduled delivery exact review, one activation, cancellation','capability catalog and Work settings reachable without replacing chat','Work starts without audio; detection has explicit consent; offer requires acceptance; finish starts translation','widget and region selector fit narrow viewports; normalized region and Escape work'],providers_and_native_windows:'substituted',real_ui_http:true,physical_audio_verified:false,real_outbound_delivery:false,external_calls:0,errors};fs.writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
