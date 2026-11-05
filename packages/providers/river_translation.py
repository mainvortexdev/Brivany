"""Bounded concurrent Muse ASR -> Meta Spark SSE -> Cartesia WS translation.

One transient MT recovery before any delta, no transcript/audio persistence. Native output deliberately stays out
of the captured browser tab, preventing translated speech from re-entering ASR.
"""
from __future__ import annotations

import base64
from collections import deque
from dataclasses import dataclass
import json
import hashlib
import math
import os
from pathlib import Path
import queue
import re
import threading
import time
from uuid import uuid4

from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed, ConnectionClosedOK
from packages.providers.dubbing import TranslationBridge
from packages.providers.live_voice import (MUSE_URL, MUSE_MODEL, MuseEvents,
    VoiceError, muse_handshake, muse_key)
from packages.providers.meta_translation import MetaTranslationSession, meta_translation_status
from packages.providers.modular_dubbing import StableClauses, Segment
from packages.providers.native_audio import open_native_audio, status as audio_status
from packages.providers.pcm_pacing import PCMRateGate
from packages.providers.inline_clauses import InlineClauses
from packages.providers.robust_voice_timbre import analyze_timbre
from packages.providers.acoustic_speakers import SessionSpeakers, warm_speaker_embedding, MATCH_THRESHOLD, MATCH_MARGIN
from packages.providers.dubbing_timing import DeliveryPace, spoken_word_count
from packages.providers.dubbing_audio import trim_synthesis_padding

CARTESIA_URL = 'wss://api.cartesia.ai/tts/websocket?cartesia_version=2026-08-14'
SONIC_MODEL = 'sonic-3.6-2026-08-27'
MAX_TOKENS = 768
DRAIN_SECONDS = 30
RATE_BYTES = 48000
# One playing and one prefetched context. NativeMixer still owns only its
# 240 ms lead; this bounded staging area preserves ordering when Cartesia
# interleaves concurrent contexts on the same socket.
MAX_CONTEXTS = 2
MAX_CONTEXT_AUDIO_BYTES = RATE_BYTES * 30
INLINE_ASR_LAG_MS = 4000
INLINE_PROSODY_GRACE = .12
INLINE_MT_TIMEOUT = 6.5
INLINE_MT_FAILURE_LIMIT = 3
TIMBRE_CACHE_MATCH_THRESHOLD = round(MATCH_THRESHOLD + MATCH_MARGIN, 4)
TRANSIENT_MT_ERRORS = {'mt_timeout','mt_unavailable','mt_incomplete'}
SENTENCE_BOUNDARY = re.compile(r'[.!?]\s+(?=\S)')
LANGUAGES = {'es': 'Spanish', 'en': 'English', 'fr': 'French'}
VOICES = {'low': '47c38ca4-5f35-497b-b1a3-415245fb35e1',
          'high': 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4',
          'neutral': '47c38ca4-5f35-497b-b1a3-415245fb35e1'}
VOICE_PALETTES = {
    'low':(('Daniel',VOICES['low']),('Jace','6776173b-fd72-460d-89b3-d85812ee518d')),
    'high':(('Skylar',VOICES['high']),('Tessa','6ccbfb76-1fc6-48f7-b71d-91ac6298247b'))}
PROSODY_EMOTIONS=frozenset({'neutral','calm','happy','sad','angry','excited'})
ACCESS_PATH = Path(__file__).resolve().parents[2] / '.local/translation/access.json'


def inline_muse_close(error):
    code=error.rcvd.code if error.rcvd else None
    if code==1008:
        return VoiceError('muse_stream_policy','Muse rechazó el ritmo o la configuración del audio. El video puede continuar con su audio original.')
    if code==1013:
        return VoiceError('muse_rate_limit','Muse limitó las conexiones. El video puede continuar con su audio original.')
    return VoiceError('muse_connection','Se cerró la conexión de Muse. El video puede continuar con su audio original.')


def access_checks():
    """Only surface checks for the currently installed credential, never its hash."""
    try: saved=json.loads(ACCESS_PATH.read_text(encoding='utf-8'))
    except (OSError,ValueError): return {}
    result={}
    for provider,variable in [('meta','BRIVANY_META_API_KEY'),('cartesia','BRIVANY_CARTESIA_API_KEY')]:
        check=saved.get(provider,{})
        if check.get('credential_hash')==hashlib.sha256(os.getenv(variable,'').encode()).hexdigest():
            result[provider]={key:check.get(key) for key in ('http_status','access','checked_at','checked_model','model_available')}
    return result


def river_status():
    stages = {'asr': bool(muse_key()), 'translation': meta_translation_status()['configured'],
              'tts': bool(os.getenv('BRIVANY_CARTESIA_API_KEY'))}
    checks=access_checks()
    model_blocked=checks.get('meta',{}).get('checked_model')==meta_translation_status()['model'] and checks.get('meta',{}).get('model_available') is False
    return {'provider': 'Muse · Meta Spark · Cartesia', 'configured': all(stages.values()), 'stages': stages,
        'access_checks':checks, 'access_blocked':model_blocked or any(check.get('access') is False for check in checks.values()),
        'model_blocked':model_blocked,
        'model': meta_translation_status()['model'], 'inline_translation_model':inline_translation_model(), 'tts_model': SONIC_MODEL, 'max_seconds': None,
        'daily_sessions': None, 'sessions_remaining': None, 'continuous':True,
        'max_segments': None, 'max_characters': None, 'max_tokens_per_segment': MAX_TOKENS,
        'voice_modes':['auto','masculine','feminine'],
        'input_frame_ms': 80, 'sample_rate': 24000, 'languages': list(LANGUAGES),
        'retries': 1, 'retry_before_first_delta_only':True,'asr_retries':0,'tts_retries':0,
        'billing_amount': None, 'access_verified': False,
        'translation_provider':'Meta', 'asr_model':MUSE_MODEL,
        'playback_queue_lead_ms':240,
        'prefetched_contexts':MAX_CONTEXTS,'max_staged_audio_seconds_per_context':MAX_CONTEXT_AUDIO_BYTES/RATE_BYTES,
        'audible_latency_verified': False, 'native_output': audio_status()}


def inline_translation_model():
    configured = meta_translation_status()['model']
    return 'muse-spark-1.2' if configured == 'muse-spark-1.3' else configured


def cartesia_failure(event):
    status = event.get('status_code')
    status = status if type(status) is int and 100 <= status <= 599 else None
    provider_code = event.get('error_code')
    if provider_code == 'quota_exceeded' or status == 402:
        error = VoiceError('cartesia_quota', 'Cartesia alcanzó su cuota. Restablece la cuota de voz de la cuenta para continuar.')
    elif provider_code == 'concurrency_limited' or status == 429:
        error = VoiceError('cartesia_limit', 'Cartesia alcanzó su límite de solicitudes simultáneas. Espera antes de volver a iniciar.')
    else:
        error = VoiceError('cartesia_rejected', 'Cartesia rechazó la voz. Revisa acceso, modelo y cuota de la cuenta.')
    error.provider_status = status
    return error


