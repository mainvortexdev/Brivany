/* Isolated Brave -> unmodified desktop protocol -> native translation.
   Uses only reused, owned synthetic speech. Never opens the user's profile. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
if(!process.argv.includes('--allow-paid'))throw Error('Pass --allow-paid for the bounded own-speech provider trial.');
const runtimeArg=process.argv.find(a=>a.startsWith('--runtime='));if(!runtimeArg)throw Error('Provide --runtime=http://127.0.0.1:PORT for this owned desktop.');
const runtimeURL=new URL(runtimeArg.slice('--runtime='.length));if(runtimeURL.protocol!=='http:'||runtimeURL.hostname!=='127.0.0.1'||!runtimeURL.port)throw Error('Only the owned loopback runtime is allowed.');runtimeURL.pathname='/api/desktop/runtime';
const duration=Number(process.argv.find(a=>a.startsWith('--duration='))?.split('=')[1]||19);if(!Number.isFinite(duration)||duration<19||duration>45)throw Error('Trial duration must be 19 to 45 seconds.');
const require=createRequire(import.meta.url),{chromium}=require('../../motion-studio/node_modules/playwright-core');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),folder=path.join(root,'tmp/selected-video');await mkdir(folder,{recursive:true});
const temporary=await mkdtemp(path.join(folder,'native-isolated-')),extension=path.join(temporary,'extension');await cp(path.join(root,'browser-extension'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
const script=path.join(extension,'background.js');await writeFile(script,'globalThis.__ownedEvents=[];\n'+(await readFile(script,'utf8')).replace("if(value.type==='error')return fail", "if(value.type!=='audio-ack')globalThis.__ownedEvents.push({type:value.type,state:value.state,code:value.code,message:value.type==='error'?value.message:undefined,source:value.source,textLength:typeof value.text==='string'?value.text.length:0,at:Date.now()});if(value.type==='error')return fail")+'\nglobalThis.__ownedActivateSource=activateSource;\n');
const waves=await Promise.all(['masculine','feminine'].map(n=>readFile(path.join(root,'tmp/workspace-translation-real',n+'.wav'))));
const html=`<!doctype html><meta charset="utf-8"><style>body{background:#15181c;color:white;font:16px Segoe UI}video{width:640px;height:360px}</style><button>Preparar video propio</button><video playsinline></video><script>
document.querySelector('button').onclick=async()=>{window.ownedAudio=new AudioContext();await ownedAudio.resume();const video=document.querySelector('video'),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');const draw=()=>{ctx.fillStyle='#253d50';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='28px Georgia';ctx.fillText('Prueba propia Brivany',100,170)};draw();window.drawTimer=setInterval(draw,70);const destination=ownedAudio.createMediaStreamDestination();const buffers=await Promise.all(['/a.wav','/b.wav'].map(async url=>ownedAudio.decodeAudioData(await (await fetch(url)).arrayBuffer())));video.srcObject=new MediaStream([...canvas.captureStream(15).getVideoTracks(),...destination.stream.getAudioTracks()]);await video.play();for(const [i,buffer] of buffers.entries()){const source=ownedAudio.createBufferSource();source.buffer=buffer;source.connect(destination);source.start(ownedAudio.currentTime+(i?${duration>30?28:7}:2));}window.prepared=true};</script>`;
const server=createServer((req,res)=>{const i=req.url==='/a.wav'?0:req.url==='/b.wav'?1:-1;res.setHeader('Content-Type',i<0?'text/html':'audio/wav');res.end(i<0?html:waves[i]);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const report={type:'isolated_real_brave_extension_to_real_running_desktop_and_providers',passed:false,user_profile_used:false,source_owned_synthetic:true,microphone:false,original_media_attached:false,transcript_persisted:false,physical_listening_verified:false,billing_amount:null,provider_trial_max_seconds:duration};let context;
try{
 context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:8000}),page=await context.newPage(),url=`http://127.0.0.1:${server.address().port}/`;
 report.extension_id=new URL(worker.url()).hostname;await page.goto(url);await page.locator('button').click();await page.waitForFunction(()=>window.prepared);
 const start=Date.now();await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===url);await __ownedActivateSource(tab);},url);
 await page.waitForFunction(()=>document.documentElement.hasAttribute('data-brivany-picking'),null,{timeout:4000});const r=await page.locator('video').boundingBox();await page.mouse.click(r.x+200,r.y+100);
 let events=[];while(Date.now()-start<duration*1000){events=await worker.evaluate(()=>__ownedEvents);if(events.some(e=>e.type==='error'))break;
  const runtime=await (await fetch(runtimeURL)).json();const audio=runtime.work_audio_translation?.audio_output;
  if(audio?.translation_bytes>0){report.native_audio=audio;report.first_native_audio_seconds??=(Date.now()-start)/1000;}
  if(Date.now()-start<25000&&audio?.device_position_bytes>0)report.device_bytes_before_second_voice=audio.device_position_bytes;
  report.last_failure=runtime.browser_translation?.last_failure||null;
  await new Promise(resolve=>setTimeout(resolve,150));}
 report.events=events;report.selected_acknowledged=events.some(e=>e.type==='selected');report.original_transcript=events.some(e=>e.type==='transcript'&&e.source==='original'&&e.textLength>0);report.translated_transcript=events.some(e=>e.type==='transcript'&&e.source==='translation'&&e.textLength>0);report.original_ducking=events.some(e=>e.type==='original-gain');report.elapsed_seconds=(Date.now()-start)/1000;
 if(duration>30)report.late_voice_reached_device=!!report.device_bytes_before_second_voice&&report.native_audio?.device_position_bytes>report.device_bytes_before_second_voice&&events.some(e=>e.type==='transcript'&&e.source==='translation'&&e.at-start>28000);
 report.passed=report.selected_acknowledged&&report.original_transcript&&report.translated_transcript&&report.native_audio?.translation_bytes>0&&report.native_audio?.device_position_bytes>0&&!report.native_audio?.error_code&&!events.some(e=>e.type==='error')&&(duration<=30||report.late_voice_reached_device)&&report.elapsed_seconds>=duration;await page.goto('about:blank');
}catch(error){report.error=String(error.message).slice(0,500);}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
const output=path.join(folder,'native-extension-'+Date.now()+'.json');await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(output);process.exitCode=report.passed?0:1;
