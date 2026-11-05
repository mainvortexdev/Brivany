/* Finite local frame renderer. Generated copy is data; no generated JS is run. */
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';

const folder=path.resolve(process.argv[2]||''),snapshotOnly=process.argv.includes('--snapshots-only');
const ffmpeg=process.argv[process.argv.indexOf('--ffmpeg')+1];
if(!path.isAbsolute(folder)||!path.isAbsolute(ffmpeg)||!folder.includes(path.sep))throw Error('Renderer needs canonical local paths.');
const spec=JSON.parse(await fs.readFile(path.join(folder,'motion.json'),'utf8'));
if(!['workspace','spatial'].includes(spec.style)||![18,24,30].includes(spec.duration)||![30,60].includes(spec.fps))throw Error('Unsupported finite render specification.');
const started=performance.now(),errors=[],requests=[];let child,exitPromise,browser;
const report={passed:false,frames:0,fps:spec.fps,duration:spec.duration,mode:snapshotOnly?'snapshots':'mp4',network_requests:0};
try{
 const options={headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']};
 browser=await chromium.launch({...options,channel:process.platform==='win32'?'msedge':'chrome'});
 const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.protocol==='file:'){
   const relative=path.relative(folder,fileURLToPath(url));
   if(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))return route.continue();
  }
  requests.push(url.protocol);return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(path.join(folder,'index.html')).href+'?clean=1',{waitUntil:'load'});
 await page.waitForFunction(()=>window.OPENER?.ready,{timeout:40000});
 const snapshotFolder=snapshotOnly?'preview-snapshots':'snapshots';
 await fs.mkdir(path.join(folder,snapshotFolder));
 const samples=[.2,3.5,6.5,10,14,17,20.5,23.3].map(t=>Math.min(t/24*spec.duration,spec.duration-.05));
 for(const [i,time] of samples.entries()){
  await page.evaluate(t=>window.OPENER.seek(t),time);await page.screenshot({path:path.join(folder,snapshotFolder,String(i).padStart(2,'0')+'.png')});
 }
 // Seek backward to a previously seen frame. This is a real byte comparison,
 // not a claim about artistic quality or geometry semantics.
 await page.evaluate(t=>window.OPENER.seek(t),samples[2]);const a=await page.screenshot();
 await page.evaluate(t=>window.OPENER.seek(t),samples[6]);await page.evaluate(t=>window.OPENER.seek(t),samples[2]);const b=await page.screenshot();
 if(!a.equals(b))throw Error('Non-deterministic seek back to the same time.');
 if(spec.style==='workspace'&&spec.edition!==2){
  await page.evaluate(t=>window.OPENER.seek(t),spec.duration-.2);
  const pixel=await page.evaluate(()=>[...document.querySelector('#motion-canvas').getContext('2d').getImageData(1400,840,1,1).data]);
  if(pixel.slice(0,3).some(value=>value<200))throw Error('Closing frame still contains the old UI below the end card.');
  const cheek=await page.evaluate(()=>[...document.querySelector('#motion-canvas').getContext('2d').getImageData(941,221,1,1).data]);
  if(cheek.slice(0,3).some(value=>value<235))throw Error('Closing frame still contains the mascot cheek.');
  report.closing_ui_cleared=true;
 }
 if(errors.length||requests.length)throw Error('Render page failed or attempted a non-project request.');
 if(!snapshotOnly){
  const audio=spec.audio?['-i',path.join(folder,'assets','melodi.wav'),'-af','loudnorm=I=-16:TP=-1:LRA=7','-c:a','aac','-b:a','192k']:['-an'];
  child=spawn(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-n','-f','image2pipe','-vcodec','mjpeg','-framerate',String(spec.fps),'-i','pipe:0',...audio,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(folder,'Brivany.mp4')],{stdio:['pipe','ignore','pipe'],windowsHide:true,shell:false});
  let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8000);});child.stdin.on('error',()=>{});exitPromise=once(child,'close');
  const frames=spec.duration*spec.fps;
  for(let i=0;i<frames;i++){
   if(child.exitCode!==null)throw Error('Encoder exited early: '+stderr);
   await page.evaluate(t=>window.OPENER.seek(t),i/spec.fps);
   const frame=await page.screenshot({type:'jpeg',quality:94,animations:'allow'});
   if(!child.stdin.write(frame))await once(child.stdin,'drain');
   report.frames++;
   if(i%spec.fps===0)process.stdout.write(JSON.stringify({progress:i/frames,seconds:i/spec.fps})+'\n');
  }
  child.stdin.end();const [code]=await exitPromise;if(code!==0)throw Error('Encoder failed: '+stderr);
 }
 report.passed=true;report.deterministic_seek=true;
}catch(error){report.error=String(error.message);process.exitCode=1;child?.kill();}
finally{
 await browser?.close();report.elapsed_seconds=(performance.now()-started)/1000;report.network_requests=requests.length;report.page_errors=errors;
 await fs.writeFile(path.join(folder,snapshotOnly?'preview-report.json':'render-report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+'\n');
}
