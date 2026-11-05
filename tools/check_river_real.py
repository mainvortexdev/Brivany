"""One explicit, bounded paid test; reuse a fixed synthetic phrase, never retry."""
import argparse
from datetime import datetime,timezone
import hashlib
from io import BytesIO
import json
from pathlib import Path
import threading
import time
import wave
from websockets.sync.client import connect
from services.h1.server import load_local_config,ROOT
from packages.providers import river_translation as river


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--allow-paid',action='store_true');args=parser.parse_args()
    if not args.allow_paid:parser.error('Explicit --allow-paid is required for real provider use.')
    source=(ROOT/'tmp/modular-dubbing/english-room.wav').read_bytes()
    approved='5a7a06a8a9073de2246f3faec54b7ac17cf296ed82f9652a5a7e4df87af20a30'
    if hashlib.sha256(source).hexdigest()!=approved:raise ValueError('Approved synthetic fixture changed; no providers opened.')
    with wave.open(BytesIO(source)) as wav:
        if (wav.getnchannels(),wav.getsampwidth(),wav.getframerate())!=(1,2,24000):raise ValueError('Invalid fixture format.')
        pcm=wav.readframes(wav.getnframes())
    if len(pcm)>river.RATE_BYTES*3:raise ValueError('Fixture longer than three seconds.')
    load_local_config();status=river.river_status()
    if not status['configured'] or status['access_blocked'] or not status['native_output']['available']:
        raise ValueError('Provider access or native output not ready; no providers opened.')
    # These stricter limits apply only in this dedicated test process.
    # The fixed fixture and explicit finish bound input; never run this tool in a loop.
    class SingleRequestTranslator(river.MetaStream):
        def __init__(self):super().__init__();self.requests=0
        def stream(self,*args,**kwargs):
            if self.requests:raise river.VoiceError('test_request_limit','El ensayo real admite una sola traducción; no se reintentó.')
            self.requests+=1
            yield from super().stream(*args,**kwargs)
    bridge=river.RiverBridge(19875,translator_factory=SingleRequestTranslator).start();socket=None
    report={'started_at':datetime.now(timezone.utc).isoformat(),'purpose':'One synthetic phrase through real Muse, Meta Spark and Cartesia into native Windows output.',
        'source_synthetic':True,'source_sha256':approved,'source_seconds':len(pcm)/48000,
        'model':status['model'],'maximum_sessions':1,'maximum_translation_requests':1,
        'maximum_tts_contexts':1,'automatic_retries':0,'audio_persisted':False,'transcripts_persisted':False,
        'physical_playback_verified':False,'real_youtube_capture_verified':False,'translation_quality_verified':False,
        'actual_billed_usd':None,'status':'failed','event_counts':{}}
    sender=None;send_errors=[]
    try:
        socket=connect(f'ws://127.0.0.1:{bridge.port}/dub',origin='http://127.0.0.1:19875',proxy=None,open_timeout=4,close_timeout=1)
        socket.send(json.dumps({'type':'start','consent':True,'target_language':'es','original_gain':0}))
        first=json.loads(socket.recv(timeout=18))
        if first.get('type')!='ready':
            report['error_code']=first.get('code');raise ValueError('Provider setup did not complete.')
        report['providers_ready']=True;started=time.monotonic()
        def send_source():
            try:
                for offset in range(0,len(pcm),3840):
                    time.sleep(max(0,started+offset/48000-time.monotonic()));socket.send(pcm[offset:offset+3840].ljust(3840,b'\0'))
                time.sleep(max(0,started+len(pcm)/48000-time.monotonic()));socket.send(json.dumps({'type':'finish'}))
            except Exception as error:send_errors.append(type(error).__name__)
        sender=threading.Thread(target=send_source,daemon=True);sender.start();deadline=time.monotonic()+18
        while time.monotonic()<deadline:
            event=json.loads(socket.recv(timeout=max(.1,deadline-time.monotonic())))
            kind=event.get('type');report['event_counts'][kind]=report['event_counts'].get(kind,0)+1
            if kind=='error':report['error_code']=event.get('code');break
            if kind=='metrics':report['metrics']={key:event.get(key) for key in ('first_audio_ms','tts_first_audio_ms')}
            if kind=='usage':report['translation_usage']=event.get('usage',{})
            if kind=='done':
                report['summary']={key:event.get(key) for key in ('segments','characters','input_bytes','output_bytes','native_audio')}
                if event.get('output_bytes',0)>0:report['status']='passed_provider_chain_and_native_output_not_physical_listening'
                break
    except Exception as error:report['failure_type']=type(error).__name__
    finally:
        if socket:
            try:socket.send(json.dumps({'type':'stop'}))
            except Exception:pass
            socket.close()
        if sender:sender.join(1)
        bridge.close();report['send_errors']=send_errors;report['finished_at']=datetime.now(timezone.utc).isoformat()
        path=ROOT/'tmp'/('river-real-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json')
        path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2));print('Informe: '+str(path.relative_to(ROOT)))
    return 0 if report['status'].startswith('passed') else 1


if __name__=='__main__':raise SystemExit(main())
