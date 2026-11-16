// Conservative demo reservations, in integer microdollars, not provider invoices.
// Never raise these limits from a desktop request or a provider response.
export const MAX_BUDGET=5_000_000;
export const MAX_AUDIO_SECONDS=120;
export const VOICES=new Set(['3597a26f-80ef-4bd5-8101-9699bc764917','db6b0ed5-d5d3-463d-ae85-518a07d3c2b4','3c1c7da2-8f3f-4966-a76d-1f5e484865b5','b4b8e2af-6139-466e-a93a-30c20d2e1fc5','47c38ca4-5f35-497b-b1a3-415245fb35e1','6776173b-fd72-460d-89b3-d85812ee518d','6ccbfb76-1fc6-48f7-b71d-91ac6298247b']);
export const MODEL='muse-spark-1.3';
export const TTS_MODEL='sonic-3.6-2026-08-27';
export function textCost(text){
 if(typeof text!=='string'||[...text].length>6000)throw Error('speech_limit');
 return Math.max(1,[...text].length)*100;
}
export function metaPlan(path,body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_request');
 const copy=structuredClone(body),encoded=JSON.stringify(copy);
 if(new TextEncoder().encode(encoded).length>2_000_000)throw Error('request_limit');
 if(!['/v1/chat/completions','/v1/responses','/v1/images/generations','/v1/images/edits'].includes(path))throw Error('provider_path');
 const image=path.startsWith('/v1/images/')||copy.model==='muse-image-1.0';
 if(copy.n!==undefined&&copy.n!==1)throw Error('image_count');
 if(image){copy.model='muse-image-1.0';if(path.startsWith('/v1/images/'))copy.n=1;return {body:copy,cost:100_000,kind:'image'};}
 if(copy.model!==undefined&&!/^muse-spark-1\.[23]$/.test(copy.model))throw Error('model_unavailable');
 copy.model=MODEL;
 const field=path==='/v1/responses'?'max_output_tokens':('max_tokens' in copy?'max_tokens':'max_completion_tokens');
 const limit=copy[field]??2048;
 if(!Number.isInteger(limit)||limit<1||limit>32768)throw Error('output_limit');
 for(const name of ['max_tokens','max_completion_tokens','max_output_tokens']){
  if(copy[name]!==undefined&&(!Number.isInteger(copy[name])||copy[name]<1||copy[name]>32768))throw Error('output_limit');
  delete copy[name];
 }
 copy[field]=limit;
 if(copy.tools){if(!Array.isArray(copy.tools)||copy.tools.length>12)throw Error('tool_limit');if(copy.tools.some(t=>!t||!['function','web_search','web_search_preview'].includes(t.type)))throw Error('tool_unavailable');if(copy.tools.some(t=>t.type!=='function'))copy.max_tool_calls=1;}
 const visual=/"(?:image_url|input_image|video_url|input_video|input_audio|audio_url|input_file|file_id|file_data)"/.test(encoded)||!!copy.previous_response_id||!!copy.conversation;
 if(!visual&&new TextEncoder().encode(encoded).length>80_000)throw Error('context_limit');
 // Input UTF-8 bytes upper-bound tokens for text; reserve above normal rates.
 const cost=visual?1_500_000:Math.max(50_000,Math.ceil(new TextEncoder().encode(encoded).length*2+copy[field]*10+16_384));
 return {body:copy,cost,kind:visual?'vision':'chat'};
}
export function voiceFrame(value,voices=VOICES){
 if(!value||typeof value!=='object'||typeof value.transcript!=='string')throw Error('speech_frame');
 const voice=typeof value.voice==='string'?value.voice:value.voice?.id;
 if(!voices.has(voice))throw Error('voice_unavailable');
 return {body:{...value,voice:{mode:'id',id:voice},model_id:TTS_MODEL},cost:textCost(value.transcript)};
}
export function asrPlan(provider,path,query){
 if(provider==='meta'&&path==='/v1/asr/realtime'){if(query.size)throw Error('audio_option');return {cost:200_000,seconds:MAX_AUDIO_SECONDS};}
 if(provider==='cartesia'&&path==='/stt/turns/websocket'){
  if(query.get('model')!=='ink-2')throw Error('model_unavailable');
  if(query.get('encoding')!=='pcm_s16le'||query.get('sample_rate')!=='24000')throw Error('audio_format');
  for(const name of query.keys())if(!['model','encoding','sample_rate','cartesia_version'].includes(name)||query.getAll(name).length!==1)throw Error('audio_option');
  return {cost:100_000,seconds:MAX_AUDIO_SECONDS};
 }
 if(provider==='deepgram'&&['/v1/listen','/v2/listen'].includes(path)){
  const model=query.get('model');if(!['nova-3','flux-general-en','flux-general-multi'].includes(model))throw Error('model_unavailable');
  if(query.get('channels')&&!['1'].includes(query.get('channels')))throw Error('audio_format');
  if(query.get('encoding')!=='linear16'||Number(query.get('sample_rate'))!==24000)throw Error('audio_format');
  const allowed=new Set(['model','language','encoding','sample_rate','channels','interim_results','punctuate','endpointing','utterance_end_ms','vad_events','eot_threshold','eager_eot_threshold','eot_timeout_ms']);
  for(const name of query.keys())if(!allowed.has(name))throw Error('audio_option');
  return {cost:100_000,seconds:MAX_AUDIO_SECONDS};
 }
 throw Error('provider_path');
}
