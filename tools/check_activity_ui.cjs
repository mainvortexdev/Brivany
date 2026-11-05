/* Isolated ledger UI check. Local files + mocked API; never calls paid providers. */
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:8767';
const entries=[
  {id:'entry-2',recorded_at:'2026-10-27T17:00:00Z',kind:'test',status:'passed',title:'Captura espacial: empaquetado',summary:'Prueba sintética. No mide reconstrucción 3D.',verification:'evidenced',cost:{external_calls:0,gpu_seconds:0},evidence:[{label:'Informe local',sha256:'a'.repeat(64),size_bytes:452,url:'/api/activity/entry-2/evidence/0',integrity:'ok'}]},
  {id:'entry-1',recorded_at:'2026-10-27T16:00:00Z',kind:'idea',status:'pending',title:'Traducción de videos en vivo',summary:'<img src=x onerror=alert(1)> Capacidad pendiente.',verification:'recorded',cost:{external_calls:null,gpu_seconds:null},evidence:[]}
];
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  try {
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true});
    const page=await context.newPage(),errors=[],checks=[]; let fail=false,empty=false,more=false,mutations=0,requests=0;
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(request.method()!=='GET')mutations++;
      if(url.origin!==base)return route.abort('blockedbyclient');
      if(url.pathname==='/api/activity'){
        requests++;
        const paged=url.searchParams.has('before'),current=empty?[]:paged?[{...entries[1],id:'entry-older',title:'Registro anterior'}]:entries;
        return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify({entries:current,integrity:{valid:true,entries:empty?0:more?3:2},scope:'local',has_more:more&&!paged,next_before:more&&!paged?2:null})});
      }
      const name=url.pathname==='/activity'?'activity.html':url.pathname.slice(1);
      if(!['activity.html','activity.css','activity.js','palette.css','icon.svg'].includes(name))return route.fulfill({status:404,body:'not found'});
      await route.fulfill({status:200,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html',body:fs.readFileSync(path.join(root,'web',name))});
    });
    await page.goto(base+'/activity');
    await page.waitForFunction(()=>document.querySelectorAll('.activity-item').length===2);
    assert.equal(await page.locator('#entry-count').textContent(),'2');
    assert.equal(await page.locator('#integrity-label').textContent(),'Cadena local íntegra');
    checks.push('API-backed ledger and integrity status');
    await page.locator('details.entry-details').first().locator('summary').click();
    assert.match(await page.locator('.evidence-hash').first().textContent(),/aaaa/);
    assert.match(await page.locator('.detail-body').first().textContent(),/0 llamadas externas/);
    assert.equal(await page.locator('.evidence-heading a').getAttribute('href'),base+'/api/activity/entry-2/evidence/0');
    checks.push('evidence SHA, local link and recorded zero cost');
    await page.locator('#activity-kind').selectOption('idea');
    assert.equal(await page.locator('.activity-item').count(),1);
    assert.match(await page.locator('.entry-summary').textContent(),/<img/);
    assert.equal(await page.locator('.entry-summary img').count(),0);
    checks.push('type filter and escaped third-party content');
    await page.locator('#activity-status').selectOption('passed');
    assert.equal(await page.locator('#activity-empty').isVisible(),true);
    checks.push('empty filtered results');
    await page.locator('#activity-status').selectOption('');await page.locator('#activity-kind').selectOption('');
    await page.locator('#activity-search').fill('espacial');assert.equal(await page.locator('.activity-item').count(),1);
    await page.locator('#activity-search').fill('');checks.push('text search');
    const download=page.waitForEvent('download');await page.locator('#export-activity').click();
    const downloaded=await download;assert.match(downloaded.suggestedFilename(),/brivany-bitacora/);
    const exported=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8'));assert.equal(exported.entries.length,2);
    checks.push('JSON snapshot export');
    const imageDir=path.join(root,'tmp','ui');fs.mkdirSync(imageDir,{recursive:true});
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if([390,1440].includes(width))await page.screenshot({path:path.join(imageDir,`activity-${width}.png`),fullPage:true});
    }
    checks.push('layout fits 320/390/768/1440 px');
    fail=true;await page.locator('#refresh-activity').click();
    await page.waitForFunction(()=>!document.querySelector('#activity-error').hidden);
    assert.equal(await page.locator('.activity-item').count(),2);checks.push('refresh failure preserves prior results');
    fail=false;empty=true;await page.locator('#refresh-activity').click();
    await page.waitForFunction(()=>document.querySelector('#entry-count').textContent==='0');
    assert.equal(await page.locator('#activity-empty').isVisible(),true);checks.push('empty ledger');
    empty=false;more=true;await page.locator('#refresh-activity').click();
    await page.waitForFunction(()=>!document.querySelector('#load-older-activity').hidden);
    await page.locator('#load-older-activity').click();
    await page.waitForFunction(()=>document.querySelectorAll('.activity-item').length===3);
    assert.equal(await page.locator('#entry-count').textContent(),'3');
    assert.equal(await page.locator('#load-older-activity').isVisible(),false);checks.push('cursor pagination retains earlier loaded entries');
    assert.deepEqual(errors,[]);assert.equal(mutations,0);
    const report={checks:checks.length,passed:checks,external_calls:0,gpu_seconds:0,api:'simulated',http_mutations:mutations,local_api_requests:requests,physical_devices:false,screenshots:['tmp/ui/activity-390.png','tmp/ui/activity-1440.png']};
    fs.writeFileSync(path.join(imageDir,'activity-check.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    await context.close();
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
