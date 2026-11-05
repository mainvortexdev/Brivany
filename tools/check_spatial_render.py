"""Actual local renderer and Rapier integration with synthetic image references."""
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from PIL import Image

from services.h1.server import Handler, ROOT
from services.spatial.jobs import SpatialService
from services.spatial.media_access import MediaAccess
from services.spatial.references import ReferenceSetService


def main():
    with tempfile.TemporaryDirectory(prefix='brivany-render-') as temporary:
        folder=Path(temporary);paths=[]
        for index,color in enumerate(((160,120,80),(90,110,130))):
            path=folder/f'reference-{index}.png';Image.new('RGB',(160,120),color).save(path);paths.append(path)
        service=SpatialService(folder/'spatial')
        references=ReferenceSetService(service.root).create(paths,title='Referencias sintéticas de prueba')
        result=service.create_reference_interpretation(references['id'],'Interior · prueba de render')
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.spatial=service;server.spatial_media_access=MediaAccess()
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            environment={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}',
                         'BRIVANY_RENDER_SCENE':result['space']['id']}
            process=subprocess.run(['node','tools/check_spatial_render.cjs'],cwd=ROOT,env=environment,
                capture_output=True,timeout=140,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            print((process.stdout+process.stderr).decode('utf-8',errors='replace'));return process.returncode
        finally:
            server.shutdown();server.server_close();thread.join(3);service.close()


if __name__=='__main__':raise SystemExit(main())
