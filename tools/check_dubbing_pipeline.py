"""Run the real local dubbing stack against a simulated upstream; no paid calls."""
import base64
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import threading
from unittest.mock import patch

from websockets.sync.server import serve
from packages.providers.palabra import PalabraBridge
from services.h1.server import Handler, ROOT


def ensure_fixture(path):
    if path.is_file(): return
    executable=shutil.which('ffmpeg')
    if not executable: raise RuntimeError('FFmpeg is required for the synthetic fixture.')
    path.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run([executable,'-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0xdadce0:s=640x360:r=10',
        '-f','lavfi','-i','sine=frequency=240:sample_rate=24000','-t','4','-c:v','libx264','-pix_fmt','yuv420p',
        '-c:a','aac','-movflags','+faststart','-n',str(path)],check=True,capture_output=True,timeout=15,
        creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))


def main():
    import sys
    timing = "--timing" in sys.argv
    ensure_fixture(ROOT/'tmp/dubbing-test/synthetic-video.mp4')
    pcm=b''.join(struct.pack('<h',round(math.sin(i*.08)*2500)) for i in range(2400))
    received={'pcm_packets':0,'pcm_bytes':0,'nonzero_pcm':False,'session_close_messages':0,'connections':0}
    provider_errors=[]
    def upstream(ws):
        try:
            received['connections']+=1
            if ws.request.headers.get('Authorization')!='Bearer local-dubbing-simulation-not-a-real-key':
                raise AssertionError('The local simulation credential was not used.')
            update=json.loads(ws.recv(timeout=5))
            if update.get('message_type')!='set_task' or update['data']['pipeline']['translations'][0]['target_language']!='es' or update['data']['pipeline']['transcription']['source_language']!='en':
                raise AssertionError('The expected translation configuration was not sent.')
            ws.send(json.dumps({'message_type':'task_status','data':{'command':'set_task','event':'started','task_status':'running'}}))
            query=json.loads(ws.recv(timeout=5))
            if query!={'message_type':'get_task','data':{'exclude_hidden':True}}: raise AssertionError('Expected effective settings query.')
            ws.send(json.dumps({'message_type':'current_task','data':update['data']}))
            for raw in ws:
                event=json.loads(raw)
                if event['message_type']=='input_audio_data':
                    data=base64.b64decode(event['data']['data'],validate=True)
                    received['pcm_packets']+=1;received['pcm_bytes']+=len(data)
                    received['nonzero_pcm']|=any(data)
                    if not data or len(data)%2 or len(data)>3840 or len(event['data']['data'])<1024: raise AssertionError('Invalid PCM frame.')
                    if received['pcm_packets']==1:
                        ws.send(json.dumps({'message_type':'output_audio_data','data':{'data':base64.b64encode(pcm).decode(),'chunk_generation_delta':95,
                            'transcription_id':'initial','translation_part_id':'0','last_chunk':True}}))
                        ws.send(json.dumps({'message_type':'translated_transcription','data':{'transcription':{'transcription_id':'initial','translation_part_id':0,'text':'Prueba simulada',
                            'segments':[{'start':0,'end':.08}]}}}))
                elif event['message_type']=='end_task':
                    received['session_close_messages']+=1
                    ws.send(json.dumps({'message_type':'output_audio_data','data':{'data':base64.b64encode(pcm).decode(),'chunk_generation_delta':100,
                        'transcription_id':'tail','translation_part_id':'0','last_chunk':True}}))
                    ws.send(json.dumps({'message_type':'translated_transcription','data':{'transcription':{'transcription_id':'tail','translation_part_id':0,'text':'cierre',
                        'segments':[{'start':.1,'end':.2}]}}}))
                    ws.send(json.dumps({'message_type':'end_of_stream','data':{}}));return
                else: raise AssertionError('An unsupported upstream event was sent.')
        except Exception as error:
            provider_errors.append(type(error).__name__)
            raise
    with serve(upstream,'127.0.0.1',0,compression=None) as fake:
        thread=threading.Thread(target=fake.serve_forever,daemon=True);thread.start()
        endpoint=f'ws://127.0.0.1:{fake.socket.getsockname()[1]}'
        from packages.providers.palabra import dubbing_status
        def simulated_status(): return {**dubbing_status(), "simulation_only": True}
        with patch.dict(os.environ,{'BRIVANY_PALABRA_API_KEY':'local-dubbing-simulation-not-a-real-key'}), patch('packages.providers.palabra.URL',endpoint), patch('services.h1.server.dubbing_status',simulated_status):
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
            bridge=PalabraBridge(server.server_port).start();server.translation_bridge=bridge
            http_thread=threading.Thread(target=server.serve_forever,daemon=True);http_thread.start()
            try:
                environment={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}'}
                command=['node','tools/measure_dubbing_browser.cjs','--simulated'] if timing else ['node','tools/check_dubbing_pipeline.cjs']
                if timing and '--two-clauses' in sys.argv: command.append('--two-clauses')
                result=subprocess.run(command,cwd=ROOT,env=environment,
                    capture_output=True,timeout=35,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                output=(result.stdout+result.stderr).decode('utf-8',errors='replace')
                if result.returncode: raise RuntimeError('Dubbing browser pipeline failed:\n'+output)
                if provider_errors or received['connections']!=1 or received['session_close_messages']!=1 or received['pcm_packets']<2 or not received['nonzero_pcm']:
                    raise AssertionError('The real local PCM and finish path was not completed.')
                report=json.loads(result.stdout.decode('utf-8')) if timing else json.loads((ROOT/'tmp/ui/dubbing-pipeline-browser.json').read_text(encoding='utf-8'))
                report.update({'checked_at':datetime.now(timezone.utc).isoformat(),'provider':'Palabra','provider_received':received,
                    'limitations':[*report.get('limitations',[]),'Loopback upstream simulation only; no translation model, inference latency, bilingual quality, or physical device was evaluated.']})
                (ROOT/('tmp/ui/dubbing-browser-timing.json' if timing else 'tmp/ui/dubbing-pipeline.json')).write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
                print(json.dumps(report,indent=2,ensure_ascii=False))
            finally:
                server.shutdown();server.server_close();http_thread.join(3);bridge.close()


if __name__=='__main__': main()
