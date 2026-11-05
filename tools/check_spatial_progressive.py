"""Local progressive scene journey. Generated GLBs, no model or cloud calls."""
from contextlib import closing
from http.server import ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from services.h1.server import Handler,ROOT
from services.spatial.jobs import SpatialService
from services.spatial.media_access import MediaAccess
from services.spatial.demo import DEMO_ID

class QuietHandler(Handler):
    def log_message(self,*args):pass

def main():
    with tempfile.TemporaryDirectory(prefix='brivany-progressive-') as temporary,closing(SpatialService(Path(temporary)/'spatial',start_worker=False)) as spatial:
        server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler);server.spatial=spatial;server.spatial_media_access=MediaAccess()
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            result=subprocess.run(['node','tools/check_spatial_progressive.cjs'],cwd=ROOT,
                env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}','BRIVANY_PROGRESSIVE_SCENE':DEMO_ID},capture_output=True,timeout=130,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            print((result.stdout+result.stderr).decode('utf-8',errors='replace'));return result.returncode
        finally:server.shutdown();server.server_close();thread.join(3)

if __name__=='__main__':raise SystemExit(main())
