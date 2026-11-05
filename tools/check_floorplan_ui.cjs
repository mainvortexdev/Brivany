'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,interior=process.env.BRIVANY_PLAN_INTERIOR,demo='11111111-1111-4111-8111-111111111111',artifacts=path.resolve(__dirname,'../tmp/floorplan-ui');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage(),external=[],errors=[],checks=[],plans=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));page.on('response',async response=>{if(response.url().endsWith('/floorplan') && response.ok())plans.push(await response.json());});
    await page.goto(base+'/spaces?space='+demo);await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true');assert.equal(plans.length,0);
    const sceneBefore=await (await page.request.get(base+'/api/spatial/scenes/'+demo)).json();
    await page.locator('#view-plan').click();await page.waitForFunction(()=>document.querySelector('#floorplan-canvas').dataset.ready==='true');
    assert.equal(await page.locator('#spatial-canvas').isVisible(),false);assert.equal(await page.locator('#floorplan-canvas svg').isVisible(),true);assert.match(await page.locator('#floorplan-status').textContent(),/relativas|no métrico/);
    assert.equal(plans[0].scale.metric_scale_verified,false);assert.equal(plans[0].scale.meters_per_unit,null);assert.ok(await page.locator('#floorplan-canvas [data-object-id]').count()>2);
    const sceneAfter=await (await page.request.get(base+'/api/spatial/scenes/'+demo)).json();assert.equal(sceneAfter.revision,sceneBefore.revision);assert.deepEqual(sceneAfter.scene,sceneBefore.scene);
    checks.push('plan is generated from actual saved GLB geometry only on request, keeps relative units and does not mutate the scene');
    await page.locator('#floorplan-canvas [data-object-id="chair"]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#selected-label').textContent(),'Sillón');assert.equal(await page.locator('.object-button[data-object-id="chair"]').getAttribute('aria-pressed'),'true');
    await page.locator('.object-button[data-object-id="table"]').click();assert.equal(await page.locator('#floorplan-canvas [data-object-id="table"]').getAttribute('aria-pressed'),'true');
    await page.locator('#view-three').click();assert.equal(await page.locator('#spatial-canvas').isVisible(),true);assert.equal(await page.locator('.object-button[data-object-id="table"]').getAttribute('aria-pressed'),'true');await page.locator('#view-plan').click();
    checks.push('SVG keyboard selection, object inspector and 3D selection stay synchronized');
    let box=await page.locator('#floorplan-canvas svg').getAttribute('viewBox');await page.locator('#zoom-in').click();assert.notEqual(await page.locator('#floorplan-canvas svg').getAttribute('viewBox'),box);await page.locator('#reset-view').click();assert.equal(await page.locator('#floorplan-canvas svg').getAttribute('viewBox'),box);
    await page.locator('#floorplan-details').evaluate(node=>node.open=true);
    async function pick(points){
      await page.locator('#plan-pick-reference').click();await page.locator('#floorplan-canvas').scrollIntoViewIfNeeded();
      for(const point of points){const screen=await page.locator('#floorplan-canvas svg').evaluate((node,point)=>{const value=node.createSVGPoint();value.x=point[0];value.y=point[1];const result=value.matrixTransform(node.getScreenCTM());return {x:result.x,y:result.y};},point);await page.mouse.click(screen.x,screen.y);}
      await page.waitForFunction(()=>!document.querySelector('#plan-add-reference').disabled);
    }
    await pick([[-1,0],[1,0]]);await page.locator('#plan-measured-length').fill('2');await page.locator('#plan-measure-note').fill('Medida sintética de prueba · tramo A');await page.locator('#plan-add-reference').click();await page.waitForFunction(()=>document.querySelectorAll('#plan-references li').length===1 || !document.querySelector('#spatial-error').hidden);assert.equal(await page.locator('#plan-references li').count(),1,await page.locator('#spatial-error').textContent());
    assert.match(await page.locator('#floorplan-status').textContent(),/declarada/);assert.match(await page.locator('#plan-calibration-note').textContent(),/sola medida/);assert.equal(plans.at(-1).scale.rms_residual_m,null);assert.equal(plans.at(-1).scale.metric_scale_verified,false);
    await pick([[0,-1],[0,1]]);await page.locator('#plan-measured-length').fill('3');await page.locator('#plan-measure-note').fill('Medida sintética de prueba · tramo B');
    const calibratedResponse=page.waitForResponse(response=>response.url().endsWith('/floorplan') && response.request().postDataJSON()?.references?.length===2);
    await page.locator('#plan-add-reference').click();await page.waitForFunction(()=>document.querySelectorAll('#plan-references li').length===2);const calibrated=await (await calibratedResponse).json();
    assert.ok(calibrated.scale.rms_residual_m>0,JSON.stringify(calibrated.scale));assert.equal(calibrated.scale.metric_scale_verified,false);assert.match(await page.locator('#plan-calibration-note').textContent(),/no precisión/);
    checks.push('two picked reference spans fit declared scale and expose disagreement residuals without marking metric verification');
    await page.locator('#plan-save').click();await page.waitForFunction(()=>document.querySelector('#plan-save-status').textContent==='Configuración guardada en el proyecto.');
    await page.reload();await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true');await page.locator('#view-plan').click();await page.waitForFunction(()=>document.querySelector('#floorplan-canvas').dataset.ready==='true');assert.equal(await page.locator('#plan-references li').count(),2);assert.equal(plans.at(-1).scale.metric_scale_verified,false);await page.locator('#floorplan-details').evaluate(node=>node.open=true);
    checks.push('explicit save preserves declared reference settings across a full reload without changing the scene or claiming independent validation');
    const downloaded=page.waitForEvent('download');await page.locator('#plan-export').click();const download=await downloaded,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const svg=Buffer.concat(chunks).toString('utf8');
    assert.match(svg,/brivany-floorplan-svg-1/);assert.match(svg,/architectural_accuracy_verified[^<]*false/);assert.match(svg,/Medida sintética de prueba/);assert.equal(/<script|onload=|https?:\/\//i.test(svg.replace('http://www.w3.org/2000/svg','')),false);
    checks.push('SVG download is self-contained and carries revision, origin, declared scale and uncertainty');
    await page.locator('.object-button[data-object-id="chair"]').click();const old=Number(await page.locator('#position-x').inputValue());await page.locator('#position-x').fill(String(old+.4));await page.locator('#apply-position').click();await page.waitForFunction(previous=>document.querySelector('#floorplan-status').textContent.includes('revisión '+(previous+1)),sceneBefore.revision);
    const latest=await (await page.request.get(base+'/api/spatial/scenes/'+demo)).json();assert.equal(plans.at(-1).scene_revision,latest.revision);assert.equal(plans.at(-1).objects.find(item=>item.id==='chair').id,'chair');
    checks.push('numeric editing persists a real scene revision and recomputes the plan from saved transforms');
    const canonical=await page.request.get(base+'/api/spatial/scenes/'+demo+'/floorplan');assert.equal(canonical.status(),200);
    fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'plan-1440.png'),fullPage:true});
    for(const width of [320,390,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
    await page.screenshot({path:path.join(artifacts,'plan-390.png'),fullPage:true});checks.push('plan controls fit desktop and 320/390/768 pixel layouts');
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/spaces?space='+interior);await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true');await page.locator('#view-plan').click();await page.waitForFunction(()=>document.querySelector('#floorplan-canvas').dataset.ready==='true');
    assert.match(await page.locator('#floorplan-canvas svg').textContent(),/Interpretación manual/);assert.match(await page.locator('#floorplan-status').textContent(),/relativas/);assert.equal(await page.locator('#plan-references li').count(),0);checks.push('manual-reference interior remains labeled unverified and switching scenes clears temporary calibration');
    await page.screenshot({path:path.join(artifacts,'interior-plan-1440.png'),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={status:'passed',scope:'Actual browser + HTTP + SQLite + GLB projection; generated geometry and synthetic measurement declarations.',checks,external_calls:0,model_executed:false,gpu_inference:false,architectural_accuracy_verified:false,metric_scale_verified:false,physical_devices_tested:false,screenshots:['tmp/floorplan-ui/plan-1440.png','tmp/floorplan-ui/plan-390.png','tmp/floorplan-ui/interior-plan-1440.png']};fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
