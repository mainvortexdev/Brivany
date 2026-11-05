/* Shared, numeric-only acceptance for the opt-in diagnostic harness. */
const timingQuality=value=>typeof value==='string'&&/^[a-z_]{1,40}$/.test(value)?value:'unreported';

export function continuityQuality({cues,published,fallback,lag}){
 const completed=cues.filter(cue=>cue.completed&&cue.audio_peak>.01&&Number.isFinite(cue.source_end));
 const verifiedEnd=completed.reduce((latest,cue)=>Math.max(latest,cue.source_end),0);
 const inVerifiedSpan=published.filter(cue=>cue.end/1000<=verifiedEnd+.02);
 const missing=inVerifiedSpan.filter(cue=>!completed.some(played=>
  Math.abs(played.source-cue.start/1000)<.02&&Math.abs(played.source_end-cue.end/1000)<.02));
 const fallbackKnown=Number.isFinite(fallback?.other_seconds);
 const nonSongSeconds=fallbackKnown?fallback.other_seconds:null;
 const lagKnown=Number.isFinite(lag?.maximum_seconds)&&Number.isFinite(lag?.maximum_growth_seconds);
 return {maximum_nonsong_fallback_seconds:1,
  maximum_allowed_lag_seconds:8,maximum_observed_lag_seconds:lagKnown?lag.maximum_seconds:null,
  maximum_allowed_lag_growth_seconds:3,maximum_observed_lag_growth_seconds:lagKnown?lag.maximum_growth_seconds:null,
  observed_nonsong_fallback_seconds:nonSongSeconds,verified_source_end_ms:verifiedEnd*1000,
  unplayed_published_cues:missing.length,
  missing_intervals:missing.map(cue=>({start_ms:cue.start,end_ms:cue.end,timing_quality:timingQuality(cue.timing_quality)})),
  passed:completed.length>0&&verifiedEnd>0&&fallbackKnown&&nonSongSeconds<=1&&missing.length===0&&lagKnown&&lag.maximum_seconds<=8&&lag.maximum_growth_seconds<=3};
}
