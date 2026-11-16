"""Exercise the installed private restart, preserving the real local profile."""
import json
import os
from pathlib import Path
import subprocess
import time
from desktop.management import launch,request,process_identity,data_folder

ROOT=Path(__file__).resolve().parents[1]

def ready(previous=None,timeout=45):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            value=request()
            if value.get('ready') and value.get('pid')!=previous:return value
        except Exception:pass
        time.sleep(.25)
    raise ValueError('Brivany no confirmó un arranque nuevo mediante su control privado.')

def main():
    launch(True);before=ready();old_identity=process_identity(before['pid']);history_file=data_folder()/'.local/logs/startup-last.json'
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        if history_file.exists():
            history=json.loads(history_file.read_text(encoding='utf-8'))
            if history.get('healthy'):break
        time.sleep(.2)
    else:raise ValueError('El primer arranque no confirmó el chat.')
    executable=Path(os.environ['LOCALAPPDATA'])/'Programs/Brivany/Brivany.exe'
    process=subprocess.Popen([str(executable),'--restart','--island'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if process.wait(timeout=25)!=0:raise ValueError('El comando integrado de reinicio no terminó correctamente.')
    after=ready(before['pid']);deadline=time.monotonic()+20
    old_modified=history_file.stat().st_mtime_ns
    while time.monotonic()<deadline:
        updated=json.loads(history_file.read_text(encoding='utf-8'))
        if updated.get('healthy') and updated.get('chat',{}).get('history_count')==history.get('chat',{}).get('history_count') and updated.get('chat',{}).get('chat_messages')==history.get('chat',{}).get('chat_messages'):break
        time.sleep(.2)
    else:raise ValueError('El chat no se conservó tras el reinicio.')
    report={'passed':True,'mode':'installed_private_management_and_builtin_restart_command','old_pid':before['pid'],'new_pid':after['pid'],'old_process_exited':process_identity(before['pid']) is None,'new_instance_ready':after['ready'],'workspace':after['workspace'],'history_count':updated['chat']['history_count'],'message_count':updated['chat']['chat_messages'],'healthy':updated['healthy'],'forced_termination':False,'credential_printed':False}
    if not report['old_process_exited']:raise ValueError('La instancia anterior no terminó.')
    (ROOT/'tmp/installed-restart-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':main()