def pitch_style(raw, evidence=None):
    """Estimate a catalog register from the voiced portions of an ASR span."""
    import numpy as np
    if len(raw)<1920:return 'neutral'
    samples=np.frombuffer(raw[:384000],dtype='<i2')[::3].astype(np.float64)
    # Suppress upper harmonics before finding the period. A formant or a
    # strong second harmonic must not turn one vocal cycle into two.
    frequencies=np.fft.rfftfreq(len(samples),d=1/8000)
    values=np.fft.irfft(np.fft.rfft(samples)*np.exp(-.5*(frequencies/520)**2),n=len(samples))
    lags=np.arange(20,145)
    pitches=[];resonance=[]
    # Keep analysis bounded while sampling the entire available span.
    step=max(240,(len(values)-400)//79+1)
    taper=np.hanning(400)
    for start in range(0,len(values)-400+1,step):
        window=values[start:start+400];window=window-window.mean()
        if np.dot(window,window)<400*90000:continue
        correlation=np.correlate(window,window,'full')[399:]
        squares=np.r_[0.,np.cumsum(window*window)]
        normalization=np.sqrt(squares[400-lags]*(squares[400]-squares[lags]))
        scores=correlation[lags]/np.maximum(normalization,1.)
        peaks=np.flatnonzero((scores[1:-1]>scores[:-2])&(scores[1:-1]>=scores[2:]))+1
        if not peaks.size:continue
        threshold=max(.72,float(scores[peaks].max())-.10)
        candidates=peaks[scores[peaks]>=threshold]
        if not candidates.size:continue
        selected=candidates[0]
        double=lags[selected]*2
        octave=peaks[np.abs(lags[peaks]-double)<=double*.08]
        if octave.size:
            longer=octave[np.argmax(scores[octave])]
            if scores[longer]>scores[selected]+.035:
                selected=longer
            elif 46<=lags[longer]<=102 and scores[longer]>=scores[selected]-.015:
                # A weak fundamental can make adjacent half-cycles correlate
                # almost as strongly as the full cycle. Check for a distinct
                # spectral peak at the longer period before choosing the octave.
                spectrum=np.abs(np.fft.rfft(window*taper,n=1024))
                fundamental=round(1024/int(lags[longer]))
                harmonic=round(1024/int(lags[selected]))
                level=max(spectrum[fundamental-1:fundamental+2])
                neighbors=max(spectrum[fundamental-5],spectrum[fundamental+5])
                if level>=max(.065*max(spectrum[harmonic-1:harmonic+2]),2*neighbors):
                    selected=longer
        pitches.append(8000/int(lags[selected]))
        if evidence is not None and len(pitches)%3==0:
            window=samples[start:start+400]
            emphasized=(window[1:]-.94*window[:-1])*np.hamming(399)
            autocorr=np.correlate(emphasized,emphasized,'full')[398:409]
            matrix=autocorr[np.abs(np.arange(10)[:,None]-np.arange(10))]
            matrix.flat[::11]+=autocorr[0]*.001+1e-6
            poles=np.roots(np.r_[1.,np.linalg.solve(matrix,-autocorr[1:])])
            centers=np.angle(poles)*8000/(2*np.pi);widths=-np.log(np.maximum(np.abs(poles),1e-9))*8000/np.pi
            formants=np.sort(centers[(centers>=250)&(centers<=3600)&(widths>=30)&(widths<=450)])
            if len(formants)>=3 and formants[2]>1900:resonance.append(formants[2])
    if len(pitches)<3:return 'neutral'
    lower,median,majority,upper=np.quantile(pitches,[.25,.5,.6,.75])
    third=float(np.median(resonance)) if len(resonance)>=4 else None
    if evidence is not None:evidence.update(f0_lower=round(float(lower)),f0_median=round(float(median)),f0_upper=round(float(upper)),
        resonance_hz=round(third) if third is not None else None,voiced_windows=len(pitches),resonance_windows=len(resonance))
    if third is not None and third<2580 and median<=205:return 'low'
    if median<=165 and upper<=177:return 'low'
    if median<=145 and majority<=155:return 'low'
    # A higher register needs consistent pitch or supporting resonance.
    if median>=180 and upper>=190 and (lower>=165 or third is not None and third>=2700):return 'high'
    return 'neutral'


class MetaStream:
    """Fixed Meta transport; one fresh-session recovery before any output only.

    Replaying after a delta can duplicate speech. Only transport timeout or
    unavailable errors with zero emitted deltas may use a second attempt.
    Refusal, HTTP 4xx, malformed responses and cancellation never retry.
    """
    def __init__(self, *, inline_video=False):
        self.lock=threading.RLock();self.closed=False;self.on_stage=None
        self.inline_video=inline_video
        self.session=self._new_session()
        self.configuration=(getattr(self.session,'model',None),getattr(self.session,'_key',None))
        self.attempts=0;self.recoveries=0;self.total_attempts=0;self.total_recoveries=0;self.usage={}

    def _new_session(self):
        options={'timeout_seconds':INLINE_MT_TIMEOUT} if self.inline_video else {}
        if self.inline_video and inline_translation_model() is not None:
            options['model_override'] = inline_translation_model()
        return MetaTranslationSession(max_completion_tokens=MAX_TOKENS,allow_transport_reopen=True,**options)

    def _replace_session(self,session):
        with self.lock:
            if self.closed:raise VoiceError('mt_session_closed','La sesión de traducción está cerrada.')
            session.close()
            fresh=self._new_session()
            if (getattr(fresh,'model',None),getattr(fresh,'_key',None))!=self.configuration:
                fresh.close();raise VoiceError('mt_configuration_changed','La configuración de Meta cambió durante la sesión. Vuelve a iniciar.')
            self.session=fresh

    def close(self):
        with self.lock:self.closed=True;session=self.session
        session.close()

    def prepare_transport(self):
        with self.lock:
            if self.closed:return False
            session=self.session
        return session.prepare_transport()

    def stream_for_duration(self,text,target,history,*,duration_ms):
        return self.stream(text,target,history,duration_ms=duration_ms if self.inline_video else None)

    def stream(self,text,target,history,*,duration_ms=None):
        context=[dict(row) if isinstance(row,dict) else {'source_text':row[0],'translated_text':row[1]} for row in history]
        duration_options={'duration_ms':duration_ms} if self.inline_video and duration_ms is not None else {}
        total=0;emitted=False;self.attempts=0;self.recoveries=0;self.usage={}
        def counters():return {'attempts':self.attempts,'recoveries':self.recoveries,
            'total_attempts':self.total_attempts,'total_recoveries':self.total_recoveries}
        try:
            for attempt in (1,2):
                with self.lock:
                    if self.closed:raise VoiceError('mt_session_closed','La sesión de traducción está cerrada.')
                    session=self.session;self.attempts=attempt;self.total_attempts+=1
                if self.on_stage:self.on_stage('mt_attempt',**counters())
                try:
                    for event in session.stream(text,'auto',target,context=context,**duration_options):
                        with self.lock:
                            if self.closed:raise VoiceError('mt_session_closed','La sesión de traducción está cerrada.')
                        if event['type']=='delta':
                            total+=len(event['text'])
                            if total>600:raise VoiceError('mt_output_limit','Un fragmento traducido excedió su límite.')
                            # An emitted delta, even empty, forbids replay.
                            emitted=True;yield event['text']
                        elif event['type']=='done':self.usage=dict(event.get('usage',{}))
                    return
                except Exception as error:
                    status=getattr(error,'http_status',None)
                    code=getattr(error,'code',None)
                    if type(status) is int and 400<=status<500:raise
                    if self.inline_video:
                        if code in TRANSIENT_MT_ERRORS:self._replace_session(session)
                        raise
                    if attempt!=1 or emitted or code not in {'mt_timeout','mt_unavailable'}:raise
                    self._replace_session(session)
                    self.recoveries+=1;self.total_recoveries+=1
                    if self.on_stage:self.on_stage('mt_recovery',**counters(),cause=0 if error.code=='mt_timeout' else 1)
        finally:self.usage.update(counters())


class LiveClauses(StableClauses):
    """Also commit eight stable words, holding two back without punctuation.

    Two cumulative observations are a heuristic. Later semantic revisions stop
    the session rather than incur duplicate translation/speech charges.
    """
    def accept(self,event,now=None):
        # Keep a rolling deduplication window, not a lifetime turn/text quota.
        self.total_characters=0
        if str(event['id']) not in self.turns and len(self.turns)>=64:
            for identifier,state in list(self.turns.items()):
                if state['final']:
                    del self.turns[identifier]
                    if len(self.turns)<64:break
        turn=str(event['id']);previous=self.turns.get(turn,{}).get('last','')
        segments=super().accept(event,now)
        if segments or event.get('final') is True:return segments
        state=self.turns[turn];text=state['last'];committed=state['committed']
        if not text.startswith(committed):return []
        common=0
        for first,second in zip(previous,text):
            if first!=second:break
            common+=1
        words=list(self.words(text[len(committed):common]))
        if len(words)<10:return []
        endpoint=len(committed)+words[7].end()
        chosen=text[len(committed):endpoint].strip()
        if not chosen or len(chosen)>400:return []
        segment=Segment(turn,state['index'],state['revision'],chosen,True,False,False,
            time.monotonic() if now is None else now)
        state['index']+=1;state['committed']=text[:endpoint]
        return [segment]


class VoiceSamples:
    """Keep 30 seconds of input and sample the ASR turn, not a newer speaker."""
    def __init__(self):self.frames=0;self.rows=deque(maxlen=375)
    def append(self,raw):self.rows.append((self.frames,raw));self.frames+=len(raw)//2
    def turn(self,at):
        return self.span(at,at+1 if type(at) in (int,float) else at,max_seconds=1)
    def span(self,start,end,*,max_seconds=8):
        """Bounded source interval in seconds, never audio from a newer turn."""
        if any(type(value) not in (int,float) or not math.isfinite(value) for value in (start,end,max_seconds)) or start<0 or end<=start or not 0<max_seconds<=8:return b''
        first=round(start*24000);last=min(round(end*24000),first+round(max_seconds*24000),self.frames)
        if not self.rows or first<self.rows[0][0] or first>=last:return b''
        return b''.join(raw[max(0,first-position)*2:min(len(raw),max(0,last-position)*2)] for position,raw in self.rows if position<last and position+len(raw)//2>first)


class SpeakerTracker:
    """Session-local ASR labels and stable catalog voices, never real identities.

    Catalog assignments survive pitch changes within a speaker. Inline video
    can revise a register when two distinct turns support the same correction.
    Inline pieces can receive provisional acoustic clusters before ASR labels.
    Labels from separate ASR connections never establish acoustic equivalence.
    An unknown sample cannot borrow the previous speaker merely by timing.
    """
    def __init__(self,voice_resolver=None):
        self.condition=threading.Condition(threading.RLock());self.turns={};self.speakers={};self.variants={'low':0,'high':0}
        self.voice_resolver=voice_resolver;self.acoustic_speakers=None
    def enable_acoustic(self,session=None):
        with self.condition:self.acoustic_speakers=session if session is not None else SessionSpeakers()
    def begin(self,turn):
        with self.condition:
            self.turns.setdefault(str(turn),{'label':None,'style':'neutral'})
            while len(self.turns)>128:self.turns.pop(next(iter(self.turns)))
    def observe(self,turn,label,*,namespace='live'):
        if turn is None or not isinstance(label,str) or len(label)!=1 or not 'A'<=label<='Z':return None
        turn=str(turn);self.begin(turn)
        with self.condition:
            row=self.turns[turn];row['label']=label
            if self.acoustic_speakers is not None:
                # A late A/B belongs to its own ASR stream. It may annotate
                # several pieces, but cannot merge contradictory audio groups.
                row['asr_namespace']=namespace
                for piece in self.turns.values():
                    if piece.get('source_turn')==turn:piece['label']=label;piece['asr_namespace']=namespace
                self.condition.notify_all();return self._metadata(turn)
            row['speaker_key']=(namespace,label)
            speaker=self.speakers.setdefault(row['speaker_key'],{'index':len(self.speakers)+1,'style':'neutral','voices':{}})
            if speaker['style']=='neutral' and row['style']!='neutral':speaker['style']=row['style']
            self.condition.notify_all();return self._metadata(turn)
    def associate(self,turn,sample,*,source_turn=None):
        """Bind this piece from audio, without inheriting a long ASR turn."""
        turn=str(turn);self.begin(turn)
        with self.condition:
            session=self.acoustic_speakers;row=self.turns[turn]
            if session is None:return None
            if row.get('acoustic_association',{}).get('cluster') is not None:return dict(row['acoustic_association'])
            row['source_turn']=str(source_turn) if source_turn is not None else turn
            original=self.turns.get(row['source_turn'],{})
            if original.get('label'):row['label']=original['label']
        result=session.associate(sample)
        with self.condition:
            row=self.turns[turn];row['acoustic_association']=dict(result)
            if result.get('cluster') is not None:
                row['speaker_key']=('acoustic',result['cluster'])
                self.speakers.setdefault(row['speaker_key'],{'index':len(self.speakers)+1,'style':'neutral','voices':{}})
                self.condition.notify_all()
        return result
    def cached_timbre(self,turn):
        """Reuse a confident cluster result for at most eight distinct pieces."""
        turn=str(turn)
        with self.condition:
            row=self.turns.get(turn,{})
            speaker=self.speakers.get(row.get('speaker_key'));cache=speaker.get('timbre_cache') if speaker else None
            if not cache or speaker.get('timbre_cache_pending'):return None
            if cache['value'].get('timbre_evidence_id')!=turn:
                association=row.get('acoustic_association',{});similarity=association.get('similarity')
                if association.get('reason')!='matched' or type(similarity) not in (int,float) or not math.isfinite(similarity) or similarity<TIMBRE_CACHE_MATCH_THRESHOLD:
                    return None
            if turn not in cache['turns']:
                if len(cache['turns'])>=8:return None
                cache['turns'].add(turn)
            return dict(cache['value'],timbre_evidence_cached=True)
    def remember_timbre(self,turn,result):
        """Keep advisory catalog style, never raw PCM or a person's gender."""
        if not isinstance(result,dict):return False
        confidence=result.get('timbre_confidence',0.)
        if result.get('voice_timbre') not in ('masculine','feminine') or type(confidence) not in (int,float) or not math.isfinite(confidence) or confidence<.8:return False
        turn=str(turn)
        with self.condition:
            row=self.turns.get(turn,{})
            key=row.get('speaker_key');speaker=self.speakers.get(key)
            if not speaker or key[0]!='acoustic':return False
            evidence=result.get('timbre_evidence_id')
            if not isinstance(evidence,str) or not evidence or len(evidence)>128:evidence=turn
            if result.get('timbre_evidence_cached') is True:return False
            seen=speaker.setdefault('timbre_seen_evidence',deque(maxlen=16))
            fresh=evidence not in seen
            if fresh:seen.append(evidence)
            value={'voice_timbre':result['voice_timbre'],'timbre_confidence':confidence,
                'timbre_inference_source':result.get('timbre_inference_source','local_robust_voice_timbre'),
                'timbre_evidence_id':evidence}
            if speaker.get('voice_timbre') is None:
                # The first independent model result is the reference even
                # when its MT context has not submitted its first TTS yet.
                speaker['voice_timbre']=result['voice_timbre']
                speaker['timbre_inference_source']=value['timbre_inference_source']
                speaker['timbre_reference_evidence_id']=evidence
            if speaker.get('voice_timbre') not in (None,result['voice_timbre']):
                # A new contrary sample must not become reusable evidence
                # before a second independent observation confirms the change.
                if not fresh:return False
                if not speaker.get('timbre_cache_pending'):
                    speaker['timbre_conflict_old_evidence']=frozenset(seen)
                speaker.pop('timbre_cache',None);speaker['timbre_cache_pending']=True
                return False
            if speaker.get('timbre_cache_pending') and (not fresh or evidence in speaker.get('timbre_conflict_old_evidence',())):
                return False
            if not fresh and evidence!=speaker.get('timbre_reference_evidence_id'):
                return False
            if fresh:speaker['timbre_reference_evidence_id']=evidence
            speaker.pop('timbre_cache_pending',None)
            speaker.pop('timbre_conflict_old_evidence',None);speaker.pop('timbre_correction',None)
            cache=speaker.get('timbre_cache')
            if cache and cache['value'].get('timbre_evidence_id')==evidence and cache['value']['voice_timbre']==value['voice_timbre']:
                return True
            speaker['timbre_cache']={'value':value,'turns':{turn}}
            return True
    def _metadata(self,turn):
        row=self.turns.get(str(turn),{});speaker=self.speakers.get(row.get('speaker_key'))
        acoustic=row.get('speaker_key',(None,))[0]=='acoustic'
        return {'speaker_label':f"Hablante {speaker['index']}" if speaker else 'Voz sin identificar',
            'speaker_index':speaker['index'] if speaker else None,'speaker_source':'local_acoustic_embedding' if acoustic else 'asr_diarization' if speaker else 'unassigned_turn',
            'speaker_provisional':acoustic,
            'turn_id':str(turn)}
    def metadata(self,turn):
        with self.condition:return self._metadata(turn)
    def voice(self,turn,sample,mode,*,stopped,wait=0,advisory=None,require_timbre=False):
        turn=str(turn);self.begin(turn);deadline=time.monotonic()+wait
        with self.condition:
            # In acoustic mode a late ASR label can annotate a piece but cannot
            # assign its key. Its completed association cannot improve by waiting.
            while self.acoustic_speakers is None and not self.turns[turn].get('speaker_key') and time.monotonic()<deadline and not stopped.is_set():self.condition.wait(min(.025,max(0,deadline-time.monotonic())))
            if stopped.is_set():return None
            row=self.turns[turn];key=row.get('speaker_key');speaker=self.speakers.get(key);choice=speaker if speaker else row
            register_source='local_pitch';acoustic={}
            if mode!='auto':
                style='low' if mode=='masculine' else 'high'
                register_source='manual'
            elif advisory is not None:
                register=advisory.get('voice_register')
                trusted=register in ('low','high') and advisory.get('register_confidence',0)>=.8
                observed=register if trusted else pitch_style(sample,acoustic)
                if trusted:register_source='meta_audio'
                resonance=acoustic.get('resonance_hz') or 0
                stable_pitch=acoustic.get('f0_upper',0)<=177 if observed=='low' else acoustic.get('f0_lower',0)>=165
                stable_resonance=0<resonance<2580 if observed=='low' else resonance>=2750
                reliable=trusted or (observed!='neutral' and len(sample)>=57600 and
                    acoustic.get('voiced_windows',0)>=12 and (stable_pitch or stable_resonance))
                if choice['style']=='neutral' and observed!='neutral':
                    # A short introduction can contain music or another voice.
                    # Keep its register provisional until evidence improves.
                    choice.setdefault('provisional_style',observed)
                    if reliable:choice['style']=observed
                elif speaker and reliable:
                    if observed==choice['style']:
                        speaker.pop('correction',None)
                    else:
                        correction=speaker.get('correction')
                        if correction and correction[0]==observed and correction[1]!=turn:
                            choice['style']=observed;speaker.pop('correction',None)
                        else:speaker['correction']=(observed,turn)
                style=choice['style'] if choice['style']!='neutral' else choice.get('provisional_style','neutral')
            else:
                if choice['style']=='neutral':
                    observed=pitch_style(sample)
                    if observed!='neutral':choice['style']=observed
                style=choice['style']
            # Unlabelled turns retain the legacy catalog voice, never a newly
            # invented speaker or a palette allocation based only on turnId.
            palette_style='high' if style=='high' else 'low'
            timbre_source='manual' if mode!='auto' else 'register_fallback'
            provisional_catalog=False
            if mode=='auto' and (advisory is not None or require_timbre):
                timbre_advice=advisory or {}
                timbre=timbre_advice.get('voice_timbre')
                confidence=timbre_advice.get('timbre_confidence',0)
                trusted=timbre in ('masculine','feminine') and type(confidence) in (int,float) and math.isfinite(confidence) and confidence>=.8
                cached_evidence=timbre_advice.get('timbre_evidence_cached') is True
                current_conflict=False
                if trusted:
                    evidence=timbre_advice.get('timbre_evidence_id')
                    if not isinstance(evidence,str) or not evidence or len(evidence)>128:evidence=turn
                    if speaker and key[0]=='acoustic':self.remember_timbre(turn,dict(timbre_advice,timbre_evidence_id=evidence))
                    prior=choice.get('voice_timbre')
                    if prior is None or prior==timbre:
                        choice['voice_timbre']=timbre
                        if not choice.get('timbre_cache_pending'):choice.pop('timbre_correction',None)
                    else:
                        correction=choice.get('timbre_correction')
                        eligible=not cached_evidence and (not (speaker and key[0]=='acoustic') or bool(choice.get('timbre_cache_pending')))
                        if eligible and correction and correction[0]==timbre and correction[1]!=evidence:
                            choice['voice_timbre']=timbre;choice.pop('timbre_correction',None)
                            choice['timbre_reference_evidence_id']=evidence
                            choice.pop('timbre_cache_pending',None);choice.pop('timbre_conflict_old_evidence',None)
                        else:
                            if eligible:choice['timbre_correction']=(timbre,evidence)
                            current_conflict=True
                            if eligible and speaker and key[0]=='acoustic':
                                speaker.pop('timbre_cache',None);speaker['timbre_cache_pending']=True
                    if choice.get('voice_timbre')==timbre:
                        if not choice.get('timbre_cache_pending'):
                            choice['timbre_inference_source']=timbre_advice.get('timbre_inference_source','meta_audio_timbre')
                            if speaker and key[0]=='acoustic':self.remember_timbre(turn,dict(timbre_advice,timbre_evidence_id=evidence))
                if choice.get('voice_timbre'):
                    selected_timbre=timbre if current_conflict else choice['voice_timbre']
                    palette_style='high' if selected_timbre=='feminine' else 'low'
                    provisional_catalog=current_conflict or bool(choice.get('timbre_cache_pending'))
                    timbre_source='local_timbre_conflict' if provisional_catalog else choice.get('timbre_inference_source','meta_audio_timbre')
                    if speaker and key[0]=='acoustic' and (not trusted or cached_evidence):
                        association=row.get('acoustic_association',{});similarity=association.get('similarity')
                        if association.get('reason')=='matched' and type(similarity) in (int,float) and math.isfinite(similarity) and similarity<TIMBRE_CACHE_MATCH_THRESHOLD:
                            provisional_catalog=True
                            if timbre_source!='local_timbre_conflict':timbre_source='weak_acoustic_timbre'
                    if not trusted and timbre_advice.get('timbre_inference_source')=='local_timbre_consensus':
                        provisional_catalog=True;timbre_source='local_timbre_uncertain'
                elif require_timbre or timbre_advice.get('timbre_inference_source')=='local_robust_voice_timbre':
                    # Missing/short/unknown speech and a model timeout need the
                    # same abstention as an uncertain result. Pitch remains
                    # register metadata, not evidence of a catalog gender.
                    palette_style='low';timbre_source='provisional_catalog';provisional_catalog=True
            if speaker:
                # Provisional category must not collapse independently grouped
                # speakers to one voice. Reuse the same bounded catalog palette
                # and stable assignment as confidently styled speakers.
                if palette_style not in speaker['voices']:
                    palette=VOICE_PALETTES[palette_style]
                    speaker['voices'][palette_style]=palette[self.variants[palette_style]%len(palette)]
                    self.variants[palette_style]+=1
                name,identifier=speaker['voices'][palette_style]
            else:name,identifier=('Skylar',VOICES['high']) if palette_style=='high' else ('Daniel',VOICES['low'])
            cloned=self.voice_resolver(row['label']) if mode=='auto' and speaker and key[0]=='live' and self.voice_resolver else None
            if cloned:name=f"Hablante {speaker['index']}";identifier=cloned
            return {'type':'voice-style','style':style,'voice_name':name,'voice_category':'feminine' if palette_style=='high' else 'masculine',
                'voice_id':identifier,'method':'authorized_voice_clone' if cloned else 'manual' if mode!='auto' else 'provisional_catalog' if provisional_catalog else 'local_acoustic_speaker' if key and key[0]=='acoustic' else 'asr_speaker_stable_pitch' if speaker else 'local_pitch_heuristic',
                'voice_category_is_identity':False,'voice_category_provisional':provisional_catalog,'cloned':bool(cloned),'register_source':register_source,'timbre_source':timbre_source,'acoustic':acoustic,**self._metadata(turn)}


class _SynchronizedSink:
    """No device or output worker: final cues are played by the owning browser."""
    def __init__(self):self.closed=False
    def set_levels(self,**_):pass
    def close(self):self.closed=True
    def finish(self,timeout=3):return True
    def stats(self):return {'backend':'synchronized_browser','physical_output_opened':False}


@dataclass(frozen=True)
class QueuedSegment:
    segment: Segment
    sample: bytes
    classification_sample: bytes
    source_bounds: dict
    speaker_turn: str
    timing_quality: str = 'asr_turn'
    content: str = 'unknown'


class RiverBridge(TranslationBridge):
    def __init__(self, http_port, port=0, *, mixer_factory=None, translator_factory=None, clock=None,allow_synchronized=False,prosody_factory=None,content_filter_factory=None,voice_agents_factory=None,caption_prefetch_factory=None,caption_source=None):
        super().__init__(http_port, port)
        self.mixer_factory=mixer_factory or open_native_audio
        self.translator_factory=translator_factory or MetaStream
        self.clock=clock or time.monotonic
        self.allow_synchronized=allow_synchronized is True
        self.prosody_factory=prosody_factory
        self.content_filter_factory=content_filter_factory
        self.voice_agents_factory=voice_agents_factory;self.voice_agents=None
        self.caption_prefetch_factory=caption_prefetch_factory
        self.caption_source=caption_source

    def handle(self, browser):
        if not self.lock.acquire(blocking=False):
            self.send(browser, {'type':'error','code':'busy','message':'Detén la traducción activa antes de iniciar otra.'}); return
        stopped=threading.Event(); completed=threading.Event(); asr_done=threading.Event(); prepared_done=threading.Event()
        send_lock=threading.Lock(); resources_lock=threading.Lock(); workers_lock=threading.Lock(); resources=[]; threads=[]
        context_condition=threading.Condition(threading.RLock()); contexts={}; play_order=deque(); discarded_contexts=deque(maxlen=16); context_slots=threading.BoundedSemaphore(MAX_CONTEXTS)
        prosody_jobs={};prosody_slots=threading.BoundedSemaphore(MAX_CONTEXTS)
        pending=queue.Queue(maxsize=16); ingress=queue.Queue(maxsize=4); active={'context':None,'bytes':0,'segments':0,'characters':0,
            'output_bytes':0,'first_input':None,'first_output':None,'tts_started':None,'tts_activity':self.clock(),
            'voice_mode':'auto','flow_paused':False,'input_at':self.clock(),'asr_processed_ms':0.,'mt_failures':0}
        audio_window=VoiceSamples(); speakers=SpeakerTracker();clauses=LiveClauses();turn_times={}; mixer=None; translator=None; muse=None; cartesia=None;voice_agents=None
        delivery_pace=DeliveryPace()
        closing_at=None; start=self.clock();caption_prefetch=None

        def emit(event):
            with send_lock:
                if not stopped.is_set(): self.send(browser,event)

        def stage(name,segment,**values):
            emit({'type':'stage-metrics','stage':name,'segment_id':segment.id,
                'at_ms':round((self.clock()-started)*1000,2),**values})

        def track(resource):
            with resources_lock:
                resources.append(resource)
                if stopped.is_set(): resource.close()
            return resource

        def cancel():
            stopped.set()
            # Local output is silenced before remote connection close handshakes.
            if mixer:
                try: mixer.close()
                except Exception: pass
            with context_condition:
                identifiers=list(contexts);context_condition.notify_all()
            if cartesia:
                for identifier in identifiers:
                    try: cartesia.send(json.dumps({'context_id':identifier,'cancel':True}))
                    except Exception: pass
            with resources_lock: snapshot=list(resources)
            for resource in snapshot:
                try: resource.close()
                except Exception: pass
            if translator:
                try: translator.close()
                except Exception: pass
            if caption_prefetch:caption_prefetch.close()

        def fail(exc):
            if stopped.is_set(): return
            code=getattr(exc,'code',None) if not isinstance(exc,ConnectionClosed) else None
            if not isinstance(code,str):code='translation_interrupted'
            message=str(exc) if isinstance(exc,VoiceError) or code.startswith('native_audio') else 'La conexión se interrumpió. Se detuvo todo sin reintentar.'
            report_error=getattr(browser,'report_error',None)
            if report_error:report_error(code)
            provider_status = getattr(exc, 'provider_status', None)
            diagnostics = {'provider_status': provider_status} if type(provider_status) is int and 100 <= provider_status <= 599 else {}
            try: emit({'type':'error','code':code,'message':message,**diagnostics})
            finally: cancel()

        def run(function):
            def wrapped():
                try: function()
                except Exception as exc: fail(exc)
            thread=threading.Thread(target=wrapped,daemon=True)
            with workers_lock:
                if stopped.is_set():return
                threads[:]=[worker for worker in threads if worker.is_alive()]
                threads.append(thread)
                thread.start()

        try:
            raw=browser.recv(timeout=8)
            options=json.loads(raw) if isinstance(raw,str) else None
            if not isinstance(options,dict) or set(options)-{'type','consent','target_language','original_gain','voice_mode','continuous_input','diarization','synchronized_output','epoch','expressive','skip_songs','inline_video'} or options.get('type')!='start' or options.get('consent') is not True:
                raise VoiceError('options','Inicia desde el botón para enviar el audio de este video.')
            synchronized=options.get('synchronized_output',False);epoch=options.get('epoch',1)
            inline_video=options.get('inline_video',False)
            if type(inline_video) is not bool or inline_video and not synchronized:raise VoiceError('options','La traducción en la pestaña requiere un reloj de video.')
            prepared_prefix=getattr(browser,'prepared_prefix',None) if inline_video else None
            resume_ms=prepared_prefix.resume_from_ms if prepared_prefix else 0
            resume_bytes=resume_ms*48
            prepared_advisories={}
            if type(synchronized) is not bool or synchronized and not self.allow_synchronized:raise VoiceError('sync_unavailable','La reproducción sincronizada requiere el enlace autorizado del navegador.')
            if type(epoch) is not int or not 1<=epoch<=2147483647:raise VoiceError('sync_epoch','La época del reproductor no es válida.')
            expressive=options.get('expressive',True)
            skip_songs=options.get('skip_songs',True)
            if type(skip_songs) is not bool:raise VoiceError('content_filter_options','El filtro de canciones no es válido.')
            content_filter=None
            if skip_songs or inline_video:
                from .audio_content import SingingFilter
                try:content_filter=(self.content_filter_factory or SingingFilter)()
                except (ImportError,OSError,ValueError,RuntimeError):raise VoiceError('content_filter_unavailable','No se pudo cargar el detector de canciones. Revisa la instalación de Brivany.') from None
            if type(expressive) is not bool:raise VoiceError('prosody_options','El modo expresivo no es válido.')
            continuous_input=options.get('continuous_input',False)
            if type(continuous_input) is not bool:raise VoiceError('options','El modo de entrada continua no es válido.')
            diarization=options.get('diarization',False)
            if type(diarization) is not bool:raise VoiceError('options','El modo de hablantes no es válido.')
            if self.voice_agents_factory:
                diarization=True;voice_agents=self.voice_agents_factory();self.voice_agents=voice_agents;speakers.voice_resolver=voice_agents.voice_for
            if synchronized and not continuous_input:raise VoiceError('sync_input','El reproductor sincronizado requiere entrada continua.')
            target=options.get('target_language')
            if not isinstance(target,str) or target not in LANGUAGES: raise VoiceError('language','Elige español, inglés o francés.')
            gain=options.get('original_gain',0)
            if type(gain) not in {int,float} or not math.isfinite(gain) or not 0<=gain<=1: raise VoiceError('volume','Volumen original no válido.')
            voice_mode=options.get('voice_mode','auto')
            if voice_mode not in {'auto','masculine','feminine'}:raise VoiceError('voice_mode','Elige voz automática, masculina o femenina.')
            active['voice_mode']=voice_mode
            configuration=river_status()
            if not configuration['configured']: raise VoiceError('configuration','Falta configurar una de las tres APIs en el servidor local.')
            if configuration['access_blocked']: raise VoiceError('access_blocked','Una API rechazó el acceso. Corrige la conexión y comprueba los metadatos antes de consumir audio.')
            if inline_video:
                speakers.enable_acoustic();run(warm_speaker_embedding)
            # Open the local output first. Missing device cannot start a paid ASR.
            mixer=_SynchronizedSink() if synchronized else self.mixer_factory(); mixer.set_levels(original=gain,translation=.85)
            if synchronized or self.caption_source:
                from .caption_prefetch import CaptionPrefetch
                caption_prefetch=(self.caption_prefetch_factory or CaptionPrefetch)(target,translator_factory=self.translator_factory,epoch=epoch)
            # Native CapturePeer has a single producer. Reserve capacity before
            # dequeuing the next PCM block, retaining it in the bounded capture
            # queue during a slow Muse.send. Controls/stop still bypass PCM.
            # Browser WebSockets keep their existing ingress/flood boundary.
            if callable(getattr(browser,'set_input_capacity',None)):
                browser.set_input_capacity(lambda:not ingress.full())
            def receive_browser():
                try:
                    while not stopped.is_set():
                        try: packet=browser.recv(timeout=.1)
                        except TimeoutError: continue
                        if isinstance(packet,str):
                            control=json.loads(packet)
                            if control=={'type':'stop'}:cancel();return
                            if isinstance(control,dict) and set(control)=={'type','mode'} and control['type']=='voice_mode':
                                if control['mode'] not in {'auto','masculine','feminine'}:raise VoiceError('voice_mode','Voz no válida.')
                                active['voice_mode']=control['mode'];continue
                            if inline_video and isinstance(control,dict) and control.get('type')=='caption-lookahead':
                                caption_prefetch.offer(control);continue
                        arrival=(self.clock(),packet)
                        if inline_video:
                            deadline=time.monotonic()+2
                            while not stopped.is_set():
                                try:ingress.put(arrival,timeout=.05);break
                                except queue.Full:
                                    if time.monotonic()>=deadline:raise VoiceError('ingress_backlog','Muse dejó de aceptar audio durante dos segundos.') from None
                        else:
                            try:ingress.put_nowait(arrival)
                            except queue.Full:raise VoiceError('ingress_backlog','Se acumuló demasiado audio de entrada. Sesión detenida.') from None
                except ConnectionClosed: cancel()
            run(receive_browser)
            def watchdog():
                while not stopped.wait(.1):
                    if closing_at is not None:continue
                    inactive=self.clock()-active['input_at']
                    if inline_video and active['first_input'] is not None and inactive>INLINE_ASR_LAG_MS/1000:
                        fail(VoiceError('muse_input_gap','Se interrumpió el audio enviado a Muse. El video puede continuar con su audio original.'));return
                    if inactive>30:
                        fail(VoiceError('input_inactive','Dejó de llegar audio del navegador. Todo se detuvo sin reconectar.')); return
            run(watchdog)
            translator=MetaStream(inline_video=True) if inline_video and self.translator_factory is MetaStream else self.translator_factory()
            # Both inline MT workers need their own serial HTTP connection.
            # Prepare verified TLS while ASR/TTS are connecting, rather than
            # charging the second clause for its first connection handshake.
            # This opens no HTTP request and performs no model inference.
            second=track(MetaStream(inline_video=True) if self.translator_factory is MetaStream else self.translator_factory()) if inline_video else None
            if self.caption_source:
                def anticipate_selected_video():
                    while not stopped.is_set():
                        try:
                            snapshot=self.caption_source()
                            if snapshot:caption_prefetch.offer(snapshot)
                        except Exception:pass # Captions are optional input.
                        if stopped.wait(4):return
                run(anticipate_selected_video)
            if synchronized or self.caption_source:
                for worker_translator in (translator,second):
                    if callable(getattr(worker_translator,'prepare_transport',None)):run(worker_translator.prepare_transport)
            with self.connections_lock: self.connections.add(browser)
            # Prepared audio gives inline playback its initial ASR watermark.
            # Open live Muse near the handoff to avoid an idle paid socket.
            tts_ready=threading.Event();asr_ready=threading.Event();asr_requested=threading.Event();pipeline_ready_sent=threading.Event()
            if not resume_ms:asr_requested.set()
            def setup_tts():
                nonlocal cartesia
                cartesia=track(connect(CARTESIA_URL,additional_headers={'X-API-Key':os.environ['BRIVANY_CARTESIA_API_KEY']},
                    open_timeout=5,close_timeout=1,max_size=262144,max_queue=4,compression=None,proxy=None))
                if not stopped.is_set():tts_ready.set()
            def setup_asr():
                nonlocal muse
                while not asr_requested.wait(.05):
                    if stopped.is_set() or asr_done.is_set():return
                if stopped.is_set() or asr_done.is_set():return
                muse=track(connect(MUSE_URL,open_timeout=5,close_timeout=1,max_size=65536,max_queue=4,compression=None,proxy=None))
                if stopped.is_set():return
                # Keep ASR speaker boundaries as well as the independent local
                # acoustic groups. The endpointing experiment 078 did not meet
                # continuity criteria and merged the prepared opening.
                handshake=muse_handshake({'type':'start','consent':True,'mode':'meeting' if diarization else 'practice','meetingConsent':True,'language':'es-ES'})
                handshake['languageBias']=['Spanish','English','French']
                if synchronized:handshake['emitAudioProgress']=True
                try:
                    muse.send(json.dumps(handshake));ack=json.loads(muse.recv(timeout=5))
                except ConnectionClosed as exc:
                    if inline_video:raise inline_muse_close(exc) from None
                    raise
                if not isinstance(ack,dict) or not isinstance(ack.get('sessionId'),str):raise VoiceError('muse_rejected','Muse rechazó el acceso. No se reintentó.')
                if not stopped.is_set():asr_ready.set()
                if inline_video:
                    while not pipeline_ready_sent.wait(.025):
                        if stopped.is_set():return
                    emit({'type':'live-asr-connected','epoch':epoch,'resume_from_ms':resume_ms})
            run(setup_tts);run(setup_asr)
            while not stopped.is_set() and not (resume_ms or asr_ready.is_set() and (inline_video or tts_ready.is_set())):stopped.wait(.01)
            if stopped.is_set():return
            started=self.clock();pacing=PCMRateGate(started)
            emit({'type':'ready','max_seconds':None,'continuous':True,'sample_rate':24000,'diarization':diarization,
                'acoustic_speakers':inline_video,
                'synchronized_output':synchronized,'epoch':epoch})
            pipeline_ready_sent.set()

            def prosody_default(code):
                return {'emotion':'neutral','confidence':0.,'source':'meta_audio_inference','available':False,'applied':False,'error_code':code}

            def start_prosody(turn,bounds,*,sample_policy='speech_end'):
                """Analyze a timestamped speech prefix or a real speechEnd.

                No MT/TTS is started from partial text. At most two independent
                advisory calls run; a full slot is a recorded unavailable result,
                never queued work that could add another delay before synthesis.
                """
                with context_condition:
                    if turn in prosody_jobs:return prosody_jobs[turn]
                with resources_lock:sample=audio_window.span(bounds.get('start',-1)/1000,bounds.get('end',-1)/1000,max_seconds=4)
                # A progress watermark alone isn't proof that all source PCM
                # is still available locally. Wait for a later watermark/end
                # instead of caching an empty or shortened speculative sample.
                if sample_policy=='speech_prefix' and len(sample)!=round((bounds['end']-bounds['start'])*48):return None
                with context_condition:
                    if turn in prosody_jobs:return prosody_jobs[turn]
                    job={'prosody':prosody_default('prosody_disabled' if not expressive else 'prosody_unconfigured'),
                        'prosody_done':threading.Event(),'prosody_resource':None,'prosody_expired':False,'deadline':time.monotonic()+3}
                    prosody_jobs[turn]=job
                    while len(prosody_jobs)>128:
                        stale=next((key for key,value in prosody_jobs.items() if key!=turn and value['prosody_done'].is_set()),None)
                        if stale is None:break
                        del prosody_jobs[stale]
                if not synchronized or not expressive or not self.prosody_factory:
                    job['prosody_done'].set();return job
                if not sample:
                    job['prosody']=prosody_default('prosody_no_audio');job['prosody_done'].set();return job
                if not prosody_slots.acquire(blocking=False):
                    job['prosody']=prosody_default('prosody_busy');job['prosody_done'].set();return job
                segment=Segment(turn,0,0,'',False,False,False,self.clock())
                stage('prosody_start',segment,sample_ms=round(len(sample)/48,2),
                    sample_start_ms=bounds['start'],sample_end_ms=round(bounds['start']+len(sample)/48,2),sample_policy=sample_policy)
                def expire():
                    with context_condition:
                        if job['prosody_done'].is_set():return
                        job['prosody_expired']=True;job['prosody']=prosody_default('prosody_timeout');analyzer=job['prosody_resource']
                        job['prosody_done'].set()
                    if analyzer:
                        try:analyzer.close()
                        except Exception:pass
                    stage('prosody_timeout',segment,available=False,applied=False)
                timer=threading.Timer(max(0,job['deadline']-time.monotonic()),expire);timer.daemon=True;timer.start()
                def analyze_prosody():
                    analyzer=None
                    try:
                        analyzer=self.prosody_factory()
                        with context_condition:job['prosody_resource']=analyzer
                        track(analyzer)
                        if stopped.is_set() or job['prosody_expired']:return
                        result=analyzer.analyze(sample,cancelled=stopped)
                        if not isinstance(result,dict):raise ValueError('Invalid advisory metadata')
                        emotion=result.get('emotion');confidence=result.get('confidence')
                        if not isinstance(emotion,str) or emotion not in PROSODY_EMOTIONS or type(confidence) not in (int,float) or not math.isfinite(confidence) or not 0<=confidence<=1:raise ValueError('Invalid advisory metadata')
                        available=result.get('available',True) is True
                        safe={'emotion':emotion if available else 'neutral','confidence':float(confidence) if available else 0.,
                            'source':'meta_audio_inference','available':available,'applied':available and confidence>=.7 and target=='en'}
                        register=result.get('voice_register');register_confidence=result.get('register_confidence')
                        if available and register in ('low','high','uncertain') and type(register_confidence) in (int,float) and 0<=register_confidence<=1:
                            safe.update(voice_register=register,register_confidence=register_confidence)
                        timbre=result.get('voice_timbre');timbre_confidence=result.get('timbre_confidence')
                        if available and timbre in ('masculine','feminine','uncertain') and type(timbre_confidence) in (int,float) and math.isfinite(timbre_confidence) and 0<=timbre_confidence<=1:
                            safe.update(voice_timbre=timbre,timbre_confidence=timbre_confidence)
                        if not available:safe['error_code']='prosody_unavailable'
                        with context_condition:
                            if not job['prosody_expired']:job['prosody']=safe
                    except Exception:
                        with context_condition:
                            if not job['prosody_expired']:job['prosody']=prosody_default('prosody_unavailable')
                    finally:
                        timer.cancel()
                        if analyzer:
                            try:analyzer.close()
                            except Exception:pass
                            with resources_lock:
                                if analyzer in resources:resources.remove(analyzer)
                        job['prosody_done'].set();prosody_slots.release()
                        stage('prosody_done',segment,available=job['prosody']['available'],applied=job['prosody']['applied'])
                run(analyze_prosody)
                return job

            def receive_tts():
                while not tts_ready.wait(.05):
                    if stopped.is_set():return
                while not stopped.is_set():
                    try: raw=cartesia.recv(timeout=.2)
                    except TimeoutError: continue
                    if not isinstance(raw,str): raise VoiceError('cartesia_protocol','Cartesia envió un evento no válido.')
                    event=json.loads(raw)
                    if not isinstance(event,dict): raise VoiceError('cartesia_protocol','Evento de voz no válido.')
                    now=self.clock()
                    with context_condition:
                        context_id=event.get('context_id')
                        if context_id in discarded_contexts:continue
                        context=contexts.get(context_id)
                    if event.get('type')=='error': raise cartesia_failure(event)
                    if context is None:continue
                    if event.get('type')=='done':
                        if inline_video and not context['done'] and context['final'] and context['voice']:
                            delivery_pace.observe(context['voice']['voice_id'],context['translated'],context['received']/48,context.get('delivery_speed',1.))
                        with context_condition:context['done']=True;context['activity']=now;context_condition.notify_all()
                        last_chunk = context.get('last_chunk_at')
                        chunk_timing = {} if last_chunk is None else {
                            'request_to_last_chunk_ms': round((last_chunk - context['requested']) * 1000, 2),
                            'last_chunk_to_done_ms': round((now - last_chunk) * 1000, 2),
                        }
                        stage('tts_done',context['segment'],audio_ms=round(context['received']/48,2),
                            synthesis_speed=context.get('delivery_speed',1.),translated_word_count=spoken_word_count(context['translated']),
                            **chunk_timing);continue
                    if event.get('type')!='chunk':continue
                    data=base64.b64decode(event.get('data',''),validate=True)
                    if not data or len(data)%2:raise VoiceError('audio_format','Cartesia envió un bloque PCM no válido.')
                    with context_condition:
                        if context['received']+len(data)>MAX_CONTEXT_AUDIO_BYTES:raise VoiceError('tts_context_limit','Una cláusula excedió treinta segundos de voz. Sesión detenida.')
                        first=context['received']==0;context['received']+=len(data);context['audio'].append(data);context['activity']=now
                        context['last_chunk_at'] = now
                        active['output_bytes']+=len(data);context_condition.notify_all()
                    if first:stage('tts_first',context['segment'],request_to_first_ms=round((now-context['requested'])*1000,2))

            def receive_asr():
                events=MuseEvents();turn_audio={}
                inline_clauses=InlineClauses() if inline_video else None
                provisional=None;prepared_first=False

                def queue_inline_piece(piece, speaker_turn):
                    bounds={'start':piece.start_ms,'end':piece.end_ms}
                    cue={'epoch':epoch,'cue_id':'utterance-'+piece.chunk_id,
                         'source_start_ms':piece.start_ms,'source_end_ms':piece.end_ms}
                    if piece.skip_reason:
                        emit({'type':'source-skipped',**cue,'reason':piece.skip_reason})
                        return
                    emit({'type':'source-turn',**cue,'phase':'end'})
                    if piece.next_id:
                        emit({'type':'source-turn','epoch':epoch,'cue_id':'utterance-'+piece.next_id,
                              'source_start_ms':piece.end_ms,'source_end_ms':None,'phase':'start'})
                    segment=Segment(piece.chunk_id,0,0,piece.text,False,False,False,self.clock())
                    start,end=piece.start_ms/1000,piece.end_ms/1000
                    edge=min(.12,(end-start)*.05)
                    with resources_lock:
                        sample=audio_window.span(start+edge,end-edge,max_seconds=8)
                        classification_sample=audio_window.span(max(start,end-3),end,max_seconds=3)
                    stage('segment_ready',segment,source_start_ms=piece.start_ms,
                          timing_quality=piece.timing_quality,input_ms=round(active['bytes']/48,2))
                    try:pending.put_nowait(QueuedSegment(segment,sample,classification_sample,bounds,speaker_turn,piece.timing_quality))
                    except queue.Full:
                        emit({'type':'source-skipped',**cue,'reason':'translation_backlog'})

                try:
                    while not asr_ready.wait(.05):
                        if stopped.is_set() or asr_done.is_set():return
                    if asr_done.is_set():return
                    while not stopped.is_set():
                        try: raw=muse.recv(timeout=.2)
                        except TimeoutError: continue
                        if not isinstance(raw,str): raise VoiceError('muse_protocol','Muse envió un evento no válido.')
                        event=json.loads(raw)
                        if not isinstance(event,dict): raise VoiceError('muse_protocol','Muse envió un evento no válido.')
                        at=event.get('audioProcessedMs')
                        if resume_ms and type(at) in (int,float) and math.isfinite(at) and at>=0:
                            event['audioProcessedMs']=at+resume_ms
                        if inline_video and event.get('type')=='error':
                            message=event.get('message')
                            if isinstance(message,str):
                                reason=message[:300].casefold()
                                if any(marker in reason for marker in ('backlog','below real','below-real','pacing','too fast','too slow','idle input')):
                                    raise VoiceError('muse_pacing','Muse interrumpió la traducción por el ritmo de entrada. El video puede continuar con su audio original.')
                        if synchronized and event.get('type')=='audioProgress':
                            processed=event.get('audioProcessedMs')
                            if type(processed) in (int,float) and math.isfinite(processed) and processed>=0:
                                if inline_video and processed<=active['bytes']/48:
                                    active['asr_processed_ms']=max(active['asr_processed_ms'],processed)
                                emit({'type':'source-progress','epoch':epoch,'processed_ms':float(processed)})
                                if inline_video and provisional and not prepared_first:
                                    turn,text,changed_at=provisional
                                    if turn==events.active and processed-changed_at>=560:
                                        offer=getattr(caption_prefetch,'offer_recognized',None)
                                        if offer and offer(text):prepared_first=True
                                # The real ASR watermark makes a 1.6 s speech
                                # prefix eligible. This is only an advisory
                                # audio sample; it never sets the utterance end
                                # and cannot start MT/TTS before the final text.
                                with resources_lock:open_turns=[(turn,dict(bounds)) for turn,bounds in turn_times.items() if 'start' in bounds and 'end' not in bounds]
                                for turn,bounds in open_turns:
                                    if processed>=bounds['start']+1600:
                                        start_prosody(turn,{'start':bounds['start'],'end':bounds['start']+1600},sample_policy='speech_prefix')
                        if synchronized and event.get('type') in {'speechStart','speechEnd','speechComplete'}:
                            identifier=str(event.get('turnId'));at=event.get('audioProcessedMs')
                            if type(at) in (int,float) and math.isfinite(at) and at>=0:
                                with resources_lock:
                                    bounds=turn_times.setdefault(identifier,{})
                                    if event['type']=='speechStart':bounds['start']=float(at)
                                    elif event['type']=='speechEnd':bounds['end']=float(at)
                                    else:bounds.setdefault('end',float(at))
                                    while len(turn_times)>128:turn_times.pop(next(iter(turn_times)))
                                if event['type']=='speechStart':
                                    if inline_clauses:inline_clauses.start(identifier,float(at))
                                    emit({'type':'source-turn','epoch':epoch,'cue_id':'utterance-'+identifier,
                                        'source_start_ms':float(at),'source_end_ms':None,'phase':'start'})
                                elif event['type']=='speechEnd' and 'start' in bounds:
                                    current=inline_clauses.current(identifier) if inline_clauses else None
                                    piece_id,piece_start=current if current else (identifier,bounds['start'])
                                    if piece_start<=at:
                                        emit({'type':'source-turn','epoch':epoch,'cue_id':'utterance-'+piece_id,
                                            'source_start_ms':piece_start,'source_end_ms':float(at),'phase':'end'})
                                    start_prosody(identifier,dict(bounds))
                        normalized=events.accept(event)
                        if event.get('type')=='speaker':
                            metadata=speakers.observe(events.speaker_turn,event.get('label'))
                            if metadata:emit({'type':'speaker','observation':True,**metadata})
                        if not normalized:continue
                        if normalized['type']=='speech-start':
                            speakers.begin(normalized['id'])
                            at=event.get('audioProcessedMs')
                            with resources_lock:
                                turn_audio[normalized['id']]=at/1000 if type(at) in (int,float) and math.isfinite(at) and at>=0 else max(0,audio_window.frames/24000-.32)
                            while len(turn_audio)>64:turn_audio.pop(next(iter(turn_audio)))
                            continue
                        if normalized['type']!='transcript':continue
                        if inline_video and not prepared_first:
                            at=event.get('audioProcessedMs');text=' '.join(normalized['text'].split())
                            if normalized['final']:provisional=None
                            elif type(at) in (int,float) and math.isfinite(at) and at>=0 and (not provisional or provisional[:2]!=(normalized['id'],text)):
                                provisional=(normalized['id'],text,at)
                        if normalized.get('speaker'):speakers.observe(normalized['id'],normalized['speaker'])
                        if voice_agents and normalized['final']:
                            label=normalized.get('speaker')
                            with resources_lock:
                                begin=turn_audio.get(normalized['id']);processed_at=event.get('audioProcessedMs')
                                end=processed_at/1000 if type(processed_at) in (int,float) and math.isfinite(processed_at) and processed_at>=0 else None
                                if begin is not None and end is not None:
                                    last=min(end,begin+8);clip=audio_window.span(begin,last)
                                    voice_agents.observe(normalized['id'],label,clip,begin,last)
                        emit({'type':'transcript','source':'original','text':normalized['text'],'final':normalized['final'],
                            'turn_id':normalized['id'],'asr_label':normalized.get('speaker'),'at':normalized.get('at',0)})
                        if inline_clauses:
                            identifier=normalized['id'];text=normalized['text']
                            with resources_lock:bounds=dict(turn_times.get(identifier,{}))
                            if normalized['final']:
                                if not inline_clauses.current(identifier) or set(bounds)!={'start','end'}:
                                    if text.strip():raise VoiceError('sync_timing','Muse no confirmó los límites temporales de esta intervención.')
                                    continue
                                piece=inline_clauses.final(identifier,text,bounds['end'])
                            else:
                                at=event.get('audioProcessedMs')
                                piece=inline_clauses.partial(identifier,text,at) if 'end' not in bounds else None
                            if piece:queue_inline_piece(piece,identifier)
                            continue
                        if synchronized:
                            if not normalized['final']:continue
                            text=' '.join(normalized['text'].split())
                            with resources_lock:bounds=dict(turn_times.get(normalized['id'],{}))
                            if not text or inline_video and len(text)>800:
                                if set(bounds)=={'start','end'} and bounds['end']>=bounds['start']:
                                    emit({'type':'source-skipped','epoch':epoch,'cue_id':'utterance-'+normalized['id'],
                                        'source_start_ms':bounds['start'],'source_end_ms':bounds['end'],
                                        'reason':'empty_transcript' if not text else 'long_turn'})
                                continue
                            if len(text)>800:raise VoiceError('sync_turn_limit','Una intervención excedió el tamaño de traducción sincronizada.')
                            if set(bounds)!={'start','end'} or bounds['end']<=bounds['start']:raise VoiceError('sync_timing','Muse no confirmó los límites temporales de esta intervención.')
                            segments=[Segment(normalized['id'],0,0,text,False,False,False,self.clock())]
                        else:segments=clauses.accept(normalized)
                        for segment in segments:
                            # Never synthesize a late replacement of already heard speech.
                            if segment.correction: raise VoiceError('asr_revision','Muse corrigió una cláusula ya emitida. Se detuvo para evitar repetir una traducción incierta.')
                            timing={'input_ms':round(active['bytes']/48,2)}
                            source_at=normalized.get('at');processed=event.get('audioProcessedMs')
                            if type(source_at) in (int,float) and math.isfinite(source_at) and source_at>=0:timing['source_start_ms']=round(source_at*1000,2)
                            if type(processed) in (int,float) and math.isfinite(processed) and processed>=0:timing['asr_processed_ms']=round(processed,2)
                            stage('segment_ready',segment,**timing)
                            with resources_lock:
                                if synchronized:
                                    bounds=turn_times[segment.turn_id]
                                    start,end=bounds['start']/1000,bounds['end']/1000
                                    edge=min(.12,(end-start)*.05) if inline_video else 0
                                    sample=audio_window.span(start+edge,end-edge,max_seconds=8 if inline_video else 2.4)
                                else:sample=audio_window.turn(turn_audio.get(normalized['id'],normalized.get('at')))
                                end=float(processed)/1000 if type(processed) in (int,float) and math.isfinite(processed) and processed>=0 else audio_window.frames/24000
                                start=max(float(turn_audio.get(normalized['id'],normalized.get('at',0)) or 0),end-3)
                                classification_sample=audio_window.span(start,end,max_seconds=3)
                            with resources_lock:source_bounds=dict(turn_times.get(segment.turn_id,{}))
                            try: pending.put_nowait(QueuedSegment(segment,sample,classification_sample,source_bounds,segment.turn_id))
                            except queue.Full: raise VoiceError('backlog','La traducción acumuló demasiadas cláusulas pendientes. Detenido sin omitir audio ni reconectar.')
                            # External system audio keeps playing. Pausing its
                            # ASR stream violates realtime cadence and creates
                            # unbounded capture delay; its bounded queue fails
                            # explicitly instead. App/replay retain flow control.
                            if not continuous_input and pending.qsize()>=2 and not active['flow_paused']:
                                active['flow_paused']=True;emit({'type':'flow-control','paused':True})
                except ConnectionClosedOK:
                    if closing_at is None: raise VoiceError('muse_incomplete','Muse cerró antes de terminar la entrada.')
                except ConnectionClosed as exc:
                    if inline_video:raise inline_muse_close(exc) from None
                    raise
                finally: asr_done.set()

            prepare_order=threading.Lock();translation_history=deque(maxlen=2)
            timbre_slots=threading.BoundedSemaphore(2)

            def prepare(worker_translator):
                history=[]
                while not stopped.is_set():
                    # Reserve source order before independent MT requests
                    # overlap. Only inline delivery may publish one ready cue
                    # ahead, while the browser still plays it in source order.
                    with prepare_order:
                        try: queued=pending.get(timeout=.1)
                        except queue.Empty:
                            if asr_done.is_set():
                                prepared_done.set()
                                with context_condition:context_condition.notify_all()
                                return
                            continue
                        segment=queued.segment
                        speech_confirmed=queued.content=='speech'
                        if active['flow_paused'] and pending.qsize()<=1 and closing_at is None:
                            active['flow_paused']=False;emit({'type':'flow-control','paused':False})
                        if content_filter and not segment.turn_id.startswith('prefix-'):
                            decision=content_filter.classify(queued.classification_sample)
                            speech_confirmed=decision.get('kind')=='speech'
                            emit({'type':'content-filter','filtered':decision['skip'] and skip_songs,'content':decision['kind'],'latency_ms':decision['latency_ms']})
                            if decision['skip'] and skip_songs:
                                stage('song_skipped',segment,content=decision['kind'])
                                if synchronized:
                                    bounds=queued.source_bounds
                                    emit({'type':'source-skipped','epoch':epoch,'cue_id':'utterance-'+segment.turn_id,'source_start_ms':bounds.get('start'),'source_end_ms':bounds.get('end'),'reason':decision['kind']})
                                continue
                        while not stopped.is_set() and not context_slots.acquire(timeout=.05):pass
                        if stopped.is_set():return
                        if active['flow_paused'] and pending.qsize()<=1 and closing_at is None:
                            active['flow_paused']=False;emit({'type':'flow-control','paused':False})
                        active['segments']+=1
                        active['characters']+=len(segment.text)
                        identifier=uuid4().hex
                        source_bounds=queued.source_bounds
                        context={'segment':segment,'audio':deque(),'received':0,'done':False,'requested':None,'activity':self.clock(),'source_bounds':source_bounds,
                            'playing':False,'translated':'','final':False,'voice':None,'translation_ms':None,'usage':{},
                            'speaker_turn':segment.turn_id if inline_video else queued.speaker_turn,'timing_quality':queued.timing_quality,
                            'prosody':prepared_advisories.get(segment.turn_id,prosody_default('prosody_disabled' if not expressive else 'prosody_no_speech_end'))}
                        with context_condition:contexts[identifier]=context;play_order.append(identifier);context_condition.notify_all()
                        history_row={'source_text':segment.text}
                        request_history=[dict(row) for row in translation_history] if inline_video else history
                        if inline_video:translation_history.append(history_row)
                    if inline_video and speech_confirmed:
                        association=speakers.associate(segment.turn_id,queued.sample,source_turn=queued.speaker_turn)
                        if association:
                            stage('speaker_acoustic',segment,cluster=association['cluster'],
                                similarity=association['similarity'],reason=association['reason'],
                                windows=association['windows'],latency_ms=association['latency_ms'])
                    context['timbre_ready']=threading.Event()
                    context['timbre_result']=None
                    if inline_video and speech_confirmed:
                        if segment.turn_id.startswith('prefix-'):
                            speakers.remember_timbre(context['speaker_turn'],context['prosody'])
                            context['timbre_ready'].set()
                        else:
                            cached_timbre=speakers.cached_timbre(context['speaker_turn'])
                            if cached_timbre:
                                context['timbre_result']=cached_timbre
                                context['timbre_ready'].set()
                            else:
                                # At most two bounded local analyses overlap MT.
                                # A failed MT turn cannot leave an unbounded CPU queue.
                                while not stopped.is_set() and not timbre_slots.acquire(timeout=.05):pass
                                if stopped.is_set():return
                                def infer_timbre(local=context,sample=queued.sample,piece=segment):
                                    try:
                                        if stopped.is_set():return
                                        result=analyze_timbre(sample)
                                        if stopped.is_set():return
                                        result.setdefault('timbre_inference_source','local_robust_voice_timbre')
                                        result['timbre_evidence_id']=local['speaker_turn']
                                        local['timbre_result']=result
                                        if result.get('available') and result.get('voice_timbre')!='uncertain':
                                            speakers.remember_timbre(local['speaker_turn'],result)
                                        stage('local_timbre',piece,available=result.get('available',False),
                                            voice_timbre=result.get('voice_timbre','uncertain'),
                                            timbre_confidence=result.get('timbre_confidence',0.),latency_ms=result.get('latency_ms',0.),reason=result.get('reason'))
                                    finally:
                                        local['timbre_ready'].set();timbre_slots.release()
                                run(infer_timbre)
                    else:context['timbre_ready'].set()
                    with context_condition:prosody_job=prosody_jobs.get(queued.speaker_turn) if synchronized else None
                    translated=''; chunk=''; last_flush=self.clock(); sent=False

                    def send_text(text,continuing):
                        nonlocal sent
                        if stopped.is_set(): return
                        if text and not sent:
                            while not tts_ready.wait(.05):
                                if stopped.is_set():return
                            if stopped.is_set():return
                            if synchronized and prosody_job is not None:
                                if inline_video:
                                    prosody_job['prosody_done'].wait(INLINE_PROSODY_GRACE)
                                while not inline_video and not prosody_job['prosody_done'].wait(.025):
                                    if stopped.is_set():return
                                    if time.monotonic()>=prosody_job['deadline']:
                                        with context_condition:
                                            prosody_job['prosody_expired']=True;analyzer=prosody_job['prosody_resource']
                                            prosody_job['prosody']=prosody_default('prosody_timeout')
                                        if analyzer:
                                            try:analyzer.close()
                                            except Exception:pass
                                        break
                                with context_condition:
                                    if prosody_job['prosody_done'].is_set() or not inline_video:
                                        context['prosody']=dict(prosody_job['prosody'])
                                    else:context['prosody']=prosody_default('prosody_pending')
                                if stopped.is_set():return
                            # ASR continues while MT starts immediately. Wait
                            # only at the first TTS submission, at most 200 ms,
                            # for a speaker label that may arrive asynchronously.
                            if inline_video and speech_confirmed:
                                deadline=time.monotonic()+2.5
                                while not context['timbre_ready'].wait(.025):
                                    if stopped.is_set():return
                                    if time.monotonic()>=deadline:break
                                timbre=context['timbre_result']
                                if timbre:
                                    context['prosody'].update(voice_timbre=timbre['voice_timbre'],timbre_confidence=timbre['timbre_confidence'],
                                        timbre_inference_source=timbre.get('timbre_inference_source','local_robust_voice_timbre'),
                                        timbre_evidence_id=timbre.get('timbre_evidence_id',context['speaker_turn']),
                                        timbre_evidence_cached=timbre.get('timbre_evidence_cached') is True)
                            context['voice']=speakers.voice(context['speaker_turn'],queued.sample,active['voice_mode'],stopped=stopped,wait=.2 if diarization else 0,
                                advisory=context['prosody'] if inline_video else None,require_timbre=inline_video)
                            if context['voice'] is None:return
                            if inline_video:
                                context['delivery_speed']=delivery_pace.speed(context['voice']['voice_id'],context['translated'] or text,
                                    source_bounds.get('start'),source_bounds.get('end'))
                            context['requested']=self.clock();context['activity']=context['requested'];stage('tts_request',segment,
                                register_source=context['voice']['register_source'],register_confidence=context['prosody'].get('register_confidence',0.),
                                voice_register=context['prosody'].get('voice_register','uncertain'),
                                voice_category_provisional=context['voice']['voice_category_provisional'],
                                timbre_source=context['voice']['timbre_source'],voice_timbre=context['prosody'].get('voice_timbre','uncertain'),
                                timbre_confidence=context['prosody'].get('timbre_confidence',0.),synthesis_speed=context.get('delivery_speed',1.),**context['voice']['acoustic'])
                        if context['voice'] is None:raise VoiceError('mt_empty','Meta no produjo texto traducido para este fragmento.')
                        request={'model_id':SONIC_MODEL,'transcript':text,'voice':context['voice']['voice_id'],
                            'language':target,'context_id':identifier,'continue':continuing,
                            'max_buffer_delay_ms':0,
                            'output_format':{'container':'raw','encoding':'pcm_s16le','sample_rate':24000}}
                        generation={}
                        if synchronized and context['prosody']['applied'] and target=='en':
                            generation['emotion']=context['prosody']['emotion']
                        if inline_video:
                            # Cartesia speaks the translation. Its word density
                            # can differ substantially from the ASR source.
                            # Freeze guidance when the first real text is sent,
                            # including for streaming sentence continuations.
                            speed=context['delivery_speed']
                            if speed>1:generation['speed']=speed
                        if generation:request['generation_config']=generation
                        cartesia.send(json.dumps(request))
                        sent=True

                    request_started=self.clock();first_delta=True;stage('mt_start',segment)
                    if hasattr(worker_translator,'on_stage'):worker_translator.on_stage=lambda name,**values:stage(name,segment,**values)
                    cached=caption_prefetch.lookup(segment.text) if caption_prefetch else None
                    if cached:stage('caption_cache_hit',segment)
                    duration_ms=min(30000,max(1,round(source_bounds['end']-source_bounds['start']))) if inline_video else None
                    try:
                        duration_stream=getattr(worker_translator,'stream_for_duration',None) if inline_video else None
                        if cached:deltas=[cached['text']]
                        elif callable(duration_stream):
                            deltas=duration_stream(segment.text,target,request_history,duration_ms=duration_ms)
                        else:deltas=worker_translator.stream(segment.text,target,request_history)
                        for delta in deltas:
                            if stopped.is_set(): return
                            if first_delta:stage('mt_first',segment,request_to_first_ms=round((self.clock()-request_started)*1000,2));first_delta=False
                            active['characters']+=len(delta)
                            translated+=delta;chunk+=delta
                            with context_condition:context['translated']=translated;playing=context['playing']
                            if playing:emit({'type':'transcript','source':'translation','text':translated,'segment_id':segment.id,'final':False})
                            if inline_video and not cached and tts_ready.is_set():
                                # Keep reading Meta if Cartesia is still connecting.
                                boundary=max((match.end() for match in SENTENCE_BOUNDARY.finditer(chunk)),default=0)
                                if boundary>=36:
                                    send_text(chunk[:boundary],True);chunk=chunk[boundary:]
                            elif not inline_video and (chunk[-1:].isspace() or chunk[-1:] in '.!?;:,'):
                                if len(chunk)>=32 or self.clock()-last_flush>=.12 or chunk.rstrip()[-1:] in '.!?;:':
                                    send_text(chunk,True);chunk='';last_flush=self.clock()
                    except Exception as error:
                        code=getattr(error,'code',None)
                        if not inline_video or code not in TRANSIENT_MT_ERRORS:raise
                        with context_condition:
                            active['mt_failures']+=1;failures=active['mt_failures']
                            discarded_contexts.append(identifier)
                            del contexts[identifier];play_order.remove(identifier)
                            context_slots.release();context_condition.notify_all()
                        if sent:cartesia.send(json.dumps({'context_id':identifier,'cancel':True}))
                        report_error=getattr(browser,'report_error',None)
                        if report_error:report_error(code)
                        phase=getattr(error,'phase',None)
                        stage('mt_skipped',segment,code=code,phase=phase if phase in {'request','headers','sse','sse_tail'} else None,
                            request_ms=round((self.clock()-request_started)*1000,2),partial=not first_delta)
                        emit({'type':'source-skipped','epoch':epoch,'cue_id':'utterance-'+segment.turn_id,
                            'source_start_ms':source_bounds['start'],'source_end_ms':source_bounds['end'],'reason':code})
                        if failures>=INLINE_MT_FAILURE_LIMIT:
                            raise VoiceError('mt_repeated_failure','Meta no completó tres traducciones seguidas. El video continuará con su audio original.') from None
                        continue
                    if stopped.is_set(): return
                    with context_condition:active['mt_failures']=0
                    context['translation_ms']=round((self.clock()-request_started)*1000,2);context['usage']=dict(cached['usage'] if cached else getattr(worker_translator,'usage',{}))
                    context['usage']['caption_cache_hit']=bool(cached)
                    context['final']=True;stage('mt_done',segment,request_ms=context['translation_ms'],
                        duration_budget_ms=duration_ms,duration_budget_applied=not cached and callable(duration_stream),
                        source_word_count=len(segment.text.split()),translated_word_count=len(translated.split()))
                    send_text(chunk,False)
                    if context['playing']:emit({'type':'transcript','source':'translation','text':translated,'segment_id':segment.id,'final':True})
                    if inline_video:history_row['translated_text']=translated
                    history=(history+[(segment.text,translated)])[-2:]

            def playback():
                played=0
                while not stopped.is_set():
                    with context_condition:
                        if not play_order:
                            if not prepared_done.is_set():context_condition.wait(.05);continue
                            context=None
                        else:
                            head_id = play_order[0]
                            identifier = head_id
                            context = contexts[head_id]
                            if synchronized:
                                if not context['done'] or not context['final']:
                                    if self.clock()-context['activity']>15:raise VoiceError('tts_timeout','Cartesia dejó de enviar voz. Detenido sin reintentar.')
                                    if inline_video and not context.get('published_one_ahead') and len(play_order) > 1:
                                        next_id = play_order[1]
                                        later = contexts[next_id]
                                        if later['done'] and later['final']:
                                            # Free the worker for one more source turn.
                                            # Repeating this behind one stalled head would
                                            # move an unbounded queue into the browser.
                                            context['published_one_ahead'] = True
                                            identifier, context = next_id, later
                                    if identifier == head_id:
                                        context_condition.wait(.05)
                                        continue
                                raw=b''.join(context['audio']);context['audio'].clear();context['playing']=True;first=True
                                play_order.remove(identifier);del contexts[identifier];context_slots.release();played+=1
                            elif not context['audio']:
                                if not context['done']:
                                    if self.clock()-context['activity']>15:raise VoiceError('tts_timeout','Cartesia dejó de enviar voz. Detenido sin reintentar.')
                                    context_condition.wait(.05);continue
                                play_order.popleft();del contexts[identifier];context_slots.release();played+=1;raw=None
                            else:
                                raw=context['audio'].popleft();first=not context['playing'];context['playing']=True
                    if context is None:
                        if not mixer.finish(timeout=3):raise VoiceError('audio_backlog','El audio pendiente no terminó dentro del límite.')
                        emit({'type':'done','segments':active['segments'],'characters':active['characters'],
                            'input_bytes':active['bytes'],'output_bytes':active['output_bytes'],
                            'native_audio':mixer.stats() if hasattr(mixer,'stats') else None,
                            'session_elapsed_seconds':round(self.clock()-started,2),'billing_amount':None});completed.set();return
                    segment=context['segment']
                    if synchronized:
                        if not raw:raise VoiceError('sync_audio','La intervención traducida no produjo audio.')
                        padding = {}
                        if inline_video:
                            raw, leading, trailing = trim_synthesis_padding(raw)
                            padding = {'leading_padding_ms': round(leading, 3), 'trailing_padding_ms': round(trailing, 3)}
                        voice=context['voice'];voice.update(speakers.metadata(context['speaker_turn']));bounds=context['source_bounds']
                        stage('cue_ready',segment,audio_ms=round(len(raw)/48,2),source_start_ms=bounds['start'],source_end_ms=bounds['end'],
                            synthesis_speed=context.get('delivery_speed',1.),published_ahead=identifier != head_id,**padding)
                        emit({'type':'dub-cue','epoch':epoch,'cue_id':'utterance-'+segment.turn_id,'final':True,
                            'source_start_ms':bounds['start'],'source_end_ms':bounds['end'],'timing_quality':context['timing_quality'],
                            'speaker_label':voice['speaker_label'],'speaker_index':voice['speaker_index'],'voice_category':voice['voice_category'],
                            'voice_category_provisional':voice['voice_category_provisional'],
                            'sample_rate':24000,'prosody':context['prosody'],'pcm_base64':base64.b64encode(raw).decode('ascii')})
                        emit({'type':'usage','segments':played,'characters':active['characters'],
                            'translation_ms':context['translation_ms'],'usage':context['usage'],'billing_amount':None});continue
                    if raw is None:
                        stage('playback_done',segment,audio_ms=round(context['received']/48,2))
                        emit({'type':'usage','segments':played,'characters':active['characters'],
                            'translation_ms':context['translation_ms'],'usage':context['usage'],'billing_amount':None});continue
                    if first:
                        now=self.clock();stage('playback_start',segment)
                        # A label may arrive after generation but before the
                        # context becomes audible; refresh identity metadata
                        # without changing the already synthesized voice.
                        context['voice'].update(speakers.metadata(segment.turn_id))
                        emit({'type':'speaker','observation':False,'segment_id':segment.id,
                            'voice_category':context['voice']['voice_category'],**speakers.metadata(segment.turn_id)})
                        emit(context['voice'])
                        emit({'type':'transcript','source':'translation','text':context['translated'],'segment_id':segment.id,'final':context['final'],
                            'speaker_label':context['voice']['speaker_label'],'speaker_index':context['voice']['speaker_index'],'voice_category':context['voice']['voice_category']})
                        if active['first_output'] is None:
                            active['first_output']=now
                            emit({'type':'metrics','first_audio_ms':round((now-(active['first_input'] or started))*1000),
                                'tts_first_audio_ms':round((now-context['requested'])*1000),'billing_amount':None})
                    for offset in range(0,len(raw),RATE_BYTES*2):
                        if not mixer.push_translation_paced(raw[offset:offset+RATE_BYTES*2],stopped=stopped):return

            if prepared_prefix:
                active['asr_processed_ms']=float(resume_ms)
                emit({'type':'prefix-used','epoch':epoch,'duration_ms':prepared_prefix.duration_ms,'resume_from_ms':resume_ms})
                for turn in prepared_prefix.turns:
                    identifier='prefix-'+turn.turn_id
                    bounds={'start':turn.start_ms,'end':turn.end_ms}
                    cue={'epoch':epoch,'cue_id':'utterance-'+identifier,'source_start_ms':turn.start_ms,'source_end_ms':turn.end_ms}
                    if turn.content in ('singing','music'):
                        emit({'type':'source-skipped',**cue,'reason':turn.content})
                        continue
                    turn_times[identifier]=bounds
                    speakers.observe(identifier,turn.speaker,namespace='prefix')
                    if turn.prosody:
                        prepared_advisories[identifier]=turn.prosody.as_dict(target)
                        if not expressive:prepared_advisories[identifier]['applied']=False
                    emit({'type':'source-turn',**cue,'phase':'prepared'})
                    emit({'type':'transcript','source':'original','text':turn.text,'final':True,'turn_id':identifier,
                          'asr_label':turn.speaker,'at':turn.start_ms/1000,'prepared':True})
                    sample=prepared_prefix.pcm[turn.start_ms*48:turn.end_ms*48]
                    pending.put_nowait(QueuedSegment(Segment(identifier,0,0,turn.text,False,False,False,self.clock()),sample,b'',bounds,identifier,content=turn.content))
                emit({'type':'source-progress','epoch':epoch,'processed_ms':float(resume_ms)})

            run(receive_tts);run(receive_asr);run(lambda:prepare(translator));run(playback)
            if inline_video:
                run(lambda:prepare(second))
            live_input_started=False
            while not stopped.is_set() and not completed.is_set():
                now=self.clock()
                if closing_at is not None and now-closing_at>DRAIN_SECONDS: raise VoiceError('drain_timeout','Se agotó el tiempo de cierre. Audio y conexiones detenidos.')
                try: arrived,raw=ingress.get(timeout=.1)
                except queue.Empty: continue
                now=self.clock()
                if isinstance(raw,str):
                    control=json.loads(raw)
                    if control=={'type':'stop'}: break
                    if control=={'type':'finish'}:
                        if closing_at is None:
                            closing_at=now
                            if not resume_ms or live_input_started:muse.send(json.dumps({'type':'endStream'}))
                            else:asr_done.set()
                        continue
                    if synchronized and isinstance(control,dict) and control.get('type')=='caption-lookahead':
                        # Optional, nonblocking and strictly bounded. Malformed
                        # page captions are ignored, never spoken or executed.
                        if closing_at is None:caption_prefetch.offer(control)
                        continue
                    raise VoiceError('control','Control no admitido. Cambiar idioma requiere detener la sesión.')
                if closing_at is not None: continue
                if not isinstance(raw,bytes) or len(raw)!=3840: raise VoiceError('pcm','Envía bloques PCM16 mono de exactamente 80 ms a 24 kHz.')
                if inline_video:
                    if (active['bytes']+len(raw))/48-active['asr_processed_ms']>INLINE_ASR_LAG_MS:
                        raise VoiceError('muse_backlog','Muse dejó de avanzar a tiempo. El video puede continuar con su audio original.')
                    # The selected browser uses a bounded local clock. During
                    # TCP jitter, pace acceptance without discarding a block.
                    while not pacing.accept(len(raw),self.clock()):
                        if stopped.wait(pacing.delay_for_frame()):return
                elif not pacing.accept(len(raw),arrived):raise VoiceError('pacing','El audio llegó más rápido que el tiempo real. Sesión detenida.')
                if active['first_input'] is None:
                    active['input_at']=now;active['first_input']=now
                previous_bytes=active['bytes'];active['bytes']+=len(raw)
                if not inline_video:active['input_at']=now
                with resources_lock: audio_window.append(raw)
                if gain>0:mixer.push_original(raw)
                if resume_ms:
                    if active['bytes']>=resume_bytes-RATE_BYTES*2:asr_requested.set()
                    raw=raw[max(0,resume_bytes-previous_bytes):]
                    if not raw:
                        active['input_at']=self.clock()
                        continue
                    while not asr_ready.wait(.05):
                        if stopped.is_set():return
                if prepared_prefix and not live_input_started:
                    emit({'type':'live-asr-start','epoch':epoch,'source_start_ms':resume_ms})
                live_input_started=True
                try:muse.send(raw)
                except ConnectionClosed as exc:
                    if inline_video:raise inline_muse_close(exc) from None
                    raise
                if inline_video:active['input_at']=self.clock()
        except ConnectionClosed: pass
        except Exception as exc: fail(exc)
        finally:
            cancel()
            if voice_agents:voice_agents.close()
            with workers_lock:workers=list(threads)
            for thread in workers: thread.join(timeout=.5)
            # Keep the bridge locked while any paid worker is still unwinding.
            if any(thread.is_alive() for thread in workers):
                def release_after_workers():
                    for thread in workers: thread.join()
                    self.lock.release()
                threading.Thread(target=release_after_workers,daemon=True).start()
            else: self.lock.release()
            with self.connections_lock: self.connections.discard(browser)
