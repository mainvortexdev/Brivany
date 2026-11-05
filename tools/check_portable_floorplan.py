"""Actual portable folder/GLB/plan/JS bridge with only pywebview substituted."""
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
        if urlsplit(self.path).path=='/__portable-plan/status':
            if not self.local_request():return
            self.send_json(200,{'project':self.server.desktop_projects.current()});return
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path=='/__portable-plan/bridge':
            if not self.local_request():return
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=65536:self.send_json(413,{'ok':False});return
            value=json.loads(self.rfile.read(length));method=value.get('method')
            if method not in {'status','get_floorplan','save_floorplan','save_open_project','get_presentation','save_presentation'} or not isinstance(value.get('args'),list):
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
                result=subprocess.run(['node','tools/check_portable_floorplan.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':server.base_url},capture_output=True,timeout=90,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if result.returncode:
                    print((result.stdout+result.stderr).decode('utf-8',errors='replace'));return result.returncode
                path=ROOT/'tmp/portable-floorplan/report.json';report=json.loads(path.read_text(encoding='utf-8'))
                saved=open_project(portable);assert saved['revision']==5
                reopened=ProjectSession();reopened.open(portable)
                assert abs(reopened.floorplan(5)['scale']['meters_per_unit']-report['final_fitted_meters_per_unit'])<1e-12
                assert len(saved['plan_config']['references'])==report['final_reference_count']==2
                archive=root/'project-with-plan.zip';export_project(portable,archive)
                with ZipFile(archive) as package:
                    assert json.loads(package.read('versions/revision-000005.json'))['plan_config']==saved['plan_config']
                report.update({'portable_reopen_verified':True,'zip_includes_versioned_plan':True,
                    'native_window_started':False,'external_calls':0,'model_executed':False,'metric_scale_verified':False,
                    'limitations':['Read-only bridge transport and portable save use actual files; pywebview is substituted.',
                        'Synthetic geometry and measurement declarations do not certify architectural accuracy or a native picker.']})
                path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2));return 0
        finally:spatial.close()


if __name__=='__main__':raise SystemExit(main())
