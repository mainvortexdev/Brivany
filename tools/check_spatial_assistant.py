"""Real scene/HTTP/browser assistant with one deterministic text-model substitute."""
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
from unittest.mock import patch

from services.h1.server import Handler,ROOT
from services.spatial.assistant import SpatialAssistantService
from services.spatial.jobs import SpatialService
from services.spatial.media_access import MediaAccess


def main():
    calls=[]
    def reply(value,*,instructions,context):
        calls.append(context)
        item=context['selected_object'];text='Etiqueta: '+item['label']+'. Procedencia: '+item['asset_provenance']+'. Escala real sin verificar.'
        yield {'type':'delta','text':text};yield {'type':'sentence','text':text};yield {'type':'done','text':text,'model':'local-test-stub'}
    reply.simulation=True
    artifacts=ROOT/'tmp/spatial-assistant';artifacts.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brivany-spatial-assistant-') as temporary:
        spatial=SpatialService(Path(temporary)/'spatial',start_worker=False)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.spatial=spatial;server.spatial_media_access=MediaAccess()
        server.spatial_assistant=SpatialAssistantService(spatial,reply=reply,configured=lambda:True)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connect=socket.create_connection
        def local_only(address,*args,**kwargs):
            if address[0] not in ('127.0.0.1','localhost','::1'):raise AssertionError('External request forbidden')
            return connect(address,*args,**kwargs)
        status={'asr':{'provider':'Meta','configured':False},'tts':{'provider':'Cloudflare','configured':False}}
        try:
            with patch('socket.create_connection',side_effect=local_only),patch('services.h1.server.voice_status',return_value=status):
                result=subprocess.run(['node','tools/check_spatial_assistant.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':'http://127.0.0.1:'+str(server.server_port)},capture_output=True,timeout=110,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:raise RuntimeError((result.stdout+result.stderr).decode('utf-8',errors='replace'))
            if len(calls)!=1 or calls[0]['selected_object']['id']!='table':raise AssertionError('Unexpected context/model invocation count')
            report=json.loads((artifacts/'report.json').read_text(encoding='utf-8'))
            report.update(checked_at=datetime.now(timezone.utc).isoformat(),model_stub_calls=len(calls),external_calls=0,
                model_executed=False,voice_hardware_tested=False,audible_latency_verified=False,
                limitations=['Actual scene GLB, HTTP, SQLite, edit history and browser; text-model response substituted.',
                    'No provider account, camera observation, geometry fidelity, physical collision or measured scale verified.',
                    'This text-focused check does not exercise Muse, TTS or a physical microphone.'])
            (artifacts/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(report,ensure_ascii=False,indent=2))
        finally:server.shutdown();server.server_close();thread.join(3);spatial.close()


if __name__=='__main__':main()
