"""Owned loopback HTTP fixture for download-command verification."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import threading

DOWNLOAD=b'Melodi download fixture\n'


@contextmanager
def download_server():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_HEAD(self):self.serve(False)
        def do_GET(self):self.serve(True)
        def serve(self,body):
            if self.path!='/fixture.txt':self.send_error(404);return
            payload=DOWNLOAD;start,end=0,len(payload)-1;status=200
            value=self.headers.get('Range')
            if value:
                import re
                match=re.fullmatch(r'bytes=(\d+)-(\d*)',value)
                if not match:self.send_error(416);return
                start=int(match[1]);end=min(end,int(match[2])) if match[2] else end
                if start> end:self.send_error(416);return
                status=206
            self.send_response(status);self.send_header('Content-Type','text/plain');self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length',str(end-start+1))
            if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{len(payload)}')
            self.end_headers()
            if body:self.wfile.write(payload[start:end+1])
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield 'http://127.0.0.1:'+str(server.server_port)+'/fixture.txt'
    finally:server.shutdown();server.server_close();thread.join(timeout=2)
