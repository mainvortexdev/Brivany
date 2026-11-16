'use strict';
// Real Edge + actual WorkSpace assets. Weather and native browser handoff substituted.
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/workspace-daily-ui');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,channel:'msedge'});
 const report={mode:'real_local_browser_substituted_weather_and_native_bridge',external_calls:0,checks:[],limitations:'No real weather request, account calendar, browser launch or native window in this test.'};
 try{
  const errors=[],external=[],context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());let file;
   if(u.hostname!=='127.0.0.1'){external.push(u.origin);return route.abort()}
   if(u.pathname==='/work-widget')file=path.join(root,'desktop/experience/work-widget.html');else if(u.pathname.startsWith('/desktop-shell/'))file=path.join(root,'desktop/experience',path.basename(u.pathname));else if(u.pathname==='/typography.css')file=path.join(root,'web/typography.css');
   if(!file||!fs.existsSync(file))return route.fulfill({status:404,body:''});return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
  });
  await context.addInitScript(()=>{
   window.__calls=[];window.__weatherError=false;
   window.pywebview={api:{work_status:async()=>({active:true,jobs:[],schedules:[],live:{}}),work_island_pointer:async()=>null,work_island_keyboard:async()=>({ok:true}),spotify_status:async()=>({connected:false}),workspace_chat_state:async()=>({messages:[],listening:false}),workspace_files_state:async()=>({revision:0,items:[]}),
    workspace_weather_search:async city=>{window.__calls.push(['search',city]);return {locations:[{label:'La Paz, Bolivia',latitude:-16.5,longitude:-68.1},{label:'La Paz, México',latitude:24.1,longitude:-110.3}]};},
    workspace_weather_current:async(lat,lon)=>{window.__calls.push(['weather',lat,lon]);if(window.__weatherError)throw Error('No se pudo consultar el clima.');return {temperature:14.2,apparent:12.1,humidity:58,wind_kmh:9,code:3,high:18,low:4,local_time:'2026-11-07T13:00',timezone:'America/La_Paz',cached:false};},
    workspace_link_open:async url=>{window.__calls.push(['open',url]);return {opened:true};}
   }};
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1/work-widget');await page.waitForFunction(()=>window.BrivanyWorkspaceDaily);
  assert.equal(await page.evaluate(()=>__calls.length),0);
  // Native layout is deliberately absent: exercise the production preview fallback.
  await page.evaluate(()=>{delete pywebview.api.work_island_layout;window.BrivanyIsland.expand('widgets',innerWidth/2)});
  // The bridge exists for explicit tools; preview geometry can be supplied by receiveLayout.
  await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:280,clip_left:433,anchor_x:683}));
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Agenda'});
  await page.getByLabel('Título',{exact:true}).fill('Revisar <script>demo</script>');await page.getByLabel('Hora opcional del evento').fill('14:30');await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByText('Revisar <script>demo</script>',{exact:true}).waitFor();assert.equal(await page.locator('#daily-events script').count(),0);
  const date=await page.evaluate(()=>JSON.parse(localStorage.getItem('brivany.workspace.daily.v1')).events[0].date);assert(/^\d{4}-\d{2}-\d{2}$/.test(date));
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar agenda local'}).click();const download=await downloadPromise;await download.saveAs(path.join(out,'owned-agenda.ics'));assert(fs.readFileSync(path.join(out,'owned-agenda.ics'),'utf8').includes('SUMMARY:Revisar <script>demo</script>'));
  await page.getByRole('button',{name:'Mes siguiente',exact:true}).click();await page.getByRole('button',{name:'Hoy',exact:true}).click();await page.getByText('Revisar <script>demo</script>',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'calendar-desktop.png')});report.checks.push('Local calendar day selection, event storage, safe text rendering, month navigation and ICS download.');
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Webs'});await page.getByLabel('Nombre',{exact:true}).fill('Documentación propia');await page.getByLabel('Dirección',{exact:true}).fill('https://example.test/docs');await page.getByRole('button',{name:'Añadir web',exact:true}).click();
  await page.getByRole('button',{name:'Abrir Documentación propia',exact:true}).click();assert.deepEqual(await page.evaluate(()=>__calls),[['open','https://example.test/docs']]);
  await page.reload();await page.waitForFunction(()=>window.BrivanyWorkspaceDaily);await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:500,height:280,clip_left:433,anchor_x:683}));
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Webs'});await page.getByRole('button',{name:'Abrir Documentación propia',exact:true}).waitFor();
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Agenda'});await page.getByText('Revisar <script>demo</script>',{exact:true}).waitFor();report.checks.push('Websites and agenda survive reload; opening occurs only on an explicit click.');
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Clima'});assert.equal(await page.evaluate(()=>__calls.length),0);await page.getByLabel('Ciudad',{exact:true}).fill('La Paz');await page.getByRole('button',{name:'Buscar ciudad',exact:true}).click();await page.getByRole('button',{name:'La Paz, Bolivia',exact:true}).click();
  await page.getByText('14°',{exact:true}).waitFor();await page.getByText('Nublado',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>__calls),[['search','La Paz'],['weather',-16.5,-68.1]]);
  await page.getByText('2026-11-07 · 13:00 · America/La_Paz',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'weather-desktop.png')});
  await page.evaluate(()=>window.__weatherError=true);await page.getByRole('button',{name:'Actualizar clima',exact:true}).click();await page.getByRole('status').filter({hasText:'No se pudo consultar el clima.'}).waitFor();await page.evaluate(()=>window.__weatherError=false);await page.getByRole('button',{name:'Actualizar clima',exact:true}).click();await page.getByRole('status').filter({hasText:'Condiciones recibidas'}).waitFor();
  report.checks.push('Weather city disambiguation, explicit refresh, provider-local time, failure recovery and no automatic request.');
  await page.setViewportSize({width:340,height:600});await page.evaluate(()=>BrivanyIsland.receiveLayout({expanded:true,panel:'widgets',width:324,height:280,clip_left:8,anchor_x:170}));
  for(const tab of ['Clima','Agenda','Webs']){await page.getByLabel('Herramienta',{exact:true}).selectOption({label:tab});await page.screenshot({path:path.join(out,tab+'-340.png')});assert.equal(await page.locator('#workspace-widgets').evaluate(el=>el.scrollWidth>el.clientWidth+1),false)}
  report.checks.push('Three tools remain reachable through the native tool selector and fit a 340px window.');
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Webs'});await page.getByRole('button',{name:'Quitar web Documentación propia'}).click();assert.equal(await page.locator('.daily-site').count(),0);
  await page.getByLabel('Herramienta',{exact:true}).selectOption({label:'Agenda'});await page.getByRole('button',{name:'Quitar evento Revisar <script>demo</script>'}).click();assert.equal(await page.locator('.daily-event').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);report.passed=true;
 }catch(error){report.passed=false;report.error=error.stack;console.error(error);process.exitCode=1}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close()}
})();
