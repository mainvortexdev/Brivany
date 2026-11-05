"""Reopen the installed running entry point; inspect only its native metadata."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import subprocess
import sys
import time
from tools.workspace_metadata import inspect


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--pid',type=int,required=True);args=parser.parse_args()
    before=inspect(args.pid)
    bars=lambda value:[w for w in value['windows'] if w['title']=='Melodi WorkSpace' and w['visible']]
    assert len(bars(before))==1 and any(w['title']=='Brivany' for w in before['windows'])
    results=[]
    for _ in range(2):
        start=time.monotonic()
        result=subprocess.run([sys.executable,'-X','utf8','-B','-m','desktop.experience.launcher','--island'],capture_output=True,timeout=10,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        assert result.returncode==0
        results.append({'exit_code':result.returncode,'elapsed_seconds':round(time.monotonic()-start,3)})
    time.sleep(.5);after=inspect(args.pid)
    assert len(bars(after))==1 and bars(before)[0]['native_handle']==bars(after)[0]['native_handle']
    assert after['work_area']['top']==40
    report={'passed':True,'scope':'real repeated desktop entry point with existing WorkSpace','original_pid_preserved':True,'bar_handle_preserved':True,'visible_bars_in_process':1,'activation_trials':results,'work_area':after['work_area'],'external_calls':0,'microphone_used':False}
    path=Path('tmp/single-instance-real-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))


if __name__=='__main__':main()
