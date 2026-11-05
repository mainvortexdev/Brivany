'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,artifacts=path.resolve(__dirname,'../tmp/sous-voice');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--autoplay-policy=no-user-gesture-required']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[],external=[],requests=[],checks=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')requests.push(new URL(request.url()).pathname);});
    await page.addInitScript(()=>{
      window.__micCalls=0;window.__tracks=[];window.__captureContexts=[];
      window.__fakeMic=()=>{const context=new AudioContext(),destination=context.createMediaStreamDestination();window.__captureContexts.push(context);window.__tracks.push(...destination.stream.getTracks());return destination.stream;};
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async options=>{if(options.video!==false || !options.audio)throw Error('Expected audio only');window.__micCalls++;return window.__fakeMic();}});
      window.WebSocket=class{
        static OPEN=1;constructor(url){this.url=url;this.readyState=0;this.bufferedAmount=0;window.__asr=this;queueMicrotask(()=>{this.readyState=1;this.onopen?.({});});}
        send(value){if(typeof value==='string' && JSON.parse(value).type==='start')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'ready'})}));}
        close(){this.readyState=3;this.onclose?.({});}
      };
    });
    await page.goto(base+'/sous');await page.waitForFunction(()=>document.querySelector('#sous-voice-origin').textContent.includes('simulado'));
    assert.deepEqual(requests,[]);assert.equal(await page.evaluate(()=>window.__micCalls),0);checks.push('opening Sous performs no provider request and never activates microphone');
    await page.locator('#sous-mic-toggle').click();assert.match(await page.locator('#sous-voice-error').textContent(),/Autoriza/);assert.equal(await page.evaluate(()=>window.__micCalls),0);
    await page.locator('.conversation-options').evaluate(node=>node.open=true);await page.locator('#sous-message').fill('Qué ingredientes tengo');await page.locator('#sous-send-message').click();assert.match(await page.locator('#sous-voice-error').textContent(),/Autoriza/);assert.deepEqual(requests,[]);
    await page.locator('#sous-text-consent').check();await page.locator('#sous-send-message').click();await page.waitForFunction(()=>/4(?:\.0)? unidades de Huevos/.test(document.querySelector('#sous-reply').textContent));
    await page.waitForFunction(()=>document.querySelector('#sous-interrupt').disabled);checks.push('text requires consent and streamed reply receives the actual persistent inventory');
    await page.locator('#plan-meal').click();await page.waitForFunction(()=>!document.querySelector('#start-session').hidden);await page.locator('#start-session').click();await page.waitForFunction(()=>!document.querySelector('#cooking-view').hidden);
    const before=(await (await page.request.get(base+'/api/sous/inventory')).json());
    await page.locator('#sous-message').fill('Explícame el paso y avanza');await page.locator('#sous-send-message').click();await page.waitForFunction(()=>document.querySelector('#sous-reply').textContent.includes('Lava y corta las verduras'));
    await page.waitForFunction(()=>document.querySelector('#sous-interrupt').disabled);assert.equal(await page.locator('#step-title').textContent(),'Preparar');assert.deepEqual(await (await page.request.get(base+'/api/sous/inventory')).json(),before);
    checks.push('cooking session identity resolves the actual step on the server and conversation cannot mutate inventory or advance steps');
    await page.locator('#sous-voice-consent').check();await page.locator('#sous-mic-toggle').click();await page.waitForFunction(()=>document.querySelector('#sous-voice-status').textContent.includes('Te escucho'));
    assert.equal(await page.evaluate(()=>window.__micCalls),1);
    await page.evaluate(()=>{window.__asr.onmessage({data:JSON.stringify({type:'speech-start',id:1})});window.__asr.onmessage({data:JSON.stringify({type:'transcript',id:1,text:'Repite el paso actual',final:true})});});
    await page.waitForFunction(()=>document.querySelector('#sous-conversation').dataset.state==='speaking' && document.querySelector('#sous-reply').textContent.includes('Lava y corta'));assert.match(await page.locator('#sous-reply').textContent(),/Lava y corta/);
    await page.locator('#sous-interrupt').click();await page.locator('#sous-mic-toggle').click();await page.waitForFunction(()=>document.querySelector('#sous-mic-toggle').getAttribute('aria-pressed')==='false');
    assert.equal(await page.evaluate(()=>window.__tracks.every(track=>track.readyState==='ended')),true);checks.push('substituted ASR uses the real conversation relay and PCM player; interruption cancels output and stop releases microphone tracks');
    await page.evaluate(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>new Promise(resolve=>window.__resolveMic=resolve)});});
    await page.locator('#sous-mic-toggle').click();await page.waitForFunction(()=>typeof window.__resolveMic==='function');await page.locator('#sous-mic-toggle').click();
    await page.evaluate(()=>window.__resolveMic(window.__fakeMic()));await page.waitForFunction(()=>window.__tracks.every(track=>track.readyState==='ended'));
    checks.push('permission arriving after cancellation releases the late stream without opening a conversation');
    fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'sous-voice-1440.png'),fullPage:true});
    for(const width of [320,390,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
    await page.screenshot({path:path.join(artifacts,'sous-voice-390.png'),fullPage:true});checks.push('contextual conversation fits small and desktop viewports');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(requests.filter(url=>url==='/api/sous/voice/turn').length,3);assert.equal(requests.filter(url=>url==='/api/voice/speech').length,1);
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:'passed',scope:'Actual local HTTP/Sous/context/browser audio plumbing with simulated providers and mic/ASR events.',checks,screenshots:['tmp/sous-voice/sous-voice-1440.png','tmp/sous-voice/sous-voice-390.png']},null,2));
    await page.evaluate(()=>{for(const audio of window.__captureContexts)audio.close();});await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
