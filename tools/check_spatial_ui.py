"""Serve the actual spatial UI and SQLite service in a disposable loopback app."""
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from services.h1.server import Handler,ROOT
from services.spatial.jobs import SpatialService
from services.spatial.media_access import MediaAccess


def main():
    fixture=ROOT/'tmp/spatial-ui/synthetic-room.mp4'
    fixture.parent.mkdir(parents=True,exist_ok=True)
    if not fixture.is_file():
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=10',
            '-t','3','-c:v','libx264','-pix_fmt','yuv420p','-an','-n',str(fixture)],check=True,capture_output=True,timeout=20,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    with tempfile.TemporaryDirectory(prefix='brivany-spatial-ui-') as directory:
        service=SpatialService(Path(directory)/'spatial')
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        server.spatial=service;server.spatial_media_access=MediaAccess()
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            result=subprocess.run(['node','tools/check_spatial_ui.cjs'],cwd=ROOT,
                env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}','BRIVANY_TEST_VIDEO':str(fixture)},
                capture_output=True,timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            output=(result.stdout+result.stderr).decode('utf-8',errors='replace')
            print(output)
            return result.returncode
        finally:
            server.shutdown();server.server_close();thread.join(3);service.close()


if __name__=='__main__':raise SystemExit(main())
