/* Real Muse DIARIZATION, synthetic question, previously committed test context.
   No model reply or TTS requests are allowed during the meeting. */
const fs=require('node:fs');
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const base=process.env.BRIVANY_TEST_URL||'http://127.0.0.1:8765';
const wav=fs.readFileSync('tmp/meeting-question.wav');
let last=0;for(let i=44;i<wav.length-1;i+=2)if(Math.abs(wav.readInt16LE(i))>96)last=(i-44)/2;
const speechEndMs=last/24;
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  try{
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();
    let forbiddenCalls=0;
    await context.route('**/api/voice/turn',route=>{forbiddenCalls++;return route.abort();});
    await context.route('**/api/voice/speech',route=>{forbiddenCalls++;return route.abort();});
    await context.route('**/synthetic-meeting.wav',route=>route.fulfill({contentType:'audio/wav',body:wav}));
    await context.addInitScript(()=>{
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        const audio=window.__inputAudio=new AudioContext({sampleRate:24000});await audio.resume();
        const source=window.__inputSource=audio.createBufferSource(),out=audio.createMediaStreamDestination();
        source.buffer=await audio.decodeAudioData(await(await fetch('/synthetic-meeting.wav')).arrayBuffer());source.connect(out);
        for(const t of out.stream.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{stop();if(audio.state!=='closed')audio.close();};}
        return out.stream;
      }});
    });
    const results=[];
    for(let i=0;i<3;i++){
      await page.goto(base+'/app');
      await page.waitForFunction(()=>document.querySelector('#connection-label').textContent.includes('conectado'));
      await page.locator('button[data-mode="meeting"]').click();
      for(const text of ['El presupuesto aprobado para el proyecto es de 500 euros.','La entrega quedó acordada para el viernes 30 de octubre.','Ana es la responsable de la presentación del proyecto.']){
        await page.locator('#live-text').fill(text);await page.locator('#submit-fragment').click();
      }
      await page.locator('#settings-open').click();await page.locator('#transcribe-opt-in').check();await page.locator('#meeting-consent').check();
      await page.getByRole('button',{name:'Cerrar ajustes'}).click();
      const connecting=Date.now();await page.locator('#mic-toggle').click();
      await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar',{},{timeout:30000});
      const connection_ms=Date.now()-connecting;
      await page.evaluate(end=>{
        window.__firstSupport=null;window.__speechBegin=performance.now()+100;window.__speechEnd=window.__speechBegin+end;
        const observer=window.__supportObserver=new MutationObserver(()=>{
          const host=document.querySelector('#meeting-preview');
          if(!host.hidden&&host.querySelector('blockquote')&&window.__firstSupport===null){
            const observed=performance.now(),text=host.querySelector('h3').textContent;
            requestAnimationFrame(()=>requestAnimationFrame(()=>{
              if(window.__firstSupport===null&&!host.hidden&&host.querySelector('blockquote'))window.__firstSupport={observed,paintOpportunity:performance.now(),question:text};
            }));
          }
        });
        observer.observe(document.querySelector('#meeting-preview'),{childList:true,subtree:true,attributes:true});
        window.__inputSource.start(window.__inputAudio.currentTime+.1);
      },speechEndMs);
      await page.waitForFunction(()=>window.__firstSupport!==null,{},{timeout:30000});
      const measurement=await page.evaluate(()=>({
        after_speech_start_ms:Math.round(window.__firstSupport.paintOpportunity-window.__speechBegin),
        relative_to_speech_end_ms:Math.round(window.__firstSupport.paintOpportunity-window.__speechEnd),
        partial_to_paint_opportunity_ms:Math.round(window.BrivanyMeetingTiming.renderMs),
        provisional_question:window.__firstSupport.question,
      }));
      results.push({connection_ms,...measurement});
      if(i===0){
        fs.mkdirSync('tmp/ui',{recursive:true});await page.screenshot({path:'tmp/ui/meeting-desktop.png',fullPage:true});
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/ui/meeting-mobile.png',fullPage:true});
        await page.setViewportSize({width:1440,height:1000});
      }
      await page.waitForFunction(()=>performance.now()>window.__speechEnd+300,{},{timeout:15000});
      await page.locator('#mic-toggle').click();await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Comenzar',{},{timeout:15000});
    }
    const report={measured_at:new Date().toISOString(),path:'real Muse DIARIZATION partial → local exact quotation retrieval → browser paint opportunity',samples:results,previous_context:'three manual synthetic facts committed before audio',audio:'synthetic question',question_audio_seconds:Math.round(speechEndMs)/1000,forbidden_reply_or_tts_requests:forbiddenCalls,physical_microphone:false,physical_display:false,external_facts_verified:false};
    if(forbiddenCalls)throw Error('Meeting called reply/TTS provider');
    fs.writeFileSync('tmp/meeting-latency.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
