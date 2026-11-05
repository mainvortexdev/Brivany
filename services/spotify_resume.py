"""One protected playback checkpoint, never a listening-history archive."""
import json
import math
import re


def context_uri(value):
    return value if isinstance(value,str) and re.fullmatch(r'spotify:(?:album|playlist):[A-Za-z0-9]{22}',value) else ''


def track_uris(values):
    return [v for v in values[:50] if isinstance(v,str) and re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}',v)] if isinstance(values,list) else []


class SpotifyResume:
    def __init__(self,root,protector,clock):
        self.path=root/'playback.bin';self.protector=protector;self.clock=clock;self.value=None;self.saved_at=0

    def load(self,client):
        if not self.protector.available:return
        try:
            raw=self.path.read_bytes()
            if len(raw)>65536:return
            value=json.loads(self.protector.unprotect(raw))
            p=value['playback'];age=self.clock()-value['saved_at']
            if value['client_id']==client and 0<=age<=30*86400 and p.get('type')=='track' and re.fullmatch(r'[A-Za-z0-9]{22}',p.get('id','')) and type(p.get('progress_ms')) is int and 0<=p['progress_ms']<=p['duration_ms']<=86400000:
                self.value=value;self.saved_at=value['saved_at']
        except (OSError,ValueError,KeyError,TypeError,RuntimeError):pass

    def remember(self,client,playback,*,context='',next_tracks=None,local=False):
        if playback.get('type')!='track' or not re.fullmatch(r'[A-Za-z0-9]{22}',playback.get('id','')):return
        p={k:playback.get(k) for k in ('id','type','title','artist','album','artwork','url','duration_ms','progress_ms','playing','shuffle','repeat','volume','supports_volume')}
        if any(type(p.get(k)) not in (int,float) or not math.isfinite(p[k]) for k in ('duration_ms','progress_ms')):return
        p['duration_ms']=round(p['duration_ms']);p['progress_ms']=max(0,min(p['duration_ms'],round(p['progress_ms'])))
        changed=not self.value or self.value['playback']['id']!=p['id'] or self.value['playback']['playing']!=p['playing']
        previous=self.value if self.value and self.value['playback']['id']==p['id'] else {}
        self.value={'client_id':client,'saved_at':self.clock(),'music_at':self.clock() if p.get('playing') else previous.get('music_at',0),'playback':p,'context':context_uri(context) or previous.get('context',''),'next_tracks':track_uris(next_tracks) if next_tracks is not None else previous.get('next_tracks',[]) if local else [],'local':local is True}
        if not self.protector.available or not changed and self.clock()-self.saved_at<2:return
        try:
            data=self.protector.protect(json.dumps(self.value).encode('utf-8'));temporary=self.path.with_suffix('.tmp');temporary.write_bytes(data);temporary.replace(self.path);self.saved_at=self.clock()
        except (OSError,ValueError,RuntimeError):pass # Checkpoint failure cannot stop playback.

    def clear(self):
        self.value=None;self.saved_at=0;self.path.unlink(missing_ok=True)

    def request(self):
        value=self.value
        if not value:return None
        p=value['playback'];uri='spotify:track:'+p['id']
        result={'position_ms':min(p['progress_ms'],max(0,p['duration_ms']-1))}
        if context_uri(value.get('context')):result.update(context_uri=value['context'],offset={'uri':uri})
        else:result['uris']=[uri]+track_uris(value.get('next_tracks'))
        return result
