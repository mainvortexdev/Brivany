'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.env.BRIVANY_TEST_URL,scene='11111111-1111-4111-8111-111111111111',route='/api/spatial/scenes/'+scene+'/presentation',artifacts=path.resolve(__dirname,'../tmp/presentation-ui');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'block'}),page=await context.newPage(),errors=[],external=[],posts=[],checks=[];
    await context.route('**/*',request=>{if(new URL(request.request().url()).origin!==base){external.push(request.request().url());return request.abort();}return request.continue();});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname);});
    const ready=async()=>{await page.waitForFunction(()=>document.querySelector('#spatial-canvas')?.dataset.ready==='true');await page.locator('[data-presentation-title]').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('[data-presentation-notice]')?.textContent.includes('12 puntos') || document.querySelector('[data-presentation-notice]')?.textContent.includes('guardado'));};
    const notice=async text=>page.waitForFunction(text=>document.querySelector('[data-presentation-notice]')?.textContent===text,text);
    const stored=async()=>{const response=await page.request.get(base+route);assert.equal(response.status(),200);return response.json();};
    const point=name=>page.locator('[data-presentation-point-id]').filter({has:page.locator('.presentation-point-title',{hasText:name})});
    const add=async(name,note='',object='')=>{await page.locator('[data-presentation-label]').fill(name);await page.locator('[data-presentation-note]').fill(note);await page.locator('[data-presentation-object]').selectOption(object);await page.locator('[data-presentation-add]').click();await point(name).waitFor();};
    const save=async()=>{const response=page.waitForResponse(value=>new URL(value.url()).pathname===route && value.request().method()==='POST');await page.locator('[data-presentation-save]').click();const result=await (await response).json();assert.ok(result.persisted);await notice('Recorrido guardado en este equipo.');return result;};
    await page.goto(base+'/spaces?space='+scene);await ready();await page.locator('.spatial-presentation').evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});
    assert.equal(posts.length,0);assert.equal((await stored()).revision,0);assert.equal(await page.locator('[data-presentation-start]').isDisabled(),true);
    checks.push('opening the actual local WebGL scene reads an empty route without saving, moving geometry or contacting a model');
    await page.locator('[data-presentation-title]').fill('Visita sintética');await add('Vista general','Distribución de demostración.');
    await page.locator('#zoom-in').click();await page.locator('#zoom-in').click();await add('Sillón','Objeto de prueba.','chair');assert.equal((await stored()).revision,0);
    const initial=await save();assert.equal(initial.config.points.length,2);assert.equal(initial.scene_revision,1);assert.equal(initial.config.points[1].object_id,'chair');assert.notDeepEqual(initial.config.points[0].camera.position,initial.config.points[1].camera.position);
    await page.reload();await ready();await page.locator('.spatial-presentation').evaluate(element=>{for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});assert.equal(await page.locator('[data-presentation-point-id]').count(),2);assert.equal(await page.locator('[data-presentation-title]').inputValue(),'Visita sintética');
    checks.push('two authored points capture different actual camera poses and an optional object; explicit save and reload preserve them');
    await point('Sillón').getByRole('button',{name:'Subir',exact:true}).click();await point('Sillón').getByRole('button',{name:'Editar',exact:true}).click();await page.locator('[data-presentation-label]').fill('Detalle del sillón');await page.locator('[data-presentation-note]').fill('Punto renombrado.');await page.locator('[data-presentation-add]').click();
    await page.locator('#zoom-out').click();await point('Detalle del sillón').getByRole('button',{name:'Usar vista actual',exact:true}).click();const reordered=await save();assert.equal(reordered.revision,2);assert.equal(reordered.config.points[0].label,'Detalle del sillón');assert.notDeepEqual(reordered.config.points[0].camera.position,initial.config.points[1].camera.position);
    checks.push('rename, reorder and replacing a point with the current camera persist as a new route revision');
    const stale=await page.request.post(base+route,{headers:{Origin:base},data:{expected_revision:1,expected_scene_revision:1,config:initial.config}});assert.equal(stale.status(),409);
    const invalid=await page.request.post(base+route,{headers:{Origin:base},data:{expected_revision:2,expected_scene_revision:1,config:{...reordered.config,points:[{...reordered.config.points[0],note:'https://private.invalid'}]}}});assert.equal(invalid.status(),422);assert.equal((await stored()).revision,2);
    checks.push('stale route writers and URL notes are rejected without overwriting the saved route');
    const canvas=page.locator('#spatial-canvas canvas');await page.locator('[data-presentation-start]').click();await page.waitForFunction(()=>document.querySelector('.spatial-presentation')?.dataset.presentationActive==='true');assert.match(await page.locator('[data-presentation-stage-title]').textContent(),/Detalle del sillón/);assert.equal(await page.locator('[data-presentation-previous]').isDisabled(),true);await page.waitForTimeout(180);const first=hash(await canvas.screenshot());
    await page.locator('[data-presentation-next]').click();await page.waitForFunction(()=>document.querySelector('[data-presentation-stage-title]')?.textContent==='Vista general');await page.waitForTimeout(180);const second=hash(await canvas.screenshot());assert.notEqual(first,second);assert.equal(await page.locator('[data-presentation-next]').isDisabled(),true);
    await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('[data-presentation-stage-title]').textContent(),'Detalle del sillón');await page.keyboard.press('Escape');assert.equal(await page.locator('[data-presentation-stage]').isVisible(),false);
    checks.push('presentation moves the actual rendered camera between points with previous/next and keyboard controls without geometry writes');
    await point('Vista general').getByRole('button',{name:'Eliminar',exact:true}).click();const removed=await save();assert.equal(removed.revision,3);assert.equal(removed.config.points.length,1);
    const prohibited=posts.filter(path=>path!==route);assert.deepEqual(prohibited,[]);
    checks.push('removing a point persists independently; the entire route workflow posts only presentation metadata');
    fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'presentation-1440.png'),fullPage:true});
    for(const width of [320,390,768]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
    await page.setViewportSize({width:390,height:1100});await page.screenshot({path:path.join(artifacts,'presentation-390.png'),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    checks.push('route editing and presentation controls fit narrow and desktop layouts without page errors or external traffic');
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:'passed',scope:'Actual local scene viewer/WebGL, HTTP, persistent authored camera route and selection; generated fixture.',checks,screenshots:['tmp/presentation-ui/presentation-1440.png','tmp/presentation-ui/presentation-390.png']},null,2));await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
