"""Bounded demo-account inference with synthetic speech; no microphone or calls.

Requires --allow-paid. Uses only the restricted demo invitation/session, never
loads the developer's .env. Reuses its own generated fixture on later runs.
Reports aggregate results, not account tokens, provider keys or conversations.
"""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import re
import threading
import time
from services.demo_account import DemoAccount
from packages.providers.cartesia_melodi import open_cartesia_speech
from packages.providers.provider_access import endpoint,demo_headers
from packages.providers.live_voice import muse_handshake,MUSE_URL
from packages.providers.ink_asr import InkAsrSocket
from packages.providers.deepgram_asr import DeepgramAsrSocket
from packages.providers.meta_translation import MetaTranslationSession
from websockets.sync.client import connect

ROOT=Path(__file__).resolve().parents[1]
PHRASE='The meeting starts tomorrow at ten in the morning.'

def synthesize(text,language):
    started=time.monotonic();pcm=bytearray()
    with open_cartesia_speech(text,language) as stream:
        while chunk:=stream.read1(3840):pcm.extend(chunk)
        if not stream.done or not pcm:raise ValueError('tts_no_complete_audio')
    return bytes(pcm),round(time.monotonic()-started,3)

def recognize(kind,pcm):
    started=time.monotonic();socket=None;stop=threading.Event();texts=[];errors=[]
    try:
        if kind=='meta':
            socket=connect(endpoint(MUSE_URL),additional_headers=demo_headers(),open_timeout=8,close_timeout=1,proxy=None)
            socket.send(json.dumps(muse_handshake({'type':'start','consent':True,'mode':'practice','language':'en-US'})))
            if not json.loads(socket.recv(timeout=6)).get('sessionId'):raise ValueError('asr_no_session')
        else:socket=InkAsrSocket(open_timeout=8) if kind=='cartesia' else DeepgramAsrSocket(open_timeout=8,language='en')
        def reader():
            try:
                while not stop.is_set():
                    try:event=json.loads(socket.recv(timeout=.25))
                    except TimeoutError:continue
                    if event.get('type')=='error':errors.append(str(event.get('message') or 'provider_asr_error')[:250]);return
                    text=event.get('transcript')
                    if isinstance(text,str) and text.strip():texts.append(text)
            except Exception as error:
                if not stop.is_set():errors.append(type(error).__name__)
        worker=threading.Thread(target=reader,daemon=True);worker.start();sent_at=time.monotonic();audio=pcm+b'\0'*96000
        for offset in range(0,len(audio),3840):
            socket.send(audio[offset:offset+3840]);delay=(offset+min(3840,len(audio)-offset))/48000-(time.monotonic()-sent_at)
            if delay>0:time.sleep(delay)
        socket.send(json.dumps({'type':'endStream'}));deadline=time.monotonic()+5
        while time.monotonic()<deadline and not texts and not errors:time.sleep(.05)
        stop.set();socket.close();worker.join(1)
        actual=max(texts,key=len,default='');words=set(re.findall(r'[a-z]+',actual.lower()));expected=set(re.findall(r'[a-z]+',PHRASE.lower()))
        score=len(words&expected)/len(expected)
        return {'passed':score>=.8,'word_presence_ratio':round(score,3),'elapsed_seconds':round(time.monotonic()-started,3),'audio_seconds':len(audio)/48000,'errors':errors},actual
    finally:
        stop.set()
        if socket:socket.close()

