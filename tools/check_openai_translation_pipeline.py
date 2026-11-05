"""Actual UI/HTTP/WS against a loopback-only OpenAI translation simulation."""
import base64
import hashlib
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
import json
import math
import os
import struct
import subprocess
import threading
from unittest.mock import patch

from websockets.sync.server import serve
from packages.providers.dubbing import TranslationBridge, dubbing_status
from services.h1.server import Handler, ROOT


def main():
    import sys
    reject_review='--reject-review' in sys.argv
    review='--review-synthetic' in sys.argv or reject_review
    received={"connections":0,"pcm_packets":0,"pcm_bytes":0,"close_messages":0}
    failures=[]
    # A coalesced 2.640208 s delta used to exceed the browser's 1 s queue.
    pcm=b''.join(struct.pack('<h',round(math.sin(i*.08)*2500)) for i in range(63365))
    def upstream(ws):
        try:
            received["connections"]+=1
            if ws.request.headers.get('Authorization')!='Bearer local-openai-translation-simulation-key':
                raise AssertionError('The simulation credential was not isolated.')
            ws.send(json.dumps({'type':'session.created'}))
            update=json.loads(ws.recv(timeout=5))
            if update.get('type')!='session.update' or update['session']['audio']['output']['language']!='es':
                raise AssertionError('The translation language was not configured.')
            ws.send(json.dumps({'type':'session.updated'}))
            for raw in ws:
                event=json.loads(raw)
                if event['type']=='session.input_audio_buffer.append':
                    data=base64.b64decode(event['audio'],validate=True)
                    if not data or len(data)%2 or len(data)>9600:raise AssertionError('Invalid PCM frame.')
                    received['pcm_packets']+=1;received['pcm_bytes']+=len(data)
                    if received['pcm_packets']==1:
                        # Same alignment value across events is legitimate.
                        for value in [
                            {'type':'session.output_audio.delta','event_id':'audio-1','elapsed_ms':200,'delta':base64.b64encode(pcm).decode()},
                            {'type':'session.output_transcript.delta','event_id':'text-1','elapsed_ms':200,'delta':'https://example.invalid/review-test' if reject_review else 'Prueba simulada '},
                        ]:ws.send(json.dumps(value))
                elif event['type']=='session.close':
                    received['close_messages']+=1
                    ws.send(json.dumps({'type':'session.output_audio.delta','event_id':'audio-tail','delta':base64.b64encode(pcm[:3840]).decode()}))
                    ws.send(json.dumps({'type':'session.output_transcript.delta','event_id':'text-tail','delta':'con cierre.'}))
                    ws.send(json.dumps({'type':'session.closed'}));return
                else:raise AssertionError('Unexpected translation control.')
        except Exception as error:
            failures.append(type(error).__name__);raise
    with serve(upstream,'127.0.0.1',0,compression=None) as fake:
        threading.Thread(target=fake.serve_forever,daemon=True).start()
        endpoint=f'ws://127.0.0.1:{fake.socket.getsockname()[1]}'
        def simulated_status():return {**dubbing_status(),'simulation_only':True}
        with patch.dict(os.environ,{'BRIVANY_OPENAI_API_KEY':'local-openai-translation-simulation-key'}), \
             patch('packages.providers.dubbing.URL',endpoint), \
             patch('services.h1.server.openai_translation_status',simulated_status):
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
            bridge=TranslationBridge(server.server_port).start();server.openai_translation_bridge=bridge
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                command=['node','tools/measure_dubbing_browser.cjs','--simulated','--provider','openai','--two-clauses']
                if review:command.append('--review-synthetic')
                process=subprocess.run(command,
                    cwd=ROOT,env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}'},capture_output=True,
                    timeout=35,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if process.returncode and not reject_review:raise RuntimeError('The local OpenAI UI pipeline failed:\n'+process.stdout.decode('utf-8',errors='replace'))
                if failures or received['connections']!=1 or received['close_messages']!=1 or received['pcm_packets']<2:
                    raise AssertionError('The bounded simulated session did not complete.')
                report=json.loads(process.stdout.decode('utf-8'))
                if reject_review:
                    if (process.returncode!=1 or report['status']!='passed' or report['synthetic_review']['status']!='unavailable' or
                        received['pcm_bytes']!=report['timing']['source']['frames']*2):
                        raise AssertionError('The rejected review interrupted the independent functional session.')
                    report['review_rejection_checked']=True
                    report['functional_input_and_close_preserved']=True
                elif review:
                    collected=report['synthetic_review'];receipt=collected['review']
                    if (collected['status']!='saved' or not collected['byte_integrity_verified'] or
                        not collected['received_and_scheduled_pcm_bytes_match'] or
                        receipt['output_pcm_sha256']!=hashlib.sha256(pcm+pcm[:3840]).hexdigest() or
                        receipt['output_pcm_bytes']!=len(pcm)+3840):
                        raise AssertionError('The synthetic output was not retained byte for byte.')
                    trace=report['timing']['scheduled_buffer_trace']
                    if report['timing']['trace_truncated'] or sum(item['frames'] for item in trace)*2!=receipt['output_pcm_bytes']:
                        raise AssertionError('Scheduled buffer trace is incomplete.')
                report.update({'checked_at':datetime.now(timezone.utc).isoformat(),'provider_received':received,
                    'coalesced_pcm_bytes':len(pcm),'provider_model_evaluated':False})
                report['limitations'].append('The upstream is a local protocol stub: no OpenAI model, access, billing, quality or provider latency was evaluated.')
                path=ROOT/('tmp/ui/openai-synthetic-review-rejection.json' if reject_review else 'tmp/ui/openai-synthetic-review-pipeline.json' if review else 'tmp/ui/openai-translation-pipeline.json')
                path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
                print(json.dumps(report,ensure_ascii=False,indent=2))
            finally:
                server.shutdown();server.server_close();thread.join(3);bridge.close()


if __name__=='__main__':main()
