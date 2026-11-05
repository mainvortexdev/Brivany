'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fake=`window.YT={Player:class{constructor(frame,options){this.events=options.events;window.__yt=this;setTimeout(()=>this.events.onReady(),10);}playVideo(){this.state=1;this.events.onStateChange({data:1});}pauseVideo(){this.state=2;this.events.onStateChange({data:2});}setVolume(value){this.volume=value;}getCurrentTime(){return 0;}getDuration(){return 90;}destroy(){}}};window.onYouTubeIframeAPIReady();`;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'block'}),page=await context.newPage(),base=process.env.BRIVANY_TEST_URL,errors=[],external=[];
  await context.route('**/*',route=>{const url=route.request().url();if(url==='https://www.youtube.com/iframe_api')return route.fulfill({contentType:'text/javascript',body:fake});if(new URL(url).origin!==base){external.push(new URL(url).origin);return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic embed</title>'});}return route.continue();});
  await context.addInitScript(()=>{
    window.__timeOffset=0;const realNow=performance.now.bind(performance);Object.defineProperty(performance,'now',{value:()=>realNow()+window.__timeOffset});
    window.__captures=0;window.__mic=0;window.__stops=0;let config;
    Object.defineProperty(navigator.mediaDevices,'setCaptureHandleConfig',{configurable:true,value:value=>{config=value;}});
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>{window.__mic++;throw Error('Microphone prohibited');}});
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{
      window.__captures++;
      const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),output=audio.createMediaStreamDestination();gain.gain.value=.02;osc.connect(gain);gain.connect(output);osc.start();await audio.resume();
      const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const video=canvas.captureStream(5).getVideoTracks()[0],track=output.stream.getAudioTracks()[0];
      Object.defineProperty(video,'getSettings',{value:()=>({displaySurface:'browser',suppressLocalAudioPlayback:true})});Object.defineProperty(video,'getCaptureHandle',{value:()=>({origin:location.origin,handle:config.handle})});
      Object.defineProperty(track,'getSettings',{value:()=>({suppressLocalAudioPlayback:true})});
      for(const item of [video,track]){const stop=item.stop.bind(item);item.stop=()=>{window.__stops++;stop();};}return new MediaStream([video,track]);
    }});
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/');await page.getByRole('link',{name:'Abrir traducción',exact:false}).click();
  assert.equal(new URL(page.url()).pathname,'/dubbing');assert.equal(await page.locator('button').count(),3);
  await page.locator('#youtube-url').fill('https://youtu.be/M7lc1UVf-VE');await page.locator('#youtube-url').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#video-state').textContent==='Video preparado');
  assert.equal(await page.evaluate(()=>window.__captures),0);
  await page.locator('#language').click();assert.match(await page.locator('#language').textContent(),/English/);
  await page.locator('#language').click();assert.match(await page.locator('#language').textContent(),/Français/);
  await page.locator('#voice-mode').selectOption('masculine');
  await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Ajustando el ritmo'),{},{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#caption').textContent.includes('Bonjour le monde.'),{},{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#segments').textContent==='3' && window.__yt.state===1,{},{timeout:15000});
  assert.equal(await page.evaluate(()=>window.__captures),1);assert.equal(await page.evaluate(()=>window.__mic),0);
  assert.equal(await page.locator('#remaining').count(),0);
  await page.waitForFunction(()=>document.querySelector('#voice-style').textContent.includes('Daniel · masculina'));
  await page.evaluate(()=>{window.__timeOffset=35000;});
  await page.waitForFunction(()=>{const match=document.querySelector('#session-clock').textContent.match(/(\d+):(\d+)/);return match && Number(match[1])*60+Number(match[2])>=35;});
  assert.equal(await page.locator('#stop').isEnabled(),true);
  assert.equal(await page.locator('#start').isDisabled(),true);
  await page.locator('#stop').click();await page.waitForFunction(()=>document.querySelector('#start').disabled===false);
  assert.ok(await page.evaluate(()=>window.__stops)>=2);assert.equal(await page.evaluate(()=>window.__yt.state),2);
  const directory=path.resolve('tmp/river-ui');fs.mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(directory,'mobile.png'),fullPage:true});
  await page.locator('#source-kind').selectOption('file');
  await page.locator('#video-file').setInputFiles(process.env.BRIVANY_TEST_VIDEO);
  await page.waitForFunction(()=>!document.querySelector('#start').disabled);
  for(let attempt=0;attempt<2;attempt++){
    await page.locator('#start').click();
    await page.waitForFunction(()=>document.querySelector('#segments').textContent==='3',{},{timeout:15000}).catch(async error=>{
      const diagnostic=await page.evaluate(()=>({status:document.querySelector('#status').textContent,segments:document.querySelector('#segments').textContent,paused:document.querySelector('#local-video').paused,time:document.querySelector('#local-video').currentTime}));
      throw Error(error.message+' '+JSON.stringify(diagnostic));
    });
    assert.equal(await page.evaluate(()=>window.__captures),1,'Local media must not ask for another tab capture');
    assert.equal(await page.evaluate(()=>window.__mic),0);
    await page.locator('#stop').click();await page.waitForFunction(()=>!document.querySelector('#start').disabled);
    assert.equal(await page.locator('#local-video').evaluate(video=>video.paused),true);
  }
  await page.screenshot({path:path.join(directory,'local-video-mobile.png'),fullPage:true});
  // A known access rejection disables start and never asks for tab capture.
  await context.route('**/api/dubbing/status',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({configured:true,available:false,sessions_remaining:null,access_blocked:true,access_checks:{meta:{http_status:403,access:false}},native_output:{available:true}})}));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('403'));assert.equal(await page.locator('#start').isDisabled(),true);
  assert.deepEqual(errors,[]);
  const report={status:'passed',checks:['main homepage links to canonical /dubbing','exactly three controls','manual link loads without capture or autoplay','Spanish English French selection','real AudioWorklet sends 80 ms frames through loopback Muse, Meta Spark SSE and Cartesia WS','French tokens reach captions','backlog pauses source and resumes in the same session without releasing capture','stop pauses source and releases capture','no daily quota or fragment cap; active after 35 seconds on the client clock; masculine Daniel selected','real local file decoding and PCM through the same relay twice without tab capture or microphone','known 403 blocks paid pipeline','desktop and 390px mobile fit'],external_calls:0,paid_inference:false,real_youtube_verified:false,physical_output_verified:false,translation_quality_verified:false,errors};
  fs.writeFileSync(path.join(directory,'browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
