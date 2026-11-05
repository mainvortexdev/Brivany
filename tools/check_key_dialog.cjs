/* Isolated form test. The dummy credential never reaches the configuration endpoint. */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const base=process.env.BRIVANY_TEST_URL||'http://127.0.0.1:8765';
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
    let submitted=false;
    await context.route('**/api/config/meta',route=>{submitted=true;return route.fulfill({json:{saved:true}});});
    await page.goto(base+'/app?setup=meta');
    assert.equal(await page.locator('#meta-key-dialog').isVisible(),true);
    assert.equal(await page.locator('#meta-api-key').getAttribute('type'),'password');
    assert.equal(await page.locator('#meta-api-key').getAttribute('autocomplete'),'off');
    assert.equal(await page.locator('#meta-api-key').inputValue(),'');
    await page.locator('#meta-api-key').fill('dummy-not-a-real-key-0123456789');
    await page.locator('#meta-key-save').click();
    await page.waitForFunction(()=>document.querySelector('#meta-key-status').textContent.startsWith('Clave guardada'));
    assert.ok(submitted);assert.equal(await page.locator('#meta-api-key').inputValue(),'');
    assert.ok(!(await page.locator('body').innerText()).includes('dummy-not-a-real-key'));
    assert.ok(!(await page.locator('body').innerText()).includes('Emily'));
    console.log('Modal local visible; campo oculto; no reflejo de la clave; campo borrado; identidad Melodi. Guardado real no ejecutado.');
    await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
