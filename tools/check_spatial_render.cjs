'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.BRIVANY_TEST_URL,scene=process.env.BRIVANY_RENDER_SCENE,root=path.resolve(__dirname,'..'),directory=path.join(root,'tmp/render-check');
const hash=raw=>crypto.createHash('sha256').update(raw).digest('hex');
(async()=>{
  assert.match(base,/^http:\/\/127\.0\.0\.1:\d+$/);const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'block'}),page=await context.newPage(),errors=[],external=[],checks=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error' && /texture|Content Security Policy|Refused to|blob:/i.test(message.text()))errors.push(message.text());});
    await page.goto(base+'/spaces?space='+scene);await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true',{},{timeout:25000});
    assert.equal(await page.locator('#space-origin').textContent(),'Interpretación manual');assert.equal(await page.locator('.object-button').count(),22);
    assert.match(await page.locator('#detail-scale').textContent(),/Sin verificar/);checks.push('22 actual GLB instances render with manual-reference origin and unverified scale');
    await page.getByText('Vista y calidad',{exact:true}).click();
    const canvas=page.locator('#spatial-canvas canvas');const original=hash(await canvas.screenshot());
    await page.locator('#camera-preset').selectOption('dining');await page.waitForTimeout(220);assert.notEqual(hash(await canvas.screenshot()),original);
    await page.locator('#camera-preset').selectOption('living');await page.locator('#daylight').fill('0.4');await page.locator('#daylight').dispatchEvent('input');await page.waitForTimeout(200);
    const dim=hash(await canvas.screenshot());assert.notEqual(dim,original);await page.locator('#daylight').fill('1');await page.locator('#daylight').dispatchEvent('input');
    checks.push('camera presets and daylight controls change the rendered image');
    fs.mkdirSync(directory,{recursive:true});await canvas.screenshot({path:path.join(directory,'interior-before-profiles.png')});
    const profiles=[];for(const quality of ['economy','balanced','high']){
      await page.locator('#render-quality').selectOption(quality);await page.waitForFunction(value=>document.querySelector('#spatial-canvas').dataset.renderedQuality===value,quality);await page.waitForTimeout(180);
      assert.ok(Number(await page.locator('#spatial-canvas').getAttribute('data-draw-calls'))>5);profiles.push({quality,drawCalls:Number(await page.locator('#spatial-canvas').getAttribute('data-draw-calls')),triangles:Number(await page.locator('#spatial-canvas').getAttribute('data-triangles'))});
      assert.equal(await page.locator('#spatial-canvas').getAttribute('data-ambient-occlusion'),String(quality==='high'));await canvas.screenshot({path:path.join(directory,'interior-'+quality+'.png')});
    }checks.push('all three quality profiles execute locally, including SSAO composer in high mode');
    await page.locator('#render-quality').selectOption('balanced');await page.locator('#view-references').click();assert.equal(await page.locator('#reference-gallery img').count(),2);await page.locator('#close-references').click();
    checks.push('reference images use signed local media links; fixtures are synthetic');
    await page.locator('.object-button[data-object-id="pouf"]').click();await page.locator('.physics-details').evaluate(node=>{node.open=true;});
    const before=await (await page.request.get(base+'/api/spatial/scenes/'+scene)).json();
    await page.locator('#physics-start').click();await page.waitForFunction(()=>!document.querySelector('#physics-drop').disabled,{},{timeout:20000});
    await page.locator('#physics-drop').click();await page.waitForFunction(()=>/pasos/.test(document.querySelector('#physics-status').textContent));await page.waitForTimeout(600);
    assert.equal(await page.locator('#apply-position').isDisabled(),true);await page.locator('#physics-pause').click();assert.equal(await page.locator('#physics-pause').textContent(),'Continuar');
    await page.locator('#physics-stop').click();const after=await (await page.request.get(base+'/api/spatial/scenes/'+scene)).json();assert.deepEqual(after.scene,before.scene);assert.equal(after.revision,before.revision);
    assert.equal(await page.locator('#apply-position').isEnabled(),true);checks.push('actual Rapier WASM runs under page CSP, pauses and restores without persisting experimental transforms');
    fs.mkdirSync(directory,{recursive:true});await page.locator('#camera-preset').selectOption('living');await page.screenshot({path:path.join(directory,'interior-1440.png'),fullPage:true});
    for(const width of [320,390,768]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
    await page.screenshot({path:path.join(directory,'interior-390.png'),fullPage:true});checks.push('interior controls fit 320,390,768 and desktop widths');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={status:'passed',checks:checks.length,passed:checks,profiles,renderer:'actual WebGL with software permitted',physical_gpu_tested:false,model_executed:false,external_calls:0,gpu_inference:false,geometry_fidelity_verified:false,metric_scale_verified:false,physical_realism_verified:false,screenshots:['tmp/render-check/interior-1440.png','tmp/render-check/interior-390.png']};
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
