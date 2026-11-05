/* Desktop-only adapter; the original modules keep their own services and consent. */
(() => {
  if(location.pathname==='/spaces'&&new URLSearchParams(location.search).get('embedded')==='melodi'){
    document.documentElement.dataset.melodiEmbedded='true';
    document.addEventListener('DOMContentLoaded',()=>{
      const inspector=document.querySelector('.inspector'),objects=document.querySelector('.objects-section');
      if(inspector&&objects){const details=document.createElement('details');details.className='computer-embedded-objects';const summary=document.createElement('summary');summary.textContent='Piezas del modelo';details.append(summary,objects);inspector.prepend(details);}
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    if(location.pathname==='/spaces'&&new URLSearchParams(location.search).get('representation')==='plan'){
      const button=document.querySelector('#view-plan');
      if(button){const activate=()=>{if(!button.disabled){observer.disconnect();button.click();}};const observer=new MutationObserver(activate);observer.observe(button,{attributes:true,attributeFilter:['disabled']});activate();window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});}
    }
    // Reuse the live output and its microphone suspension/barge-in, never a second voice.
    if(location.pathname==='/app'&&!document.body.classList.contains('chat-clean')&&window.BrivanyVoice){
      let voice=null,microphone=null,lastSpeech=performance.now(),pending=[];
      const proto=window.BrivanyVoice.VoiceOutput.prototype,speak=proto.speak;
      proto.speak=function(...args){voice=this;return speak.apply(this,args);};
      const mic=window.BrivanyVoice.Microphone.prototype,start=mic.start;
      mic.start=function(...args){microphone=this;if(!this.agentLevelAdapted){const level=this.onLevel;this.onLevel=value=>{if(value?.active||value?.rms>.025)lastSpeech=performance.now();level?.(value);};this.agentLevelAdapted=true;}return start.apply(this,args);};
      const timer=setInterval(()=>{
        if(!pending.length||!voice||voice.speaking||!microphone?.active||performance.now()-lastSpeech<2200||document.hidden)return;
        if(document.querySelector('#voice-state')?.textContent==='PREPARANDO'||document.querySelector('#interim')?.textContent.trim()||document.querySelector('[data-mode="meeting"]')?.classList.contains('active'))return;
        const text=pending.splice(0).join(' ');voice.speak([{text,pauseAfter:0}],{voiceURI:document.querySelector('#voice-select')?.value,language:document.querySelector('#listen-language')?.value.startsWith('en')?'en':'es',rate:1.05});
      },750);
      window.BrivanyLiveNotice={queue:message=>{pending.push(message);pending=pending.slice(-3);}};
      window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
    }
    const output = window.BrivanyLive?.MelodiOutput?.prototype;
    if (output && !output.desktopSpeechAdapted) {
      const speak = output.speak;
      output.speak = function (segments, options) {
        const onState = this.onState;
        // An empty response means the user is still thinking. It must never
        // mute the microphone or start the post-playback suppression window.
        const delayed = (async function* () {
          let started = false;
          for await (const segment of segments) {
            if (!started) { started = true; onState(true); }
            yield segment;
          }
        })();
        this.onState = value => { if (!value) onState(false); };
        try { return speak.call(this, delayed, options); }
        finally { this.onState = onState; }
      };
      output.desktopSpeechAdapted = true;
    }
    // A user ending a turn can do so during the 400 ms echo suppression
    // window. Flush the final Muse transcript after cancelling that timer.
    const microphone = window.BrivanyVoice?.Microphone?.prototype;
    if (microphone && !microphone.desktopFinishAdapted) {
      const start = microphone.start;
      microphone.start = function (options = {}) {
        // Microphone.start enables this only when the actual track confirms AEC.
        return start.call(this, {...options, live: {...options.live, bargeIn: true}});
      };
      const finish = microphone.finish;
      const suspend = microphone.suspend;
      microphone.suspend = function (value) {
        suspend.call(this, value);
        if (!value && this.active && this.stream?.getAudioTracks()[0]?.getSettings?.().echoCancellation === true) {
          clearTimeout(this.resumeTimer);
          this.suspended = false;
          this.live?.suspend(false);
        }
      };
      microphone.finish = async function (...args) {
        clearTimeout(this.resumeTimer);
        this.suspended = false;
        this.live?.suspend(false);
        return finish.apply(this, args);
      };
      microphone.desktopFinishAdapted = true;
    }
  });
  if (window.parent === window) return;
  const methods = ['status','pick_project_folder','save_current_project','save_open_project',
    'export_open_project','get_floorplan','save_floorplan','get_presentation','save_presentation'];
  function connectNative() {
    if (location.pathname !== '/spaces' && location.pathname !== '/viewer') return;
    const api = window.top.location.origin===location.origin?window.top.pywebview?.api:null;
    if (!api || !methods.every(name => typeof api[name] === 'function')) return;
    window.pywebview = {api: Object.fromEntries(methods.map(name => [name, (...args) => api[name](...args)]))};
    window.dispatchEvent(new Event('pywebviewready'));
  }
  window.parent.addEventListener('pywebviewready', connectNative);
  document.addEventListener('DOMContentLoaded', () => {
    connectNative();
    document.addEventListener('click', event => {
      if(event.defaultPrevented)return;
      const anchor = event.target.closest('a[href]');
      if (!anchor || anchor.download || anchor.target === '_blank') return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      if (!['/','/app','/spaces','/viewer','/sous','/practice','/human-skills','/dubbing','/translate','/connections','/activity','/desktop-services','/computer'].includes(url.pathname)) return;
      event.preventDefault();
      parent.postMessage({type:'brivany-navigate', route:(url.pathname==='/'?'/app':url.pathname) + url.search + url.hash}, location.origin);
    });
  });
})();

/* Only activity booleans from this owned module; no audio samples or text. */
(() => {
 if(parent===window)return;let sent=null;const youtube=new Map();window.BrivanyMediaActive=false;
 function update(){const frames=new Set([...document.querySelectorAll('iframe')].map(f=>f.contentWindow));for(const source of youtube.keys())if(!frames.has(source))youtube.delete(source);const active=[...document.querySelectorAll('audio,video')].some(el=>!el.paused&&!el.ended&&!el.muted&&el.volume>0&&el.readyState>=3)||[...youtube.values()].some(Boolean);if(active!==sent){sent=active;window.BrivanyMediaActive=active;parent.postMessage({type:'brivany-media-active',active},location.origin);}}
 for(const event of ['playing','pause','ended','emptied','volumechange','waiting','stalled'])document.addEventListener(event,update,true);
 window.addEventListener('message',event=>{if(!['https://www.youtube.com','https://www.youtube-nocookie.com'].includes(event.origin)||![...document.querySelectorAll('iframe')].some(frame=>frame.contentWindow===event.source))return;let value;try{value=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}if(value?.event==='infoDelivery'&&Number.isInteger(value.info?.playerState)){youtube.set(event.source,value.info.playerState===1);update();}});
 const mediaTimer=setInterval(update,500);window.addEventListener('pagehide',()=>{clearInterval(mediaTimer);parent.postMessage({type:'brivany-media-active',active:false},location.origin);},{once:true});
})();
