/* Source readiness is bounded separately from unrelated page resources. */
export const openingErrorCodes=new Set(['source_navigation_timeout','source_navigation_failed','source_player_timeout',
  'source_identity_timeout','source_identity_mismatch','source_playback_timeout']);

export async function openPublicVideo(page,url,{expectedVideoId,position=0,timeout=20000,onPhase=()=>{},now=()=>performance.now()}={}){
 if(!/^[\w-]{11}$/.test(expectedVideoId||'')||!Number.isFinite(position)||position<0||
   !Number.isInteger(timeout)||timeout<100||timeout>20000)throw Error('Invalid bounded source opening options');
 const deadline=now()+timeout;
 const remaining=()=>{const value=deadline-now();if(value<=0){const error=Error('Source opening deadline');error.name='TimeoutError';throw error;}return value;};
 let phase;
 const step=async(name,code,operation)=>{
  phase=name;onPhase(name);
  let timer;
  try{
   const budget=remaining();
   const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error('Source opening deadline');error.name='TimeoutError';reject(error);},budget);});
   return await Promise.race([operation(),expired]);
  }catch(error){
   const safe=Error('The selected video did not complete its opening checks.');
   safe.name=error?.name==='TimeoutError'?'TimeoutError':'Error';
   safe.code=name==='navegar-video'&&safe.name!=='TimeoutError'?'source_navigation_failed':code;
   safe.opening_phase=phase;throw safe;
  }finally{clearTimeout(timer);}
 };
 await step('navegar-video','source_navigation_timeout',()=>page.goto(url,{waitUntil:'commit',timeout:remaining()}));
 const source=page.locator('#movie_player video.html5-main-video').first();
 await step('esperar-reproductor','source_player_timeout',()=>source.waitFor({timeout:remaining()}));
 await step('verificar-identidad','source_identity_timeout',()=>page.waitForFunction(expected=>{
  const video=document.querySelector('#movie_player video.html5-main-video'),player=document.querySelector('#movie_player');
  const details=player?.getPlayerResponse?.()?.videoDetails,initial=window.ytInitialPlayerResponse?.videoDetails;
  const durations=[video?.duration,player?.getDuration?.(),details?.lengthSeconds,initial?.lengthSeconds].map(Number);
  return video?.readyState>=2&&!player.classList.contains('ad-showing')&&!player.classList.contains('ad-interrupting')&&
   new URL(location.href).searchParams.get('v')===expected&&player.getVideoData?.()?.video_id===expected&&
   details?.videoId===expected&&initial?.videoId===expected&&durations.every(value=>Number.isFinite(value)&&value>0&&Math.abs(value-durations[0])<=2);
 },expectedVideoId,{timeout:remaining()}));
 await step('verificar-reproduccion','source_playback_timeout',async()=>{
  if(await source.evaluate(video=>video.paused))await source.evaluate(video=>{video.play().catch(()=>{});});
  await page.waitForFunction(at=>{
   const video=document.querySelector('#movie_player video.html5-main-video');
   return video?.paused===false&&!video.seeking&&video.readyState>=3&&video.playbackRate===1&&video.currentTime>=at+.15;
  },position,{timeout:remaining()});
 });
 return source;
}

export function prefixOpeningDiagnostic(value){
 if(!value||typeof value!=='object')return null;
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const bounded=(value,max=60000)=>finite(value)&&value>=0&&value<=max;
 const result={diagnostic_partial:true,prepared_before_activation:bounded(value.ready_at,Number.MAX_SAFE_INTEGER)&&value.ready_at>0};
 for(const name of ['duration_ms','resume_from_ms','position_ms'])if(bounded(value[name],10000))result[name]=value[name];
 if(bounded(value.pcm_bytes,125*3840))result.pcm_sent_ms=value.pcm_bytes/48;
 if(finite(value.ready_at)&&finite(value.started_at)&&bounded(value.ready_at-value.started_at))result.elapsed_ms=value.ready_at-value.started_at;
 result.error_code=typeof value.error_code==='string'&&/^prefix_[a-z0-9_]{1,40}$/.test(value.error_code)?value.error_code:null;
 result.preparation_metrics=Object.fromEntries(['content_gate_ms','asr_ms','turn_classification_ms','prosody_ms','local_timbre_ms','postprocess_ms','total_ms','capture_receive_ms']
  .filter(name=>bounded(value.preparation_metrics?.[name])).map(name=>[name,value.preparation_metrics[name]]));
 result.turns=(Array.isArray(value.turns)?value.turns:[]).slice(0,16)
  .filter(row=>row&&bounded(row.start_ms,10000)&&bounded(row.end_ms,10000)&&row.end_ms>row.start_ms&&['speech','unknown','music','singing'].includes(row.content))
  .map(({start_ms,end_ms,content})=>({start_ms,end_ms,content}));
 return result;
}
