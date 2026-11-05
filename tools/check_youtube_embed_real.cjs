'use strict';
/* Actual public YouTube IFrame API, no Palabra/capture/Play/start buttons. */
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const entry=new URL(process.env.BRIVANY_YOUTUBE_TEST_URL || 'http://127.0.0.1:8765/dubbing');
assert.ok(['127.0.0.1','localhost'].includes(entry.hostname));assert.equal(entry.protocol,'http:');assert.equal(entry.pathname,'/dubbing');
const source=process.env.BRIVANY_YOUTUBE_PUBLIC_VIDEO || 'https://www.youtube.com/watch?v=qGEPPNTTYmk';
const report={format:'brivany-youtube-embed-availability-1',started_at:new Date().toISOString(),
  scope:'Actual public YouTube iframe availability in a fresh headless Edge session, without starting translation, screen capture, microphone or video playback.',
  page_origin:entry.origin,video_id:null,embed_ready:false,official_player_errors:[],play_states:[],main_document_policy_violations:[],
  iframe_origins:[],request_origins:[],failed_request_origins:[],embed_referer_origin:null,referrer_policy:null,csp:null,
  display_capture_requests:0,microphone_requests:0,websocket_attempts:0,forbidden_post_requests:0,
  provider_sessions_started:0,paid_inference_requests:0,playback_requested:false,
  translation_quality_verified:false,translation_latency_verified:false,physical_device_verified:false};
const artifacts=path.resolve(__dirname,'../tmp/youtube-embed-real');
let browser,context;
function origin(value){try{return new URL(value).origin;}catch{return null;}}
function write(){report.finished_at=new Date().toISOString();fs.mkdirSync(artifacts,{recursive:true});const file=path.join(artifacts,'report.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,report_path:'tmp/youtube-embed-real/report.json'},null,2));}
(async()=>{
  browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
  const seen=new Set(),failed=new Set(),violations=[],states=[],officialErrors=[],runtimeErrors=[];
  await context.addInitScript(()=>{
    window.__embedObservation={display:0,microphone:0,violations:[],states:[],errors:[]};
    const observation=window.__embedObservation;
    if(navigator.mediaDevices){
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{observation.display++;throw Error('Capture disabled by embed-only observation.');}});
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{observation.microphone++;throw Error('Microphone disabled by embed-only observation.');}});
    }
    document.addEventListener('securitypolicyviolation',event=>{
      let blocked;try{blocked=new URL(event.blockedURI).origin;}catch{blocked=String(event.blockedURI).slice(0,30);}
      observation.violations.push({directive:event.effectiveDirective,blocked_origin:blocked,disposition:event.disposition});
    });
    window.addEventListener('message',event=>{
      if(event.origin!=='https://www.youtube.com')return;
      let data=event.data;try{if(typeof data==='string')data=JSON.parse(data);}catch{return;}
      if(!data || typeof data!=='object')return;
      if(data.event==='onStateChange' && typeof data.info==='number')observation.states.push(data.info);
      if(data.event==='onError' && typeof data.info==='number')observation.errors.push(data.info);
      if(data.event==='infoDelivery' && typeof data.info?.playerState==='number')observation.states.push(data.info.playerState);
    });
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());seen.add(url.origin);
    if(url.origin===entry.origin && request.method()!=='GET' && request.method()!=='HEAD'){
      report.forbidden_post_requests++;return route.abort('blockedbyclient');
    }
    if(url.hostname.endsWith('palabra.ai')){report.provider_sessions_started++;return route.abort('blockedbyclient');}
    if(url.hostname==='www.youtube.com' && url.pathname.startsWith('/embed/')){
      const ref=await request.headerValue('referer');report.embed_referer_origin=ref?origin(ref):null;
      report.video_id=url.pathname.split('/')[2] || null;
    }
    return route.continue();
  });
  // Network connections to local translation relays are explicitly blocked.
  await context.routeWebSocket('**/*',socket=>{report.websocket_attempts++;socket.close();});
  page.on('requestfailed',request=>{failed.add(origin(request.url()));});
  page.on('pageerror',error=>{runtimeErrors.push(error.name);});
  const response=await page.goto(entry.href,{waitUntil:'domcontentloaded',timeout:20000});
  report.page_http_status=response.status();report.csp=response.headers()['content-security-policy'] || null;
  report.referrer_policy=response.headers()['referrer-policy'] || null;
  if(await page.locator('#source-youtube').count()!==1 || await page.locator('#load-youtube').count()!==1){
    report.status='unavailable';report.reason='Local runtime has not loaded the YouTube interface.';
  }else{
    await page.locator('#source-youtube').click();await page.locator('#youtube-url').fill(source);await page.locator('#load-youtube').click();
    try{
      await page.waitForFunction(()=>document.querySelector('#youtube-player')?.dataset.ready==='true' ||
        /no pudo|no permite|no respondió|demasiado|conexión|verificar el origen/i.test(document.querySelector('#youtube-status')?.textContent || ''),null,{timeout:26000});
    }catch{report.observation_timeout=true;}
    // A brief observation window detects unintended autoplay without requesting it.
    await page.waitForTimeout(1200);
    const observed=await page.evaluate(()=>({
      ...window.__embedObservation,ready:document.querySelector('#youtube-player')?.dataset.ready==='true',
      status:document.querySelector('#youtube-status')?.textContent || '',
      iframeOrigins:Array.from(document.querySelectorAll('#youtube-player iframe'),frame=>new URL(frame.src).origin),
      iframeReferrerPolicy:document.querySelector('#youtube-player iframe')?.referrerPolicy || null
    }));
    report.embed_ready=observed.ready;report.display_capture_requests=observed.display;report.microphone_requests=observed.microphone;
    report.main_document_policy_violations=observed.violations;report.official_player_errors=[...new Set(observed.errors)];report.play_states=[...new Set(observed.states)];
    report.iframe_origins=observed.iframeOrigins;report.iframe_referrer_policy=observed.iframeReferrerPolicy;
    report.ui_status=observed.status.slice(0,220);
    report.autoplay_observed=report.play_states.includes(1);
    report.status=report.embed_ready && !report.autoplay_observed?'ready_without_autoplay':'unavailable';
    if(report.autoplay_observed)report.reason='The public player unexpectedly entered the playing state.';
    else if(!report.embed_ready)report.reason=report.official_player_errors.length?'YouTube returned an official player error.':'Embed readiness was not observed; inspect CSP, network and UI status.';
  }
  report.request_origins=[...seen].sort();report.failed_request_origins=[...failed].filter(Boolean).sort();report.runtime_error_types=[...new Set(runtimeErrors)];
  assert.equal(report.display_capture_requests,0);assert.equal(report.microphone_requests,0);assert.equal(report.websocket_attempts,0);
  assert.equal(report.provider_sessions_started,0);assert.equal(report.forbidden_post_requests,0);
  write();
  if(report.status!=='ready_without_autoplay')process.exitCode=2;
})().catch(error=>{
  report.status='observation_failed';report.error_type=error.name;report.reason=String(error.message).replace(/https?:\/\/\S+/g,'[URL]').slice(0,300);write();process.exitCode=1;
}).finally(async()=>{await context?.close();await browser?.close();});
