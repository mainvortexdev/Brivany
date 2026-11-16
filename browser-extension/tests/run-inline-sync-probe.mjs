/* Opt-in real provider trial. Video and both Spanish voices are owned fixtures. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {cp,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {continuityQuality} from './continuity-quality.mjs';
import {sourceCoverageReached} from './trial-coverage.mjs';
import {makeRequestDiagnostics} from './request-diagnostics.mjs';
import {openPublicVideo,openingErrorCodes,prefixOpeningDiagnostic} from './public-video-opening.mjs';

const local=process.argv.includes('--fixture');
const encoded=process.argv.includes('--encoded');
const highResolution=local&&encoded&&process.argv.includes('--hd');
const captions=process.argv.includes('--captions');
const short=process.argv.includes('--short');
const workspaceStop=local&&process.argv.includes('--workspace-stop');
const stalledTurn=local&&process.argv.includes('--stall');
const pausedStart=local&&process.argv.includes('--paused-start');
const sourceReset=local&&process.argv.includes('--source-reset');
const providerError=local&&process.argv.includes('--provider-error');
const lateCues=local&&process.argv.includes('--late-cues');
const fromWorkspace=workspaceStop||stalledTurn||pausedStart||providerError||lateCues;
const interruption='Muse interrumpió la transcripción en este ensayo.';
const youtube=process.argv.includes('--youtube');
const prefix=process.argv.includes('--prefix');
const progressiveFixture=local&&prefix&&process.argv.includes('--progressive-turn');
const prefixRewind=local&&prefix&&process.argv.includes('--prefix-rewind');
const position=Number(process.argv.find(value=>value.startsWith('--position='))?.split('=')[1]||0);
const relayPortArg=process.argv.find(value=>value.startsWith('--relay-port='));
const relayPort=relayPortArg?Number(relayPortArg.slice('--relay-port='.length)):null;
const cueSinkArg=process.argv.find(value=>value.startsWith('--cue-sink='));
const cueSinkToken=cueSinkArg?process.env.BRIVANY_LAB_CUE_TOKEN:null;
let cueSink=null;
const longTrial=process.argv.includes('--long');
const observationArg=process.argv.find(value=>value.startsWith('--observation-seconds='));
const minimumSourceArg=process.argv.find(value=>value.startsWith('--minimum-source-end='));
const observationSeconds=observationArg?Number(observationArg.slice('--observation-seconds='.length)):longTrial?60:28;
const minimumLiveSourceEnd=minimumSourceArg?Number(minimumSourceArg.slice('--minimum-source-end='.length)):longTrial?31:0;
if(observationArg&&!longTrial)throw Error('Extended observation requires the continuity trial.');
if(!Number.isInteger(observationSeconds)||observationSeconds<28||observationSeconds>180||
  !Number.isFinite(minimumLiveSourceEnd)||minimumLiveSourceEnd<0||minimumLiveSourceEnd>observationSeconds-8)throw Error('The observation budget must cover the required source span and its bounded lag.');
const trialMs=observationSeconds*1000;
const liveCueTarget=longTrial||progressiveFixture?4:1;
if(youtube&&local)throw Error('The public example must use the actual selected-video pipeline.');
if(prefix&&(position!==0||!(youtube||local&&encoded)))throw Error('The prefill trial needs the start of the public video or an encoded local fixture.');
if(!local&&!process.argv.includes('--allow-paid'))throw Error('Pass --allow-paid to run one bounded provider trial.');
if(relayPortArg&&(local||!Number.isInteger(relayPort)||relayPort<1||relayPort>65535))throw Error('Pass a valid loopback relay port for a real provider trial.');
if(cueSinkArg){
  try{cueSink=new URL(cueSinkArg.slice('--cue-sink='.length));}catch{}
  if(!youtube||!cueSink||cueSink.origin!==`http://127.0.0.1:${cueSink.port}`||!cueSink.port||cueSink.pathname!=='/diagnostic-cue'||cueSink.username||cueSink.password||cueSink.search||cueSink.hash||!/^[-\w]{22,128}$/.test(cueSinkToken||'')){
    throw Error('A cue sink requires a bounded YouTube trial, the local diagnostic route and its bearer.');
  }
}
const require=createRequire(import.meta.url);
const {chromium}=require('../../motion-studio/node_modules/playwright-core');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const folder=path.join(root,'tmp/selected-video');
await mkdir(folder,{recursive:true});
const temporary=await mkdtemp(path.join(folder,'inline-isolated-'));
const extension=path.join(temporary,'extension');
await cp(path.join(root,'browser-extension'),extension,{recursive:true});
const manifestPath=path.join(extension,'manifest.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
manifest.host_permissions=youtube?['https://www.youtube.com/*']:['http://127.0.0.1/*'];
await writeFile(manifestPath,JSON.stringify(manifest));
const background=path.join(extension,'background.js');
const backgroundCode=await readFile(background,'utf8');
const prefixMonitor=prefix?`
globalThis.__ownedPrefix={pcm_bytes:0,preparation_requests:0};
const NativeWebSocket=globalThis.WebSocket;
globalThis.WebSocket=class extends NativeWebSocket{
  constructor(url,...protocols){
    super(url,...protocols);
    this.ownedPath=new URL(url).pathname;
    if(this.ownedPath!=='/prefix')return;
    this.addEventListener('message',event=>{
      if(typeof event.data!=='string')return;
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(data.type==='prefix-ready'){
        const turns=Array.isArray(data.turns)?data.turns:[];
        Object.assign(__ownedPrefix,{ready_at:Date.now(),duration_ms:data.duration_ms,resume_from_ms:data.resume_from_ms,
          preparation_metrics:Object.fromEntries(['content_gate_ms','asr_ms','turn_classification_ms','prosody_ms','local_timbre_ms','postprocess_ms','total_ms','capture_receive_ms']
            .filter(name=>typeof data.preparation_metrics?.[name]==='number'&&Number.isFinite(data.preparation_metrics[name])&&data.preparation_metrics[name]>=0&&data.preparation_metrics[name]<=60000)
            .map(name=>[name,data.preparation_metrics[name]])),
          turns:turns.map(({start_ms,end_ms,content})=>({start_ms,end_ms,content}))});
      }else if(data.type==='error')__ownedPrefix.error_code=data.code;
    });
  }
  send(raw){
    if(typeof raw==='string'&&['/prefix','/sync'].includes(this.ownedPath)){
      let data;try{data=JSON.parse(raw);}catch{}
      if(this.ownedPath==='/prefix'&&data?.type==='prepare-video'){
        __ownedPrefix.preparation_requests++;
        __ownedPrefix.started_at=Date.now();__ownedPrefix.position_ms=data.position_ms;
      }else if(this.ownedPath==='/sync'&&data?.type==='start'){
        __ownedPrefix.attached=typeof data.prefix_id==='string';
        __ownedPrefix.activation_position_ms=data.prefix_position_ms;
      }
    }else if(this.ownedPath==='/prefix')__ownedPrefix.pcm_bytes+=raw.byteLength??raw.size??0;
    return super.send(raw);
  }
};`:'';
const sampleReceiver=cueSink?`
chrome.runtime.onMessage.addListener((value,sender)=>{
  if(globalThis.__ownedSample||sender.id!==chrome.runtime.id||sender.frameId!==0||value?.type!=='owned-diagnostic-cue')return;
  const {source_start_ms,source_end_ms,sample_rate,pcm_base64}=value;
  if(sample_rate!==24000||!Number.isInteger(source_start_ms)||!Number.isInteger(source_end_ms)||source_start_ms<0||source_end_ms<=source_start_ms||typeof pcm_base64!=='string'||!pcm_base64.length||pcm_base64.length>384000)return;
  globalThis.__ownedSample={source_start_ms,source_end_ms,sample_rate,pcm_base64};
});`:'';
await writeFile(background,'globalThis.__ownedProtocol=[];\nglobalThis.__ownedRequestDiagnostics=('+makeRequestDiagnostics.toString()+')();\n'+prefixMonitor+'\n'+backgroundCode.replace("if(value.type==='error')return fail", "if(['error','ready','source-turn','source-progress','source-skipped','prefix-used','live-asr-start','live-asr-connected','dub-cue','stage-metrics','done'].includes(value.type))globalThis.__ownedProtocol.push({...__ownedRequestDiagnostics(value),type:value.type,code:value.code,start:value.source_start_ms,end:value.source_end_ms,processed:value.processed_ms,stage:value.stage,source_phase:typeof value.segment_id==='string'?(value.segment_id.startsWith('translation-prefix-')?'prefix':'live'):undefined,speaker:value.speaker_index,category:value.voice_category,voice_category_provisional:value.voice_category_provisional,register:value.register_source,confidence:value.register_confidence,advisory:value.voice_register,voice_timbre:value.voice_timbre,timbre_source:value.timbre_source,timbre_confidence:value.timbre_confidence,f0:value.f0_median,resonance:value.resonance_hz,voiced:value.voiced_windows,resonanceWindows:value.resonance_windows,available:value.available,reason:value.reason,cluster:value.cluster,similarity:value.similarity,windows:value.windows,latency_ms:value.latency_ms,timing_quality:value.timing_quality,duration_ms:value.duration_ms,synthesis_speed:value.synthesis_speed,duration_budget_ms:value.duration_budget_ms,duration_budget_applied:value.duration_budget_applied,source_word_count:value.source_word_count,translated_word_count:value.translated_word_count,resume_from_ms:value.resume_from_ms,start_ms:value.start_ms,at:Date.now()});if(value.type==='error')return fail")+'\nglobalThis.__ownedActivateSource=activateSource;\n'+sampleReceiver);
const inline=path.join(extension,'inline-translation.js');
const bufferMonitor=`    caption, failure, finished, buffer:value=>{
      const state={...value,paused:frame.paused,ready:frame.readyState,frames:frame.getVideoPlaybackQuality().totalVideoFrames,
        buffered:[...Array(frame.buffered.length)].map((_,i)=>[frame.buffered.start(i),frame.buffered.end(i)])};
      const data=document.documentElement.dataset;
      data.ownedBuffer=JSON.stringify(state);
      data.ownedFallbackMonitor='true';
      if(!data.ownedFirstPicture&&!frame.paused&&state.frames>0&&value.media>0)data.ownedFirstPicture=String(performance.now());
      if(data.ownedFirstPicture&&Number.isFinite(value.lag)){
        const lag=engine.ownedLag??={initial_seconds:value.lag,maximum_seconds:value.lag};
        lag.maximum_seconds=Math.max(lag.maximum_seconds,value.lag);lag.final_seconds=value.lag;
        lag.maximum_growth_seconds=Math.max(0,lag.maximum_seconds-lag.initial_seconds);
        data.ownedLag=JSON.stringify(lag);
      }
      const fallback=engine.sourceFallback&&!frame.paused&&engine.currentGain===engine.sourceGain;
      const previous=engine.ownedFallbackClock;
      const step=previous?value.media-previous.media:0;
      if(fallback){
        data.ownedOriginalPlayed=String(value.media);
        if(previous?.fallback&&step>0&&step<=.25){
          const intervals=engine.ownedFallbackIntervals??=[];
          const last=intervals.at(-1);
          if(last&&previous.media<=last.end+.001)last.end=value.media;
          else if(intervals.length<128)intervals.push({start:previous.media,end:value.media});
          data.ownedFallbackIntervals=JSON.stringify(intervals);
        }
      }
      engine.ownedFallbackClock={media:value.media,fallback};
      const liveStats=engine.stats();
      data.ownedProductionAudio=JSON.stringify({signaled_voices:liveStats.signaled_voices,
        recorder_gap_recoveries:liveStats.recorder_gap_recoveries,
        completed_voice_count:liveStats.completed_voice_count,completed_voices_with_signal:liveStats.completed_voices_with_signal,
        first_signal_after_capture_ms:liveStats.first_signal_after_capture_ms});
    },`;
const bufferHook='buffer:value=>{';
const bufferBody=bufferMonitor.slice(bufferMonitor.indexOf(bufferHook)+bufferHook.length,bufferMonitor.lastIndexOf('},'));
const inlineSource=await readFile(inline,'utf8');
if(!inlineSource.includes(bufferHook))throw Error('Missing numeric buffer diagnostic hook.');
await writeFile(inline,inlineSource
  .replace(bufferHook,bufferHook+bufferBody)
  .replace('const size=track.getSettings();',`const size=track.getSettings();document.documentElement.dataset.ownedRecorder=JSON.stringify({width:size.width,height:size.height,frameRate:size.frameRate});
    const audioSettings=stream.getAudioTracks()[0]?.getSettings()||{};
    document.documentElement.dataset.ownedInputAudio=JSON.stringify({context_sample_rate:audio.sampleRate,
      declared_sample_rate:audioSettings.sampleRate,declared_sample_size:audioSettings.sampleSize,declared_channels:audioSettings.channelCount});`)
  .replace('initialSourceTime=source.currentTime;sourceRate=source.playbackRate;', 'initialSourceTime=source.currentTime;sourceRate=source.playbackRate;engine.ownedCaptureAt=initialSourceTime;engine.ownedCaptureRate=sourceRate;document.documentElement.dataset.ownedCaptureWall=String(performance.now());document.documentElement.dataset.ownedSourceAnchor=String(Math.round(initialSourceTime*1000));'));
const player=path.join(extension,'buffered-player.js');
const capturePCM=cueSink?'voice.ownedPCM=whole.subarray(0,288000);':'';
const code=(await readFile(player,'utf8')).replace('node.connect(this.audio.destination);',`node.connect(this.audio.destination);const monitor=this.audio.createAnalyser();node.connect(monitor);voice.ownedMonitor=monitor;${capturePCM}`);
const hook='await cue.voice.play();';
if(!code.includes(hook))throw Error('Missing playback hook.');
const captureSample=cueSink?`
        if(row.audio_peak>.01&&!this.ownedSampleSent&&Number.isFinite(this.ownedCaptureAt)&&turn.end>turn.start){
          this.ownedSampleSent=true;
          const reader=new FileReader();
          reader.onload=()=>chrome.runtime.sendMessage({type:'owned-diagnostic-cue',sample_rate:24000,
            source_start_ms:Math.round((this.ownedCaptureAt+turn.start*this.ownedCaptureRate)*1000),
            source_end_ms:Math.round((this.ownedCaptureAt+turn.end*this.ownedCaptureRate)*1000),pcm_base64:reader.result.split(',')[1]}).catch(()=>{});
          reader.readAsDataURL(new Blob([cue.voice.ownedPCM]));
        }`:'';
await writeFile(player,code.replace(hook,`${hook}
      const mark=document.documentElement, rows=JSON.parse(mark.dataset.ownedCues||'[]');
      const picture=this.video.currentTime-this.mediaOrigin;
      const gap=this.recorderGap;
      const row={speaker:cue.event.speaker_index, category:cue.event.voice_category, provisional:cue.event.voice_category_provisional===true, timing_quality:cue.event.timing_quality, sample_rate:cue.event.sample_rate, source:turn.start, source_end:turn.end, picture, recovered_gap:Boolean(gap&&turn.start>=gap.start&&picture<=gap.end+.04), rate:cue.voice.playbackRate, at:performance.now(), duration:cue.duration};
      const monitor=cue.voice.ownedMonitor, samples=new Float32Array(monitor.fftSize);
      const meter=setInterval(()=>{
        if(this.closed){clearInterval(meter);return;}
        monitor.getFloatTimeDomainData(samples);
        for(const sample of samples)row.audio_peak=Math.max(row.audio_peak||0,Math.abs(sample));
        if(row.audio_peak>.01&&row.signal_at===undefined)row.signal_at=performance.now();
        row.played=cue.voice.currentTime;
        row.wall=(performance.now()-row.at)/1000;
        mark.dataset.ownedCues=JSON.stringify(rows);
        ${captureSample}
      },80);
      rows.push(row);mark.dataset.ownedCues=JSON.stringify(rows);
      cue.voice.addEventListener('ended',()=>{clearInterval(meter);row.completed=true;row.played=cue.voice.currentTime;row.wall=(performance.now()-row.at)/1000;mark.dataset.ownedCues=JSON.stringify(rows);},{once:true});`));
const sounds=await Promise.all(['masculine','feminine'].map(name=>readFile(path.join(root,'tmp/workspace-translation-real',name+'.wav'))));
let movie;
if(encoded){
  const target=path.join(temporary,'owned-video.mp4');
  const wave=name=>path.join(root,'tmp/workspace-translation-real',name+'.wav');
  const videoFixture=highResolution?'testsrc2=s=1280x720:r=60:d=34':'testsrc2=s=640x360:r=30:d=34';
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',videoFixture,'-i',wave('masculine'),'-i',wave('feminine'),'-i',wave('masculine'),'-filter_complex','[1:a]adelay=1350[a];[2:a]adelay=7350[b];[3:a]adelay=13350[c];[a][b][c]amix=inputs=3:normalize=0,apad[s]','-map','0:v','-map','[s]','-c:v','libx264','-threads','2','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-t',short?'16':'34',target]);
  movie=await readFile(target);
}
const html=`<!doctype html><meta charset=utf-8><style>video{width:640px;height:360px}</style><button>Preparar video propio</button><br><video playsinline></video><script>
document.querySelector('button').onclick=async()=>{
  const audio=new AudioContext(), video=document.querySelector('video'), canvas=document.createElement('canvas');
  if(${encoded}){video.src='/fixture.mp4';await video.play();if(${captions}){const track=video.addTextTrack('captions','Owned Spanish','es');track.mode='hidden';for(const [start,text] of [[1.35,'La puerta está abierta, puedes entrar ahora.'],[7.35,'El tren llega mañana a las nueve.'],[13.35,'La puerta está abierta, puedes entrar ahora.']])track.addCue(new VTTCue(start,start+2.6,text));}window.prepared=true;window.speak=()=>{};return;}
  await audio.resume();canvas.width=640;canvas.height=360;
  const ctx=canvas.getContext('2d'), start=performance.now();
  setInterval(()=>{ctx.fillStyle='#253d50';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='32px Georgia';ctx.fillText(((performance.now()-start)/1000).toFixed(2),80,130)},33);
  const destination=audio.createMediaStreamDestination();
  const samples=await Promise.all(['/a.wav','/b.wav'].map(async url=>audio.decodeAudioData(await(await fetch(url)).arrayBuffer())));
  video.srcObject=new MediaStream([...canvas.captureStream(30).getVideoTracks(),...destination.stream.getAudioTracks()]);
  await video.play();window.prepared=true;
  window.speak=()=>{for(const [id,offset] of [[0,.4],[1,6],[0,12]]){const node=audio.createBufferSource();node.buffer=samples[id];node.connect(destination);node.start(audio.currentTime+offset);}};
};</script>`;
const server=createServer((req,res)=>{
  if(req.url==='/fixture.mp4'&&movie){
    res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
    const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){
      const start=Number(range[1]), end=Math.min(movie.length-1,range[2]?Number(range[2]):movie.length-1);
      if(start>end){res.writeHead(416,{'Content-Range':`bytes */${movie.length}`});res.end();return;}
      res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${movie.length}`,'Content-Length':end-start+1});
      res.end(movie.subarray(start,end+1));return;
    }
    res.setHeader('Content-Length',movie.length);res.end(movie);return;
  }
  const id=req.url==='/a.wav'?0:req.url==='/b.wav'?1:-1;
  res.setHeader('Content-Type',id<0?'text/html':'audio/wav');res.end(id<0?html:sounds[id]);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
