"""Local native renderer session; ordinary browsers do not expose the app UI."""
from http.cookies import SimpleCookie,CookieError
import hmac
import secrets
import re
from urllib.parse import parse_qs,urlencode,urlsplit


class DesktopUISession:
    COOKIE='brivany_desktop_ui'
    HEADER='X-Brivany-Desktop-UI'
    PREFIX='/_desktop/'
    def __init__(self,pages):
        self.pages=set(pages)-{'/','/index.html'}
        self.secret=secrets.token_urlsafe(32)

    def target(self,path):
        if not isinstance(path,str) or len(path)>2048 or any(ord(c)<32 for c in path):return False
        try:value=urlsplit(path)
        except ValueError:return False
        return not value.scheme and not value.netloc and not value.fragment and value.path in self.pages

    def entry(self,base,path):
        if not self.target(path):raise ValueError('Pantalla de escritorio no admitida.')
        return base+self.PREFIX+self.secret+'?'+urlencode({'target':path})

    def authorized(self,handler):
        try:
            native=handler.headers.get(self.HEADER)
            if native is not None:return isinstance(native,str) and hmac.compare_digest(native,self.secret)
            cookies=SimpleCookie();cookies.load(handler.headers.get('Cookie',''))
            value=cookies.get(self.COOKIE)
            return bool(value and hmac.compare_digest(value.value,self.secret))
        except (CookieError,TypeError):return False

    def bind_window(self,window,base):
        """WebView2 clears shared cookies when another private view initializes.

        Add the same ephemeral UI capability at the native request boundary.
        It never enters page JavaScript or requests to a different origin.
        """
        from webview.event import Event
        origin=urlsplit(base)
        def authenticate(request):
            target=urlsplit(request.url)
            for key in list(request.headers):
                if key.lower()==self.HEADER.lower():request.headers.pop(key)
            if (target.scheme,target.hostname,target.port)==(origin.scheme,origin.hostname,origin.port) and not target.username and not target.password:
                request.headers[self.HEADER]=self.secret
        # Header mutation must finish before WebView2 dispatches the request.
        event=Event(window,True);event+=authenticate;window.events.request_sent=event
        return window

    def handle(self,handler):
        parsed=urlsplit(handler.path);route=parsed.path
        if not (route.startswith(self.PREFIX) or route in {'/','/index.html'} or route in self.pages):return False
        if not handler.local_request():return True
        if route.startswith(self.PREFIX):
            query=parse_qs(parsed.query,keep_blank_values=True)
            supplied=route[len(self.PREFIX):]
            if not re.fullmatch(r'[A-Za-z0-9_-]{43}',supplied) or not hmac.compare_digest(supplied,self.secret) or set(query)!={'target'} or len(query['target'])!=1 or not self.target(query['target'][0]):
                handler.error(404,'desktop_entry','Acceso de escritorio no disponible.');return True
            handler.send_response(303);handler.send_header('Location',query['target'][0])
            handler.send_header('Set-Cookie',self.COOKIE+'='+self.secret+'; Path=/; HttpOnly; SameSite=Strict')
            handler.send_header('Cache-Control','no-store');handler.send_header('Referrer-Policy','no-referrer')
            handler.send_header('Content-Length','0');handler.end_headers();return True
        if route in {'/','/index.html'}:
            if self.authorized(handler):
                handler.send_response(303);handler.send_header('Location','/brivany-shell');handler.send_header('Cache-Control','no-store');handler.send_header('Content-Length','0');handler.end_headers()
            else:self.unavailable(handler)
            return True
        if route in self.pages and not self.authorized(handler):self.unavailable(handler);return True
        return False

    @staticmethod
    def unavailable(handler):
        raw='Brivany se utiliza desde la aplicación de escritorio.'.encode('utf-8')
        handler.send_headers(410,'text/plain; charset=utf-8',len(raw));handler.wfile.write(raw)
