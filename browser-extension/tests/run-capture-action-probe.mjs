/* Actual extension command in an isolated test profile. No user tabs or APIs. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require('../../motion-studio/node_modules/playwright-core'),{wsServer:WebSocketServer}=require('../../motion-studio/node_modules/playwright-core/lib/utilsBundle.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),folder=path.join(root,'tmp/extension-sync-buffer');await mkdir(folder,{recursive:true});
const profile=await mkdtemp(path.join(folder,'capture-profile-')),extension=path.join(root,'browser-extension');let origin,context;
const report={type:'actual_extension_action_and_tab_capture_with_owned_test_page_and_substituted_relay',external_calls:0,paid_calls:0,user_profile_used:false,microphone_used:false,media_persisted:false,passed:false,pcm_frames:0};
const html='<!doctype html><button id="play">Play own media</button><canvas width="640" height="360"></canvas><script>document.querySelector("button").onclick=async()=>{const a=new AudioContext();await a.resume();const o=a.createOscillator(),g=a.createGain();g.gain.value=.015;o.connect(g);g.connect(a.destination);o.start();const c=document.querySelector("canvas"),x=c.getContext("2d");setInterval(()=>{x.fillStyle="#153b45";x.fillRect(0,0,640,360);x.fillStyle="white";x.font="40px Georgia";x.fillText((performance.now()/1000).toFixed(2),100,170)},33);window.ownSound=a;};</script>';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);}),sockets=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{if(req.headers.origin!==origin){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}sockets.handleUpgrade(req,socket,head,ws=>ws.on('message',(raw,binary)=>{
 if(binary){report.pcm_frames++;ws.send(JSON.stringify({type:'source-progress',epoch:1,processed_ms:report.pcm_frames*80}));return;}
 const d=JSON.parse(String(raw));if(d.type==='pair')ws.send(JSON.stringify({type:'paired',token:'isolated-own-capture-capability-12345678901234567890',websocket_url:`ws://127.0.0.1:${server.address().port}/sync`,expires_in:100}));
 else if(d.type==='authenticate')ws.send(JSON.stringify({type:'authenticated',preferred_mode:'synchronized'}));else if(d.type==='start')ws.send(JSON.stringify({type:'ready'}));else if(d.type==='stop')ws.close();
}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:10000});origin=new URL(worker.url()).origin;if(origin==='null')origin=worker.url().split('/').slice(0,3).join('/');
 const source=await context.newPage();await source.goto(`http://127.0.0.1:${server.address().port}/`);await source.locator('#play').click();const opened=context.waitForEvent('page',{timeout:6000});await source.keyboard.press('Alt+Shift+M');
 const player=await opened;await player.waitForLoadState('domcontentloaded');report.browser_command_opened_player=player.url().startsWith(origin+'/player.html');
 if(!report.browser_command_opened_player)throw Error('Command did not open extension player');
 await player.locator('#pair-link').fill(`ws://127.0.0.1:${server.address().port}/pair#123456`);await player.locator('#pair').click();await player.waitForFunction(()=>document.querySelector('#pair-form').hidden);await player.locator('#toggle').click();
 const until=Date.now()+8000;while(report.pcm_frames<30&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
 report.status_text=await player.locator('#status').textContent();report.video=await player.locator('#replay').evaluate(v=>({time:v.currentTime,frames:v.getVideoPlaybackQuality().totalVideoFrames,readyState:v.readyState}));report.passed=report.pcm_frames>=30&&report.video.frames>10;report.capture_authorization_verified=report.pcm_frames>0;
}catch(e){report.error=String(e.message).slice(0,350);report.manual_capture_verification_pending=true;}
finally{await context?.close();for(const client of sockets.clients)client.terminate();await new Promise(r=>sockets.close(r));await new Promise(r=>server.close(r));}
const file=path.join(folder,'capture-action-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(file);process.exitCode=report.passed?0:1;
