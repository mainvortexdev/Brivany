"""Optional bounded subtitle lookahead. ASR remains the authority for speech.

Only an exact normalized ASR match may consume a prepared translation. Page
text cannot choose a voice, create audio, invoke tools or change instructions.
All text lives in this session's memory; failure falls back to the live path.
"""
from collections import OrderedDict
import math
import queue
import re
import threading
import time
import unicodedata


def signature(text):
    # Preserve all words, numbers and negation. No fuzzy semantic matching.
    return tuple(re.findall(r"\w+|[^\w\s.,!?;:…\"'’“”«»]", unicodedata.normalize('NFKC', text).casefold()))


class CaptionPrefetch:
    def __init__(self, target, *, translator_factory, epoch=1, clock=time.monotonic):
        self.target=target;self.factory=translator_factory;self.epoch=epoch;self.clock=clock
        self.lock=threading.RLock();self.closed=threading.Event();self.pending=queue.Queue(maxsize=3)
        self.source=None;self.generation=0;self.rows=OrderedDict();self.translator=None
        self.counts={'offered':0,'prepared':0,'hits':0,'failed':0,'discarded':0}
        self.worker=threading.Thread(target=self._work,name='brivany-caption-prefetch',daemon=True);self.worker.start()

    def _expire(self):
        now=self.clock()
        for key,row in list(self.rows.items()):
            if row['expires']<=now:self.rows.pop(key,None)
        while len(self.rows)>32:self.rows.popitem(last=False)

    def offer(self, message):
        if not isinstance(message,dict) or set(message)!={'type','epoch','source','position','cues'} or message.get('type')!='caption-lookahead':return False
        if type(message['epoch']) is not int or message['epoch']!=self.epoch:return False
        source=message['source'];position=message['position'];cues=message['cues']
        if not isinstance(source,str) or not re.fullmatch(r'(?:youtube:[\w-]{11}|video:[0-9a-f]{1,8})',source):return False
        if type(position) not in (int,float) or not math.isfinite(position) or not 0<=position<=604800:return False
        if not isinstance(cues,list) or len(cues)>6:return False
        clean=[]
        for cue in cues:
            if not isinstance(cue,dict) or set(cue)!={'start','end','text','speaker'}:return False
            start,end,text,hint=(cue[k] for k in ('start','end','text','speaker'))
            if any(type(n) not in (int,float) or not math.isfinite(n) for n in (start,end)):return False
            if not 0<=start<end or end-start>30 or end<=position or start>=position+16:return False
            if not isinstance(text,str) or not 1<=len(text)<=400 or any(ord(c)<32 and c not in '\t\r\n' for c in text):return False
            if hint is not None and (not isinstance(hint,str) or len(hint)>60):return False
            if not signature(text) or re.fullmatch(r'\s*\[(music|música|applause|aplausos)\]\s*',text,re.I):continue
            clean.append((start,end,' '.join(text.split()),hint))
        # Prepare up to three imminent sentences, joining adjacent caption
        # fragments only within one short interval and one caption voice hint.
        candidates=[];joined='';begin=None;last_end=None;last_hint=None
        for start,end,text,hint in sorted(clean):
            if joined and (start-last_end>1.2 or end-begin>8 or len(joined)+len(text)+1>400 or hint!=last_hint):
                candidates.append(joined);joined=''
            if not joined:begin=start
            joined=(joined+' '+text).strip();last_end=end;last_hint=hint
            if text.endswith(('.', '!', '?', '…')):candidates.append(joined);joined=''
        if joined:candidates.append(joined)
        with self.lock:
            if self.closed.is_set():return False
            if self.source!=source:
                self.source=source;self.generation+=1;self.rows.clear()
                while True:
                    try:self.pending.get_nowait()
                    except queue.Empty:break
            self._expire()
            for text in candidates[:3]:
                key=signature(text)
                if key in self.rows:continue
                row={'expires':self.clock()+45,'translation':None,'usage':{}}
                try:self.pending.put_nowait((self.generation,key,text))
                except queue.Full:break
                self.rows[key]=row;self.counts['offered']+=1
            self._expire()
        return True

    def lookup(self, text):
        with self.lock:
            self._expire();row=self.rows.get(signature(text))
            if self.closed.is_set() or not row or row['translation'] is None:return None
            self.counts['hits']+=1
            return {'text':row['translation'],'usage':dict(row['usage'])}

    def offer_recognized(self,text):
        """Prepare one provisional ASR phrase. Only a final exact match uses it."""
        key=signature(text)
        if not 4<=len(key)<=100 or not 20<=len(text)<=400:return False
        with self.lock:
            if self.closed.is_set():return False
            self._expire()
            if key in self.rows:return True
            try:self.pending.put_nowait((self.generation,key,text))
            except queue.Full:return False
            self.rows[key]={'expires':self.clock()+45,'translation':None,'usage':{}}
            self.counts['offered']+=1
            return True

    def status(self):
        with self.lock:return {**self.counts,'queued':self.pending.qsize(),'cached':len(self.rows),'text_persisted':False}

    def _work(self):
        try:
            while not self.closed.is_set():
                try:generation,key,text=self.pending.get(timeout=.1)
                except queue.Empty:continue
                with self.lock:
                    self._expire()
                    if generation!=self.generation or key not in self.rows:continue
                try:
                    if self.translator is None:
                        created=self.factory()
                        with self.lock:
                            if self.closed.is_set():created.close();return
                            self.translator=created
                    translated=''
                    for delta in self.translator.stream(text,self.target,[]):
                        if self.closed.is_set():return
                        translated+=delta
                        if len(translated)>600:raise ValueError('caption output limit')
                    if not translated.strip():raise ValueError('empty caption translation')
                    with self.lock:
                        row=self.rows.get(key)
                        if generation==self.generation and row and row['expires']>self.clock() and not self.closed.is_set():
                            row.update(translation=translated,usage=dict(getattr(self.translator,'usage',{})));self.counts['prepared']+=1
                        else:self.counts['discarded']+=1
                except Exception:
                    # A caption outage cannot stop actual audio translation.
                    with self.lock:self.counts['failed']+=1
        finally:
            if self.translator:
                try:self.translator.close()
                except Exception:pass

    def close(self):
        self.closed.set()
        with self.lock:
            self.rows.clear();translator=self.translator
            while True:
                try:self.pending.get_nowait()
                except queue.Empty:break
        if translator:
            try:translator.close()
            except Exception:pass
