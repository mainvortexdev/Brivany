'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,artifacts=path.resolve(__dirname,'../tmp/personal-ui');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'block'});
    const page=await context.newPage(),errors=[],external=[],posts=[],checks=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname);});
    await page.addInitScript(()=>{window.__notificationRequests=0;if('Notification' in window)Notification.requestPermission=()=>{window.__notificationRequests++;throw Error('Notifications are forbidden in this test');};});
    const json=async route=>{const response=await page.request.get(base+route);assert.equal(response.status(),200);return response.json();};
    const notice=page.locator('[data-personal-notice]');
    const waitNotice=async expected=>{await page.waitForFunction(text=>document.querySelector('[data-personal-notice]')?.textContent===text,expected);};
    const localDate=offset=>new Date(Date.now()+offset).toISOString().slice(0,16);
    // Use the browser's clock conversion rather than assuming the host's timezone.
    const browserDate=async offset=>page.evaluate(offset=>{const date=new Date(Date.now()+offset);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);},offset);
    const create=async(text,offset)=>{
      await page.locator('[data-reminder-text]').fill(text);await page.locator('[data-reminder-at]').fill(await browserDate(offset));
      await page.locator('[data-personal-reminder-form]').getByRole('button',{name:'Guardar recordatorio',exact:true}).click();
      await waitNotice('Recordatorio guardado. El aviso local requiere que Brivany esté abierto.');
      const result=(await json('/api/personal/reminders')).items.find(item=>item.text===text);assert.ok(result);return result;
    };
    await page.goto(base+'/connections');await page.waitForFunction(()=>document.querySelector('[data-personal-reminders]')?.textContent.includes('Aún no hay recordatorios'));
    assert.equal(posts.length,0);assert.equal(await page.evaluate(()=>window.__notificationRequests),0);
    checks.push('opening reads private state without scheduling a worker, requesting notifications or making account operations');

    const due=await create('Revisar plano sintético',-120000);
    await page.locator('[data-personal-check]').click();await waitNotice('Avisos comprobados. La aceptación por WhatsApp no confirma entrega.');
    assert.equal((await json('/api/personal/reminders')).items.find(item=>item.id===due.id).state,'local_due');
    await page.reload();await page.locator('[data-reminder-id="'+due.id+'"]').waitFor();
    assert.match(await page.locator('[data-reminder-id="'+due.id+'"]').textContent(),/Pendiente aquí/);
    checks.push('an overdue local reminder becomes a persistent due item and reappears after reload without a provider send');

    const stale=await page.request.post(base+'/api/personal/reminders/'+due.id+'/complete',{headers:{Origin:base},data:{expected_revision:1}});assert.equal(stale.status(),409);
    await page.locator('[data-reminder-id="'+due.id+'"]').getByRole('button',{name:'Posponer',exact:true}).click();
    const snooze=page.locator('[data-personal-snooze-form]');await snooze.locator('input').fill(await browserDate(3600000));await snooze.getByRole('button',{name:'Guardar nueva fecha',exact:true}).click();await waitNotice('Nueva fecha guardada.');
    const scheduled=(await json('/api/personal/reminders')).items.find(item=>item.id===due.id);assert.equal(scheduled.state,'scheduled');assert.equal(scheduled.generation,2);
    await page.reload();await page.locator('[data-reminder-id="'+due.id+'"]').waitFor();assert.match(await page.locator('[data-reminder-id="'+due.id+'"]').textContent(),/Programado/);
    checks.push('snoozing persists a new date/generation while stale revisions are rejected');

    const finished=await create('Revisión completada sintética',600000);await page.locator('[data-reminder-id="'+finished.id+'"]').getByRole('button',{name:'Hecho',exact:true}).click();await waitNotice('Recordatorio marcado como completado por ti.');assert.equal(await page.locator('[data-reminder-id="'+finished.id+'"]').count(),0);
    const cancelled=await create('Revisión cancelada sintética',1200000);await page.locator('[data-reminder-id="'+cancelled.id+'"]').getByRole('button',{name:'Cancelar',exact:true}).click();await waitNotice('Recordatorio cancelado. Un envío que ya empezó puede quedar sin confirmar.');assert.equal(await page.locator('[data-reminder-id="'+cancelled.id+'"]').count(),0);
    checks.push('explicit complete/cancel controls persist terminal states and remove finished items from the active list');

    await page.getByText('Tus notas y tu cocina',{exact:true}).click();
    const form=page.locator('[data-personal-note-form]');await form.locator('input').fill('Nota sintética');await form.locator('textarea').fill('Texto <b>de prueba</b>\nSegunda línea.');await form.getByRole('button',{name:'Guardar nota',exact:true}).click();await waitNotice('Nota guardada en este equipo.');
    await page.reload();await page.getByText('Tus notas y tu cocina',{exact:true}).click();await page.locator('.personal-note').filter({hasText:'Nota sintética'}).waitFor();
    const note=page.locator('.personal-note').filter({hasText:'Nota sintética'});assert.match(await note.locator('pre').textContent(),/Texto <b>de prueba<\/b>/);assert.equal(await note.locator('pre b').count(),0);
    checks.push('authored notes persist through reload and render markup as inert text');

    await page.locator('[data-personal-capture-shopping]').click();await waitNotice('Lista de compras anotada. Revísala antes de enviarla o comprar.');
    const shopping=page.locator('.personal-note').filter({hasText:'Lista de compras · Sous'});assert.match(await shopping.locator('pre').textContent(),/150 g de Quinua sintética/);assert.ok(!(await shopping.textContent()).includes('Aceite ya comprado'));
    const notes=(await json('/api/personal/notes')).items,copy=notes.find(item=>item.kind==='sous_shopping');assert.equal(copy.source_revision,2);assert.equal(notes.length,2);
    checks.push('Sous shopping is snapshotted at its actual revision with only pending ingredients and no order');

    const before=posts.filter(route=>route.startsWith('/api/integrations/')).length;await shopping.getByRole('button',{name:'Revisar para WhatsApp',exact:true}).click();await waitNotice('Texto preparado para revisión. Todavía no se ha enviado.');
    assert.equal(await page.locator('#operation').inputValue(),'whatsapp.send');assert.equal(await page.locator('#field-text').inputValue(),copy.body);assert.equal(await page.locator('#review').isVisible(),false);assert.equal(posts.filter(route=>route.startsWith('/api/integrations/')).length,before);
    checks.push('preparing the Sous note for WhatsApp only fills the reviewed action form; it creates no proposal, approval or send');

    await note.getByRole('button',{name:'Archivar',exact:true}).click();await waitNotice('Nota archivada en este equipo.');assert.equal(await page.locator('.personal-note').filter({hasText:'Nota sintética'}).count(),0);
    const missing=await page.request.post(base+'/api/personal/notes/from-sous',{headers:{Origin:base},data:{kind:'activity',explicit:true,session_id:'22222222-2222-4222-8222-222222222222'}});assert.equal(missing.status(),404);
    const unrelated=await page.request.post(base+'/api/personal/notes',{headers:{Origin:'https://unrelated.invalid'},data:{expected_revision:0,title:'Blocked',body:'Blocked'}});assert.equal(unrelated.status(),403);
    assert.equal((await json('/api/personal/notes')).items.length,1);
    checks.push('archiving persists without deletion; missing Sous sessions and unrelated origins cannot create notes');

    fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'personal-1440.png'),fullPage:true});
    for(const width of [320,390,768]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
    await page.setViewportSize({width:390,height:1100});await page.screenshot({path:path.join(artifacts,'personal-390.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>window.__notificationRequests),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    checks.push('reminder and note controls fit narrow viewports without page errors or external traffic');
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:'passed',scope:'Loopback HTTP, persistent SQLite, actual Connections reminder/note browser controls and Sous snapshot; authored synthetic fixtures.',checks,screenshots:['tmp/personal-ui/personal-1440.png','tmp/personal-ui/personal-390.png'],api_posts:posts},null,2));
    await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
