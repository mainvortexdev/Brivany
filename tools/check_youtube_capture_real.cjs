/* One bounded, real public YouTube -> tab capture -> PCM observation.
 * Translation sockets and microphone are blocked. No audio samples are saved.
 * Chromium test switches apply only to this separate owned browser instance:
 * https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/chrome_switches.h
 */
'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path');
const base='http://127.0.0.1:8765',folder=path.resolve('tmp/youtube-capture-real');
const report={started_at:new Date().toISOString(),scope:'Actual public YouTube iframe and native browser tab audio capture in an isolated headless Edge instance. No translation session.',
  investigation:'Remove Playwright headless --mute-audio default verified in installed coreBundle.js; observe explicit source play/unmute, HTML media state and eight seconds of PCM energy. No test-side player unmute override.',
  playwright_headless_mute_default_removed:true,
  video_id:'qGEPPNTTYmk',capture_attempt_limit:1,pcm_observation_limit_seconds:8,capture_requests:0,microphone_requests:0,websocket_attempts:0,
  translation_provider_requests:0,paid_inference:false,translation_verified:false,audible_latency_verified:false,physical_audio_output_verified:false,
  echo_isolation_verified:false,original_media_saved:false,browser_test_capture_flags:true,
  switch_reference:'https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/chrome_switches.h'};
