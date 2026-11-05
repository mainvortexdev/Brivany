"""Spotify CDN artwork validation and bounded, local palette extraction.

Only public, observed cover URLs are used. No bearer token, cookie, redirect,
image file on disk, screen capture or audio analysis is involved.
"""
from collections import OrderedDict
import colorsys
from io import BytesIO
import re
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request,build_opener,HTTPSHandler,HTTPRedirectHandler
from urllib.error import URLError,HTTPError
from services.spotify_tls import verified_context

DEFAULT={'primary':'#7e92aa','secondary':'#526c86'}


def valid_url(value):
    if not isinstance(value,str) or len(value)>2048:return ''
    try:
        url=urlsplit(value)
        if url.scheme!='https' or url.port or url.username or url.password or url.fragment or url.query:return ''
        pattern={'i.scdn.co':r'/image/[A-Za-z0-9]+','mosaic.scdn.co':r'/[0-9]{2,4}/[A-Za-z0-9]+'}.get(url.hostname)
        return value if pattern and re.fullmatch(pattern,url.path) else ''
    except ValueError:return ''


def artwork_url(images):
    return next((url for item in (images or []) if isinstance(item,dict) and (url:=valid_url(item.get('url')))), '')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def fetch(url):
    if not valid_url(url):raise ValueError('Portada no admitida.')
    req=Request(url,headers={'User-Agent':'BrivanyDesktop/0.1 (https://brivany.example)','Accept':'image/jpeg,image/png,image/webp'})
    with build_opener(NoRedirect(),HTTPSHandler(context=verified_context())).open(req,timeout=8) as response:
        raw=response.read(1048577)
        if len(raw)>1048576 or not response.headers.get('Content-Type','').startswith('image/'):raise ValueError('Portada no válida.')
        return raw


def extract(raw):
    from PIL import Image
    if not isinstance(raw,bytes) or len(raw)>1048576:raise ValueError('Portada demasiado grande.')
    try:source=Image.open(BytesIO(raw))
    except Image.DecompressionBombError:raise ValueError('Dimensiones de portada no admitidas.') from None
    with source:
        if source.width*source.height>8000000:raise ValueError('Dimensiones de portada no admitidas.')
        image=source.convert('RGB');image.thumbnail((80,80))
    quantized=image.quantize(colors=12);palette=quantized.getpalette();rows=[]
    for count,index in quantized.getcolors() or []:
        rgb=tuple(palette[index*3:index*3+3]);h,l,s=colorsys.rgb_to_hls(*(x/255 for x in rgb))
        if .10<l<.88:rows.append((count*(.2+s),rgb))
    if not rows:return dict(DEFAULT)
    rows.sort(reverse=True);primary=rows[0][1]
    secondary=next((rgb for _,rgb in rows[1:] if sum((a-b)**2 for a,b in zip(rgb,primary))>5000),tuple(max(0,round(x*.65)) for x in primary))
    color=lambda rgb:'#'+''.join(f'{v:02x}' for v in rgb)
    return {'primary':color(primary),'secondary':color(secondary)}


class ArtworkService:
    def __init__(self,*,http=fetch,clock=time.time):
        self.http=http;self.clock=clock;self.lock=threading.Lock();self.cache=OrderedDict()
    def clear(self):
        with self.lock:self.cache.clear()
    def palette(self,url):
        if not valid_url(url):return {**DEFAULT,'available':False}
        with self.lock:
            now=self.clock();cached=self.cache.get(url)
            if cached and cached[0]>now:self.cache.move_to_end(url);return dict(cached[1])
            try:result={**extract(self.http(url)),'available':True};ttl=3600
            except (ImportError,OSError,ValueError,URLError,HTTPError):result={**DEFAULT,'available':False};ttl=60
            self.cache[url]=(now+ttl,result);self.cache.move_to_end(url)
            while len(self.cache)>32:self.cache.popitem(last=False)
            return dict(result)
