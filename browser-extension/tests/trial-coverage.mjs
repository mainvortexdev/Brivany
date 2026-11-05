/* A trial must complete the requested source span, not merely start voices. */
export function sourceCoverageReached(cues,minimumSeconds){
  if(!Number.isFinite(minimumSeconds)||minimumSeconds<0)throw Error('Invalid minimum source coverage.');
  return minimumSeconds===0||cues.some(cue=>cue.completed===true&&Number.isFinite(cue.audio_peak)&&cue.audio_peak>.01&&
    Number.isFinite(cue.source_end)&&cue.source_end>=minimumSeconds);
}
