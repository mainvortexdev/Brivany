/* Isolated unpacked extension only. Never opens or controls a user profile. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require('../../motion-studio/node_modules/playwright-core'),{wsServer:WebSocketServer}=require('../../motion-studio/node_modules/playwright-core/lib/utilsBundle.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),extension=path.join(root,'browser-extension'),folder=path.join(root,'tmp/extension-sync-buffer');
const brave=process.argv.includes('--brave');
await mkdir(folder,{recursive:true});const profile=await mkdtemp(path.join(folder,'edge-profile-'));
const report={type:'isolated_actual_unpacked_extension_registration_and_loopback_pairing',external_calls:0,paid_calls:0,user_profile_used:false,tabcapture_invoked:false,capture_authorization_verified:false,microphone:false,source_media_persisted:false,passed:false};
report.browser=brave?'Brave':'Edge';
let origin=null,context;const counts={pair:0,authenticate:0,origin_rejections:0};
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.end('Owned extension transport fixture');});const sockets=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
  if(!origin||req.headers.origin!==origin){counts.origin_rejections++;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,ws=>{
    ws.on('message',raw=>{
      const message=JSON.parse(String(raw));
      if(req.url==='/pair'&&message.type==='pair'&&message.code==='123456'){counts.pair++;ws.send(JSON.stringify({type:'paired',token:'owned-fixture-authorization-012345678901234567890123',websocket_url:`ws://127.0.0.1:${server.address().port}/sync`,expires_in:100,preferred_mode:'preproduction'}));}
      else if(req.url==='/sync'&&message.type==='authenticate'&&message.token==='owned-fixture-authorization-012345678901234567890123'){counts.authenticate++;ws.send(JSON.stringify({type:'authenticated',preferred_mode:'preproduction'}));}
      else ws.close(1008);
    });
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  context=await chromium.launchPersistentContext(profile,{...(brave?{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'}:{channel:'msedge'}),headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let worker=context.serviceWorkers().find(worker=>worker.url().startsWith('chrome-extension://'));
  if(!worker)worker=await context.waitForEvent('serviceworker',{predicate:worker=>worker.url().startsWith('chrome-extension://'),timeout:10000}).catch(()=>null);
  if(!worker){report.status='browser_did_not_load_unpacked_extension';report.manual_installation_pending=true;}
  else{
    const extensionURL=new URL(worker.url());origin=extensionURL.protocol+'//'+extensionURL.host;report.service_worker_registered=true;report.extension_origin=origin;
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error.message)));page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy/i.test(message.text()))errors.push('CSP blocked an extension resource');});
    await page.goto(origin+'/player.html?source=0');await page.locator('#pair-link').fill(`ws://127.0.0.1:${server.address().port}/pair#123456`);await page.locator('#pair').click();await page.waitForFunction(()=>document.querySelector('#pair-form').hidden,{timeout:5000});
    report.pair_ui_connected=true;report.preferred_mode_applied=await page.locator('#mode').inputValue()==='preproduction';
    report.session_cache_present=await page.evaluate(async()=>{const value=(await chrome.storage.session.get('brivany_sync_authorization')).brivany_sync_authorization;return !!value?.token&&value.expires_at>Date.now();});
    report.same_origin_authentication=await page.evaluate(async()=>{const cached=(await chrome.storage.session.get('brivany_sync_authorization')).brivany_sync_authorization;return new Promise(resolve=>{const socket=new WebSocket(cached.relay);socket.onopen=()=>socket.send(JSON.stringify({type:'authenticate',token:cached.token}));socket.onmessage=event=>{resolve(JSON.parse(event.data).type==='authenticated');socket.close();};socket.onerror=()=>resolve(false);setTimeout(()=>{resolve(false);socket.close();},3000);});});
    await page.close();const reopened=await context.newPage();await reopened.goto(origin+'/player.html?source=0');await reopened.waitForFunction(()=>document.querySelector('#pair-form').hidden,{timeout:4000});
    report.reopen_reused_authorization=counts.pair===1;report.csp_page_errors=errors;report.transport_counts=counts;report.passed=report.preferred_mode_applied&&report.session_cache_present&&report.same_origin_authentication&&report.reopen_reused_authorization&&!errors.length;
    report.status=report.passed?'passed_extension_loading_pairing_and_cache_without_capture':'extension_fixture_failed';
  }
}catch(error){report.error=String(error.message).slice(0,600);}
finally{await context?.close();for(const socket of sockets.clients)socket.terminate();await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve));}
const file=path.join(folder,'extension-load-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(file);process.exitCode=report.passed?0:1;
