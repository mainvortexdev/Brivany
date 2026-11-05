"""Explicit native peak-meter check with a quiet synthetic tone in an owned child."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from desktop.experience.audio_sessions import WindowsSessionMeter
from desktop.experience.music_ducking import MusicDucking
import tempfile


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true',required=True);parser.parse_args()
    if os.name!='nt':raise SystemExit('Este ensayo requiere Windows.')
    child_code="""import io,math,struct,wave,winsound,time
buffer=io.BytesIO()
with wave.open(buffer,'wb') as writer:
 writer.setnchannels(1);writer.setsampwidth(2);writer.setframerate(24000)
 writer.writeframes(b''.join(struct.pack('<h',int(32767*.035*math.sin(2*math.pi*330*i/24000))) for i in range(72000)))
time.sleep(.7)
winsound.PlaySound(buffer.getvalue(),winsound.SND_MEMORY)
"""
    path=Path('tmp/music-ducking-native/report.json');path.parent.mkdir(parents=True,exist_ok=True)
    report={'status':'failed','runtime':'real Windows Core Audio metadata and WinMM synthetic playback','audio_captured':False,'external_calls':0,'provider':'not used','spotify_volume':'substituted callback; SDK gain tested separately','process_paths_saved':False,'tone_seconds':3,'tone_amplitude':.035}
    meter=WindowsSessionMeter(owner_pid=2147483647);own_meter=WindowsSessionMeter(owner_pid=os.getpid())
    child=None
    try:
        with tempfile.TemporaryDirectory(prefix='brivany-ducking-test-') as temporary:
            transitions=[];policy=MusicDucking(Path(temporary)/'settings.json',transitions.append,supported=True)
            child=subprocess.Popen([sys.executable,'-X','utf8','-B','-c',child_code],creationflags=subprocess.CREATE_NO_WINDOW,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            observed=False;own_excluded=True;deadline=time.monotonic()+7
            while time.monotonic()<deadline and child.poll() is None:
                all_rows=meter.read();owned={child.pid}
                for _ in range(8):
                    owned.update(pid for pid,info in meter.processes.items() if info.get('parent') in owned)
                rows=[row for row in all_rows if row['pid'] in owned]
                policy.observe(rows)
                if any(row['peak']>.002 for row in rows):observed=True
                if rows:
                    own_meter.owner_pid=rows[0]['pid']
                    if any(row['pid']==own_meter.owner_pid for row in own_meter.read()):own_excluded=False
                time.sleep(.05)
            child.wait(timeout=5)
            if child.returncode:raise RuntimeError('El generador sintético no pudo reproducir el tono.')
            time.sleep(1.6);policy.observe([]);policy.close()
            report.update(tone_activity_observed=observed,owned_audio_excluded=own_excluded,duck_then_restore=transitions==[True,False])
            assert observed and own_excluded and transitions==[True,False], 'El medidor no confirmó el recorrido esperado.'
            report['status']='passed'
    finally:
        if child and child.poll() is None:child.terminate();child.wait(timeout=5)
        own_meter.close();meter.close();path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
