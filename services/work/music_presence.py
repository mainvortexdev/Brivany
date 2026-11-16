"""Ephemeral YouTube music metadata over the authenticated extension channel."""
import json
import math
import re
import threading
import time

VIDEO=re.compile(r'[A-Za-z0-9_-]{11}\Z')


def normalize_music(value):
    if not isinstance(value,dict) or value.get('type')!='music' or not VIDEO.fullmatch(str(value.get('video',''))):raise ValueError('Música de YouTube no válida.')
    for name in ('playing','muted','music'):
        if type(value.get(name)) is not bool:raise ValueError('Estado de música no válido.')
    for name in ('position','duration'):
        if type(value.get(name)) not in (int,float) or not math.isfinite(value[name]) or not 0<=value[name]<=86400:raise ValueError('Tiempo de música no válido.')
    def text(name,limit):
        item=value.get(name,'')
        if not isinstance(item,str) or len(item)>limit or any(ord(c)<32 for c in item):raise ValueError('Metadatos de música no válidos.')
        return item.strip()
    title=text('title',240);artist=text('artist',240);identifier=value['video']
    # A standard music video's own title commonly contains "Artist - Song".
    if not artist and ' - ' in title:artist,title=title.split(' - ',1)
    title,separator,album=title.partition(' | ')
    title=re.sub(r'\s*[\[(](?:official\s+)?(?:music\s+video|video\s+oficial|audio\s+oficial|video|audio|lyrics?|lyric\s+video|visualizer|letra|oficial)[\])]', '', title, flags=re.I).strip()
    return {'source':'youtube','id':'youtube:'+identifier,'video_id':identifier,'type':'track','title':title,
            'artist':artist,'album':album.strip() if separator else '','duration_ms':round(value['duration']*1000),'progress_ms':round(value['position']*1000),
            'playing':value['playing'] and not value['muted'] and value['music'] and bool(title),
            'artwork':'https://i.ytimg.com/vi/'+identifier+'/hqdefault.jpg','url':'https://www.youtube.com/watch?v='+identifier}


class YouTubeMusicPresence:
    def __init__(self,enabled=lambda:False,clock=time.monotonic):
        self.enabled=enabled;self.clock=clock;self.lock=threading.RLock();self.entries={}
    def observe(self,channel,value):
        item=normalize_music(value)
        with self.lock:
            if not self.enabled():self.entries.clear();return
            self.entries[channel]=(self.clock(),item)
            if len(self.entries)>32:self.entries.pop(next(iter(self.entries)))
    def current(self):
        with self.lock:
            now=self.clock()
            for key,(at,_) in list(self.entries.items()):
                if now-at>8:self.entries.pop(key,None)
            if not self.enabled():self.entries.clear();return None
            candidates=[(at,item) for at,item in self.entries.values() if item['playing']]
            if not candidates:return None
            at,item=max(candidates,key=lambda pair:pair[0]);result=dict(item)
            result['progress_ms']=min(result['duration_ms'],result['progress_ms']+round((now-at)*1000));return result
    def handle(self,socket):
        channel=object()
        try:
            while True:
                raw=socket.recv(timeout=12)
                if not isinstance(raw,str) or len(raw)>4096:raise ValueError('Mensaje de música demasiado grande.')
                value=json.loads(raw)
                if value=={'type':'ping'}:socket.send(json.dumps({'type':'music-ready','enabled':bool(self.enabled())}));continue
                self.observe(channel,value)
        except TimeoutError:return
        finally:
            with self.lock:self.entries.pop(channel,None)

