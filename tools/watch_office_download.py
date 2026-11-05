"""Follow the already-running Microsoft worker after its old parent timed out."""
import argparse
import ctypes
from ctypes import wintypes
from datetime import datetime,timezone
import json
from pathlib import Path
import time
from services.computer.runtime import ROOT
from services.terminal.executor import TerminalExecutor
from services.terminal.office import OfficeInstaller


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--pid',type=int,required=True);parser.add_argument('--prepared',required=True);parser.add_argument('--then-install',action='store_true');args=parser.parse_args()
    executor=TerminalExecutor(ROOT/'.local/terminal');installer=OfficeInstaller(executor)
    import uuid
    if str(uuid.UUID(args.prepared))!=args.prepared:raise ValueError('Prepared ID inválido')
    path=installer.root/(args.prepared+'.json');prepared=json.loads(path.read_text(encoding='utf-8'))
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.QueryFullProcessImageNameW.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD)];kernel.QueryFullProcessImageNameW.restype=wintypes.BOOL
    kernel.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)];kernel.GetExitCodeProcess.restype=wintypes.BOOL
    kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];kernel.WaitForSingleObject.restype=wintypes.DWORD
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    handle=kernel.OpenProcess(0x1000|0x100000,False,args.pid)
    if not handle:raise ctypes.WinError(ctypes.get_last_error())
    report={'type':'follow_existing_office_worker','worker_pid':args.pid,'prepared_id':args.prepared,'started_at':datetime.now(timezone.utc).isoformat(),'success':False}
    try:
        name=ctypes.create_unicode_buffer(32768);length=wintypes.DWORD(len(name))
        if not kernel.QueryFullProcessImageNameW(handle,0,name,ctypes.byref(length)) or Path(name.value).resolve()!=Path(prepared['setup']).resolve():raise ValueError('Worker image does not match the verified Microsoft installer.')
        host=Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
        receipt=executor.run('office.verify_existing_worker',str(host),['-NoProfile','-NonInteractive','-Command',f"(Get-CimInstance Win32_Process -Filter 'ProcessId={args.pid}').CommandLine"],cwd=installer.root,timeout=15)
        if receipt['exit_code']!=0 or 'RELAUNCHED /download '+prepared['configuration'] not in receipt['output']:raise ValueError('Worker arguments do not match this prepared download.')
        prepared['state']='download_waiting_owned_worker';installer.save(prepared)
        print('Worker verificado; se conserva la descarga existente.',flush=True)
        deadline=time.monotonic()+3600
        while time.monotonic()<deadline:
            result=kernel.WaitForSingleObject(handle,5000)
            if result==0:break
            if result!=258:raise OSError('No se pudo observar el proceso de Microsoft.')
        else:raise TimeoutError('El worker sigue sin confirmar su finalización; no se reinició.')
        code=wintypes.DWORD()
        if not kernel.GetExitCodeProcess(handle,ctypes.byref(code)):raise ctypes.WinError(ctypes.get_last_error())
        report['worker_exit_code']=code.value;prepared['worker_exit_code']=code.value
        prepared['state']='downloaded' if code.value==0 else 'download_failed';installer.save(prepared)
        if code.value!=0:raise ValueError('Microsoft worker returned '+str(code.value))
        report['success']=True
        print('Descarga completada por el worker de Microsoft.',flush=True)
        if args.then_install:
            report['installation']=installer.install(prepared)
            print(json.dumps(report['installation'],ensure_ascii=False),flush=True)
    except Exception as error:report['error']=str(error);raise
    finally:
        kernel.CloseHandle(handle)
        folder=ROOT/'tmp/office-video-review';folder.mkdir(exist_ok=True)
        (folder/'worker-followup.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':main()
