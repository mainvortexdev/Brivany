import {BufferedTranslationPlayer} from './buffered-player.js';
import {upcomingCaptions} from './caption-probe.js';

class RelayPort extends EventTarget {
  constructor(port) {
    super();
    this.port = port;
    this.readyState = WebSocket.OPEN;
    this.bufferedAmount = 0;
  }

  send(raw) {
    if (typeof raw === 'string') {
      const control = JSON.parse(raw);
      this.port.postMessage(control.type === 'stop' ? control : {type:'sync-control', control});
    } else {
      const data = btoa(String.fromCharCode(...new Uint8Array(raw)));
      this.port.postMessage({type:'sync-pcm', data});
    }
  }

  receive(value) {
    if (value.type === 'sync-ended') this.close();
    else this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(value)}));
  }

  close() {
    if(this.readyState===WebSocket.CLOSED)return;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

export function inlineTranslation({port, source, root, snapshot, settings, audio, stream, originalGain, sourceGain, status, caption, failure, finished, capture, prefix}) {
  if (!source.isConnected) throw Error('El video seleccionado ya no está en la página.');
  root.host.dataset.brivanySyncBuild='0.4.9-voice-start-070';
  const track=stream.getVideoTracks()[0];
  if (!track) throw Error('El video no permite sincronizar su imagen. Abre el reproductor original.');
  const frame = document.createElement('video');
  const cover = document.createElement('canvas');
  let initialSourceTime=null,sourceRate=1,lastBox=null,lastDiagnosticAt=0,diagnosticLag=null;
  frame.playsInline = true;
  const layerStyle = 'position:fixed;background:#000;object-fit:contain;pointer-events:none;';
  frame.style.cssText = layerStyle+'visibility:hidden;';
  cover.style.cssText = layerStyle;
  const width=source.videoWidth||640,height=source.videoHeight||360;
  const scale=Math.min(1,640/Math.max(width,height));
  cover.width=Math.max(1,Math.round(width*scale));
  cover.height=Math.max(1,Math.round(height*scale));
  cover.hidden=true;
  root.prepend(frame);
  root.prepend(cover);
  const socket = new RelayPort(port);
  const engine = new BufferedTranslationPlayer({
    video:frame, naturalRate:true,
    status:text => {
      if (text === 'Traduciendo'||text==='Audio original en este fragmento') {frame.style.visibility = 'visible';cover.hidden = true;}
      status(text);
    },
    caption, failure, finished,
    buffer:value=>{
      const now=performance.now();if(now-lastDiagnosticAt<500)return;lastDiagnosticAt=now;
      if(engine.firstSignalAfterCaptureMs!==null&&engine.firstSignalAfterCaptureMs!==undefined){
        diagnosticLag??={initial:value.lag,maximum:value.lag};
        diagnosticLag.maximum=Math.max(diagnosticLag.maximum,value.lag);
      }
      root.host.dataset.brivanySyncMetrics=JSON.stringify({source_anchor:initialSourceTime,source_rate:sourceRate,
        media:value.media,capture:value.capture,lag:value.lag,reason:value.reason,...engine.stats(),
        initial_lag:diagnosticLag?.initial??null,maximum_lag:diagnosticLag?.maximum??null,
        maximum_lag_growth:diagnosticLag?Math.max(0,diagnosticLag.maximum-diagnosticLag.initial):null});
    },
  });
  const fit = () => {
    if (!source.isConnected) {finished();return;}
    const box = source.getBoundingClientRect();
    if(lastBox&&['left','top','width','height'].every(key=>lastBox[key]===box[key]))return;
    lastBox=box;
    const position={left:`${box.left}px`, top:`${box.top}px`, width:`${box.width}px`, height:`${box.height}px`};
    Object.assign(frame.style, position);
    Object.assign(cover.style, position);
  };
  fit();
  const followFullscreen = () => {
    const container=document.fullscreenElement;
    if (container===source) {finished();return;}
    (container?.contains(source)?container:document.documentElement).append(root.host);
    fit();
  };
  document.addEventListener('fullscreenchange',followFullscreen);
  const layout = setInterval(fit, 250);
  const sendLookahead = () => {
    const next = upcomingCaptions({...snapshot, position:source.currentTime, paused:source.paused, rate:source.playbackRate});
    if (next) engine.anticipate(next,{early:true});
  };
  const lookahead = setInterval(sendLookahead, 1000);
  return {
    start:async() => {
      const limits={width:640,height:360,frameRate:24};
      await track.applyConstraints(Object.fromEntries(Object.entries(limits).map(([key,max])=>[key,{max}])));
      const size=track.getSettings();
      if(Object.entries(limits).some(([key,max])=>!(size[key]>0&&size[key]<=max)))throw Error('El navegador no pudo limitar la captura. El video sigue con su audio original.');
      const start=engine.start({stream, audio, socket, target:settings.target, voice:settings.voice, originalGain, sourceGain,prefix,onCapture:async()=>{
        await capture();
        initialSourceTime=source.currentTime;sourceRate=source.playbackRate;
        try { cover.getContext('2d').drawImage(source,0,0,cover.width,cover.height); } catch {}
        cover.hidden=false;
      }});
      sendLookahead();await start;
    },
    setCaptions:value => {snapshot=value;sendLookahead();},
    receive:value => { socket.receive(value); if (value.type === 'ready') sendLookahead(); },
    finish:reason => engine.finishInput(reason),
    currentSourceTime:() => initialSourceTime===null?null:initialSourceTime+Math.max(0,frame.currentTime-(engine.mediaOrigin??0))*sourceRate,
    close:() => { document.removeEventListener('fullscreenchange',followFullscreen);clearInterval(layout); clearInterval(lookahead); engine.close(); frame.remove(); cover.remove(); },
  };
}
