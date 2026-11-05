/* Pure numeric synchronization policy. No browser, network or audio samples. */
export const MIN_DELAY=4,MAX_BUFFER=30;
export function translationMode(value){if(!['synchronized','preproduction'].includes(value))throw Error('Invalid translation mode');return {mode:value,delay:value==='preproduction'?5:4,autoplay:value!=='preproduction'};}
export function pairAddress(value){
  let url;try{url=new URL(String(value).trim());}catch{throw Error('Pega el enlace de vinculación de Brivany.');}
  if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.pathname!=='/pair'||url.username||url.password||url.search||!/^#[0-9]{6}$/.test(url.hash))throw Error('El enlace debe pertenecer a Brivany en este equipo.');
  const code=url.hash.slice(1);url.hash='';return {url:url.href,code};
}
export function syncAddress(value,pair){
  const url=new URL(value),source=new URL(pair);
  if(url.origin!==source.origin||url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.pathname!=='/sync'||url.username||url.password||url.search||url.hash)throw Error('El servicio devolvió una conexión no válida.');
  return url.href;
}
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export class SyncTimeline{
  constructor({delay=MIN_DELAY,maxBuffer=MAX_BUFFER,epoch=1}={}){
    if(!finite(delay)||delay<4||!finite(maxBuffer)||maxBuffer<delay||maxBuffer>30||!Number.isInteger(epoch))throw Error('Invalid synchronization policy');
    this.delay=delay;this.maxBuffer=maxBuffer;this.epoch=epoch;this.processed=0;this.turns=new Map();this.abandoned=new Set();this.holds=0;this.lastReason=null;this.maxObservedDelay=0;this.playbackStarted=false;
  }
  event(event){
    if(event?.epoch!==this.epoch)return false;
    if(event.type==='source-skipped'){
      if(typeof event.cue_id!=='string'||!finite(event.source_start_ms)||!finite(event.source_end_ms)||event.source_end_ms<event.source_start_ms)throw Error('Invalid skipped interval');
      if(!this.turns.has(event.cue_id)&&!this.event({...event,type:'source-turn'}))return false;
      const turn=this.turns.get(event.cue_id);turn.end=event.source_end_ms/1000;turn.ready=true;turn.started=true;turn.finished=true;turn.skipped=true;return true;
    }
    if(event.type==='source-progress'){
      if(!finite(event.processed_ms))throw Error('Invalid source progress');
      this.processed=Math.max(this.processed,event.processed_ms/1000);return true;
    }
    if(event.type!=='source-turn')return false;
    if(typeof event.cue_id!=='string'||!event.cue_id||event.cue_id.length>200||!finite(event.source_start_ms))throw Error('Invalid source turn');
    const start=event.source_start_ms/1000,end=finite(event.source_end_ms)?event.source_end_ms/1000:null;
    if(end!==null&&end<start)throw Error('Invalid source interval');
    let turn=this.turns.get(event.cue_id);
    if(!turn&&this.abandoned.has(event.cue_id))return false;
    if(turn&&Math.abs(turn.start-start)>.1)throw Error('Source interval changed');
    if(!turn){
      if(this.turns.size>=128)throw Error('Demasiados intervalos de habla pendientes.');
      for(const previous of this.turns.values())if(previous.skipped&&previous.end===null&&previous.start<start)previous.end=start;
      turn={id:event.cue_id,start,end:null,ready:false,started:false,finished:false};this.turns.set(turn.id,turn);
    }
    if(end!==null)turn.end=turn.skipped&&turn.end!==null?Math.min(turn.end,end):end;
    return true;
  }
  cue(event,duration){
    if(event?.epoch!==this.epoch||this.abandoned.has(event.cue_id))return false;
    if(!finite(duration)||duration<=0||duration>30)throw Error('Invalid cue duration');
    if(!this.turns.has(event.cue_id))this.event({...event,type:'source-turn'});
    const turn=this.turns.get(event.cue_id);if(turn.ready)throw Error('Duplicate translated utterance');
    if(finite(event.source_end_ms))turn.end=event.source_end_ms/1000;
    turn.ready=true;turn.duration=duration;turn.speaker=typeof event.speaker_label==='string'?event.speaker_label.slice(0,80):null;return true;
  }
  decide({capture,media,available,paused=false,activeCue=null,tail=false,recorderGap=null,smooth=false}){
    if(![capture,media,available].every(finite))throw Error('Invalid media clock');
    const lag=Math.max(0,capture-media);this.maxObservedDelay=Math.max(this.maxObservedDelay,lag);
    if(lag>this.maxBuffer+.75)throw Error('La traducción superó el búfer de treinta segundos. Sesión detenida.');
    let reason=null;
    // In the inline player, wait for a small reserve after a real stall.
    // Restarting on a single 80 ms PCM block produces repeated short pauses.
    const mediaMargin=smooth&&this.lastReason==='buffering'?.30:.12;
    const delayMargin=smooth&&(!this.playbackStarted||this.lastReason==='lookahead')?.25:0;
    const speechMargin=smooth&&this.lastReason==='recognition'?.20:.05;
    if(paused)reason='paused';
    // A small initial jitter reserve prevents pausing every time the 80 ms
    // capture counter waits for its next packet. Four/five seconds stay minima.
    else if(!tail&&(capture<this.delay+(this.playbackStarted?0:.2)||available<media+mediaMargin))reason='buffering';
    else if(!tail&&lag<=this.delay+delayMargin+(smooth?0:.025))reason='lookahead';
    else if(!tail&&media>=this.processed-speechMargin)reason='recognition';
    const turns=[...this.turns.values()].sort((a,b)=>a.start-b.start);
    let startCue=null;
    for(const [index,turn] of turns.entries()){
      if(turn.finished)continue;
      if(!turn.ready&&media>=Math.max(0,turn.start-.055)){reason='translation';break;}
      if(turn.started&&activeCue===turn.id&&turn.end!==null){
        const nextStart=turns[index+1]?.start??Infinity;
        // A dub may use a short stretch of confirmed silence after its turn.
        // Keep the ASR and next-turn guards ahead of the playback clock.
        const tailEnd=smooth?Math.max(turn.end,Math.min(turn.end+.4,this.processed-.075,nextStart-.055)):turn.end;
        if(media>=tailEnd-.025){reason='voice-tail';break;}
      }
      if(turn.ready&&!turn.started&&media>=Math.max(0,turn.start-.025)){
        const recovered=recorderGap&&turn.start>=recorderGap.start&&media<=recorderGap.end+.04;
        if(media>turn.start+.25&&!recovered)throw Error('La voz llegó después de su imagen. Se detuvo para evitar desincronización.');
        if(!reason)startCue=turn.id;break;
      }
    }
    if(reason&&reason!==this.lastReason)this.holds++;
    if(!reason)this.playbackStarted=true;
    this.lastReason=reason;return {play:!reason,reason,startCue,lag};
  }
  started(id){const turn=this.turns.get(id);if(turn)turn.started=true;}
  finished(id){const turn=this.turns.get(id);if(turn)turn.finished=true;}
  releaseLateTurns(capture,media,{tail=false,maxAge=12,finalGrace=4,finalMaxAge=Infinity}={}){
    for(const turn of this.turns.values()){
      if(turn.ready||turn.start>media+.3)continue;
      // In the live tab, preserve the source when an open turn or its
      // translation has kept the viewer waiting. Never replay a late dub.
      const wait=turn.end===null?maxAge:Math.min(finalMaxAge,Math.max(maxAge,turn.end-turn.start+finalGrace));
      if(!tail&&capture-turn.start<wait)continue;
      turn.ready=true;turn.finished=true;turn.skipped=true;
      for(const next of this.turns.values())if(next.start>turn.start&&(turn.end===null||next.start<turn.end))turn.end=next.start;
      this.abandoned.add(turn.id);
      if(this.abandoned.size>128)this.abandoned.delete(this.abandoned.values().next().value);
    }
  }
  originalAt(media){
    const turns=[...this.turns.values()].sort((a,b)=>b.start-a.start);
    const current=turns.find(turn=>turn.start<=media+.025);
    return Boolean(current?.skipped&&(current.end===null||media<current.end));
  }
  prune(before){for(const [id,turn]of this.turns)if(turn.finished&&(turn.end??(turn.skipped?Infinity:turn.start))<before)this.turns.delete(id);}
  prepared(until){return finite(until)&&this.processed>=until&&[...this.turns.values()].filter(turn=>turn.start<until).every(turn=>turn.ready);}
  stats(){return {epoch:this.epoch,delay_seconds:this.delay,max_buffer_seconds:this.maxBuffer,processed_seconds:this.processed,turns:this.turns.size,hold_transitions:this.holds,max_observed_delay_seconds:this.maxObservedDelay};}
  firstReady(until){
    if(!finite(until)||this.processed<until)return false;
    const first=[...this.turns.values()].filter(turn=>turn.start<until).sort((a,b)=>a.start-b.start)[0];
    return !first||first.ready;
  }
  preparation({capture,available,budget=6,smooth=false}){
    if(![capture,available,budget].every(finite)||budget<this.delay)throw Error('Invalid preparation clocks');
    const first=smooth&&[...this.turns.values()].find(turn=>turn.start<this.delay);
    const firstPlayable=first?.ready&&this.processed>=first.start+.05;
    const ready=capture>=this.delay&&available>=this.delay&&Boolean(firstPlayable||this.firstReady(this.delay));
    return {ready,budget_exceeded:!ready&&capture>=budget,needs_more_time:!ready&&capture>=budget};
  }
}
