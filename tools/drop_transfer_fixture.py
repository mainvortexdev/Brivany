"""Synthetic native bridge for browser/runtime tests; envelopes stay on stdio."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import queue
import sys
import tempfile
import threading
import tracemalloc
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from uuid import uuid4
from desktop.experience.workspace_files import FileShelf,WorkspaceFilesBridge
from desktop.experience.workspace_phone import WorkspacePhoneBridge
from desktop.experience.drop_transfer import OfficialDrop
from desktop.experience.drop_http import handle as binary_http
from desktop.experience.ui_session import DesktopUISession

class Vault:
    def read(self):return {'issuer_token':'synthetic-issuer'}

def main():
    lock=threading.Lock();network={};latest={};maximum=0;methods={}
    def send(value):
        with lock:print(json.dumps(value,ensure_ascii=True),flush=True)
    def request(method,identifier,**values):
        token=uuid4().hex;response=queue.Queue();network[token]=response;send({'network':{'id':token,'method':method,'identifier':identifier,**values}})
        try:
            value=response.get(timeout=20)
            if value.get('status',500)>=400 and value.get('status')!=410:raise ValueError('Test network rejected the request.')
            return value.get('value',{})
        finally:network.pop(token,None)
    with tempfile.TemporaryDirectory(prefix='brivany-drop-fixture-') as directory:
        root=Path(directory);size=1024 if '--small' in sys.argv else 1024**3 if '--gib' in sys.argv else 16*1024**2;path=root/'Archivo de prueba.bin'
        with path.open('wb') as stream:
            stream.truncate(size)
            for offset in range(0,size,1024**2):stream.seek(offset);stream.write(offset.to_bytes(8,'little'))
            stream.seek(size-4);stream.write(b'END!')
        with path.open('rb') as stream:expected=hashlib.file_digest(stream,'sha256').hexdigest()
        shelf=FileShelf();source_id=shelf.add_path(path)
        class Bridge(WorkspacePhoneBridge,WorkspaceFilesBridge):
            def _trusted(self):pass
            def _publish_files(self):return shelf.snapshot()
        bridge=Bridge();bridge._workspace_file_shelf=shelf
        def publish(value):latest.clear();latest.update(value);send({'event':value})
        if '--real' in sys.argv:
            from services.private_store import PrivateStore
            vault=PrivateStore(Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data/.local/phone/official.dpapi')
            bridge._workspace_file_transfer=OfficialDrop(root/'private',vault=vault,publish=publish,receive_folder=root/'received')
        else:bridge._workspace_file_transfer=OfficialDrop(root/'private',vault=Vault(),publish=publish,request=request,receive_folder=root/'received')
        original_read=bridge._workspace_file_transfer.read_raw
        def raw_read(*args):
            nonlocal maximum
            maximum=max(maximum,args[-1]);return original_read(*args)
        bridge._workspace_file_transfer.read_raw=raw_read
        ui_session=DesktopUISession(set())
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def workspace_preferences_access(self):
                hosts={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
                if self.headers.get('Host') not in hosts or self.headers.get('Origin') not in (None,*(f'http://{h}' for h in hosts)) or not ui_session.authorized(self):self.reject_before_body(403,'ui_session','Untrusted fixture request.');return False
                return True
            def send_bytes(self,status,data,mime):
                self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
            def send_json(self,status,value):self.send_bytes(status,json.dumps(value).encode(),'application/json')
            def error(self,status,code,message):self.send_json(status,{'error':{'code':code,'message':message}})
            def reject_before_body(self,status,code,message):self.close_connection=True;self.error(status,code,message)
            def do_GET(self):
                if not binary_http(self,'GET'):self.error(404,'missing','Test route not found.')
            def do_POST(self):
                if not binary_http(self,'POST'):self.error(404,'missing','Test route not found.')
        http=ThreadingHTTPServer(('127.0.0.1',0),Handler);http.daemon_threads=True;http.desktop_bridge=bridge;threading.Thread(target=http.serve_forever,daemon=True).start()
        for name in dir(bridge):
            if name.startswith(('workspace_phone_','workspace_files_')):methods[name]=getattr(bridge,name)
        tracemalloc.start();send({'ready':True,'bytes':size,'sha256':expected,'files':shelf.snapshot(),'source':source_id,'origin':f'http://127.0.0.1:{http.server_port}','ui_secret':ui_session.secret})
        def invoke(command):
            nonlocal maximum
            try:
                if command['method']=='report':
                    receiver=[]
                    for file in (root/'received').glob('*'):
                        if file.is_file() and not file.name.startswith('.'):
                            with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
                            receiver.append({'name':file.name,'bytes':file.stat().st_size,'sha256':digest})
                    value={'received':receiver,'python_peak_traced_bytes':tracemalloc.get_traced_memory()[1],'max_read_bytes':maximum}
                else:
                    if command['method']=='workspace_phone_read':maximum=max(maximum,command['args'][-1])
                    value=methods[command['method']](*command.get('args',[]))
                send({'id':command['id'],'value':value})
            except Exception as error:send({'id':command['id'],'error':type(error).__name__+': '+str(error)})
        with ThreadPoolExecutor(max_workers=4) as pool:
            for line in sys.stdin:
                command=json.loads(line)
                if command.get('network_reply'):
                    target=network.get(command['network_reply'])
                    if target:target.put(command)
                else:pool.submit(invoke,command)
        http.shutdown();http.server_close();bridge._close_workspace_phone();shelf.close();tracemalloc.stop()

if __name__=='__main__':main()
