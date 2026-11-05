/* Real HTTP backend and browser; only provider inference is substituted. */
'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,fixtures=process.env.BRIVANY_SOUS_FIXTURES,artifacts=process.env.BRIVANY_SOUS_ARTIFACTS;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base || '') || !fixtures || !artifacts)throw Error('Run python -m tools.check_sous_pipeline.');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],external=[],checks=[],uploads=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.method()==='POST' && request.url().includes('/vision/'))uploads.push({url:request.url(),headers:request.headers(),bytes:request.postDataBuffer()?.length || 0});});
    await context.addInitScript(()=>{window.__cameraRequests=0;if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.__cameraRequests++;throw Error('No camera expected.');}});});
    await page.setViewportSize({width:1440,height:1050});assert.equal((await page.goto(base+'/sous')).status(),200);
    await page.waitForFunction(()=>document.querySelector('#vision-status').textContent.includes('disponible'));
    assert.equal(uploads.length,0);checks.push('opening the page makes no image/provider request');
    await page.locator('.vision-panel').evaluate(element=>element.open=true);
    await page.locator('#inventory-vision-file').setInputFiles(path.join(fixtures,'frame-1.png'));
    await page.locator('#inventory-vision-send').click();assert.match(await page.locator('#inventory-vision-error').textContent(),/Autoriza/);assert.equal(uploads.length,0);
    await page.locator('#inventory-vision-consent').check();await page.locator('#inventory-vision-send').click();
    await page.waitForFunction(()=>document.querySelectorAll('.vision-candidate').length===1);
    assert.match(await page.locator('#inventory-vision-message').textContent(),/simulada/);
    assert.match(await page.locator('#inventory').textContent(),/Empieza por/);
    await page.getByRole('button',{name:'Revisar cantidad',exact:true}).click();assert.equal(await page.locator('#item-quantity').inputValue(),'');
    assert.equal(await page.locator('#item-confirmed').isChecked(),false);
    await page.locator('#item-quantity').fill('4');await page.locator('#item-confirmed').check();await page.locator('#save-item').click();
    await page.waitForFunction(()=>!document.querySelector('#item-dialog').open);
    assert.match(await page.locator('#inventory').textContent(),/Huevos/);assert.match(await page.locator('#inventory').textContent(),/Confirmado por ti/);
    checks.push('consent-gated image gives candidates; user supplies quantity and confirms before inventory changes');
    await page.locator('#add-item').click();await page.locator('#item-label').fill('Verduras');await page.locator('#item-quantity').fill('400');await page.locator('#item-unit').selectOption('g');await page.locator('#save-item').click();await page.waitForFunction(()=>!document.querySelector('#item-dialog').open);
    await page.locator('#plan-meal').click();await page.waitForFunction(()=>!document.querySelector('#start-session').hidden);
    await page.screenshot({path:path.join(artifacts,'inventory-1440.png'),fullPage:true});
    await page.locator('#start-session').click();await page.waitForFunction(()=>!document.querySelector('#cooking-view').hidden);
    await page.locator('#observation').fill('Preparación revisada por mí en la prueba local.');await page.locator('[name=verdict][value=ready]').check();await page.locator('#human-confirmed').check();await page.locator('#verify-step').click();await page.waitForFunction(()=>document.querySelector('#step-title').textContent==='Cocinar verduras');
    assert.match(await page.locator('#session-mode').textContent(),/humana/);checks.push('manual inventory, curated plan and explicit human step verification use the real service');
    await page.locator('.cooking-vision').evaluate(element=>element.open=true);
    await page.locator('#evidence-file').setInputFiles(path.join(fixtures,'frame-1.png'));await page.waitForFunction(()=>!document.querySelector('#evidence-preview').hidden);
    await page.locator('#cooking-vision-send').click();assert.match(await page.locator('#cooking-vision-error').textContent(),/Autoriza/);
    await page.locator('#cooking-vision-consent').check();await page.locator('#cooking-vision-send').click();
    await page.waitForFunction(()=>document.querySelector('#session-mode').textContent.includes('simulado'));
    assert.equal(await page.locator('#step-title').textContent(),'Cocinar verduras');
    assert.match(await page.locator('#cooking-vision-message').textContent(),/paso sigue abierto/);
    await page.locator('#evidence-file').setInputFiles(path.join(fixtures,'frame-2.png'));await page.waitForFunction(()=>!document.querySelector('#evidence-preview').hidden);
    await page.locator('#cooking-vision-consent').check();await page.locator('#cooking-vision-send').click();
    await page.waitForFunction(()=>document.querySelector('#step-title').textContent==='Añadir huevos');
    assert.match(await page.locator('#session-mode').textContent(),/simulado/);checks.push('two distinct substituted Meta readings advance one step and remain visibly simulated');
    await page.locator('.session-ledger').evaluate(element=>element.open=true);assert.match(await page.locator('#observations-list').textContent(),/Revisión humana/);assert.match(await page.locator('#observations-list').textContent(),/simulado/);
    assert.equal(uploads.length,3);for(const upload of uploads){assert.equal(upload.headers['x-brivany-consent'],'true');assert.equal(upload.headers['content-type'],'image/jpeg');assert.ok(upload.bytes>0 && upload.bytes<=2*1024*1024);}
    await page.screenshot({path:path.join(artifacts,'cooking-1440.png'),fullPage:true});await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(artifacts,'cooking-390.png'),fullPage:true});checks.push('mobile layout fits viewport and source labels stay readable');
    assert.equal(await page.evaluate(()=>window.__cameraRequests),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    const report={status:'passed',scope:'Real browser + HTTP Handler + persistent Sous, with explicitly simulated vision providers.',checks,image_uploads:uploads.length,external_browser_requests:0,camera_requests:0,model_executed:false,real_meta_api_calls:0};
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