let browser,context,page;
function save(){
  report.finished_at=new Date().toISOString();fs.mkdirSync(folder,{recursive:true});const latest=path.join(folder,'report.json');
  if(fs.existsSync(latest)){
    const previous=fs.readFileSync(latest,'utf8');let stamp='previous';try{stamp=JSON.parse(previous).started_at.replace(/[^0-9TZ]/g,'');}catch{}
    const archive=path.join(folder,'report-'+stamp+'.json');if(!fs.existsSync(archive))fs.writeFileSync(archive,previous);
  }
  const raw=JSON.stringify(report,null,2);fs.writeFileSync(path.join(folder,'report-'+report.started_at.replace(/[^0-9TZ]/g,'')+'.json'),raw);fs.writeFileSync(latest,raw);console.log(raw);
}
async function mediaState(frame){return frame.evaluate(()=>{
  const video=document.querySelector('video');if(!video)return null;
  return {playing:!video.paused,ready_state:video.readyState,has_dimensions:video.videoWidth>0 && video.videoHeight>0,
    muted:video.muted,default_muted:video.defaultMuted,volume:video.volume,current_time:video.currentTime,
    audio_decoded_bytes:Number.isFinite(video.webkitAudioDecodedByteCount)?video.webkitAudioDecodedByteCount:null,
    audio_track_count:Number.isInteger(video.audioTracks?.length)?video.audioTracks.length:null};
});}
(async()=>{
  try{
    browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',ignoreDefaultArgs:['--mute-audio'],args:['--auto-accept-this-tab-capture','--auto-select-tab-capture-source-by-title=Brivany Capture Probe']});
    context=await browser.newContext({serviceWorkers:'block',viewport:{width:1400,height:1000}});page=await context.newPage();
    await context.routeWebSocket('**/*',socket=>{report.websocket_attempts++;socket.close();});
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin===base && request.method()!=='GET'){report.translation_provider_requests++;return route.abort('blockedbyclient');}
      return route.continue();
    });
    await context.addInitScript(()=>{
      window.__realCaptureCounts={display:0,microphone:0,sockets:0};
      window.WebSocket=class {constructor(){window.__realCaptureCounts.sockets++;throw Error('Translation and WebSockets are disabled for this capture observation.');}};
      if(navigator.mediaDevices){
        const display=navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices);
        if(display)Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:options=>{window.__realCaptureCounts.display++;if(window.__realCaptureCounts.display>1)throw Error('Only one capture attempt is allowed.');return display(options);}});
        Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{window.__realCaptureCounts.microphone++;throw Error('Microphone access is disabled in this observation.');}});
      }
    });
    await page.goto(base+'/dubbing?provider=palabra&source=youtube&view=simple',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#youtube-player')?.dataset.ready==='true',null,{timeout:25000});
    await page.locator('#simple-settings > summary').click();
    // Equal declared languages take the original-only branch. Avoid the full
    // translation form's helper that keeps two selected languages distinct.
    await page.evaluate(()=>{
      document.querySelector('#source-language').value='en';document.querySelector('#target-language').value='en';
      document.querySelector('#dub-consent').dispatchEvent(new Event('change',{bubbles:true}));
      document.title='Brivany Capture Probe';
      const prototype=BrivanyYouTubeSource.YouTubeSource.prototype,original=prototype.play;
      const read=player=>{let muted=null,volume=null;try{const value=player?.isMuted?.();if(typeof value==='boolean')muted=value;}catch{}try{const value=player?.getVolume?.();if(Number.isFinite(value))volume=value;}catch{}return {muted,volume};};
      prototype.play=function(...args){
        const player=this.player;window.__readYouTubeAudioApi=()=>read(player);window.__youtubeAudioPlay={before:read(player)};
        try{return original.apply(this,args);}finally{window.__youtubeAudioPlay.after_command=read(player);}
      };
    });
    const frame=page.frames().find(frame=>frame.url().startsWith('https://www.youtube.com/embed/qGEPPNTTYmk'));
    if(!frame)throw Error('Official YouTube iframe was not available.');
    report.playback_before_play=await mediaState(frame);
    await page.locator('#simple-play').click();
    await frame.waitForFunction(()=>{const video=document.querySelector('video');return video && !video.paused && video.currentTime>0 && video.readyState>=2;},null,{timeout:15000});
    report.playback_before_capture=await mediaState(frame);report.youtube_audio_api_before_capture=await page.evaluate(()=>({play_command:window.__youtubeAudioPlay || null,current:window.__readYouTubeAudioApi?.() || null}));
    await page.evaluate(()=>{
      const probe={state:'waiting',packets:0,bytes:0,samples:0,nonzero_samples:0,peak:0,sum_squares:0,energy_windows:[],ended:false,cleanup_complete:false};window.__realCaptureProbe=probe;
      const controller=new AbortController();let capture;const watchdog=setTimeout(()=>{controller.abort();if(probe.state==='opening'){probe.state='capture_timeout';probe.error_name='TimeoutError';}},16000);
      window.__stopRealCapture=()=>{controller.abort();capture?.stop();};
      const button=document.createElement('button');button.type='button';button.id='real-capture-observation';button.textContent='Observe tab PCM';document.body.append(button);
      button.addEventListener('click',async()=>{
        if(probe.state!=='waiting')return;probe.state='opening';
        try{
          capture=await BrivanyTabAudio.openTabAudio({signal:controller.signal,onEnded:()=>{probe.ended=true;},onPcm:event=>{
            if(event?.type!=='pcm' || event.generation!==42 || !(event.buffer instanceof ArrayBuffer))return;
            const view=new DataView(event.buffer);probe.packets++;probe.bytes+=view.byteLength;
            for(let index=0;index+1<view.byteLength;index+=2){const value=view.getInt16(index,true)/32768,bucket=Math.min(7,Math.floor(probe.samples/24000));
              const window=probe.energy_windows[bucket] || (probe.energy_windows[bucket]={samples:0,sum_squares:0,peak:0});window.samples++;window.sum_squares+=value*value;window.peak=Math.max(window.peak,Math.abs(value));
              probe.samples++;probe.sum_squares+=value*value;probe.peak=Math.max(probe.peak,Math.abs(value));if(value!==0)probe.nonzero_samples++;}
          }});
          probe.state='capturing';probe.source=capture.source;probe.original_playback_suppressed=capture.originalPlaybackSuppressed;
          probe.audio_context_running=capture.audio.state==='running';probe.audio_track_count=capture.stream.getAudioTracks().length;probe.video_track_count=capture.stream.getVideoTracks().length;
          const audioSettings=capture.stream.getAudioTracks()[0]?.getSettings?.() || {},videoSettings=capture.stream.getVideoTracks()[0]?.getSettings?.() || {};
          probe.browser_surface_reported=videoSettings.displaySurface==='browser';probe.suppression_metadata_present=typeof audioSettings.suppressLocalAudioPlayback==='boolean' || typeof videoSettings.suppressLocalAudioPlayback==='boolean';
          probe.restrict_own_audio_reported=typeof audioSettings.restrictOwnAudio==='boolean'?audioSettings.restrictOwnAudio:null;
          capture.capture.port.postMessage({active:true,generation:42});await new Promise(resolve=>setTimeout(resolve,8000));
          capture.capture.port.postMessage({active:false,generation:42});probe.state='observed';
        }catch(error){probe.state=probe.state==='capture_timeout'?'capture_timeout':'capture_failed';probe.error_name=error?.name || 'Error';probe.error_code=error?.code || null;}
        finally{clearTimeout(watchdog);capture?.stop();controller.abort();probe.cleanup_complete=true;button.remove();}
      },{once:true});
    });
    await page.locator('#real-capture-observation').click();
    await page.waitForFunction(()=>window.__realCaptureProbe?.cleanup_complete===true || window.__realCaptureProbe?.state==='capture_timeout',null,{timeout:26000});
    report.observation=await page.evaluate(()=>{
      const value=window.__realCaptureProbe;if(!value)return null;
      const {sum_squares,energy_windows,...safe}=value;return {...safe,rms:value.samples?Math.sqrt(sum_squares/value.samples):null,
        energy_windows:energy_windows.map((window,index)=>({second:index+1,samples:window.samples,peak:window.peak,rms:window.samples?Math.sqrt(window.sum_squares/window.samples):null}))};
    });
    report.playback_after_capture=await mediaState(frame);report.youtube_audio_api_after_capture=await page.evaluate(()=>window.__readYouTubeAudioApi?.() || null);
    report.status=report.observation?.state==='observed' && report.observation.nonzero_samples>0?'nonzero_youtube_pcm_observed':report.observation?.state==='observed'?'capture_silent':'capture_not_supported_or_failed';
  }catch(error){report.status='observation_incomplete';report.error_name=error.name || 'Error';report.error_message=String(error.message).replace(/https?:\/\/[^\s]+/g,'[URL]').slice(0,450);}
  finally{
    if(page && !page.isClosed()){
      try{
        await page.evaluate(()=>window.__stopRealCapture?.());
        const counts=await page.evaluate(()=>window.__realCaptureCounts || {});report.capture_requests=counts.display || 0;report.microphone_requests=counts.microphone || 0;report.websocket_attempts+=counts.sockets || 0;
      }catch{}
    }
    if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
    if(report.capture_requests>1 || report.microphone_requests || report.websocket_attempts || report.translation_provider_requests){report.status='boundary_failure';process.exitCode=3;}
    else if(report.status!=='nonzero_youtube_pcm_observed')process.exitCode=2;
    save();
  }
})();
