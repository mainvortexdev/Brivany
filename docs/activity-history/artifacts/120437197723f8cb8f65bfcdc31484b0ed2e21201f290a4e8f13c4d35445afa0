"""Local AudioSet classification before MT/TTS. No audio persistence/network."""
from pathlib import Path
import threading
import time

ASSETS=Path(__file__).resolve().parents[2]/'desktop/assets/audio'
_MODEL=None
_LOCK=threading.RLock()
SPEECH=('Speech','Child speech, kid speaking','Conversation','Narration, monologue','Speech synthesizer','Whispering','Shout')
SINGING=('Singing','Choir','Yodeling','Chant','Mantra','Child singing','Synthetic singing','Rapping','Humming')


def melody_features(pcm):
    """Acoustic continuity cue, never a speaker identity or song recognition."""
    import numpy as np
    signal=np.frombuffer(pcm,dtype='<i2').astype(np.float32)[::3]/32768
    if len(signal)<640:return {'voiced_ratio':0.,'held_ratio':0.,'pitch_span':0.}
    frames=np.lib.stride_tricks.sliding_window_view(signal,640)[::160].copy();frames-=frames.mean(axis=1,keepdims=True)
    energy=np.mean(frames*frames,axis=1);lags=np.arange(23,134)
    scores=np.stack([np.sum(frames[:,lag:]*frames[:,:-lag],axis=1)/np.sqrt(np.maximum(1e-12,np.sum(frames[:,lag:]**2,axis=1)*np.sum(frames[:,:-lag]**2,axis=1))) for lag in lags],axis=1)
    best=scores.max(axis=1);near=scores>=np.maximum(.65,best[:,None]-.025)
    selected=lags[np.argmax(near,axis=1)];voiced=(best>=.65)&(energy>.00004)
    pitch=12*np.log2(8000/selected);stable=voiced[1:]&voiced[:-1]&(np.abs(np.diff(pitch))<.45)
    held=0;run=0
    for value in stable:
        if value:run+=1
        else:
            if run>=10:held+=run
            run=0
    if run>=10:held+=run
    values=pitch[voiced]
    return {'voiced_ratio':round(float(voiced.mean()),3),'held_ratio':round(held/max(1,int(voiced.sum())),3),'pitch_span':round(float(np.percentile(values,90)-np.percentile(values,10)),2) if len(values)>5 else 0.}


def frame_kind(scores):
    speech=max((scores.get(k,0.) for k in SPEECH),default=0.)
    singing=max((scores.get(k,0.) for k in SINGING),default=0.)
    music=scores.get('Music',0.)
    # Music alone never excludes a spoken voice over a soundtrack.
    if speech>=.45 or speech>=max(.18,singing*1.2):kind='speech'
    elif singing>=.28 and singing>speech*1.35:kind='singing'
    elif music>=.70 and speech<.12:kind='music'
    else:kind='unknown'
    return {'kind':kind,'speech':speech,'singing':singing,'music':music}


class SingingFilter:
    """Small CPU model, serialized inference, at most four 975-ms windows."""
    def __init__(self):
        global _MODEL
        import numpy as np
        with _LOCK:
            if _MODEL is None:
                from ai_edge_litert.interpreter import Interpreter
                labels=(ASSETS/'yamnet-labels.txt').read_text(encoding='utf-8').splitlines()
                if len(labels)!=521:raise ValueError('Instala el clasificador de audio de Brivany.')
                model=Interpreter(model_path=str(ASSETS/'yamnet.tflite'),num_threads=2);model.allocate_tensors()
                _MODEL=(model,labels,model.get_input_details()[0]['index'],model.get_output_details()[0]['index'])
        self.np=np;self.model,self.labels,self.input,self.output=_MODEL

    def classify(self,pcm):
        if not isinstance(pcm,bytes) or len(pcm)%2 or len(pcm)>384000:raise ValueError('Muestra acústica fuera de límites.')
        started=time.perf_counter();np=self.np
        if len(pcm)<46800:return {'skip':False,'kind':'unknown','reason':'short_sample','model':'yamnet','latency_ms':0.}
        samples=np.frombuffer(pcm,dtype='<i2').astype(np.float32)/32768
        # 24kHz -> 16kHz for YAMNet; filtering only, never alters audible PCM.
        positions=np.arange(int(len(samples)*2/3),dtype=np.float32)*1.5
        audio=np.interp(positions,np.arange(len(samples)),samples).astype(np.float32)
        offsets=np.linspace(0,len(audio)-15600,min(4,1+int((len(audio)-15600)/7680)),dtype=int)
        rows=[]
        with _LOCK:
            for offset in offsets:
                self.model.set_tensor(self.input,audio[offset:offset+15600]);self.model.invoke()
                values=self.model.get_tensor(self.output)[0]
                rows.append(frame_kind(dict(zip(self.labels,map(float,values)))))
        excluded=sum(row['kind'] in ('singing','music') for row in rows)
        # A clearly spoken window protects mixed dialogue, even over music.
        protected=any(row['speech']>=.65 for row in rows)
        skip=not protected and excluded>=max(1,(len(rows)*2+2)//3)
        melody=None
        if not skip and max(r['singing'] for r in rows)>=.04 and max(r['music'] for r in rows)<.2:
            melody=melody_features(pcm)
            # A cappella can also score as Speech. Require independent sustained
            # pitched-note evidence; ordinary speech or a soundtrack alone is
            # insufficient. This remains an acoustic inference, not certainty.
            if melody['voiced_ratio']>=.65 and melody['held_ratio']>=.5 and 2.5<=melody['pitch_span']<=24:skip=True
        kind='singing' if skip and any(row['kind']=='singing' for row in rows) else 'music' if skip else 'speech' if any(row['kind']=='speech' for row in rows) else 'unknown'
        if skip and melody:kind='singing'
        return {'skip':skip,'kind':kind,'model':'yamnet','windows':len(rows),
                'speech_score':round(max(r['speech'] for r in rows),4),'singing_score':round(max(r['singing'] for r in rows),4),
                'music_score':round(max(r['music'] for r in rows),4),
                'latency_ms':round((time.perf_counter()-started)*1000,2)}
