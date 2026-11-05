'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.BRIVANY_TEST_URL,artifacts=path.resolve(__dirname,'../tmp/social-ui');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'block'}),page=await context.newPage();
    const errors=[],external=[],posts=[],checks=[];
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort();}return route.continue();});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname);});
    const waitNotice=async text=>page.waitForFunction(text=>document.querySelector('[data-social-notice]')?.textContent===text,text);
    const request=async(route,data)=>{const response=await page.request.post(base+route,{headers:{Origin:base},data});assert.ok(response.ok());return response.json();};
    const stored=async()=>{const response=await page.request.get(base+'/api/integrations/social/drafts');assert.equal(response.status(),200);return (await response.json()).drafts;};
    const row=title=>page.locator('.social-draft').filter({has:page.locator('strong',{hasText:title})});
    const review=async title=>{await row(title).getByRole('button',{name:/^Revisar (publicación|preparación|campaña)/}).first().click();await page.waitForFunction(()=>!document.querySelector('#review').hidden);};
    const confirm=async()=>{const response=page.waitForResponse(value=>new URL(value.url()).pathname==='/api/integrations/execute');await page.locator('#confirm-operation').click();const result=await (await response).json();assert.equal(result.state,'succeeded_test_stub');await page.waitForFunction(()=>document.querySelector('#review').hidden);return result;};
    await page.goto(base+'/connections');await page.waitForFunction(()=>document.querySelector('[data-social-drafts]')?.textContent.includes('Tus borradores'));
    assert.equal(posts.length,0);assert.match(await page.locator('#social-connections').textContent(),/revisa y confirma/);
    checks.push('opening Connections reads local social state without account requests, drafts, secret writes or publication');

    await page.getByText('Configurar cuentas de Meta',{exact:true}).click();
    await page.locator('#social-page-ids').fill('123456');await page.locator('#social-instagram-ids').fill('234567');await page.locator('#social-ad-ids').fill('act_345678');await page.locator('#social-media-hosts').fill('media.example.com');
    await page.getByText('Permisos concedidos en Meta',{exact:true}).click();for(const name of ['pages_show_list','pages_manage_posts','instagram_basic','instagram_content_publish','ads_management'])await page.locator('#social-permission-'+name).check();
    await page.getByText('Monedas de cuentas publicitarias',{exact:true}).click();await page.locator('#social-currencies').fill('act_345678 USD');await page.locator('#social-currency-verified').check();await page.locator('#social-execution-enabled').check();
    await page.locator('#social-config').getByRole('button',{name:'Guardar cuentas y permisos',exact:true}).click();await waitNotice('Cuentas guardadas. Los permisos declarados y el acceso real siguen por comprobar.');
    await page.getByText('Autorizaciones privadas',{exact:true}).click();for(const name of ['BRIVANY_META_SOCIAL_USER_TOKEN','BRIVANY_FACEBOOK_PAGE_TOKEN','BRIVANY_INSTAGRAM_ACCESS_TOKEN','BRIVANY_META_ADS_ACCESS_TOKEN'])await page.locator('#social-token-'+name).fill('SYNTHETIC-TOKEN-FOR-LOCAL-TEST-ONLY');
    await page.locator('#social-credentials').getByRole('button',{name:'Guardar autorizaciones',exact:true}).click();await waitNotice('Autorizaciones guardadas en este equipo. No se realizó ninguna publicación.');
    for(const input of await page.locator('#social-credentials input').all())assert.equal(await input.inputValue(),'');assert.ok(!(await page.locator('#social-connections').textContent()).includes('SYNTHETIC-TOKEN'));
    const enabledResponse=page.waitForResponse(value=>new URL(value.url()).pathname==='/api/integrations/settings');await page.locator('#enable-execution').check();await enabledResponse;
    checks.push('explicit setup saves allowed targets and declared permissions; credentials clear from inputs and remain absent from displayed state');

    await page.locator('#social-title').fill('Idea de Facebook');await page.locator('#social-target').selectOption('123456');await page.locator('#social-copy').fill('Texto inicial sintético');
    const beforeSave=posts.length;assert.equal((await stored()).length,0);assert.equal(posts.length,beforeSave);
    await page.locator('#social-draft-form').getByRole('button',{name:'Guardar borrador',exact:true}).click();await waitNotice('Borrador guardado · versión 1. Todavía no se ha publicado.');
    await page.reload();await row('Idea de Facebook').waitFor();assert.match(await row('Idea de Facebook').textContent(),/versión 1/);
    await row('Idea de Facebook').getByRole('button',{name:'Editar',exact:true}).click();await page.locator('#social-copy').fill('Texto actualizado <b>sintético</b>');await page.locator('#social-draft-form').getByRole('button',{name:'Guardar borrador',exact:true}).click();await waitNotice('Borrador guardado · versión 2. Todavía no se ha publicado.');
    const fb=(await stored()).find(item=>item.draft.kind==='facebook_post');assert.equal(fb.revision,2);assert.equal(await row('Idea de Facebook').locator('b').count(),0);
    const stale=await page.request.post(base+'/api/integrations/social/drafts',{headers:{Origin:base},data:{draft_id:fb.id,expected_revision:1,draft:{...fb.draft,copy:'Stale'}}});assert.equal(stale.status(),409);
    checks.push('drafts save only explicitly, survive reload, render inert copy and reject stale revisions');

    await review('Idea de Facebook');assert.match(await page.locator('#review-content').textContent(),/Texto actualizado <b>sintético<\/b>/);await page.locator('#cancel-operation').click();assert.equal(await page.locator('#review').isVisible(),false);
    await review('Idea de Facebook');const published=await confirm();assert.equal(published.result.publication_accepted,true);assert.equal(published.result.visibility_verified,false);
    checks.push('the shared human-readable review can cancel or confirm exact saved Facebook text; simulated acceptance does not imply visibility');

    await page.locator('#social-connections').getByRole('button',{name:'Nuevo borrador',exact:true}).click();await page.locator('#social-kind').selectOption('instagram_image');await page.locator('#social-target').selectOption('234567');await page.locator('#social-title').fill('Imagen de Instagram');await page.locator('#social-copy').fill('Interior sintético');await page.locator('#social-image-url').fill('https://media.example.com/fixture.jpg');
    await page.getByText('Referencia de la imagen',{exact:true}).click();await page.locator('#social-image-ref').fill('fixture-image');await page.locator('#social-image-hash').fill('a'.repeat(64));await page.locator('#social-draft-form').getByRole('button',{name:'Guardar borrador',exact:true}).click();await waitNotice('Borrador guardado · versión 1. Todavía no se ha publicado.');
    assert.equal(await row('Imagen de Instagram').getByRole('button',{name:'Revisar publicación de imagen',exact:true}).count(),0);
    await review('Imagen de Instagram');const prepared=await confirm();assert.equal(prepared.result.container_created,true);assert.equal(prepared.result.publication_accepted,false);
    await row('Imagen de Instagram').getByRole('button',{name:'Revisar publicación de imagen',exact:true}).waitFor();await row('Imagen de Instagram').getByRole('button',{name:'Revisar publicación de imagen',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#review').hidden);const instagram=await confirm();assert.equal(instagram.result.publication_accepted,true);
    checks.push('Instagram preparation uses a declared JPEG reference without fetching it; publication requires a second review bound to the returned container');

    await page.locator('#social-connections').getByRole('button',{name:'Nuevo borrador',exact:true}).click();await page.locator('#social-kind').selectOption('ad_campaign');await page.locator('#social-target').selectOption('act_345678');await page.locator('#social-title').fill('Campaña inmobiliaria');await page.locator('#social-budget').fill('12.34');await page.locator('#social-currency').fill('USD');await page.locator('#social-countries').fill('BO');await page.locator('#social-age-min').fill('18');await page.locator('#social-age-max').fill('65');await page.locator('#social-objective').selectOption('OUTCOME_LEADS');await page.getByText('Categorías publicitarias especiales',{exact:true}).click();await page.locator('#social-category-HOUSING').check();
    await page.locator('#social-draft-form').getByRole('button',{name:'Guardar borrador',exact:true}).click();await waitNotice('Borrador guardado · versión 1. Todavía no se ha publicado.');await review('Campaña inmobiliaria');assert.match(await page.locator('#review-content').textContent(),/12\.34/);assert.match(await page.locator('#review-content').textContent(),/pausada|paused/i);const campaign=await confirm();assert.equal(campaign.result.ad_delivery_started,false);assert.equal(campaign.result.spending_authorized,false);assert.ok(campaign.result.remaining_ad_components.includes('adset_targeting'));
    checks.push('budget, currency, countries, ages and special category are saved and reviewed; the only campaign action remains PAUSED without active ads or spend');

    await page.getByText('Consultar mis redes',{exact:true}).click();await page.locator('#social-read-form').getByRole('button',{name:'Consultar ahora',exact:true}).click();await waitNotice('Consulta terminada. No se publicó ni cambió contenido.');const readText=await page.locator('[data-social-read-results]').textContent();assert.match(readText,/Página sintética/);assert.match(readText,/simulada/);assert.match(readText,/más resultados/);assert.ok(!readText.includes('NEVER-SURFACE'));
    checks.push('an explicit social read strips provider token fields, labels substituted data and never follows pagination automatically');

    await page.reload();await row('Campaña inmobiliaria').waitFor();assert.equal((await stored()).length,3);assert.equal(await page.locator('[data-social-read-results]').textContent(),'');assert.equal(await page.locator('#social-token-BRIVANY_FACEBOOK_PAGE_TOKEN').inputValue(),'');
    const rejected=await page.request.post(base+'/api/integrations/social/read',{headers:{Origin:'https://unrelated.invalid'},data:{operation:'facebook.pages',parameters:{}}});assert.equal(rejected.status(),403);
    checks.push('drafts and configuration persist while read results and typed secrets do not; unrelated origins cannot request account reads');

    fs.mkdirSync(artifacts,{recursive:true});await page.screenshot({path:path.join(artifacts,'social-1440.png'),fullPage:true});
    for(const width of [320,390,768]){await page.setViewportSize({width,height:1100});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
    await page.setViewportSize({width:390,height:1100});await page.screenshot({path:path.join(artifacts,'social-390.png'),fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    checks.push('social setup, drafts and shared review fit desktop and narrow screens without page errors or external asset loads');
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:'passed',scope:'Actual Connections UI, shared review/approval/execute, SQLite drafts and HTTP with substituted Meta Graph.',checks,screenshots:['tmp/social-ui/social-1440.png','tmp/social-ui/social-390.png'],post_counts:posts.reduce((counts,key)=>(counts[key]=(counts[key]||0)+1,counts),{})},null,2));
    await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
