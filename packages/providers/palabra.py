"""Palabra speech-to-speech adapter. Bounded local relay, no media persistence.

Verified wire reference: docs.palabra.ai/docs/streaming_api/management (2026-10-27).
Queue settings and TTS timing are not a guarantee of interpreter inference latency.
"""
from __future__ import annotations
import base64
import binascii
import json
import math
import os
import queue
import re
import threading
import time
from collections import deque
from uuid import uuid4
from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed
from packages.providers.dubbing import TranslationBridge, SAMPLE_RATE, BYTES_PER_SECOND, MAX_INPUT_CHUNK
from packages.providers.live_voice import VoiceError
from packages.providers import native_audio

URL = "wss://streaming.palabra.ai/streaming-api/{random_hash}/v1/speech-to-speech/stream"
MODEL = "speech-to-speech"
MAX_SECONDS = 60
DRAIN_SECONDS = 30
FRAME_BYTES = 15360  # Provider-recommended 320 ms PCM; capture still delivers 40 ms.
MIN_BYTES = 768  # 1024 base64 characters, the documented minimum input payload.
OUTPUT_FRAME_BYTES = 1920  # 40 ms PCM16 mono 24 kHz; browser lead bounded to 300 ms.
OUTPUT_LEAD_SECONDS = .3
LANGUAGES = frozenset({'en','es','fr'})
SWITCH_ACK_SECONDS = 5


def palabra_key():
    return os.environ.get("BRIVANY_PALABRA_API_KEY", "").strip() or os.environ.get("PALABRA_API_KEY", "").strip()


def dubbing_status():
    return {"provider": "Palabra", "model": MODEL, "configured": bool(palabra_key()),
        "target_inference_ms": 500, "inference_verified": False, "max_seconds": MAX_SECONDS,'drain_seconds':DRAIN_SECONDS,
        "sample_rate": SAMPLE_RATE, "channels": 1, "format": "pcm16", "input_frame_ms": 320,
        "languages": ["es", "en", "fr"], "source_language_required": True,
        'automatic_source_language_supported':True,
        "switch_language_supported": True, "quality_modes": ["contextual_live"],
        "switch_epoch_scope": "local_relay_not_provider_generation",
        "provider_queue_target_ms": 2000, "provider_queue_max_ms": 12000,
        "partial_translation_supported": True, "translate_partials_default": False,
        'native_audio':native_audio.status()}


def start_options(value):
    if not isinstance(value, dict) or value.get("type") != "start" or value.get("consent") is not True:
        raise VoiceError("dubbing_consent", "Confirma el envío del audio del video a Palabra.")
    if set(value) - {"type", "consent", "source_language", "target_language", "max_seconds", "translate_partials", "quality_mode",'audio_output','original_gain','translation_gain','diagnostics'}:
        raise VoiceError("dubbing_options", "La sesión incluye opciones no admitidas.")
    target = value.get("target_language", "es")
    source = value.get("source_language", "en" if target == "es" else "es")
    seconds = value.get("max_seconds", MAX_SECONDS)
    if not isinstance(source,str) or source not in LANGUAGES|{'auto'} or not isinstance(target,str) or target not in LANGUAGES or source == target or type(seconds) is not int or not 5 <= seconds <= MAX_SECONDS:
        raise VoiceError("dubbing_options", "Elige idiomas distintos (español, inglés o francés) y una sesión de 5 a 60 segundos.")
    if 'quality_mode' in value and value['quality_mode']!='contextual_live':
        raise VoiceError('dubbing_options','El perfil de traducción no está admitido.')
    if value.get('quality_mode')=='contextual_live' and value.get('translate_partials',False) is not False:
        raise VoiceError('dubbing_options','El perfil contextual confirma frases completas antes de traducir.')
    if type(value.get("translate_partials", False)) is not bool:
        raise VoiceError("dubbing_options", "La traducción provisional debe activarse o desactivarse explícitamente.")
    if value.get('audio_output','browser') not in {'browser','local_device'}:raise VoiceError('dubbing_options','Salida de audio no admitida.')
    if type(value.get('diagnostics',False)) is not bool:raise VoiceError('dubbing_options','El diagnóstico debe ser explícito.')
    for name in ('original_gain','translation_gain'):
        level=value.get(name,.12 if name=='original_gain' else .85)
        if type(level) not in {int,float} or not math.isfinite(level) or not 0<=level<=1:raise VoiceError('dubbing_options','El volumen no es válido.')
    if not palabra_key(): raise VoiceError("dubbing_not_configured", "Guarda tu clave API de Palabra para conectar el doblaje.")
    return source, target, seconds


