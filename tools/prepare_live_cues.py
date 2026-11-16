"""Prepare the varied Melodi listening bank once; reuse every existing cue."""
import argparse
import json
from pathlib import Path
import time
from urllib.request import Request, build_opener, ProxyHandler
from desktop.management import read_control, data_folder
from services.voice_cues import CUES, cue_path, read_cue


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-paid',action='store_true')
    args=parser.parse_args()
    root=data_folder()/'.local/voice-cues'
    report={'mode':'fixed_synthetic_Melodi_listening_cues','external_calls':0,
            'cost_usd':None,'user_audio_used':False,'microphone_used':False,
            'automatic_retries':0,'items':[],'passed':False}
    base=read_control()['base'];opener=build_opener(ProxyHandler({}))
    try:
        for key,text in CUES['es'].items():
            try:raw=read_cue('es',key,root);cached=True
            except (OSError,ValueError):
                if not args.allow_paid:raise ValueError('Falta una señal; generar requiere --allow-paid.')
                started=time.monotonic();report['external_calls']+=1
                request=Request(base+'/api/voice/speech',json.dumps({'text':text,'consent':True,'language':'es','speed':1}).encode(),{'Content-Type':'application/json'})
                with opener.open(request,timeout=15) as response:
                    if not response.headers.get('Content-Type','').startswith('audio/pcm'):raise ValueError('Invalid cue format')
                    raw=response.read(240001)
                if not raw or len(raw)>240000 or len(raw)%2:raise ValueError('Invalid cue length')
                path=cue_path('es',key,root);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw);cached=False
            report['items'].append({'cue':key,'cached':cached,'bytes':len(raw),'duration_seconds':len(raw)/48000})
        report['passed']=True
    except Exception as error:report['error_type']=type(error).__name__
    from datetime import datetime,timezone
    path=Path('tmp')/('live-cues-preparation-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
