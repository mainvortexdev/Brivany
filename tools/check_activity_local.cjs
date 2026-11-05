/* Read-only integration against the real local ledger. No provider or device access. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {chromium} = require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.BRIVANY_TEST_URL || 'http://127.0.0.1:8765';
(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  try {
    const context = await browser.newContext({serviceWorkers:'block'}), page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', route => {
      const request = route.request(); requests.push(request.method() + ' ' + request.url());
      if(new URL(request.url()).origin !== new URL(base).origin || request.method() !== 'GET') return route.abort();
      return route.continue();
    });
    const response = await page.goto(base + '/activity'); assert.equal(response.status(),200);
    await page.waitForFunction(() => document.querySelectorAll('.activity-item').length > 0);
    const listingResponse = await context.request.get(base + '/api/activity');
    const listing = await listingResponse.json();
    assert.equal(listing.integrity.valid,true); assert.equal(listing.entries.length,await page.locator('.activity-item').count());
    const entry = listing.entries.find(entry => entry.evidence.length > 0), evidence = entry.evidence[0];
    const downloaded = await context.request.get(base + evidence.url); assert.equal(downloaded.status(),200);
    const digest = crypto.createHash('sha256').update(await downloaded.body()).digest('hex');
    assert.equal(digest,evidence.sha256); assert.equal(evidence.integrity,'ok');
    await page.locator('.entry-details summary').first().click();
    fs.mkdirSync('tmp/ui',{recursive:true});
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      await page.screenshot({path:`tmp/ui/activity-local-${width}.png`,fullPage:true});
    }
    assert.deepEqual(errors,[]);
    assert.ok(requests.every(request => request.startsWith('GET ' + base)));
    const report = {checked_at:new Date().toISOString(),status:'passed',api:'real_local',
      entries:listing.entries.length,chain_valid:listing.integrity.valid,evidence_sha256_matches:true,
      evidence_url:evidence.url,external_calls:0,gpu_seconds:0,http_mutations:0,physical_devices:false,
      screenshots:['tmp/ui/activity-local-1440.png','tmp/ui/activity-local-390.png'],
      limitations:['Verifica integración de lectura y hash; no reconstrucción 3D ni semántica de los informes.']};
    fs.writeFileSync('tmp/ui/activity-local-check.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2)); await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
