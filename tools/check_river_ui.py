"""Real UI, capture graph and provider protocols with synthetic local substitutes."""
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
from unittest.mock import patch
from services.h1.server import Handler, ROOT
from tests.test_river_translation import PipelineTests
from tools.check_dubbing_pipeline import ensure_fixture


def main():
    fixture=ROOT/'tmp/dubbing-test/synthetic-video.mp4';ensure_fixture(fixture)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    scenario=PipelineTests();scenario.origin_port=server.server_port;scenario.setUp()
    scenario.pause_batch=True;scenario.slow=True
    server.river_bridge=scenario.bridge
    def status():
        from packages.providers.river_translation import river_status
        result=river_status();result['native_output']['available']=True;return result
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        with patch('services.h1.server.river_status',status):
            result=subprocess.run(['node','tools/check_river_ui.cjs'],cwd=ROOT,
                env={**os.environ,'BRIVANY_TEST_URL':f'http://127.0.0.1:{server.server_port}','BRIVANY_TEST_VIDEO':str(fixture)},
                capture_output=True,timeout=55,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        output=(result.stdout+result.stderr).decode('utf-8',errors='replace');print(output)
        if result.returncode:
            print(json.dumps({'substituted_provider_counts':scenario.counts}))
            raise RuntimeError('UI verification failed; see output above.')
        report=ROOT/'tmp/river-ui/browser.json';data=json.loads(report.read_text(encoding='utf-8'))
        data['upstream_counts']=scenario.counts;data['all_mixers_closed']=all(m.closed for m in scenario.mixers)
        if scenario.counts['muse']!=3 or scenario.counts['cartesia']!=3 or scenario.counts['meta']!=9 or not data['all_mixers_closed']:
            raise AssertionError('Expected three explicit synthetic sessions (tab and local file twice), with released output.')
        report.write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
    finally:
        server.shutdown();server.server_close();thread.join(2);scenario.tearDown()


if __name__=='__main__':main()
