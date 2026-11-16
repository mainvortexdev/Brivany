import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openPublicVideo,prefixOpeningDiagnostic} from './public-video-opening.mjs';

test('all source-opening stages share one deadline and safe phase-specific failures',async()=>{
 let clock=0;const timeouts=[],phases=[];
 const source={first(){return this;},async waitFor(options){timeouts.push(options.timeout);clock+=250;},async evaluate(){return false;}};
 const page={async goto(_url,options){assert.equal(options.waitUntil,'commit');timeouts.push(options.timeout);clock+=250;},locator(){return source;},
  async waitForFunction(_fn,_arg,options){timeouts.push(options.timeout);clock+=250;}};
 assert.equal(await openPublicVideo(page,'http://owned.invalid/?v=abcdefghijk',{
  expectedVideoId:'abcdefghijk',timeout:1000,now:()=>clock,onPhase:phase=>phases.push(phase)}),source);
 assert.deepEqual(timeouts,[1000,750,500,250]);
 assert.deepEqual(phases,['navegar-video','esperar-reproductor','verificar-identidad','verificar-reproduccion']);
 await assert.rejects(openPublicVideo({goto:async()=>{const error=Error('Private URL');error.name='TimeoutError';throw error;}},'http://owned.invalid/',
  {expectedVideoId:'abcdefghijk',timeout:100}),error=>error.code==='source_navigation_timeout'&&error.opening_phase==='navegar-video'&&!error.message.includes('Private'));
 await assert.rejects(openPublicVideo({goto:async()=>{throw Error('Private URL');}},'http://owned.invalid/',
  {expectedVideoId:'abcdefghijk',timeout:100}),error=>error.code==='source_navigation_failed');
});

test('partial prefix snapshot exports numeric metadata without text, audio or capability IDs',()=>{
 const diagnostic=prefixOpeningDiagnostic({started_at:1000,ready_at:9000,pcm_bytes:125*3840,duration_ms:10000,resume_from_ms:10000,
  position_ms:18,prefix_id:'private capability',transcript:'private text',pcm_base64:'private audio',
  preparation_metrics:{asr_ms:2000,total_ms:3100,prosody_ms:true,local_timbre_ms:Infinity,transcript:'private text'},
  turns:[{start_ms:0,end_ms:2000,content:'speech',text:'private source'}, {start_ms:0,end_ms:11000,content:'speech'}]});
 assert.deepEqual(diagnostic,{diagnostic_partial:true,prepared_before_activation:true,duration_ms:10000,resume_from_ms:10000,
  position_ms:18,pcm_sent_ms:10000,elapsed_ms:8000,error_code:null,preparation_metrics:{asr_ms:2000,total_ms:3100},
  turns:[{start_ms:0,end_ms:2000,content:'speech'}]});
 assert.equal(prefixOpeningDiagnostic(null),null);
 assert.equal(prefixOpeningDiagnostic({error_code:'prefix_asr_timeout'}).error_code,'prefix_asr_timeout');
 assert.equal(prefixOpeningDiagnostic({error_code:'private URL'}).error_code,null);
});

test('a ready local video can pass while a parser-blocking resource prevents DOMContentLoaded',async()=>{
 const require=createRequire(import.meta.url),{chromium}=require('../../motion-studio/node_modules/playwright-core');
 const temporary=await mkdtemp(path.join(tmpdir(),'brivany-opening-'));
 const moviePath=path.join(temporary,'owned-black-video.mp4');
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=128x72:r=10:d=3',
  '-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart',moviePath]);
 const movie=await readFile(moviePath),blocked=new Set();
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/movie.mp4'){res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':movie.length});res.end(movie);return;}
  if(url.pathname==='/blocked.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.write('/* waiting */');blocked.add(res);res.on('close',()=>blocked.delete(res));return;}
  const ad=url.searchParams.get('ad')==='1',wrong=url.searchParams.get('wrong')==='1',fast=url.searchParams.get('fast')==='1';
  res.writeHead(200,{'Content-Type':'text/html'});res.end(`<!doctype html><div id="movie_player" class="${ad?'ad-showing':''}"><video class="html5-main-video" src="/movie.mp4" muted autoplay style="width:160px;height:90px"></video></div><script>
   const player=document.querySelector('#movie_player'),video=player.querySelector('video');
   const details={videoId:'${wrong?'xxxxxxxxxxx':'abcdefghijk'}',lengthSeconds:'3'};
   player.getPlayerResponse=()=>({videoDetails:details});player.getVideoData=()=>({video_id:details.videoId});player.getDuration=()=>3;
   window.ytInitialPlayerResponse={videoDetails:details};video.playbackRate=${fast?2:1};
  </script><script src="/blocked.js"></script>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,
   args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage(),url=`http://127.0.0.1:${server.address().port}/?v=abcdefghijk`;
  await assert.rejects(page.goto(url,{waitUntil:'domcontentloaded',timeout:350}),{name:'TimeoutError'});
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=3,null,{timeout:2000});
  assert.equal(await page.evaluate(()=>document.readyState),'loading');
  const source=await openPublicVideo(page,url,{expectedVideoId:'abcdefghijk',timeout:2000});
  assert.equal(await source.evaluate(video=>video.readyState>=3&&!video.paused&&video.currentTime>=.15),true);
  assert.equal(await page.evaluate(()=>document.readyState),'loading','Source readiness must not depend on the unrelated parser-blocking resource');
  for(const [query,code] of [['ad=1','source_identity_timeout'],['wrong=1','source_identity_timeout'],['fast=1','source_playback_timeout']]){
   await assert.rejects(openPublicVideo(page,url+'&'+query,{expectedVideoId:'abcdefghijk',timeout:700}),error=>error.code===code);
  }
 }finally{
  await browser?.close();for(const response of blocked)response.destroy();
  await new Promise(resolve=>server.close(resolve));
  if(path.dirname(temporary)!==tmpdir()||!path.basename(temporary).startsWith('brivany-opening-'))throw Error('Unexpected fixture cleanup path');
  await rm(temporary,{recursive:true,force:true});
 }
});
