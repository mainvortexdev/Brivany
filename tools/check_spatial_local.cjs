/* Read-only check of the installed local viewer. No mutation, cloud or microphone. */
'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base='http://127.0.0.1:8765',root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
    const blocked=[],errors=[];
    await context.route('**/*',route=>{
      const request=route.request();if(new URL(request.url()).origin!==base || request.method()!=='GET'){
        blocked.push({method:request.method(),origin:new URL(request.url()).origin});return route.abort();
      }return route.continue();
    });
    await context.addInitScript(()=>{window.__spatialLocalMic=0;if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.__spatialLocalMic++;throw Error('No capture expected.');}});});
    page.on('pageerror',error=>errors.push(error.message));
    const response=await page.goto(base+'/spaces');assert.equal(response.status(),200);
    await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true',{},{timeout:15000});
    assert.ok(Number(await page.locator('#spatial-canvas').getAttribute('data-draw-calls'))>5);
    assert.match(await page.locator('#space-origin').textContent(),/Demostración/);
    assert.equal(await page.locator('.object-button').count(),4);
    await page.locator('[data-object-id="chair"]').click();
    assert.equal(await page.locator('#selected-label').textContent(),'Sillón');
    assert.equal(await page.locator('#mode-move').isEnabled(),true);
    const directory=path.join(root,'tmp/ui');fs.mkdirSync(directory,{recursive:true});
    await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(120);
    await page.screenshot({path:path.join(directory,'spatial-local-1440.png'),fullPage:true});
    await page.setViewportSize({width:390,height:1000});await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:path.join(directory,'spatial-local-390.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/');
    assert.match(await page.locator('h1').textContent(),/Tu espacio/);
    await page.locator('.spatial-preview img').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.spatial-preview img').complete && document.querySelector('.spatial-preview img').naturalWidth>0);
    await page.screenshot({path:path.join(directory,'landing-spatial-1440.png'),fullPage:true});
    await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:path.join(directory,'landing-spatial-390.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>window.__spatialLocalMic),0);assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
    const report={checked_at:new Date().toISOString(),status:'passed',api:'installed_real_local',renderer:'WebGL with software permitted',
      mutations:0,external_calls:0,model_inference:false,microphone_requests:0,scene_origin:'generated_demo',objects:4,
      javascript_errors:errors,public_landing_checked:true,screenshots:['tmp/ui/spatial-local-1440.png','tmp/ui/spatial-local-390.png','tmp/ui/landing-spatial-1440.png','tmp/ui/landing-spatial-390.png'],
      limitations:['Only local installation rendering/selection and layout tested. Demo geometry is procedural. No GPU model, scale, physics or physical mobile device was validated.']};
    fs.writeFileSync(path.join(directory,'spatial-local.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
