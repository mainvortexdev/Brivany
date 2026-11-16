"""One-use loopback form for an ephemeral Netelip REGISTER test. Never dials/saves secrets."""
from http.server import BaseHTTPRequestHandler,HTTPServer
import json
import os
from pathlib import Path
import queue
import re
import secrets
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs

from services.telephony.sip_engine import config

PAGE=b'''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comprobar Netelip</title><h1>Comprobar registro SIP</h1><form method="post" autocomplete="off">
<p><label>Usuario SIP <input name="username" required autocomplete="off"></label></p>
<p><label>Clave SIP <input name="password" type="password" required autocomplete="off"></label></p>
<p><label>Servidor SIP <input name="server" required></label></p>
<button>Comprobar registro</button></form><p>Prueba temporal sin llamadas ni almacenamiento de la clave.</p></html>'''


def probe(value):
    settings=config({**value,'port':5060,'transport':'udp','register':True,'allow':[]})
    environment={name:value for name,value in os.environ.items()
                 if not name.startswith(('BRIVANY_META','BRIVANY_MUSE','BRIVANY_CARTESIA'))}
    process=subprocess.Popen([sys.executable,'-X','utf8','-B','-m','services.telephony.sip_engine'],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',
        env=environment,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    events=queue.Queue()
    def read():
        for line in process.stdout:
            try:events.put(json.loads(line))
            except ValueError:pass
    reader=threading.Thread(target=read,daemon=True);reader.start()
    result={'mode':'real_netelip_registration_only','registered':False,'calls_placed':0,
            'credentials_saved':False,'ai_requests':0,'billed_amount':'unknown'}
    try:
        process.stdin.write(json.dumps(settings)+'\n');process.stdin.flush()
        settings['password']='';value['password']=''
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            try:event=events.get(timeout=.25)
            except queue.Empty:
                if process.poll() is not None:break
                continue
            if event.get('type')=='registration':
                result.update(registered=event['state']=='registered',sip_status=event['sip_status'])
                break
            if event.get('type')=='error':
                result['error']=event.get('code');break
        else:result['error']='registration_timeout'
    finally:
        try:
            if process.poll() is None:
                process.stdin.write('{"type":"stop"}\n');process.stdin.flush()
            process.wait(8)
        except (OSError,ValueError,subprocess.TimeoutExpired):
            process.kill();process.wait(3)
        process.stdin.close();process.stdout.close();reader.join(1)
    return result


def main():
    path='/'+secrets.token_urlsafe(32);finished=threading.Event()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def send(self,code,body):
            self.send_response(code)
            for key,value in {'Content-Type':'text/html; charset=utf-8','Content-Length':str(len(body)),
                'Cache-Control':'no-store','Referrer-Policy':'same-origin',
                'Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}.items():
                self.send_header(key,value)
            self.end_headers();self.wfile.write(body)
        def do_GET(self):
            expected='127.0.0.1:'+str(self.server.server_port)
            self.send(200,PAGE) if self.path==path and self.headers.get('Host')==expected else self.send(404,b'')
        def do_POST(self):
            host='127.0.0.1:'+str(self.server.server_port)
            length=self.headers.get('Content-Length','')
            if (self.path!=path or self.headers.get('Host')!=host or self.headers.get('Origin')!='http://'+host
                    or self.headers.get_content_type()!='application/x-www-form-urlencoded'
                    or self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length',[]))!=1
                    or not re.fullmatch(r'[0-9]{1,4}',length) or int(length)>4096 or finished.is_set()):
                self.send(403,b'');return
            try:
                parsed=parse_qs(self.rfile.read(int(length)).decode('utf-8'),strict_parsing=True,max_num_fields=3)
                if set(parsed)!={'server','username','password'} or any(len(item)!=1 for item in parsed.values()):raise ValueError()
                values={key:value[0].strip() for key,value in parsed.items()}
                if not re.fullmatch(r'[a-z0-9-]+\.netelip\.com',values['server']):raise ValueError()
                result=probe(values)
                output=Path('tmp/verification/netelip-sip-registration-20261107.json')
                output.parent.mkdir(parents=True,exist_ok=True)
                output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
                print(json.dumps(result),flush=True)
                self.send(200,b'<title>Registro SIP comprobado</title><p>Registro SIP confirmado. La prueba temporal ha terminado.</p>' if result['registered']
                          else b'<title>Registro SIP no confirmado</title><p>El operador no confirmo el registro. La prueba ha terminado.</p>')
                finished.set()
            except Exception:
                self.send(422,b'<p>No se pudo completar la comprobacion.</p>')
    with HTTPServer(('127.0.0.1',0),Handler) as server:
        server.timeout=.5
        print('http://127.0.0.1:'+str(server.server_port)+path,flush=True)
        deadline=time.monotonic()+600
        while time.monotonic()<deadline and not finished.is_set():server.handle_request()


if __name__=='__main__':main()
