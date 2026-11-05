/* Real Brave DOM/media APIs on an owned local fixture; no user profile or API. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {readVideoCaptions,upcomingCaptions} from '../caption-probe.js';
const require=createRequire(import.meta.url),{chromium}=require('../../motion-studio/node_modules/playwright-core');
const server=createServer((_,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><video muted playsinline></video><canvas width="320" height="180"></canvas>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
const report={type:'real_brave_native_video_text_tracks_owned_fixture',external_calls:0,paid_calls:0,user_profile_used:false,microphone:false,user_media:false,passed:false};
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true});
 const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(async()=>{
  const video=document.querySelector('video'),canvas=document.querySelector('canvas');video.srcObject=canvas.captureStream(10);canvas.getContext('2d').fillRect(0,0,320,180);await video.play();
  const track=video.addTextTrack('subtitles','Owned fixture','es');track.mode='hidden';
  track.addCue(new VTTCue(1,3,'<v Alicia>Hola.</v>'));track.addCue(new VTTCue(3.2,5,'<v Bruno>No, son 15.</v>'));track.addCue(new VTTCue(6,7,'[music]'));
 });
 const snapshot=await page.evaluate(readVideoCaptions);const future=upcomingCaptions(snapshot);
 report.native_track_read=snapshot?.kind==='text-track';report.upcoming_cues=future?.cues?.length||0;report.caption_voice_hints_only=future?.cues?.map(c=>c.speaker).join(',')==='Alicia,Bruno';
 await page.evaluate(()=>document.querySelector('video').pause());report.pause_disables_lookahead=upcomingCaptions(await page.evaluate(readVideoCaptions))===null;
 report.passed=report.native_track_read&&report.upcoming_cues===2&&report.caption_voice_hints_only&&report.pause_disables_lookahead;
}catch(error){report.error=String(error.message).slice(0,500);}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
await mkdir('tmp/extension-sync-buffer',{recursive:true});const file='tmp/extension-sync-buffer/brave-captions-'+Date.now()+'.json';await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(file);process.exitCode=report.passed?0:1;
