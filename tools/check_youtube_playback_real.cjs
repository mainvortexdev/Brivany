'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
 const report={started_at:new Date().toISOString(),scope:'Actual public iframe playback, translation WebSockets and display/microphone capture blocked; normal YouTube browser traffic only.',video_id:'qGEPPNTTYmk',provider_sessions:0,capture_requests:0,physical_video_output_verified:false,translation_verified:false,paid_inference:false};
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1400,height:1000}}),page=await context.newPage(),errors=[],origins=new Set();
  await context.routeWebSocket('**/*',socket=>{report.provider_sessions++;socket.close();});
  await context.addInitScript(()=>{window.__captureRequests=0;for(const key of ['getDisplayMedia','getUserMedia'])if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,key,{value:async()=>{window.__captureRequests++;throw Error('No capture in public playback observation');},configurable:true});});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>origins.add(new URL(request.url()).origin));
  await page.goto('http://127.0.0.1:8765/dubbing?provider=palabra&source=youtube&view=simple',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#youtube-player').dataset.ready==='true',null,{timeout:25000});
  await page.locator('#simple-language').click();await page.locator('#simple-language').click();
  await page.locator('#simple-play').click();
  const frame=page.frames().find(frame=>frame.url().startsWith('https://www.youtube.com/embed/'));
  if(!frame)throw Error('Missing official iframe');
  let playing=false;try{await frame.waitForFunction(()=>{const video=document.querySelector('video');return video && !video.paused && video.currentTime>0 && video.readyState>=2;},null,{timeout:15000});playing=true;}catch{}
  const first=await frame.evaluate(()=>{const video=document.querySelector('video');return video?{time:video.currentTime,paused:video.paused,readyState:video.readyState,width:video.videoWidth,height:video.videoHeight,decodedFrames:video.getVideoPlaybackQuality?.().totalVideoFrames || null}:null;});
  await page.waitForTimeout(1500);
  const second=await frame.evaluate(()=>{const video=document.querySelector('video');return video?{time:video.currentTime,paused:video.paused,readyState:video.readyState,width:video.videoWidth,height:video.videoHeight,decodedFrames:video.getVideoPlaybackQuality?.().totalVideoFrames || null}:null;});
  report.status=playing && second?.time>first?.time && second?.width>0?'playing_observed':'playback_unverified';
  report.first=first;report.second=second;report.ui_status=await page.locator('#simple-status').textContent();report.capture_requests=await page.evaluate(()=>window.__captureRequests);report.errors=errors;report.request_origins=[...origins];
  const folder=path.resolve('tmp/youtube-playback-real');fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,'player.png'),fullPage:true});
  await page.locator('#simple-play').click();report.finished_at=new Date().toISOString();fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(report.status!=='playing_observed' || report.capture_requests || report.provider_sessions || errors.length)process.exitCode=2;
  await context.close();
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
