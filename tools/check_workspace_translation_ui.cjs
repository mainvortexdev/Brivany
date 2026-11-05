'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base=process.env.BRIVANY_TEST_URL,dir='tmp/workspace-translation-ui';fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({channel:'msedge',headless:true});let state={active:false,state:'idle',caption:'',error:'',target:'en',voice:'auto',mode:'direct'},syncState={available:false,active_sessions:0,paired_browsers:0},cloning={enabled:false,language:'es'},revision=0;const calls=[],errors=[];let popup,bar;let browserStarts=0,showTranscript=true;
 try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const deliver=async()=>{for(const p of [bar,popup].filter(Boolean))await p.evaluate(s=>window.BrivanyTranslation?.receive(s),state);};
  await context.exposeBinding('__status',()=>({active:true,jobs:[],schedules:[],live:{},audio_translation:state,voice_cloning:cloning}));
  await context.exposeBinding('__clones',(_s,enabled,language,consent)=>{assert(!state.active);assert.equal(consent,enabled);cloning={enabled,language};calls.push(['clones',enabled,language]);return cloning;});
  await context.exposeBinding('__start',async(_s,target,voice)=>{calls.push(['start',target,voice]);state={...state,active:true,state:'listening',target,voice};await deliver();return state;});
  await context.exposeBinding('__browserStart',async(_s,target,voice)=>{browserStarts++;calls.push(['start',target,voice]);state={...state,active:true,state:'listening',target,voice};await deliver();return state;});
  await context.exposeBinding('__transcriptPreference',(_s,value)=>{if(typeof value==='boolean')showTranscript=value;return {show_transcript:showTranscript};});
  await context.exposeBinding('__stop',async()=>{calls.push(['stop']);state={...state,active:false,state:'stopped'};await deliver();return state;});
  await context.exposeBinding('__voice',async(_s,mode)=>{calls.push(['voice',mode]);state={...state,voice:mode};await deliver();return state;});
  await context.exposeBinding('__target',async(_s,target)=>{calls.push(['target',target]);state={...state,target};await deliver();return state;});
  await context.exposeBinding('__mode',async(_s,mode)=>{calls.push(['mode',mode]);state={...state,mode};await deliver();return {mode};});
  await context.exposeBinding('__syncStatus',()=>syncState);
  await context.exposeBinding('__syncPrepare',(_s,mode)=>{calls.push(['sync_prepare',mode]);syncState={...syncState,available:true,preferred_mode:mode};return syncState;});
  await context.exposeBinding('__navigate',(_s,module)=>{assert.equal(module,'connections');assert.notEqual(state.mode,'direct');calls.push(['navigate',module]);});
  await context.exposeBinding('__layout',async(_s,open,_size,panel,_motion,_manual,x)=>{
   const meta={expanded:open,panel,width:400,height:240,clip_left:8,anchor_x:x,revision:++revision};for(const p of [bar,popup].filter(Boolean))await p.evaluate(m=>window.BrivanyIsland?.receiveLayout(m),meta);return meta;
  });
  await context.addInitScript(()=>{window.pywebview={api:{work_status:()=>window.__status(),work_voice_cloning:(...a)=>window.__clones(...a),work_audio_translation_mode:m=>window.__mode(m),work_sync_translation_status:()=>window.__syncStatus(),work_sync_translation_prepare:m=>window.__syncPrepare(m),work_audio_translation_start:(...a)=>window.__start(...a),work_browser_translation_start:(...a)=>window.__browserStart(...a),work_translation_preferences:(...a)=>window.__transcriptPreference(...a),work_audio_translation_stop:()=>window.__stop(),work_audio_translation_voice:mode=>window.__voice(mode),work_audio_translation_target:t=>window.__target(t),work_island_layout:(...a)=>window.__layout(...a),work_island_pointer:async()=>null,work_island_keyboard:async()=>({}),work_island_gaze:async()=>({x:0,y:0}),spotify_status:async()=>({connected:false}),workspace_open_module:m=>window.__navigate(m)}};});
  bar=await context.newPage();popup=await context.newPage();await popup.setViewportSize({width:780,height:404});for(const p of [bar,popup])p.on('pageerror',e=>errors.push(e.message));
  await bar.goto(base+'/work-widget?surface=bar');await popup.goto(base+'/work-widget?surface=panel');
  assert.equal(calls.length,0);await bar.getByRole('button',{name:'Traducción auditiva',exact:true}).click();await popup.getByRole('button',{name:'Detener',exact:true}).waitFor();assert.deepEqual(calls,[['start','en','auto']]);
  await bar.getByRole('button',{name:'Traducción auditiva',exact:true}).click();assert.equal(calls.filter(c=>c[0]==='start').length,1);
  state={...state,caption:'The train arrives tomorrow at nine.',voice_category:'feminine',speaker_label:'Hablante 2',speaker_index:2};await deliver();await popup.getByText('The train arrives tomorrow at nine.',{exact:true}).waitFor();assert.equal(await popup.locator('#auditory-speaker').textContent(),'Hablante 2');
  await popup.getByRole('button',{name:'Femenina',exact:true}).click();assert(calls.some(c=>c[0]==='voice'&&c[1]==='feminine'));
  assert.equal(await popup.locator('select#auditory-target').count(),0);for(const language of ['Français','Español','English'])await popup.getByRole('button',{name:language,exact:true}).click();assert.equal(calls.filter(c=>c[0]==='target').length,3);
  for(const width of [780,460,390,320,280]){
   await popup.setViewportSize({width,height:404});await popup.evaluate(()=>window.BrivanyIsland.receiveLayout({expanded:true,panel:'auditory',width:Math.min(400,innerWidth-16),height:Math.min(400,innerWidth-16)<350?360:320,clip_left:8,revision:1000}));
   assert(await popup.getByRole('button',{name:'Detener',exact:true}).isVisible());assert(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const bounds=await popup.getByRole('button',{name:'Detener',exact:true}).boundingBox(),panel=await popup.locator('#island-content').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=panel.y+panel.height,'Stop must fit the actual native panel region');
   if(width===390)await popup.screenshot({path:dir+'/translation-390.png'});
  }
  await popup.getByRole('button',{name:'Detener',exact:true}).click();assert(calls.some(c=>c[0]==='stop'));await popup.getByRole('button',{name:'Español',exact:true}).click();
  await bar.getByRole('button',{name:'Traducción auditiva',exact:true}).click();assert.deepEqual(calls.filter(c=>c[0]==='start').at(-1),['start','es','feminine']);
  await popup.getByRole('button',{name:'Detener',exact:true}).click();
  await popup.getByLabel('Clonar voces autorizadas',{exact:true}).check();await popup.getByRole('button',{name:'EN',exact:true}).click();assert.deepEqual(cloning,{enabled:true,language:'en'});
  for(const width of [780,390,320,280]){
   await popup.setViewportSize({width,height:404});await popup.evaluate(()=>window.BrivanyIsland.receiveLayout({expanded:true,panel:'auditory',width:Math.min(400,innerWidth-16),height:Math.min(400,innerWidth-16)<350?360:320,clip_left:8,revision:1000}));
   const stop=await popup.locator('#auditory-toggle').boundingBox(),panel=await popup.locator('#island-content').boundingBox(),source=await popup.locator('#auditory-clone-language').boundingBox();assert(stop.y+stop.height<=panel.y+panel.height);assert(source.x+source.width<=panel.x+panel.width);assert(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  state={...state,active:true,voice:'auto',voice_agents:{speakers:[{ready:true}]}};await deliver();assert(await popup.getByLabel('Clonar voces autorizadas',{exact:true}).isDisabled());await popup.getByText(/1 voz preparada/).waitFor();await popup.getByRole('button',{name:'Detener',exact:true}).click();
  await popup.getByRole('button',{name:'Preproducción',exact:true}).click();await bar.waitForFunction(()=>document.querySelector('[data-auditory-mode=preproduction]').getAttribute('aria-pressed')==='true');await popup.getByRole('button',{name:'Vincular navegador',exact:true}).click();assert(calls.some(c=>c[0]==='sync_prepare'&&c[1]==='preproduction'));assert(!calls.some(c=>c[0]==='navigate'),'preparing a video must not open the main app');
  await popup.getByRole('button',{name:'Navegador',exact:true}).click();await bar.waitForFunction(()=>document.querySelector('[data-auditory-mode=synchronized]').getAttribute('aria-pressed')==='true');
  syncState={...syncState,selected_video:{selected:true,state:'ready'}};state={...state,mode:'direct'};await bar.getByRole('button',{name:'Traducción auditiva',exact:true}).click();await popup.getByRole('button',{name:'Detener',exact:true}).waitFor();assert(calls.filter(c=>c[0]==='start').length>=3);assert(!calls.some(c=>c[0]==='navigate'));await popup.getByRole('button',{name:'Detener',exact:true}).click();
  assert(browserStarts>0);const settings=await context.newPage();settings.on('pageerror',e=>errors.push(e.message));await settings.goto(base+'/settings#work');const transcript=settings.getByLabel('Mostrar transcripción en el navegador',{exact:true});await transcript.waitFor();assert(await transcript.isChecked());await transcript.uncheck();assert.equal(showTranscript,false);await settings.reload();await transcript.waitFor();assert(!(await transcript.isChecked()));await transcript.check();assert.equal(showTranscript,true);for(const width of [1024,640,390]){await settings.setViewportSize({width,height:800});assert(await settings.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}await settings.close();
  assert.deepEqual(errors,[]);fs.writeFileSync(dir+'/report.json',JSON.stringify({passed:true,native_bridge:'substituted',external_calls:0,one_click_starts_english_auto:true,workspace_triggers_browser:true,transcript_preference_default_and_reload:true,no_app_navigation:true,repeated_click_does_not_duplicate:true,stop_and_voice_controls:true,widths:[780,460,390,320,280],errors},null,2));console.log('Workspace auditory: one click, no navigation, caption, voice/stop, five widths passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
