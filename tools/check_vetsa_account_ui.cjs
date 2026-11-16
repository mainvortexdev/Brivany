'use strict';
// Real Edge layout/interactions; identity API entirely substituted, no accounts.
const {chromium}=require('../motion-studio/node_modules/playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/vetsa-account-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 const report={mode:'real_edge_synthetic_identity',external_calls:0,passed:false};
 try{
  const page=await browser.newPage({viewport:{width:980,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname!=='account.test')return route.abort();const name=path.basename(u.pathname);if(['account.js','account.css','settings.css'].includes(name))return route.fulfill({body:fs.readFileSync(path.join(root,'desktop/experience',name)),contentType:name.endsWith('.js')?'text/javascript':'text/css'});return route.fulfill({body:'<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="/settings.css"><link rel="stylesheet" href="/account.css"><script src="/account.js" defer></script></head><body><main class="settings-app"><aside class="settings-nav"><h1>Ajustes</h1><nav><button data-tab="general">General</button></nav></aside><div class="settings-content"><section data-section="general">General</section></div></main></body></html>'});});
  await page.addInitScript(()=>{window.testCalls=[];let state={provider:'Vetsa',signed_in:false,pending:false,remote_enabled:false};window.setAccount=s=>{state=s};const call=(name,fn)=>async(...args)=>{window.testCalls.push([name,...args]);return fn(...args)};window.pywebview={api:{account_status:async()=>state,account_begin_login:call('begin',()=>state={...state,pending:true}),account_cancel_login:call('cancel',()=>state={...state,pending:false}),account_logout:call('logout',()=>state={provider:'Vetsa',signed_in:false,pending:false}),account_manage:call('manage',()=>({opened:true})),account_refresh:call('refresh',()=>state)}};});
  await page.goto('http://account.test/settings#account');await page.getByRole('button',{name:'Iniciar sesión con Vetsa'}).click();await page.getByText('Completa el acceso en la ventana de Brivany.').waitFor();assert(await page.getByRole('button',{name:'Iniciar sesión con Vetsa'}).isDisabled());await page.getByRole('button',{name:'Cancelar acceso'}).click();
  await page.evaluate(()=>window.setAccount({provider:'Vetsa',signed_in:true,connected:true,pending:false,remote_enabled:false,account:{id:'fixture',name:'Daniel de prueba',email:'fixture@example.test'},security:{email_verified:true,three_auth:true,email_alerts:true,passkeys:2}}));
  await page.getByText('Daniel de prueba',{exact:true}).waitFor();await page.getByRole('button',{name:'Seguridad VAS',exact:true}).click();assert((await page.evaluate(()=>window.testCalls)).some(x=>x[0]==='manage'&&x[1]==='security'));
  assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.locator('input[type=email]').count(),0);
  await page.screenshot({path:path.join(out,'cuenta-vetsa-desktop.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:path.join(out,'cuenta-vetsa-dark.png')});
  await page.setViewportSize({width:420,height:740});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'cuenta-vetsa-compacta.png')});
  await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await page.getByRole('button',{name:'Iniciar sesión con Vetsa'}).waitFor();assert.equal(await page.getByText('fixture@example.test',{exact:true}).isVisible(),false);assert.deepEqual(errors,[]);report.passed=true;
 }finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