def task_settings(source, target, translate_partials=False):
    return {"message_type": "set_task", "data": {
        "input_stream": {"content_type": "audio", "source": {"type": "ws", "format": "pcm_s16le", "sample_rate": 24000, "channels": 1}},
        "output_stream": {"content_type": "audio", "target": {"type": "ws", "format": "pcm_s16le", "sample_rate": 24000, "channels": 1}},
        "pipeline": {"preprocessing": {}, "transcription": {"source_language": source,
            **({'detectable_languages':sorted(LANGUAGES)} if source=='auto' else {}),
            "segment_confirmation_silence_threshold": .3, "only_confirm_by_silence": False,
            "sentence_splitter": {"enabled": True}},
            "translations": [{"target_language": target, "translate_partial_transcriptions": translate_partials,
                "speech_generation": {"voice_cloning": False, "voice_id": "default_low"}}],
            "allowed_message_types": ["translated_transcription", "validated_transcription"] +
                (["partial_translated_transcription"] if translate_partials else []),
            "translation_queue_configs": {"global": {"desired_queue_level_ms": 2000,
                "max_queue_level_ms": 12000, "auto_tempo": True, "min_tempo": 1.0, "max_tempo": 1.12}}}}}


def effective_settings(data, source, target):
    """Observe optional metadata without making its absence disable translation.

    Missing fields stay unknown. Explicitly contradictory languages remain an
    error. Shape includes schema keys only, never unknown values or secrets.
    """
    def keys(value):
        return [key for key in value if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", key)][:24] if isinstance(value, dict) else []
    shape = {"keys": keys(data), "objects": {key: keys(data[key]) for key in keys(data) if isinstance(data[key], dict)}}
    pipeline = data.get("pipeline")
    path = "pipeline" if isinstance(pipeline, dict) else None
    if path is None and isinstance(data.get("task"), dict) and isinstance(data["task"].get("pipeline"), dict):
        pipeline, path = data["task"]["pipeline"], "task.pipeline"
    pipeline = pipeline if isinstance(pipeline, dict) else {}
    transcription, translations, queues = pipeline.get("transcription"), pipeline.get("translations"), pipeline.get("translation_queue_configs")
    observed_silence_only = transcription.get("only_confirm_by_silence") if isinstance(transcription, dict) else None
    observed_silence_only = observed_silence_only if type(observed_silence_only) is bool else None
    observed_silence = transcription.get('segment_confirmation_silence_threshold') if isinstance(transcription,dict) else None
    observed_silence = observed_silence if type(observed_silence) in {int,float} and math.isfinite(observed_silence) and 0<=observed_silence<=10 else None
    splitter=transcription.get('sentence_splitter') if isinstance(transcription,dict) else None
    observed_splitter=splitter.get('enabled') if isinstance(splitter,dict) and type(splitter.get('enabled')) is bool else None
    observed_partial = translations[0].get("translate_partial_transcriptions") if isinstance(translations, list) and len(translations) == 1 and isinstance(translations[0], dict) else None
    observed_partial = observed_partial if type(observed_partial) is bool else None
    actual_source = transcription.get("source_language") if isinstance(transcription, dict) else None
    actual_target = translations[0].get("target_language") if isinstance(translations, list) and len(translations) == 1 and isinstance(translations[0], dict) else None
    observed_languages = []
    for actual, requested in ((actual_source, source), (actual_target, target)):
        if requested=='auto':
            observed_languages.append(actual if isinstance(actual,str) and actual in LANGUAGES|{'auto'} else None);continue
        if isinstance(actual, str) and re.fullmatch(r"[A-Za-z]{2}(?:-[A-Za-z]{2})?", actual):
            normalized = actual.split("-")[0].lower()
            if normalized != requested: raise VoiceError("dubbing_language_mismatch", "Palabra indicó un idioma distinto al solicitado.")
            observed_languages.append(normalized)
        else: observed_languages.append(None)
    raw_queue = queues.get("global") if isinstance(queues, dict) and isinstance(queues.get("global"), dict) else {}
    queue = {}
    for name, minimum, maximum in (("desired_queue_level_ms", 2000, 163840), ("max_queue_level_ms", 3000, 163840)):
        value = raw_queue.get(name)
        if type(value) is int and minimum <= value <= maximum: queue[name] = value
    if type(raw_queue.get("auto_tempo")) is bool: queue["auto_tempo"] = raw_queue["auto_tempo"]
    for name in ("min_tempo", "max_tempo"):
        value = raw_queue.get(name)
        if type(value) in {int, float} and math.isfinite(value) and 1 <= value <= 2: queue[name] = value
    return {"source_language": observed_languages[0], "target_language": observed_languages[1], "queue": queue or None,
        "only_confirm_by_silence": observed_silence_only,
        "translate_partial_transcriptions": observed_partial,
        "segment_confirmation_silence_threshold": observed_silence, "sentence_splitter_enabled": observed_splitter,
        "observed_fields": {"source_language": observed_languages[0] is not None, "target_language": observed_languages[1] is not None,
            "only_confirm_by_silence": observed_silence_only is not None,
            "translate_partial_transcriptions": observed_partial is not None,
            "segment_confirmation_silence_threshold": observed_silence is not None, "sentence_splitter_enabled": observed_splitter is not None,
            "queue": {name: name in queue for name in ("desired_queue_level_ms", "max_queue_level_ms", "auto_tempo", "min_tempo", "max_tempo")}},
        "observed_path": path, "shape": shape}


def quality_profile(settings,requested=None):
    """Name only a complete observed configuration, never the sent request."""
    expected_queue={'desired_queue_level_ms':2000,'max_queue_level_ms':12000,'auto_tempo':True,'min_tempo':1.0,'max_tempo':1.12}
    exact=(settings.get('source_language') in LANGUAGES|{'auto'} and settings.get('target_language') in LANGUAGES and
        settings.get('only_confirm_by_silence') is False and settings.get('translate_partial_transcriptions') is False and
        settings.get('segment_confirmation_silence_threshold')==.3 and settings.get('sentence_splitter_enabled') is True and settings.get('queue')==expected_queue)
    return {'quality_mode_requested':requested,'quality_mode_effective':'contextual_live' if requested=='contextual_live' and exact else None,
        'quality_mode_verified_by':'observed_current_task_fields' if requested=='contextual_live' and exact else None}


def event_language(value):
    if isinstance(value,str) and re.fullmatch(r'[A-Za-z]{2}(?:-[A-Za-z]{2})?',value):return value.split('-')[0].lower()
    return None


class LanguageSwitch:
    """Per-session command fences; no provider generation marker is invented."""
    def __init__(self,source,target,now=None):
        self.source,self.target,self.epoch=source,target,0;self.pending=None;self.seen={};self.cancelled={}
        self.set_times=deque([time.monotonic() if now is None else now]);self.interrupt_times=deque()

    @staticmethod
    def _prune(values,now,window):
        while values and now-values[0]>=window:values.popleft()

    def begin(self,control,now=None):
        now=time.monotonic() if now is None else now
        if not isinstance(control,dict) or set(control)!={'type','target_language'} or control.get('type')!='switch_language' or not isinstance(control.get('target_language'),str) or control['target_language'] not in LANGUAGES or control['target_language']==self.source:
            raise VoiceError('dubbing_language_switch','Elige un idioma de destino distinto al idioma del video.')
        if self.pending:raise VoiceError('dubbing_language_switch_busy','Espera la confirmación del cambio de idioma actual.')
        if control['target_language']==self.target:return False
        self._prune(self.set_times,now,5);self._prune(self.interrupt_times,now,60)
        if len(self.set_times)>=5 or len(self.interrupt_times)>=20:raise VoiceError('dubbing_language_switch_rate','Se alcanzó el límite de cambios de idioma. Inicia otra sesión más tarde.')
        self.epoch+=1;self.interrupt_times.append(now)
        for identifier in self.seen:self.cancelled[identifier]=None
        while len(self.cancelled)>2048:self.cancelled.pop(next(iter(self.cancelled)))
        self.seen.clear();self.pending={'target':control['target_language'],'stage':'interrupt','deadline':now+SWITCH_ACK_SECONDS}
        return True

    def acknowledge(self,event,now=None):
        now=time.monotonic() if now is None else now
        if event.get('message_type')!='task_status' or not self.pending:return None
        data=event['data'];pending=self.pending
        if pending['stage']=='interrupt' and data.get('command')=='interrupt_task' and data.get('event')=='interrupted' and data.get('task_status')=='running':
            self._prune(self.set_times,now,5)
            if len(self.set_times)>=5:raise VoiceError('dubbing_language_switch_rate','El proveedor no puede recibir otro cambio todavía.')
            self.set_times.append(now);pending.update(stage='set_task',deadline=now+SWITCH_ACK_SECONDS);return 'set_task'
        if pending['stage']=='set_task' and data.get('command')=='set_task' and data.get('event') in {'updated','resumed'} and data.get('task_status')=='running':
            self.target=pending['target'];self.pending=None;return 'changed'
        return None

    def check_deadline(self,now=None):
        if self.pending and (time.monotonic() if now is None else now)>=self.pending['deadline']:
            raise VoiceError('dubbing_language_switch_timeout','Palabra no confirmó el cambio de idioma. La sesión se detuvo para evitar mezclar voces.')

    def accept(self,event):
        """After a switch require language+ID; same-language unseen stale IDs remain unknowable."""
        kind=event.get('message_type');data=event['data']
        if kind not in {'output_audio_data','translated_transcription','partial_translated_transcription','validated_transcription'}:return True
        record=data if kind=='output_audio_data' else data.get('transcription',{})
        identifier=record.get('transcription_id') if isinstance(record,dict) else None
        identifier=identifier if isinstance(identifier,str) and 1<=len(identifier)<=512 else None
        language=event_language(record.get('language')) if isinstance(record,dict) else None
        translated=kind!='validated_transcription'
        if self.pending or identifier in self.cancelled:return False
        if self.epoch and translated and (identifier is None or language!=self.target):return False
        if language is not None and (language!=self.target if translated else self.source!='auto' and language!=self.source):return False
        if identifier is not None:
            self.seen[identifier]=None
            while len(self.seen)>2048:self.seen.pop(next(iter(self.seen)))
        return True


def parse_event(raw):
    if not isinstance(raw, str): raise VoiceError("dubbing_protocol", "Palabra envió un evento no válido.")
    event = json.loads(raw)
    if not isinstance(event, dict): raise VoiceError("dubbing_protocol", "Palabra envió un evento no válido.")
    data = event.get("data", {})
    if isinstance(data, str): data = json.loads(data)
    if not isinstance(data, dict): raise VoiceError("dubbing_protocol", "Palabra envió un contenido no válido.")
    event["data"] = data
    if event.get("message_type") == "error":
        raise VoiceError("dubbing_rejected", "Palabra rechazó el doblaje. Revisa la clave, saldo, acceso y configuración.")
    return event


def correlation_metadata(identifier, part=None):
    """Allowlisted optional IDs; missing metadata never invalidates PCM."""
    if not isinstance(identifier, str) or not 1 <= len(identifier) <= 512: return {}
    result = {"turn_id": "palabra:" + json.dumps((identifier,), ensure_ascii=True, separators=(",", ":"))}
    if type(part) not in {str, int}: return result
    # Bound integers before stringifying: an optional huge ID must not raise
    # Python's integer conversion limit and discard otherwise valid audio.
    if type(part) is int and not -10**512 < part < 10**512: return result
    normalized_part = str(part)
    if len(normalized_part) > 512: return result
    result["segment_id"] = "palabra:" + json.dumps((identifier, normalized_part), ensure_ascii=True, separators=(",", ":"))
    return result


def source_interval_metadata(transcript):
    """Keep relative source seconds only, with a complete bounded segment list.

    Epoch timestamps, word timings and segment text are deliberately excluded.
    One malformed/missing interval makes the whole optional range unknown.
    """
    segments = transcript.get("segments")
    if not isinstance(segments, list) or not 1 <= len(segments) <= 100: return {}
    starts, ends = [], []
    for segment in segments:
        if not isinstance(segment, dict): return {}
        start, end = segment.get("start"), segment.get("end")
        if type(start) not in {int, float} or type(end) not in {int, float}: return {}
        if not 0 <= start < end <= 90 or not math.isfinite(start) or not math.isfinite(end): return {}
        starts.append(start); ends.append(end)
    return {"source_start_seconds": min(starts), "source_end_seconds": max(ends)}


class PalabraEvents:
    def __init__(self, translate_partials=False):
        self.seen_text = set(); self.output_bytes = 0; self.text_characters = 0
        self.translate_partials = translate_partials
        self.partial_segments = {}

    def accept(self, event):
        kind, data = event.get("message_type"), event["data"]
        if kind == "end_of_stream": return {"type": "closed"}
        if kind == "output_audio_data":
            encoded = data.get("data")
            if not isinstance(encoded, str) or len(encoded) > 524288:
                raise VoiceError("dubbing_audio_format", "El bloque de voz de Palabra no es válido.")
            try: audio = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error): raise VoiceError("dubbing_audio_format", "El bloque de voz de Palabra no es válido.") from None
            if not audio or len(audio) % 2: raise VoiceError("dubbing_audio_format", "El bloque PCM de Palabra no es válido.")
            self.output_bytes += len(audio)
            if self.output_bytes > BYTES_PER_SECOND * 90: raise VoiceError("dubbing_output_limit", "La voz traducida superó 90 segundos.")
            generation = data.get("chunk_generation_delta")
            if generation is not None and (type(generation) not in {int, float} or not math.isfinite(generation) or generation < 0):
                raise VoiceError("dubbing_protocol", "El tiempo de generación comunicado no es válido.")
            metadata = {**correlation_metadata(data.get("transcription_id"), data.get("translation_part_id")), 'language':event_language(data.get('language'))}
            if type(data.get("last_chunk")) is bool: metadata["audio_segment_final"] = data["last_chunk"]
            return {"type": "audio", "audio": encoded, "sample_rate": 24000,
                    "elapsed_ms": None, "tts_chunk_generation_ms": generation, **metadata}
        if kind == "partial_translated_transcription" and not self.translate_partials: return None
        if kind in {"validated_transcription", "translated_transcription", "partial_translated_transcription"}:
            transcript = data.get("transcription")
            if not isinstance(transcript, dict): raise VoiceError("dubbing_protocol", "El subtítulo de Palabra no es válido.")
            identifier, part, text = transcript.get("transcription_id"), transcript.get("translation_part_id", 0), transcript.get("text")
            if isinstance(text, str) and not text.strip(): return None
            if not isinstance(identifier, str) or not 1 <= len(identifier) <= 512 or type(part) not in {str, int} or len(str(part)) > 512 or not isinstance(text, str) or len(text) > 10000:
                raise VoiceError("dubbing_protocol", "El subtítulo de Palabra no es válido.")
            metadata = {**correlation_metadata(identifier, transcript.get("translation_part_id")),
                **source_interval_metadata(transcript),'language':event_language(transcript.get('language'))}
            if self.translate_partials and kind != "validated_transcription":
                key = (identifier, str(part))
                previous = self.partial_segments.get(key)
                final = kind == "translated_transcription"
                if previous and (previous["final"] or not final and previous["text"] == text): return None
                revision = previous["revision"] + 1 if previous else 1
                self.partial_segments[key] = {"text": text, "final": final, "revision": revision}
                self.text_characters += len(text)
                if self.text_characters > 100000 or len(self.partial_segments) > 10000:
                    raise VoiceError("dubbing_output_limit", "Los subtítulos superaron el límite de sesión.")
                # JSON tuple encoding avoids ambiguous identifiers containing ':'
                # and keeps every correction on the same caption segment.
                return {"type": "transcript", "text": text,
                        "source": "translation", "elapsed_ms": None, "operation": "replace",
                        **metadata,
                        "segment_id": "palabra:" + json.dumps(key, ensure_ascii=True, separators=(",", ":")),
                        "revision": revision, "provisional": not final, "final": final}
            key = (kind, identifier, str(part))
            if key in self.seen_text: return None
            self.seen_text.add(key); self.text_characters += len(text)
            if self.text_characters > 100000 or len(self.seen_text) > 10000:
                raise VoiceError("dubbing_output_limit", "Los subtítulos superaron el límite de sesión.")
            return {"type": "transcript", "text": text + (" " if text and not text[-1].isspace() else ""),
                    "elapsed_ms": None, "source": "translation" if kind == "translated_transcription" else "original", **metadata,
                    **({"final": True, "provisional": False} if kind == "translated_transcription" else {})}
        return None


