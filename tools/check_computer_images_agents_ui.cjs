'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/computer-images-agents-ui';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const context=await browser.newContext({viewport:{width:1120,height:760}}),errors=[],external=[];
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol.startsWith('http')&&url.origin!==base){external.push(url.origin);return route.abort();}return route.continue();});
  await context.addInitScript(()=>{if(parent!==window)return;window.__ducking={supported:true,enabled:true,ducked:false,excluded:[]};window.__duckCalls=[];window.pywebview={api:{music_ducking_status:async()=>window.__ducking,music_ducking_configure:async(enabled,remove)=>{window.__duckCalls.push([enabled,remove]);if(typeof enabled==='boolean')window.__ducking.enabled=enabled;if(Number.isInteger(remove))window.__ducking.excluded.splice(remove,1);return window.__ducking;},music_ducking_add_game:async()=>{window.__ducking.excluded.push('synthetic-game.exe');return window.__ducking;},authorize_computer:async()=>{const response=await fetch('/__computer-test/arm',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return response.json();}}};});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  // Chat caches its voice configuration on load. Substitute before navigation.
  await page.route('**/api/status',route=>route.fulfill({json:{provider:{configured:true},voice:{asr:{available:true,configured:true},tts:{configured:true},websocket_url:'ws://fixture.invalid/live'}}}));
  await page.goto(base+'/brivany-shell');
  const ui=page.frameLocator('#module-frame');await ui.locator('#chat-message').waitFor();let frame=page.frames().find(item=>new URL(item.url()).pathname==='/app');
  assert.equal(await ui.locator('.computer-panel').isVisible(),false);assert.equal(await ui.locator('.chat-welcome').isVisible(),true);
  assert.equal(await ui.locator('.chat-symbol').count(),0);assert.equal(await ui.getByText('Estoy contigo.',{exact:true}).count(),0);
  for(const label of ['Adjuntar video o audio','Adjuntar imágenes']){const b=ui.getByRole('button',{name:label,exact:true});await b.waitFor();assert.equal(await b.locator('svg').count(),1);await b.focus();assert.equal(await b.evaluate(el=>getComputedStyle(el).outlineStyle),'none');}
  for(const selector of ['#sidebar-toggle','#new-session','.topbar-actions button[aria-label="Abrir Melodi WorkSpace"]']){const b=page.locator(selector);assert.equal(await b.locator('svg').count(),1);await b.focus();assert.equal(await b.evaluate(el=>getComputedStyle(el).outlineStyle),'none');}
  await page.screenshot({path:dir+'/clean-chat.png'});
  const send=async text=>{await ui.locator('#chat-message').fill(text);await ui.getByRole('button',{name:'Enviar mensaje',exact:true}).click();};
  await send('charla fixture');await ui.getByText('Podemos seguir hablando.',{exact:true}).waitFor();assert.equal(await frame.evaluate(()=>parent.BrivanyComputerSession.token),null);
  await ui.locator('#chat-message').evaluate(input=>{const data=new DataTransfer();data.items.add(new File(['synthetic'],'fixture.gif',{type:'image/gif'}));input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});await ui.getByText('Usa PNG, JPEG o WebP.',{exact:true}).first().waitFor();
  await ui.locator('#chat-message').evaluate(input=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#30a58a';ctx.fillRect(0,0,80,64);canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'fixture.png',{type:'image/png'}));input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));});});
  await ui.locator('.reference-item').waitFor();await send('describe fixture');await ui.getByText('Veo la referencia sintética adjunta.',{exact:true}).waitFor();
  assert.equal(await frame.evaluate(()=>parent.BrivanyComputerSession.token),null);await frame.evaluate(()=>window.__originalMic=document.querySelector('#mic-toggle'));
  await send('fixture plano');
  await page.locator('.agent-alert').filter({hasText:'Agente espacial'}).waitFor({state:'visible',timeout:30000});assert.equal(await page.locator('.agent-monitor').count(),0);
  await page.locator('.agent-alert').getByRole('button',{name:'Ver resultado',exact:true}).click();
  await ui.locator('.computer-preview iframe').waitFor();const viewer=await (await ui.locator('.computer-preview iframe').elementHandle()).contentFrame();await viewer.waitForFunction(()=>document.querySelector('#floorplan-canvas')?.offsetWidth>0,null,{timeout:20000});
  for(const [width,height] of [[1440,844],[1120,760],[768,844],[390,844],[320,844],[390,568],[640,480]]){
   await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const mic=await ui.locator('#mic-toggle').boundingBox();assert(mic&&mic.x>=0&&mic.y>=0&&mic.x+mic.width<=width+1&&mic.y+mic.height<=height+1,'Mic outside '+width+'x'+height);
  }
  await page.setViewportSize({width:1120,height:760});await ui.getByRole('button',{name:'Cerrar vista del modelo'}).click();
  let delayed,arrived;const routeReady=new Promise(resolve=>arrived=resolve);await page.route('**/api/computer/image-turn',route=>{delayed=route;arrived();});
  await frame.evaluate(()=>{window.__lateImage=window.BrivanyImageRequest.requestTurn({text:'fixture plano',history:[],consent:true,language:'es'}).then(()=> 'unexpected').catch(error=>error.message);});
  await routeReady;await frame.evaluate(()=>window.BrivanyImageRequest.clear());await delayed.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'reference_action',ticket:'late-fixture',kind:'model'})+'\n'});assert.match(await frame.evaluate(()=>window.__lateImage),/sesión cambió/);await page.unroute('**/api/computer/image-turn');
  await send('fixture documento');await page.locator('.agent-alert').filter({hasText:'Agente de redacción'}).waitFor({state:'visible'});
  await page.locator('.agent-alert').getByRole('button',{name:'Ver resultado',exact:true}).click();
  await ui.getByRole('button',{name:'Cerrar documento'}).waitFor();assert(await frame.evaluate(()=>window.__originalMic===document.querySelector('#mic-toggle')));
  await page.screenshot({path:dir+'/document-and-live.png'});await ui.getByRole('button',{name:'Cerrar documento'}).click();
  await page.evaluate(()=>{window.__openedEvidence=[];window.pywebview.api.open_terminal_evidence=async(id,kind)=>{window.__openedEvidence.push({id,kind});return {ok:true};};});
  await send('fixture terminal');await page.locator('.agent-alert').filter({hasText:'Agente de terminal'}).waitFor({state:'visible'});
  await page.locator('.agent-alert').getByRole('button',{name:'Ver resultado',exact:true}).click();
  await ui.getByRole('button',{name:'Ver captura',exact:true}).waitFor();await ui.getByRole('button',{name:'Abrir informe',exact:true}).waitFor();
  await ui.getByRole('button',{name:'Abrir carpeta',exact:true}).click();assert.equal(await page.evaluate(()=>window.__openedEvidence[0].kind),'folder');
  assert(await frame.evaluate(()=>window.__originalMic===document.querySelector('#mic-toggle')));
  await page.screenshot({path:dir+'/terminal-result.png'});await ui.getByRole('button',{name:'Cerrar resultado de terminal'}).click();
  await page.getByRole('button',{name:'Ajustes',exact:true}).click();const settings=page.frameLocator('#settings-frame');await settings.getByRole('heading',{name:'General',exact:true}).waitFor();
  await settings.getByRole('button',{name:'Melodi WorkSpace',exact:true}).click();await settings.locator('#settings-duck-enabled').waitFor();assert.equal(await settings.locator('#settings-duck-enabled').isChecked(),true);await settings.locator('#settings-duck-enabled').uncheck();assert.equal(await page.evaluate(()=>window.__ducking.enabled),false);await settings.locator('#settings-duck-enabled').check();await settings.getByRole('button',{name:'Añadir juego',exact:true}).click();await settings.getByText('synthetic-game.exe',{exact:true}).waitFor();await settings.getByRole('button',{name:'Quitar exclusión synthetic-game.exe',exact:true}).click();assert.equal(await settings.getByText('synthetic-game.exe',{exact:true}).count(),0);await settings.getByRole('button',{name:'General',exact:true}).click();
  await settings.locator('[data-pref=theme]').selectOption('dark');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');assert.equal(await frame.evaluate(()=>document.documentElement.dataset.theme),'dark');
  await settings.locator('[data-pref=theme]').selectOption('light');await settings.locator('[data-pref=chatSize]').selectOption('large');assert.equal(await frame.evaluate(()=>getComputedStyle(document.body).fontSize),'17px');await settings.locator('[data-pref=chatSize]').selectOption('normal');
  for(const [width,height] of [[1120,760],[390,568],[320,568]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.querySelector('#app-settings').getBoundingClientRect().right<=innerWidth+1));const sf=page.frames().find(item=>new URL(item.url()).pathname==='/settings');const metrics=await sf.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width}))}));if(metrics.scroll>metrics.width+1)await page.screenshot({path:dir+'/settings-overflow-'+width+'.png'});assert(metrics.scroll<=metrics.width+1,JSON.stringify(metrics));}
  await page.setViewportSize({width:1120,height:760});await settings.getByRole('button',{name:'Voz y conversación',exact:true}).click();await page.screenshot({path:dir+'/settings.png'});await page.getByRole('button',{name:'Cerrar ajustes'}).click();assert(await frame.evaluate(()=>window.__originalMic===document.querySelector('#mic-toggle')));
  // Real WebAudio silence, substituted Muse and output. No OS mic, WebSocket or TTS.
  await page.route('**/api/status',route=>route.fulfill({json:{provider:{configured:true},voice:{asr:{available:true,configured:true},tts:{configured:true},websocket_url:'ws://fixture.invalid/live'}}}));
  await frame.evaluate(()=>{
   window.__spoken=[];window.__mockAudio=new AudioContext();const destination=window.__mockAudio.createMediaStreamDestination();window.__originalGum=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>destination.stream;
   BrivanyLive.MuseCapture.prototype.start=async function(){window.__asr=this;return true;};BrivanyLive.PCMPlayer.prototype.prepare=async()=>{};
   BrivanyLive.MelodiOutput.prototype.speak=function(segments){this.onState(true);return (async()=>{try{for await(const part of segments)window.__spoken.push(part.text);}finally{this.onState(false);}})();};
  });
  await ui.getByRole('button',{name:'Iniciar voz live'}).click();await ui.locator('#mic-toggle[aria-pressed=true]').waitFor();
  await frame.evaluate(()=>window.__asr.onTranscript({id:'voice-fixture-1',text:'charla fixture de voz',final:true}));await frame.waitForFunction(()=>window.__spoken.some(text=>text.includes('Podemos seguir hablando')));
  await frame.evaluate(()=>{window.__asr.onTranscript({id:'voice-pause',text:'pensando',final:false});window.BrivanyLiveNotice.queue('Aviso sintético del agente.');});
  await page.waitForTimeout(2500);assert.equal(await frame.evaluate(()=>window.__spoken.filter(text=>text.includes('Aviso sintético')).length),0);
  await frame.evaluate(()=>window.__asr.onTranscript({id:'voice-pause',text:'',final:true}));await frame.waitForFunction(()=>window.__spoken.some(text=>text.includes('Aviso sintético')));await page.waitForTimeout(1000);assert.equal(await frame.evaluate(()=>window.__spoken.filter(text=>text.includes('Aviso sintético')).length),1);
  await page.route('**/api/computer/turn',async route=>{await route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'done',text:'',await_user:true})+'\n'});});
  await frame.evaluate(()=>window.__asr.onTranscript({id:'think-fixture',text:'Necesito un momento para pensar.',final:true}));await ui.locator('#chat-send').waitFor({state:'visible'});await frame.waitForFunction(()=>!document.querySelector('#chat-send').disabled);
  await frame.evaluate(()=>window.BrivanyLiveNotice.queue('Aviso retenido mientras piensas.'));await page.waitForTimeout(2800);assert.equal(await frame.evaluate(()=>window.__spoken.filter(text=>text.includes('Aviso retenido')).length),0);
  await page.unroute('**/api/computer/turn');await frame.evaluate(()=>window.__asr.onTranscript({id:'continue-fixture',text:'Continuemos con la conversación.',final:true}));await frame.waitForFunction(()=>window.__spoken.some(text=>text.includes('Aviso retenido')));
  await ui.getByRole('button',{name:'Terminar voz live'}).click();await frame.evaluate(async()=>{await window.__mockAudio.close();navigator.mediaDevices.getUserMedia=window.__originalGum;});
  await page.locator('#new-session').click();assert.equal(await ui.locator('.chat-message').count(),0);assert.equal(await page.evaluate(()=>window.BrivanyReferences.items.length),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={status:'passed',checks:['minimal chat opens directly without practice panels','typed conversation without desktop grant','PNG paste and actual bytes to substituted vision','image plan action authorizes once','plan preview and microphone within seven viewports','clear rejects late action','document agent announced and reviewed without replacing mic node','settings modal keeps chat node, applies theme and text size, fits 320x568','live transcript becomes chat and uses existing voice pipeline with substituted ASR and output','agent voice notice waits for unfinished user thought, once only','new conversation clears messages and references'],models_and_native:'substituted',compiler:'real local GLB',physical_audio_verified:false,os_clipboard_verified:false,external_calls:0,errors};
  fs.writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
