"""One bounded provider/native-output trial on reused synthetic Spanish audio."""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import threading
import time
import wave
from services.h1.server import load_local_config,ROOT
from services.work.selected_video import SelectedVideo,SelectedVideoCoordinator
from services.work.live_translation import WorkLiveTranslation
from packages.providers import river_translation as river
from packages.providers.native_audio import open_native_audio


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',action='store_true');args=parser.parse_args()
    if not args.allow_paid:parser.error('Use --allow-paid only for this bounded real provider test.')
    folder=ROOT/'tmp/selected-video';folder.mkdir(exist_ok=True)
    report={'type':'real_provider_selected_source_progressive_translation_and_native_output','passed':False,'source_owned_synthetic':True,'source_tts_regenerated':False,'original_audio_attached':False,'transcript_persisted':False,'physical_listening_verified':False,'personal_youtube_verified':False,'billing_amount':None,'maximum_meta_calls':4,'started_at':datetime.now(timezone.utc).isoformat()}
    owner=None;selected=None;feeder=None;stop=threading.Event();outputs=[];translators=[];events={};first_audio_while_playing=False
    try:
        sources=[]
        for name in ('masculine','feminine'):
            path=ROOT/'tmp/workspace-translation-real'/(name+'.wav');raw=path.read_bytes()
            with wave.open(str(path),'rb') as wav:
                if (wav.getnchannels(),wav.getsampwidth(),wav.getframerate())!=(1,2,24000) or wav.getnframes()>6*24000:raise ValueError('Invalid reused synthetic fixture')
                sources.append(wav.readframes(wav.getnframes()))
        report['source_hashes']=[hashlib.sha256(s).hexdigest() for s in sources]
        load_local_config();config=river.river_status()
        if not config['configured'] or config['access_blocked']:raise ValueError('Provider access is not ready')
        class BoundedMeta(river.MetaStream):
            def __init__(self):super().__init__();self.calls=0;translators.append(self)
            def stream(self,*a,**kw):
                if sum(t.calls for t in translators)>=4:raise river.VoiceError('test_limit','El ensayo llegó a cuatro llamadas de traducción.')
                self.calls+=1;yield from super().stream(*a,**kw)
        class Peer:
            def send(self,raw):
                event=json.loads(raw);kind=event.get('type');events[kind]=events.get(kind,0)+1
            def close(self):pass
        selected=SelectedVideo(Peer(),{'type':'select','selection':'owned-progressive-real','source':'video:12345678','has_captions':False,'translate':True},connector=lambda *_a,**_k:(_ for _ in ()).throw(ValueError('Duplicate ASR forbidden')))
        def output(**options):value=open_native_audio(**options);outputs.append(value);return value
        owner=WorkLiveTranslation(output_factory=output,bridge_factory=lambda port,**options:river.RiverBridge(port,translator_factory=BoundedMeta,**options));coordinator=SelectedVideoCoordinator(lambda:owner)
        coordinator.request(selected);started=time.monotonic();duration=18
        # The selected source continues while MT and native speech are active.
        pcm=(bytes(24000)+sources[0]+bytes(48000*2)+sources[1]);pcm=pcm.ljust(48000*duration,b'\0')[:48000*duration]
        def feed():
            for offset in range(0,len(pcm),3840):
                if stop.wait(max(0,started+offset/48000-time.monotonic())):return
                selected.accept(pcm[offset:offset+3840].ljust(3840,b'\0'))
        feeder=threading.Thread(target=feed,daemon=True);feeder.start()
        while time.monotonic()-started<duration:
            state=owner.status();snapshot=selected.snapshot();stats=outputs[0].stats() if outputs else {}
            if state['state']=='error' or selected.error:raise ValueError(state.get('error') or selected.error)
            if stats.get('accepted_bytes',{}).get('translation',0)>0 and first_audio_while_playing is False:
                first_audio_while_playing=feeder.is_alive();report['first_native_audio_seconds']=round(time.monotonic()-started,3)
            if snapshot['translation'] and 'door' in snapshot['translation'].casefold():report['contains_door']=True
            if snapshot['translation'] and 'train' in snapshot['translation'].casefold():report['contains_train']=True
            if first_audio_while_playing and report.get('contains_door') and report.get('contains_train') and state['segments']>=2 and stats.get('queued_ms',{}).get('translation',1)==0:break
            time.sleep(.05)
        snapshot=selected.snapshot();state=owner.status();stats=outputs[0].stats() if outputs else {}
        report.update(first_audio_before_video_end=first_audio_while_playing,progressive_events=events,transcribed_turns=len(snapshot['turns']),shared_asr_only=selected.calls==0 and selected.worker is None,meta_calls=sum(t.calls for t in translators),meta_attempts=sum(t.total_attempts for t in translators),native_audio=stats,elapsed_seconds=round(time.monotonic()-started,2),segments=state['segments'])
        report['passed']=bool(first_audio_while_playing and report['shared_asr_only'] and events.get('transcript',0)>0 and report.get('contains_door') and report.get('contains_train') and stats.get('accepted_bytes',{}).get('translation',0)>0)
    except Exception as error:report['error']=str(error)[:250]
    finally:
        stop.set()
        if feeder:feeder.join(timeout=1)
        if owner:owner.close();report['stopped']=not owner.status()['active']
        if selected:selected.close()
        report['finished_at']=datetime.now(timezone.utc).isoformat();path=folder/('progressive-real-'+str(time.time_ns())+'.json');path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2));print('Informe: '+str(path.relative_to(ROOT)))
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
