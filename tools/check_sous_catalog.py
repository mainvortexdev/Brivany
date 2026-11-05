"""Real local catalog/shopping HTTP and UI; no model, account or provider used."""
from datetime import datetime,timezone
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
from types import SimpleNamespace
from unittest.mock import patch

from services.h1.server import Handler,ROOT
from services.sous import SousService
from services.sous_voice import SousVoiceService


def main():
    artifacts=ROOT/'tmp/sous-catalog';artifacts.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brivany-sous-catalog-') as temporary:
        sous=SousService(Path(temporary)/'sous')
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.sous=sous
        server.sous_voice=SimpleNamespace(readiness=lambda:{'configured':False,'provider_simulated':False})
        server.sous_vision=SimpleNamespace(readiness=lambda:{'configured':False})
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connect=socket.create_connection
        def local_only(address,*args,**kwargs):
            if address[0] not in ('127.0.0.1','localhost','::1'):raise AssertionError('External network forbidden')
            return connect(address,*args,**kwargs)
        try:
            with patch('socket.create_connection',side_effect=local_only):
                completed=subprocess.run(['node','tools/check_sous_catalog.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':'http://127.0.0.1:'+str(server.server_port)},
                    capture_output=True,timeout=95,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if completed.returncode:raise RuntimeError((completed.stdout+completed.stderr).decode('utf-8',errors='replace'))
            reopened=SousService(sous.root);preferences=reopened.preferences();shopping=reopened.shopping_list()
            if preferences['locality']!={'country':'Bolivia','city':'La Paz'} or preferences['recipe_id']!='quinoa-vegetables-v1':raise AssertionError('Preferences did not persist')
            if not any(item['label']=='Quinua blanca' and item['unit']=='kg' and item['quantity']==.25 and item['checked'] for item in shopping['items']):raise AssertionError('Edited shopping line did not persist')
            with reopened._db() as db:session_id=db.execute('SELECT id FROM sessions').fetchone()[0]
            context=SousVoiceService(reopened).context(session_id)
            if context['recipe']['id']!='quinoa-vegetables-v1' or context['locality_source']!='user_declared' or context['actions_enabled']:raise AssertionError('Incorrect voice context')
            report=json.loads((artifacts/'report.json').read_text(encoding='utf-8'))
            report.update({'checked_at':datetime.now(timezone.utc).isoformat(),'persistent_service_reopen_checked':True,
                'voice_context_checked':True,'external_calls':0,'gpu_inference':False,'model_executed':False,
                'limitations':['Authored presets and declared locality only; no traditional authenticity or external recipe sources verified.',
                    'No geolocation, food provider, purchase, WhatsApp message, model or physical device was used.']})
            (artifacts/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(report,ensure_ascii=False,indent=2))
        finally:server.shutdown();server.server_close();thread.join(3)


if __name__=='__main__':main()
