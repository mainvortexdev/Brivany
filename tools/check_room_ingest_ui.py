"""Local room result-to-viewer journey, with substituted Modal/model output."""
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
import unittest

from services.h1.server import Handler,ROOT
from services.spatial.media_access import MediaAccess
from services.spatial.room_ingest import scene_id_for_room
from tests.test_spatial_room_ingest import room_fixture


class QuietHandler(Handler):
    def log_message(self,*args):pass


def main():
    holder=unittest.TestCase();fixture=room_fixture(holder);server=None;thread=None
    try:
        dispatch=fixture.submit();before=fixture.function.spawn.call_count
        server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        server.spatial=fixture.spatial;server.spatial_media_access=MediaAccess()
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        result=subprocess.run(['node','tools/check_room_ingest_ui.cjs'],cwd=ROOT,
            env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}',
                'BRIVANY_ROOM_CAPTURE':fixture.capture,'BRIVANY_ROOM_JOB':dispatch['job_id'],
                'BRIVANY_ROOM_SCENE':scene_id_for_room(dispatch['job_id']),
                'BRIVANY_ROOM_ASSET_SHA256':dispatch['artifact']['sha256']},
            capture_output=True,timeout=130,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        print((result.stdout+result.stderr).decode('utf-8',errors='replace'))
        holder.assertEqual(fixture.function.spawn.call_count,before)
        if result.returncode==0:
            with fixture.spatial._connect() as db:holder.assertEqual(db.execute('SELECT count(*) FROM scenes').fetchone()[0],1)
        print(json.dumps({'modal_sdk_calls_added_by_ui':0,'external_calls':0,'gpu_inference':False}))
        return result.returncode
    finally:
        if server is not None:server.shutdown();server.server_close()
        if thread is not None:thread.join(3)
        holder.doCleanups()


if __name__=='__main__':raise SystemExit(main())
