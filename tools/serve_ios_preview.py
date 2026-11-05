"""Local iPhone design preview with an authenticated account proxy.

The browser receives profile/device/job data, never a session or provider key.
Only loopback Host/Origin and an explicit same-origin header can mutate state.
"""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import select
import socket
import threading
from uuid import uuid4
from services.brivany_account import AccountHTTP,SecureAccountFile,AccountFailure

ROOT=Path(__file__).resolve().parents[1]


class PreviewAccount:
    def __init__(self):
        self.http=AccountHTTP();self.store=SecureAccountFile(ROOT/'.local/mobile-accounts/preview-session.dpapi');self.lock=threading.RLock()
        try:self.session=self.store.load()
        except Exception:self.session=None
        file=ROOT/'.local/mobile-accounts/preview-device.json';file.parent.mkdir(parents=True,exist_ok=True)
        if file.exists():self.device=json.loads(file.read_text())['id']
        else:self.device=str(uuid4());file.write_text(json.dumps({'id':self.device}),encoding='utf-8')
    def token(self):
        with self.lock:return (self.session or {}).get('session',{}).get('token')
    def status(self):
        token=self.token()
        if not token:return {'signed_in':False,'devices':[]}
        value=self.http.call('/v1/account/me',token=token);return {'signed_in':True,'account':value['account'],'devices':value['devices']}
    def login(self,email,password):
        value=self.http.call('/v1/account/login',{'email':email,'password':password,'device_id':self.device,'device_name':'iPhone · vista de prueba','platform':'preview','kind':'mobile'})
        self.store.save(value)
        with self.lock:self.session=value
        return self.status()
    def logout(self):
        token=self.token()
        if token:
            try:self.http.call('/v1/account/logout',{},token)
            except AccountFailure:pass
        with self.lock:self.session=None
        self.store.clear();return self.status()


def make_handler(account):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'ios/preview/dist'),**kwargs)
        def log_message(self,*args):pass
        def trusted(self,mutation=False):
            origin='http://127.0.0.1:'+str(self.server.server_port)
            return self.headers.get('Host')=='127.0.0.1:'+str(self.server.server_port) and self.headers.get('Origin',origin)==origin and (not mutation or self.headers.get('X-Brivany-Preview')=='1')
        def send_json(self,status,value):
            raw=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
        def list_directory(self,path):self.send_error(404);return None
        def do_GET(self):
            if not self.trusted():self.send_error(403);return
            if not self.path.startswith('/api/'):
                return super().do_GET()
            try:
                if self.path=='/api/account':return self.send_json(200,account.status())
                if self.path.startswith('/api/commands/'):
                    identifier=self.path.removeprefix('/api/commands/')
                    if not account.token() or not all(c in '0123456789abcdef-' for c in identifier) or len(identifier)!=36:raise AccountFailure('Inicia sesión.')
                    return self.send_json(200,account.http.call('/v1/commands/'+identifier,token=account.token()))
                self.send_error(404)
            except AccountFailure as exc:self.send_json(503,{'error':str(exc)})
        def do_POST(self):
            if not self.trusted(True):self.send_error(403);return
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=65536 or self.headers.get_content_type()!='application/json' or self.headers.get('Transfer-Encoding'):raise ValueError()
                body=json.loads(self.rfile.read(length))
                if self.path=='/api/account/login':return self.send_json(200,account.login(body['email'],body['password']))
                if self.path=='/api/account/logout':return self.send_json(200,account.logout())
                if not account.token():return self.send_json(401,{'error':'Inicia sesión en Brivany.'})
                if self.path=='/api/commands/select':return self.send_json(200,account.http.call('/v1/commands/select',body,account.token()))
                if self.path=='/api/chat':
                    messages=body.get('messages');source=body.get('source','chat')
                    if not isinstance(messages,list) or not 0<len(messages)<=20 or source not in ('chat','voice'):raise ValueError()
                    self.send_response(200);self.send_header('Content-Type','application/x-ndjson; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Connection','close');self.end_headers();self.close_connection=True
                    cancelled=threading.Event();finished=threading.Event()
                    def monitor():
                        while not finished.wait(.1):
                            try:
                                readable,_,_=select.select([self.connection],[],[],0)
                                if readable and not self.connection.recv(1,socket.MSG_PEEK):cancelled.set();return
                            except OSError:cancelled.set();return
                    threading.Thread(target=monitor,daemon=True).start()
                    try:
                        for event in account.http.chat(messages,account.token(),source=source,cancelled=cancelled,conversation_id=body.get('conversation_id')):self.wfile.write((json.dumps(event,ensure_ascii=False)+'\n').encode());self.wfile.flush()
                    except AccountFailure:
                        if not cancelled.is_set():self.wfile.write(b'{"type":"error","message":"No se pudo completar la solicitud."}\n')
                    finally:finished.set()
                    return
                self.send_error(404)
            except (ValueError,KeyError,TypeError):self.send_json(422,{'error':'Revisa los datos de la solicitud.'})
            except AccountFailure as exc:self.send_json(503,{'error':str(exc)})
            except (BrokenPipeError,ConnectionResetError):return
    return Handler


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8788);args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),make_handler(PreviewAccount()))
    print('Vista de iPhone: http://127.0.0.1:'+str(server.server_port)+'/',flush=True)
    try:server.serve_forever()
    finally:server.server_close()

if __name__=='__main__':main()