def river_trial(pcm):
    from packages.providers.river_translation import RiverBridge
    class Sink:
        def __init__(self):self.bytes=0
        def set_levels(self,**_):pass
        def push_original(self,raw):pass
        def push_translation(self,raw):self.bytes+=len(raw)
        def push_translation_paced(self,raw,*,stopped,timeout=4):
            if stopped.is_set():return False
            self.push_translation(raw);return True
        def finish(self,timeout=3):return True
        def close(self):pass
    sink=Sink();bridge=RiverBridge(19875,mixer_factory=lambda:sink).start();counts={};socket=None;started=time.monotonic();diagnostics=[];bridge.failure_observer=diagnostics.append
    try:
        socket=connect('ws://127.0.0.1:'+str(bridge.port)+'/dub',origin='http://127.0.0.1:19875',proxy=None,open_timeout=4,close_timeout=1)
        socket.send(json.dumps({'type':'start','consent':True,'target_language':'es','voice_mode':'feminine','original_gain':0}))
        first=json.loads(socket.recv(timeout=12))
        if first.get('type')!='ready':raise ValueError('river_setup_'+str(first.get('code')))
        audio=pcm+b'\0'*96000;sent_at=time.monotonic()
        for offset in range(0,len(audio),3840):
            socket.send(audio[offset:offset+3840]);delay=(offset+min(3840,len(audio)-offset))/48000-(time.monotonic()-sent_at)
            if delay>0:time.sleep(delay)
        socket.send(json.dumps({'type':'finish'}));deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            event=json.loads(socket.recv(timeout=max(.1,deadline-time.monotonic())));kind=event.get('type');counts[kind]=counts.get(kind,0)+1
            if kind=='error':return {'passed':False,'error_code':event.get('code'),'event_counts':counts,'translated_pcm_bytes':sink.bytes,'diagnostics':diagnostics}
            if kind=='done':return {'passed':sink.bytes>24000,'translated_pcm_bytes':sink.bytes,'event_counts':counts,'elapsed_seconds':round(time.monotonic()-started,3),'physical_capture_verified':False,'physical_listening_verified':False}
        raise ValueError('river_deadline')
    finally:
        if socket:socket.close()
        bridge.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--allow-paid',action='store_true');parser.add_argument('--provider',choices=['all','meta','cartesia','deepgram'],default='all');parser.add_argument('--river-only',action='store_true');args=parser.parse_args()
    if not args.allow_paid:parser.error('--allow-paid is required')
    folder=ROOT/'.local/demo-jon/provider-test';account=DemoAccount(folder)
    account.activate(json.loads((ROOT/'.local/demo-jon/bootstrap.json').read_text(encoding='utf-8')));account.apply()
    report={'purpose':'Real inference through the shared demo budget, synthetic English phrase and Spanish output','synthetic_audio_only':True,'microphone_used':False,'phone_calls':0,'automatic_retries':0,'actual_billed_usd':None,'started_at':datetime.now(timezone.utc).isoformat(),'asr':{}}
    stage='source_tts';fixture=folder/'synthetic-english.pcm';folder.mkdir(parents=True,exist_ok=True)
    try:
        if fixture.exists():pcm=fixture.read_bytes();report['source_fixture_reused']=True
        else:
            pcm,elapsed=synthesize(PHRASE,'en');fixture.write_bytes(pcm);report['source_tts']={'seconds':len(pcm)/48000,'generation_seconds':elapsed,'characters':len(PHRASE)}
        if not 24000<=len(pcm)<=480000 or len(pcm)%2:raise ValueError('synthetic_fixture_invalid')
        if args.river_only:
            stage='river_pipeline';report['river']=river_trial(pcm);report['passed']=report['river']['passed'];return 0 if report['passed'] else 1
        recognized=''
        for kind in ['meta','cartesia','deepgram'] if args.provider=='all' else [args.provider]:
            stage='asr_'+kind
            try:report['asr'][kind],text=recognize(kind,pcm);recognized=text if report['asr'][kind]['passed'] else recognized
            except Exception as error:report['asr'][kind]={'passed':False,'error_code':getattr(error,'code',type(error).__name__)}
            print(json.dumps({'phase':stage,'result':report['asr'][kind]}),flush=True)
        if not recognized:raise ValueError('no_asr_provider_recognized_fixture')
        stage='translation';started=time.monotonic()
        with MetaTranslationSession(timeout_seconds=15) as translator:translation=translator(recognized,'en','es')
        text=translation['text'];report['translation']={'passed':bool(re.search(r'mañana',text,re.I)) and bool(re.search(r'diez|10',text)), 'elapsed_seconds':round(time.monotonic()-started,3),'usage':translation.get('usage',{})}
        stage='translated_tts';output,elapsed=synthesize(text,'es')
        import numpy as np
        samples=np.frombuffer(output,dtype='<i2');report['translated_tts']={'passed':len(output)>24000 and bool(np.max(np.abs(samples.astype('int32')))>100),'seconds':len(output)/48000,'generation_seconds':elapsed,'characters':len(text),'clipped_sample_fraction':float(np.mean(np.abs(samples.astype('int32'))>=32767)),'physical_listening_verified':False}
        report['passed']=all(v['passed'] for v in report['asr'].values()) and report['translation']['passed'] and report['translated_tts']['passed']
    except Exception as error:report.update(passed=False,failed_phase=stage,error_code=getattr(error,'code',type(error).__name__))
    finally:
        try:report['remaining_demo_budget_usd']=account.refresh()['remaining_usd']
        except Exception:report['remaining_demo_budget_usd']=None
        report['finished_at']=datetime.now(timezone.utc).isoformat();out=ROOT/'tmp'/('demo-providers-real-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2));print(str(out.relative_to(ROOT)))
    return 0 if report.get('passed') else 1

if __name__=='__main__':raise SystemExit(main())