if(local||relayPort!==null){
  const endpoint=path.join(extension,'desktop-connect.js');
  await writeFile(endpoint,(await readFile(endpoint,'utf8')).replace('127.0.0.1:48217','127.0.0.1:'+(relayPort??server.address().port)));
}
let websocket,workspaceSocket,starts=0;
if(local){
  const {wsServer:Server}=require('../../motion-studio/node_modules/playwright-core/lib/utilsBundle.js');
  websocket=new Server({server});
  const raw=Buffer.alloc(48000);for(let i=0;i<24000;i++)raw.writeInt16LE(Math.round(3000*Math.sin(i*2*Math.PI*440/24000)),i*2);
  const prefixId='owned-local-preparation';
  websocket.on('connection',(ws,request)=>{
    let seconds=0;const send=event=>ws.send(JSON.stringify({epoch:1,...event}));
    if(prefix&&request.url==='/prefix'){
      let pcmBytes=0,anchor;
      ws.on('message',(bytes,binary)=>{
        if(binary){pcmBytes+=bytes.length;return;}
        const event=JSON.parse(bytes);
        if(event.type==='authenticate')send({type:'authenticated'});
        else if(event.type==='prepare-video'){
          anchor=event.position_ms;send({type:'prefix-capture',duration_ms:10000,sample_rate:24000,input_frame_ms:80});
        }else if(event.type==='finish'){
          if(pcmBytes!==125*3840){send({type:'error',code:'fixture_prefix_length'});return;}
          send({type:'prefix-ready',prefix_id:prefixId,position_ms:anchor,duration_ms:10000,resume_from_ms:10000,
            turns:[{start_ms:250,end_ms:3250,content:'speech'},{start_ms:3500,end_ms:5000,content:'music'}]});
        }
      });
      return;
    }
    ws.on('message',(bytes,binary)=>{
      if(binary){
        seconds+=.08;send({type:'source-progress',processed_ms:Math.round(seconds*1000)});
        if(prefix&&seconds>=10&&seconds-.08<10)send({type:'live-asr-start',source_start_ms:10000});
        if(workspaceStop&&seconds>=6.4){ws.close(1000,'workspace-stop');return;}
        if(providerError&&seconds>=6.4){send({type:'error',message:interruption});ws.close();return;}
        const starts=progressiveFixture?[.25,7.25,10.25,13.25,16.25]:prefix?[.25,7.25,12.25]:[.25,6.25,12.25];
        for(const [i,start] of starts.entries()){
          const cue={cue_id:'owned-'+i,source_start_ms:start*1000,source_end_ms:(start+3)*1000};
          const delayed=stalledTurn&&i===0;
          const readyAt=delayed?16:start+(lateCues&&i<2?7.84:3);
          if(seconds>=start&&seconds-.08<start)send({type:'source-turn',phase:'start',...cue,source_end_ms:null});
          if(!delayed&&seconds>=start+3&&seconds-.08<start+3)send({type:'source-turn',phase:'end',...cue});
          if(seconds>=readyAt&&seconds-.08<readyAt){
            const speaker=progressiveFixture&&i>0?2:i%2+1;
            const timingQuality=progressiveFixture&&i>0&&i<starts.length-1?'asr_partial_estimate':'asr_turn';
            send({type:'dub-cue',...cue,speaker_index:speaker,voice_category:speaker===2?'feminine':'masculine',timing_quality:timingQuality,sample_rate:24000,pcm_base64:raw.toString('base64'),final:true});
          }
        }return;
      }
      const event=JSON.parse(bytes);
      if(event.type==='connect')send({type:'connected',token:'owned-local-capability-01234567890',websocket_url:`ws://127.0.0.1:${server.address().port}/sync`,prefix_url:prefix?`ws://127.0.0.1:${server.address().port}/prefix`:undefined,selected_video_protocol:2,progressive_translation_available:true,inline_video_sync:{target:'en',voice:'auto'}});
      else if(event.type==='authenticate'){send({type:'authenticated'});if(request.url==='/workspace')workspaceSocket=ws;}
      else if(event.type==='start'){
        starts++;send({type:'ready'});
        if(prefix&&event.prefix_id===prefixId){
          send({type:'prefix-used',duration_ms:10000,resume_from_ms:10000});
          send({type:'source-skipped',cue_id:'owned-music',source_start_ms:3500,source_end_ms:5000,reason:'music'});
        }
      }
      else if(event.type==='finish'){send({type:'done'});ws.close();}
      else if(event.type==='ping')send({type:'pong'});
    });
  });
}
const report={type:youtube?'public_youtube_isolated_brave_inline_sync':local?'real_isolated_brave_inline_sync_local_protocol_fixture':'real_isolated_brave_inline_sync_and_provider_voice_trial',passed:false,source_owned_synthetic:!youtube,encoded_video_source:encoded,owned_caption_track:captions,provider_trial_max_seconds:local?0:trialMs/1000,prefill_requested:prefix,continuity_trial:longTrial,progressive_fixture:progressiveFixture,billing_amount:local?0:null,user_profile_used:false,physical_listening_verified:false,cloning_enabled:false};
const isLiveCue=(cue,resume)=>cue.source*1000>=resume-20&&cue.source_end>7;
const timingQuality=value=>typeof value==='string'&&/^[a-z_]{1,40}$/.test(value)?value:'unreported';
const publicVideoId='sr_iLGKNsxU';
async function sourceIdentity(source){
  return source.evaluate((video,expected)=>{
    const player=document.querySelector('#movie_player');
    const response=player?.getPlayerResponse?.(), initial=window.ytInitialPlayerResponse;
    const identifier=value=>typeof value==='string'&&/^[\w-]{11}$/.test(value)?value:null;
    const duration=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
    const identity={wall_ms:performance.now(),page_video_id:identifier(new URL(location.href).searchParams.get('v')),
      player_video_id:identifier(player?.getVideoData?.()?.video_id),response_video_id:identifier(response?.videoDetails?.videoId),
      initial_video_id:identifier(initial?.videoDetails?.videoId),media_duration_seconds:duration(video.duration),
      player_duration_seconds:duration(player?.getDuration?.()),response_length_seconds:duration(response?.videoDetails?.lengthSeconds),
      initial_length_seconds:duration(initial?.videoDetails?.lengthSeconds),source_time_seconds:video.currentTime,
      playback_rate:video.playbackRate,ready_state:video.readyState,network_state:video.networkState,
      paused:video.paused,ended:video.ended,ad_showing:Boolean(player?.classList.contains('ad-showing')||player?.classList.contains('ad-interrupting')),
      media_error_code:video.error?.code??null};
    identity.video_ids_match=['page_video_id','player_video_id','response_video_id','initial_video_id'].every(key=>identity[key]===expected);
    identity.durations_agree=['media_duration_seconds','player_duration_seconds','response_length_seconds','initial_length_seconds']
      .every(key=>identity[key]>0&&Math.abs(identity[key]-identity.media_duration_seconds)<=2);
    identity.verified=identity.video_ids_match&&identity.durations_agree&&!identity.ad_showing&&identity.ready_state>=2;
    return identity;
  },publicVideoId);
}
function assertSourceIdentity(identity){
  if(!identity.verified)throw Object.assign(Error('The selected source identity or duration was not verified.'),{code:'source_identity_mismatch'});
}
function mergedDuration(intervals){
  let duration=0,end=-Infinity;
  for(const span of intervals.sort((a,b)=>a.start-b.start)){
    if(span.end>span.start&&span.end>end){duration+=span.end-Math.max(end,span.start);end=span.end;}
  }
  return duration;
}
let context,worker,phase='abrir-brave-aislado';
try{
  context=await chromium.launchPersistentContext(path.join(temporary,'profile'),{executablePath:'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--autoplay-policy=no-user-gesture-required']});
  // Brave runs its own built-in extension workers too: pick Brivany's.
  const ownWorker=candidate=>candidate.url().endsWith('/background.js');
  worker=context.serviceWorkers().find(ownWorker)||await context.waitForEvent('serviceworker',{predicate:ownWorker,timeout:8000});
  const page=await context.newPage(), url=youtube?'https://www.youtube.com/watch?v=sr_iLGKNsxU'+(position>0?`&t=${position}s`:''):`http://127.0.0.1:${server.address().port}/`;
  phase='abrir-video';
  let source;
  if(youtube){
    source=await openPublicVideo(page,url,{expectedVideoId:publicVideoId,position,onPhase:value=>phase=value});
    report.public_source_playing=true;
    report.requested_video_position=position;
    report.source_identity={expected_video_id:publicVideoId,prefix_asr_may_precede_ready_check:prefix,
      ready:await sourceIdentity(source)};
    assertSourceIdentity(report.source_identity.ready);
  }else{await page.goto(url,{timeout:10000,waitUntil:'domcontentloaded'});source=page.locator('video').first();await page.locator('button').click();await page.waitForFunction(()=>window.prepared);}
  await source.evaluate(video=>{
    window.ownedSource=video;window.ownedSourceEvents=[];
    for(const type of ['pause','play','playing','waiting','seeking','seeked','emptied','ended','error','ratechange','loadstart','durationchange','stalled'])
      video.addEventListener(type,()=>{if(window.ownedSourceEvents.length<80)window.ownedSourceEvents.push({type,time:video.currentTime,
        wall_ms:performance.now(),duration_seconds:Number.isFinite(video.duration)?video.duration:null,
        selected:video.hasAttribute('data-brivany-selection'),ready:video.readyState,network:video.networkState,
        paused:video.paused,ended:video.ended,media_error_code:video.error?.code??null});});
  });
  report.source_audio=await source.evaluate(video=>{
    const player=document.querySelector('#movie_player');
    const clean=track=>{
      if(!track||typeof track!=='object')return null;
      const safe={};
      for(const key of ['id','languageCode','kind','audioTrackType'])
        if(typeof track[key]==='string'&&/^[a-zA-Z0-9_.-]{1,64}$/.test(track[key]))safe[key]=track[key];
      for(const key of ['isDefault','isOriginal','isDubbed','isAutoDubbed'])if(typeof track[key]==='boolean')safe[key]=track[key];
      let name=track.displayName;
      if(name&&typeof name==='object')name=name.simpleText||name.runs?.map(run=>run.text||'').join('');
      if(typeof name==='string')safe.displayName=name.slice(0,100);
      return safe;
    };
    let selected=null,available=[];
    try{selected=clean(player?.getAudioTrack?.());}catch{}
    try{available=(player?.getAvailableAudioTracks?.()||[]).slice(0,40).map(clean).filter(Boolean);}catch{}
    const type=String(selected?.audioTrackType||selected?.kind||'').toLowerCase();
    const dubbed=selected?.isDubbed??selected?.isAutoDubbed??(type==='dubbed'?true:selected?.isOriginal===true?false:null);
    return {playback_rate:video.playbackRate,default_playback_rate:video.defaultPlaybackRate,browser_language:navigator.language,
      selected_track:selected,available_tracks:available,selected_is_dubbed:dubbed};
  });
  if(prefix){
    phase='esperar-prefijo';
    const baseline=await source.evaluate(video=>({volume:video.volume,muted:video.muted}));
    const prepDeadline=Date.now()+28000;
    let prepared;
    do{
      prepared=await worker.evaluate(()=>globalThis.__ownedPrefix);
      if(prepared.ready_at||prepared.error_code)break;
      await new Promise(resolve=>setTimeout(resolve,150));
    }while(Date.now()<prepDeadline);
    const beforeActivation=await source.evaluate(video=>({selected:video.hasAttribute('data-brivany-selection'),volume:video.volume,muted:video.muted,time:video.currentTime}));
    report.prefix={duration_ms:prepared.duration_ms,resume_from_ms:prepared.resume_from_ms,position_ms:prepared.position_ms,
      preparation_metrics:prepared.preparation_metrics||{},
      pcm_sent_ms:prepared.pcm_bytes/48,elapsed_ms:prepared.ready_at&&prepared.started_at?prepared.ready_at-prepared.started_at:null,
      turns:prepared.turns||[],error_code:prepared.error_code||null,prepared_before_activation:Boolean(prepared.ready_at),
      original_unchanged:!beforeActivation.selected&&beforeActivation.volume===baseline.volume&&beforeActivation.muted===baseline.muted,
      video_seconds_before_activation:beforeActivation.time};
    if(!prepared.ready_at)throw Error('The automatic prefix did not become ready.');
    if(prefixRewind){
      await source.evaluate(video=>{video.currentTime=0;});
      await page.waitForFunction(()=>!document.querySelector('video').seeking);
      report.prefix.rewound_before_activation=true;
      report.prefix.rewind_kept_ready=await page.evaluate(()=>document.documentElement.dataset.brivanyPrefixState==='ready');
      report.prefix.preparation_requests=(await worker.evaluate(()=>globalThis.__ownedPrefix)).preparation_requests;
      if(!report.prefix.rewind_kept_ready||report.prefix.preparation_requests!==1)throw Error('Seeking discarded the prepared opening or duplicated preparation.');
    }
  }
  const initialPages=context.pages().length;
  phase='seleccionar-video';
  if(youtube){
    report.source_identity.before_activation=await sourceIdentity(source);
    assertSourceIdentity(report.source_identity.before_activation);
  }
  if(pausedStart)await source.evaluate(video=>video.pause());
  const command=id=>workspaceSocket.send(JSON.stringify({type:'select-active-video',request_id:id.repeat(32),expires_at_ms:Date.now()+5000}));
  let activatedAt;
  if(fromWorkspace){
    for(let i=0;!workspaceSocket&&i<40;i++)await new Promise(resolve=>setTimeout(resolve,50));
    if(!workspaceSocket)throw Error('The desktop control channel did not connect.');
    await page.bringToFront();
    activatedAt=await page.evaluate(()=>performance.now());
    command('a');
  }else{
    activatedAt=await page.evaluate(()=>performance.now());
    await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===url);await __ownedActivateSource(tab);},url);
  }
  await page.waitForFunction(()=>document.documentElement.hasAttribute('data-brivany-picking')||document.querySelector('video[data-brivany-selection]'),null,{timeout:4000});
  if(await page.locator('html').getAttribute('data-brivany-picking')!==null){const box=await source.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);}
  if(pausedStart){
    await page.locator('#brivany-video-marker').waitFor();
    for(const id of ['b','c','d']){command(id);await new Promise(resolve=>setTimeout(resolve,150));}
    report.waited_without_provider=starts===0&&await page.locator('#brivany-video-marker').count()===1;
    await source.evaluate(video=>video.play());
  }
  phase='iniciar-captura';
  await page.waitForFunction(()=>document.querySelector('video[data-brivany-selection]')?.volume===0,null,{timeout:7000}).catch(async error=>{
    report.source_at_failure=await source.evaluate(video=>({paused:video.paused,seeking:video.seeking,ready:video.readyState,time:video.currentTime,selected:video.hasAttribute('data-brivany-selection')}));throw error;
  });
  const begin=await page.evaluate(()=>{window.speak?.();return performance.now();});
  if(sourceReset)await source.evaluate(video=>{setTimeout(()=>{video.removeAttribute('src');video.load();},16500);});
  if(stalledTurn)for(const id of ['b','c','d']){command(id);await new Promise(resolve=>setTimeout(resolve,150));}
  const deadline=Date.now()+trialMs;
  phase='medir-reproduccion';
  let rows=[];
  while(Date.now()<deadline){
    rows=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.ownedCues||'[]'));
    const completed=rows.filter(row=>row.completed&&row.audio_peak>.01);
    if(!short&&!sourceReset){
      const liveCompleted=prefix?completed.filter(row=>isLiveCue(row,report.prefix.resume_from_ms)):[];
      if(prefix&&completed.length>=(longTrial?liveCueTarget:2)&&liveCompleted.length>=liveCueTarget&&
        liveCompleted.some(row=>row.source_end>=minimumLiveSourceEnd))break;
      if(!prefix&&!longTrial&&completed.length>=(youtube||stalledTurn?2:3)&&sourceCoverageReached(completed,minimumLiveSourceEnd))break;
    }
    if(!await source.getAttribute('data-brivany-selection'))break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  rows=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.ownedCues||'[]'));
  report.cues=rows.map(({at,signal_at,...row})=>({...row,onset_ms:Math.round(at-begin),activation_onset_ms:Math.round(at-activatedAt),
    activation_signal_ms:Number.isFinite(signal_at)?Math.round(signal_at-activatedAt):null,sync_error_ms:Math.round((row.picture-row.source)*1000)}));
  const clocks=await page.evaluate(()=>{
    const values=document.documentElement.dataset;
    return {capture:Number(values.ownedCaptureWall)||null,picture:Number(values.ownedFirstPicture)||null,
      anchor:values.ownedSourceAnchor===undefined?null:Number(values.ownedSourceAnchor)};
  });
  report.activation_to_capture_ms=clocks.capture===null?null:Math.round(clocks.capture-activatedAt);
  report.source_capture_anchor_ms=clocks.anchor;
  report.activation_to_first_picture_ms=clocks.picture===null?null:Math.round(clocks.picture-activatedAt);
  report.activation_to_first_signal_ms=report.cues.find(cue=>Number.isFinite(cue.activation_signal_ms))?.activation_signal_ms??null;
  report.browser_voice_played=rows.filter(row=>row.completed).length;
  report.production_audio_diagnostics=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.ownedProductionAudio||'null'));
  report.browser_cues_with_signal=rows.filter(row=>row.played>0&&row.audio_peak>.01).length;
  report.audio_output_detected=report.browser_cues_with_signal>0;
  report.required_source_end_ms=minimumLiveSourceEnd*1000;
  report.completed_source_end_ms=rows.filter(row=>row.completed&&row.audio_peak>.01&&Number.isFinite(row.source_end))
    .reduce((latest,row)=>Math.max(latest,row.source_end*1000),0);
  if(!local){
    report.ended_by_trial_limit=Date.now()>=deadline;
    await page.evaluate(()=>{if(window.ownedSource.hasAttribute('data-brivany-selection'))window.ownedSource.pause();});
  }
  phase='leer-diagnostico';
  const cdp=await context.newCDPSession(page);
  const {root:doc}=await cdp.send('DOM.getDocument',{depth:0});
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#brivany-video-marker'});
  let status=null;
  if(nodeId){
    const {node:marker}=await cdp.send('DOM.describeNode',{nodeId,depth:6,pierce:true});
    const findStatus=node=>node.nodeName==='SPAN'?node.children?.find(child=>child.nodeType===3)?.nodeValue:[...(node.children||[]),...(node.shadowRoots||[])].map(findStatus).find(Boolean);
    status=findStatus(marker);
  }
  report.error_message=status&&/^(El video original|El audio|El navegador|La voz|No se pudo|Se perdió|La traducción (superó|perdió|se interrumpió|terminó)|Terminó la captura|Muse interrumpió|Meta excedió)/.test(status)?status.slice(0,220):null;
  report.no_new_window=context.pages().length===initialPages;
  const protocol=await worker.evaluate(()=>__ownedProtocol);const first=protocol[0]?.at||Date.now();
  report.protocol=protocol.filter(event=>event.type!=='source-progress').map(event=>({...event,at:event.at-first}));
  report.last_processed_ms=protocol.filter(event=>event.type==='source-progress').at(-1)?.processed||0;
  const published=protocol.filter(event=>event.type==='dub-cue');
  const qualities=new Set([...published,...report.cues].map(cue=>timingQuality(cue.timing_quality)));
  report.timing_quality_counts=[...qualities].map(quality=>({quality,
    published:published.filter(cue=>timingQuality(cue.timing_quality)===quality).length,
    signaled:report.cues.filter(cue=>timingQuality(cue.timing_quality)===quality&&cue.played>0&&cue.audio_peak>.01).length,
    completed:report.cues.filter(cue=>timingQuality(cue.timing_quality)===quality&&cue.completed&&cue.audio_peak>.01).length}));
  const fallback=await page.evaluate(()=>document.documentElement.dataset.ownedFallbackMonitor==='true'?
    JSON.parse(document.documentElement.dataset.ownedFallbackIntervals||'[]'):null);
  if(fallback){
    const songs=protocol.filter(event=>event.type==='source-skipped'&&['singing','song','music'].includes(event.reason));
    const songOverlaps=fallback.flatMap(span=>songs.map(song=>({start:Math.max(span.start,song.start/1000),end:Math.min(span.end,song.end/1000)})));
    const seconds=mergedDuration(fallback), songSeconds=mergedDuration(songOverlaps);
    report.original_fallback={observed_seconds:seconds,classified_song_seconds:songSeconds,
      other_seconds:Math.max(0,seconds-songSeconds),intervals:fallback};
  }
  report.media_lag=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.ownedLag||'null'));
  report.source_audio.capture=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.ownedInputAudio||'null'));
  if(longTrial||youtube){
    report.continuity_quality=continuityQuality({cues:report.cues,published,
      fallback:report.original_fallback,lag:report.media_lag});
  }
  const observedStage=(stage,sourcePhase)=>protocol.filter(event=>event.stage===stage&&event.source_phase===sourcePhase).length;
  report.consumption={pipeline_ready_events_observed:protocol.filter(event=>event.type==='ready').length,
    muse_live_session_acks_observed:protocol.filter(event=>event.type==='live-asr-connected').length,
    muse_live_input_started:protocol.some(event=>event.type==='source-progress'&&event.processed>(report.prefix?.resume_from_ms||0))?1:0,
    prefix_mt_attempts_observed:observedStage('mt_attempt','prefix'),live_mt_attempts_observed:observedStage('mt_attempt','live'),
    prefix_tts_requests_observed:observedStage('tts_request','prefix'),live_tts_requests_observed:observedStage('tts_request','live'),
    live_prosody_stages_started:observedStage('prosody_start','live'),billing_amount:local?0:null};
  if(prefix){
    const transport=await worker.evaluate(()=>globalThis.__ownedPrefix);
    const used=protocol.find(event=>event.type==='prefix-used');
    const resumed=protocol.find(event=>event.type==='live-asr-start');
    const observed=report.cues.filter(cue=>cue.played>0&&cue.audio_peak>.01);
    const completed=observed.filter(cue=>cue.completed);
    const uniqueStarts=new Set(observed.map(cue=>Math.round(cue.source*1000)));
    const skippedSongs=protocol.filter(event=>event.type==='source-skipped'&&['singing','song','music'].includes(event.reason));
    const preparedSongs=report.prefix.turns.filter(turn=>['singing','music'].includes(turn.content));
    const songs=[...skippedSongs,...preparedSongs.map(turn=>({start:turn.start_ms,end:turn.end_ms}))];
    const resume=report.prefix.resume_from_ms;
    const liveStart=resumed?.start_ms??resumed?.start??resumed?.resume_from_ms;
    const liveCues=completed.filter(cue=>isLiveCue(cue,resume));
    const liveCompleted=liveCues.length;
    const latestLiveEnd=liveCues.reduce((latest,cue)=>Math.max(latest,cue.source_end*1000),0);
    const preparedSpeech=report.prefix.turns.some(turn=>!['singing','music'].includes(turn.content));
    Object.assign(report.prefix,{attached:transport.attached===true,activation_position_ms:transport.activation_position_ms,capture_anchor_ms:clocks.anchor,
      used_duration_ms:used?.duration_ms,live_asr_start_ms:liveStart,exact_boundary:liveStart===10000,
      replay_overlap_ms:Number.isFinite(liveStart)?10000-liveStart:null,
      repeated_cue_starts:observed.length-uniqueStarts.size,observed_prefix_cues:observed.filter(cue=>cue.source_end*1000<=resume+20).length,
      observed_live_cues:observed.filter(cue=>isLiveCue(cue,resume)).length,completed_live_cues:liveCompleted,required_live_cues:liveCueTarget,
      completed_live_source_end_ms:latestLiveEnd,required_live_source_end_ms:minimumLiveSourceEnd*1000,
      prepared_speech_played:preparedSpeech?completed.some(cue=>cue.source_end*1000<=resume+20):null,
      songs_skipped:skippedSongs.length,prepared_songs:preparedSongs.length,
      songs_without_dub:songs.length?songs.every(song=>observed.every(cue=>cue.source_end*1000<=song.start+20||cue.source*1000>=song.end-20)):null});
    report.prefix.verified=report.prefix.prepared_before_activation&&report.prefix.original_unchanged&&report.prefix.duration_ms===10000&&
      report.prefix.pcm_sent_ms===10000&&resume>0&&resume<=10000&&report.prefix.attached&&report.prefix.used_duration_ms===10000&&
      liveStart===resume&&report.prefix.repeated_cue_starts===0&&liveCompleted>=liveCueTarget&&latestLiveEnd>=minimumLiveSourceEnd*1000&&
      report.prefix.prepared_speech_played!==false&&report.prefix.songs_without_dub!==false;
  }
  report.last_buffer=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.ownedBuffer||'null'));
  report.recorder_track=await page.evaluate(()=>JSON.parse(document.documentElement.dataset.ownedRecorder||'null'));
  report.source_lifecycle=await page.evaluate(()=>({events:window.ownedSourceEvents,connected:window.ownedSource.isConnected,
    selected:window.ownedSource.hasAttribute('data-brivany-selection'),paused:window.ownedSource.paused,time:window.ownedSource.currentTime}));
  report.source_interrupted=report.source_lifecycle.events.some(event=>event.type==='emptied'&&event.selected&&!event.ended);
  report.source_interruption_reported=report.source_interrupted&&Boolean(report.error_message?.startsWith('El video original se interrumpió.'));
  if(youtube)report.source_identity.final=await sourceIdentity(source);
  report.finished_after_source=short&&await page.locator('video').evaluate(video=>video.ended)&&!await page.locator('video').getAttribute('data-brivany-selection');
  const expectedAlternation=rows.length>=3&&rows[0].category==='masculine'&&rows[1].category==='feminine'&&rows[2].category==='masculine'&&rows[0].speaker!==null&&rows[1].speaker!==null&&rows[0].speaker!==rows[1].speaker&&rows[0].speaker===rows[2].speaker;
  report.correct_speaker_sequence=youtube?null:progressiveFixture?rows.length>=5&&rows[0].speaker===1&&rows.slice(1).every(row=>row.speaker===2):expectedAlternation;
  report.public_speaker_match_verified=false;
  report.workspace_stop_clean=workspaceStop&&await source.evaluate(video=>video.volume===1&&!video.hasAttribute('data-brivany-selection'))&&!report.error_message&&!await page.locator('#brivany-video-marker').count();
  if(providerError){
    const originalTime=await source.evaluate(video=>video.currentTime);
    report.original_restored_after_error=await source.waitFor({state:'visible'}).then(()=>page.waitForFunction(at=>{
      const video=document.querySelector('video');
      return video?.volume===1&&!video.paused&&!video.hasAttribute('data-brivany-selection')&&video.currentTime>at+.2;
    },originalTime,{timeout:3000})).then(()=>true,()=>false);
  }
  report.original_replayed_to=Number(await page.locator('html').getAttribute('data-owned-original-played'));
  report.one_session=local?starts===1:null;
  report.drained_after_reset=sourceReset&&report.source_lifecycle.events.some(event=>event.type==='emptied'&&event.selected)&&!report.source_lifecycle.selected&&report.last_buffer?.media>14;
  const recovered=stalledTurn&&report.original_replayed_to>=2&&report.original_replayed_to<=6.3&&rows.length===2&&rows[0].source===6.25&&rows[1].source===12.25;
  const capped=!highResolution||(report.recorder_track?.width<=640&&report.recorder_track.height<=360&&report.recorder_track.frameRate<=24);
  const outcome=providerError?report.error_message===interruption&&report.original_restored_after_error&&!report.source_lifecycle.selected:!report.error_message&&(workspaceStop?report.workspace_stop_clean:stalledTurn?recovered:youtube||report.correct_speaker_sequence);
  report.late_cues_played=lateCues&&report.cues[0]?.onset_ms>=7800&&report.cues[0].source===.25&&report.cues[1]?.source===6.25&&report.original_replayed_to===0&&report.cues.every(cue=>cue.audio_peak>.01);
  const minimumCues=workspaceStop||providerError?1:stalledTurn?2:prefix&&longTrial?liveCueTarget:youtube?(longTrial?5:2):3;
  const progressiveObserved=!progressiveFixture||(report.timing_quality_counts.find(row=>row.quality==='asr_partial_estimate')?.completed===3&&
    report.original_fallback?.classified_song_seconds>1&&report.original_fallback.other_seconds<.1);
  report.passed=outcome&&!report.source_interrupted&&(!youtube||report.source_identity.final.verified)&&report.browser_voice_played>=minimumCues&&sourceCoverageReached(report.cues,minimumLiveSourceEnd)&&report.no_new_window&&capped&&(!short||report.finished_after_source)&&(!sourceReset||report.drained_after_reset)&&(!local||report.one_session)&&(!pausedStart||report.waited_without_provider)&&(!lateCues||report.late_cues_played)&&(!prefix||report.prefix.verified)&&(!(longTrial||youtube)||report.continuity_quality.passed)&&progressiveObserved&&report.cues.filter(row=>row.completed).every(row=>row.audio_peak>.01&&row.rate>=1&&Math.abs(row.sync_error_ms)<=(row.recovered_gap?790:250)&&row.wall<row.duration/row.rate+.4);
  if(cueSink){
    const sample=await worker.evaluate(()=>{const sample=globalThis.__ownedSample;delete globalThis.__ownedSample;return sample;});
    report.ephemeral_sample_delivered=false;
    if(sample){
      try{
        const response=await fetch(cueSink,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${cueSinkToken}`},body:JSON.stringify(sample),redirect:'error',signal:AbortSignal.timeout(2500)});
        report.ephemeral_sample_delivered=response.ok;
      }catch{}
    }
  }
  await page.goto('about:blank');
}catch(error){
 report.error=`${phase}: ${/^[a-zA-Z]{1,32}$/.test(error.name)?error.name:'Error'}`;
 if(openingErrorCodes.has(error.code)){report.error_code=error.code;report.opening_phase=error.opening_phase||'verificar-identidad';}
 if(error.code==='source_identity_mismatch')report.source_identity_error=error.code;
 if(prefix&&!report.prefix&&worker){
  let timer;
  try{
   const snapshot=await Promise.race([worker.evaluate(()=>globalThis.__ownedPrefix),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),500);})]);
   const diagnostic=prefixOpeningDiagnostic(snapshot);if(diagnostic)report.prefix=diagnostic;
  }catch{}finally{clearTimeout(timer);}
 }
}
finally{await context?.close();if(websocket){for(const client of websocket.clients)client.terminate();await new Promise(resolve=>websocket.close(resolve));}await new Promise(resolve=>server.close(resolve));}
const output=path.join(folder,'inline-sync-'+Date.now()+'.json');
await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(output);process.exitCode=report.passed?0:1;
