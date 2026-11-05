"""Trusted local presentation host. No trading, cloud credentials or public bind."""
import json
from pathlib import Path
import sys
import os
import threading


def main():
    config=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    sys.path.insert(0,config['site_packages']);sys.path.insert(0,config['work'])
    from web.server import app
    from flask import jsonify,request
    from werkzeug.serving import make_server
    @app.before_request
    def local_presentation_only():
        if request.method not in ('GET','HEAD','OPTIONS') or request.path.startswith('/api/') and request.path!='/api/health':
            return jsonify({'success':False,'error':'Vista local de revisión. Las operaciones externas están deshabilitadas.'}),403
    @app.after_request
    def local_response(response):
        response.headers['X-Melodi-Run']=config['id']
        response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        response.headers['Cache-Control']='no-store';return response
    server=make_server('127.0.0.1',config['port'],app,threaded=True)
    # IDE debug sessions may terminate their Node owner abruptly. Keep the
    # preview's lifetime tied to that exact parent, rather than orphaning it.
    if len(sys.argv)>2:
        parent=int(sys.argv[2])
        if parent!=os.getppid():raise ValueError('El propietario de la vista no coincide con su padre.')
        def watch_owner():
            if os.name=='nt':
                import ctypes
                kernel=ctypes.WinDLL('kernel32',use_last_error=True)
                kernel.OpenProcess.argtypes=[ctypes.c_ulong,ctypes.c_bool,ctypes.c_ulong];kernel.OpenProcess.restype=ctypes.c_void_p
                kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_ulong];kernel.CloseHandle.argtypes=[ctypes.c_void_p]
                handle=kernel.OpenProcess(0x00100000,False,parent)
                if handle:
                    try:kernel.WaitForSingleObject(handle,0xffffffff)
                    finally:kernel.CloseHandle(handle)
            else:
                import time
                while True:
                    try:os.kill(parent,0)
                    except ProcessLookupError:break
                    time.sleep(.25)
            server.shutdown()
        threading.Thread(target=watch_owner,daemon=True,name='melodi-ide-owner').start()
    print('MELODI_PREVIEW_READY '+json.dumps({'url':'http://127.0.0.1:'+str(config['port']),'proof':config['id'],'owner_pid':int(sys.argv[2]) if len(sys.argv)>2 else None}),flush=True)
    try:server.serve_forever()
    finally:server.server_close()


if __name__=='__main__':main()
