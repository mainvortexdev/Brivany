'use strict';
const {chromium}=require('../motion-studio/node_modules/playwright-core'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/brand-typography-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const {sitePage}=await import('../official-site/pages.mjs');
 const server=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;let file;
  if(route.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,jobs:[],messages:[],conversations:[],active:null,services:[],signed_in:false,voice:{asr:{available:false},tts:{configured:false}}}));return}
  if(route==='/privacidad'){res.setHeader('Content-Type','text/html');res.end(sitePage(route));return}
  if(route==='/brivany-shell')file='desktop/experience/index.html';else if(route==='/app')file='desktop/experience/chat.html';
  else if(route==='/site')file='official-site/public/index.html';else if(route.startsWith('/assets/'))file='official-site/public'+route;
  else if(route.startsWith('/desktop-shell/'))file='desktop/experience/'+route.slice(15);else file='web'+route;
  const full=path.resolve(root,file);if(!full.startsWith(root+path.sep)||!fs.existsSync(full)||!fs.statSync(full).isFile()){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',full.endsWith('.woff2')?'font/woff2':full.endsWith('.css')?'text/css':full.endsWith('.js')?'text/javascript':full.endsWith('.svg')?'image/svg+xml':'text/html');
  let data=fs.readFileSync(full);if(route==='/app')data=data.toString().replace('</head>','<script src="/desktop-shell/icons.js"></script></head>');res.end(data);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});const checks=[],external=[],errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1120,height:800},reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(external.push(route.request().url()),route.abort()));
  await context.addInitScript(()=>{window.pywebview={api:{workspace_chat_publish:async()=>({ok:true}),music_voice_active:async()=>({ok:true}),assistant_status:async()=>({jobs:[]}),account_status:async()=>({signed_in:false})}}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  async function inspect(route,selector){
   await page.goto(base+route);await page.locator(selector).first().waitFor();await page.evaluate(async()=>{await Promise.all([300,400,500,700].map(w=>document.fonts.load(w+' 24px "Brivany Editorial"')));await document.fonts.ready});
   const session=await context.newCDPSession(page);await session.send('DOM.enable');await session.send('CSS.enable');const {root:doc}=await session.send('DOM.getDocument');const {nodeId}=await session.send('DOM.querySelector',{nodeId:doc.nodeId,selector});const {fonts}=await session.send('CSS.getPlatformFontsForNode',{nodeId});await session.detach();
   assert(fonts.some(f=>f.isCustomFont&&f.familyName==='Brivany Editorial'&&f.glyphCount>0),route+' must use the actual bundled font');
   assert.equal(await page.evaluate(()=>[...document.fonts].filter(f=>f.family.includes('Brivany Editorial')&&f.status==='loaded').length),3);
   return {route,real_custom_font:true,weights_loaded:3};
  }
  checks.push(await inspect('/brivany-shell','.brand-mark strong'));await page.screenshot({path:path.join(out,'desktop.png')});
  checks.push(await inspect('/app','.chat-welcome h1'));await page.locator('#chat-message').fill('Español: ¿Qué creamos hoy? ÁÉÍÓÚ · ñ · ü · ¡Brivany!');await page.screenshot({path:path.join(out,'chat.png')});
  checks.push(await inspect('/site','h1'));await page.screenshot({path:path.join(out,'site.png')});
  await page.setViewportSize({width:390,height:780});assert(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,'site-mobile.png')});
  checks.push(await inspect('/privacidad','h1'));assert(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+1));
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);const report={passed:true,mode:'owned_headless_browser_local_fonts_and_synthetic_services',checks,external_calls:0,errors};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
