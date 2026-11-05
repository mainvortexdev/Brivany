"""Portable presentation roundtrip with real folder and native bridge substitute."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit
from zipfile import ZipFile

from desktop.bridge import DesktopBridge,ProjectSession
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler,ROOT
from services.projects import create_project,open_project,export_project
from services.spatial.demo import DEMO_ID
from services.spatial.jobs import SpatialService
from services.spatial.plan_settings import PlanSettingsService,DEFAULT


class FixtureWindow:
    def __init__(self,base):self.base=base
    def get_current_url(self):return self.base+'/spaces'


class FixtureHandler(Handler):
    def do_GET(self):
        if urlsplit(self.path).path=='/__portable-tour/status':
            if not self.local_request():return
            self.send_json(200,{'project':self.server.desktop_projects.current()});return
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path=='/__portable-tour/bridge':
            if not self.local_request():return
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=65536:self.send_json(413,{'ok':False});return
            value=json.loads(self.rfile.read(length));method=value.get('method')
            if method not in {'status','get_presentation','save_presentation','save_open_project'} or not isinstance(value.get('args'),list):
                self.send_json(422,{'ok':False});return
            self.send_json(200,getattr(self.server.fixture_bridge,method)(*value['args']));return
        super().do_POST()


def main():
    with tempfile.TemporaryDirectory(prefix='brivany-portable-plan-') as temporary:
        root=Path(temporary);spatial=SpatialService(root/'application',start_worker=False)
        config=deepcopy(DEFAULT);config['references']=[{'id':'reference-one','points':[[0.,0.],[2.,0.]],
            'measured_m':3.,'method':'tape_measure','note':'Synthetic declared reference'}]
        settings=PlanSettingsService(spatial)
        settings.save(DEMO_ID,{'expected_revision':0,'expected_scene_revision':1,'config':config})
        portable=root/'portable';create_project(spatial,DEMO_ID,portable);session=ProjectSession();session.open(portable)
        try:
            with LocalDesktopServer(handler=FixtureHandler,session=session) as server:
                server.http.spatial=spatial
                def no_source():raise AssertionError('Portable plans must not import application data')
                bridge=DesktopBridge(server.base_url,session,no_source);bridge._bind_window(FixtureWindow(server.base_url));server.http.fixture_bridge=bridge
                result=subprocess.run(['node','tools/check_portable_presentation.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':server.base_url},capture_output=True,timeout=90,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if result.returncode:
                    print((result.stdout+result.stderr).decode('utf-8',errors='replace'));return result.returncode
                path=ROOT/'tmp/portable-presentation/report.json';report=json.loads(path.read_text(encoding='utf-8'))
                saved=open_project(portable);assert saved['revision']==4
                reopened=ProjectSession();reopened.open(portable)
                tour=reopened.presentation(4)
                assert tour['config']['points'][0]['label']=='Vista guardada'
                assert tour['needs_scene_review'] is False
                archive=root/'project-with-tour.zip';export_project(portable,archive)
                with ZipFile(archive) as package:
                    version=json.loads(package.read('versions/revision-000004.json'))
                    assert version['presentation_config']==saved['presentation_config']
                report.update({'portable_reopen_verified':True,'zip_includes_versioned_presentation':True,
                    'native_window_started':False,'external_calls':0,'model_executed':False,
                    'limitations':['Real project folders, GLB, camera and immutable versions; native window/chooser transport substituted.',
                        'No public sharing, reconstructed room, metric accuracy or physical device tested.']})
                path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2));return 0
        finally:spatial.close()


if __name__=='__main__':raise SystemExit(main())
