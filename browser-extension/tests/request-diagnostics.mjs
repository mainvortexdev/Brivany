/* Numeric per-report correlation; never retain text or export provider IDs. */
export function makeRequestDiagnostics(){
 const segments=new Map();
 return value=>{
  const safe={};
  const identifier=value?.segment_id;
  if(typeof identifier==='string'&&/^[A-Za-z0-9_:.-]{1,200}$/.test(identifier)){
   if(!segments.has(identifier)&&segments.size<128)segments.set(identifier,segments.size+1);
   if(segments.has(identifier))safe.segment_index=segments.get(identifier);
  }
  if(['start','end','request','headers','sse','sse_tail'].includes(value?.phase))safe.phase=value.phase;
  if(typeof value?.partial==='boolean')safe.partial=value.partial;
  if(value?.stage==='cue_ready'&&typeof value.published_ahead==='boolean')safe.published_ahead=value.published_ahead;
  if(value?.type==='error'&&Number.isInteger(value.provider_status)&&value.provider_status>=100&&value.provider_status<=599)safe.provider_status=value.provider_status;
  if(value?.stage==='cue_ready'){
   for(const key of ['leading_padding_ms','trailing_padding_ms']){
    const number=value[key];
    if(typeof number==='number'&&Number.isFinite(number)&&number>=0&&number<=170)safe[key]=number;
   }
  }
  for(const key of ['request_ms','request_to_first_ms','request_to_last_chunk_ms','last_chunk_to_done_ms']){
   const number=value?.[key];
   if(typeof number==='number'&&Number.isFinite(number)&&number>=0&&number<=180000)safe[key]=number;
  }
  for(const key of ['attempts','recoveries','total_attempts','total_recoveries']){
   const number=value?.[key];
   if(Number.isInteger(number)&&number>=0&&number<=512)safe[key]=number;
  }
  return safe;
 };
}
