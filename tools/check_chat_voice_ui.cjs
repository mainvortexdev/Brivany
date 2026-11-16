'use strict';
// Owned Edge, synthetic microphone PCM and intercepted ASR/model/TTS. No accounts.
const {chromium}=require('../motion-studio/node_modules/playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let base;
const out=path.join(root,'tmp/chat-voice-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 // Chromium's AudioWorklet loader bypasses Playwright routing. Serve this
 // production module over actual loopback instead of substituting the worklet.
 const server=require('node:http').createServer((request,response)=>{
  if(request.url!=='/pcm-capture.js'){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':'text/javascript'});response.end(fs.readFileSync(path.join(root,'web/pcm-capture.js')));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 const checks=[],errors=[],external=[];let available=false,statusCalls=0,peer,readyDelay=0,releaseSpeech,releaseStatus,holdStatus=false,turnRequests=0;
 try{
  const context=await browser.newContext({viewport:{width:1120,height:760},serviceWorkers:'block'});
  await context.addInitScript(()=>{
   window.pywebview={api:{workspace_chat_publish:async value=>{window.__published={pending:!!value.pending,speaking:!!value.speaking,listening:!!value.listening};return {ok:true};},workspace_live_signal:async()=>({ok:true}),music_voice_active:async()=>({ok:true}),account_status:async()=>({signed_in:false})}};
   window.__captures=0;window.__released=0;
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
    window.__captures++;
    if(window.__micError)throw new DOMException('synthetic device failure',window.__micError);
    const audio=new AudioContext(),source=audio.createOscillator(),gain=audio.createGain(),target=audio.createMediaStreamDestination();
    gain.gain.value=.03;source.connect(gain);gain.connect(target);source.start();
    for(const track of target.stream.getTracks()){
     const stop=track.stop.bind(track);track.getSettings=()=>({echoCancellation:true});
     track.stop=()=>{window.__released++;stop();if(audio.state!=='closed')audio.close();};
    }
    return target.stream;
   }});
  });
  await context.routeWebSocket('ws://127.0.0.1:8878/live',socket=>{
   peer=socket;
   socket.onMessage(message=>{
    if(typeof message==='string'&&JSON.parse(message).type==='start')setTimeout(()=>{try{socket.send(JSON.stringify({type:'ready'}));}catch{}},readyDelay);
   });
  });
  const id='00000000-0000-4000-8000-000000000112';
  const session={id,messages:[{id:'voice-fixture',role:'user',text:'Conversación sintética conservada'}],history:[],tasks:[],draft:'Borrador conservado'};
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base){external.push(url.origin);return route.abort();}
   if(url.pathname==='/api/status'){
    statusCalls++;if(holdStatus)await new Promise(resolve=>releaseStatus=resolve);
    return route.fulfill({json:{voice:{asr:{configured:available,available},tts:{configured:true},websocket_url:'ws://127.0.0.1:8878/live'}}}).catch(()=>{});
   }
   if(url.pathname==='/api/desktop/chats')return route.fulfill({json:route.request().method()==='POST'?{ok:true}:{active:id,conversations:[{id,title:'Prueba local',updated:1}]}});
   if(url.pathname==='/api/desktop/chats/'+id)return route.fulfill({json:session});
   if(url.pathname==='/api/voice/turn'){turnRequests++;return route.fulfill({contentType:'application/x-ndjson',body:[{type:'delta',text:'Hola, estoy aquí.'},{type:'sentence',text:'Hola, estoy aquí.'},{type:'done'}].map(event=>JSON.stringify(event)).join('\n')+'\n'});}
   if(url.pathname.startsWith('/api/voice/cue/')){const pcm=Buffer.alloc(24000);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(Math.sin(i*.07)*2000),i);return route.fulfill({contentType:'audio/pcm',body:pcm});}
   if(url.pathname==='/api/voice/speech'){
    await new Promise(resolve=>releaseSpeech=resolve);
    const pcm=Buffer.alloc(48000*6);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(Math.sin(i*.07)*2000),i);
    return route.fulfill({contentType:'audio/pcm; rate=24000; channels=1; format=s16le',body:pcm}).catch(()=>{});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{ok:true,enabled:false,jobs:[],authorized:false,services:[]}});
   const relative=url.pathname==='/brivany-shell'?'desktop/experience/index.html':url.pathname==='/app'?'desktop/experience/chat.html':url.pathname.startsWith('/desktop-shell/')?'desktop/experience/'+url.pathname.slice(15):'web'+url.pathname;
   const file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);if(url.pathname==='/app')body=body.toString().replace('</head>','<script src="/desktop-shell/icons.js"></script></head>');
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream',
    headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws://127.0.0.1:8878; img-src 'self' data:; media-src 'self' blob:; frame-src 'self'"},body});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/brivany-shell');
  const ui=page.frameLocator('#module-frame');await page.waitForFunction(()=>!!document.querySelector('#module-frame').contentWindow?.BrivanyChat);
  const frame=page.frames().find(item=>new URL(item.url()).pathname==='/app');
  await frame.evaluate(()=>{const start=BrivanyVoice.Microphone.prototype.start;BrivanyVoice.Microphone.prototype.start=function(...args){window.__testMic=this;return start.apply(this,args);};});
  const phase=async value=>{try{await ui.locator('#chat-voice-stage[data-phase='+value+']').waitFor({timeout:20000});}catch(error){console.error('Voice diagnostic',await frame.evaluate(()=>({phase:document.querySelector('#chat-voice-stage').dataset.phase,hint:document.querySelector('#chat-voice-hint').textContent,status:document.querySelector('#chat-state').textContent})),errors);await page.screenshot({path:path.join(out,'failure.png')});throw error;}};
  const rings=()=>ui.locator('.chat-voice-rings i').first();
  await ui.locator('#chat-message').fill('');assert.equal(await frame.evaluate(()=>window.__captures),0);assert.equal(await ui.locator('#chat-voice-stage').isVisible(),false);
  // Config became available after initial chat load: every click must refresh it.
  available=true;await frame.evaluate(()=>window.__micError='NotReadableError');
  await ui.locator('#mic-toggle').click();await phase('error');assert.match(await ui.locator('#chat-voice-hint').textContent(),/otra aplicación/);assert.ok(statusCalls>=2);
  assert.equal(await ui.locator('#mic-toggle').getAttribute('aria-pressed'),'false');checks.push('fresh readiness and visible device failure, with retry');
  await page.screenshot({path:path.join(out,'error-recuperable.png')});
  await frame.evaluate(()=>window.__micError=null);await ui.locator('#chat-voice-retry').click();await phase('listening');
  assert.equal(await ui.locator('#mic-toggle').getAttribute('aria-pressed'),'true');assert.equal(await rings().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.screenshot({path:path.join(out,'melodi-escuchando.png')});
  peer.send(JSON.stringify({type:'transcript',id:'fixture-turn',text:'Hola Melodi.',final:false}));
  await phase('thinking');assert.equal(await rings().evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await frame.evaluate(()=>window.__testMic.suspended),false);checks.push('Muse partial closes locally without waiting for provider final; capture stays active while thinking');
  await page.waitForFunction(()=>window.__published?.pending===true&&window.__published?.speaking===false);
  await page.waitForFunction(()=>document.querySelector('#module-frame').contentDocument.querySelector('#chat-voice-label').textContent==='Estoy pensando…');
  while(!releaseSpeech)await new Promise(resolve=>setTimeout(resolve,20));releaseSpeech();await phase('speaking');
  assert.equal(await rings().evaluate(el=>getComputedStyle(el).animationName),'chat-voice-heartbeat');checks.push('no pulse during ASR/model/TTS wait; rings start on PCM scheduling');
  const portrait=await ui.locator('.chat-voice-portrait').boundingBox(),stage=await ui.locator('#chat-voice-stage').boundingBox();
  assert.ok(Math.abs(portrait.x+portrait.width/2-stage.x-stage.width/2)<2);await page.waitForTimeout(700);await page.screenshot({path:path.join(out,'melodi-hablando.png')});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await rings().evaluate(el=>getComputedStyle(el).animationName),'none');assert.ok(Number(await rings().evaluate(el=>getComputedStyle(el).opacity))>0);
  await page.screenshot({path:path.join(out,'movimiento-reducido.png')});await page.emulateMedia({reducedMotion:'no-preference'});
  await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await rings().evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
  await frame.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});checks.push('reduced motion is static, and hidden views pause animation');
  await ui.locator('#interrupt').click();await phase('listening');assert.equal(await rings().evaluate(el=>getComputedStyle(el).animationName),'none');
  peer.send(JSON.stringify({type:'transcript',id:'fixture-turn',text:'Hola Melodi.',final:true}));await page.waitForTimeout(100);assert.equal(turnRequests,1);
  for(const [width,height] of [[390,568],[320,568],[1120,500],[1120,760]]){
   await page.setViewportSize({width,height});
   const metrics=await frame.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,stage:document.querySelector('#chat-voice-stage').getBoundingClientRect().toJSON(),close:document.querySelector('#chat-voice-close').getBoundingClientRect().toJSON()}));
   assert.ok(metrics.scroll<=metrics.width+1,JSON.stringify(metrics));assert.ok(metrics.close.top>=metrics.stage.top&&metrics.close.bottom<=metrics.stage.bottom+1,JSON.stringify(metrics));
   if(width===320)await page.screenshot({path:path.join(out,'melodi-320.png')});
  }
  checks.push('centered portrait and usable controls at 320, 390 and desktop widths');
  await ui.locator('#chat-message').fill('Borrador conservado');await ui.locator('#chat-voice-close').click();
  assert.equal(await ui.locator('#chat-voice-stage').isVisible(),false);assert.equal(await ui.locator('#chat-message').inputValue(),'Borrador conservado');
  assert.equal(await ui.getByText('Conversación sintética conservada',{exact:true}).isVisible(),true);assert.ok(await frame.evaluate(()=>window.__released>0));checks.push('stop releases capture and preserves conversation and draft');
  assert.equal(await ui.getByText('Hola, estoy aquí.',{exact:true}).isVisible(),true);checks.push('generated assistant text remains in chat after playback and interruption');
  // Reproduce the old 12 s deadline against a valid but slow relay handshake.
  await ui.locator('#chat-message').fill('');readyDelay=12550;await ui.locator('#mic-toggle').click();await phase('connecting');
  await ui.locator('#mic-toggle[aria-pressed=true]').waitFor({timeout:18000});await phase('listening');await ui.locator('#chat-voice-close').click();readyDelay=0;
  checks.push('valid ASR ACK after 12.55 s activates instead of the former 12 s cancellation');
  // A silent false return is an error, never a successful-looking idle button.
  await frame.evaluate(()=>{window.__start=BrivanyVoice.Microphone.prototype.start;BrivanyVoice.Microphone.prototype.start=async()=>false;});
  await ui.locator('#mic-toggle').click();await phase('error');assert.match(await ui.locator('#chat-voice-hint').textContent(),/No se pudo iniciar/);
  await ui.locator('#chat-voice-close').click();await frame.evaluate(()=>BrivanyVoice.Microphone.prototype.start=window.__start);
  const captures=await frame.evaluate(()=>window.__captures);holdStatus=true;await ui.locator('#mic-toggle').click();await phase('connecting');
  await ui.locator('#chat-voice-close').click();while(!releaseStatus)await new Promise(resolve=>setTimeout(resolve,20));holdStatus=false;releaseStatus();
  await page.waitForTimeout(100);assert.equal(await frame.evaluate(()=>window.__captures),captures);assert.equal(await ui.locator('#chat-voice-stage').isVisible(),false);
  checks.push('false start is recoverable; cancel during readiness cannot start a late microphone');
  // Accelerate only the page clock: the PCM still uses real WebAudio. Keep an
  // incomplete long utterance so no model turn is invented by the 8 s cue.
  await page.clock.install();await ui.locator('#mic-toggle').click();await phase('listening');
  const beforeCues=turnRequests,messages=await frame.evaluate(()=>parent.BrivanyChatSession.messages.length);
  peer.send(JSON.stringify({type:'transcript',id:'long-fixture',text:'Quiero explicar una idea con varios detalles durante',final:false}));
  await ui.locator('#interim').filter({hasText:'varios detalles durante'}).waitFor();await page.clock.fastForward(7000);
  peer.send(JSON.stringify({type:'transcript',id:'long-fixture',text:'Quiero explicar una idea con varios detalles durante la mañana y',final:false}));
  await ui.locator('#interim').filter({hasText:'la mañana y'}).waitFor();await page.clock.fastForward(1000);await phase('speaking');
  assert.equal(await frame.evaluate(()=>window.__testMic.suspended),false);assert.equal(turnRequests,beforeCues);assert.equal(await frame.evaluate(()=>parent.BrivanyChatSession.messages.length),messages);
  await ui.locator('#chat-voice-close').click();assert.equal(await ui.locator('#chat-voice-stage').isVisible(),false);
  checks.push('cached listening cue plays at 8 s without muting user capture, creating model turns, or adding chat messages; stop cancels it');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={passed:true,mode:'owned_Edge_real_WebAudio_synthetic_microphone_and_providers',checks,external_calls:0,physical_microphone:false,physical_speaker:false,gpu_seconds:null,errors};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{releaseStatus?.();releaseSpeech?.();await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
