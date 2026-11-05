"""Explicit real-provider continuity trial; numeric evidence, never user media."""
import argparse
import base64
from datetime import datetime,timezone
import importlib.util
import json
import os
import re
from pathlib import Path
import threading
import time
from uuid import uuid4
import wave
import numpy as np
from websockets.sync.client import connect
from services.h1.server import load_local_config
from services.work.translation import RecordingPeer
from services.work.live_translation import WorkLiveTranslation,CapturePeer
from services.work.system_translation_audio import SystemAudioRoute
from packages.providers import river_translation as current
from packages.providers.native_audio import NativeMixer,_WaveOutDriver
from desktop.experience.audio_sessions import WindowsSessionMeter

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'tmp/workspace-translation-continuity'
SOURCE=('Hoy vamos a comprobar una traducción mientras el video sigue avanzando. '
        'La cámara muestra una mesa de madera junto a una ventana abierta. '
        'Sobre la mesa hay un teléfono azul, un libro y una taza de café. '
        'Primero abrimos la aplicación y elegimos el idioma inglés. '
        'Después escuchamos las instrucciones sin detener la reproducción. '
        'Es importante que las frases mantengan su orden y que no desaparezca ninguna palabra. '
        'Si cambiamos de pantalla, la voz debe continuar con claridad. '
        'Al terminar, cerramos la sesión y recuperamos el volumen original del video. '
        'Esta prueba permite medir los retrasos y comprobar la continuidad del sonido.')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',action='store_true');parser.add_argument('--baseline',action='store_true');parser.add_argument('--system',action='store_true');parser.add_argument('--play-fixture',action='store_true');parser.add_argument('--speakers-fixture',action='store_true');parser.add_argument('--seconds',type=int,default=50);args=parser.parse_args()
    if not args.allow_paid:parser.error('--allow-paid is required')
    if not 20<=args.seconds<=90:parser.error('Duration must be 20–90 seconds')
    load_local_config();FOLDER.mkdir(exist_ok=True)
    river=current
    if args.baseline:
        spec=importlib.util.spec_from_file_location('baseline_river',FOLDER/'baseline_river.py');river=importlib.util.module_from_spec(spec);spec.loader.exec_module(river)
    report={'started_at':datetime.now(timezone.utc).isoformat(),'revision':'baseline' if args.baseline else 'current','input':'WASAPI_video' if args.system else 'own_synthetic_recording','paid_asr_sessions':0,'paid_source_tts_contexts':0,'paid_mt_requests':0,'paid_tts_contexts':0,'automatic_retries':0,'actual_billed_amount':None,'microphone_used':False,'user_audio_persisted':False,'transcripts_persisted':False,'physical_human_listening_verified':False,'status':'failed'}
    events=[];writes=[];translations=[];mixers=[];cancelled=threading.Event();owner=None;peer=None;bridge=None;start=time.monotonic();meter_stopped=threading.Event();meter_thread=None;capture_energy={'frames':0,'active_frames':0,'discontinuities':0}
    observations=[]
    original_connect=river.connect
    class ObservedMuse:
        def __init__(self,socket):self.socket=socket
        def __getattr__(self,key):return getattr(self.socket,key)
        def recv(self,*a,**kw):
            raw=self.socket.recv(*a,**kw)
            if isinstance(raw,str):
                value=json.loads(raw)
                if value.get('type')=='error':
                    # Whitelist machine codes only, never arbitrary server text.
                    report['asr_error_fields']={k:v for k,v in value.items() if k in ('code','errorCode','status') and (type(v) is int or isinstance(v,str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,90}',v))}
                    report['asr_error_flags']={k:k in json.dumps(value).lower() for k in ('timeout','inactiv','rate','limit','invalid','pause')}
            return raw
    def observed_connect(url,*a,**kw):
        socket=original_connect(url,*a,**kw)
        return ObservedMuse(socket) if url==river.MUSE_URL else socket
    river.connect=observed_connect
    class MeteredDriver:
        paced_output=True
        def __init__(self,endpoint):self.driver=_WaveOutDriver(endpoint)
        def write(self,raw):
            before=time.monotonic();self.driver.write(raw);after=time.monotonic()
            energy=float(np.sqrt(np.mean(np.frombuffer(raw,dtype='<i2').astype(float)**2)))
            writes.append({'at':after-start,'duration':len(raw)/48000,'rms':round(energy,1),'blocked_ms':round((after-before)*1000,2)})
        def drain(self,timeout):return self.driver.drain(timeout)
        def close(self):self.driver.close()
        def stats(self):return self.driver.stats() if hasattr(self.driver,'stats') else {}
    def output(endpoint):
        value=NativeMixer(MeteredDriver(endpoint));mixers.append(value);return value
    def event(value):
        kind=value.get('type')
        if kind=='done' and isinstance(value.get('native_audio'),dict):report['output_before_close']=value['native_audio']
        safe={'type':kind,'at_ms':round((time.monotonic()-start)*1000)}
        if kind=='transcript':
            if value.get('source')=='translation' and value.get('final'):translations.append(value.get('text',''));safe['characters']=len(value.get('text',''))
            else:return
        else:
            for key in ('stage','segment_id','first_audio_ms','tts_first_audio_ms','translation_ms','code','paused','segments','input_bytes','output_bytes','mt_ms','tts_ms','input_ms','source_start_ms','asr_processed_ms','request_to_first_ms','request_ms','audio_ms','speed','attempts','recoveries','total_attempts','total_recoveries','speaker_label','speaker_index','voice_category','voice_id'):
                if key in value:safe[key]=value[key]
        if owner:safe['capture_lead_ms']=round(max(0,owner.captured-owner.submitted)/48,2)
        events.append(safe)
        if kind in ('metrics','usage','error'):print(json.dumps(safe),flush=True)
    class BoundedMT(river.MetaStream):
        def stream(self,*a,**kw):
            if report['paid_mt_requests']>=40:raise river.VoiceError('trial_limit','El ensayo llegó al límite de solicitudes.')
            report['paid_mt_requests']+=1
            try:yield from super().stream(*a,**kw)
            except Exception as error:
                report['mt_error_diagnostic']={k:getattr(error,k,None) for k in ('http_status','request_ms','phase','saw_finish_reason','saw_done_marker','emitted_characters','body_eof','last_progress_ms')}
                report['mt_error_diagnostic']['transport']=getattr(error,'transport_diagnostics',{})
                raise
    try:
        route=SystemAudioRoute();endpoint=route.output;route.close()
        def meter_output():
            meter=WindowsSessionMeter(owner_pid=-1)
            try:
                while not meter_stopped.wait(2):
                    for row in meter.read(True):
                        if row['pid']==os.getpid() and row['endpoint']==endpoint:observations.append((row['peak'],row['volume'],row['muted']))
            finally:meter.close()
        meter_thread=threading.Thread(target=meter_output,daemon=True);meter_thread.start()
        def factory(port,**kw):return river.RiverBridge(port,translator_factory=BoundedMT,**kw)
        if args.system:
            class MeasuredRoute(SystemAudioRoute):
                def packets(self,stopped):
                    for index,raw in super().packets(stopped):
                        capture_energy['frames']+=1
                        if float(np.sqrt(np.mean(np.frombuffer(raw,dtype='<i2').astype(float)**2)))>100:capture_energy['active_frames']+=1
                        capture_energy['discontinuities']=self.discontinuities
                        yield index,raw
            class FinitePeer(CapturePeer):
                def __init__(self,owner):super().__init__(owner);self.finish_at=None;self.finished=False
                def recv(self,timeout=8):
                    if self.ready.is_set() and self.finish_at is None:self.finish_at=time.monotonic()+args.seconds
                    if self.finish_at and time.monotonic()>=self.finish_at:
                        if self.owner.stopped.is_set():return json.dumps({'type':'stop'})
                        if not self.finished:self.finished=True;return json.dumps({'type':'finish'})
                        time.sleep(min(timeout,.05));raise TimeoutError()
                    return super().recv(timeout)
                def send(self,raw):event(json.loads(raw));return super().send(raw)
            from unittest.mock import patch
            owner=WorkLiveTranslation(route_factory=MeasuredRoute,output_factory=lambda endpoint_id:output(endpoint_id),bridge_factory=factory)
            with patch('services.work.live_translation.CapturePeer',FinitePeer):
                report['paid_asr_sessions']=1;owner.start('en','auto');deadline=time.monotonic()+args.seconds+40
                source_thread=None
                if args.play_fixture:
                    def play_fixture():
                        while owner.status()['state']=='starting' and not owner.stopped.wait(.05):pass
                        if owner.stopped.is_set():return
                        with wave.open(str(FOLDER/'continuous-es.wav')) as wav:pcm=wav.readframes(wav.getnframes())
                        driver=_WaveOutDriver()
                        try:
                            for offset in range(0,len(pcm),960):
                                if owner.stopped.is_set():break
                                driver.write(pcm[offset:offset+960])
                            driver.drain(3)
                        finally:driver.close()
                    source_thread=threading.Thread(target=play_fixture,daemon=True);source_thread.start()
                while owner.worker.is_alive() and time.monotonic()<deadline:time.sleep(.1)
                if source_thread:source_thread.join(timeout=3)
                report['session']={k:v for k,v in owner.status().items() if k!='caption'}
                if owner.worker.is_alive():raise ValueError('Trial deadline exceeded')
        else:
            path=FOLDER/('speakers-es.wav' if args.speakers_fixture else 'continuous-es.wav')
            if args.speakers_fixture and not path.exists():
                parts=[]
                for mode in ('masculine','feminine','masculine'):
                    with wave.open(str(ROOT/'tmp/workspace-translation-real'/(mode+'.wav')),'rb') as wav:
                        if (wav.getnchannels(),wav.getsampwidth(),wav.getframerate())!=(1,2,24000):raise ValueError('Invalid existing speaker sample')
                        parts.append(wav.readframes(wav.getnframes())+bytes(48000))
                with wave.open(str(path),'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(b''.join(parts))
            if not path.exists():
                data=bytearray();identifier=uuid4().hex
                with connect(river.CARTESIA_URL,additional_headers={'X-API-Key':os.environ['BRIVANY_CARTESIA_API_KEY']},open_timeout=5,close_timeout=1,max_size=262144,compression=None,proxy=None) as socket:
                    socket.send(json.dumps({'model_id':river.SONIC_MODEL,'voice':river.VOICES['low'],'language':'es','transcript':SOURCE,'context_id':identifier,'continue':False,'output_format':{'container':'raw','encoding':'pcm_s16le','sample_rate':24000}}));report['paid_source_tts_contexts']=1
                    while True:
                        value=json.loads(socket.recv(timeout=15))
                        if value.get('context_id')!=identifier:continue
                        if value.get('type')=='error':raise ValueError('Synthetic source synthesis rejected')
                        if value.get('type')=='done':break
                        if value.get('type')=='chunk':data.extend(base64.b64decode(value['data'],validate=True))
                        if len(data)>48000*60:raise ValueError('Synthetic source over one minute')
                with wave.open(str(path),'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(data)
            with wave.open(str(path)) as wav:report['source_seconds']=wav.getnframes()/wav.getframerate()
            peer=RecordingPeer(path,'en',event,cancelled)
            if args.speakers_fixture:
                original_recv=peer.recv
                def recv(timeout=8):
                    raw=original_recv(timeout)
                    if isinstance(raw,str):
                        value=json.loads(raw)
                        if value.get('type')=='start':value.update(diarization=True,continuous_input=True);return json.dumps(value)
                    return raw
                peer.recv=recv
            original_send=peer.send
            def send(raw):
                value=json.loads(raw)
                if value.get('type')=='transcript':event(value)
                original_send(raw)
            peer.send=send
            bridge=factory(0,mixer_factory=lambda:output(endpoint));report['paid_asr_sessions']=1
            timer=threading.Timer(105,cancelled.set);timer.daemon=True;timer.start()
            try:bridge.handle(peer)
            finally:timer.cancel()
            report['terminal']={k:v for k,v in (peer.terminal or {}).items() if k not in ('message','native_audio')}
        report['native_audio']=[m.stats() for m in mixers]
        attempts=[e for e in events if e.get('stage')=='mt_attempt']
        if attempts:report['paid_mt_requests']=len(attempts)
        report['automatic_retries']=sum(e.get('stage')=='mt_recovery' for e in events)
        report['paid_tts_contexts']=max(sum(e['type']=='voice-style' for e in events),len({e.get('segment_id') for e in events if e.get('stage')=='tts_request'}))
        text=' '.join(translations).casefold()
        if not args.system or args.play_fixture:
            terms=[('door','door'),('train','train')] if args.speakers_fixture else [('window','window'),('phone','phone'),('english','english'),('volume','volume'),('continuity','continuity')]
            report['synthetic_content_checks']={key:term in text for key,term in terms}
        if args.speakers_fixture:
            voices=[(e.get('speaker_label'),e.get('voice_category'),e.get('voice_id')) for e in events if e['type']=='voice-style'];report['synthetic_speaker_assignments']=voices
        terminal=report.get('terminal',{})
        report['status']='completed' if terminal.get('type')=='done' or args.system and report.get('session',{}).get('state')=='stopped' else 'failed'
        if args.system and capture_energy['active_frames']<125:report['status']='insufficient_source_audio'
    except Exception as error:report['error_type']=type(error).__name__;report['error']=str(error)[:250]
    finally:
        if owner:owner.close()
        if peer:peer.close()
        if bridge:bridge.close()
        meter_stopped.set()
        if meter_thread:meter_thread.join(timeout=2)
        report['output_session_observations']={'samples':len(observations),'peak_max':max((x[0] for x in observations),default=None),'volume_min':min((x[1] for x in observations),default=None),'muted_samples':sum(x[2] for x in observations),'measures':'Windows_render_session_not_acoustic_listening'}
        river.connect=original_connect
        report['events']=events;report['elapsed_seconds']=round(time.monotonic()-start,2)
        if args.system:report['capture_energy']={**capture_energy,'active_seconds':round(capture_energy['active_frames']*.08,2),'stored_pcm':False}
        # Submission timeline discounts queued device lead; it does not certify
        # acoustic arrival at the ear or distinguish natural sentence silences.
        end=None;gaps=[]
        for row in writes:
            if end is None:end=row['at']+row['duration'];continue
            if row['at']>end+.08:gaps.append(round((row['at']-end)*1000))
            end=max(end,row['at'])+row['duration']
        report['output_submission']={'frames':len(writes),'seconds':round(sum(r['duration'] for r in writes),2),'non_silent_frames':sum(r['rms']>100 for r in writes),'gaps_over_80ms':gaps,'max_gap_ms':max(gaps,default=0)}
        report['finished_at']=datetime.now(timezone.utc).isoformat()
        target=FOLDER/('report-'+report['revision']+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');target.write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps({k:v for k,v in report.items() if k!='events'},indent=2));print('Numeric report: '+str(target.relative_to(ROOT)))
    return 0 if report['status']=='completed' else 1

if __name__=='__main__':raise SystemExit(main())
