// Real loopback HTTP and headless Edge, synthetic Recall/Google. Never joins a real call.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {recallFixture,URL as MEETING_URL} from '../workers/whatsapp/test/recall-fixture.js';
import {recallWebhook} from '../workers/whatsapp/meetings/service.js';
const require=createRequire(import.meta.url),{chromium}=require('../motion-studio/node_modules/playwright-core');
const root=resolve(import.meta.dirname,'..'),out=join(root,'tmp/recall-ui'),f=await recallFixture(),originalFetch=globalThis.fetch,errors=[],checks=[],external=[];
const assets=new Map([['/meetings',['meetings.html','text/html']],['/meetings.css',['meetings.css','text/css']],['/meetings.js',['meetings.js','text/javascript']],['/typography.css',['typography.css','text/css']]]);
// Production app code uses fetch for Recall/Google. This fixture blocks every external request.
globalThis.fetch=f.fetcher;
const server=createServer(async(req,res)=>{
 try{
  const url=new globalThis.URL(req.url,'http://127.0.0.1');let response;
  if(url.pathname.startsWith('/api/integrations/meetings/')){
   const action=url.pathname.split('/').at(-1),paths={list:'',launch:'',calendar:'/calendar',schedule:'/schedule',cancel:'/cancel',detail:'/detail'};
   const parts=[];for await(const part of req)parts.push(part);const body=parts.length?JSON.parse(Buffer.concat(parts)):undefined;
   response=await f.invoke(paths[action]+url.search,body);
  }else if(url.pathname==='/webhooks/recall'){
   const parts=[];for await(const part of req)parts.push(part);response=await recallWebhook(new Request('https://ia.vetsa.es/webhooks/recall',{method:'POST',headers:req.headers,body:Buffer.concat(parts)}),f.env);
  }else{
   let asset=assets.get(url.pathname);if(url.pathname.startsWith('/fonts/')&&/^\/fonts\/[A-Za-z0-9._-]+$/.test(url.pathname))asset=[url.pathname.slice(1),url.pathname.endsWith('.woff2')?'font/woff2':'application/octet-stream'];
   if(!asset){res.writeHead(404);res.end();return;}
   const bytes=await readFile(join(root,'web',asset[0]));res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'"});res.end(bytes);return;
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));await f.drain();
 }catch(error){errors.push(error.message);res.writeHead(500);res.end('{}');}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
 await mkdir(out,{recursive:true});browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1100,height:920},acceptDownloads:true});page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new globalThis.URL(route.request().url()).origin===base?route.continue():(external.push(route.request().url()),route.abort()));
 await page.goto(base+'/meetings');await page.getByText('Aquí aparecerán las reuniones').waitFor();checks.push('real loopback application loads the existing authenticated app route');
 await page.locator('#meeting-url').fill(MEETING_URL);await page.locator('#meeting-title').fill('Revisión de producto');await page.locator('#consent').check();await page.locator('#launch').click();await page.getByRole('heading',{name:'Revisión de producto'}).waitFor();assert.equal(await page.locator('#meeting-url').inputValue(),'');assert.equal(await page.locator('#consent').isChecked(),false);checks.push('launch form sends a durable bot request and clears only after acceptance');
 async function deliver(event){const request=f.signed(event);const response=await originalFetch(base+'/webhooks/recall',{method:'POST',headers:Object.fromEntries(request.headers),body:await request.text()});assert.equal(response.status,200);await f.drain();await page.locator('#refresh').click();}
 await deliver('bot.in_waiting_room');await page.getByText('En sala de espera',{exact:true}).waitFor();await deliver('recording.done');await page.getByText('Transcribiendo',{exact:true}).waitFor();await deliver('transcript.done');await page.getByText('Transcripción lista',{exact:true}).waitFor();checks.push('signed lifecycle and artifact callbacks update the visible meeting state');
 await page.getByRole('button',{name:'Leer transcripción'}).click();await page.getByText('Acuerdo sintético de la reunión.').waitFor();const download=page.waitForEvent('download');await page.locator('#download-transcript').click();const file=await download;await file.saveAs(join(out,'synthetic-transcript.txt'));assert.match(await readFile(join(out,'synthetic-transcript.txt'),'utf8'),/Acuerdo sintético/);await page.locator('#close-transcript').click();checks.push('persisted transcript is readable in the modal and exports as text');
 await page.locator('#load-calendar').click();const selection=page.getByRole('checkbox',{name:'Enviar a Melodi a Reunión sintética'});await selection.waitFor();assert.equal(await selection.isChecked(),false);await selection.check();await page.getByText('Programada',{exact:true}).waitFor();await selection.uncheck();await page.getByText('Cancelada',{exact:true}).waitFor();checks.push('calendar selection alone authorizes a future bot; unselecting cancels it');
 assert.equal(await page.locator('#error').isVisible(),false);await page.waitForTimeout(450);await page.screenshot({path:join(out,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(out,'mobile.png'),fullPage:true});checks.push('desktop and narrow layout remain usable without horizontal overflow');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);const report={passed:true,mode:'real_loopback_http_headless_edge_synthetic_providers',checks,real_meetings_joined:0,external_provider_calls:0};await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;f.db.sql.close();}
