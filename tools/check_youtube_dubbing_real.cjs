/* One explicitly authorized, bounded, paid real YouTube -> Palabra -> Windows
 * audio-output session. Saves aggregates only; no audio or transcript content.
 */
'use strict';
const {chromium}=require(process.env.BRIVANY_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs'),path=require('node:path');
const base='http://127.0.0.1:8765',folder=path.resolve('tmp/youtube-dubbing-real');
const targetArgument=process.argv.slice(2).find(value=>value.startsWith('--target=')),target=targetArgument?.slice(9) || 'en';
const sourceArgument=process.argv.slice(2).find(value=>value.startsWith('--source=')),source=sourceArgument?.slice(9) || 'auto';
if(!['en','es','fr'].includes(target))throw Error('Use --target=en, --target=es or --target=fr.');
if(!['auto','en','es','fr'].includes(source) || source===target)throw Error('Choose a valid different source, or auto.');
const report={started_at:new Date().toISOString(),scope:'Actual public YouTube, native tab audio capture, one Palabra translation session and Windows audio-output submission.',
  video_id:'qGEPPNTTYmk',source_language:source,target_language:target,maximum_session_seconds:25,maximum_paid_sessions:1,hard_deadline_seconds:70,
  drain_window_seconds:35,observation_scope:'25 seconds maximum input after provider ready, then bounded drain. Stop on an error, completion or the hard deadline.',
  paid_inference_authorized:true,known_cost_usd:null,billing_verified:false,physical_speaker_output_verified:false,
  translation_semantics_verified:false,stutter_free_playback_verified:false,audible_latency_500ms_verified:false,
  original_media_saved:false,transcript_saved:false,retries:0,playwright_headless_mute_default_removed:true};
let browser,context,page,frame,deadlineTimer;
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function videoState(){return frame.evaluate(()=>{
  const video=document.querySelector('video');return video?{current_time:video.currentTime,paused:video.paused,ended:video.ended,ready_state:video.readyState,
    has_dimensions:video.videoWidth>0 && video.videoHeight>0,muted:video.muted,volume:video.volume,
    audio_decoded_bytes:Number.isFinite(video.webkitAudioDecodedByteCount)?video.webkitAudioDecodedByteCount:null}:null;
});}
function save(){
  fs.mkdirSync(folder,{recursive:true});report.finished_at=new Date().toISOString();const raw=JSON.stringify(report,null,2);
  const latest=path.join(folder,'report.json');if(fs.existsSync(latest)){const previous=fs.readFileSync(latest,'utf8');let stamp='previous';try{stamp=JSON.parse(previous).started_at.replace(/[^0-9TZ]/g,'');}catch{}const archived=path.join(folder,'report-'+stamp+'.json');if(!fs.existsSync(archived))fs.writeFileSync(archived,previous);}
  fs.writeFileSync(path.join(folder,'report-'+report.started_at.replace(/[^0-9TZ]/g,'')+'.json'),raw);fs.writeFileSync(path.join(folder,'report.json'),raw);console.log(raw);
}
(async()=>{
  try{
    browser=await chromium.launch({headless:true,channel:process.env.BRIVANY_BROWSER_CHANNEL || 'msedge',ignoreDefaultArgs:['--mute-audio'],args:['--auto-accept-this-tab-capture','--auto-select-tab-capture-source-by-title=Brivany Paid Dubbing Probe']});
    context=await browser.newContext({serviceWorkers:'block',viewport:{width:1400,height:1000}});page=await context.newPage();
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());if(url.origin===base && request.method()!=='GET')return route.abort('blockedbyclient');return route.continue();
    });
    await context.addInitScript(({target,source})=>{
      const counters={capture_requests:0,microphone_requests:0,popup_attempts:0,websocket_connections:0,start_messages:0,ready_messages:0,
        input_packets:0,input_bytes:0,input_samples:0,nonzero_input_samples:0,input_peak:0,input_sum_squares:0,
        first_input_at:null,first_playback_at:null,ready_at:null,start_at:null,playback_messages:0,playback_duration_ms:0,
        translated_transcript_messages:0,translated_transcript_characters:0,last_transcript_language:null,original_transcript_messages:0,original_transcript_characters:0,original_transcript_languages:[],local_output_confirmed:false,
        input_ended_at:null,done_at:null,provider_diagnostic_messages:0,provider_raw_event_counts:{},provider_filtered_events:null,provider_source_languages:[],provider_reported_input_bytes:null,provider_reported_upstream_input_bytes:null,
        provider_error_code:null,session_done:false,stopped:false,finish_messages:0,native_output_stats_messages:0,native_maximum_queued_ms:{},native_queued_ms:{},native_maximum_total_queued_ms:null,native_rejected_pushes:{},native_output_frames:null,native_error_code:null};
      window.__paidDubbingProbe=counters;
      window.open=()=>{counters.popup_attempts++;return null;};
      const media=navigator.mediaDevices,display=media?.getDisplayMedia?.bind(media);
      if(display)Object.defineProperty(media,'getDisplayMedia',{configurable:true,value:options=>{counters.capture_requests++;if(counters.capture_requests>1)throw Error('Only one real capture is allowed');return display(options);}});
      if(media)Object.defineProperty(media,'getUserMedia',{configurable:true,value:async()=>{counters.microphone_requests++;throw Error('No microphone is allowed in this test');}});
      const Native=window.WebSocket;
      window.WebSocket=class extends Native {
        constructor(url,...args){
          const target=new URL(url);if(target.protocol!=='ws:' || !['127.0.0.1','localhost'].includes(target.hostname) || target.pathname!=='/dub')throw Error('Only the local dubbing relay is permitted');
          if(counters.websocket_connections>=1)throw Error('Only one paid translation connection is allowed');super(url,...args);counters.websocket_connections++;window.__paidDubbingSocket=this;
          this.addEventListener('message',event=>{
            if(typeof event.data!=='string')return;let value;try{value=JSON.parse(event.data);}catch{return;}
            if(value.type==='ready'){counters.ready_messages++;counters.ready_at=performance.now();counters.local_output_confirmed=value.audio_output==='local_device';counters.profile_verified=value.quality_mode_verified_by==='observed_current_task_fields';}
            if(value.type==='audio-playback'){counters.playback_messages++;if(counters.first_playback_at===null)counters.first_playback_at=performance.now();if(Number.isFinite(value.duration_ms))counters.playback_duration_ms+=value.duration_ms;}
            if(value.type==='transcript' && value.source==='translation' && typeof value.text==='string'){
              counters.translated_transcript_messages++;counters.translated_transcript_characters+=value.text.length;counters.last_transcript_language=['en','es','fr'].includes(value.target_language)?value.target_language:null;
            }
            if(value.type==='transcript' && value.source==='original' && typeof value.text==='string'){
              counters.original_transcript_messages++;counters.original_transcript_characters+=value.text.length;
              for(const language of [value.source_language,value.language,value.detected_language])if(typeof language==='string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language) && !counters.original_transcript_languages.includes(language))counters.original_transcript_languages.push(language);
            }
            if(value.type==='error')counters.provider_error_code=typeof value.code==='string' && /^[a-z0-9_]{1,80}$/.test(value.code)?value.code:'unclassified';
            if(value.type==='stream-diagnostics'){
              counters.provider_diagnostic_messages++;
              if(value.input_transport && ['messages','send_total_ms','send_max_ms'].every(key=>Number.isFinite(value.input_transport[key]) && value.input_transport[key]>=0))counters.input_transport={...value.input_transport};
              for(const key of ['validated_transcription','translated_transcription','partial_translated_transcription','output_audio_data','warning','other'])if(Number.isInteger(value.provider_event_counts?.[key]) && value.provider_event_counts[key]>=0)counters.provider_raw_event_counts[key]=Math.max(counters.provider_raw_event_counts[key] || 0,value.provider_event_counts[key]);
              for(const [field,key] of [['input_bytes','provider_reported_input_bytes'],['upstream_input_bytes','provider_reported_upstream_input_bytes'],['filtered_events','provider_filtered_events']])if(Number.isInteger(value[field]) && value[field]>=0)counters[key]=Math.max(counters[key] || 0,value[field]);
              if(Array.isArray(value.observed_source_languages))for(const language of value.observed_source_languages)if(['en','es','fr'].includes(language) && !counters.provider_source_languages.includes(language))counters.provider_source_languages.push(language);
            }
            if(value.type==='native-output-stats'){
              counters.native_output_stats_messages++;
              for(const [field,key] of [['maximum_queued_ms','native_maximum_queued_ms'],['queued_ms','native_queued_ms'],['rejected_pushes','native_rejected_pushes']]){
                const vector=value[field];if(!vector || typeof vector!=='object')continue;
                for(const channel of ['original','translation'])if(Number.isFinite(vector[channel]) && vector[channel]>=0)counters[key][channel]=field==='queued_ms'?vector[channel]:Math.max(counters[key][channel] || 0,vector[channel]);
              }
              if(Number.isFinite(value.queued_ms?.original) && Number.isFinite(value.queued_ms?.translation))counters.native_maximum_total_queued_ms=Math.max(counters.native_maximum_total_queued_ms || 0,value.queued_ms.original+value.queued_ms.translation);
              if(Number.isFinite(value.output_frames) && value.output_frames>=0)counters.native_output_frames=Math.max(counters.native_output_frames || 0,value.output_frames);
              if(typeof value.error_code==='string' && /^[a-z0-9_]{1,80}$/.test(value.error_code))counters.native_error_code=value.error_code;
            }
            if(value.type==='input-ended')counters.input_ended_at=performance.now();
            if(value.type==='done'){counters.session_done=true;counters.done_at=performance.now();}
          });
        }
        send(value){
          if(typeof value==='string'){
            let item;try{item=JSON.parse(value);}catch{return super.send(value);}
            if(item.type==='start'){
              if(counters.start_messages || item.source_language!==source || item.target_language!==target || item.audio_output!=='local_device')throw Error('Unexpected paid-session request');
              counters.start_messages++;counters.start_at=performance.now();item.max_seconds=25;item.diagnostics=true;value=JSON.stringify(item);
            }
            if(item.type==='finish')counters.finish_messages++;
          }else if(value instanceof ArrayBuffer || ArrayBuffer.isView(value)){
            const view=value instanceof ArrayBuffer?new DataView(value):new DataView(value.buffer,value.byteOffset,value.byteLength);counters.input_packets++;counters.input_bytes+=view.byteLength;
            if(counters.first_input_at===null)counters.first_input_at=performance.now();
            for(let index=0;index+1<view.byteLength;index+=2){const sample=view.getInt16(index,true)/32768;counters.input_samples++;counters.input_peak=Math.max(counters.input_peak,Math.abs(sample));counters.input_sum_squares+=sample*sample;if(sample!==0)counters.nonzero_input_samples++;}
          }
          return super.send(value);
        }
      };
      window.__stopPaidDubbingProbe=()=>{counters.stopped=true;const stop=document.querySelector('#stop-dubbing');if(stop && !stop.disabled)stop.click();if(window.__paidDubbingSocket?.readyState<2)window.__paidDubbingSocket.close();};
    },{target,source});
    await page.goto(base+'/dubbing?provider=palabra&source=youtube&view=simple',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#youtube-player')?.dataset.ready==='true',null,{timeout:25000});
    await page.locator('#simple-settings > summary').click();await page.locator('#source-language').selectOption(source);await page.locator('#target-language').selectOption(target);
    await page.evaluate(()=>{document.title='Brivany Paid Dubbing Probe';});
    frame=page.frames().find(frame=>frame.url().startsWith('https://www.youtube.com/embed/qGEPPNTTYmk'));if(!frame)throw Error('Expected official YouTube iframe is missing');
    report.sample_interval_requested_ms=250;report.video_observations={count:0,playing:0,paused:0,paused_while_translation_streaming:0,ended:0,buffering_or_not_ready:0,missing_dimensions:0,first_time:null,last_time:null,clock_regressions:0,max_stationary_run_samples:0};
    let previous=null,stationary=0;const begun=Date.now();
    deadlineTimer=setTimeout(()=>{report.hard_deadline_reached=true;page?.evaluate(()=>window.__stopPaidDubbingProbe?.()).catch(()=>{});},70000);
    await page.locator('#simple-play').click();
    while(Date.now()-begun<70000){
      const [state,ui]=await Promise.all([videoState(),page.evaluate(()=>({
        error:!document.querySelector('#dub-error').hidden,message:document.querySelector('#dub-error').textContent,
        running:document.querySelector('#session-state').textContent==='Traduciendo',
        caption:document.querySelector('.captions')?.dataset.hasText==='true' && document.querySelector('#translation-caption').textContent.trim().length>0,
        liveCaption:!document.querySelector('#simple-caption')?.hidden && document.querySelector('#simple-caption')?.textContent.trim().length>0,
        socketError:window.__paidDubbingProbe.provider_error_code,done:window.__paidDubbingProbe.session_done,
        readyElapsed:window.__paidDubbingProbe.ready_at===null?null:performance.now()-window.__paidDubbingProbe.ready_at,
        drainElapsed:window.__paidDubbingProbe.input_ended_at===null?null:performance.now()-window.__paidDubbingProbe.input_ended_at
      }))]);
      const counts=report.video_observations;counts.count++;
      if(state){
        if(state.paused){counts.paused++;if(ui.running)counts.paused_while_translation_streaming++;}else counts.playing++;if(state.ended)counts.ended++;if(state.ready_state<2)counts.buffering_or_not_ready++;if(!state.has_dimensions)counts.missing_dimensions++;
        if(counts.first_time===null)counts.first_time=state.current_time;counts.last_time=state.current_time;
        if(previous!==null){if(state.current_time<previous-.05)counts.clock_regressions++;stationary=state.current_time<=previous+.005?stationary+1:0;counts.max_stationary_run_samples=Math.max(counts.max_stationary_run_samples,stationary);}previous=state.current_time;
        report.last_video_state=state;
      }
      report.live_caption_seen=Boolean(report.live_caption_seen || ui.liveCaption);report.translation_caption_seen=Boolean(report.translation_caption_seen || ui.caption);report.streaming_state_seen=Boolean(report.streaming_state_seen || ui.running);
      if(ui.error || ui.socketError){report.status='session_error';report.ui_error=String(ui.message || '').slice(0,350);break;}
      if(ui.done){report.status='session_completed';break;}
      if(ui.drainElapsed!==null && ui.drainElapsed>=report.drain_window_seconds*1000){report.status='drain_limit_reached';break;}
      await sleep(250);
    }
    if(!report.status)report.status='bounded_observation_finished';
  }catch(error){report.status='observation_incomplete';report.error_name=error.name || 'Error';report.error_message=String(error.message).replace(/https?:\/\/[^\s]+/g,'[URL]').slice(0,350);}
  finally{
    clearTimeout(deadlineTimer);
    if(page && !page.isClosed())try{
      await page.evaluate(()=>window.__stopPaidDubbingProbe?.());
      const values=await page.evaluate(()=>{const value=window.__paidDubbingProbe;if(!value)return null;const {input_sum_squares,first_input_at,first_playback_at,ready_at,start_at,input_ended_at,done_at,...safe}=value;
        return {...safe,input_rms:value.input_samples?Math.sqrt(input_sum_squares/value.input_samples):null,
          first_playback_from_input_ms:first_playback_at!==null && first_input_at!==null?first_playback_at-first_input_at:null,
          ready_from_request_ms:ready_at!==null && start_at!==null?ready_at-start_at:null,
          input_duration_seconds:value.input_bytes/48000,provider_input_end_from_ready_ms:input_ended_at!==null && ready_at!==null?input_ended_at-ready_at:null,
          completed_drain_ms:done_at!==null && input_ended_at!==null?done_at-input_ended_at:null};});
      report.session=values;report.no_popup=values?.popup_attempts===0;report.capture_one_session=values?.capture_requests===1 && values?.start_messages===1;
      report.video_advanced=report.video_observations?.last_time>report.video_observations?.first_time;
      report.no_pause_while_streaming=Boolean(report.streaming_state_seen && report.video_observations?.paused_while_translation_streaming===0);
      report.actual_translated_output_submitted=Boolean(values?.playback_messages>0 && values?.local_output_confirmed);
      report.nonzero_input_observed=Boolean(values?.nonzero_input_samples>0);
      if(values?.capture_requests>1 || values?.start_messages>1 || values?.microphone_requests || values?.popup_attempts){report.status='boundary_failure';process.exitCode=3;}
    }catch{report.cleanup_observation_failed=true;}
    if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
    report.browser_closed=true;if(!report.actual_translated_output_submitted || !report.nonzero_input_observed || !report.live_caption_seen || !report.video_advanced || !report.no_pause_while_streaming || report.status==='session_error' || report.status==='observation_incomplete')process.exitCode=2;
    save();
  }
})();
