"""Browser + real desktop bridge, portable folders and loopback HTTP.

Only the pywebview transport and native chooser are substituted. All paths stay
inside this temporary fixture; no private project or native window is opened.
"""
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
from services.projects import open_project
from services.spatial.demo import DEMO_ID
from services.spatial.jobs import SpatialService


class ChooserFixture:
    def __init__(self,base,root,session):
        self.base=base;self.root=root;self.session=session;self.calls=[]
        self.choices=['parent','cancel','cancel','zip','current']

    def get_current_url(self):return self.base+'/spaces'

    def create_file_dialog(self,kind,**options):
        choice=self.choices.pop(0);self.calls.append({'kind':kind,'choice':choice})
        if choice=='cancel':return None
        if choice=='parent':return (str(self.root),)
        if choice=='zip':return (str(self.root/'export.zip'),)
        if choice=='current':return (str(self.root/self.session.current()['project']['folder_name']),)
        raise AssertionError('Unknown test chooser operation')


class FixtureHandler(Handler):
    def do_GET(self):
        if urlsplit(self.path).path=='/__desktop-test/status':
            if not self.local_request():return
            current=self.server.desktop_projects.current()
            archive=self.server.fixture_root/'export.zip'
            names=[]
            if archive.exists():
                with ZipFile(archive) as source:names=source.namelist()
            self.send_json(200,{'current':current,'archive_exists':archive.exists(),'archive_entries':names,
                'chooser_calls':self.server.fixture_chooser.calls})
            return
        super().do_GET()

    def do_POST(self):
        route=urlsplit(self.path).path
        if route in {'/__desktop-test/bridge','/__desktop-test/advance'}:
            if not self.local_request():return
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=32768:self.send_json(400,{'ok':False});return
            value=json.loads(self.rfile.read(length))
            if route.endswith('/advance'):
                current=self.server.desktop_projects.current()
                chair=deepcopy(next(item for item in current['scene']['objects'] if item['id']=='chair')['transform'])
                chair['position'][0]=2.1
                result=self.server.desktop_projects.save(expected_revision=current['revision'],objects=[{'id':'chair','transform':chair}])
                self.send_json(200,{'revision':result['revision']});return
            method=value.get('method');allowed={'status','pick_project_folder','save_current_project','save_open_project','export_open_project','get_presentation','save_presentation'}
            if method not in allowed or not isinstance(value.get('args'),list):self.send_json(400,{'ok':False});return
            result=getattr(self.server.fixture_bridge,method)(*value['args'])
            self.send_json(200,result);return
        super().do_POST()


def main():
    with tempfile.TemporaryDirectory(prefix='brivany-desktop-ui-') as temporary:
        root=Path(temporary);session=ProjectSession();spatial=SpatialService(root/'application',start_worker=False)
        try:
            with LocalDesktopServer(handler=FixtureHandler,session=session) as server:
                server.http.spatial=spatial;server.http.fixture_root=root
                chooser=ChooserFixture(server.base_url,root,session)
                bridge=DesktopBridge(server.base_url,session,lambda:spatial);bridge._bind_window(chooser)
                server.http.fixture_bridge=bridge;server.http.fixture_chooser=chooser
                environment={**os.environ,'BRIVANY_TEST_URL':server.base_url,'BRIVANY_DESKTOP_SCENE':DEMO_ID}
                result=subprocess.run(['node','tools/check_desktop_ui.cjs'],cwd=ROOT,env=environment,
                    capture_output=True,timeout=130,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                print((result.stdout+result.stderr).decode('utf-8',errors='replace'))
                if result.returncode==0:
                    current=session.current();verified=open_project(root/current['project']['folder_name'])
                    assert verified['revision']==3
                    assert next(item for item in verified['scene']['objects'] if item['id']=='chair')['transform']['position'][0]==2.1
                return result.returncode
        finally:spatial.close()


if __name__=='__main__':raise SystemExit(main())
