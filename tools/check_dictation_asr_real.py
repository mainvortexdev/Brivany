"""Explicit real Muse trial with own synthesized fixture, never a physical mic."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from unittest.mock import patch
from desktop.launcher import LocalDesktopServer
from desktop.experience.launcher import experience_handler
from services.h1.server import Handler

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-network',action='store_true');args=parser.parse_args()
    if not args.allow_network:parser.error('This test opens one real Muse ASR session; use --allow-network.')
    folder=ROOT/'tmp/dictation-capture';folder.mkdir(exist_ok=True);wav=folder/'own-synthetic-fixture.wav'
    # Windows' installed offline voice produces only this fixed test phrase.
    script="Add-Type -AssemblyName System.Speech; $brivanySpeaker=New-Object System.Speech.Synthesis.SpeechSynthesizer; $brivanyVoice=$brivanySpeaker.GetInstalledVoices() | Where-Object {$_.VoiceInfo.Culture.Name.StartsWith('es')} | Select-Object -First 1; if ($brivanyVoice) {$brivanySpeaker.SelectVoice($brivanyVoice.VoiceInfo.Name)}; $brivanySpeaker.SetOutputToWaveFile('"+str(wav).replace("'","''")+"'); $brivanySpeaker.Speak('Esta es una prueba del micrófono. El mensaje se puede revisar antes de enviar.'); $brivanySpeaker.Dispose()"
    subprocess.run(['powershell','-NoProfile','-NonInteractive','-Command',script],check=True,capture_output=True,timeout=20,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    with LocalDesktopServer(handler=experience_handler(Handler),live=True) as server:
        from websockets.sync.client import connect
        diagnostics={'attempts':0}
        def observed_connect(*a,**k):
            diagnostics['attempts']+=1
            try:return connect(*a,**k)
            except Exception as exc:
                diagnostics.update(exception_type=type(exc).__name__,http_status=getattr(getattr(exc,'response',None),'status_code',None),errno=getattr(exc,'errno',None))
                raise
        env={**os.environ,'BRIVANY_TEST_URL':server.base_url,'BRIVANY_TEST_WAV':str(wav),'BRIVANY_PLAYWRIGHT_PATH':str(ROOT/'motion-studio/node_modules/playwright-core')}
        with patch('websockets.sync.client.connect',observed_connect):
            result=subprocess.run(['node','tools/check_dictation_asr_real.cjs'],env=env,cwd=ROOT,timeout=60)
        (folder/'connection-diagnostics.json').write_text(json.dumps(diagnostics,indent=2),encoding='utf-8');print(json.dumps(diagnostics));return result.returncode


if __name__=='__main__':raise SystemExit(main())
