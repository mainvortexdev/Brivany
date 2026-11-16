'use strict';
// Real Edge pointer/touch dispatch and layout; file sender/receiver simulated.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('../motion-studio/node_modules/playwright-core'),safari=process.argv.includes('--webkit');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/drop-edge-ui'+(safari?'-webkit':''));
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await (safari?webkit:chromium).launch(safari?{headless:true}:{channel:'msedge',headless:true});
 const report={passed:false,mode:safari?'real_webkit_pointer_and_layout_simulated_transport':'real_edge_touch_and_layout_simulated_transport',external_calls:0,gpu_seconds:null,physical_phone:false,checks:[]};
 try{
  for(const width of [320,390,768]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());let name=({'/transfer/drop/':'drop.html','/transfer/drop/phone.css':'drop.css','/transfer/drop/locales.js':'drop-locales.js','/transfer/drop/edge.js':'drop-edge.js'})[url.pathname];
    if(url.pathname.endsWith('/phone.js'))return route.fulfill({contentType:'text/javascript',body:''});
    const file=url.pathname.endsWith('/peer.js')?path.join(root,'desktop/experience/drop-peer.js'):name?path.join(root,'workers/file-transfer/client',name):null;
    return file?route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)}):route.abort();
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://edge.test/transfer/drop/');
   await page.evaluate(()=>{
    window.offers=[];window.previews=[];window.failures=[];
    document.getElementById('heading').textContent='Conectado a tu PC.';document.getElementById('status').textContent='Listo para enviar o recibir.';
    window.selection=new BrivanyEdgeSelection({send:async file=>offers.push(file.name),preview:(active,count,edge)=>previews.push({active,count,edge}),canSend:()=>true,error:value=>failures.push(value)});
    selection.setEnabled(true);selection.stage([new File(['uno'],'Uno.txt'),new File(['dos'],'Dos.txt')]);
   });
   assert.equal(await page.locator('#edge-selection').isVisible(),true);
   assert.equal(await page.evaluate(()=>offers.length),0,'choosing files must not start a transfer');
   await page.locator('#edge-stack').scrollIntoViewIfNeeded();const box=await page.locator('#edge-stack').boundingBox();
   const start={x:box.x+box.width/2,y:Math.min(700,box.y+box.height/2)},cdp=safari?null:await context.newCDPSession(page);
   async function touch(type,x,y){
    if(cdp)return cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1}]});
    if(type==='touchStart'){await page.mouse.move(x,y);return page.mouse.down()}
    if(type==='touchMove')return page.mouse.move(x,y);
    if(type==='touchCancel')await page.keyboard.press('Escape');return page.mouse.up();
   }
   await touch('touchStart',start.x,start.y);await touch('touchMove',width-8,start.y);
   await page.waitForFunction(()=>document.querySelector('#edge-aura').dataset.active==='true');
   assert.equal(await page.evaluate(()=>previews.at(-1).count),2);
   if(width===390)await page.screenshot({path:path.join(out,'mobile-aura.png')});
   await touch('touchCancel');assert.equal(await page.evaluate(()=>offers.length),0);assert.equal(await page.locator('#edge-aura').getAttribute('data-active'),'false');
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('#edge-stack')).transform==='none');
   await touch('touchStart',start.x,start.y);await touch('touchMove',width-8,start.y);await touch('touchEnd');
   await page.waitForFunction(()=>offers.length===1);assert.equal(await page.evaluate(()=>offers[0]),'Uno.txt');
   await page.evaluate(()=>selection.next());assert.deepEqual(await page.evaluate(()=>offers),['Uno.txt','Dos.txt']);
   await page.evaluate(()=>selection.next());assert.equal(await page.locator('#edge-queue').isHidden(),true);
   await page.evaluate(()=>selection.stage([new File(['x'],'Accesible.txt')]));await page.locator('#send-selected').click();
   assert.equal(await page.evaluate(()=>offers.at(-1)),'Accesible.txt');await page.evaluate(()=>selection.next());
   await page.evaluate(()=>{
    try{selection.stage(Array.from({length:9},(_,i)=>new File(['x'],`${i}.txt`)))}catch(e){failures.push(e.message)}
    selection.stage([new File(['x'],'Seguro & literal.txt')]);
   });
   assert.equal(await page.locator('#edge-files img').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#edge-aura').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
   await page.evaluate(()=>{selection.remote({active:true,count:2,edge:'left'});selection.dispose()});
   assert.equal(await page.locator('#edge-aura').getAttribute('data-active'),'false');assert.deepEqual(errors,[]);
   report.checks.push(`${width}px: staging, ${safari?'real pointer edge release and Escape cancellation':'real touch edge release and pointer cancellation'}, two sequential files, Send button, limits, safe text, no overflow, reduced motion and cleanup`);
   await context.close();
  }
  report.passed=true;
 }catch(error){report.reason=String(error.stack).slice(0,2000);process.exitCode=1}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
})().catch(error=>{console.error(error);process.exitCode=1});
