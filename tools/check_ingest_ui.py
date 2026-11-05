"""Offline result-to-viewer journey with actual HTTP, SQLite and generated GLB.

The Modal SDK is substituted by the existing focused fixture. Neither starting
the server nor the browser can dispatch a provider, download weights or use GPU
inference. WebGL may render with software; that is not a device benchmark.
"""
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading

from services.h1.server import Handler,ROOT
from services.spatial.ingest import scene_id_for_job
from services.spatial.media_access import MediaAccess
from tests.test_spatial_ingest import IngestTests


class QuietHandler(Handler):
    def log_message(self,*args):pass


def main():
    fixture=IngestTests('test_completed_object_becomes_actual_scene_library_asset_with_uncertainty')
    fixture.setUp();server=None;thread=None
    try:
        dispatch=fixture.submit();before=fixture.sdk.Function.from_name.call_count
        server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        server.spatial=fixture.spatial;server.spatial_media_access=MediaAccess()
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        result=subprocess.run(['node','tools/check_ingest_ui.cjs'],cwd=ROOT,
            env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}',
                'BRIVANY_INGEST_CAPTURE':fixture.capture,'BRIVANY_INGEST_JOB':dispatch['job_id'],
                'BRIVANY_INGEST_SCENE':scene_id_for_job(dispatch['job_id']),
                'BRIVANY_INGEST_ASSET_SHA256':dispatch['artifact']['sha256']},
            capture_output=True,timeout=130,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        print((result.stdout+result.stderr).decode('utf-8',errors='replace'))
        fixture.assertEqual(fixture.sdk.Function.from_name.call_count,before)
        if result.returncode==0:fixture.assertEqual(fixture.scenes(),1)
        print(json.dumps({'modal_sdk_calls_added_by_ui':0,'external_calls':0,'gpu_inference':False}))
        return result.returncode
    finally:
        if server is not None:server.shutdown();server.server_close()
        if thread is not None:thread.join(3)
        fixture.doCleanups()


if __name__=='__main__':raise SystemExit(main())
