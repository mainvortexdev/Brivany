"""Actual WebGL views and private camera-route persistence on synthetic geometry."""
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
from services.spatial.jobs import SpatialService
from services.spatial.media_access import MediaAccess
from services.spatial.presentation import PresentationService
from services.spatial.demo import DEMO_ID


def main():
    artifacts=ROOT/'tmp/presentation-ui';artifacts.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brivany-presentation-ui-') as temporary:
        spatial=SpatialService(Path(temporary)/'spatial',start_worker=False)
        before=spatial.scene(DEMO_ID)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.spatial=spatial;server.spatial_media_access=MediaAccess()
        base='http://127.0.0.1:'+str(server.server_port);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connect=socket.create_connection
        def local_only(address,*args,**kwargs):
            if address[0] not in ('127.0.0.1','localhost','::1'):raise AssertionError('External requests forbidden')
            return connect(address,*args,**kwargs)
        try:
            with patch('socket.create_connection',side_effect=local_only):
                result=subprocess.run(['node','tools/check_presentation_ui.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':base},capture_output=True,timeout=100,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:raise RuntimeError((result.stdout+result.stderr).decode('utf-8',errors='replace'))
            after=spatial.scene(DEMO_ID);assert before==after
            reopened=PresentationService(spatial).get(DEMO_ID)
            assert reopened['revision']==3 and reopened['source_scene_revision']==1 and len(reopened['config']['points'])==1
            assert not reopened['shared'] and not reopened['needs_scene_review']
            report=json.loads((artifacts/'report.json').read_text(encoding='utf-8'))
            report.update(checked_at=datetime.now(timezone.utc).isoformat(),external_calls=0,gpu_seconds=0,
                scene_geometry_unchanged=True,persistence_reopened_in_new_service=True,real_reconstruction_verified=False,
                limitations=['Actual loopback HTTP, SQLite, authored camera points, WebGL and shared Spaces viewer on generated synthetic fixtures.',
                    'Software WebGL is permitted. No room capture, physical device, professional measure, public sharing or reconstructed fidelity is verified.'])
            (artifacts/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
        finally:server.shutdown();server.server_close();thread.join(3);spatial.close()


if __name__=='__main__':main()
