'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,demo='11111111-1111-4111-8111-111111111111',artifacts=path.resolve(__dirname,'../tmp/spatial-assistant');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),external=[],errors=[],posts=[],checks=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname);});
    await page.addInitScript(()=>{window.__micCalls=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{window.__micCalls++;throw Error('Microphone must not be opened in this text check');}});});
    const scene=async()=>await (await page.request.get(base+'/api/spatial/scenes/'+demo)).json();
    const post=async(route,value)=>await page.request.post(base+route,{headers:{Origin:base},data:value});
    const object=(value,id)=>value.scene.objects.find(item=>item.id===id);
    const open=async()=>{await page.goto(base+'/spaces?space='+demo);await page.waitForFunction(()=>document.querySelector('#spatial-canvas').dataset.ready==='true');await page.locator('#spatial-assistant').locator('..').evaluate(node=>node.open=true);await page.waitForFunction(()=>document.querySelector('[data-assistant-origin]').textContent.includes('simulado'));};
    const ask=async text=>{const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/spatial/assistant/command');await page.locator('[data-assistant-message]').fill(text);await page.locator('[data-assistant-form] button').click();return await response;};
    await open();assert.deepEqual(posts,[]);assert.equal(await page.evaluate(()=>window.__micCalls),0);
    await page.locator('[data-assistant-mic]').click();assert.match(await page.locator('[data-assistant-error]').textContent(),/Autoriza/);assert.equal(await page.evaluate(()=>window.__micCalls),0);
    checks.push('opening the real scene performs no POST/provider request and microphone requires explicit consent');
    const before=await scene();
    await ask('enfoca la mesa');await page.waitForFunction(()=>document.querySelector('#selected-label').textContent==='Mesa');assert.equal((await scene()).revision,1);
    await ask('selecciona el sillón');await page.waitForFunction(()=>document.querySelector('#selected-label').textContent==='Sillón');
    await ask('¿Cómo se llama este objeto?');await page.waitForFunction(()=>document.querySelector('[data-assistant-reply]').textContent.includes('Sillón'));
    assert.equal(posts.filter(value=>value.endsWith('/turn')).length,0);checks.push('select, focus and label identification use saved objects without model requests or edits');
    await ask('mueve selección a x 1,25 y 0 z -2,5');await page.waitForFunction(()=>!document.querySelector('[data-assistant-review]').hidden);
    assert.match(await page.locator('[data-assistant-preview]').textContent(),/unidades relativas/);assert.deepEqual(object(await scene(),'chair').transform,object(before,'chair').transform);
    await page.locator('[data-assistant-discard]').click();assert.equal(await page.locator('[data-assistant-review]').isVisible(),false);assert.equal((await scene()).revision,1);
    await ask('mueve selección a x 1,25 y 0 z -2,5');await page.waitForFunction(()=>!document.querySelector('[data-assistant-review]').hidden);
    const executed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/spatial/assistant/execute');await page.locator('[data-assistant-apply]').click();assert.equal((await executed).status(),200);
    await page.waitForFunction(()=>document.querySelector('#position-x').value==='1.25');const moved=await scene();assert.equal(moved.revision,2);assert.deepEqual(object(moved,'chair').transform.position,[1.25,0,-2.5]);
    await page.locator('#undo-edit').click();await page.waitForFunction(()=>document.querySelector('#position-x').value==='-1.2');const undone=await scene();assert.equal(undone.revision,3);assert.deepEqual(object(undone,'chair').transform,object(before,'chair').transform);
    checks.push('move review preserves relative units, discard has no effect, explicit apply saves one revision and existing Undo restores the original');
    await ask('mueve selección a x 2 y 0 z 1');await page.waitForFunction(()=>!document.querySelector('[data-assistant-review]').hidden);
    const changed=await post('/api/spatial/scenes/'+demo+'/transforms',{expected_revision:3,objects:[{id:'chair',transform:{position:[3,0,0]}}]});assert.equal(changed.status(),200);
    const stale=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/spatial/assistant/execute');await page.locator('[data-assistant-apply]').click();assert.equal((await stale).status(),409);
    await page.waitForFunction(()=>document.querySelector('[data-assistant-error]').textContent.includes('cambió'));assert.deepEqual(object(await scene(),'chair').transform.position,[3,0,0]);checks.push('a concurrent edit invalidates the reviewed command instead of overwriting a newer scene');
    await open();await page.locator('.object-button[data-object-id="table"]').click();
    await ask('Explica este objeto');await page.waitForFunction(()=>document.querySelector('[data-assistant-error]').textContent.includes('permiso'));assert.equal(posts.filter(value=>value.endsWith('/turn')).length,0);
    const forged=await post('/api/spatial/assistant/turn',{scene_id:demo,expected_revision:4,object_id:'table',text:'Explica',consent:true,context:{metric_verified:true}});assert.equal(forged.status(),422);
    await page.locator('[data-assistant-consent]').check();await ask('Explica este objeto');await page.waitForFunction(()=>document.querySelector('[data-assistant-reply]').textContent.includes('Etiqueta: Mesa. Procedencia: generated.')).catch(async error=>{throw Error(error.message+' '+JSON.stringify(await page.locator('#spatial-assistant').evaluate(node=>({reply:node.querySelector('[data-assistant-reply]').textContent,error:node.querySelector('[data-assistant-error]').textContent,state:node.dataset.state}))));});
    await page.waitForFunction(()=>document.querySelector('[data-assistant-stop]').disabled);assert.equal((await scene()).revision,4);
    checks.push('opt-in streamed conversation uses the current server-selected object, rejects forged context and never mutates geometry');
    fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'assistant-1440.png'),fullPage:true});
    for(const width of [320,390,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
    await page.setViewportSize({width:390,height:1000});await page.screenshot({path:path.join(artifacts,'assistant-390.png'),fullPage:true});checks.push('contextual text and review controls fit desktop and 320/390/768 pixel layouts');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(await page.evaluate(()=>window.__micCalls),0);
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:'passed',scope:'Real scene/HTTP/SQLite/browser text-assistant plumbing with simulated model.',checks,screenshots:['tmp/spatial-assistant/assistant-1440.png','tmp/spatial-assistant/assistant-390.png']},null,2));await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
