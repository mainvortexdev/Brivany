"""Real loopback dubbing and browser capture graph with synthetic YouTube/audio.

Neither YouTube nor a translation provider is contacted. This checks the local
journey and its boundaries, not bilingual quality, audible latency or echo on
physical hardware. The original MP4 and private account credentials are unused.
"""
import base64
import hashlib
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
from unittest.mock import patch

from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve
from packages.providers.palabra import PalabraBridge
from services.h1.server import Handler,ROOT


class QuietHandler(Handler):
    def log_message(self,*args):pass


def main():
    simple='--simple' in sys.argv or '--capture-compat' in sys.argv
    compatibility='--capture-compat' in sys.argv
    pcm=b''.join(struct.pack('<h',round(math.sin(index*.1)*2200)) for index in range(1920))
    received={'connections':0,'pcm_packets':0,'pcm_bytes':0,'nonzero_pcm':False,'source_languages':[],
        'target_languages':[],'task_updates':0,'session_close_messages':0}
    errors=[];lock=threading.Lock();mixers=[]
    class FakeMixer:
        """Observe actual relay calls; never touch an audio device or persist PCM."""
        def __init__(self):
            self.original_packets=0;self.original_bytes=0;self.original_nonzero=False;self.original_hash=hashlib.sha256()
            self.translation_packets=0;self.translation_bytes=0;self.translation_nonzero=False;self.translation_hash=hashlib.sha256()
            self.levels=[];self.flushes=0;self.finishes=0;self.closed=False
        def check_error(self):
            if self.closed:raise AssertionError('Audio used after close')
        def push_original(self,raw):
            self.check_error()
            if not isinstance(raw,bytes) or not raw or len(raw)%2:raise AssertionError('Original PCM is malformed')
            with lock:
                self.original_packets+=1;self.original_bytes+=len(raw);self.original_nonzero|=any(raw);self.original_hash.update(raw)
        def push_translation(self,raw):
            self.check_error()
            if not isinstance(raw,bytes) or not raw or len(raw)%2:raise AssertionError('Translation PCM is malformed')
            with lock:
                self.translation_packets+=1;self.translation_bytes+=len(raw);self.translation_nonzero|=any(raw);self.translation_hash.update(raw)
        def set_levels(self,*,original=None,translation=None):
            self.check_error();value={key:item for key,item in (('original',original),('translation',translation)) if item is not None}
            if any(type(item) not in {int,float} or not math.isfinite(item) or not 0<=item<=1 for item in value.values()):raise AssertionError('Invalid gain')
            with lock:self.levels.append(value)
        def flush_translation(self):
            self.check_error()
            with lock:self.flushes+=1
        def finish(self,timeout=3):
            self.check_error()
            with lock:self.finishes+=1
            return True
        def close(self):
            with lock:self.closed=True
        def report(self):
            return {'original_packets':self.original_packets,'original_bytes':self.original_bytes,'original_nonzero':self.original_nonzero,
                'original_sha256':self.original_hash.hexdigest(),'translation_packets':self.translation_packets,'translation_bytes':self.translation_bytes,
                'translation_nonzero':self.translation_nonzero,'translation_sha256':self.translation_hash.hexdigest(),
                'levels':list(self.levels),'translation_flushes':self.flushes,'finish_calls':self.finishes,'closed':self.closed,
                'physical_playback_performed':False}
    def mixer_factory():
        mixer=FakeMixer()
        with lock:mixers.append(mixer)
        return mixer
    def output(ws,target,identifier):
        ws.send(json.dumps({'message_type':'validated_transcription','data':{'transcription':{'transcription_id':identifier,'language':'en','text':'Known synthetic source','translation_part_id':0}}}))
        ws.send(json.dumps({'message_type':'output_audio_data','data':{'data':base64.b64encode(pcm).decode(),
            'chunk_generation_delta':95,'transcription_id':identifier,'translation_part_id':'0','last_chunk':True,'language':target}}))
        ws.send(json.dumps({'message_type':'translated_transcription','data':{'target_language':target,'transcription':{
            'transcription_id':identifier,'translation_part_id':0,'language':target,'text':'Bonjour simulé' if target=='fr' else 'Prueba simulada',
            'segments':[{'start':0,'end':.08}]}}}))
    def upstream(ws):
        try:
            with lock:received['connections']+=1
            if ws.request.headers.get('Authorization')!='Bearer local-youtube-simulation-not-a-real-key':raise AssertionError('Synthetic credential required')
            task=None;target='es';packets=0;output_revision=0
            for raw in ws:
                event=json.loads(raw);kind=event.get('message_type')
                if kind=='set_task':
                    data=event['data'];pipeline=data.get('pipeline',{});translations=pipeline.get('translations',[])
                    if not translations:raise AssertionError('Missing translation task')
                    target=translations[0]['target_language'];source=pipeline.get('transcription',{}).get('source_language')
                    if target not in {'es','en','fr'} or source not in {'auto','es','en','fr'}:raise AssertionError('Unexpected translation direction')
                    if translations[0].get('translate_partial_transcriptions') is not False:raise AssertionError('Contextual profile must not speak unstable partials')
                    with lock:
                        received['source_languages'].append(source);received['target_languages'].append(target)
                        if task is not None:received['task_updates']+=1
                    task=data;output_revision+=1
                    ws.send(json.dumps({'message_type':'task_status','data':{'command':'set_task','event':'updated' if output_revision>1 else 'started','task_status':'running'}}))
                elif kind=='get_task':
                    ws.send(json.dumps({'message_type':'current_task','data':task}))
                elif kind=='interrupt_task':
                    ws.send(json.dumps({'message_type':'task_status','data':{'command':'interrupt_task','event':'interrupted','task_status':'running'}}))
                elif kind=='input_audio_data':
                    data=base64.b64decode(event['data']['data'],validate=True)
                    if not data or len(data)%2 or len(data)>15360:raise AssertionError('Invalid upstream PCM')
                    with lock:
                        received['pcm_packets']+=1;received['pcm_bytes']+=len(data);received['nonzero_pcm']|=any(data)
                    packets+=1
                    # Bounded output in response to live input, long enough for
                    # control changes without manufacturing a latency result.
                    if packets%5==1:output(ws,target,f'synthetic-{output_revision}-{packets}')
                elif kind=='end_task':
                    with lock:received['session_close_messages']+=1
                    ws.send(json.dumps({'message_type':'end_of_stream','data':{}}));return
                else:raise AssertionError('Unsupported simulated upstream message')
        except ConnectionClosed:pass
        except Exception as error:errors.append(type(error).__name__);raise
    with serve(upstream,'127.0.0.1',0,compression=None) as fake:
        fake_thread=threading.Thread(target=fake.serve_forever,daemon=True);fake_thread.start()
        endpoint=f'ws://127.0.0.1:{fake.socket.getsockname()[1]}'
        from packages.providers.palabra import dubbing_status
        def simulation_status():return {**dubbing_status(),'simulation_only':True}
        with patch.dict(os.environ,{'BRIVANY_PALABRA_API_KEY':'local-youtube-simulation-not-a-real-key'}),patch('packages.providers.palabra.URL',endpoint),patch('services.h1.server.dubbing_status',simulation_status),patch('packages.providers.native_audio.open_native_audio',side_effect=mixer_factory),patch('packages.providers.palabra.open_native_audio',side_effect=mixer_factory,create=True):
            server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler);bridge=PalabraBridge(server.server_port).start();server.translation_bridge=bridge
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                result=subprocess.run(['node','tools/check_youtube_dubbing.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}','BRIVANY_YOUTUBE_SIMPLE':'1' if simple else '0','BRIVANY_YOUTUBE_CAPTURE_COMPAT':'1' if compatibility else '0'},capture_output=True,timeout=100,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                output_text=(result.stdout+result.stderr).decode('utf-8',errors='replace')
                if result.returncode:raise RuntimeError('YouTube dubbing journey failed:\n'+output_text)
                if errors or not received['nonzero_pcm'] or received['pcm_packets']<3:raise AssertionError('Actual local synthetic PCM path was not observed')
                directory=ROOT/('tmp/youtube-capture-compat' if compatibility else 'tmp/youtube-simple' if simple else 'tmp/youtube-dubbing')
                report=json.loads((directory/'browser.json').read_text(encoding='utf-8'))
                if len(mixers)!=1:raise AssertionError('Exactly one explicit native audio factory invocation was expected')
                mixer=mixers[0]
                if not mixer.original_nonzero or not mixer.translation_nonzero:raise AssertionError('Original and translated PCM did not reach the native mixer substitute')
                if not mixer.closed:raise AssertionError('The native audio substitute was not closed on stop')
                if not any(level.get('original')==(.06 if compatibility else .12) and level.get('translation')==.85 for level in mixer.levels):raise AssertionError('The requested original/translation gains were not applied')
                if mixer.flushes<1:raise AssertionError('The language switch did not flush pending native translation')
                report.update(checked_at=datetime.now(timezone.utc).isoformat(),provider_received=received,provider_errors=errors,
                    native_output={'factory_calls':len(mixers),'substituted':True,'mixers':[mixer.report()]})
                (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
                print(json.dumps(report,ensure_ascii=False,indent=2))
            finally:server.shutdown();server.server_close();thread.join(3);bridge.close()


if __name__=='__main__':main()
