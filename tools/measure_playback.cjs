/* Real Melodi requests with synthetic text. Headless audio scheduling, not a physical listening test. */
const fs=require('node:fs');
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH||'playwright');
const base=process.env.BRIVANY_TEST_URL||'http://127.0.0.1:8765';
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL||'msedge'});
  try{
    const page=await browser.newPage();
    await page.goto(base+'/app');
    const results=await page.evaluate(async()=>{
      const measurements=[];
      for(const text of ['Hola. Soy Melodi, y te escucho.','Claro. Tómate un momento para ordenar tu idea.','Bien. Explica una idea, dale un ejemplo y termina con un cierre.','Puedes decir: déjame comprobar la información antes de responder.','Vamos paso a paso. Estoy aquí para acompañarte.']){
        let begin=performance.now(),onset=null,error=null;
        const original=AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start=function(when,...args){
          const channel=this.buffer?.getChannelData(0),index=channel?.findIndex(x=>Math.abs(x)>96/32768);
          if(onset===null&&index>=0)onset=Math.round(performance.now()-begin+Math.max(0,when-this.context.currentTime)*1000+index/this.buffer.sampleRate*1000);
          return original.call(this,when,...args);
        };
        let finish;const done=new Promise(r=>finish=r);let started=false;
        const output=new BrivanyLive.MelodiOutput(active=>{if(active)started=true;else if(started)finish();},message=>{error=message;});
        output.speak([{text}],{rate:1});await done;
        AudioBufferSourceNode.prototype.start=original;
        measurements.push({first_scheduled_voice_ms:onset,total_ms:Math.round(performance.now()-begin),error});
        await output.player.audio?.close();
      }
      return measurements;
    });
    if(results.some(x=>x.error||x.first_scheduled_voice_ms===null))throw Error('Audio measurement failed: '+JSON.stringify(results));
    const ordered=results.map(x=>x.first_scheduled_voice_ms).sort((a,b)=>a-b);
    const report={measured_at:new Date().toISOString(),path:'browser → local server → Cloudflare → PCM scheduling with leading-silence trim',samples:results,median_ms:ordered[2],p95_ms:ordered.at(-1),physical_audio_tested:false,muse_included:false,conversation_model_included:false};
    fs.mkdirSync('tmp',{recursive:true});fs.writeFileSync('tmp/playback-latency.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
