/* Development UI check: isolated browser, mocked provider/API, synthetic MP4. No Meta calls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const base=process.env.BRIVANY_TEST_URL||'http://127.0.0.1:8765';
const fixture='tmp/human-skills-test/demo-sintetica-oratoria.mp4',video=fs.readFileSync(fixture);
const hash=crypto.createHash('sha256').update(video).digest('hex');
const draft={status:'ready',reason:'',title:'Explica una idea con claridad',domain:'communication',objective:'Explicar una idea con un ejemplo y un cierre.',summary:'Demostración sintética de tres pasos.',prerequisites:[],limitations:['Propuesta del modelo; revisa el video.'],
  steps:['Una idea','Un ejemplo','Un cierre'].map((title,i)=>({title,instruction:'Explica tu idea en una frase.',why:'Ayuda a seguir el mensaje.',evidence:{start_seconds:i*3,end_seconds:(i+1)*3,observation:'El video muestra el paso: '+title,modality:'visual'},exercise:{guided:'Usa una frase para explicar tu idea.',hinted:'Piensa en una sola idea.',independent:'Elige otro tema sin usar la plantilla.'},success_check:'Comprueba si alguien puede repetir la idea.',common_mistake:'Mezclar varios temas.'})),transfer_exercise:{instruction:'Explica otro tema a otra audiencia.',success_check:'Pide que repitan lo que entendieron.'}};
const skill={id:'11111111-1111-4111-8111-111111111111',version:'0.1.0',lifecycle:'draft',created_at:new Date().toISOString(),source:{filename:'demo-sintetica-oratoria.mp4',sha256:hash,duration_seconds:9},analysis:{model:'mock',usage:{},latency_ms:1},draft,progress:{completed_steps:[],transfer_completed:false}};
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  try{
    let submissions=0,exists=false,job=null,polls=0;const errors=[],checks=[];
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/api/human-skills**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname,method=req.method();let body;
      if(path==='/api/human-skills'&&method==='GET')body={skills:exists?[{id:skill.id,title:draft.title,objective:draft.objective,domain:draft.domain,step_count:3,completed_steps:skill.progress.completed_steps.length}]:[],active_job:job?.status==='processing'?job:null,capabilities:{configured:true,model:'mock',max_bytes:26214400,max_duration_seconds:300,video_validation_available:true}};
      else if(path==='/api/human-skills/jobs'&&method==='POST'){
        assert.equal(req.headers()['x-brivany-consent'],'true');assert.equal(req.headers()['content-type'],'video/mp4');
        assert.equal(req.postDataBuffer().length,video.length);submissions++;
        job={id:'job-test',status:exists?'complete':'processing',phase:'Comprobando el video…',skill_id:exists?skill.id:null,error:null,reused:exists};body={job};
      }else if(path==='/api/human-skills/jobs/job-test'){
        polls++;exists=true;job={...job,status:'complete',skill_id:skill.id};body={job};
      }else if(path.endsWith('/progress')){skill.progress=req.postDataJSON();body={skill};}
      else if(method==='DELETE'){exists=false;body={deleted:true};}
      else body={skill};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(base+'/human-skills');
    assert.equal(submissions,0);assert.equal(await page.locator('#create-skill').isDisabled(),true);
    await page.locator('#video-file').setInputFiles(fixture);
    await page.waitForFunction(()=>!document.querySelector('#upload-preview').hidden);
    assert.equal(await page.locator('#create-skill').isDisabled(),true);checks.push('video preview and explicit consent before sending');
    await page.locator('#send-consent').check();await page.locator('#create-skill').click();
    await page.waitForFunction(()=>!document.querySelector('#skill-view').hidden);
    assert.equal(submissions,1);assert.ok(polls>0);checks.push('one creation and polled job opens saved draft');
    await page.locator('#show-evidence').click();assert.equal(await page.locator('#source-video').isVisible(),true);
    assert.match(await page.locator('#source-notice').textContent(),/comprobado/);checks.push('source SHA256 match permits timestamp playback');
    await page.locator('#help-level').selectOption('independent');assert.equal(await page.locator('#step-instruction').isVisible(),false);
    assert.match(await page.locator('#exercise-instruction').textContent(),/otro tema/);checks.push('three help levels preserve exercise and review criterion');
    await page.locator('#step-completed').check();await page.waitForFunction(()=>document.querySelector('#progress-label').textContent.startsWith('1 de'));
    await page.locator('#next-step').click();assert.match(await page.locator('#step-counter').textContent(),/2 DE 3/);
    await page.locator('#transfer-completed').check();await page.waitForFunction(()=>!document.querySelector('#transfer-completed').disabled);
    assert.equal(skill.progress.transfer_completed,true);assert.equal(skill.lifecycle,'draft');checks.push('manual progress saved without competency claims');
    const download=page.waitForEvent('download');await page.locator('#export-skill').click();assert.match((await download).suggestedFilename(),/brivany-human-skill/);checks.push('JSON export');
    fs.mkdirSync('tmp/ui',{recursive:true});
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if([390,1440].includes(width))await page.screenshot({path:`tmp/ui/human-skill-${width}.png`,fullPage:true});
    }checks.push('skill layout fits 320/390/768/1440');
    await page.reload();await page.locator('.library-item').click();assert.equal(await page.locator('#source-video').isVisible(),false);
    await page.locator('#show-evidence').click();assert.match(await page.locator('#source-notice').textContent(),/original/);checks.push('reload preserves skill and requires original video for citations');
    await page.locator('#source-file').setInputFiles({name:'different.mp4',mimeType:'video/mp4',buffer:Buffer.concat([video,Buffer.from([0,0])])});
    await page.waitForFunction(()=>document.querySelector('#source-notice').textContent.includes('no coincide'));
    assert.equal(await page.locator('#source-video').isVisible(),false);checks.push('wrong source never plays evidence');
    await page.locator('#delete-skill').click();await page.locator('#confirm-delete').click();await page.waitForFunction(()=>!document.querySelector('#create-view').hidden);
    assert.equal(exists,false);checks.push('delete removes local draft');
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if([390,1440].includes(width))await page.screenshot({path:`tmp/ui/human-skills-create-${width}.png`,fullPage:true});
    }checks.push('creation layout fits 320/390/768/1440');
    assert.deepEqual(errors,[]);assert.equal(submissions,1);
    console.log(JSON.stringify({checks:checks.length,passed:checks,meta_calls:0,physical_devices:false},null,2));await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
