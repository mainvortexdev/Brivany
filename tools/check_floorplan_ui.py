"""Actual local plan geometry/UI with generated GLB and synthetic references."""
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from PIL import Image
from services.h1.server import Handler,ROOT
from services.spatial.jobs import SpatialService
from services.spatial.media_access import MediaAccess
from services.spatial.references import ReferenceSetService


def main():
    with tempfile.TemporaryDirectory(prefix='brivany-floorplan-ui-') as temporary:
        root=Path(temporary);service=SpatialService(root/'spatial');paths=[]
        for index,color in enumerate(((80,100,120),(150,130,100))):
            path=root/f'reference-{index}.png';Image.new('RGB',(80,60),color).save(path);paths.append(path)
        references=ReferenceSetService(service.root).create(paths,title='Synthetic reference set')
        interior=service.create_reference_interpretation(references['id'],'Interior · plano de prueba')
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.spatial=service;server.spatial_media_access=MediaAccess()
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            result=subprocess.run(['node','tools/check_floorplan_ui.cjs'],cwd=ROOT,
                env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}',
                     'BRIVANY_PLAN_INTERIOR':interior['space']['id']},capture_output=True,timeout=140,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            print((result.stdout+result.stderr).decode('utf-8',errors='replace'));return result.returncode
        finally:server.shutdown();server.server_close();thread.join(3);service.close()


if __name__=='__main__':raise SystemExit(main())
