"""Focused local request latency; no model, account, microphone or GPU calls."""
from datetime import datetime,timezone
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import statistics
import tempfile
import threading
import time

from services.h1.server import ROOT,Handler
from services.personal_notes import PersonalNotesService
from services.spatial.jobs import SpatialService,DEMO_ID
from services.spatial.assistant import SpatialAssistantService


def main():
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'scope':'Actual loopback HTTP and SQLite against temporary generated fixtures. Server roundtrip only, excluding UI paint, network to a remote device, real providers and physical audio.','external_calls':0,'model_inferences':0,'gpu_seconds':0,'samples_per_operation':10,'operations':{}}
    with tempfile.TemporaryDirectory(prefix='brivany-request-latency-') as temporary:
        folder=Path(temporary);spatial=SpatialService(folder/'spatial',start_worker=False)
        personal=PersonalNotesService(folder/'personal');server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        server.spatial=spatial;server.spatial_assistant=SpatialAssistantService(spatial,configured=lambda:False);server.personal_notes=personal
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        operations={
            'focus_saved_object':('/api/spatial/assistant/command',lambda i:{'scene_id':DEMO_ID,'expected_revision':1,'object_id':None,'text':'enfoca la mesa'}),
            'save_local_reminder':('/api/personal/reminders',lambda i:{'text':'Aviso sintético '+str(i),'at':'2026-10-31T10:00:00-04:00','channel':'local'}),
            'save_private_note':('/api/personal/notes',lambda i:{'expected_revision':0,'title':'Nota sintética '+str(i),'body':'Prueba local sin datos privados.'}),
        }
        try:
            for name,(route,payload) in operations.items():
                durations=[]
                for i in range(10):
                    connection=HTTPConnection('127.0.0.1',server.server_port,timeout=5);raw=json.dumps(payload(i)).encode();start=time.perf_counter()
                    connection.request('POST',route,raw,{'Origin':base,'Content-Type':'application/json'})
                    response=connection.getresponse();data=response.read();elapsed=(time.perf_counter()-start)*1000;connection.close()
                    if response.status not in (200,201) or not json.loads(data):raise AssertionError('Local operation failed')
                    durations.append(round(elapsed,3))
                report['operations'][name]={'samples_ms':durations,'median_ms':round(statistics.median(durations),3),'max_ms':max(durations)}
        finally:server.shutdown();server.server_close();thread.join(3);personal.close();spatial.close()
    target=ROOT/'tmp/request-latency-local.json';target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
