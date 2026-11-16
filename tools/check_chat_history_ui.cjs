'use strict';
// Owned, isolated browser + synthetic services; never controls the user's browser.
const {chromium}=require('../motion-studio/node_modules/playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:8877',out=path.join(root,'tmp/chat-history-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 const saved=new Map(),errors=[],opened=[];let active=null,finished=false;
 const id='00000000-0000-4000-8000-000000000123';
 try{
  const context=await browser.newContext({viewport:{width:1200,height:850}});
  await context.exposeBinding('__assistantStatus',()=>({jobs:[{id,kind:'motion',agent:'Melodi · Video',state:finished?'succeeded':'running',phase:finished?'Video creado por Melodi; listo para revisar.':'FFmpeg · Renderizando video',steps:2,result:finished?{path:'C:\\Brivany\\workspace\\motion\\'+id+'\\Brivany.mp4',verified:true,title:'Tráiler de tres marcas',duration:60}:null},{id:'child-fixture',parent_id:id,kind:'research',agent:'Investigación',state:'succeeded',phase:'Referencias revisadas'}]}));
  await context.exposeBinding('__openResult',(_source,job,kind)=>{opened.push({job,kind});return {ok:true}});
  await context.addInitScript(()=>{window.pywebview={api:{workspace_chat_publish:async()=>({ok:true}),music_voice_active:async()=>({ok:true}),music_media_active:async()=>({ok:true}),authorize_computer:async()=>({ok:true,token:'fixture-token',jobs:[]}),assistant_status:()=>window.__assistantStatus(),open_motion_result:(...args)=>window.__openResult(...args),reveal_assistant_result:id=>window.__openResult(id,'reveal'),assistant_result_preview:async id=>({id,type:'video',media_url:'/api/computer/result-media/'+id,media_ticket:'fixture-read-ticket'}),account_status:async()=>({signed_in:false})}};const preview=window.pywebview.api.assistant_result_preview;delete window.pywebview.api.assistant_result_preview;setTimeout(()=>{window.pywebview.api.assistant_result_preview=preview;window.dispatchEvent(new Event('pywebviewready'))},500)});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
   if(url.pathname==='/api/desktop/chats'){
    if(route.request().method()==='POST'){const value=route.request().postDataJSON();saved.set(value.id,value);active=value.id;return route.fulfill({json:{ok:true,id:value.id}})}
    return route.fulfill({json:{active,encrypted:true,conversations:[...saved.values()].map(value=>({id:value.id,title:value.messages.find(m=>m.role==='user')?.text||'Nueva conversación',updated:Date.now()/1000}))}});
   }
   if(url.pathname.startsWith('/api/desktop/chats/'))return route.fulfill({json:saved.get(url.pathname.split('/').at(-1))});
   if(url.pathname==='/api/desktop/chat-provider')return route.fulfill({json:{provider:'siliconflow',enabled:true,model:'deepseek-ai/DeepSeek-V4-Flash'}});
   if(url.pathname==='/api/status')return route.fulfill({json:{voice:{asr:{available:false},tts:{configured:false}}}});
   if(url.pathname==='/api/voice/turn')return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'reference_action',ticket:'fixture'})+'\n'});
   if(url.pathname==='/api/computer/execute-prepared')return route.fulfill({json:{job:{id,acknowledgement:'Voy a preparar un tráiler para presentar Cognira Desktop, Vetsa AI y Brivany. Aplicaré la guía de marca y organizaré el guion para que cada producto tenga su espacio.\n\nElegiré los recursos disponibles, montaré las escenas y comprobaré la exportación. Te mostraré los avances y el resultado aquí, con un enlace al archivo.'}}});
   if(url.pathname.startsWith('/api/computer/result-media/')){if(route.request().headers()['x-brivany-result']!=='fixture-read-ticket')return route.fulfill({status:403,body:''});return route.fulfill({contentType:'video/mp4',body:fs.readFileSync(path.join(out,'preview-fixture.mp4'))})}
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{jobs:[],enabled:true,request_authorized:true,services:[],messages:[]}});
   if(url.pathname==='/settings')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Ajustes de prueba</title><p>Ajustes</p>'});
   if(url.pathname==='/voice-engine.js')return route.fulfill({contentType:'text/javascript',body:'window.BrivanyVoice={VoiceOutput:class{constructor(){this.speaking=false}cancel(){}},Microphone:class{stop(){}suspend(){}}};'});
   let file=url.pathname==='/brivany-shell'?'desktop/experience/index.html':url.pathname==='/app'?'desktop/experience/chat.html':url.pathname==='/spaces'?'web/index.html':url.pathname==='/settings'?'desktop/experience/settings.html':url.pathname.startsWith('/desktop-shell/')?'desktop/experience/'+url.pathname.slice(15):'web'+url.pathname;
   file=path.join(root,file);if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   let body=fs.readFileSync(file);if(url.pathname==='/app')body=body.toString().replace('</head>','<script src="/desktop-shell/icons.js"></script></head>');
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.html')?'text/html':'application/octet-stream',body});
  });
  const page=await context.newPage();page.on('pageerror',error=>{errors.push(error.message);console.error('UI error:',error.message)});await page.goto(base+'/brivany-shell');
  const chat=()=>page.frameLocator('#module-frame');await chat().locator('#chat-message').waitFor();await page.waitForFunction(()=>!!document.querySelector('#module-frame')?.contentWindow?.BrivanyChat);
  await chat().locator('#chat-message').fill('Crea el tráiler de Cognira Desktop, Vetsa AI y Brivany');await chat().getByRole('button',{name:'Enviar mensaje',exact:true}).click();
  await chat().locator('.execution-card').waitFor();assert.equal(await chat().locator('.execution-events').getAttribute('open'),null);await chat().locator('.execution-events summary').filter({hasText:'Trabajando'}).click();await chat().locator('.execution-phase').filter({hasText:'FFmpeg · Renderizando video'}).waitFor();
  assert.equal(await chat().locator('.execution-card[aria-busy=true]').count(),1);assert.equal(await chat().locator('.execution-agent').count(),1);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await chat().locator('.execution-phase').evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.screenshot({path:path.join(out,'trabajando.png')});
  await chat().locator('#chat-message').fill('Borrador que debe conservarse');
  await page.getByRole('button',{name:'Ajustes',exact:true}).click();await page.locator('#settings-close').click();
  assert.equal(await chat().locator('#chat-message').inputValue(),'Borrador que debe conservarse');
  finished=true;await chat().locator('video.execution-media').waitFor();
  await page.waitForFunction(()=>document.querySelector('#module-frame').contentDocument.querySelector('video')?.readyState>=1);
  assert.equal(await chat().locator('video').evaluate(video=>video.controls),true);assert.ok((await chat().locator('video').boundingBox()).width<=420);assert.ok((await chat().locator('video').boundingBox()).height<=260);assert.equal(await chat().getByText('He terminado la tarea. Puedes revisar el resultado.',{exact:true}).count(),0);assert.equal(await chat().locator('.chat-provider').count(),0);
  assert.equal(await chat().locator('.execution-heading').count(),0);assert.match(await chat().locator('.execution-events summary').textContent(),/He trabajado durante/);
  await chat().getByRole('button',{name:'Ruta del video',exact:true}).click();assert.equal(opened.at(-1).kind,'reveal');
  await page.evaluate(()=>window.BrivanyConversations.flush());const first=active;
  await page.getByRole('button',{name:'Nueva conversación',exact:true}).click();await chat().getByRole('heading',{name:'¿Qué creamos hoy?'}).waitFor();
  assert.notEqual(active,first);assert.equal(saved.get(first).tasks[0].finalized,true);
  await page.locator('.chat-history-open').filter({hasText:'Crea el tráiler'}).click();await chat().locator('video.execution-media').waitFor();
  assert.equal(await chat().locator('#chat-message').inputValue(),'Borrador que debe conservarse');
  await page.reload();await chat().locator('video.execution-media').waitFor();
  assert.equal(await chat().locator('.chat-message[data-role=user]').count(),1);assert.equal(await page.locator('.chat-history-open').count(),2);
  await page.screenshot({path:path.join(out,'historial-restaurado.png')});assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,mode:'real_browser_synthetic_services',checks:['animated execution and child agent','settings preserves draft and conversation','automatic inline MP4 with native controls and Explorer path link','new conversation keeps previous chat','reselect and full reload recover messages, results and draft'],external_model_calls:0},null,2));console.log('Chat history/progress UI checks passed.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
