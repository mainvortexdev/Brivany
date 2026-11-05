"""Retire the old 8767 preview: fixed page redirects only, no provider runtime."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit


class Redirect(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        if self.headers.get('Host') not in {'127.0.0.1:8767','localhost:8767'}:
            self.send_error(403);return
        path=urlsplit(self.path).path.rstrip('/')
        if path not in {'','/translate','/dubbing'}:self.send_error(404);return
        self.send_response(302)
        self.send_header('Location','http://127.0.0.1:8765/'+('dubbing' if path else ''))
        self.send_header('Cache-Control','no-store');self.send_header('Content-Length','0');self.end_headers()


if __name__=='__main__':
    server=ThreadingHTTPServer(('127.0.0.1',8767),Redirect)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
