/* Real Muse + Spark + Celeste; synthetic speech only, no physical microphone. */
const fs=require('node:fs');
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const base=process.env.BRIVANY_TEST_URL||'http://127.0.0.1:8765';
const wav=fs.readFileSync('tmp/conversation-input.wav');
let last=0;for(let i=44;i<wav.length-1;i+=2)if(Math.abs(wav.readInt16LE(i))>96)last=(i-44)/2;
const speechEndMs=last/24;
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
    if(process.env.BRIVANY_VOICE_SCRIPT)await context.route('**/live-voice.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.BRIVANY_VOICE_SCRIPT,'utf8')}));
    await context.route('**/synthetic-test.wav',route=>route.fulfill({contentType:'audio/wav',body:wav}));
    await context.addInitScript(()=>{
      const original=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(when,...args){
        if(this.context!==window.__inputAudio&&window.__speechEnd&&window.__firstReply===null){
          const data=this.buffer?.getChannelData(0),at=data?.findIndex(x=>Math.abs(x)>96/32768);
          if(at>=0)window.__firstReply=performance.now()+Math.max(0,when-this.context.currentTime)*1000+at/this.buffer.sampleRate*1000-window.__speechEnd;
        }
        return original.call(this,when,...args);
      };
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        const audio=window.__inputAudio=new AudioContext({sampleRate:24000});await audio.resume();
        const source=window.__inputSource=audio.createBufferSource(),out=audio.createMediaStreamDestination();
        source.buffer=await audio.decodeAudioData(await(await fetch('/synthetic-test.wav')).arrayBuffer());source.connect(out);
        for(const t of out.stream.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{stop();if(audio.state!=='closed')audio.close();};}
        return out.stream;
      }});
    });
    const results=[];
    for(let i=0;i<3;i++){
      await page.goto(base+'/app');
      await page.waitForFunction(()=>document.querySelector('#connection-label').textContent==='Melodi · Muse conectado');
      await page.locator('#settings-open').click();await page.locator('#transcribe-opt-in').check();await page.locator('#cloud-voice-consent').check();
      await page.getByRole('button',{name:'Cerrar ajustes'}).click();
      const connecting=Date.now();await page.locator('#mic-toggle').click();
      await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar',{},{timeout:30000});
      const connection_ms=Date.now()-connecting;
      await page.evaluate(end=>{window.__firstReply=null;window.__speechEnd=performance.now()+100+end;window.__inputSource.start(window.__inputAudio.currentTime+.1);},speechEndMs);
      await page.waitForFunction(()=>window.__firstReply!==null,{},{timeout:45000});
      const first_reply_ms=Math.round(await page.evaluate(()=>window.__firstReply));
      const stages=await page.evaluate(()=>{const t=window.BrivanyTiming;return {asr_final_after_speech_ms:Math.round(t.asrFinalAt-window.__speechEnd),turn_wait_ms:Math.round(t.replyRequestAt-t.asrFinalAt),model_first_text_ms:Math.round(t.firstTextAt-t.replyRequestAt),model_first_sentence_ms:Math.round(t.firstSentenceAt-t.replyRequestAt)};});
      await page.waitForFunction(()=>document.querySelector('#voice-notice').textContent.includes('Muse Spark'),{},{timeout:30000});
      const transcript=await page.locator('#live-text').inputValue(),reply=await page.locator('#coach-message').textContent();
      results.push({connection_ms,end_of_synthetic_speech_to_scheduled_reply_ms:first_reply_ms,...stages,transcript,reply});
      await page.locator('#mic-toggle').click();await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Comenzar');
    }
    const values=results.map(x=>x.end_of_synthetic_speech_to_scheduled_reply_ms).sort((a,b)=>a-b);
    const report={measured_at:new Date().toISOString(),path:'synthetic microphone → real Muse → real Spark 1.3 → real Celeste → browser playback scheduling',samples:results,median_ms:values[1],max_ms:values.at(-1),physical_microphone:false,physical_playback:false,guarantee:false};
    fs.writeFileSync(process.env.BRIVANY_MEASURE_OUTPUT||'tmp/conversation-latency.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
    await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
