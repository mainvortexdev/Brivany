"""Fixed first-party routing for an activated demo account; no provider secrets.

Ordinary installations keep their existing provider URLs and credentials.
Only the native bootstrap sets the process-local demo session.
"""
import os
import re
from urllib.parse import urlsplit,urlunsplit

DEMO_ORIGIN='https://demo.brivany.vetsa.es'
PROVIDERS={'api.meta.ai':'meta','api.cartesia.ai':'cartesia','api.deepgram.com':'deepgram'}

def enabled():
    return os.environ.get('BRIVANY_DEMO_ORIGIN')==DEMO_ORIGIN and bool(re.fullmatch(r'[A-Za-z0-9_-]{43}',os.environ.get('BRIVANY_DEMO_SESSION','')))

def endpoint(url):
    if not enabled():return url
    value=urlsplit(url);provider=PROVIDERS.get(value.hostname)
    if not provider:return url
    if value.username or value.password or value.fragment or value.port not in (None,443):raise ValueError('Provider endpoint is invalid')
    return urlunsplit(('wss' if value.scheme=='wss' else 'https',urlsplit(DEMO_ORIGIN).netloc,'/proxy/'+provider+value.path,value.query,''))

def demo_headers(headers=None):
    value=dict(headers or {})
    if enabled():
        value.setdefault('Authorization','Bearer '+os.environ['BRIVANY_DEMO_SESSION'])
        value['User-Agent']='Brivany-Desktop/0.2.1'
    return value

def provider_request(url,*args,**kwargs):
    from urllib.request import Request
    if enabled() and urlsplit(url).hostname==urlsplit(DEMO_ORIGIN).hostname:
        kwargs['headers']=demo_headers(kwargs.get('headers'))
    return Request(url,*args,**kwargs)

class _DemoConnection:
    def __init__(self,connection,provider):self.connection=connection;self.provider=provider
    def request(self,method,url,body=None,headers=None,*,encode_chunked=False):
        return self.connection.request(method,'/proxy/'+self.provider+url,body=body,headers=demo_headers(headers),encode_chunked=encode_chunked)
    def __getattr__(self,name):return getattr(self.connection,name)
    @property
    def timeout(self):return self.connection.timeout
    @timeout.setter
    def timeout(self,value):self.connection.timeout=value
    @property
    def sock(self):return self.connection.sock
    @sock.setter
    def sock(self,value):self.connection.sock=value

def https_connection(factory,host,*args,**kwargs):
    if enabled() and host in PROVIDERS:return _DemoConnection(factory(urlsplit(DEMO_ORIGIN).hostname,*args,**kwargs),PROVIDERS[host])
    return factory(host,*args,**kwargs)
