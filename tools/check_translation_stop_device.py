"""Real Windows output reset with digital silence and a stalled synthetic provider."""
import json
from pathlib import Path
import threading
import time
from types import SimpleNamespace
from packages.providers.native_audio import open_native_audio
from services.work.live_translation import WorkLiveTranslation
from tests.test_work_translation import Route

def main():
    entered=threading.Event();release=threading.Event();outputs=[];report={'passed':False,'scope':'actual_Windows_output_with_zero_PCM_and_stalled_provider_substitute','provider_requests':0,'microphone':False,'user_audio_captured':False,'audibility_tested':False}
    class Blocked:
        def __init__(self,port,mixer_factory):self.output=mixer_factory
        def handle(self,peer):
            output=self.output();outputs.append(output);output.push_translation(bytes(48000));entered.set();release.wait(4)
        def close(self):pass
    owner=WorkLiveTranslation(route_factory=Route,bridge_factory=Blocked,output_factory=lambda **kw:open_native_audio(),configuration=lambda:{'configured':True})
    try:
        owner.start();assert entered.wait(3);time.sleep(.08);began=time.monotonic();state=owner.stop();elapsed=time.monotonic()-began
        report.update(stop_ms=round(elapsed*1000,2),inactive=not state['active'],mixer_closed=outputs[0]._closed,driver_closed=outputs[0].driver.closed,queued_ms=outputs[0].stats()['queued_ms'],provider_still_blocked=not release.is_set())
        assert elapsed<1 and not state['active'] and outputs[0]._closed and outputs[0].driver.closed and all(n==0 for n in report['queued_ms'].values())
        report['passed']=True
    except Exception as error:report['error_type']=type(error).__name__
    finally:
        release.set();owner.close();folder=Path('tmp/translation-stability');folder.mkdir(exist_ok=True);(folder/'device-stop.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
    return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
