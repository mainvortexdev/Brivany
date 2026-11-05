"""One bounded synthetic Spanish system-audio trial, explicitly requested."""
import argparse
import base64
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import threading
import time
from uuid import uuid4
import wave
from websockets.sync.client import connect
from services.h1.server import load_local_config
from services.work.live_translation import WorkLiveTranslation
from services.work.system_translation_audio import SystemAudioRoute
from packages.providers import river_translation as river
from packages.providers.native_audio import open_native_audio,_WaveOutDriver

ROOT=Path(__file__).resolve().parents[1]
PHRASES=[('masculine','La puerta está abierta, puedes entrar ahora.'),('feminine','El tren llega mañana a las nueve.')]


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',action='store_true');args=parser.parse_args()
    if not args.allow_paid:parser.error('Se requiere --allow-paid para este ensayo único.')
    load_local_config();folder=ROOT/'tmp/workspace-translation-real';folder.mkdir(exist_ok=True)
    report={'started_at':datetime.now(timezone.utc).isoformat(),'purpose':'Two short synthetic Spanish voices through WASAPI, Muse, Meta and Cartesia into a separate native output.','status':'failed','paid_source_tts_contexts':0,'paid_asr_sessions':0,'paid_translation_requests':0,'retries':0,'microphone_captured':False,'user_audio_persisted':False,'actual_billed_amount':None,'physical_listening_verified':False}
    sources=[];trial=None;driver=None;outputs=[];styles=[];captions=[];stimulus_at=None
    try:
        # No source fixture is regenerated for a repeated local check.
        missing=[(mode,text) for mode,text in PHRASES if not (folder/(mode+'.wav')).exists()]
        if missing:
            with connect(river.CARTESIA_URL,additional_headers={'X-API-Key':os.environ['BRIVANY_CARTESIA_API_KEY']},open_timeout=5,close_timeout=1,max_size=262144,compression=None,proxy=None) as socket:
                for mode,text in missing:
                    identifier=uuid4().hex;data=bytearray();voice=river.VOICES['low' if mode=='masculine' else 'high']
                    socket.send(json.dumps({'model_id':river.SONIC_MODEL,'voice':voice,'language':'es','transcript':text,'context_id':identifier,'continue':False,'output_format':{'container':'raw','encoding':'pcm_s16le','sample_rate':24000}}));report['paid_source_tts_contexts']+=1
                    while True:
                        event=json.loads(socket.recv(timeout=8))
                        if event.get('context_id')!=identifier:continue
                        if event.get('type')=='error':raise ValueError('Source fixture synthesis rejected')
                        if event.get('type')=='done':break
                        if event.get('type')=='chunk':data.extend(base64.b64decode(event['data'],validate=True))
                        if len(data)>48000*6:raise ValueError('Source fixture exceeds six seconds')
                    with wave.open(str(folder/(mode+'.wav')),'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(data)
        for mode,_ in PHRASES:
            with wave.open(str(folder/(mode+'.wav')),'rb') as wav:
                if (wav.getnchannels(),wav.getsampwidth(),wav.getframerate())!=(1,2,24000) or wav.getnframes()>24000*6:raise ValueError('Invalid source fixture')
                sources.append(wav.readframes(wav.getnframes()))
        report['source_seconds']=[round(len(raw)/48000,3) for raw in sources]
        route=SystemAudioRoute()
        try:
            rows=route.meter.read();report['route_separated']=route.source!=route.output
            if any(s['endpoint']==route.source and s['peak']>.003 for s in rows):raise ValueError('Other sound is playing; synthetic trial was not started')
        finally:route.close()
        class BoundedMeta(river.MetaStream):
            def stream(self,*a,**kw):
                if report['paid_translation_requests']>=4:raise river.VoiceError('trial_limit','El ensayo llegó a cuatro solicitudes. No se reintentó.')
                report['paid_translation_requests']+=1;yield from super().stream(*a,**kw)
        class Trial(WorkLiveTranslation):
            def _update(self,**value):
                if value.get('voice_category'):styles.append(value['voice_category'])
                if value.get('caption'):captions.append(value['caption'])
                return super()._update(**value)
        def output(**kw):value=open_native_audio(**kw);outputs.append(value);return value
        trial=Trial(output_factory=output,bridge_factory=lambda port,**kw:river.RiverBridge(port,translator_factory=BoundedMeta,**kw))
        trial.start('en','auto');report['paid_asr_sessions']=1
        deadline=time.monotonic()+15
        while trial.status()['state']=='starting' and time.monotonic()<deadline:time.sleep(.05)
        if trial.status()['state']=='error':raise ValueError(trial.status()['error'])
        if trial.status()['state']=='starting':raise ValueError('Provider startup timeout')
        driver=_WaveOutDriver();stimulus_at=time.monotonic()
        for raw in sources:
            for offset in range(0,len(raw),960):
                driver.write(raw[offset:offset+960])
            driver.drain(2);time.sleep(2)
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            current=trial.status()
            if current['state']=='error':raise ValueError(current['error'])
            words=' '.join(captions).casefold()
            if 'door' in words and 'train' in words and {'masculine','feminine'}<=set(styles) and current['segments']>=len(styles) and outputs and outputs[0].stats()['queued_ms']['translation']==0 and outputs[0].stats()['accepted_bytes']['translation']>0:break
            time.sleep(.1)
        state=trial.status();stats=outputs[0].stats() if outputs else {}
        # No transcript text is persisted. Simple expected-word coverage is not
        # certified semantic quality or physical listening.
        text=' '.join(captions).casefold()
        report.update(voices_observed=styles,expected_voice_categories={'masculine','feminine'}<=set(styles),translation_contains_expected_words={'door':'door' in text,'train':'train' in text},session={k:v for k,v in state.items() if k not in {'caption'}},native_audio=stats,elapsed_from_stimulus=round(time.monotonic()-stimulus_at,2))
        if state['state']!='error' and state['segments']>=len(styles) and report['expected_voice_categories'] and all(report['translation_contains_expected_words'].values()) and stats.get('accepted_bytes',{}).get('translation',0)>0:report['status']='passed_system_capture_and_provider_output'
    except Exception as error:report['error']=str(error)[:300]
    finally:
        if driver:driver.close()
        if trial:trial.close();report['stopped']=not trial.status()['active'];report['capture_thread_stopped']=not bool(trial.capture and trial.capture.is_alive())
        report['finished_at']=datetime.now(timezone.utc).isoformat();path=folder/('report-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2));print('Informe: '+str(path.relative_to(ROOT)))
    return 0 if report['status'].startswith('passed') else 1

if __name__=='__main__':raise SystemExit(main())
