"""One approved synthetic phrase through real Palabra and native Windows output.

Not in tools.verify: requires --allow-paid and emits audible synthetic speech.
No source/translated PCM or transcript is written to the development ledger.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import threading
import time
from urllib.request import urlopen
import wave
from websockets.sync.client import connect

ROOT=Path(__file__).resolve().parents[1]
APPROVED='5a7a06a8a9073de2246f3faec54b7ac17cf296ed82f9652a5a7e4df87af20a30'

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--allow-paid',action='store_true');args=parser.parse_args()
    if not args.allow_paid:parser.error('Real provider use requires --allow-paid.')
    raw=(ROOT/'tmp/modular-dubbing/english-room.wav').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=APPROVED:raise ValueError('The approved synthetic fixture changed.')
    from io import BytesIO
    with wave.open(BytesIO(raw)) as source:
        if (source.getnchannels(),source.getsampwidth(),source.getframerate())!=(1,2,24000):raise ValueError('Unexpected fixture format.')
        pcm=source.readframes(source.getnframes())
    origin='http://127.0.0.1:8765'
    with urlopen(origin+'/api/dubbing/status?provider=palabra',timeout=5) as response:status=json.load(response)
    if not status.get('configured') or not status.get('available') or not status.get('native_audio',{}).get('available'):raise ValueError('Palabra and native audio must be configured before a paid call.')
    endpoint=status['websocket_url']
    if not endpoint.startswith('ws://127.0.0.1:') or not endpoint.endswith('/dub'):raise ValueError('A local relay is required.')
    seconds=len(pcm)/48000;report={'format':'brivany-native-palabra-real-1','started_at':datetime.now(timezone.utc).isoformat(),
        'purpose':'Verify one real provider session routes translated PCM to native Windows output without a browser popup.',
        'source_sha256':APPROVED,'source_synthetic':True,'source_seconds':seconds,'provider':'Palabra','source_language':'en','target_language':'es',
        'maximum_sessions':1,'automatic_retries':0,'provider_session_attempts':0,'actual_billed_usd':None,
        'estimated_input_cost_usd':round(seconds/60*.04,6),'estimate_basis':'Previously checked 0.04 USD/min input reference, not an invoice or hard limit.',
        'audio_output':None,'translated_output_events':0,'translated_duration_ms':0,'source_final_seen':False,'translation_final_seen':False,
        'physical_speaker_capture':False,'human_listening_verified':False,'translation_quality_verified':False,'full_youtube_capture_verified':False,
        'audio_persisted':False,'transcripts_persisted':False,'status':'failed'}
    socket=None
    try:
        socket=connect(endpoint,origin=origin,open_timeout=5,close_timeout=2,max_size=1048576,compression=None,proxy=None)
        socket.send(json.dumps({'type':'start','consent':True,'source_language':'en','target_language':'es','max_seconds':5,'quality_mode':'contextual_live',
            'audio_output':'local_device','original_gain':.12,'translation_gain':.85}));report['provider_session_attempts']=1
        ready=json.loads(socket.recv(timeout=20))
        if ready.get('type')!='ready' or ready.get('audio_output')!='local_device':raise ValueError('Native output was not acknowledged.')
        report['audio_output']=ready['audio_output'];report['provider_configuration_echoed']=ready.get('quality_mode_effective')=='contextual_live'
        started=time.monotonic();send_errors=[]
        def send_source():
            try:
                for offset in range(0,len(pcm),1920):
                    due=started+offset/48000;time.sleep(max(0,due-time.monotonic()));socket.send(pcm[offset:offset+1920])
                time.sleep(max(0,started+seconds-time.monotonic()));socket.send(json.dumps({'type':'finish'}))
            except Exception as error:send_errors.append(type(error).__name__)
        sender=threading.Thread(target=send_source,daemon=True);sender.start();deadline=time.monotonic()+22
        while time.monotonic()<deadline:
            event=json.loads(socket.recv(timeout=max(.1,deadline-time.monotonic())))
            if event.get('type')=='error':report['error_code']=event.get('code');raise ValueError('Real translation or native playback failed.')
            if event.get('type')=='audio':raise ValueError('Native output unexpectedly sent PCM to browser.')
            if event.get('type')=='audio-playback':
                report['translated_output_events']+=1;report['translated_duration_ms']+=event.get('duration_ms',0)
                if 'first_native_enqueue_ms' not in report:report['first_native_enqueue_ms']=round((time.monotonic()-started)*1000,2)
            if event.get('type')=='transcript':
                if event.get('source')=='original':report['source_final_seen']=True
                else:report['translation_final_seen']=True
            if event.get('type')=='done':report['provider_done']=True;break
        sender.join(2)
        if send_errors or not report.get('provider_done') or not report['translated_output_events']:raise ValueError('The bounded native route did not complete.')
        report['status']='passed_provider_and_native_enqueue_not_physical_listening'
    except Exception as error:
        report['failure_type']=type(error).__name__
    finally:
        if socket:socket.close()
        report['finished_at']=datetime.now(timezone.utc).isoformat();folder=ROOT/'tmp/native-audio-real';folder.mkdir(parents=True,exist_ok=True)
        path=folder/'report.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['status'].startswith('passed') else 1

if __name__=='__main__':raise SystemExit(main())
