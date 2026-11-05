'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/computer-access-ui';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'msedge'}),errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await context.addInitScript(()=>{
   if(parent!==window)return;
   const post=async(path,value)=>{const r=await fetch('/__computer-test/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!r.ok)throw Error('Fixture rejected');return r.json();};
   window.pywebview={api:{authorize_computer:()=>post('arm',{}),assistant_status:async()=>(await fetch('/__computer-test/status')).json(),
    configure_computer_access:mode=>post('access-mode',{mode}),approve_file_action:(id,approval,accepted)=>post('file-decision',{id,approval,accepted})}};
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/brivany-shell');
  await page.locator('[data-settings]').first().click();const settings=page.frameLocator('#settings-frame');await settings.locator('[data-tab=control]').click();
  await settings.locator('[name=access-mode][value=normal]').waitFor();assert(await settings.locator('[value=normal][name=access-mode]').isChecked());
  await settings.locator('[value=full][name=access-mode]').check();await settings.getByRole('status').filter({hasText:'Modo guardado'}).waitFor();
  const current=await page.evaluate(async()=>(await fetch('/__computer-test/status')).json());assert.equal(current.access.mode,'full');assert.equal(current.access.uac_auto_approval,false);
  await page.screenshot({path:dir+'/settings-1280.png'});
  for(const width of [768,390,320]){
   await page.setViewportSize({width,height:760});const frame=page.frames().find(f=>new URL(f.url()).pathname==='/settings');
   assert(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:dir+'/settings-'+width+'.png'});
  }
  await page.locator('#settings-close').click();
  const prepare=action=>page.evaluate(async action=>{const r=await fetch('/__computer-test/file-prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});return r.json();},action);
  const first=await prepare('replace_file');const dialog=page.locator('.file-approval');await dialog.getByRole('heading',{name:'Sobrescribir archivo'}).waitFor();
  assert(await dialog.getByText('Versión de destino.txt',{exact:false}).isVisible());assert(await page.evaluate(()=>{const r=document.querySelector('.file-approval').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}));
  await page.screenshot({path:dir+'/approval-320.png'});
  await page.evaluate(()=>window.BrivanyAgents.observe([]));assert(await dialog.isVisible());
  await dialog.getByRole('button',{name:'Más tarde',exact:true}).click();
  let state=await page.evaluate(async()=>(await fetch('/__computer-test/status')).json());assert.equal(state.jobs.find(j=>j.id===first.id).state,'awaiting_approval');assert(!state.native_calls.includes('file_action_commit'));
  await page.evaluate(id=>window.BrivanyFileApprovals.show(id),first.id);await dialog.getByRole('button',{name:'Rechazar',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const second=await prepare('delete_file');await dialog.getByRole('heading',{name:'Eliminar archivo'}).waitFor();await page.setViewportSize({width:1280,height:800});await page.screenshot({path:dir+'/approval-1280.png'});
  await dialog.getByRole('button',{name:'Enviar a la papelera',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(async id=>{const v=await(await fetch('/__computer-test/status')).json();return v.jobs.find(j=>j.id===id)?.state==='succeeded';},second.id);
  state=await page.evaluate(async()=>(await fetch('/__computer-test/status')).json());assert.equal(state.native_calls.filter(m=>m==='file_action_commit').length,1);
  assert.deepEqual(errors,[]);const report={passed:true,type:'local_UI_with_substituted_native_and_planner',widths:[1280,768,390,320],checks:['both_modes','mode_persistence_backend','no_uac_auto_approval','paths_readable','later_does_not_execute','reject_does_not_execute','explicit_fixture_accept_once'],model_calls:0};fs.writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
