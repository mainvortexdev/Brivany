"""One explicit own A/V trial: real Meta/Cartesia, isolated browser replay."""
import argparse
from datetime import datetime,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
from services.h1.server import load_local_config
from services.work.sync_relay import SyncRelay
from packages.providers.river_translation import RiverBridge,MetaStream
from packages.providers.meta_prosody import MetaProsodySession

ROOT=Path(__file__).resolve().parents[1]
HTML='''<!doctype html><meta charset="utf-8"><title>Brivany own synchronized A/V trial</title><button id="start">Start own sample</button><canvas id="source" width="640" height="360"></canvas><video id="replay" width="640" height="360"></video><script type="module">
import {BufferedTranslationPlayer} from '/browser-extension/buffered-player.js';
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),video=document.querySelector('video');
window.report={type:'real_providers_own_synthetic_AV_browser_replay',user_audio_persisted:false,transcripts_persisted:false,microphone:false,errors:[],cue_onsets:[],stages:[],states:[],snapshots:[],passed:false};
function reply(socket,message,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('local_auth_timeout')),5000);socket.addEventListener('message',function read(e){const d=JSON.parse(e.data);if(d.type==='error'){clearTimeout(timer);reject(Error(d.code));}if(d.type===type){clearTimeout(timer);socket.removeEventListener('message',read);resolve(d);}});if(socket.readyState===1)socket.send(JSON.stringify(message));else socket.addEventListener('open',()=>socket.send(JSON.stringify(message)),{once:true});});}
document.querySelector('#start').onclick=async()=>{let engine,audio,source,drawTimer,ws;const clicked=performance.now();
try{const cfg=window.testConfig,pair=new URL(cfg.link),code=pair.hash.slice(1);pair.hash='';let link=new WebSocket(pair.href),grant=await reply(link,{type:'pair',code},'paired');link.close();ws=new WebSocket(grant.websocket_url);await reply(ws,{type:'authenticate',token:grant.token},'authenticated');
source=new AudioContext();await source.resume();const raw=await fetch('/fixture.wav').then(r=>r.arrayBuffer()),sound=await source.decodeAudioData(raw),dst=source.createMediaStreamDestination(),node=source.createBufferSource();node.buffer=sound;node.connect(dst);const silence=source.createConstantSource(),silentGain=source.createGain();silentGain.gain.value=0;silence.connect(silentGain);silentGain.connect(dst);silence.start();
const initial=source.currentTime,draw=()=>{const t=source.currentTime-initial;ctx.fillStyle=Math.floor(t)%2?'#355f84':'#182531';ctx.fillRect(0,0,640,360);ctx.fillStyle='#fff';ctx.font='48px Georgia';ctx.fillText(t.toFixed(2)+' s',100,150);ctx.fillText(t<3.8||t>7?'Hablante 1':'Hablante 2',100,230);};draw();drawTimer=setInterval(draw,33);
const stream=new MediaStream([...canvas.captureStream(30).getVideoTracks(),...dst.stream.getAudioTracks()]);audio=new AudioContext({sampleRate:24000});await audio.resume();
engine=new BufferedTranslationPlayer({video,mode:cfg.mode||'synchronized',status:s=>{if(report.states.at(-1)!==s)report.states.push(s);},failure:e=>report.errors.push(e),buffer:s=>{if(!report.snapshots.length||s.capture-report.snapshots.at(-1).capture>=.9)report.snapshots.push(s);},prepared:()=>engine.beginPrepared()});
const original=engine.startVoice.bind(engine);engine.startVoice=async id=>{const cue=engine.cues.get(id);if(!cue)return;cue.voice.addEventListener('playing',()=>report.cue_onsets.push({id,source_start_ms:cue.event.source_start_ms,source_end_ms:cue.event.source_end_ms,video_ms:video.currentTime*1000,speaker:cue.event.speaker_label,prosody_available:cue.event.prosody?.available,emotion_applied:cue.event.prosody?.applied,audio_output_time:audio.getOutputTimestamp?.().contextTime,after_click_ms:performance.now()-clicked}),{once:true});return original(id);};
ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.type==='stage-metrics'||d.type==='source-turn'){const safe={type:d.type};for(const k of ['stage','segment_id','at_ms','phase','source_start_ms','source_end_ms','available','applied'])if(k in d)safe[k]=d[k];report.stages.push(safe);}});await BufferedTranslationPlayer.prepare(ws,{target:'en'});await engine.start({stream,audio,socket:ws,target:'en',providerReady:true});node.start(source.currentTime+.3);report.source_seconds=sound.duration;
const deadline=performance.now()+45000;while(performance.now()<deadline&&video.currentTime<sound.duration+.5&&!report.errors.length)await new Promise(r=>setTimeout(r,100));
report.stats=engine.stats();report.buffered=Array.from({length:video.buffered.length},(_,i)=>[video.buffered.start(i),video.buffered.end(i)]);report.readyState=video.readyState;report.video_frames=video.getVideoPlaybackQuality().totalVideoFrames;report.onset_error_ms=report.cue_onsets.map(c=>Math.round(Math.abs(c.video_ms-c.source_start_ms)));report.alignment_reference='ASR_detected_turn_boundaries_not_sample_precise_acoustic_or_lip_sync';report.preparation_budget_met=report.stats.prepared_after_capture_ms!==null&&report.stats.prepared_after_capture_ms<=6000;report.click_to_first_voice_budget_met=report.cue_onsets.length>0&&report.cue_onsets[0].after_click_ms<=6000;report.passed=!report.errors.length&&report.cue_onsets.length>=3&&report.onset_error_ms.every(ms=>ms<=150)&&video.currentTime>=sound.duration&&report.video_frames>100;
}catch(e){report.errors.push(e.message);}finally{engine?.close();ws?.close();clearInterval(drawTimer);await source?.close();if(audio?.state!=='closed')await audio?.close();report.finished=true;}};
</script>'''

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',action='store_true');parser.add_argument('--preproduction',action='store_true');args=parser.parse_args()
    if not args.allow_paid:parser.error('--allow-paid is required')
    load_local_config();counts={'asr_sessions':0,'mt_requests':0,'prosody_requests':0}
    class MT(MetaStream):
        def stream(self,*a,**kw):
            if counts['mt_requests']>=8:raise ValueError('Own trial limit')
            counts['mt_requests']+=1;yield from super().stream(*a,**kw)
    class Prosody(MetaProsodySession):
        def analyze(self,*a,**kw):counts['prosody_requests']+=1;return super().analyze(*a,**kw)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*a):pass
        def do_GET(self):
            route=self.path.split('?')[0]
            if route=='/':raw=HTML.encode();mime='text/html; charset=utf-8'
            elif route=='/fixture.wav':raw=(ROOT/'tmp/workspace-translation-continuity/speakers-es.wav').read_bytes();mime='audio/wav'
            elif route in ('/browser-extension/buffered-player.js','/browser-extension/sync-timeline.js','/browser-extension/pcm-capture.js'):
                raw=(ROOT/route.lstrip('/')).read_bytes();mime='text/javascript'
            else:self.send_error(404);return
            self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    http=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=http.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{http.server_port}'
    def factory():counts['asr_sessions']+=1;return RiverBridge(0,allow_synchronized=True,translator_factory=MT,prosody_factory=lambda:Prosody(verified_models={'muse-spark-1.2'}))
    relay=SyncRelay(port=0,bridge_factory=factory,allowed_origins=(url,)).start()
    try:
        cfg={'url':url,'link':relay.issue_pairing()['pair_link'],'mode':'preproduction' if args.preproduction else 'synchronized'}
        env={k:v for k,v in os.environ.items() if not k.startswith('BRIVANY_')};env['BRIVANY_OWN_SYNC_TEST']=json.dumps(cfg)
        result=subprocess.run(['node','tools/check_sync_translation_real.cjs'],cwd=ROOT,env=env,capture_output=True,timeout=65)
        print(result.stdout.decode('utf-8',errors='replace'));print(result.stderr.decode('utf-8',errors='replace'))
        report={'purpose':'One real translation of own two-voice sample into isolated delayed A/V replay.','counts':counts,'billed_amount':None,'automatic_retry_count_not_certified':True,'exit_code':result.returncode,'microphone_used':False,'user_media_persisted':False,'checked_at':datetime.now(timezone.utc).isoformat()}
        path=ROOT/'tmp/extension-sync-buffer'/('real-consumption-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2))
        return result.returncode
    finally:relay.close();http.shutdown();http.server_close()

if __name__=='__main__':raise SystemExit(main())
