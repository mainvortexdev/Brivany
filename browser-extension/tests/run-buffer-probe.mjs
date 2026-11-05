import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require('../../motion-studio/node_modules/playwright-core');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,report;
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const query=new URLSearchParams(),slowStart=process.argv.includes('--slow-voice-start'),denseVoice=process.argv.includes('--dense-voice');
  if(process.argv.includes('--preproduction'))query.set('mode','preproduction');
  if(process.argv.includes('--late-cue'))query.set('cue_at','7');
  if(slowStart)query.set('slow_voice_start','1');
  if(denseVoice)query.set('dense_voice','1');
  const durationOption=process.argv.find(value=>value.startsWith('--duration='))?.split('=')[1];
  const duration=Math.max(8,Math.min(40,Number(durationOption||(slowStart||denseVoice?12:9.5))));
  query.set('duration',duration);
  await page.goto(`http://127.0.0.1:${server.address().port}/browser-extension/tests/buffer-fixture.html?${query}`);await page.locator('#run').click();
  await page.waitForFunction(()=>window.report?.finished,null,{timeout:duration*1000+12000});report=await page.evaluate(()=>window.report);report.owned_test_background_throttling_disabled=true;
}catch(error){report={passed:false,error:String(error.message),external_calls:0};}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
const folder=path.join(root,'tmp/extension-sync-buffer');await mkdir(folder,{recursive:true});const file=path.join(folder,'probe-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(file);process.exitCode=report.passed?0:1;
