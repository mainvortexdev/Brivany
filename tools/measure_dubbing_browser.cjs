/* One fixed synthetic video through the actual UI. Real providers require --allow-paid.
 * Device timestamps are browser estimates, not microphone or hardware loopback.
 */
'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),simulated=process.argv.includes('--simulated');
const reviewRequested=process.argv.includes('--review-synthetic');
const python=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const providerIndex=process.argv.indexOf('--provider'),provider=providerIndex<0?'palabra':process.argv[providerIndex+1];
if(!['palabra','openai'].includes(provider))throw Error('Only explicitly prepared providers may be benchmarked.');
const providerName=provider==='openai'?'OpenAI':'Palabra';
if(!simulated && !process.argv.includes('--allow-paid')) throw Error('A real provider trial requires --allow-paid.');
const base=process.env.BRIVANY_TEST_URL || 'http://127.0.0.1:8765';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('Only local HTTP is allowed.');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const twoClauses=process.argv.includes('--two-clauses');
const approvedHash=twoClauses?'373acd421477dc7f1169151181f1d5dff3a6a3107ed70704c9ca894c74a46b38':'5a7a06a8a9073de2246f3faec54b7ac17cf296ed82f9652a5a7e4df87af20a30';
let source=path.join(root,'tmp/modular-dubbing/english-room.wav');
if(twoClauses){
  const directory=path.join(root,'tmp/stream-dubbing');source=null;
  for(const name of fs.readdirSync(directory).filter(name=>/^build-[a-f0-9]{32}$/.test(name)).sort()){
    const candidate=path.join(directory,name,'two-clauses.wav');
    if(fs.existsSync(candidate) && fs.statSync(candidate).size<500000 && digest(candidate)===approvedHash){source=candidate;break;}
  }
  if(!source)throw Error('Prepare the approved two-clause synthetic fixture first.');
}
if(fs.statSync(source).size>2*1024*1024)throw Error('The fixed synthetic source is too large.');
const sourceSnapshot=fs.readFileSync(source);
const sourceSnapshotHash=crypto.createHash('sha256').update(sourceSnapshot).digest('hex');
if(sourceSnapshotHash!==approvedHash) throw Error('The fixed synthetic source changed.');
function reviewCommand(mode,input){
  try {
    return JSON.parse(execFileSync(python,['-X','utf8','-B','-m','tools.synthetic_dubbing_review','--source',source,mode],
      {cwd:root,windowsHide:true,timeout:10000,maxBuffer:65536,input,stdio:['pipe','pipe','pipe']}).toString('utf8'));
  }catch{throw Error('The bounded synthetic review helper could not complete.');}
}
if(reviewRequested){
  const prepared=reviewCommand('--preflight');
  if(prepared.status!=='ready' || prepared.source?.sha256!==approvedHash || prepared.source?.synthetic!==true)throw Error('Synthetic review preflight rejected this source.');
}
const sourceSeconds=twoClauses?3.46:2.3442083333;
const fixture=path.join(root,'tmp/dubbing-test/'+(twoClauses?'two-clauses-timing.mp4':'english-room-timing.mp4'));
fs.mkdirSync(path.dirname(fixture),{recursive:true});
// Regenerate exclusively this tool-owned synthetic fixture: an existing video
// hash alone would not establish that its track came from the approved WAV.
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0xdadce0:s=640x360:r=25',
  '-i','pipe:0','-t',String(sourceSeconds),'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-ar','24000','-ac','1','-movflags','+faststart','-y',fixture],{timeout:15000,windowsHide:true,stdio:'pipe',input:sourceSnapshot});
