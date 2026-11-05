'use strict';
const {chromium}=require('../motion-studio/node_modules/playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/workspace-results';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1280,height:760}}),errors=[],mediaReads=[];
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/__result-fixture/audio'){
   mediaReads.push(request.headers()['x-brivany-result']);const wav=Buffer.alloc(16044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);return route.fulfill({contentType:'audio/wav',body:wav});
  }
  return url.origin===base?route.continue():route.abort();
 });
 await context.addInitScript(()=>{window.__resultCalls=[];window.__resultRevision=0;window.pywebview={api:{
  work_status:async()=>({active:true,jobs:[],live:{}}),work_island_pointer:async()=>null,spotify_status:async()=>({connected:false}),
  work_island_keyboard:async value=>window.__resultCalls.push(['keyboard',value]),
  work_agent_review:async id=>window.__resultCalls.push(['child',id]),
  return_to_chat:async()=>window.__resultCalls.push(['big-app']),
  work_island_layout:async(open,size,panel,motion,manual,x)=>({expanded:open,panel,width:Math.min(520,innerWidth-16),height:Math.min(340,innerHeight-60),clip_left:Math.max(8,(innerWidth-Math.min(520,innerWidth-16))/2),revision:++window.__resultRevision})
 }}});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(base+'/work-widget');await page.waitForFunction(()=>!!window.BrivanyResultView);
  const display=async value=>{assert.equal(await page.evaluate(value=>window.BrivanyResultView.receive(value),value),true);await page.evaluate(()=>window.BrivanyIsland.expand('result'));await page.locator('.result-glass').waitFor({state:'visible'});await page.waitForTimeout(250)};
  await display({id:'owned-document',type:'text',title:'Tres ideas para organizar un escritorio',text:('Primera idea: mantener a mano solo los objetos de uso diario.\n\nSegunda idea: agrupar los objetos por categorías.\n\nTercera idea: revisar el escritorio al final del día.\n\n').repeat(12)+'https://example.test/'+ 'referencia'.repeat(180)+'\n<script>window.__unsafe=true</script>'});
  assert.equal(await page.locator('.lg-glass.result-glass').count(),1);assert(await page.locator('#glisse-styles').count());
  const glassStyle=await page.locator('.result-glass').evaluate(e=>{const s=getComputedStyle(e);return {backdrop:s.backdropFilter,blur:s.getPropertyValue('--lg-blur'),color:s.backgroundColor}});assert.match(glassStyle.backdrop,/blur\(24px\)/,JSON.stringify(glassStyle));
  for(const [width,height] of [[1280,760],[800,600],[375,568],[320,480]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>window.BrivanyIsland.expand('result'));await page.waitForTimeout(250);
   const box=await page.locator('.result-glass').boundingBox();assert(box&&box.height<=340.5&&box.width<=520.5&&box.x>=0&&box.x+box.width<=width+1&&box.y+box.height<=height);
   const scroll=await page.locator('.result-scroll').evaluate(e=>({vertical:e.scrollHeight>e.clientHeight,horizontal:e.scrollWidth>e.clientWidth+1,bar:getComputedStyle(e).scrollbarWidth,overflow:getComputedStyle(e).overflowX}));assert(scroll.vertical&&!scroll.horizontal&&scroll.bar==='none'&&scroll.overflow==='hidden',JSON.stringify(scroll));
   await page.locator('.result-scroll').evaluate(e=>e.scrollTop=100);assert(await page.locator('.result-scroll').evaluate(e=>e.scrollTop>0));
  }
  assert.equal(await page.evaluate(()=>window.__unsafe),undefined);
  await page.setViewportSize({width:1280,height:760});await page.evaluate(()=>window.BrivanyIsland.expand('result'));await page.locator('.result-scroll').evaluate(e=>e.scrollTop=0);await page.waitForTimeout(250);await page.screenshot({path:dir+'/glass-document.png'});
  const picture=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#dbe7ed';ctx.fillRect(0,0,1200,800);ctx.fillStyle='#1686ff';ctx.beginPath();ctx.arc(600,400,150,0,Math.PI*2);ctx.fill();return canvas.toDataURL()});
  await display({id:'owned-image',type:'image',title:'Imagen de prueba',src:picture});assert(await page.locator('.result-image').evaluate(e=>e.naturalWidth===1200));await page.screenshot({path:dir+'/glass-image.png'});
  await display({id:'owned-team',type:'team',title:'Equipo de Melodi',items:[{key:'t1',job_id:'owned-child',title:'Documento revisado',accepted:true}]});await page.getByRole('button',{name:'Documento revisado'}).click();assert((await page.evaluate(()=>window.__resultCalls)).some(c=>c[0]==='child'&&c[1]==='owned-child'));
  await display({id:'owned-audio',type:'audio',title:'Audio de prueba',media_url:'/__result-fixture/audio',media_ticket:'owned-scoped-ticket'});await page.locator('.result-scroll audio').waitFor();await page.waitForFunction(()=>document.querySelector('.result-scroll audio').readyState>=1);assert.deepEqual(mediaReads,['owned-scoped-ticket']);
  await page.locator('audio').evaluate(e=>{e.__pause=e.pause.bind(e);e.pause=()=>{e.dataset.pauseCalled='true';e.__pause()}});await page.evaluate(()=>window.BrivanyIsland.expand('music'));assert.equal(await page.locator('audio').getAttribute('data-pause-called'),'true');
  await page.evaluate(()=>window.BrivanyIsland.expand('result'));await page.getByRole('button',{name:'Cerrar resultado',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-expanded'),'false');
  await display({id:'owned-document',type:'text',title:'Documento',text:'Contenido sintético.'});await page.locator('.result-scroll').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('body').getAttribute('data-expanded'),'false');assert(!(await page.evaluate(()=>window.__resultCalls)).some(c=>c[0]==='big-app'));
  await page.emulateMedia({reducedMotion:'reduce'});await display({id:'owned-document',type:'text',title:'Documento',text:'Contenido sintético.'});assert.equal(await page.locator('#island-content').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  assert.deepEqual(errors,[]);const report={passed:true,type:'isolated_local_UI_with_synthetic_results',glisse:'0.5.0',external_calls:0,native_desktop_backdrop_verified:false,widths:[1280,800,375,320],checks:['actual_Glisse_component','compact_maximum_height','wrapped_documents','vertical_scroll_hidden_bar','no_horizontal_scroll','literal_safe_content','image','team_child','scoped_media_header','pause_on_switch','close_and_escape','no_big_app_open','reduced_motion'],errors};fs.writeFileSync(dir+'/ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
