'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'..'),base=process.env.BRIVANY_TEST_URL;
const provider=process.env.BRIVANY_TEST_PROVIDER || 'meta', stem=provider==='gemini'?'gemini-pipeline':'modular-pipeline';
if(!['meta','gemini'].includes(provider)) throw Error('Unknown pipeline.');
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base || '')) throw Error('Run check_modular_pipeline.py.');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  try {
    const context=await browser.newContext({serviceWorkers:'block'}), page=await context.newPage();
    const errors=[], blocked=[], sockets=[];let closure=null;
    await context.addInitScript(()=>{
      window.__microphoneRequests=0;
      if(navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        window.__microphoneRequests++;throw Error('No microphone in this test.');
      }});
    });
    await context.route('**/*', route=>{
      const request=route.request();
      if(new URL(request.url()).origin!==base || request.method()!=='GET') {blocked.push(request.url());return route.abort();}
      return route.continue();
    });
    page.on('pageerror',error=>errors.push(error.message));
    page.on('websocket',socket=>{
      sockets.push(socket.url());
      socket.on('framereceived',frame=>{
        try {
          const event=JSON.parse(frame.payload);
          if(event.type==='done') closure={session_closed_locally:event.session_closed_locally===true,
            finalization_verified:event.finalization_verified===false?false:null,
            completion_method:event.completion_method==='bounded_post_input_drain'?event.completion_method:null,
            completion_reason:['quiet_window','drain_budget'].includes(event.completion_reason)?event.completion_reason:null};
        } catch {}
      });
    });
    const response=await page.goto(base+'/dubbing');
    assert.equal(response.status(),200);
    assert.match(response.headers()['content-security-policy'],/ws:\/\/127\.0\.0\.1:/);
    await page.locator('#dubbing-provider').selectOption(provider);
    await page.waitForFunction(label=>document.querySelector('#provider-state').textContent.includes(label),provider==='meta'?'conexiones preparadas':'clave guardada');
    assert.equal(await page.locator('#configure-dubbing').isVisible(),provider!=='meta');
    assert.equal(await page.locator('#source-language').inputValue(),'en');
    assert.equal(await page.locator('#target-language').inputValue(),'es');
    await page.locator('#video-file').setInputFiles(path.join(root,'tmp/dubbing-test/synthetic-video.mp4'));
    await page.waitForFunction(()=>document.querySelector('#dub-video').readyState>=1);
    await page.locator('#dub-consent').check(); await page.locator('#start-dubbing').click();
    await page.waitForFunction(()=>document.querySelector('#translation-caption').textContent.includes('La habitación'),{},{timeout:8000});
    await page.waitForFunction(()=>document.querySelector('#session-state').textContent==='En espera',{},{timeout:provider==='gemini'?16000:8000});
    assert.match(await page.locator('#dub-notice').textContent(),provider==='gemini'?/Sesión cerrada.*Revisa el final/:/terminada/);
    if(provider==='gemini') assert.deepEqual(closure,{session_closed_locally:true,finalization_verified:false,
      completion_method:'bounded_post_input_drain',completion_reason:'quiet_window'});
    const caption=await page.locator('#translation-caption').textContent();
    assert.match(caption,/La habitación está lista/);assert.match(caption,/Trae las medidas/);
    assert.equal(caption.split('La habitación').length-1,1);
    assert.equal(await page.locator('#session-state').textContent(),'En espera');
    assert.equal(await page.locator('#inference-ms').textContent(),'Sin dato del proveedor');
    assert.match(await page.locator('#first-audio-ms').textContent(),/ms.*red y contexto/);
    assert.equal(await page.evaluate(()=>window.__microphoneRequests),0);
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.equal(sockets.length,1);
    const directory=path.join(root,'tmp/ui');fs.mkdirSync(directory,{recursive:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(directory,stem+'-1440.png'),fullPage:true});
    const report={status:'passed',provider,api:'real_local',asr:'simulated',translation:'simulated',tts:'simulated',
      audio_worklet:'real',external_calls:0,gpu_seconds:0,microphone_requests:0,websocket_connections:sockets.length,
      captions_deduplicated:true,finished_idle:true,inference_ms:null,inference_500ms_verified:false,
      closure,
      javascript_errors:errors,screenshots:['tmp/ui/'+stem+'-1440.png']};
    fs.writeFileSync(path.join(directory,stem+'.json'),JSON.stringify(report,null,2));
    await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