(async()=>{
  const report={checked_at:new Date().toISOString(),status:'failed',provider:providerName,upstream:simulated?'simulated':'real',
    api:'real_local',synthetic:true,source_sha256:sourceSnapshotHash,source_validated_snapshot:true,video_sha256:digest(fixture),
    source_fixture:twoClauses?'two_distinct_clauses_260ms_energy_gap':'single_room_phrase',
    fixture_regenerated_from_verified_source:true,target_audible_delay_ms:500,
    physical_playback_measured:false,audible_delay_verified:false,external_calls:0,
    maximum_sessions:1,automatic_retries:0,actual_billed_usd:null,
    synthetic_review_requested:reviewRequested,audio_persisted:false,transcripts_persisted:false,
    output_timing_method:'same_audio_context_energy_windows_with_browser_device_timestamp_estimate',
    energy_window_ms:20,energy_rms_threshold:.005,
    limitations:['One fixed synthetic source; no percentile, maximum guarantee, physical loopback or verified per-word semantic alignment.',
      'The original reference is captured before its volume gain. Device output timestamps are estimates, and energy is not proof of intelligible translated speech.']};
  let reviewEvents=[],reviewBytes=0,reviewJsonBytes=13,reviewFailure=null;
  const reviewHash=crypto.createHash('sha256');
  const discardReview=code=>{reviewFailure=code;reviewEvents=[];};
  const browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge'});
  try {
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
    const errors=[],blocked=[];
    if(reviewRequested)page.on('websocket',socket=>socket.on('framereceived',frame=>{
      if(reviewFailure)return;
      try {
        if(typeof frame.payload!=='string' || frame.payload.length>2*1024*1024)return;
        const value=JSON.parse(frame.payload);let event,pcm;
        if(value.type==='audio'){
          if(typeof value.audio!=='string' || value.audio.length>640000 || value.audio.length%4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.audio))throw Error('format');
          pcm=Buffer.from(value.audio,'base64');
          if(!pcm.length || pcm.length%2 || pcm.toString('base64')!==value.audio || reviewBytes+pcm.length>960000)throw Error('limit');
          event={type:'audio',audio:value.audio,sample_rate:value.sample_rate,channels:value.channels ?? 1,format:value.format ?? 'pcm16'};
        }else if(value.type==='transcript'){
          event={type:'transcript',source:value.source,text:value.text};
          for(const key of ['operation','segment_id','revision','provisional','final'])if(value[key]!==undefined)event[key]=value[key];
        }else return;
        const bytes=Buffer.byteLength(JSON.stringify(event),'utf8')+1;
        if(reviewEvents.length>=1000 || reviewJsonBytes+bytes>2*1024*1024)throw Error('limit');
        reviewEvents.push(event);reviewJsonBytes+=bytes;
        if(pcm){reviewBytes+=pcm.length;reviewHash.update(pcm);}
      }catch{discardReview('bounded_collection_rejected');}
    }));
    await context.addInitScript({path:path.join(root,'web/dub-timing.js')});
    await context.addInitScript(({reviewEnabled})=>{
      const NativeAudio=window.AudioContext,NativeWorklet=window.AudioWorkletNode,NativeSocket=window.WebSocket;
      const state={scheduledBuffers:0,microphoneRequests:0};let audio,sourceClock,translatedClock;
      if(reviewEnabled){state.scheduled_buffer_trace=[];state.source_capture_trace=[];state.trace_truncated=false;}
      document.addEventListener('brivany-dubbing-timing',event=>{state.segment_timing=event.detail;});
      window.WebSocket=class extends NativeSocket {
        constructor(...args){super(...args);this.addEventListener('message',event=>{
          let value;try{value=JSON.parse(event.data);}catch{return;}
          if(value.type==='ready'){
            const settings=value.provider_settings || {};
            state.provider_settings={only_confirm_by_silence:typeof settings.only_confirm_by_silence==='boolean'?settings.only_confirm_by_silence:null,
              translate_partial_transcriptions:typeof settings.translate_partial_transcriptions==='boolean'?settings.translate_partial_transcriptions:null};
          }
        });}
      };
      const clocks=()=>{
        sourceClock ||= new window.BrivanyDubTiming.PcmEnergyClock();
        translatedClock ||= new window.BrivanyDubTiming.PcmEnergyClock();
      };
      window.AudioContext=class extends NativeAudio {
        constructor(options){super(options);audio=this;}
        createBufferSource(){
          const node=super.createBufferSource(),start=node.start.bind(node);
          node.start=(when,...args)=>{
            const contextStart=Math.max(when || 0,this.currentTime);
            const result=start(when,...args);
            state.scheduledBuffers++;
            if(node.buffer){
              clocks();translatedClock.observe(node.buffer.getChannelData(0),node.buffer.sampleRate,contextStart);
              if(reviewEnabled){
                if(state.scheduled_buffer_trace.length<1000)state.scheduled_buffer_trace.push({context_start_seconds:contextStart,frames:node.buffer.length,sample_rate:node.buffer.sampleRate});
                else state.trace_truncated=true;
              }
            }
            return result;
          };return node;
        }
      };
      window.AudioWorkletNode=class extends NativeWorklet {
        constructor(...args){super(...args);this.port.addEventListener('message',event=>{
          const data=event.data;
          if(data.type==='pcm' && data.buffer instanceof ArrayBuffer && Number.isFinite(data.source_context_end)) {
            const view=new DataView(data.buffer),samples=new Float32Array(view.byteLength/2);
            for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
            clocks();sourceClock.observe(samples,24000,data.source_context_end-samples.length/24000);
            if(reviewEnabled){
              if(state.source_capture_trace.length<1000)state.source_capture_trace.push({context_end_seconds:data.source_context_end,frames:samples.length,sample_rate:24000});
              else state.trace_truncated=true;
            }
          }
        });this.port.start();}
      };
      if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{state.microphoneRequests++;throw Error('No microphone in this fixed synthetic check.');}});
      window.__readDubbingTiming=()=>{
        clocks();sourceClock.finish();translatedClock.finish();
        const source=sourceClock.snapshot(),translation=translatedClock.snapshot();
        let stamp=null;try{stamp=audio?.getOutputTimestamp?.();}catch{}
        const usable=stamp && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime) && stamp.performanceTime>0 && stamp.contextTime>0;
        const outputTime=value=>usable && value!==null?stamp.performanceTime+(value-stamp.contextTime)*1000:null;
        return {...state,source,translation,...window.BrivanyDubTiming.summarize(source,translation),
          audio_context_state:audio?.state || null,device_timestamp_valid:Boolean(usable),
          base_latency_seconds:Number.isFinite(audio?.baseLatency)?audio.baseLatency:null,
          output_latency_seconds:Number.isFinite(audio?.outputLatency)?audio.outputLatency:null,
          source_last_energy_device_estimate_ms:outputTime(source.last_energy_context),
          translated_energy_device_estimate_ms:outputTime(translation.first_energy_context),
          device_clock_has_passed_first_energy:Boolean(usable && translation.first_energy_context!==null && stamp.contextTime>=translation.first_energy_context)};
      };
    },{reviewEnabled:reviewRequested});
    await context.route('**/*',route=>{
      const request=route.request();
      if(new URL(request.url()).origin!==base || request.method()!=='GET'){blocked.push(request.url());return route.abort();}
      return route.continue();
    });
    page.on('pageerror',error=>errors.push(error.message));
    const status=await context.request.get(base+'/api/dubbing/status?provider='+provider);const data=await status.json();
    if(simulated && data.simulation_only!==true)throw Error('Simulated mode requires the dedicated loopback harness.');
    if(data.available!==true || data.configured!==true)throw Error('The selected route is not configured.');
    if(data.provider!==providerName)throw Error('The configured route does not match the requested provider.');
    await page.goto(base+'/dubbing?provider='+provider);
    await page.waitForFunction(()=>document.querySelector('#provider-state').textContent.includes('guardada'));
    await page.locator('#video-file').setInputFiles(fixture);
    await page.waitForFunction(()=>document.querySelector('#dub-video').readyState>=1);
    await page.locator('#dub-consent').check();report.external_calls=simulated?0:1;
    await page.locator('#start-dubbing').click();
    await page.waitForFunction(()=>document.querySelector('#dub-notice').textContent.includes('terminada'),{},{timeout:25000});
    const timing=await page.evaluate(()=>window.__readDubbingTiming());
    assert.equal(timing.microphoneRequests,0);assert.ok(timing.scheduledBuffers>0);
    assert.ok(Number.isFinite(timing.onset_to_onset_ms));
    assert.equal(timing.audio_context_state,'running');assert.equal(timing.device_timestamp_valid,true);
    assert.equal(timing.device_clock_has_passed_first_energy,true);
    if(simulated && provider==='palabra') {
      assert.equal(timing.segment_timing.correlated_segment_count,2);
      assert.equal(timing.segment_timing.unattributed_audio_chunks,0);
      assert.equal(timing.segment_timing.uncorrelated_audio_segments,0);
      assert.equal(timing.segment_timing.audible_delay_verified,false);
      assert.ok(timing.segment_timing.segments.every(item=>item.audio_segment_final===true));
    }else if(simulated){
      // elapsed_ms is stream alignment, not a segment identity or source range.
      assert.equal(timing.segment_timing.correlated_segment_count,0);
      assert.ok(timing.segment_timing.unattributed_audio_chunks>0);
      assert.equal(timing.segment_timing.audible_delay_verified,false);
    }
    assert.equal(await page.locator('#dub-error').isVisible(),false);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    Object.assign(report,{status:'passed',timing,
      estimated_onset_delay_within_target:!simulated && timing.onset_to_onset_ms<=500,
      first_translated_energy_before_final_source_energy:timing.translation.first_energy_context<timing.source.last_energy_context,
      original_volume_percent:Number(await page.locator('#original-volume').inputValue()),
      translation_volume_percent:Number(await page.locator('#dub-volume').inputValue()),
      final_caption:await page.locator('#translation-caption').textContent()});
    await context.close();
  }catch(error){
    report.failure_type=error.name || 'Error';
    // Keep endpoint responses, credentials and arbitrary browser errors out of reports.
    report.failure='The bounded browser trial did not meet its local completion checks.';
    process.exitCode=1;
  }finally{
    await browser.close();
    if(reviewRequested){
      let helperAttempted=false;
      try {
        if(reviewFailure || !reviewBytes)throw Error('No bounded review output.');
        const collectedSha=reviewHash.digest('hex');
        helperAttempted=true;
        const saved=reviewCommand('--collect-stdin',JSON.stringify({events:reviewEvents}));
        if(saved.status!=='saved' || !saved.review)throw Error('Review receipt missing.');
        const receipt={};
        for(const key of ['directory','wav_path','json_path','source_sha256','output_sha256','output_pcm_sha256',
          'review_sha256','output_pcm_bytes','output_duration_seconds'])if(saved.review[key]!==undefined)receipt[key]=saved.review[key];
        const integrity=receipt.output_pcm_sha256===collectedSha && receipt.output_pcm_bytes===reviewBytes;
        report.synthetic_review={status:integrity?'saved':'integrity_mismatch',review:receipt,
          byte_integrity_verified:integrity,semantic_accuracy_verified:false,naturalness_verified:false,
          received_pcm_sha256:collectedSha,received_pcm_bytes:reviewBytes,
          received_and_scheduled_pcm_bytes_match:report.timing?report.timing.translation.frames*2===reviewBytes:null,
          functional_trial_status:report.status};
        report.audio_persisted=saved.audio_persisted===true;report.transcripts_persisted=saved.transcripts_persisted===true;
        if(!integrity)process.exitCode=1;
      }catch{
        report.synthetic_review={status:'unavailable',code:reviewFailure || (reviewBytes?'review_validation_failed':'no_audio_observed'),
          audio_persisted:helperAttempted?null:false,transcripts_persisted:helperAttempted?null:false};
        report.audio_persisted=report.synthetic_review.audio_persisted;
        report.transcripts_persisted=report.synthetic_review.transcripts_persisted;
        process.exitCode=1;
      }
      reviewEvents=[];
    }
    const directory=path.join(root,'tmp/browser-dubbing-measurements');fs.mkdirSync(directory,{recursive:true});
    const name=(simulated?'simulated-':'real-')+Date.now()+'.json',file=path.join(directory,name);
    fs.writeFileSync(file,JSON.stringify(report,null,2));
    console.log(JSON.stringify({...report,report:path.relative(root,file).replaceAll('\\','/')},null,2));
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
