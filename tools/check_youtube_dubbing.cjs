'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const simple=process.env.BRIVANY_YOUTUBE_SIMPLE==='1';
const compatibility=process.env.BRIVANY_YOUTUBE_CAPTURE_COMPAT==='1';
const fakePlayer=`window.YT={Player:class{constructor(frame,options){this.frame=frame;this.events=options.events;this.t=0;this.state=5;window.__fakeYT=this;setTimeout(()=>this.events.onReady({target:this}),10);}cueVideoById(id){this.id=id;this.state=5;}playVideo(){this.state=1;this.events.onStateChange({data:1});}pauseVideo(){this.state=2;this.events.onStateChange({data:2});}setVolume(value){this.volume=value;}getPlayerState(){return this.state;}getCurrentTime(){return this.t;}getDuration(){return 100;}destroy(){}}};window.onYouTubeIframeAPIReady();`;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'}),page=await context.newPage(),base=process.env.BRIVANY_TEST_URL,errors=[],external=[],checks=[],wire=[];
  await context.route('**/*',route=>{const url=route.request().url();if(url==='https://www.youtube.com/iframe_api')return route.fulfill({contentType:'text/javascript',body:fakePlayer});if(new URL(url).origin!==base){external.push(new URL(url).origin);return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic YouTube iframe</title>'});}return route.continue();});
  await context.addInitScript(({compatibility})=>{
   window.__captureRequests=0;window.__micRequests=0;window.__stoppedTracks=0;window.__windowOpenCalls=0;window.__playCalls=0;let handleConfig;
   window.open=()=>{window.__windowOpenCalls++;throw Error('No popup is allowed in the native audio journey');};
   Object.defineProperty(navigator.mediaDevices,'setCaptureHandleConfig',{configurable:true,value:compatibility?undefined:value=>{handleConfig=value;}});
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>{window.__micRequests++;throw Error('No microphone in this test');}});
   Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{
    window.__captureRequests++;
    if(compatibility){window.__fakeYT.pauseVideo();await new Promise(resolve=>setTimeout(resolve,9000));}
    const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination();gain.gain.value=.012;osc.connect(gain);gain.connect(destination);osc.start();await audio.resume();
    const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const video=canvas.captureStream(5).getVideoTracks()[0],track=destination.stream.getAudioTracks()[0];
    Object.defineProperty(video,'getSettings',{value:()=>compatibility?{}:({displaySurface:'browser',suppressLocalAudioPlayback:true})});Object.defineProperty(video,'getCaptureHandle',{value:compatibility?undefined:()=>({origin:location.origin,handle:handleConfig.handle})});
    Object.defineProperty(track,'getSettings',{value:()=>compatibility?{}:({suppressLocalAudioPlayback:true,restrictOwnAudio:false})});
    for(const item of [video,track]){const stop=item.stop.bind(item);item.stop=()=>{window.__stoppedTracks++;stop();};}return new MediaStream([video,track]);
   }});
  },{compatibility});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('websocket',socket=>{socket.on('framesent',event=>{if(typeof event.payload==='string'){try{const data=JSON.parse(event.payload);if(['start','switch_language','audio_levels','set_audio_levels','listening'].includes(data.type))wire.push({direction:'client',...data});}catch{}}});socket.on('framereceived',event=>{if(typeof event.payload==='string'){try{const data=JSON.parse(event.payload);if(['ready','audio-output','language-changed','audio-playback','native-playback','audio','done'].includes(data.type))wire.push({direction:'relay',type:data.type,audio_output:data.audio_output,epoch:data.epoch,target_language:data.target_language,contains_pcm:typeof data.audio==='string'});}catch{}}});});
  await page.goto(base+'/dubbing'+(simple?'?provider=palabra&source=youtube&view=simple':''));
  if(!simple)await page.locator('#source-youtube').click();await page.waitForFunction(()=>document.querySelector('#youtube-status').textContent.includes('Video preparado'));
  assert.equal(await page.evaluate(()=>window.__captureRequests),0);assert.equal(await page.locator('#youtube-player iframe').count(),1);
  assert.equal(await page.locator('#youtube-url').inputValue(),'https://www.youtube.com/watch?v=qGEPPNTTYmk');
  checks.push('YouTube is embedded from a validated manual link without playback, capture, microphone or provider activation');
  if(simple){assert.equal(await page.locator('button:visible').count(),2);assert.equal(await page.locator('#simple-settings').evaluate(node=>node.open),false);}else await page.locator('#dub-consent').check();
  const play=page.locator(simple?'#simple-play':'#start-dubbing');await play.waitFor({state:'visible'});await page.waitForFunction(simple?()=>!document.querySelector('#simple-play').disabled:()=>!document.querySelector('#start-dubbing').disabled);
  if(compatibility){await page.evaluate(()=>window.__fakeYT.playVideo());assert.equal(await play.textContent(),'Reproducir con doblaje');}
  await play.click();
  await page.waitForFunction(()=>document.querySelector('#session-state').textContent==='Traduciendo',{},{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('#translation-caption').textContent.includes('Prueba simulada'),{},{timeout:15000});
  assert.equal(await page.evaluate(()=>window.__captureRequests),1);assert.equal(await page.evaluate(()=>window.__micRequests),0);
  assert.equal(await page.evaluate(()=>window.__windowOpenCalls),0);assert.equal(context.pages().length,1);
  assert.equal(await page.evaluate(()=>window.__fakeYT?.state),1);assert.equal(await page.locator('#youtube-player iframe').isVisible(),true);
  const start=wire.find(event=>event.direction==='client' && event.type==='start');assert.ok(start);
  assert.equal(start.audio_output,'local_device');assert.equal(start.original_gain,compatibility ? .06 : .12);assert.equal(start.translation_gain,.85);
  assert.equal(await page.evaluate(()=>window.__fakeYT.volume),compatibility?6:100);
  const ready=wire.find(event=>event.direction==='relay' && event.type==='ready');assert.ok(ready);
  assert.ok(wire.some(event=>event.direction==='relay' && ['ready','audio-output'].includes(event.type) && event.audio_output==='local_device'));
  await page.waitForFunction(()=>document.querySelector('#session-state').textContent==='Traduciendo');
  checks.push('one primary click starts the embedded synthetic player and captures live tab PCM; native-device output is requested and confirmed with no popup');
  if(compatibility)checks.push('a permission delay of 9 seconds, iframe paused by picker, absent CaptureHandle and absent capture settings still resume the existing video and stream audio with quiet fallback mix');
  if(simple)await page.locator('#simple-language').click();else await page.locator('#target-language').selectOption('fr');await page.waitForFunction(()=>document.querySelector('#translation-caption').textContent.includes('Bonjour simulé'),{},{timeout:12000});
  assert.equal(await page.locator('#session-state').textContent(),'Traduciendo');assert.equal(await page.evaluate(()=>window.__fakeYT?.state),1);
  if(simple){await page.locator('#simple-language').click();assert.match(await page.locator('#simple-language').textContent(),/English/);await page.waitForFunction(()=>!document.querySelector('#simple-language').disabled);assert.equal(await page.locator('#source-language').inputValue(),'auto');await page.waitForFunction(()=>document.querySelector('#simple-status').textContent.includes('original'));assert.ok(wire.some(value=>value.type==='audio_levels' && value.translation_gain===0 && value.original_gain=== (compatibility ? .5 : 1)));}
  else{await page.locator('#toggle-translation').click();assert.equal(await page.locator('#toggle-translation').getAttribute('aria-pressed'),'false');await page.locator('#toggle-translation').click();assert.equal(await page.locator('#toggle-translation').getAttribute('aria-pressed'),'true');}
  checks.push('French changes in the existing stream and original/translation listening toggles without preprocessing or reopening the video');
  await page.locator(simple?'#simple-play':'#stop-dubbing').click();await page.waitForFunction(()=>document.querySelector('#session-state').textContent==='En espera');
  assert.ok(await page.evaluate(()=>window.__stoppedTracks)>=2);assert.equal(await play.isEnabled(),true);
  if(simple){await page.locator('#youtube-url').fill('https://youtu.be/M7lc1UVf-VE');await page.waitForFunction(()=>document.querySelector('#youtube-player iframe')?.src.includes('M7lc1UVf-VE'));assert.equal(await page.locator('button:visible').count(),2);checks.push('simple mode exposes one URL input and two action buttons; manual URL changes prepare another video without autoplay');}
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__windowOpenCalls),0);assert.equal(context.pages().length,1);
  assert.ok(wire.some(event=>event.type==='audio-playback' || event.type==='native-playback'),'The relay must report native playback without sending PCM for browser playback');
  assert.equal(wire.some(event=>event.direction==='relay' && event.contains_pcm),false);
  const directory=path.resolve(compatibility?'tmp/youtube-capture-compat':simple?'tmp/youtube-simple':'tmp/youtube-dubbing');fs.mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,'live-translator-1440.png'),fullPage:true});
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(directory,'live-translator-390.png'),fullPage:true});
  checks.push('stop releases capture tracks and the local interface fits desktop and mobile widths');
  const report={status:'passed',checks,simple_mode:simple,scope:'Real local HTTP/WebSocket/AudioWorklet/AudioContext with substituted YouTube API, capture picker, Palabra translation and native output device.',external_calls:0,paid_inference:false,popup_windows:0,wire,synthetic_embedded_player_playing_observed:true,real_youtube_audio_capture_verified:false,physical_speaker_playback_verified:false,physical_echo_isolation_verified:false,translation_quality_verified:false,audible_latency_verified:false,screenshots:[path.relative(process.cwd(),path.join(directory,'live-translator-1440.png')).replaceAll('\\','/'),path.relative(process.cwd(),path.join(directory,'live-translator-390.png')).replaceAll('\\','/')]};
  fs.writeFileSync(path.join(directory,'browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
