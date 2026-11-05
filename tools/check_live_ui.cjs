/* Browser integration using synthetic microphone audio and fake provider transports. */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const base=process.env.BRIVANY_TEST_URL||'http://127.0.0.1:8765';
(async()=>{
  const actual=await (await fetch(base+'/api/status')).json();
  const url=actual.voice.websocket_url;
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.addInitScript(()=>{
      window.__capture=0;window.__released=0;
      const interval=window.setInterval.bind(window);
      window.setInterval=(callback,ms,...args)=>interval(()=>{if(ms!==50||!window.__pauseLevels)callback(...args);},ms);
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        window.__capture++;
        const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),out=audio.createMediaStreamDestination();
        // Deliberately above the local RMS threshold: Muse finals must still
        // trigger replies with background sound instead of waiting forever.
        gain.gain.value=.08;osc.connect(gain);gain.connect(out);osc.start();
        window.__inputGain=gain;
        for(const t of out.stream.getTracks()){const stop=t.stop.bind(t);t.getSettings=()=>({echoCancellation:window.__echoCancellation===true});t.stop=()=>{window.__released++;stop();if(audio.state!=='closed')audio.close();};}
        return out.stream;
      }});
    });
    let asrAvailable=false,modelAvailable=false,ttsCalls=0,frames=0,zeroFrames=0,peer,starts=[],speechLanguages=[],turnLanguages=[],turnBodies=[],speechTexts=[];
    await context.route('**/api/status',route=>route.fulfill({json:{provider:{configured:modelAvailable},voice:{...actual.voice,asr:{configured:asrAvailable,available:asrAvailable},tts:{configured:true}}}}));
    await context.route('**/api/voice/turn',route=>{
      const body=route.request().postDataJSON();turnLanguages.push(body.language);turnBodies.push(body);
      const question=body.text==='Cuéntame un chiste.',guessed=body.text==='Zumba.',hold=body.text==='Déjame pensar.';
      const text=question?'¿Qué hace una abeja en un gimnasio?':guessed?'¡Eh, ya te lo sabías!':'Hello. I am Melodi.';
      const events=hold?[{type:'done',await_user:true}]:[{type:'delta',text},{type:'sentence',text,speech_text:guessed?'[laughter] '+text:text},{type:'done',await_user:question}];
      return route.fulfill({contentType:'application/x-ndjson',body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
    });
    const pcm=Buffer.alloc(24000*2*3);
    for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*.04)*1500),i*2);
    await context.route('**/api/voice/speech',route=>{
      assert.equal(route.request().postDataJSON().consent,true);assert.equal(route.request().postDataJSON().speed,1.05);ttsCalls++;speechLanguages.push(route.request().postDataJSON().language);
      speechTexts.push(route.request().postDataJSON().text);
      return route.fulfill({status:200,contentType:'audio/pcm; rate=24000; channels=1; format=s16le',body:pcm});
    });
    await context.routeWebSocket(url,socket=>{
      peer=socket;
      socket.onMessage(message=>{
        if(typeof message==='string'){
          const event=JSON.parse(message);
          if(event.type==='start'){starts.push(event);socket.send(JSON.stringify({type:'ready'}));}
          else if(event.type==='endStream'){
            if(starts.length===1){
              socket.send(JSON.stringify({type:'speech-start',id:'99'}));
              socket.send(JSON.stringify({type:'transcript',id:'99',text:'Último fragmento antes de terminar.',final:true,source:'muse_transcription'}));
            }
            socket.close();
          }
        }else{frames++;assert.equal(message.length,3840);if(message.every(x=>x===0))zeroFrames++;}
      });
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/app');
    await page.waitForFunction(()=>document.querySelector('#voice-select').value==='melodi-cartesia');
    assert.equal(await page.locator('#voice-rate').inputValue(),'1.05');
    assert.equal(await page.evaluate(()=>window.__capture),0);
    assert.equal(await page.locator('#cloud-voice-consent').count(),0);assert.equal(await page.locator('#transcribe-opt-in').count(),0);
    await page.locator('#mic-toggle').click();
    assert.equal(await page.locator('#settings-dialog').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.__capture),0);
    assert.match(await page.locator('#voice-notice').textContent(),/clave/);
    asrAvailable=true;await page.reload();
    await page.waitForFunction(()=>document.querySelector('#connection-label').textContent.includes('Muse + Melodi'));
    await page.locator('#mic-toggle').click();
    assert.equal(await page.locator('#settings-dialog').isVisible(),false);
    await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar');
    await page.waitForTimeout(220);assert.ok(frames>0);assert.equal(starts[0].mode,'practice');
    peer.send(JSON.stringify({type:'speech-start',id:'1'}));
    peer.send(JSON.stringify({type:'transcript',id:'1',text:'Una',final:false}));
    peer.send(JSON.stringify({type:'transcript',id:'1',text:'Una idea',final:false}));
    await page.waitForFunction(()=>document.querySelector('#interim').textContent==='Una idea');
    assert.equal(await page.locator('#live-text').inputValue(),'');
    // A finalized Muse turn must not depend on another meter interval firing.
    await page.evaluate(()=>{window.__pauseLevels=true;});
    peer.send(JSON.stringify({type:'transcript',id:'1',text:'Una idea con un ejemplo.',final:true,source:'muse_transcription'}));
    await page.waitForFunction(()=>document.querySelector('#voice-state').textContent==='HABLANDO',null,{timeout:3000});
    await page.evaluate(()=>{window.__pauseLevels=false;});
    await page.waitForTimeout(250);assert.ok(ttsCalls>0);assert.ok(zeroFrames>0);
    await page.locator('#interrupt').click();
    assert.equal(await page.locator('#interrupt').isDisabled(),true);
    assert.equal(await page.locator('#voice-state').textContent(),'ESCUCHANDO');
    await page.locator('#mic-toggle').click();
    await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Comenzar');
    assert.match(await page.locator('#live-text').inputValue(),/Último fragmento/);
    assert.ok(await page.evaluate(()=>window.__released>0));
    assert.ok(speechLanguages.includes('es'));
    await page.locator('button[data-mode="english"]').click();
    const previousEnglish=speechLanguages.filter(value=>value==='en').length;
    await page.locator('#voice-preview').click();
    await page.waitForFunction(()=>document.querySelector('#voice-state').textContent==='HABLANDO');
    await page.waitForTimeout(150);
    assert.ok(speechLanguages.filter(value=>value==='en').length>previousEnglish,'English preview must use Cartesia with language en');
    await page.locator('#interrupt').click();
    modelAvailable=true;await page.reload();
    await page.waitForFunction(()=>document.querySelector('#voice-select').value==='melodi-cartesia');
    await page.locator('button[data-mode="english"]').click();
    await page.evaluate(()=>{window.__echoCancellation=true;});
    await page.locator('#mic-toggle').click();
    assert.equal(await page.locator('#settings-dialog').isVisible(),false);
    await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar');
    await page.waitForTimeout(350);
    assert.equal(starts.at(-1).language,'en-US');
    peer.send(JSON.stringify({type:'speech-start',id:'english-live'}));
    peer.send(JSON.stringify({type:'transcript',id:'english-live',text:'Hello Melodi.',final:true,source:'muse_transcription'}));
    await page.waitForFunction(()=>document.querySelector('#voice-state').textContent==='HABLANDO');
    await page.waitForFunction(()=>document.querySelector('#coach-message').textContent.includes('Hello. I am Melodi.'));
    assert.equal(turnLanguages.at(-1),'en');assert.equal(speechLanguages.at(-1),'en');
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#voice-state').textContent(),'HABLANDO','steady background noise must not interrupt');
    await page.evaluate(()=>{window.__inputGain.gain.value=.5;});
    await page.waitForFunction(()=>document.querySelector('#voice-state').textContent==='ESCUCHANDO',null,{timeout:1500});
    assert.equal(await page.locator('#mic-label').textContent(),'Terminar');
    await page.evaluate(()=>{window.__inputGain.gain.value=.08;});
    const afterInterrupt=ttsCalls;
    const beforeEcho=turnBodies.length;
    peer.send(JSON.stringify({type:'speech-start',id:'playback-echo'}));
    peer.send(JSON.stringify({type:'transcript',id:'playback-echo',text:'Hello. I am Melodi.',final:true,source:'muse_transcription'}));
    await page.waitForTimeout(150);assert.equal(turnBodies.length,beforeEcho,'a probable playback echo must not trigger a model loop');
    peer.send(JSON.stringify({type:'speech-start',id:'after-barge'}));
    peer.send(JSON.stringify({type:'transcript',id:'after-barge',text:'My name is',final:false,source:'muse_transcription'}));
    await page.waitForTimeout(350);assert.equal(ttsCalls,afterInterrupt,'Melodi stays silent during user partials');
    peer.send(JSON.stringify({type:'transcript',id:'after-barge',text:'My name is Alex.',final:true,source:'muse_transcription'}));
    await page.waitForFunction(()=>document.querySelector('#voice-state').textContent==='HABLANDO');
    await page.waitForTimeout(120);
    assert.ok(turnBodies.at(-1).history.some(item=>item.role==='user'&&item.content==='Hello Melodi.'));
    assert.ok(turnBodies.at(-1).history.some(item=>item.role==='assistant'&&item.content.includes('I am Melodi')));
    await page.locator('#interrupt').click();await page.locator('#mic-toggle').click();
    await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Comenzar');
    await page.locator('button[data-mode="practice"]').click();await page.evaluate(()=>{window.__echoCancellation=false;});
    await page.locator('#mic-toggle').click();await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar');
    peer.send(JSON.stringify({type:'speech-start',id:'joke'}));
    peer.send(JSON.stringify({type:'transcript',id:'joke',text:'Cuéntame un chiste.',final:true,source:'muse_transcription'}));
    await page.waitForFunction(()=>document.querySelector('#coach-message').textContent.includes('abeja'));
    await page.waitForFunction(()=>document.querySelector('#voice-state').textContent==='ESCUCHANDO');
    assert.match(await page.locator('#voice-caption').textContent(),/Tu turno/);
    const waitingCalls=ttsCalls;await page.waitForTimeout(650);assert.equal(ttsCalls,waitingCalls,'silence never schedules a punchline');
    const beforeHold=turnBodies.length;
    peer.send(JSON.stringify({type:'speech-start',id:'thinking'}));
    peer.send(JSON.stringify({type:'transcript',id:'thinking',text:'Déjame pensar.',final:true,source:'muse_transcription'}));
    await page.waitForTimeout(250);assert.equal(turnBodies.length,beforeHold+1);assert.equal(ttsCalls,waitingCalls);
    assert.equal(await page.locator('#voice-state').textContent(),'ESCUCHANDO');
    assert.match(await page.locator('#coach-message').textContent(),/abeja/,'thinking time must retain the visible question');
    peer.send(JSON.stringify({type:'speech-start',id:'guess'}));
    peer.send(JSON.stringify({type:'transcript',id:'guess',text:'Zum',final:false,source:'muse_transcription'}));
    await page.waitForTimeout(350);assert.equal(ttsCalls,waitingCalls);
    peer.send(JSON.stringify({type:'transcript',id:'guess',text:'Zumba.',final:true,source:'muse_transcription'}));
    await page.waitForFunction(()=>document.querySelector('#coach-message').textContent.includes('ya te lo sabías'));
    await page.waitForTimeout(120);
    assert.ok(speechTexts.at(-1).includes('[laughter]'));assert.ok(!speechTexts.at(-1).includes('Zumba'));
    assert.ok(turnBodies.at(-1).history.some(item=>item.role==='assistant'&&item.content.includes('abeja')));
    assert.ok(!(await page.locator('#coach-message').textContent()).includes('[laughter]'));
    await page.locator('#interrupt').click();await page.locator('#mic-toggle').click();
    await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Comenzar');
    await page.locator('button[data-mode="meeting"]').click();await page.locator('#mic-toggle').click();
    assert.equal(await page.locator('#settings-dialog').isVisible(),true);
    await page.locator('#meeting-consent').check();await page.getByRole('button',{name:'Cerrar ajustes'}).click();
    const before=ttsCalls;await page.locator('#mic-toggle').click();
    await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar');
    assert.equal(starts.at(-1).mode,'meeting');assert.equal(starts.at(-1).meetingConsent,true);
    peer.send(JSON.stringify({type:'speech-start',id:'1'}));
    peer.send(JSON.stringify({type:'transcript',id:'1',text:'El presupuesto es de 500 euros.',final:true,source:'muse_transcription',speaker:'A'}));
    await page.waitForFunction(()=>document.querySelector('#prepared-items').textContent.includes('500 euros'));
    peer.send(JSON.stringify({type:'speech-start',id:'2'}));
    peer.send(JSON.stringify({type:'transcript',id:'2',text:'¿Cuál es el presupuesto',final:false,source:'muse_transcription',at:10}));
    await page.waitForSelector('#meeting-preview:not([hidden]) blockquote');
    assert.match(await page.locator('#meeting-preview').textContent(),/500 euros/);
    assert.equal(await page.locator('.help-card').count(),0);
    peer.send(JSON.stringify({type:'transcript',id:'2',text:'¿Cuándo es la entrega?',final:false,source:'muse_transcription',at:10}));
    await page.waitForFunction(()=>document.querySelector('#meeting-preview').textContent.includes('Déjame comprobarlo'));
    assert.equal(await page.locator('#meeting-preview blockquote').count(),0);
    peer.send(JSON.stringify({type:'transcript',id:'2',text:'El presupuesto no es una pregunta.',final:false,source:'muse_transcription',at:10}));
    await page.waitForFunction(()=>document.querySelector('#meeting-preview').hidden);
    peer.send(JSON.stringify({type:'transcript',id:'2',text:'¿Cuál es el presupuesto?',final:false,source:'muse_transcription',at:10}));
    await page.waitForSelector('#meeting-preview:not([hidden]) blockquote');
    peer.send(JSON.stringify({type:'transcript',id:'2',text:'¿Cuál es el presupuesto?',final:true,source:'muse_transcription',speaker:'B'}));
    await page.waitForSelector('.help-card');assert.match(await page.locator('#meeting-digest').textContent(),/Hablante A/);
    assert.equal(ttsCalls,before);assert.equal(await page.locator('#meeting-preview').isVisible(),false);
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Meeting overflows at ${width}`);
    }
    await page.setViewportSize({width:390,height:844});
    const quote=await page.locator('.help-card blockquote').first().boundingBox();assert.ok(quote.y<844);
    await page.locator('#clear-session').click();assert.equal(await page.locator('.help-card').count(),0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:['missing key blocks capture','single Comenzar click starts transcription and voice without settings or activation checkboxes; page load never captures','real AudioWorklet PCM at 80 ms','cumulative partial replacement','Muse final to Melodi audio without waiting for level tick','Spanish and English Cartesia selection at speed 1.05','English live final triggers English model request and English speech','echo muted as silence','sustained synthetic input interrupts speech with confirmed AEC; background sound does not','user partials stay silent; next final preserves prior user and assistant context','joke question waits in silence without automatic punchline; guessed answer laughs without revealing again','interruption','endStream flush','speaker labels and silent meeting','prepared context before questions','provisional support before final','corrected question retracts support','final promotes provisional support','meeting mobile support above fold','cleanup'],microphone:'synthetic',providers:'mocked',frames,zeroFrames,speechLanguages,turnLanguages},null,2));
    await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
