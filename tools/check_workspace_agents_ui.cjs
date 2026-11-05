'use strict';
const {chromium}=require('../motion-studio/node_modules/playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/workspace-agents';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1280,height:760}}),errors=[];
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await context.addInitScript(()=>{
  window.__agentJobs=[];window.__agentCalls=[];window.__agentLayout={expanded:false,panel:'agent',width:336,height:244,clip_left:472,revision:0};
  window.pywebview={api:{work_status:async()=>({active:true,jobs:window.__agentJobs,live:{},selected_agent:window.__selectedAgent}),work_island_pointer:async()=>null,work_island_gaze:async()=>({x:0,y:0}),spotify_status:async()=>({connected:false}),
   work_agent_select:async id=>{window.__agentCalls.push(['select',id]);window.__selectedAgent=id;return window.__agentJobs.find(j=>j.id===id)},
   work_agent_review:async id=>{window.__agentCalls.push(['review',id]);return {ok:true}},cancel_assistant_job:async id=>{window.__agentCalls.push(['cancel',id]);return {ok:true}},
   work_island_layout:async(open,size,panel,motion,manual,x)=>{const value={expanded:open,panel,width:336,height:244,clip_left:Math.max(8,Math.min(innerWidth-344,x-168)),anchor_x:x,revision:++window.__agentLayout.revision};window.__agentLayout=value;return value}
  }};
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const jobs=[['document','running'],['image','planning'],['research','reviewing'],['model','queued'],['motion','running'],['document','running']].map(([kind,state],i)=>({id:'own-fixture-'+i,kind,state,title:['Texto de bienvenida','Imagen para Brivany','Documentación de Python','Modelo conceptual','Video de prueba','Resumen'][i],phase:state==='reviewing'?'Melodi revisa el contenido':'Preparando el resultado',parent_id:'own-team',agent_key:'own-team:'+i,attempt:1,review_state:'pending'}));
 try{
  await page.goto(base+'/work-widget');await page.waitForFunction(()=>!!window.BrivanyWorkspaceAgents&&!!window.BrivanyIsland);
  await page.evaluate(jobs=>{window.__agentJobs=jobs;window.BrivanyWorkspaceAgents.receive({jobs})},jobs);
  await page.waitForFunction(()=>document.querySelectorAll('.agent-child').length===6);
  for(const width of [1280,1024,800,640,375]){
   await page.setViewportSize({width,height:760});await page.waitForTimeout(90);
   assert.equal(await page.locator('.agent-child').count(),6);
   assert(await page.locator('.melodi-family').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+.5&&r.bottom<=40.5}),'Team must stay inside the top bar');
   assert(await page.locator('.melodi-family>.eye-bay').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=64&&r.width<=73&&r.height<=40.5}));
  }
  await page.setViewportSize({width:1280,height:760});
  for(const count of [1,3,5]){
   await page.evaluate(count=>{window.__agentJobs=window.__allAgents.slice(0,count);window.BrivanyWorkspaceAgents.receive({jobs:window.__agentJobs})},await page.evaluate(jobs=>{window.__allAgents=jobs;return 1},jobs).then(()=>count));await page.waitForTimeout(1100);
   assert.equal(await page.locator('.agent-child').count(),count);
   assert(await page.locator('.agent-child').evaluateAll(elements=>elements.every(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return r.left>=p.left-.5&&r.right<=p.right+.5})),'Odd teams must show complete characters');
  }
  await page.evaluate(()=>{window.__agentJobs=window.__allAgents;window.BrivanyWorkspaceAgents.receive({jobs:window.__agentJobs})});await page.waitForTimeout(350);
  const active=page.locator('.agent-child[data-state=running]').first();assert.notEqual(await active.locator('.agent-mini').evaluate(e=>getComputedStyle(e).animationName),'none');
  await active.hover();await page.waitForTimeout(180);assert.equal(await page.locator('body').getAttribute('data-expanded'),'false');
  await page.getByRole('heading',{name:'Texto de bienvenida',exact:true}).waitFor();
  assert(await page.locator('#agent-cancel').isVisible());await page.locator('#agent-cancel').click();assert((await page.evaluate(()=>window.__agentCalls)).some(c=>c[0]==='cancel'));
  await page.evaluate(()=>{const job=window.__agentJobs[0];job.state='succeeded';job.review_state='accepted';job.phase='Revisado por Melodi';window.BrivanyWorkspaceAgents.receive({jobs:window.__agentJobs,selected_agent:job.id})});
  await page.locator('#agent-review').click();assert((await page.evaluate(()=>window.__agentCalls)).some(c=>c[0]==='review'));
  assert(await page.locator('#agent-review').evaluate(e=>e.getBoundingClientRect().bottom<document.querySelector('#island-content').getBoundingClientRect().bottom-10),'Result control needs bottom padding');
  await page.evaluate(()=>{const old=window.__agentJobs[1];old.state='failed';const next={...old,id:'own-fixture-corrected',state:'running',attempt:2};window.__agentJobs.push(next);window.BrivanyWorkspaceAgents.receive({jobs:window.__agentJobs})});
  assert.equal(await page.locator('.agent-child').count(),6);assert.equal(await page.locator('[data-job=own-fixture-corrected]').count(),1);
  await page.screenshot({path:dir+'/team-and-review.png'});
  await page.evaluate(()=>{window.__actualNow=Date.now;window.__shift=0;Date.now=()=>window.__actualNow()+window.__shift;const job=window.__agentJobs[0];job.state='succeeded';job.review_state='accepted';window.BrivanyWorkspaceAgents.receive({jobs:window.__agentJobs})});
  assert.equal(await page.locator('[data-job=own-fixture-0] .agent-mini-status').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(22, 134, 255)');
  assert.equal(await page.locator('[data-job=own-fixture-0] .agent-mini-status').evaluate(e=>getComputedStyle(e).animationName),'agent-done-beat');
  await page.evaluate(()=>{window.__shift+=12500;window.BrivanyWorkspaceAgents.receive({jobs:window.__agentJobs})});
  assert(await page.locator('[data-job=own-fixture-0]').evaluate(e=>e.classList.contains('leaving')));await page.waitForTimeout(150);assert(await page.locator('[data-job=own-fixture-0]').evaluate(e=>Number(getComputedStyle(e).opacity)>0&&Number(getComputedStyle(e).opacity)<1));await page.waitForTimeout(1000);assert.equal(await page.locator('[data-job=own-fixture-0]').count(),0);
  await page.evaluate(()=>{window.__agentJobs=[];window.BrivanyWorkspaceAgents.receive({jobs:[]});window.BrivanyIsland.receiveLayout({...window.__agentLayout,expanded:false,revision:++window.__agentLayout.revision})});await page.waitForTimeout(1200);
  await page.evaluate(()=>window.__shift+=90000);await page.waitForTimeout(350);assert.equal(await page.locator('body').getAttribute('data-sleeping'),'false');
  await page.evaluate(()=>window.__shift+=40000);await page.waitForTimeout(350);assert.equal(await page.locator('body').getAttribute('data-sleeping'),'true');
  await page.evaluate(()=>window.BrivanyIsland.receiveActivity({revision:2,working:true}));assert.equal(await page.locator('body').getAttribute('data-sleeping'),'false');await page.evaluate(()=>{window.__shift+=300000;window.BrivanyIsland.receiveActivity({revision:1,working:false})});await page.waitForTimeout(350);assert.equal(await page.locator('body').getAttribute('data-sleeping'),'false');
  await page.evaluate(()=>{window.BrivanyIsland.receiveActivity({revision:3,working:false});window.BrivanyWorkspace.receive({pending:true})});await page.evaluate(()=>window.__shift+=300000);await page.waitForTimeout(350);assert.equal(await page.locator('body').getAttribute('data-sleeping'),'false');await page.evaluate(()=>window.BrivanyWorkspace.receive({pending:false,speaking:true}));assert.equal(await page.locator('body').getAttribute('data-sleeping'),'false');await page.evaluate(()=>window.BrivanyWorkspace.receive({speaking:false}));
  await page.evaluate(()=>{window.__agentJobs=[{...window.__allAgents[1],state:'running'}];window.BrivanyWorkspaceAgents.receive({jobs:window.__agentJobs});window.__shift+=300000});await page.waitForTimeout(400);assert.equal(await page.locator('body').getAttribute('data-sleeping'),'false');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await active.locator('.agent-mini').evaluate(e=>getComputedStyle(e).animationName),'none');
  assert.deepEqual(errors,[]);const report={passed:true,scope:'isolated_owned_UI_with_simulated_jobs',external_calls:0,agents:6,odd_teams:[1,3,5],widths:[1280,1024,800,640,375],checks:['small_companions','working_animation','review_state','delayed_hover','cancel_and_open_result','version_identity','blue_completion_pulse','soft_departure','longer_idle_before_sleep','awake_with_working_agents','reduced_motion','bounds'],errors};fs.writeFileSync(dir+'/ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
