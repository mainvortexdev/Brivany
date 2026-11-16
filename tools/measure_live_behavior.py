"""One synthetic live turn and at most one synthesis; never records a microphone."""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
from unittest.mock import patch
from urllib.request import build_opener as original_opener


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-paid',action='store_true')
    parser.add_argument('--implementation-root',required=True,type=Path)
    parser.add_argument('--label',required=True,choices=['before','after'])
    parser.add_argument('--all-segments',action='store_true',help='Verify one complete reply with at most three parallel syntheses.')
    args=parser.parse_args()
    if not args.allow_paid:parser.error('--allow-paid is required')
    sys.path.insert(0,str(args.implementation_root.resolve()))
    from services.h1.server import load_local_config
    from packages.providers.conversation import ConversationRequest
    from packages.providers.cartesia_melodi import open_cartesia_speech
    from services.computer.service import ComputerService
    load_local_config(Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data/.env')
    report={'label':args.label,'purpose':'Compare one synthetic spoken reply with the installed previous flow and the corrected Vetsa-style flow.',
            'source_synthetic':True,'microphone_used':False,'audio_saved':False,
            'physical_speaker_verified':False,'model_requests':0,'tts_requests':0,
            'billed_usd':None,'automatic_retries':0,'passed':False}
    class TrackedOpener:
        def __init__(self,*args,**kwargs):self.inner=original_opener(*args,**kwargs)
        def open(self,*args,**kwargs):report['model_requests']+=1;return self.inner.open(*args,**kwargs)
    class Runtime:
        def availability(self):return {'available':False}
        def cancel(self):pass
        def close(self):pass
    started=time.monotonic();speeches=[];counter=threading.Lock();active=0
    def synthesize(text,index):
        nonlocal active
        with counter:
            report['tts_requests']+=1;report['speech_characters']=report.get('speech_characters',0)+len(text);active+=1
            report['max_concurrent_syntheses']=max(report.get('max_concurrent_syntheses',0),active)
        try:
            total=0
            with open_cartesia_speech(text,'es',speed=1.05) as response:
                while block:=response.read1(4096):
                    report.setdefault('first_pcm_ms',round((time.monotonic()-started)*1000));total+=len(block)
                    if any(abs(int.from_bytes(block[i:i+2],'little',signed=True))>96 for i in range(0,len(block)-1,2)):
                        report.setdefault('first_signal_pcm_ms',round((time.monotonic()-started)*1000))
                        if index==0:report.setdefault('first_ordered_signal_pcm_ms',round((time.monotonic()-started)*1000))
                    if total>=480000:break
            with counter:report['pcm_bytes']=report.get('pcm_bytes',0)+total
        except Exception as error:report['speech_error_type']=type(error).__name__
        finally:
            with counter:active-=1
    suffix='-pipeline' if args.all_segments else ''
    path=Path('tmp')/f'live-behavior-{args.label}{suffix}-20261112.json'
    with tempfile.TemporaryDirectory(prefix='brivany-live-measure-') as folder, \
         patch('packages.providers.conversation.build_opener',TrackedOpener), \
         patch('services.computer.planner.build_opener',TrackedOpener):
        service=ComputerService('http://127.0.0.1:1',lambda:None,root=Path(folder),runtime=Runtime(),native=True)
        try:
            question='Explica brevemente por qué el cielo cambia de color al atardecer.' if not args.all_segments else 'Responde con tres frases cortas: qué hace el sol, por qué cambia el cielo y cuándo se ve naranja.'
            value=ConversationRequest(text=question,source='voice',consent=True)
            for event in service.chat_turn(value,None):
                if event['type']=='delta' and event.get('text'):report.setdefault('first_text_ms',round((time.monotonic()-started)*1000))
                if event['type']=='sentence' and (not speeches or args.all_segments):
                    if len(speeches)>=3:raise ValueError('Speech request budget exceeded')
                    report.setdefault('first_sentence_ms',round((time.monotonic()-started)*1000))
                    speech=threading.Thread(target=synthesize,args=(event.get('speech_text',event['text']),len(speeches)),daemon=True);speeches.append(speech);speech.start()
                if event['type']=='done':report['model_complete_ms']=round((time.monotonic()-started)*1000)
                if event['type']=='reference_action':raise ValueError('Unexpected action routing; no action was executed')
            for speech in speeches:speech.join(20)
            report['passed']='model_complete_ms' in report and 'first_signal_pcm_ms' in report and not any(speech.is_alive() for speech in speeches) and 'speech_error_type' not in report
        except Exception as error:report['error_type']=type(error).__name__
        finally:
            report['external_calls']=report['model_requests']+report['tts_requests']
            path.write_text(json.dumps(report,indent=2),encoding='utf-8')
            service.close()
    report['external_calls']=report['model_requests']+report['tts_requests']
    path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
