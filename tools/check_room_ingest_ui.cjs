'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,capture=process.env.BRIVANY_ROOM_CAPTURE,job=process.env.BRIVANY_ROOM_JOB,scene=process.env.BRIVANY_ROOM_SCENE;
const assetHash=process.env.BRIVANY_ROOM_ASSET_SHA256,artifacts=path.resolve(__dirname,'../tmp/room-ingest-ui');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage(),external=[],errors=[],checks=[],requests=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
    await page.goto(base+'/spaces?space='+capture);await page.waitForFunction(()=>document.querySelector('#capture-panel').dataset.complete==='true');
    assert.equal(requests.filter(item=>item.url.endsWith('/room-results')).length,0);
    await page.locator('#reconstruction-results summary').click();
    await page.locator('#reconstruction-results > button').click();
    const row=page.locator('.reconstruction-result[data-result-kind="room"]');await row.getByRole('button',{name:'Añadir al visor →',exact:true}).waitFor();
    assert.match(await row.textContent(),/escala, cobertura y objetos sin verificar/);
    checks.push('room results are queried only by explicit action and identify the partial unverified surface scope');
    // A broken object-results route must leave the valid room result usable.
    await page.route('**/api/spatial/captures/'+capture+'/results',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Object results unavailable in this test'}})}));
    await page.locator('#reconstruction-results > button').click();await page.waitForFunction(()=>document.querySelector('#reconstruction-results [role=status]').textContent.includes('Una consulta no está disponible'));
    assert.equal(await row.count(),1);assert.equal(await row.getByRole('button',{name:'Añadir al visor →',exact:true}).isEnabled(),true);
    checks.push('unavailable object pipeline does not hide or disable the room result');
    fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'result-1440.png'),fullPage:true});
    const importResponse=page.waitForResponse(response=>response.url().endsWith('/room-dispatch/'+job+'/import'));
    await row.getByRole('button',{name:'Añadir al visor →',exact:true}).click();const imported=await (await importResponse).json();
    assert.equal(imported.import.provider_invoked,false);assert.equal(imported.import.duplicate,false);assert.equal(imported.scene.scene.origin,'room_reconstruction');
    await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true');
    assert.equal(new URL(page.url()).searchParams.get('space'),scene);assert.equal(await page.locator('.object-button').count(),1);
    await page.locator('.object-button[data-object-id="room-surface"]').click();assert.equal(await page.locator('#selected-lock').textContent(),'Fijo');
    assert.equal(await page.locator('#mode-move').isDisabled(),true);assert.equal(await page.locator('#physics-start').isDisabled(),true);
    assert.equal(await page.locator('#spatial-canvas').getAttribute('data-color-mode'),'captured-unlit');assert.equal(await page.locator('#daylight').isDisabled(),true);
    await page.getByText('Vista y calidad',{exact:true}).click();
    assert.equal(await page.locator('#camera-preset').inputValue(),'');assert.equal(await page.locator('#camera-preset option').count(),3);
    await page.locator('#render-quality').selectOption('high');await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.renderedQuality==='high');
    assert.equal(await page.locator('#spatial-canvas').getAttribute('data-ambient-occlusion'),'false');
    await page.locator('#render-quality').selectOption('balanced');
    assert.match(await page.locator('#camera-preset option[value="room-frame-0001"]').textContent(),/estimada/);
    await page.locator('#camera-preset').selectOption('room-frame-0001');await page.locator('#camera-preset').selectOption('');
    assert.match(await page.locator('#scene-limitations').textContent(),/solapamientos, duplicados y huecos/);
    checks.push('import renders captured vertex colors without extra lighting; estimated source cameras and free view work, with fixed geometry and no physics or object editing');
    const current=await (await page.request.get(base+'/api/spatial/scenes/'+scene)).json();
    assert.equal(current.scene.reconstruction.cameras.length,2);assert.equal(current.scene.reconstruction.holes_filled,false);assert.equal(current.scene.reconstruction.cross_view_fusion,false);
    assert.equal(current.scene.reconstruction.metric_scale_verified,false);assert.equal(current.scene.reconstruction.physical_realism_verified,false);
    assert.equal(current.source_views.scope,'capture_frames_not_photo_registration');assert.deepEqual(current.source_views.frames.map(frame=>frame.id),['frame-0000','frame-0001']);
    await page.getByRole('button',{name:'Ver fotogramas de captura ↗',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('#reference-gallery img').length===2 && [...document.querySelectorAll('#reference-gallery img')].every(image=>image.complete && image.naturalWidth===8 && image.naturalHeight===6));
    assert.match(await page.locator('#reference-gallery').textContent(),/cámara estimada, encuadre sin alinear/);
    for(const frame of current.source_views.frames){const image=await page.request.get(base+frame.url);assert.equal(image.status(),200);assert.equal(sha(await image.body()),frame.sha256);}
    await page.getByRole('button',{name:'Cerrar referencias',exact:true}).click();
    const asset=current.asset_urls['room-surface'],raw=await page.request.get(base+asset);assert.equal(raw.status(),200);assert.equal(sha(await raw.body()),assetHash);
    assert.equal((await page.request.get(base+asset.split('?')[0])).status(),403);
    checks.push('signed mesh and source JPEG hashes match; both source frames load in the review gallery with estimated, unaligned camera labels and preserved uncertainty');
    await page.locator('.space-item[data-space-id="'+capture+'"]').click();await page.waitForFunction(()=>document.querySelector('#capture-panel').dataset.complete==='true' && !document.querySelector('#capture-panel').hidden);
    if(!await page.locator('#reconstruction-results').evaluate(node=>node.open))await page.locator('#reconstruction-results summary').click();
    await page.locator('#reconstruction-results > button').click();await page.getByRole('button',{name:'Abrir superficie ↗',exact:true}).waitFor();
    const duplicateResponse=page.waitForResponse(response=>response.url().endsWith('/room-dispatch/'+job+'/import'));
    await page.getByRole('button',{name:'Abrir superficie ↗',exact:true}).click();assert.equal((await (await duplicateResponse).json()).import.duplicate,true);
    await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true');
    const reopened=await (await page.request.get(base+'/api/spatial/scenes/'+scene)).json();assert.equal(reopened.revision,1);assert.deepEqual(reopened.scene.reconstruction,current.scene.reconstruction);
    checks.push('reopening the same room receipt preserves one scene, its original revision and all camera provenance');
    await page.locator('#scene-details').evaluate(node=>node.open=true);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-space').click()]);
    assert.equal(fs.readFileSync(await download.path()).subarray(0,2).toString(),'PK');
    await page.screenshot({path:path.join(artifacts,'surface-1440.png'),fullPage:true});
    await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:path.join(artifacts,'surface-390.png'),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(requests.filter(item=>item.method==='POST' && item.url.endsWith('/import')).length,2);
    checks.push('the surface exports as a local ZIP and the desktop/mobile-width browser journey has no page errors or external requests');
    const report={status:'passed',scope:'Actual local browser, HTTP, SQLite, generated multiview GLB, WebGL and ZIP; Modal SDK and model output substituted.',checks,
      external_calls:0,gpu_inference:false,real_reconstruction_verified:false,geometry_fidelity_verified:false,metric_scale_verified:false,physical_realism_verified:false,physical_devices_tested:false,
      screenshots:['tmp/room-ingest-ui/result-1440.png','tmp/room-ingest-ui/surface-1440.png','tmp/room-ingest-ui/surface-390.png']};
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
