"""Two bounded background agents; anonymous speaker binding and voice cloning.

Original PCM is memory-only. Cache keys are session-local ASR labels, never a
real person's identity. A clone is attempted at most once per label/session.
"""
from collections import deque
import queue
import threading
import time
import math
from uuid import uuid4
from packages.providers.audio_content import SingingFilter
from packages.providers.voice_clone import CartesiaVoiceCloner


class TranslationVoiceAgents:
    def __init__(self,*,language='es',authorized=False,cloner_factory=CartesiaVoiceCloner,classifier_factory=SingingFilter):
        if authorized is not True:raise ValueError('Confirma el permiso de las voces antes de activar la clonación.')
        if language not in ('es','en','fr'):raise ValueError('Idioma original no válido.')
        self.language=language;self.cloner_factory=cloner_factory;self.classifier_factory=classifier_factory
        self.lock=threading.RLock();self.stopped=threading.Event();self.observations=queue.Queue(8);self.tasks=queue.Queue(4)
        self.speakers={};self.seen=set();self.intervals=deque(maxlen=128);self.created=set();self.cleanup_failed=[];self.cloner=None
        self.jobs=[{'id':str(uuid4()),'kind':'voice-association','title':'Hablantes','state':'running','phase':'Reconociendo voces','source':'translation_voices'},
                   {'id':str(uuid4()),'kind':'voice-cloning','title':'Clonación de voz','state':'queued','phase':'Reuniendo muestras limpias','source':'translation_voices'}]
        self.threads=[threading.Thread(target=self._associate,daemon=True,name='melodi-speaker-agent'),threading.Thread(target=self._clone,daemon=True,name='melodi-voice-clone-agent')]
        for thread in self.threads:thread.start()

    def observe(self,turn,label,pcm,start,end):
        if self.stopped.is_set() or not isinstance(label,str) or len(label)!=1 or not 'A'<=label<='Z':return
        if not isinstance(pcm,bytes) or not 46800<=len(pcm)<=384000 or len(pcm)%2:return
        if any(type(v) not in (int,float) or not math.isfinite(v) for v in (start,end)) or start<0 or end<=start:return
        if abs((end-start)*48000-len(pcm))>96:return
        try:self.observations.put_nowait((str(turn),label,pcm,float(start),float(end)))
        except queue.Full:pass # Never stall audible translation or grow audio memory.

    def _associate(self):
        try:classifier=self.classifier_factory()
        except Exception:
            with self.lock:self.jobs[0].update(state='failed',phase='No se pudo analizar la muestra de voz')
            return
        while not self.stopped.is_set():
            try:turn,label,pcm,start,end=self.observations.get(timeout=.1)
            except queue.Empty:continue
            with self.lock:
                if turn in self.seen:continue
                self.seen.add(turn)
                if len(self.seen)>256:self.seen={turn}
                if label not in self.speakers:
                    if len(self.speakers)>=4:continue
                    self.speakers[label]={'index':len(self.speakers)+1,'parts':[],'seconds':0.,'attempted':False,'voice':None,'state':'collecting','turns':0,'tainted':False}
                row=self.speakers[label]
                conflicts=[item for item in self.intervals if item[0]!=label and max(start,item[1])<min(end,item[2])]
                if conflicts:
                    for other,_,_ in conflicts:
                        if other in self.speakers:self.speakers[other].update(tainted=True,voice=None,parts=[],state='mixed_speakers')
                    row.update(tainted=True,voice=None,parts=[],state='mixed_speakers')
                self.intervals.append((label,start,end))
                if row['attempted'] or row['tainted']:continue
            try:quality=classifier.classify(pcm)
            except Exception:continue
            if quality.get('kind')!='speech' or quality.get('speech_score',0)<.65 or quality.get('singing_score',1)>.08 or quality.get('music_score',1)>.15:
                with self.lock:row['state']='needs_clean_audio'
                continue
            with self.lock:
                if self.stopped.is_set() or row['tainted']:continue
                row['parts'].append(pcm);row['seconds']+=len(pcm)/48000;row['turns']+=1;row['state']='collecting'
                self.jobs[0]['phase']=f"Hablante {row['index']} identificado"
                if row['seconds']>=10 and row['turns']>=2:
                    row['attempted']=True;row['state']='cloning';sample=b''.join(row['parts'])[:1440000];row['parts']=[]
                    self.tasks.put_nowait((label,sample))
        with self.lock:
            if not self.stopped.is_set():self.jobs[0].update(state='succeeded',phase='Sesión de hablantes terminada')

    def _remove(self,identifier):
        try:
            self.cloner.delete(identifier)
            with self.lock:self.created.discard(identifier)
        except Exception:
            with self.lock:self.cleanup_failed.append(identifier)

    def _clone(self):
        renewed=time.monotonic()
        while not self.stopped.is_set():
            if self.cloner and time.monotonic()-renewed>=60:
                with self.lock:identifiers=list(self.created)
                try:
                    if hasattr(self.cloner,'keep_alive'):self.cloner.keep_alive(identifiers)
                except Exception:pass # Retry the local lease on the next minute.
                renewed=time.monotonic()
            try:label,pcm=self.tasks.get(timeout=.1)
            except queue.Empty:continue
            with self.lock:
                row=self.speakers[label]
                if self.stopped.is_set():break
                if row['tainted']:continue
                self.jobs[1].update(state='running',phase=f"Preparando voz de Hablante {row['index']}")
            try:
                if self.cloner is None:
                    self.cloner=self.cloner_factory()
                    if hasattr(self.cloner,'cleanup_expired'):self.cloner.cleanup_expired()
                result=self.cloner.clone(pcm,language=self.language,name=f"Brivany · Hablante {row['index']}",authorized=True)
                with self.lock:
                    self.created.add(result['id'])
                    usable=not self.stopped.is_set() and not row['tainted']
                    if usable:row.update(voice=result['id'],state='ready')
                    if usable:self.jobs[1].update(state='succeeded',phase=f"Voz de Hablante {row['index']} lista")
                if not usable:self._remove(result['id'])
            except Exception:
                with self.lock:
                    row['state']='failed'
                    if not self.stopped.is_set():self.jobs[1].update(state='failed',phase='No se pudo preparar esta voz; continúa la traducción normal')
            finally:pcm=b''
        # Delete only IDs created by this agent session. No arbitrary voice ID
        # or user library is accepted by this cleanup path.
        if self.cloner:
            for identifier in list(self.created):self._remove(identifier)

    def voice_for(self,label):
        with self.lock:
            row=self.speakers.get(label)
            return row['voice'] if row and row['state']=='ready' and not row['tainted'] and not self.stopped.is_set() else None

    def status(self):
        with self.lock:
            return {'active':not self.stopped.is_set(),'agents':[dict(job) for job in self.jobs],
                    'speakers':[{'label':f"Hablante {row['index']}",'state':row['state'],'sample_seconds':round(row['seconds'],1),'ready':bool(row['voice'])} for row in self.speakers.values()],
                    'cache_scope':'translation_session','audio_persisted':False,'cleanup_pending':bool(self.cleanup_failed)}

    def close(self):
        self.stopped.set()
        with self.lock:
            for row in self.speakers.values():row['parts']=[];row['voice']=None
            for job in self.jobs:
                if job['state'] in ('queued','running'):job.update(state='cancelled',phase='Sesión terminada')
        for items in (self.observations,self.tasks):
            while True:
                try:items.get_nowait()
                except queue.Empty:break
