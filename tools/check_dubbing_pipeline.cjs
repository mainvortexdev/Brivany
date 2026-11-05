/* Real UI/HTTP/WebSocket/AudioWorklet against a loopback-only provider simulation. */
'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,root=path.resolve(__dirname,'..');
if(!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('Run this check through check_dubbing_pipeline.py.');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  try {
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
    const errors=[],blocked=[],requests=[],sockets=[];
    await context.addInitScript(()=>{
      window.__microphoneRequests=0;
      if(navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        window.__microphoneRequests++;throw Error('Microphone use is forbidden in this check.');
      }});
    });
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      requests.push({method:request.method(),path:url.pathname});
      if(url.origin!==base || request.method()!=='GET') { blocked.push(request.url());return route.abort('blockedbyclient'); }
      return route.continue();
    });
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    page.on('websocket',socket=>sockets.push(socket.url()));
    const response=await page.goto(base+'/dubbing');assert.equal(response.status(),200);
    const csp=response.headers()['content-security-policy'];assert.ok(csp && csp.includes('ws://127.0.0.1:'));
    await page.waitForFunction(()=>document.querySelector('#provider-state').textContent.includes('guardada'));
    assert.match(await page.locator('#provider-state').textContent(),/Palabra/);
    await page.locator('#source-language').selectOption('en');
    await page.locator('#target-language').selectOption('es');
    await page.locator('#video-file').setInputFiles(path.join(root,'tmp/dubbing-test/synthetic-video.mp4'));
    await page.waitForFunction(()=>document.querySelector('#dub-video').readyState>=1);
    assert.equal(await page.locator('#start-dubbing').isDisabled(),true);
    await page.locator('#dub-consent').check();await page.locator('#start-dubbing').click();
    await page.waitForFunction(()=>document.querySelector('#translation-caption').textContent.includes('Prueba simulada'),{},{timeout:8000});
    await page.waitForFunction(()=>document.querySelector('#first-audio-ms').textContent.includes('ms'),{},{timeout:3000});
    assert.match(await page.locator('#first-audio-ms').textContent(),/red y contexto/);
    assert.match(await page.locator('#first-playback-ms').textContent(),/ms.*red y contexto/);
    await page.waitForFunction(()=>document.querySelector('#dub-notice').textContent.includes('terminada'),{},{timeout:8000});
    assert.match(await page.locator('#translation-caption').textContent(),/Prueba simulada cierre/);
    assert.equal(await page.locator('#session-state').textContent(),'En espera');
    assert.equal(await page.locator('#stop-dubbing').isDisabled(),true);
    assert.equal(await page.locator('#start-dubbing').isDisabled(),false);
    assert.equal(await page.locator('#inference-ms').textContent(),'Sin dato del proveedor');
    assert.match(await page.locator('.measurement-details').textContent(),/por verificar/);
    assert.equal(await page.evaluate(()=>window.__microphoneRequests),0);
    assert.equal(sockets.length,1);assert.match(sockets[0],/^ws:\/\/127\.0\.0\.1:\d+\/dub$/);
    assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
    assert.ok(requests.some(request=>request.path==='/api/dubbing/status'));
    const directory=path.join(root,'tmp/ui');fs.mkdirSync(directory,{recursive:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(directory,'dubbing-pipeline-1440.png'),fullPage:true});
    const report={status:'passed',api:'real_local',upstream:'simulated',http_requests:requests.length,
      websocket_connections:sockets.length,microphone_requests:0,external_calls:0,gpu_seconds:0,
      final_caption_received:true,finished_idle:true,inference_ms:null,inference_500ms_verified:false,
      first_audio_label:await page.locator('#first-audio-ms').textContent(),
      first_playback_label:await page.locator('#first-playback-ms').textContent(),
      content_security_policy_checked:true,javascript_errors:[],screenshots:['tmp/ui/dubbing-pipeline-1440.png']};
    fs.writeFileSync(path.join(directory,'dubbing-pipeline-browser.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));await context.close();
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
