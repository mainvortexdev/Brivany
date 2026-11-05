"""Real local HTTP/GLB UI, synthetic native bridge, planner and chat; no inference."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import sys
from datetime import datetime,timedelta,timezone
from urllib.parse import urlsplit
from desktop.experience.launcher import experience_handler
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler
from services.computer.service import ComputerService
from services.spatial.jobs import SpatialService
from tests.test_computer_control import Runtime,Planner

ROOT=Path(__file__).resolve().parents[1]


class UIPlanner(Planner):
    def route(self,value,cancelled=None):
        return {'kind':{'fixture motion':'motion','fixture terminal':'terminal','fixture media':'media','fixture soporte':'support','fixture edición':'edits','fixture habilidad':'skill','fixture espera':'schedule'}.get(value.text,'model' if value.text in {'fixture modelo','fixture plano'} else 'document' if value.text=='fixture documento' else 'chat'),'goal':value.text,'representation':'plan' if value.text=='fixture plano' else '3d'}
    def generate(self,prompt,data,**kwargs):
        if 'Mira las imágenes' in prompt:
            assert kwargs.get('images');return {'message':'Veo la referencia sintética adjunta.'}
        if 'agente de redacción' in prompt:return {'title':'Documento sintético','body':'Borrador sintético de prueba.\nNo enviado.'}
        if 'Prepara una espera de Melodi' in prompt:return {'when':{'type':'at','at':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()},'actions':[{'type':'task','kind':'edits','goal':'Fixture: exportar video sintético'},{'type':'drive_upload','folder_name':'Fixture'},{'type':'whatsapp_self_link'}]}
        if 'coordinador de capacidades de Melodi' in prompt:return {'operation':'select','id':'practice'}
        if 'editora de video de Brivany' in prompt:
            count=len(data['completed'])
            return {'tool':'sequence_duplicate','arguments':{'id':'original','name':'Fixture copia'}} if count==0 else {'tool':'clip_update','arguments':{'id':'clip-copy','patch':{'contrast':1.08}}} if count==1 else {'done':True}
        return super().generate(prompt,data,**kwargs)


class FixtureHandler(Handler):
    def do_GET(self):
        if self.path=='/__computer-test/status' and getattr(self.server,'access_fixture',False):
            self.send_json(200,{**self.server.computer.status(),'native_calls':[method for method,args in self.server.computer.runtime.calls]});return
        super().do_GET()
    def do_POST(self):
        if self.path in {'/__computer-test/access-mode','/__computer-test/file-decision','/__computer-test/file-prepare'} and getattr(self.server,'access_fixture',False):
            value=json.loads(self.rfile.read(int(self.headers['Content-Length'])));computer=self.server.computer
            if self.path.endswith('access-mode'):result=computer.configure_access(value['mode'])
            elif self.path.endswith('file-decision'):result={'job':computer.approve_file_action(value['id'],value['approval'],value['accepted'])}
            else:
                action=value['action'];source='C:/Users/usuario/Documentos/Presentación Brivany/Documento de muestra para revisar.txt'
                params={'path':source} if action=='delete_file' else {'source':source,'destination':'C:/Users/usuario/Documentos/Presentación Brivany/Versión de destino.txt'}
                computer.planner.generate=lambda p,d,**k:{'done':True} if d.get('completed_steps') else {'done':False,'step':{'action':action,'params':params}}
                token=computer.arm()['token'];result=computer.enqueue('desktop','Fixture de aprobación '+action,token)
            self.send_json(200,result);return
        if urlsplit(self.path).path=='/__computer-test/arm':
            if not self.local_request():return
            self.send_json(200,{'ok':True,**self.server.computer.arm()});return
        super().do_POST()


class TerminalFixture:
    def run(self,*args,**kwargs):
        return {'title':'Proyecto sintético listo','verified':True,'message':'Evidencia sintética para probar la interfaz.',
                'capture':{'path':'fixture.png','verified':True},'notes':{'path':'fixture.txt','verified':True},'evidence_folder':'fixture'}
    def close(self):pass


class MediaFixture:
    def __init__(self,*args):self.executor=TerminalFixture()
    def run(self,*args,**kwargs):return {'title':'Audio listo','message':'Archivo sintético guardado.','path':'fixture.wav','verified':True}


class SupportFixture:
    def __init__(self,*args):
        from types import SimpleNamespace
        self.drivers=SimpleNamespace(executor=TerminalFixture())
    def run(self,*args,**kwargs):return {'title':'Documentación','message':'Respuesta sintética con fuente oficial.','sources':[{'title':'Manual · página 94','url':'https://files.support.epson.com/docid/cpd6/cpd60186.pdf#page=94'}],'verified':True}


class MotionFixture:
    def __init__(self,root):self.root=Path(root)
    def run(self,*args,identifier,**kwargs):
        import shutil
        source=Path(os.environ['BRIVANY_MOTION_TEST_FILE']) if os.environ.get('BRIVANY_MOTION_TEST_FILE') else sorted((ROOT/'Exports').glob('Brivany-promos-*/01-A-tu-ritmo.mp4'))[-1]
        folder=self.root/identifier;folder.mkdir(parents=True);path=folder/'Brivany.mp4';shutil.copyfile(source,path)
        return {'verified':True,'title':'Animación de prueba','path':str(path),'width':1920,'height':1080,'fps':30,'duration':24,'message':'Fixture de interfaz; motor y planificador sustituidos.'}
    def close(self):pass


def main():
    with tempfile.TemporaryDirectory(prefix='brivany-computer-ui-') as temp:
        spatial=SpatialService(Path(temp)/'spatial',start_worker=False,seed_demo=False)
        with LocalDesktopServer(handler=experience_handler(FixtureHandler)) as server:
            server.http.spatial=spatial;server.http.computer_lock=threading.RLock()
            from tests.test_edits_mcp import EditorFixture
            editor=EditorFixture()
            server.http.access_fixture='--access' in sys.argv
            if server.http.access_fixture:
                from tests.test_computer_access import FileRuntime
            computer=ComputerService(server.base_url,lambda:spatial,root=Path(temp)/'computer',runtime=FileRuntime() if server.http.access_fixture else Runtime(),planner=UIPlanner(),native=True,edits_factory=lambda:editor)
            computer.terminal=TerminalFixture()
            if '--media' in sys.argv:computer.media_factory=MediaFixture;computer.support_factory=SupportFixture
            if '--motion' in sys.argv:computer.motion_factory=MotionFixture
            computer.event_delivery=lambda *args:(_ for _ in ()).throw(AssertionError('External delivery disabled in UI fixtures'))
            computer.chat=lambda value,cancelled:iter([{'type':'delta','text':'Podemos seguir hablando.'},{'type':'sentence','text':'Podemos seguir hablando.'},{'type':'done','text':'Podemos seguir hablando.','await_user':True}])
            server.http.computer=computer
            env={**os.environ,'BRIVANY_TEST_URL':server.base_url}
            env.setdefault('BRIVANY_PLAYWRIGHT_PATH',str(ROOT/'motion-studio/node_modules/playwright-core'))
            script='tools/check_computer_access_ui.cjs' if '--access' in sys.argv else 'tools/check_media_ui.cjs' if '--media' in sys.argv else 'tools/check_terminal_ui.cjs' if '--terminal' in sys.argv else 'tools/check_island_ui.cjs' if '--island' in sys.argv else 'tools/check_work_events_ui.cjs' if '--work-events' in sys.argv else 'tools/check_computer_images_agents_ui.cjs' if '--images-agents' in sys.argv else 'tools/check_computer_ui.cjs'
            if '--motion' in sys.argv:script='tools/check_motion_ui.cjs'
            if '--workspace-chat' in sys.argv:script='tools/check_workspace_chat.cjs'
            if '--workspace-translation' in sys.argv:script='tools/check_workspace_translation_ui.cjs'
            if '--workspace-agents' in sys.argv:script='tools/check_workspace_agents_ui.cjs'
            if '--workspace-results' in sys.argv:script='tools/check_workspace_results_ui.cjs'
            try:return subprocess.run(['node',script],cwd=ROOT,env=env,timeout=150).returncode
            finally:computer.close()


if __name__=='__main__':raise SystemExit(main())
