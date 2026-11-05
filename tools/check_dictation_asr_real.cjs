'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const report={passed:false,scope:'real browser getUserMedia, production PCM worklet and one Meta Muse ASR session',physical_microphone_used:false,input:'own offline synthetic fixture',audio_or_transcript_in_report:false,billing_usd:null};
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture='+process.env.BRIVANY_TEST_WAV]});
 try{
  const context=await browser.newContext({permissions:['microphone']}),page=await context.newPage();
  await page.goto(process.env.BRIVANY_TEST_URL+'/app');await page.waitForFunction(()=>!!window.BrivanyVoice&&!!window.BrivanyLive);
  const start=Date.now();
  await page.evaluate(async()=>{
   const config=await (await fetch('/api/status')).json();if(!config.voice.asr.available)throw Error('ASR is not configured for this explicit trial.');
   window.__capture={texts:[],levels:0,error:'',peak:0};window.__testMic=new BrivanyVoice.Microphone({onStatus(){},onError:e=>window.__capture.error=e,onTranscript:r=>window.__capture.texts.push({text:r.text,final:r.final}),onLevel:v=>{if(v.samples?.length===48)window.__capture.levels++;window.__capture.peak=Math.max(window.__capture.peak,...(v.samples||[0]));}});
   await window.__testMic.start({transcribe:true,provider:'muse',language:'es-ES',live:{url:config.voice.websocket_url,mode:'practice',bargeIn:false}});
  });
  report.ready_seconds=(Date.now()-start)/1000;report.asr_sessions=1;
  await page.waitForFunction(()=>window.__capture.error||window.__capture.texts.some(r=>/prueba/i.test(r.text)),{timeout:18000});
  const finished=Date.now();await page.evaluate(()=>window.__testMic.finish());report.finish_seconds=(Date.now()-finished)/1000;
  const receipt=await page.evaluate(()=>{const s=window.__capture,text=s.texts.map(r=>r.text).join(' ').toLowerCase();return {error:s.error,words_recognized:['prueba','mensaje','enviar'].filter(w=>text.includes(w)),finals:s.texts.filter(r=>r.final).length,level_updates:s.levels,peak:s.peak,released:window.__testMic.stream===null&&!window.__testMic.active};});
  Object.assign(report,receipt);assert(!receipt.error,receipt.error);assert(receipt.words_recognized.length>=2);assert(receipt.finals>0&&receipt.level_updates>0&&receipt.peak>0&&receipt.released);report.passed=true;
 }catch(error){report.error=error.message;}
 finally{await browser.close();fs.writeFileSync('tmp/dictation-capture/real-asr-report-'+Date.now()+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
 if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
