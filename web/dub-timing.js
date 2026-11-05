/* PCM energy landmarks are timing estimates, not speech recognition or physical loopback. */
(function(root) {
  'use strict';
  class PcmEnergyClock {
    constructor({windowMs=20,rmsThreshold=.005}={}) {
      if(!Number.isFinite(windowMs) || windowMs<=0 || windowMs>1000) throw new TypeError('Invalid RMS window.');
      if(!Number.isFinite(rmsThreshold) || rmsThreshold<0 || rmsThreshold>1) throw new TypeError('Invalid RMS threshold.');
      this.windowMs=windowMs; this.rmsThreshold=rmsThreshold;
      this.firstEnergyContext=null; this.lastEnergyContext=null;
      this.recordStartContext=null; this.recordEndContext=null; this.frames=0;
      this._rate=null; this._next=null; this._count=0; this._sum=0; this._windowStart=null;
    }
    _completeWindow() {
      if(this._count && Math.sqrt(this._sum/this._count)>this.rmsThreshold) {
        if(this.firstEnergyContext===null) this.firstEnergyContext=this._windowStart;
        this.lastEnergyContext=this._windowStart+this._count/this._rate;
      }
      this._count=0; this._sum=0; this._windowStart=null;
    }
    observe(samples,rate,contextStart) {
      if(!(samples instanceof Float32Array)) throw new TypeError('Expected normalized Float32 PCM.');
      if(!Number.isFinite(rate) || rate<=0 || rate>384000) throw new TypeError('Invalid sample rate.');
      if(!Number.isFinite(contextStart) || contextStart<0) throw new TypeError('Invalid audio context time.');
      // Validate the complete packet before changing any state.
      for(const sample of samples) if(!Number.isFinite(sample) || sample < -1 || sample > 1) throw new TypeError('PCM samples must be finite and normalized.');
      if(!samples.length) return this;
      const continuous=this._rate===rate && this._next!==null && Math.abs(contextStart-this._next)<=1/rate+1e-9;
      if(!continuous) { this._count=0; this._sum=0; this._windowStart=null; }
      const start=continuous?this._next:contextStart;
      this._rate=rate;
      if(this.recordStartContext===null) this.recordStartContext=contextStart;
      const windowFrames=Math.max(1,Math.round(rate*this.windowMs/1000));
      for(let index=0;index<samples.length;index++) {
        if(this._count===0) this._windowStart=start+index/rate;
        this._sum+=samples[index]*samples[index]; this._count++;
        if(this._count===windowFrames) this._completeWindow();
      }
      this.frames+=samples.length; this._next=start+samples.length/rate;
      this.recordEndContext=this._next;
      return this;
    }
    finish() { this._completeWindow(); return this; }
    snapshot() {
      return {
        first_energy_context:this.firstEnergyContext,
        last_energy_context:this.lastEnergyContext,
        record_start_context:this.recordStartContext,
        record_end_context:this.recordEndContext,
        frames:this.frames,
        window_ms:this.windowMs,
        rms_threshold:this.rmsThreshold
      };
    }
  }
  function summarize(source,translated) {
    const valid=value=>typeof value==='number' && Number.isFinite(value) && value>=0;
    const difference=(end,start)=>valid(end)&&valid(start)?(end-start)*1000:null;
    return {
      onset_to_onset_ms:difference(translated?.first_energy_context,source?.first_energy_context),
      first_translation_after_last_source_energy_ms:difference(translated?.first_energy_context,source?.last_energy_context),
      tail_to_tail_ms:difference(translated?.last_energy_context,source?.last_energy_context),
      first_translation_after_source_file_end_ms:difference(translated?.first_energy_context,source?.record_end_context)
    };
  }
  class SegmentLatencyTracker {
    constructor({maxSegments=100}={}) {
      if(!Number.isInteger(maxSegments) || maxSegments<1 || maxSegments>1000) throw new TypeError('Invalid segment limit.');
      this.maxSegments=maxSegments;this.segments=new Map();this.origin=null;this.inputEnd=null;
      this.inputSeconds=0;this.continuous=true;this.limited=false;this.unattributedChunks=0;
    }
    observeInput(frames,rate,contextStart) {
      if(!Number.isInteger(frames) || frames<1 || !Number.isFinite(rate) || rate<=0 || !Number.isFinite(contextStart) || contextStart<0) throw new TypeError('Invalid input clock.');
      if(this.origin===null) this.origin=contextStart;
      if(this.inputEnd!==null && Math.abs(contextStart-this.inputEnd)>1/rate+1e-9) this.continuous=false;
      this.inputSeconds+=frames/rate;this.inputEnd=contextStart+frames/rate;
    }
    _segment(event) {
      const id=event?.segment_id;
      if(typeof id!=='string' || !id.length || id.length>8192 || /[\u0000-\u001f]/.test(id)) return null;
      let item=this.segments.get(id);
      if(!item) {
        if(this.segments.size>=this.maxSegments){this.limited=true;return null;}
        item={index:this.segments.size+1,clock:new PcmEnergyClock(),range:null,revision:null,provisional:true,transcriptSeen:false,audioFinal:null,audioInvalid:false,turnId:null,identityConflict:false};
        this.segments.set(id,item);
      }
      if(typeof event.turn_id==='string' && event.turn_id.length && event.turn_id.length<=8192) {
        if(item.turnId!==null && item.turnId!==event.turn_id)item.identityConflict=true;
        else item.turnId=event.turn_id;
      }
      return item;
    }
    observeTranscript(event) {
      if(event?.source!=='translation') return;
      const item=this._segment(event);if(!item)return;
      const revision=Number.isInteger(event.revision)?event.revision:null;
      if(revision!==null && item.revision!==null && revision<item.revision)return;
      if(item.provisional===false && event.provisional===true)return;
      if(revision!==null)item.revision=revision;
      item.transcriptSeen=true;item.provisional=event.provisional===true || event.final===false;
      const start=event.source_start_seconds,end=event.source_end_seconds;
      item.range=Number.isFinite(start) && Number.isFinite(end) && start>=0 && end>start && end<=90?{start,end}:null;
    }
    observeAudio(event,samples,rate,contextStart) {
      const item=this._segment(event);
      if(!item){this.unattributedChunks++;return;}
      if(item.audioFinal===true){item.audioInvalid=true;return;}
      item.clock.observe(samples,rate,contextStart);
      if(typeof event.audio_segment_final==='boolean')item.audioFinal=event.audio_segment_final;
      if(item.audioFinal===true)item.clock.finish();
    }
    finish(){for(const item of this.segments.values())item.clock.finish();}
    snapshot() {
      const segments=[],uncorrelated=[];let identifiedAudio=0,missingRange=0,silentAudio=0,pendingAudio=0;
      for(const item of this.segments.values()) {
        const energy=item.clock.snapshot();if(!energy.frames){if(item.transcriptSeen)pendingAudio++;continue;}identifiedAudio++;
        const reason=item.identityConflict?'conflicting_turn_identity':!this.continuous?'input_clock_discontinuity':this.origin===null?'missing_input_origin':item.provisional?'provisional_source_range':
          !item.range?'missing_source_range':item.range.end>this.inputSeconds+1e-6?'source_range_exceeds_received_input':item.audioInvalid?'audio_after_declared_final':
          energy.first_energy_context!==null && energy.first_energy_context<this.origin+item.range.start-.020000001?'translation_precedes_source_interval':null;
        if(reason){
          missingRange++;uncorrelated.push({index:item.index,reason,source_start_seconds:item.range?.start ?? null,
            source_end_seconds:item.range?.end ?? null,translated_first_energy_context:energy.first_energy_context});continue;
        }
        if(energy.first_energy_context===null){silentAudio++;continue;}
        // The provider's input offsets are independent of browser wall time.
        // Never borrow a whole-turn interval for a part without its own marks.
        const start=this.origin+item.range.start,end=this.origin+item.range.end;
        segments.push({index:item.index,source_start_seconds:item.range.start,source_end_seconds:item.range.end,
          translated_first_energy_context:energy.first_energy_context,
          onset_delay_ms:(energy.first_energy_context-start)*1000,
          response_after_source_end_ms:(energy.first_energy_context-end)*1000,
          tail_delay_ms:item.audioFinal!==true || energy.last_energy_context===null?null:(energy.last_energy_context-end)*1000,
          audio_segment_final:item.audioFinal});
      }
      return {measurement:'provider_input_segment_offsets_and_scheduled_pcm_energy',
        audible_delay_verified:false,physical_playback_measured:false,
        correlated_segment_count:segments.length,identified_audio_segments:identifiedAudio,
        uncorrelated_audio_segments:missingRange,silent_audio_segments:silentAudio,pending_audio_segments:pendingAudio,unattributed_audio_chunks:this.unattributedChunks,
        tracking_limited:this.limited,input_clock_continuous:this.continuous,
        max_observed_onset_delay_ms:segments.length?Math.max(...segments.map(item=>item.onset_delay_ms)):null,
        segments,uncorrelated};
    }
  }
  const api={PcmEnergyClock,summarize,SegmentLatencyTracker};
  root.BrivanyDubTiming=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(globalThis);
