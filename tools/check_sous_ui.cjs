/* Real browser and local assets, simulated API data. No food image recognition. */
'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'tmp/sous-ui');fs.mkdirSync(directory,{recursive:true});
const clone=value=>JSON.parse(JSON.stringify(value));
const uid=()=>crypto.randomUUID();
const recipe={id:'eggs-vegetables-v1',title:'Huevos con verduras',kind:'curated_preset',source:{kind:'authored_local',note:'Receta fija local.'},
  steps:[['prepare','Preparar','Prepara los ingredientes.','Verduras cortadas.'],['vegetables','Cocinar verduras','Remueve las verduras.','Verduras ablandadas.'],['eggs','Añadir huevos','Cocina los huevos.','Huevos cuajados.'],['finish','Terminar','Apaga el fuego.','Preparación servida.']].map(([id,label,instruction,criterion])=>({id,label,instruction,criterion}))};
function crc32(bytes){let crc=-1;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0;}
function png(value){
  const chunk=(name,data)=>{const kind=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data])));return Buffer.concat([size,kind,data,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.from([0,value,value,0,value,value]))),chunk('IEND',Buffer.alloc(0))]);
}
(async()=>{
  let items=[],events=[],sessions=new Map(),confirmations=0,posts=[],base;
  const server=http.createServer((request,response)=>{
    const send=(code,value)=>{response.writeHead(code,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
    const route=new URL(request.url,'http://127.0.0.1').pathname;
    if(request.method==='GET' && !route.startsWith('/api/')){
      const name=route==='/sous'?'sous.html':route.slice(1);if(!['sous.html','sous.css','sous.js','palette.css','icon.svg'].includes(name)){response.writeHead(404);response.end();return;}
      const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html';
      response.writeHead(200,{'Content-Type':type,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'"});response.end(fs.readFileSync(path.join(root,'web',name)));return;
    }
    if(request.method==='GET' && route==='/api/sous/inventory')return send(200,{items,events,summary:{needs_confirmation:items.filter(item=>!item.confirmed).length,unknown_expiry_count:items.filter(item=>!item.expiry_date).length}});
    const sessionGet=route.match(/^\/api\/sous\/sessions\/([0-9a-f-]+)$/);if(sessionGet && request.method==='GET')return send(sessions.has(sessionGet[1])?200:404,sessions.get(sessionGet[1]) || {message:'No disponible.'});
    let chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{
      try{
        const payload=JSON.parse(Buffer.concat(chunks).toString() || '{}');posts.push({route,payload:clone(payload)});
        if(route==='/api/sous/items'){
          if(payload.confidence<.6 && payload.confirmed)return send(422,{message:'Confirma por separado.'});
          const item={...payload,id:payload.id || uid()};items=items.filter(value=>value.id!==item.id);items.push(item);return send(200,item);
        }
        let match=route.match(/^\/api\/sous\/items\/([0-9a-f-]+)\/(confirm|events)$/);
        if(match){const item=items.find(value=>value.id===match[1]);assert.ok(item);
          if(match[2]==='confirm'){confirmations++;Object.assign(item,payload);return send(200,item);}
          item.quantity-=payload.amount;const event={...payload,item_id:item.id,id:uid()};events.push(event);return send(200,{item,event});
        }
        if(route==='/api/sous/plan'){
          const ready=items.some(item=>item.label==='Huevos' && item.confirmed) && items.some(item=>item.label==='Verduras' && item.confirmed),blocked=payload.vegan || payload.allergens.includes('huevo');
          return send(200,{recipe,eligibility:{status:blocked?'blocked_constraint':ready?'ready':'missing_ingredients',excluded_items:items.filter(item=>!item.confirmed).map(item=>({...item,reason:'unconfirmed'}))},cart:{simulated:true,items:ready?[]:[{label:'Huevos'},{label:'Verduras'}],purchases_enabled:false}});
        }
        if(route==='/api/sous/sessions'){
          const session={id:uid(),recipe_id:recipe.id,mode:'manual',revision:1,status:'not_started',current_step_id:'prepare',steps:recipe.steps.map(step=>({...step,state:'not_started'})),observations_count:0,verification_mode:'not_verified',ledger:[]};sessions.set(session.id,session);return send(201,session);
        }
        match=route.match(/^\/api\/sous\/sessions\/([0-9a-f-]+)\/verify$/);
        if(match){const session=sessions.get(match[1]);assert.ok(session);assert.equal(payload.expected_revision,session.revision);assert.equal(payload.step_id,session.current_step_id);
          const evidence=payload.evidence;assert.equal(evidence.source,'human');assert.equal(evidence.image_bytes,undefined);
          const step=session.steps.find(step=>step.id===session.current_step_id),ready=evidence.verdict==='ready' && evidence.human_confirmed;
          step.state=ready?'ready':evidence.verdict;session.ledger.push({step_id:step.id,evidence});session.observations_count++;session.revision++;
          if(ready)session.current_step_id=session.steps[session.steps.indexOf(step)+1]?.id || null;
          session.status=session.current_step_id?(ready?'in_progress':'uncertain'):'ready';return send(200,session);
        }
        send(404,{message:'Ruta no disponible.'});
      }catch(error){send(500,{message:error.message});}
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],external=[],checks=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    await context.addInitScript(()=>{window.__sousCameraRequests=0;if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.__sousCameraRequests++;throw Error('No camera request expected.');}});});
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width:1440,height:1050});assert.equal((await page.goto(base+'/sous')).status(),200);await page.waitForFunction(()=>!document.querySelector('#add-item').disabled);
    assert.match(await page.locator('#inventory').textContent(),/Empieza por lo que tienes/);assert.match(await page.locator('#recipe-source').textContent(),/No generada por IA/);checks.push('empty inventory and authored local recipe are honest');
    async function add(label,quantity,unit,{confidence='1',confirmed=true,expiry=false}={}){
      await page.locator('#add-item').click();await page.locator('#item-label').fill(label);await page.locator('#item-quantity').fill(String(quantity));await page.locator('#item-unit').selectOption(unit);await page.locator('#item-confidence').selectOption(confidence);await page.locator('#item-confirmed').setChecked(confirmed);
      if(expiry){await page.locator('#item-expiry').fill('2030-01-02');await page.locator('#item-expiry-source').selectOption('category_estimate');await page.locator('#item-reference').fill('Estimación manual de prueba');}
      await page.locator('#save-item').click();await page.waitForFunction(()=>!document.querySelector('#item-dialog').open);
    }
    await add('Huevos',4,'unit',{confidence:'0.5',confirmed:false,expiry:true});assert.match(await page.locator('#inventory').textContent(),/Requiere confirmación/);assert.match(await page.locator('#inventory').textContent(),/Fecha estimada/);
    await page.getByRole('button',{name:'Revisar Huevos',exact:true}).click();await page.locator('#item-confirmed').check();await page.locator('#save-item').click();await page.waitForFunction(()=>!document.querySelector('#item-dialog').open);
    assert.equal(confirmations,1);assert.match(await page.locator('#inventory').textContent(),/Confirmado por ti/);checks.push('low confidence needs explicit confirmation with date provenance retained');
    await add('Verduras',400,'g');await page.locator('#plan-meal').click();await page.waitForFunction(()=>!document.querySelector('#start-session').hidden);checks.push('confirmed inventory yields a practice plan');
    await page.locator('.recipe-details').evaluate(element=>element.open=true);await page.locator('#vegan').check();assert.equal(await page.locator('#start-session').isVisible(),false);await page.locator('#plan-meal').click();await page.waitForFunction(()=>document.querySelector('#plan-status').textContent.includes('no cumple'));assert.equal(await page.locator('#start-session').isVisible(),false);
    await page.locator('#vegan').uncheck();await page.locator('#plan-meal').click();await page.waitForFunction(()=>!document.querySelector('#start-session').hidden);checks.push('changing preferences invalidates plan and vegan constraint blocks eggs');
    await page.screenshot({path:path.join(directory,'sous-inventory-1440.png'),fullPage:true});
    await page.locator('#start-session').click();await page.waitForFunction(()=>!document.querySelector('#cooking-view').hidden);assert.equal(await page.locator('#step-title').textContent(),'Preparar');
    const first=png(30),second=png(210);
    await page.locator('#evidence-file').setInputFiles({name:'synthetic-first.png',mimeType:'image/png',buffer:first});await page.waitForFunction(()=>!document.querySelector('#evidence-preview').hidden && !document.querySelector('#verify-step').disabled);
    assert.equal(await page.locator('#evidence-image').evaluate(image=>image.complete && image.naturalWidth>0),true);
    await page.locator('#observation').fill('No puedo comprobar todavía el corte.');await page.locator('[name="verdict"][value="uncertain"]').check();await page.locator('#verify-step').click();await page.waitForFunction(()=>document.querySelector('#step-state').textContent.includes('Por revisar'));
    assert.equal(await page.locator('#step-title').textContent(),'Preparar');checks.push('human uncertainty records evidence and cannot advance the step');
    await page.locator('#evidence-file').setInputFiles({name:'synthetic-second.png',mimeType:'image/png',buffer:second});await page.waitForFunction(()=>!document.querySelector('#evidence-preview').hidden && !document.querySelector('#verify-step').disabled);
    await page.locator('#observation').fill('Comprobé manualmente los ingredientes.');await page.locator('[name="verdict"][value="ready"]').check();await page.locator('#verify-step').click();assert.match(await page.locator('#verification-error').textContent(),/Confirma/);
    await page.locator('#human-confirmed').check();await page.locator('#verify-step').click();await page.waitForFunction(()=>document.querySelector('#step-title').textContent==='Cocinar verduras');
    const evidencePosts=posts.filter(post=>post.route.endsWith('/verify'));assert.equal(evidencePosts[0].payload.evidence.frame_sha256,crypto.createHash('sha256').update(first).digest('hex'));assert.equal(evidencePosts[1].payload.evidence.frame_sha256,crypto.createHash('sha256').update(second).digest('hex'));assert.notEqual(evidencePosts[0].payload.evidence.frame_sha256,evidencePosts[1].payload.evidence.frame_sha256);assert.equal(JSON.stringify(evidencePosts).includes('data:image'),false);assert.equal(JSON.stringify(evidencePosts).includes('synthetic-first'),false);checks.push('two distinct synthetic photos send hashes only; human confirmation advances, never live vision');
    await page.reload();await page.waitForFunction(()=>document.querySelector('#resume-session'));await page.locator('#resume-session').click();assert.equal(await page.locator('#step-title').textContent(),'Cocinar verduras');checks.push('session identifier resumes persisted local practice');
    await page.screenshot({path:path.join(directory,'sous-cooking-1440.png'),fullPage:true});
    await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(directory,'sous-cooking-390.png'),fullPage:true});
    for(const title of ['Cocinar verduras','Añadir huevos','Terminar']){assert.equal(await page.locator('#step-title').textContent(),title);await page.locator('#observation').fill('Paso revisado personalmente para esta prueba.');await page.locator('[name="verdict"][value="ready"]').check();await page.locator('#human-confirmed').check();await page.locator('#verify-step').click();await page.waitForFunction(expected=>document.querySelector('#step-title').textContent!==expected || !document.querySelector('#session-complete').hidden,title);}
    assert.equal(await page.locator('#session-complete').isVisible(),true);assert.match(await page.locator('#session-complete').textContent(),/no certifica/);await page.locator('#finish-session').click();
    await page.getByRole('button',{name:'Registrar uso de Huevos',exact:true}).click();await page.locator('#event-amount').fill('2');await page.locator('#event-saved').check();await page.locator('#event-price').fill('0.30');await page.locator('#save-event').click();await page.waitForFunction(()=>!document.querySelector('#event-dialog').open);assert.equal(events[0].saved_from_waste,true);assert.equal(events[0].estimated_unit_price_usd,.3);assert.equal(items.find(item=>item.label==='Huevos').quantity,2);checks.push('completion remains personal practice and inventory use is a declared event');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(directory,'sous-inventory-390.png'),fullPage:true});checks.push('desktop and mobile layouts fit viewport');
    assert.equal(await page.evaluate(()=>window.__sousCameraRequests),0);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    const report={status:'passed',checked_at:new Date().toISOString(),scope:'Real browser, local assets and simulated HTTP API; not the production Sous service.',checks,external_calls:0,camera_requests:0,model_executed:false,synthetic_images:2,live_vision_tested:false,screenshots:['tmp/sous-ui/sous-inventory-1440.png','tmp/sous-ui/sous-inventory-390.png','tmp/sous-ui/sous-cooking-1440.png','tmp/sous-ui/sous-cooking-390.png']};
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
