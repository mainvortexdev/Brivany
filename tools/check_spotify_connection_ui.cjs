'use strict';
// Real off-screen Edge; all Spotify/native actions are synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('../motion-studio/node_modules/playwright-core');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/spotify-connection-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--disable-background-networking']});
 const report={passed:false,mode:'headless_edge_synthetic_accounts_and_native_bridge',external_calls:0,OS_input_sent:false,audio_devices_opened:0};
 try{
  const context=await browser.newContext({viewport:{width:760,height:520}});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.hostname!=='connection.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'"},body:'<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="/spotify-connections.css"><script src="/spotify-connections.js" defer></script></head><body><main><section id="accounts"></section></main></body></html>'});
   const name=url.pathname.slice(1);if(!['spotify-connections.js','spotify-connections.css'].includes(name))return route.abort();
   return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(root,'desktop/experience',name))});
  });
  await context.addInitScript(()=>{
   window.__status={connected:false,pending:false,message:''};window.__calls=[];window.__deny=true;
   window.pywebview={api:{spotify_status:async()=>__status,spotify_connect:async()=>{__calls.push('connect');if(__deny)throw Error('Spotify no habilitó esta cuenta.');__status={...__status,pending:true}},spotify_cancel_link:async()=>{__calls.push('cancel');__status={...__status,pending:false}},spotify_disconnect:async()=>{__calls.push('disconnect');__status={connected:false,pending:false,message:''}}}};
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://connection.test/');await page.getByRole('button',{name:'Vincular Spotify ↗',exact:true}).click();
  await page.waitForTimeout(2150);assert.equal(await page.locator('#spotify-account-message').textContent(),'Spotify no habilitó esta cuenta.');
  await page.evaluate(()=>__deny=false);await page.getByRole('button',{name:'Vincular Spotify ↗',exact:true}).click();
  assert.equal(await page.locator('#spotify-account-link').isDisabled(),true);assert(await page.getByRole('button',{name:'Cancelar vinculación',exact:true}).isVisible());
  await page.getByRole('button',{name:'Cancelar vinculación',exact:true}).click();assert.equal(await page.locator('#spotify-account-link').isDisabled(),false);
  await page.evaluate(()=>__status={connected:true,pending:false,message:'',streaming_access:true,library_access:true,application_access:'development',account:{display_name:'Otra cuenta de prueba'}});
  await page.waitForTimeout(2100);assert.equal(await page.locator('#spotify-account-state').textContent(),'Conectado · Otra cuenta de prueba');
  assert((await page.locator('#spotify-account-detail').textContent()).includes('El acceso está en pruebas'));
  await page.evaluate(()=>__status={...__status,application_access:'unknown'});await page.waitForTimeout(2100);
  assert.equal((await page.locator('#spotify-account-detail').textContent()).includes('El acceso está en pruebas'),false);
  assert.equal(await page.locator('input').count(),0);assert.equal((await page.locator('#spotify-account').textContent()).includes('Client ID'),false);
  await page.screenshot({path:path.join(out,'connected-synthetic-account.png')});
  await page.setViewportSize({width:375,height:620});assert(await page.locator('#spotify-account').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await page.getByRole('button',{name:'Desvincular cuenta',exact:true}).click();assert.equal(await page.locator('#spotify-account-message').textContent(),'Autorización eliminada de este equipo.');
  assert.deepEqual(await page.evaluate(()=>__calls),['connect','connect','cancel','disconnect']);assert.deepEqual(errors,[]);
  report.passed=true;report.checks=['OAuth error remains visible after status polling','single-button sign-in without Client ID fields','pending action can be cancelled','account display name and Premium requirement','disconnect and 375px bounds'];
 }catch(error){report.error=String(error.stack).slice(0,2000);process.exitCode=1}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
})().catch(error=>{console.error(error);process.exitCode=1});
