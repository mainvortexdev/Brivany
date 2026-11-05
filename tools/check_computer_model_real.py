"""Bounded real Meta model/chat overlap, synthetic text only, no microphone."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from unittest.mock import patch
from urllib.request import Request,urlopen,build_opener
from uuid import uuid4

from desktop.experience.launcher import experience_handler
from desktop.launcher import LocalDesktopServer
from services.h1.server import load_local_config
from services.computer.service import ComputerService
from services.computer.planner import MetaPlanner
from services.computer.backend import child_environment
from services.spatial.jobs import SpatialService
from packages.providers.live_voice import NoRedirect
from tools.check_computer_ui import FixtureHandler

ROOT=Path(__file__).resolve().parents[1]


class TrackedResponse:
    def __init__(self,response,finish):self.response=response;self.finish=finish
    def __getattr__(self,name):return getattr(self.response,name)
    def __iter__(self):return iter(self.response)
    def __enter__(self):return self
    def __exit__(self,*args):self.close()
    def close(self):
        try:self.response.close()
        finally:
            if self.finish:finish,self.finish=self.finish,None;finish()


class Transport:
    def __init__(self):
        self.base=build_opener(NoRedirect());self.lock=threading.RLock();self.entered=threading.Event();self.release=threading.Event();self.stop=threading.Event()
        self.roles=[];self.responses=0;self.active={};self.overlap=False;self.current=None;self.chat_started_while_model_active=False
    def open(self,request,**kwargs):
        if request.full_url!='https://api.meta.ai/v1/chat/completions':raise ValueError('Endpoint fuera de la prueba.')
        body=json.loads(request.data);stream=body.get('stream') is True
        role='conversation' if stream else 'model' if 'modeladora conceptual' in body['messages'][0]['content'] else 'router'
        if role=='model':
            self.entered.set()
            if not self.release.wait(15):raise ValueError('No comenzó la conversación dentro de la ventana de prueba.')
        if stream:
            self.chat_started_while_model_active=any(j['kind']=='model' and j['state'] in {'queued','planning','running'} for j in self.current.jobs.values())
            self.release.set()
        with self.lock:
            if self.stop.is_set() or len(self.roles)>=5:raise ValueError('La prueba no iniciará más solicitudes.')
            self.roles.append(role);self.active[role]=self.active.get(role,0)+1
            if self.active.get('model') and self.active.get('conversation'):self.overlap=True
        def finish():
            with self.lock:self.active[role]-=1
        try:
            response=self.base.open(request,**kwargs)
            with self.lock:self.responses+=1
            return TrackedResponse(response,finish)
        except Exception:finish();raise


def render_existing(workspace):
    workspace=workspace.resolve();directory=ROOT/'tmp/computer-model-real'
    if workspace.parent!=directory.resolve() or not workspace.name.startswith('fixture-'):raise ValueError('Usa sólo una fixture previa de esta herramienta.')
    spatial=SpatialService(workspace/'spatial',start_worker=False,seed_demo=False)
    with LocalDesktopServer(handler=experience_handler(FixtureHandler)) as server:
        server.http.spatial=spatial;server.http.computer_lock=threading.RLock()
        current=ComputerService(server.base_url,lambda:spatial,root=workspace/'computer',native=True);server.http.computer=current
        try:
            scene=next(j['result']['scene_id'] for j in current.jobs.values() if j['kind']=='model' and j['state']=='succeeded')
            env=child_environment();env.update(BRIVANY_TEST_URL=server.base_url,BRIVANY_MODEL_SCENE=scene)
            if os.environ.get('BRIVANY_PLAYWRIGHT_PATH'):env['BRIVANY_PLAYWRIGHT_PATH']=os.environ['BRIVANY_PLAYWRIGHT_PATH']
            result=subprocess.run(['node','tools/check_computer_model_render.cjs'],cwd=ROOT,env=env,timeout=100)
            return result.returncode
        finally:current.close();spatial.close()


def main():
    parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group(required=True);mode.add_argument('--allow-paid',action='store_true');mode.add_argument('--render-existing',type=Path);args=parser.parse_args()
    if args.render_existing:return render_existing(args.render_existing)
    load_local_config()
    directory=ROOT/'tmp/computer-model-real';directory.mkdir(parents=True,exist_ok=True);workspace=directory/('fixture-'+uuid4().hex[:8]);workspace.mkdir()
    report={'scope':'real Meta routing, conceptual plan and streamed conversation; real local GLBs and renderer','checks':[],
        'physical_microphone_verified':False,'physical_audio_verified':False,'speech_providers_used':False,'cost_amount':None,'model_start_gate':'fixture waits for conversation stream before sending model request'}
    transport=Transport();spatial=SpatialService(workspace/'spatial',start_worker=False,seed_demo=False)
    with LocalDesktopServer(handler=experience_handler(FixtureHandler)) as server:
        server.http.spatial=spatial;server.http.computer_lock=threading.RLock()
        current=ComputerService(server.base_url,lambda:spatial,root=workspace/'computer',planner=MetaPlanner(opener=transport),native=True);server.http.computer=current;transport.current=current
        token=current.arm()['token']
        def no_desktop(*args,**kwargs):raise ValueError('Esta fixture sólo permite modelos y conversación, sin entrada nativa.')
        current.runtime.call=no_desktop
        def turn(text):
            request=Request(server.base_url+'/api/computer/turn',method='POST',headers={'Origin':server.base_url,'Content-Type':'application/json','X-Brivany-Control':token},data=json.dumps({'text':text,'consent':True,'language':'es','history':[]}).encode())
            with urlopen(request,timeout=50) as response:return [json.loads(line) for line in response.read().decode().splitlines() if line.strip()]
        try:
            with patch('packages.providers.conversation.build_opener',return_value=transport):
                events=turn('Crea un modelo conceptual 3D de una mesa redonda de madera clara, con un tablero cilíndrico de diámetro 1.2, grosor 0.08 y centro Y=0.75. Usa cuatro patas de 0.71 de alto, centros Y=0.355 en X/Z ±0.35. Cinco piezas en total; no añadas suelo ni decoración.')
                job=next(e['job'] for e in events if e.get('type')=='computer_task');assert job['kind']=='model';assert transport.entered.wait(10)
                reply=turn('Explícame en una sola frase qué significa que un modelo 3D sea conceptual.')
                assert any(e.get('type')=='sentence' for e in reply) and reply[-1]['type']=='done' and not any(e.get('type')=='computer_task' for e in reply)
            assert transport.chat_started_while_model_active and transport.overlap
            report['checks'].append('real conversation streamed while the real model request was in flight')
            deadline=time.monotonic()+70
            while time.monotonic()<deadline:
                actual=current.jobs[job['id']]
                if actual['state'] not in {'queued','planning','running'}:break
                time.sleep(.2)
            report['model_state']=actual['state']
            if actual['state']!='succeeded':raise ValueError('El modelo no terminó con éxito.')
            model=actual['result'];scene=spatial.scene(model['scene_id'])['scene'];assert len(scene['objects'])==5
            plan=json.loads((spatial.root/'scenes'/model['scene_id']/'model-plan.json').read_text(encoding='utf-8'))
            top=[o for o in plan['objects'] if o['type']=='cylinder' and abs(o['size'][0]-1.2)<.01 and abs(o['size'][1]-.08)<.01 and abs(o['size'][2]-1.2)<.01 and abs(o['position'][1]-.75)<.01]
            assert len(top)==1 and scene['units']=='source_relative' and scene['origin']=='generated_demo'
            legs=[o for o in plan['objects'] if o is not top[0]]
            assert len(legs)==4 and all(abs(o['size'][1]-.71)<.01 and abs(o['position'][1]-.355)<.01 for o in legs)
            assert {(round(o['position'][0],2),round(o['position'][2],2)) for o in legs}=={(-.35,-.35),(-.35,.35),(.35,-.35),(.35,.35)}
            report['checks'].append('requested round tabletop and five conceptual pieces published as valid GLBs')
            report.update(object_count=5,round_top_nominal_dimensions_match=True,source_mode=current.runtime.availability()['source_mode'])
            env=child_environment();env.update(BRIVANY_TEST_URL=server.base_url,BRIVANY_MODEL_SCENE=model['scene_id'])
            if os.environ.get('BRIVANY_PLAYWRIGHT_PATH'):env['BRIVANY_PLAYWRIGHT_PATH']=os.environ['BRIVANY_PLAYWRIGHT_PATH']
            rendered=subprocess.run(['node','tools/check_computer_model_render.cjs'],cwd=ROOT,env=env,capture_output=True,text=True,encoding='utf-8',timeout=100)
            if rendered.returncode:raise ValueError('Falló la comprobación del visor: '+rendered.stderr[-700:])
            report['render']=json.loads((directory/'render-report.json').read_text(encoding='utf-8'));report['status']='passed'
        except Exception as error:report.update(status='failed',failure=str(error))
        finally:
            transport.stop.set();current.close();transport.release.set()
            report.update(provider_requests_initiated=len(transport.roles),provider_responses_opened=transport.responses,provider_request_roles=transport.roles,request_limit=5,provider_overlap_observed=transport.overlap)
            (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            spatial.close()
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