class PalabraBridge(TranslationBridge):
    """Reuse the loopback transport boundary; map Palabra's distinct wire protocol."""
    def handle(self, browser):
        if not self.lock.acquire(blocking=False):
            self.send(browser, {"type": "error", "code": "dubbing_busy", "message": "Ya hay un doblaje activo. Detén esa sesión primero."}); return
        upstream, reader, native = None, None, None
        stopped, drained = threading.Event(), threading.Event()
        closing_at, first_input_at, first_output_ms, tts_first_ms = None, None, None, None
        sent_bytes, upstream_bytes, padding_bytes, pacing_balance = 0, 0, 0, .5
        pending = bytearray(); events = None
        send_lock = threading.Lock();state_lock=threading.RLock();upstream_send_lock=threading.Lock();switch=None
        diagnostic_at=0;provider_counts={name:0 for name in ('validated_transcription','translated_transcription','partial_translated_transcription','output_audio_data','warning','other')}
        observed_source_languages=set();filtered_events=0
        ingress={'messages':0,'send_total_ms':0.,'send_max_ms':0.}
        outbound=queue.Queue(maxsize=8);writer=None
        native_stage=bytearray();native_stage_info={}

        def send(value):
            with send_lock:
                if not stopped.is_set(): self.send(browser, value)

        def upstream_send(value):
            # A slow TLS write must not stall capture or the local monitor.
            # Eight 320 ms packets bound queued network input.
            try:outbound.put_nowait((json.dumps(value),value.get('message_type')))
            except queue.Full:raise VoiceError('dubbing_upstream_backlog','La red no puede enviar el audio a tiempo. Se detuvo para evitar una traducción atrasada.') from None

        def transmit():
            try:
                while not stopped.is_set():
                    try:payload,kind=outbound.get(timeout=.1)
                    except queue.Empty:continue
                    if stopped.is_set():return
                    before=time.monotonic()
                    with upstream_send_lock:upstream.send(payload)
                    if kind=='input_audio_data':
                        elapsed=(time.monotonic()-before)*1000;ingress['messages']+=1;ingress['send_total_ms']+=elapsed;ingress['send_max_ms']=max(ingress['send_max_ms'],elapsed)
            except Exception:
                try:send({'type':'error','code':'dubbing_upstream_connection','message':'La red interrumpió el envío del audio a Palabra.'})
                except ConnectionClosed:pass
                finally:stopped.set()

        def flush_native_stage():
            if not native_stage or stopped.is_set():return
            pcm=bytes(native_stage);native_stage.clear()
            native.push_translation(pcm)
            send({key:value for key,value in native_stage_info['packet'].items() if key!='audio'}|{'type':'audio-playback','audio_output':'local_device','duration_ms':round(len(pcm)/48,3),'physical_playback_verified':False})

        def stage_native_pcm(packet,chunk):
            key=(packet.get('turn_id'),packet.get('segment_id'),packet.get('epoch'))
            if native_stage and key!=native_stage_info.get('key'):flush_native_stage()
            if not native_stage:native_stage_info['at']=time.monotonic()
            native_stage_info.update(key=key,packet=packet)
            native_stage.extend(chunk)
            # Coalesce arbitrary provider packet sizes into contiguous 160 ms
            # blocks. Small packets must not each become a padded 20 ms mix frame.
            while len(native_stage)>=7680:
                pcm=bytes(native_stage[:7680]);del native_stage[:7680]
                native.push_translation(pcm)
                send({field:value for field,value in packet.items() if field!='audio'}|{'type':'audio-playback','audio_output':'local_device','duration_ms':160,'physical_playback_verified':False})
                native_stage_info['at']=time.monotonic()
            if packet.get('audio_segment_final'):flush_native_stage()

        with self.connections_lock: self.connections.add(browser)
        try:
            first = browser.recv(timeout=8)
            if not isinstance(first, str): raise VoiceError("dubbing_options", "Falta la configuración de doblaje.")
            options = json.loads(first)
            source, target, seconds = start_options(options)
            if options.get('audio_output')=='local_device':
                try:
                    native=native_audio.open_native_audio();native.set_levels(original=options.get('original_gain',.12),translation=options.get('translation_gain',.85))
                except native_audio.NativeAudioError as error:raise VoiceError('dubbing_audio_output',str(error)) from None
            translate_partials = options.get("translate_partials", False)
            quality_mode=options.get('quality_mode');switch=LanguageSwitch(source,target)
            events = PalabraEvents(translate_partials=translate_partials)
            upstream = connect(URL.format(random_hash=uuid4().hex), additional_headers={"Authorization": "Bearer " + palabra_key()},
                open_timeout=8, close_timeout=2, max_size=1024*1024, max_queue=8, compression=None, proxy=None)
            with self.connections_lock: self.connections.add(upstream)
            writer=threading.Thread(target=transmit,daemon=True);writer.start()
            upstream_send(task_settings(source, target, translate_partials=translate_partials))
            deadline = time.monotonic() + 10
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0: raise VoiceError("dubbing_setup_timeout", "Palabra no confirmó el inicio dentro del límite.")
                event = parse_event(upstream.recv(timeout=remaining)); data = event["data"]
                if event.get("message_type") == "task_status" and data.get("command") == "set_task" and data.get("event") in {"started", "updated", "unchanged", "resumed"} and data.get("task_status") == "running": break
            upstream_send({"message_type": "get_task", "data": {"exclude_hidden": False}})
            deadline = time.monotonic() + 5
            settings = effective_settings({}, source, target)
            try:
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0: raise TimeoutError()
                    event = parse_event(upstream.recv(timeout=remaining))
                    if event.get("message_type") == "current_task":
                        settings = effective_settings(event["data"], source, target); break
            except TimeoutError:
                settings["warning"] = "metadata_unavailable"
            except VoiceError as exc:
                if exc.code != "dubbing_rejected": raise
                # set_task already succeeded; a rejected metadata query does not
                # make its missing fields proof that the translation is broken.
                settings["warning"] = "metadata_unavailable"
            self.send(browser, {"type": "ready", "provider": "Palabra", "model": MODEL, "sample_rate": 24000, "max_seconds": seconds,
                                "provider_settings": settings, "translate_partials_requested": translate_partials,'drain_seconds':DRAIN_SECONDS,
                                "translate_partials_observed": settings["translate_partial_transcriptions"],
                                'epoch':0,'source_language':source,'target_language':target,**quality_profile(settings,quality_mode),
                                'audio_output':'local_device' if native else 'browser','output_location':'server_computer' if native else 'browser','physical_playback_verified':False,
                                'switch_epoch_scope':'local_relay_not_provider_generation',
                                'switch_stale_output_limit':'Same-language unseen stale transcription IDs cannot be distinguished without a provider generation marker.'})
            started = pacing_at = time.monotonic()

            def flush(final=False):
                nonlocal upstream_bytes, padding_bytes
                while len(pending) >= FRAME_BYTES or (final and pending):
                    size = min(FRAME_BYTES, len(pending)); chunk = bytes(pending[:size]); del pending[:size]
                    if len(chunk) < MIN_BYTES:
                        amount = MIN_BYTES - len(chunk); chunk += b"\0" * amount; padding_bytes += amount
                    if upstream_bytes + len(chunk) > seconds * BYTES_PER_SECOND:
                        raise VoiceError("dubbing_input_limit", "El audio y su cierre excedieron el límite de la prueba.")
                    upstream_send({"message_type": "input_audio_data", "data": {"data": base64.b64encode(chunk).decode("ascii")}})
                    upstream_bytes += len(chunk)

            def finish():
                nonlocal closing_at
                if closing_at is None:
                    closing_at = time.monotonic(); flush(final=True)
                    upstream_send({"message_type": "end_task", "data": {"force": False}})

            def receive():
                nonlocal first_output_ms, tts_first_ms, filtered_events
                output_balance, output_pacing_at = OUTPUT_LEAD_SECONDS, time.monotonic()
                native_stats_at=0
                try:
                    while not stopped.is_set():
                        if native:native.check_error()
                        try: raw = upstream.recv(timeout=.25)
                        except TimeoutError:
                            if native:
                                with state_lock:
                                    if native_stage and time.monotonic()-native_stage_info['at']>=.16:flush_native_stage()
                            continue
                        event=parse_event(raw)
                        with state_lock:
                            event_kind=event.get('message_type');provider_counts[event_kind if event_kind in provider_counts else 'other']+=1
                            if event_kind=='validated_transcription':
                                observed=event_language(event['data'].get('transcription',{}).get('language'))
                                if observed in LANGUAGES:observed_source_languages.add(observed)
                            switch.check_deadline();action=switch.acknowledge(event)
                            if action=='set_task':new_target=switch.pending['target']
                            elif action=='changed':
                                unknown=effective_settings({},source,switch.target)
                                send({'type':'language-changed','source_language':source,'target_language':switch.target,'epoch':switch.epoch,
                                    'provider_settings':unknown,**quality_profile(unknown,quality_mode),
                                    'switch_epoch_scope':'local_relay_not_provider_generation'})
                            if event.get('message_type')=='current_task' and not switch.pending:
                                observed=effective_settings(event['data'],source,switch.target)
                                send({'type':'provider-settings','provider_settings':observed,'epoch':switch.epoch,
                                    'source_language':source,'target_language':switch.target,**quality_profile(observed,quality_mode)})
                            if not switch.accept(event):filtered_events+=1;continue
                            output_epoch=switch.epoch;output_target=switch.target
                        if action=='set_task':upstream_send(task_settings(source,new_target,translate_partials=translate_partials))
                        normalized = events.accept(event)
                        if not normalized: continue
                        if normalized['type'] in {'audio','transcript'}:normalized.update(epoch=output_epoch,target_language=output_target)
                        if normalized["type"] == "closed":
                            if closing_at is None: raise VoiceError("dubbing_incomplete", "Palabra terminó antes de cerrar la entrada.")
                            if native:
                                with state_lock:flush_native_stage()
                            if native and not native.finish(timeout=4):raise VoiceError('dubbing_audio_output','La salida de audio no terminó dentro de su límite.')
                            drained.set()
                            send({"type": "metrics", "first_output_audio_ms": first_output_ms,
                                "inference_ms": None, "target_inference_ms": 500, "inference_verified": False,
                                "tts_first_chunk_generation_ms": tts_first_ms, "bytes_sent": sent_bytes,
                                "provider_input_bytes": upstream_bytes, "padding_bytes": padding_bytes,
                                "output_bytes": events.output_bytes, "input_seconds": round(sent_bytes / BYTES_PER_SECOND, 3)})
                            send({"type": "done"}); return
                        if normalized["type"] != "audio":
                            with state_lock:
                                if output_epoch==switch.epoch and not switch.pending:send(normalized)
                            continue
                        # Preserve every decoded byte, including the final short
                        # frame. Backpressure remains on this reader/max_queue=8;
                        # no extra unbounded output queue is created.
                        audio = base64.b64decode(normalized["audio"])
                        for offset in range(0, len(audio), OUTPUT_FRAME_BYTES):
                            chunk = audio[offset:offset + OUTPUT_FRAME_BYTES]
                            duration = len(chunk) / BYTES_PER_SECOND
                            now = time.monotonic()
                            output_balance = min(OUTPUT_LEAD_SECONDS, output_balance + now - output_pacing_at)
                            wait = max(0, duration - output_balance)
                            until = now + wait
                            while wait > 0:
                                if stopped.wait(min(.01, wait)): return
                                with state_lock:
                                    if output_epoch!=switch.epoch or switch.pending:break
                                wait = until - time.monotonic()
                            if stopped.is_set(): return
                            output_pacing_at = time.monotonic()
                            output_balance = min(OUTPUT_LEAD_SECONDS, max(0, output_balance + max(0, output_pacing_at - now) - duration))
                            packet = {**normalized, "audio": base64.b64encode(chunk).decode("ascii")}
                            # The provider flag belongs to its original chunk;
                            # splitting PCM must not announce completion early.
                            if normalized.get("audio_segment_final") is True:
                                packet["audio_segment_final"] = offset + len(chunk) == len(audio)
                            with state_lock:
                                if output_epoch!=switch.epoch or switch.pending:break
                                if first_output_ms is None and first_input_at is not None:
                                    first_output_ms = round((time.monotonic()-first_input_at)*1000, 2)
                                    tts_first_ms = normalized.get("tts_chunk_generation_ms")
                                    send({"type": "metrics", "first_output_audio_ms": first_output_ms,
                                        "inference_ms": None, "target_inference_ms": 500, "inference_verified": False,
                                        "tts_first_chunk_generation_ms": tts_first_ms})
                                if native:
                                    stage_native_pcm(packet,chunk)
                                    if options.get('diagnostics',False) and hasattr(native,'stats') and time.monotonic()-native_stats_at>=1:
                                        native_stats_at=time.monotonic();send({'type':'native-output-stats',**native.stats()})
                                else:send(packet)
                except ConnectionClosed:
                    if not stopped.is_set():
                        try: send({"type": "error", "code": "dubbing_incomplete", "message": "Palabra se desconectó antes de completar la voz traducida."})
                        except ConnectionClosed: pass
                except Exception as exc:
                    error = exc if isinstance(exc, VoiceError) else VoiceError('dubbing_audio_output',str(exc)) if isinstance(exc,native_audio.NativeAudioError) else VoiceError("dubbing_connection", "La conexión con Palabra se interrumpió.")
                    try: send({"type": "error", "code": error.code, "message": str(error)})
                    except ConnectionClosed: pass
                finally: stopped.set()

            reader = threading.Thread(target=receive, daemon=True); reader.start()
            while not stopped.is_set():
                if native:native.check_error()
                now = time.monotonic()
                with state_lock:switch.check_deadline(now)
                if options.get('diagnostics',False) and now-diagnostic_at>=1:
                    diagnostic_at=now
                    with state_lock:diagnostic={'type':'stream-diagnostics','input_bytes':sent_bytes,'upstream_input_bytes':upstream_bytes,
                        'provider_event_counts':dict(provider_counts),'observed_source_languages':sorted(observed_source_languages),'filtered_events':filtered_events,
                        'input_transport':{'messages':ingress['messages'],'send_total_ms':round(ingress['send_total_ms'],3),'send_max_ms':round(ingress['send_max_ms'],3)}}
                    send(diagnostic)
                    if native and hasattr(native,'stats'):send({'type':'native-output-stats',**native.stats()})
                if closing_at is not None:
                    if now-closing_at > DRAIN_SECONDS: raise VoiceError("dubbing_drain_timeout", "Palabra no terminó de entregar la voz dentro del límite de cierre.")
                elif now-started >= seconds:
                    finish(); self.send(browser, {"type": "input-ended", "reason": "session_limit"})
                try: message = browser.recv(timeout=.25)
                except TimeoutError: continue
                if isinstance(message, bytes):
                    if closing_at is not None: continue
                    if not message or len(message) > MAX_INPUT_CHUNK or len(message) % 2:
                        raise VoiceError("dubbing_audio_format", "Envía PCM16 mono de 24 kHz en bloques de hasta 200 ms.")
                    if sent_bytes + len(message) > seconds * BYTES_PER_SECOND: raise VoiceError("dubbing_input_limit", "El audio superó el límite de esta sesión.")
                    # Validate the source timeline, not receive-loop speed.
                    # Network jitter can deliver valid earlier frames in a burst.
                    now = time.monotonic()
                    if (sent_bytes+len(message))/BYTES_PER_SECOND > now-started+.5: raise VoiceError("dubbing_backlog", "El audio llegó más rápido que la reproducción. Reinicia el doblaje.")
                    if first_input_at is None: first_input_at = time.monotonic()
                    if native:native.push_original(message)
                    sent_bytes += len(message); pending.extend(message); flush()
                else:
                    control = json.loads(message)
                    if control == {"type": "cancel"}:
                        with send_lock: stopped.set()
                        break
                    if control == {"type": "finish"}: finish()
                    elif isinstance(control,dict) and control.get('type')=='audio_levels':
                        if native is None or set(control)!={'type','original_gain','translation_gain'}:raise VoiceError('dubbing_audio_output','Control de volumen no admitido.')
                        if any(type(control[key]) not in {int,float} or not math.isfinite(control[key]) or not 0<=control[key]<=1 for key in ('original_gain','translation_gain')):raise VoiceError('dubbing_audio_output','El volumen no es válido.')
                        native.set_levels(original=control['original_gain'],translation=control['translation_gain'])
                    elif isinstance(control,dict) and control.get('type')=='switch_language':
                        if closing_at is not None:raise VoiceError('dubbing_language_switch','La entrada del video ya terminó.')
                        with state_lock:
                            changed=switch.begin(control)
                            if changed and native:native_stage.clear();native_stage_info.clear();native.flush_translation()
                            send({'type':'language-switching' if changed else 'language-changed','source_language':source,
                                'target_language':control['target_language'],'epoch':switch.epoch,'switch_epoch_scope':'local_relay_not_provider_generation'})
                        if changed:upstream_send({'message_type':'interrupt_task','data':{'languages':['global'],'pause_task':False}})
                    else: raise VoiceError("dubbing_control", "Control de doblaje no válido.")
        except ConnectionClosed: pass
        except Exception as exc:
            error = exc if isinstance(exc, VoiceError) else VoiceError('dubbing_audio_output',str(exc)) if isinstance(exc,native_audio.NativeAudioError) else VoiceError("dubbing_connection", "No se pudo conectar Palabra. Revisa la clave, acceso, saldo y conexión.")
            try:
                with send_lock:
                    if not stopped.is_set():
                        self.send(browser, {"type": "error", "code": error.code, "message": str(error)})
                        stopped.set()
            except ConnectionClosed: pass
        finally:
            with send_lock: stopped.set()
            try:outbound.put_nowait((None,None))
            except queue.Full:pass
            try:
                # Cut the device immediately. Network close/join may take seconds.
                if native:native.close()
            finally:
                try:
                    if upstream:upstream.close()
                finally:
                    try:browser.close()
                    finally:
                        if reader:reader.join(timeout=1)
                        if writer:writer.join(timeout=1)
                        with self.connections_lock:
                            self.connections.discard(browser)
                            if upstream:self.connections.discard(upstream)
                        self.lock.release()
