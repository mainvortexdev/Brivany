/* UI con audio simulado. No usa cámara/micrófono real ni APIs de modelos. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const base = process.env.BRIVANY_TEST_URL || 'http://127.0.0.1:8765';

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.BRIVANY_BROWSER_CHANNEL ? {channel:process.env.BRIVANY_BROWSER_CHANNEL} : {})});
  const report = [];
  try {
    const iconPage = await browser.newPage({viewport:{width:512,height:512}});
    const svg = fs.readFileSync(path.join(root,'web/icon.svg'),'utf8');
    for (const size of [192,512]) {
      await iconPage.setViewportSize({width:size,height:size});
      await iconPage.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      await iconPage.screenshot({path:path.join(root,`web/icon-${size}.png`),omitBackground:true});
    }
    await iconPage.close();
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    await context.route('**/api/status', route => route.fulfill({json:{voice:{asr:{configured:false,available:false},tts:{configured:false}}}}));
    await context.addInitScript(() => {
      window.__mediaCalls=0; window.__spoken=[]; window.__stopped=0; window.__cancelled=0;
      const synth = {getVoices:()=>[
        {name:'Voz de prueba ES',lang:'es-ES',voiceURI:'test-es',localService:true},
        {name:'Voz de prueba EN',lang:'en-US',voiceURI:'test-en',localService:true},
        {name:'Remota excluida',lang:'es-ES',voiceURI:'remote',localService:false}],
        cancel(){window.__cancelled++;},addEventListener(){},speak(utterance){window.__spoken.push(utterance.text);setTimeout(()=>utterance.onend?.(),30);}};
      Object.defineProperty(window,'speechSynthesis',{value:synth,configurable:true});
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      class Recognition {constructor(){window.__recognition=this;}start(){}abort(){this.onend?.();}stop(){this.onend?.();}}
      window.SpeechRecognition=Recognition;
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        window.__mediaCalls++;
        const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),out=audio.createMediaStreamDestination();
        gain.gain.value=0.001;osc.connect(gain);gain.connect(out);osc.start();
        for(const track of out.stream.getTracks()){const original=track.stop.bind(track);track.stop=()=>{window.__stopped++;original();audio.close();};}
        return out.stream;
      }});
    });
    const page = await context.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/app'); await page.waitForSelector('#mic-toggle');
    assert.equal(await page.evaluate(()=>window.__mediaCalls),0);
    assert.equal(await page.locator('#voice-select option:not([disabled])').count(),1); report.push('permiso inicial y voz local disponible');
    await page.locator('#live-text').fill('Eh, este, o sea, presento una idea.');
    await page.locator('#submit-fragment').click();
    assert.equal(await page.locator('#filler-count').textContent(),'3'); report.push('revisión local de muletillas');
    await page.locator('#context-text').fill('Iniciaré ahora una reunión');
    await page.getByRole('button',{name:'Adaptar Melodi al contexto'}).click();
    assert.equal(await page.locator('button[data-mode="meeting"]').getAttribute('aria-pressed'),'true');
    await page.locator('#live-text').fill('El presupuesto acordado es de 500 euros.');await page.locator('#submit-fragment').click();
    await page.locator('#live-text').fill('¿Cuál es el presupuesto?');await page.locator('#submit-fragment').click();
    assert.ok((await page.locator('.help-card').textContent()).includes('500 euros'));
    assert.equal(await page.evaluate(()=>window.__spoken.length),0); report.push('reunión contextual y ayuda proactiva silenciosa con fuente');
    await page.locator('#mic-toggle').click();assert.equal(await page.locator('#settings-dialog').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.__mediaCalls),0);
    await page.locator('#meeting-consent').check();await page.locator('#asr-provider').selectOption('browser');await page.getByRole('button',{name:'Cerrar ajustes'}).click();
    await page.locator('#mic-toggle').click();await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar');
    assert.equal(await page.evaluate(()=>window.__mediaCalls),1);assert.equal(await page.evaluate(()=>window.__spoken.length),0);
    await page.locator('#mic-toggle').click();assert.ok(await page.evaluate(()=>window.__stopped>0));report.push('consentimiento reunión e inicio/parada de audio simulado');
    await page.locator('button[data-mode="practice"]').click();await page.locator('#voice-preview').click();
    await page.waitForFunction(()=>window.__spoken.length>=2);report.push('síntesis local con pausas, sin proveedor externo');
    await page.locator('#settings-open').click();await page.locator('#asr-provider').selectOption('browser');
    await page.locator('#patience').fill('1.5');await page.getByRole('button',{name:'Cerrar ajustes'}).click();
    await page.locator('#voice-preview').click();
    const cancelledBefore=await page.evaluate(()=>window.__cancelled);
    await page.locator('#mic-toggle').click();await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar');
    assert.ok(await page.evaluate(value=>window.__cancelled>value,cancelledBefore));
    await page.evaluate(()=>{const result=[{transcript:'Eh, esta idea ayuda a practicar.'}];result.isFinal=true;window.__recognition.onresult({resultIndex:0,results:[result]});});
    await page.waitForFunction(()=>document.querySelector('#coach-message').textContent.includes('En el texto aparecen'));
    await page.locator('#mic-toggle').click();
    report.push('escucha cancela voz previa y responde tras pausa a ASR simulado');
    await page.locator('#clear-session').click();assert.equal(await page.locator('#live-text').inputValue(),'');
    assert.equal(await page.locator('#meeting-consent').isChecked(),false);
    await page.locator('button[data-mode="meeting"]').click();assert.equal(await page.locator('.help-card').count(),0);
    await page.locator('button[data-mode="english"]').click();assert.equal(await page.locator('.phrase').count(),6);report.push('borrado de sesión y frases bilingües');
    await page.locator('button[data-mode="practice"]').click();
    const output=path.join(root,'tmp','ui');fs.mkdirSync(output,{recursive:true});
    await page.screenshot({path:path.join(output,'app-desktop.png'),fullPage:true});
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`App overflows at ${width}`);
      if(width===390)await page.screenshot({path:path.join(output,'app-mobile.png'),fullPage:true});
    }
    await page.goto(base+'/');
    for(const width of [320,390,1440]){
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Landing overflows at ${width}`);
      if(width===1440)await page.screenshot({path:path.join(output,'landing-desktop.png'),fullPage:true});
    }
    report.push('diseño app y landing: 320, 390, 768 y 1440 px');
    await page.goto(base+'/practice');await page.locator('#transcript').fill('Tengo una idea y un ejemplo para compartir.');
    await page.locator('#duration').fill('75');await page.locator('#evaluate').click();
    await page.waitForSelector('#feedback-results:not([hidden])');assert.equal(await page.locator('#metric-duration').textContent(),'75');
    report.push('taller conectado a API local');
    await page.goto(base+'/app');await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.waitForFunction(async()=>{const key=(await caches.keys()).find(key=>key.startsWith('brivany-shell-'));if(!key)return false;const cache=await caches.open(key);return !!(await cache.match('/live-voice.js'))&&!!(await cache.match('/activity'));});
    await context.setOffline(true);await page.reload();await page.waitForSelector('#mic-toggle');
    assert.ok(await page.evaluate(async()=>{const keys=await caches.keys();for(const key of keys){for(const request of await(await caches.open(key)).keys()){if(new URL(request.url).pathname.startsWith('/api/'))return false;}}return true;}));
    report.push('shell PWA sin conexión; caché excluye API y conversaciones');
    assert.deepEqual(errors,[]);report.push('sin errores JavaScript');
    console.log(JSON.stringify({checks:report.length,passed:report,physical_hardware_tested:false,external_models_called:false},null,2));
    await context.close();
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
