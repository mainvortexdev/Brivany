"""Sustained WorkSpace pacing with local provider substitutes and optional WASAPI."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import threading
import time
from unittest.mock import patch
from tests.test_river_translation import PipelineTests
from packages.providers.river_translation import RiverBridge
from services.work.live_translation import WorkLiveTranslation,CapturePeer
from services.work.system_translation_audio import SystemAudioRoute


class SyntheticRoute:
    source='synthetic';output='substituted'
    def reduce_original(self,gain):self.gain=gain
    def packets(self,stopped):
        sequence=0
        while not stopped.wait(.08):yield sequence,bytes(3840);sequence+=1
    def close(self):pass


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--hardware',action='store_true');args=parser.parse_args()
    fixture=PipelineTests('test_invalid_pcm_stops_session_before_translation');owner=None
    report={'type':'actual_local_Muse_Meta_Cartesia_transports_with_substituted_providers','capture':'WASAPI_render' if args.hardware else 'synthetic','output':'substituted','microphone_used':False,'PCM_or_transcript_persisted':False,'external_calls':0,'billing_amount':0,'passed':False,'injected_scheduler_stalls':[],'pause_events':0,'resume_events':0}
    class DelayedPeer(CapturePeer):
        def __init__(self,owner):super().__init__(owner);self.count=0;self.injected=set()
        def recv(self,timeout=8):
            stalls={8:.36,18:.36,32:1.2,48:.11,100:.29,180:.7,250:.36}
            if self.count in stalls and self.count not in self.injected:
                self.injected.add(self.count);delay=stalls[self.count];report['injected_scheduler_stalls'].append(delay);self.owner.stopped.wait(delay)
            raw=super().recv(timeout)
            if isinstance(raw,bytes):self.count+=1
            return raw
        def send(self,raw):
            event=json.loads(raw)
            if event.get('type')=='flow-control':report['pause_events' if event.get('paused') else 'resume_events']+=1
            return super().send(raw)
    fixture.setUp();fixture.pause_batch=True;fixture.slow=True;fixture.expect_diarization=True
    try:
        with patch('services.work.live_translation.CapturePeer',DelayedPeer):
            owner=WorkLiveTranslation(route_factory=SystemAudioRoute if args.hardware else SyntheticRoute,output_factory=lambda **kw:fixture.mixer_factory(),bridge_factory=lambda port,**kw:RiverBridge(port,**kw))
            owner.start('fr','auto');start=time.monotonic();deadline=start+35
            while time.monotonic()<deadline:
                state=owner.status()
                if state['state']=='error':raise ValueError(state['error'])
                time.sleep(.1)
            report['elapsed_seconds']=round(time.monotonic()-start,2)
            state=owner.status();report['session']={k:v for k,v in state.items() if k not in {'caption'}}
            report['provider_connections']=fixture.counts;report['native_output_substitute_received_audio']=fixture.audio_seen.is_set()
            if state['submitted_seconds']<28 or report['pause_events'] or report['resume_events'] or len(report['injected_scheduler_stalls'])<6:raise ValueError('The sustained continuous-input test stalled or paused ASR')
            report['passed']=state['active'] and fixture.audio_seen.is_set()
    except Exception as error:report['error']=str(error)[:300]
    finally:
        if owner:
            owner.close();report['stopped']=not owner.status()['active'];report['capture_thread_stopped']=not bool(owner.capture and owner.capture.is_alive())
        fixture.tearDown();report['checked_at']=datetime.now(timezone.utc).isoformat()
        folder=Path('tmp/workspace-translation-pacing');folder.mkdir(exist_ok=True);path=folder/('report-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2));print('Informe: '+str(path))
    return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
