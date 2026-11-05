"""Sous browser/HTTP/context/audio plumbing with deterministic provider substitutes."""
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import threading
from types import SimpleNamespace
from unittest.mock import patch

from services.h1.server import Handler, ROOT
from services.sous import SousService
from services.sous_voice import SousVoiceService


def main():
    counts={'conversation':0,'speech':0};contexts=[]
    def reply(value,*,instructions,context):
        counts['conversation']+=1;contexts.append(context)
        step=context['session']['current_step'] if context['session'] else None
        item=next(item for item in context['inventory'] if item['label']=='Huevos')
        text=('Paso actual: '+step['instruction']) if step else 'Tienes '+str(item['quantity'])+' unidades de '+item['label']+'.'
        yield {'type':'delta','text':text};yield {'type':'sentence','text':text};yield {'type':'done','text':text,'model':'local-test-stub'}
    reply.simulation=True
    pcm=b''.join(struct.pack('<h',round(3500*math.sin(2*math.pi*440*i/24000))) for i in range(48000))
    class TestHandler(Handler):
        def do_POST(self):
            if self.path=='/api/voice/speech':
                if not self.local_request():return
                data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if data.get('consent') is not True or not data.get('text'):raise AssertionError('Speech consent missing')
                counts['speech']+=1;self.send_bytes(200,pcm,'audio/pcm;rate=24000');return
            super().do_POST()
    artifacts=ROOT/'tmp/sous-voice';artifacts.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brivany-sous-voice-') as temporary:
        sous=SousService(Path(temporary)/'sous')
        for label,quantity,unit in [('Huevos',4.,'unit'),('Verduras',400.,'g')]:
            sous.save_item({'label':label,'quantity':quantity,'unit':unit,'confidence':1.,'confirmed':True,
                'expiry_date':None,'expiry_provenance':'unknown','source_reference':None})
        server=ThreadingHTTPServer(('127.0.0.1',0),TestHandler);server.sous=sous
        server.sous_voice=SousVoiceService(sous,reply=reply,configured=lambda:True)
        server.sous_vision=SimpleNamespace(readiness=lambda:{'configured':False})
        server.voice_bridge=SimpleNamespace(port=server.server_port)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connect=socket.create_connection
        def local_only(address,*args,**kwargs):
            if address[0] not in ('127.0.0.1','localhost','::1'):raise AssertionError('External connection forbidden')
            return connect(address,*args,**kwargs)
        status={'asr':{'provider':'Meta','configured':True},'tts':{'provider':'Cloudflare','configured':True}}
        try:
            with patch('services.h1.server.voice_status',return_value=status),patch('socket.create_connection',side_effect=local_only):
                completed=subprocess.run(['node','tools/check_sous_voice.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':'http://127.0.0.1:'+str(server.server_port)},
                    capture_output=True,timeout=95,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if completed.returncode:raise RuntimeError((completed.stdout+completed.stderr).decode('utf-8',errors='replace'))
            report=json.loads((artifacts/'report.json').read_text(encoding='utf-8'))
            if counts!={'conversation':3,'speech':1}:raise AssertionError('Unexpected provider substitute calls: '+str(counts))
            if not contexts[1]['session'] or not contexts[2]['session']:raise AssertionError('Missing cooking context')
            report.update({'checked_at':datetime.now(timezone.utc).isoformat(),'provider_stub_calls':counts,
                'external_calls':0,'model_executed':False,'hardware_microphone_tested':False,'physical_audio_tested':False,
                'limitations':['ASR events, microphone stream and model/TTS providers are substituted; HTTP, Sous state, context and browser playback scheduling are real.',
                    'No real conversation quality, provider access, audible latency or physical microphone/speaker verified.']})
            (artifacts/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(report,ensure_ascii=False,indent=2))
        finally:server.shutdown();server.server_close();thread.join(3)


if __name__=='__main__':main()
