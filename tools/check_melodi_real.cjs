/* One bounded provider check with approved synthetic input, never a user microphone. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),base=process.env.BRIVANY_TEST_URL||'http://127.0.0.1:8765';
const approved='5a7a06a8a9073de2246f3faec54b7ac17cf296ed82f9652a5a7e4df87af20a30';
async function main(){
  if(!process.argv.includes('--allow-paid'))throw Error('Real providers require --allow-paid. No session opened.');
  const fixture=fs.readFileSync(path.join(root,'tmp/modular-dubbing/english-room.wav'));
  assert.equal(crypto.createHash('sha256').update(fixture).digest('hex'),approved);
  const report={started_at:new Date().toISOString(),purpose:'Single Comenzar click through actual Muse, Meta and Cartesia, with fixed synthetic speech',
    source_synthetic:true,source_sha256:approved,source_seconds:2.3442083333333333,
    maximum_sessions:1,maximum_chat_requests:1,maximum_tts_requests:2,maximum_browser_seconds:30,
    automatic_retries:0,physical_microphone_tested:false,physical_speaker_tested:false,
    audio_persisted:false,transcripts_persisted:false,actual_billed_usd:null,status:'failed',
    chat_requests:0,tts_requests:0,asr_events:{},speech_http_statuses:[]};
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  const deadline=setTimeout(()=>{report.deadline_expired=true;browser.close().catch(()=>{});},30000);
  let page;
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/__melodi_synthetic.wav',route=>route.fulfill({contentType:'audio/wav',body:fixture}));
    await context.route('**/api/voice/turn',route=>{
      report.chat_requests++;
      return report.chat_requests<=1?route.continue():route.abort();
    });
    await context.route('**/api/voice/speech',route=>{
      report.tts_requests++;
      return report.tts_requests<=2?route.continue():route.abort();
    });
    await context.addInitScript(()=>{
      window.__qa={capture:0,voice_chunks:0,voice_energy:false,voice_context_running:false,released:0};
      const original=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){
        if(!this.__syntheticInput && this.buffer){
          window.__qa.voice_chunks++;window.__qa.voice_context_running=this.context.state==='running';
          window.__qa.firstVoiceAt??=performance.now();
          if(this.buffer.getChannelData(0).some(value=>Math.abs(value)>.003))window.__qa.voice_energy=true;
        }
        return original.apply(this,args);
      };
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
        if(++window.__qa.capture>1)throw Error('One synthetic capture only.');
        const audio=new AudioContext(),destination=audio.createMediaStreamDestination();
        const buffer=await audio.decodeAudioData(await(await fetch('/__melodi_synthetic.wav')).arrayBuffer());
        if(buffer.duration>3)throw Error('Fixture too long.');
        const source=audio.createBufferSource();source.__syntheticInput=true;source.buffer=buffer;source.connect(destination);
        window.__startSynthetic=async()=>{await audio.resume();source.start();window.__qa.inputStartedAt=performance.now();};
        for(const track of destination.stream.getTracks()){
          const stop=track.stop.bind(track);track.stop=()=>{window.__qa.released++;stop();audio.close().catch(()=>{});};
        }
        return destination.stream;
      }});
    });
    page=await context.newPage();
    page.on('pageerror',()=>{report.page_errors=(report.page_errors||0)+1;});
    page.on('websocket',socket=>{
      socket.on('framereceived',event=>{
        try{const data=JSON.parse(String(event.payload));const key=data.type==='transcript'?(data.final?'final':'partial'):data.type;
          report.asr_events[key]=(report.asr_events[key]||0)+1;
          if(data.type==='error')report.asr_error_code=data.code;
        }catch{}
      });
      socket.on('framesent',event=>{if(Buffer.isBuffer(event.payload))report.input_bytes=(report.input_bytes||0)+event.payload.length;});
    });
    page.on('response',response=>{
      if(response.url().endsWith('/api/voice/turn'))report.chat_http_status=response.status();
      if(response.url().endsWith('/api/voice/speech'))report.speech_http_statuses.push(response.status());
    });
    await page.goto(base+'/app');
    await page.waitForFunction(()=>document.querySelector('#voice-select').value==='melodi-cartesia');
    assert.equal(await page.evaluate(()=>window.__qa.capture),0);
    await page.locator('#mic-toggle').click();
    assert.equal(await page.locator('#settings-dialog').isVisible(),false);
    await page.waitForFunction(()=>document.querySelector('#mic-label').textContent==='Terminar',null,{timeout:18000});
    await page.evaluate(()=>window.__startSynthetic());
    // A provider failure ends the check; no automatic request or session retry.
    await page.waitForFunction(()=>window.__qa.voice_energy||document.querySelector('#voice-notice').classList.contains('error'),null,{timeout:18000});
    const played=await page.evaluate(()=>window.__qa.voice_energy);
    if(played){
      await page.waitForFunction(()=>document.querySelector('#voice-state').textContent==='ESCUCHANDO'||document.querySelector('#voice-notice').classList.contains('error'),null,{timeout:18000});
    }
    report.browser=await page.evaluate(()=>({...window.__qa,timing:window.BrivanyTiming,error_visible:document.querySelector('#voice-notice').classList.contains('error')}));
    assert.equal(report.browser.error_visible,false);
    assert.equal(report.browser.voice_energy,true);
    assert.equal(report.browser.voice_context_running,true);
    assert.equal(report.chat_requests,1);assert.ok(report.tts_requests>0&&report.tts_requests<=2);
    assert.ok(report.asr_events.final>0);
    report.status='passed_actual_provider_chain_and_browser_pcm_not_physical_listening';
  }catch(error){report.failure_type=error.name;process.exitCode=1;}
  finally{
    if(page&&!page.isClosed()){
      await page.evaluate(()=>{document.querySelector('#interrupt').click();const button=document.querySelector('#mic-toggle');if(document.querySelector('#mic-label').textContent!=='Comenzar')button.click();}).catch(()=>{});
      report.cleanup=await page.evaluate(()=>({released:window.__qa.released})).catch(()=>null);
    }
    clearTimeout(deadline);await browser.close();report.finished_at=new Date().toISOString();
    const output=path.join(root,'tmp',`melodi-real-${report.started_at.replace(/[^0-9]/g,'')}.json`);
    fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log('Report: '+output);
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
