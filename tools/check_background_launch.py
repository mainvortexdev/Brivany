"""Actual isolated application launch without cursor guard or focus changes."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import ctypes
import json
import os
from pathlib import Path
import subprocess
import threading
from uuid import uuid4
from services.computer.runtime import NativeRuntime,ROOT

class Select(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        value=json.loads(self.rfile.read(int(self.headers['Content-Length'])));data=json.loads(value['input']);matches=[c for c in data['candidates'] if c['name']==self.server.label]
        assert len(matches)==1
        raw=json.dumps({'text':json.dumps({'id':matches[0]['id'],'certain':True})}).encode();self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)

def main():
    folder=ROOT/'tmp/background-launch'/uuid4().hex;folder.mkdir(parents=True);label='Melodi prueba '+uuid4().hex[:8];link=Path(os.environ['APPDATA'])/'Microsoft/Windows/Start Menu/Programs'/(label+'.lnk');marker=folder/'started.txt';exe=folder/'OwnedLaunch.exe';source=folder/'OwnedLaunch.cs'
    source.write_text('using System;using System.IO;using System.Threading;class A{static void Main(string[] a){File.WriteAllText(a[0],"started");Thread.Sleep(30000);}}',encoding='utf-8')
    compiler=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe';child_pid=None
    report={'passed':False,'scope':'owned_exe_and_temporary_start_menu_shortcut_native_execution','provider_calls':0,'user_files_modified':False};server=ThreadingHTTPServer(('127.0.0.1',0),Select);server.label=label;threading.Thread(target=server.serve_forever,daemon=True).start();runtime=NativeRuntime(folder/'workspace',proxy='http://127.0.0.1:'+str(server.server_port),token='own-'+uuid4().hex)
    try:
        subprocess.run([str(compiler),'/nologo','/target:winexe','/out:'+str(exe),str(source)],check=True,capture_output=True,timeout=20)
        script="$link=(New-Object -ComObject WScript.Shell).CreateShortcut($env:OWN_LINK);$link.TargetPath=$env:OWN_EXE;$link.Arguments='\"'+$env:OWN_MARKER+'\"';$link.Save()"
        subprocess.run(['powershell','-NoProfile','-Command',script],env={**os.environ,'OWN_LINK':str(link),'OWN_EXE':str(exe),'OWN_MARKER':str(marker)},capture_output=True,check=True,timeout=12)
        user=ctypes.WinDLL('user32');user.GetForegroundWindow.restype=ctypes.c_void_p
        start=runtime.call('begin_task',background=True,timeout=25);before=user.GetForegroundWindow();result=runtime.call('execute',step={'action':'launch_app','params':{'app':label}},timeout=35);child_pid=result.get('process_id');runtime.call('end_task',timeout=5)
        import time
        deadline=time.monotonic()+3
        while not marker.is_file() and time.monotonic()<deadline:time.sleep(.05)
        report.update(marker_created=marker.is_file(),background_result=result,foreground_preserved=user.GetForegroundWindow()==before,start=start)
        assert marker.is_file() and result['background'] and result['input_sent'] is False and start['escape_reserved'] is False,'Application did not confirm background execution'
        assert user.GetForegroundWindow()==before,'Foreground changed'
        report.update(passed=True,application_started=True,foreground_preserved=True,cursor_guard_started=False,background_method=result['method'])
    except Exception as error:report['error']=repr(error)[:300]
    finally:
        runtime.close();server.shutdown()
        if child_pid:
            subprocess.run(['powershell','-NoProfile','-Command',"$p=Get-Process -Id $env:OWN_PID -ErrorAction SilentlyContinue;if($p -and $p.Path -eq $env:OWN_EXE){Stop-Process -Id $p.Id -Force}"],env={**os.environ,'OWN_PID':str(child_pid),'OWN_EXE':str(exe)},capture_output=True,timeout=8)
        if link.is_file():link.unlink() # Exactly the new UUID-named shortcut created above.
        (ROOT/'tmp/background-launch/report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
    return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
