/* Paired real TTS requests, synthetic phrases; measures scheduling, not physical speakers. */
const fs=require('node:fs');
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const base=process.env.BRIVANY_TEST_URL||'http://127.0.0.1:8765';
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  try{
    const samples=[];
    for(let run=0;run<3;run++)for(const variant of run%2?['updated','baseline']:['baseline','updated']){
      const context=await browser.newContext({serviceWorkers:'block'});
      if(variant==='baseline')await context.route('**/live-voice.js',route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync('tmp/live-voice-before-fluency.js','utf8')}));
      const page=await context.newPage();await page.goto(base+'/app');
      const result=await page.evaluate(async()=>{
        const chunks=[],requests=[];let current=0,error=null,finish,started=false;
        const start=AudioBufferSourceNode.prototype.start,fetchOriginal=window.fetch;
        window.fetch=async(...args)=>{if(args[0]==='/api/voice/speech'){current++;requests.push(performance.now());}return fetchOriginal(...args);};
        AudioBufferSourceNode.prototype.start=function(when,...args){
          const values=this.buffer.getChannelData(0),first=values.findIndex(x=>Math.abs(x)>96/32768);
          let last=values.length-1;while(last>=0&&Math.abs(values[last])<=96/32768)last--;
          const rate=this.playbackRate.value,sampleRate=this.buffer.sampleRate;
          const begin=performance.now()+(when-this.context.currentTime)*1000;
          chunks.push({segment:current,begin,end:begin+this.buffer.duration/rate*1000,
            activeBegin:first<0?null:begin+first/sampleRate/rate*1000,
            activeEnd:last<0?null:begin+(last+1)/sampleRate/rate*1000});
          return start.call(this,when,...args);
        };
        const done=new Promise(resolve=>finish=resolve),begin=performance.now();
        const output=new BrivanyLive.MelodiOutput(active=>{if(active)started=true;else if(started)finish();},message=>{error=message;});
        output.speak([{text:'Explica tu proyecto con una idea clara.',pauseAfter:90},{text:'Después, añade un ejemplo que tu público recuerde.',pauseAfter:0}],{rate:1});
        await done;AudioBufferSourceNode.prototype.start=start;window.fetch=fetchOriginal;
        const a=chunks.filter(c=>c.segment===1),b=chunks.filter(c=>c.segment===2);
        if(error||!a.length||!b.length)throw Error(error||'Missing audio segments');
        const endFirst=Math.max(...a.map(c=>c.end)),startSecond=Math.min(...b.map(c=>c.begin));
        const voiceEnd=Math.max(...a.filter(c=>c.activeEnd!==null).map(c=>c.activeEnd));
        const voiceStart=Math.min(...b.filter(c=>c.activeBegin!==null).map(c=>c.activeBegin));
        const result={first_voice_ms:Math.round(Math.min(...a.filter(c=>c.activeBegin!==null).map(c=>c.activeBegin))-begin),
          gap_between_pcm_segments_ms:Math.round(startSecond-endFirst),gap_between_active_voice_ms:Math.round(voiceStart-voiceEnd),
          second_request_relative_to_first_audio_end_ms:Math.round(requests[1]-endFirst)};
        await output.player.audio?.close();return result;
      });
      samples.push({run,variant,...result});console.log(JSON.stringify(samples.at(-1)));
      await context.close();
    }
    const summary={};
    for(const variant of ['baseline','updated']){
      const rows=samples.filter(s=>s.variant===variant);summary[variant]={};
      for(const key of ['first_voice_ms','gap_between_pcm_segments_ms','gap_between_active_voice_ms']){
        const values=rows.map(s=>s[key]).sort((a,b)=>a-b);summary[variant][key]={median:values[1],min:values[0],max:values[2]};
      }
    }
    const report={measured_at:new Date().toISOString(),samples,summary,physical_playback:false,synthetic_text:true,asr_or_llm:false};
    fs.writeFileSync('tmp/voice-fluency.json',JSON.stringify(report,null,2));console.log(JSON.stringify(summary,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
