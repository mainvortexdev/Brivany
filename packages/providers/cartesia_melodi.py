"""Melodi's two explicit Cartesia voices, streamed as raw PCM to the caller.

One context per requested phrase, no retries, redirects, cloning or fallback.
The caller owns closing this stream, including when playback is cancelled.
"""
from __future__ import annotations
from packages.providers.provider_access import endpoint,demo_headers
import base64
import json
import os
import threading
import time
from uuid import uuid4
from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed
from packages.providers.live_voice import VoiceError

MODEL='sonic-3.6-2026-08-27'
URL='wss://api.cartesia.ai/tts/websocket?cartesia_version=2026-08-14'
VOICES={'en':'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4','es':'3597a26f-80ef-4bd5-8101-9699bc764917'}
COUNTERPART_VOICE='b4b8e2af-6139-466e-a93a-30c20d2e1fc5' # Fernanda, Spanish customer care; catalog checked 2026-11-15.
COUNTERPART_MALE_VOICE='3c1c7da2-8f3f-4966-a76d-1f5e484865b5' # Gonzalo, Spanish service desk; same verified catalogue.
SAMPLE_RATE=24000


def language_code(value):
    if value in ('es','es-ES'):return 'es'
    if value in ('en','en-US','en-GB'):return 'en'
    raise VoiceError('tts_language','Melodi admite voz en español o inglés.')


def speech_speed(value):
    if type(value) not in (int,float) or not .75<=value<=1.15:
        raise VoiceError('tts_speed','El ritmo de Melodi debe estar entre 0,75 y 1,15.')
    return float(value)


def speech_status():
    return {'provider':'Cartesia','model':MODEL,'name':'Melodi · Cartesia',
        'speaker':VOICES['es'],'language':'es','languages':list(VOICES),'voice_ids':dict(VOICES),
        'sample_rate':SAMPLE_RATE,'format':'pcm16','streaming':True,
        'configured':bool(os.getenv('BRIVANY_CARTESIA_API_KEY','').strip()),'access_verified':False}


class CartesiaPCMStream:
    def __init__(self,text,language,speed=1,*,_voice_id=None):
        self.language=language_code(language);self.voice_id=_voice_id or VOICES[self.language]
        self.speed=speech_speed(speed)
        self.context_id=uuid4().hex;self.pending=bytearray();self.done=False;self.closed=threading.Event()
        self.socket=None;self.output_bytes=0;self.started=time.monotonic()
        key=os.getenv('BRIVANY_CARTESIA_API_KEY','').strip()
        if not key:raise VoiceError('tts_not_configured','Configura la clave de Cartesia en el servidor local.')
        try:
            self.socket=connect(endpoint(URL),additional_headers=demo_headers({'X-API-Key':key}),open_timeout=5,close_timeout=1,
                max_size=262144,max_queue=4,compression=None,proxy=None)
            self.socket.send(json.dumps({'model_id':MODEL,'transcript':text,'voice':self.voice_id,
                'language':self.language,'context_id':self.context_id,'continue':False,
                'generation_config':{'speed':self.speed},
                'output_format':{'container':'raw','encoding':'pcm_s16le','sample_rate':SAMPLE_RATE}}))
        except Exception:
            self.close();raise VoiceError('tts_unavailable','Cartesia no pudo iniciar la voz de Melodi. No se reintentó.') from None

    def read1(self,size=4096):
        if type(size) is not int or not 2<=size<=65536:raise ValueError('Invalid PCM read size')
        size-=size%2;idle_deadline=time.monotonic()+10
        try:
            while not self.closed.is_set() and not self.pending and not self.done:
                try:raw=self.socket.recv(timeout=.1)
                except TimeoutError:
                    if time.monotonic()>idle_deadline:raise VoiceError('tts_timeout','Cartesia dejó de enviar voz. Se detuvo sin reintentar.')
                    continue
                if not isinstance(raw,str):raise VoiceError('tts_protocol','Cartesia no devolvió un evento de voz válido.')
                event=json.loads(raw)
                if not isinstance(event,dict):raise VoiceError('tts_protocol','Cartesia no devolvió un evento de voz válido.')
                if event.get('type')=='error':raise VoiceError('tts_rejected','Cartesia rechazó la voz seleccionada. Revisa el ID, acceso y saldo.')
                if event.get('context_id')!=self.context_id:raise VoiceError('tts_protocol','Cartesia devolvió un contexto de voz distinto.')
                if event.get('type')=='done':self.done=True;continue
                if event.get('type')!='chunk':continue
                raw_pcm=base64.b64decode(event.get('data',''),validate=True)
                if not raw_pcm or len(raw_pcm)%2:raise VoiceError('tts_audio','Cartesia devolvió PCM incompleto.')
                self.output_bytes+=len(raw_pcm)
                if self.output_bytes>4_800_000:raise VoiceError('tts_audio','La respuesta de voz no corresponde a una frase acotada.')
                self.pending.extend(raw_pcm)
            if self.closed.is_set():return b''
            chunk=bytes(self.pending[:size]);del self.pending[:size]
            return chunk
        except VoiceError:self.close();raise
        except (ConnectionClosed,OSError,ValueError,TypeError):
            if self.closed.is_set():return b''
            self.close();raise VoiceError('tts_connection','La voz de Cartesia se interrumpió. No se reintentó.') from None

    def close(self):
        if self.closed.is_set():return
        self.closed.set()
        if self.socket:
            if not self.done:
                try:self.socket.send(json.dumps({'context_id':self.context_id,'cancel':True}))
                except Exception:pass
            try:self.socket.close()
            except Exception:pass
        # The reader owns its PCM buffer; don't resize it from a cancelling thread.

    def __enter__(self):return self
    def __exit__(self,*args):self.close()


def open_cartesia_speech(text,language='es',speed=1):
    if not isinstance(text,str) or not text.strip() or len(text)>1800:
        raise VoiceError('invalid_speech','Escribe entre 1 y 1800 caracteres para escuchar a Melodi.')
    return CartesiaPCMStream(text.strip(),language,speed)


def character_voice_id(role,language='es',*,gender=None):
    language=language_code(language)
    if gender not in {None,'female','male'}:raise VoiceError('tts_character','Voz de personaje no válida.')
    if role=='melodi':
        if gender=='male':raise VoiceError('tts_character','La voz seleccionada de Melodi debe conservarse.')
        return VOICES[language]
    if role=='counterpart':return COUNTERPART_MALE_VOICE if gender=='male' else COUNTERPART_VOICE
    raise VoiceError('tts_character','Personaje de diálogo no válido.')


def open_character_speech(text,role,language='es',speed=1,*,gender=None):
    voice=character_voice_id(role,language,gender=gender)
    if role=='melodi':return open_cartesia_speech(text,language,speed)
    if not isinstance(text,str) or not text.strip() or len(text)>1800:raise VoiceError('invalid_speech','Texto de diálogo no válido.')
    return CartesiaPCMStream(text.strip(),language,speed,_voice_id=voice)
