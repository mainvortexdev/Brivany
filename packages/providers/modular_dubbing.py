"""Incremental Muse -> stable clauses -> Meta M2M100 -> Melodi PCM.

All context is session memory. A stable partial is a heuristic, not ground truth;
late corrections replace captions and never claim to undo already heard audio.
"""
from __future__ import annotations
import base64
from dataclasses import dataclass
from difflib import SequenceMatcher
import json
import queue
import re
import threading
import time
from websockets.sync.client import connect
from websockets.exceptions import ConnectionClosed
from packages.providers.dubbing import TranslationBridge, BYTES_PER_SECOND, MAX_INPUT_CHUNK
from packages.providers.live_voice import (MUSE_MODEL, MUSE_URL, MELODI_MODEL, MuseEvents,
    VoiceError, muse_handshake, open_melodi, voice_status)
from packages.providers.translation import MODEL as MT_MODEL, CloudflareTranslationSession, text_translation_status

MAX_PENDING_SEGMENTS = 4
MAX_SEGMENT_AGE_SECONDS = 8
DRAIN_SECONDS = 12
MAX_REQUESTS = 24


def modular_status():
    voice, mt = voice_status(), text_translation_status()
    stages = {"asr": {"provider": "Meta", "model": MUSE_MODEL, "configured": voice["asr"]["configured"]},
              "translation": {"provider": "Cloudflare", "model_origin": "Meta", "model": MT_MODEL, "configured": mt["configured"]},
              "tts": {"provider": "Cartesia", "model": MELODI_MODEL, "configured": voice["tts"]["configured"]}}
    return {"provider": "Meta modular", "model": "muse-m2m100-melodi", "configured": all(item["configured"] for item in stages.values()),
        "stages": stages, "access_verified": False, "target_inference_ms": 500, "inference_verified": False,
        "max_seconds": 60, "sample_rate": 24000, "channels": 1, "format": "pcm16", "input_frame_ms": 40,
        "languages": ["es"], "source_languages": ["en"], "synthesis_language": "es", "source_language_required": True,
        "max_pending_segments": MAX_PENDING_SEGMENTS, "max_requests": MAX_REQUESTS,
        "drain_seconds": DRAIN_SECONDS, "stable_partial_voice": True}


@dataclass(frozen=True)
class Segment:
    turn_id: str
    index: int
    revision: int
    text: str
    provisional: bool
    correction: bool
    replaces_turn: bool
    created_at: float

    @property
    def id(self): return f"translation-{self.turn_id}-{self.index}"


class StableClauses:
    """Emit punctuated prefixes unchanged across updates; finals flush the rest.

    No per-packet translation. At most 64 turns / 20k characters remain in memory;
    overlong clauses split at word boundaries up to the MT budget of 400 chars.
    """
    def __init__(self):
        self.turns = {}; self.total_characters = 0

    def revision(self, turn): return self.turns.get(turn, {}).get("revision", -1)

    @staticmethod
    def split(text):
        parts = []
        while text:
            if len(text) <= 400: parts.append(text); break
            boundary = text.rfind(" ", 0, 400)
            boundary = boundary if boundary >= 40 else 400
            parts.append(text[:boundary].strip()); text = text[boundary:].strip()
        return [part for part in parts if part]

    @staticmethod
    def words(text):
        return list(re.finditer(r"\w+(?:['’-]\w+)*", text))

    @staticmethod
    def correction_boundary(committed, final):
        """Align completed clauses conservatively; otherwise stop explicitly.

        A stable unit always ended at punctuation. For a semantic revision, map
        the same number of completed clauses only when their lexical overlap is
        high enough to identify the revised prefix. This is still a heuristic.
        """
        old_boundaries=list(re.finditer(r"[.!?;:](?:\s|$)",committed))
        new_boundaries=list(re.finditer(r"[.!?;:](?:\s|$)",final))
        if not old_boundaries or len(new_boundaries)<len(old_boundaries):
            raise VoiceError("modular_correction_alignment", "El texto final cambió y no se pudo separar con confianza la parte nueva. La sesión se detuvo; inicia desde ese momento para no perder contenido.")
        endpoint=new_boundaries[len(old_boundaries)-1].end()
        prefix=final[:endpoint].strip()
        old_words=[match.group().casefold() for match in StableClauses.words(committed)]
        new_words=[match.group().casefold() for match in StableClauses.words(prefix)]
        if SequenceMatcher(a=old_words,b=new_words,autojunk=False).ratio()<.6:
            raise VoiceError("modular_correction_alignment", "La corrección final cambió demasiado el fragmento anterior. Se detuvo la sesión para no omitir ni repetir contenido incierto.")
        return prefix,final[endpoint:].strip()

    def accept(self, event, now=None):
        now = time.monotonic() if now is None else now
        turn = str(event["id"])
        text = " ".join(event["text"].split())
        if len(text) > 6000: raise VoiceError("modular_text_limit", "Una intervención excedió el límite de texto de la prueba.")
        if turn not in self.turns:
            if len(self.turns) >= 64: raise VoiceError("modular_text_limit", "La sesión excedió el límite de intervenciones.")
            self.turns[turn] = {"last": "", "committed": "", "index": 0, "revision": 0, "final": False}
        state = self.turns[turn]
        if state["final"]: return []
        delta = max(0, len(text)-len(state["last"]))
        self.total_characters += delta
        if self.total_characters > 20000: raise VoiceError("modular_text_limit", "La sesión excedió el presupuesto de texto.")
        previous = state["last"]; state["last"] = text
        final = event.get("final") is True
        if final: state["final"] = True
        committed = state["committed"]
        old_words=self.words(committed);new_words=self.words(text)
        equivalent_prefix=bool(old_words) and len(new_words)>=len(old_words) and all(
            old.group().casefold()==new.group().casefold() for old,new in zip(old_words,new_words))
        consumed=(new_words[len(old_words)].start() if len(new_words)>len(old_words) else len(text)) if equivalent_prefix else len(committed)
        if committed and not equivalent_prefix:
            if not final: return []  # Wait for confirmation; do not voice volatile revisions.
            state["revision"] += 1; state["index"] = 0; state["committed"] = text
            prefix,tail=self.correction_boundary(committed,text)
            corrected=self.split(prefix)
            return ([Segment(turn,i,state["revision"],part,False,True,i==0,now) for i,part in enumerate(corrected)] +
                    [Segment(turn,len(corrected)+i,state["revision"],part,False,False,False,now) for i,part in enumerate(self.split(tail))])
        if final:
            chosen = text[consumed:].strip() if committed else text
        else:
            common = 0
            for first, second in zip(previous, text):
                if first != second: break
                common += 1
            stable = text[:common]
            boundaries = list(re.finditer(r"[.!?;:](?:\s|$)", stable))
            if not boundaries: return []
            endpoint = boundaries[-1].end()
            chosen = stable[consumed:endpoint].strip() if committed else stable[:endpoint].strip()
        if not chosen: return []
        parts = self.split(chosen)
        segments = [Segment(turn, state["index"]+i, state["revision"], part, not final, False, False, now) for i, part in enumerate(parts)]
        state["index"] += len(parts)
        state["committed"] = text
        # Use the actual stable source prefix, preserving internal source spacing
        # after normalization rather than deriving a prefix from translated text.
        if not final: state["committed"] = text[:endpoint].rstrip()
        return segments


class ModularBridge(TranslationBridge):
    def __init__(self, http_port, port=0, *, translator=None, synthesizer=None, status=None, clock=None):
        super().__init__(http_port, port)
        self.translator = translator
        self.synthesizer = synthesizer or open_melodi
        self.status = status or modular_status
        self.clock = clock or time.monotonic

    def handle(self, browser):
        if not self.lock.acquire(blocking=False):
            self.send(browser, {"type": "error", "code": "dubbing_busy", "message": "Ya hay un doblaje activo. Detén esa sesión primero."}); return
        upstream, reader, worker, translation_session = None, None, None, None
        stopped, asr_done, completed = threading.Event(), threading.Event(), threading.Event()
        send_lock, state_lock = threading.Lock(), threading.Lock()
        clauses = StableClauses(); pending = queue.Queue(maxsize=MAX_PENDING_SEGMENTS)
        spoken_turns = set(); active_tts = [None]; active_segment = [None]
        closing_at, first_input_at, first_output_ms = None, None, None
        sent_bytes, output_bytes, translated_segments, mt_requests_started, tts_requests_started = 0, 0, 0, 0, 0
        mt_times, tts_times = [], []
        first_asr_partial_ms, first_segment_ready_ms, asr_received_input_ms = None, None, None
        with self.connections_lock: self.connections.add(browser)

        def emit(event):
            with send_lock:
                if not stopped.is_set(): self.send(browser, event)

        def fail(exc):
            error = exc if isinstance(exc, VoiceError) else VoiceError("modular_connection", "La cadena de traducción se interrumpió. No se reintentó.")
            with send_lock:
                if not stopped.is_set():
                    stopped.set()
                    try:
                        if first_input_at is not None or mt_requests_started or tts_requests_started:
                            self.send(browser, metrics(bytes_sent=sent_bytes, translated_segments=translated_segments))
                        self.send(browser, {"type": "error", "code": error.code, "message": str(error)})
                    except ConnectionClosed: pass

        def valid(segment):
            with state_lock: return not stopped.is_set() and clauses.revision(segment.turn_id) == segment.revision

        def metrics(**extra):
            return {"type":"metrics", "inference_ms":None, "inference_verified":False, "target_inference_ms":500,
                "mt_requests_started":mt_requests_started, "tts_requests_started":tts_requests_started,
                "max_requests":MAX_REQUESTS,
                "first_asr_partial_ms":first_asr_partial_ms, "first_segment_ready_ms":first_segment_ready_ms,
                "asr_received_input_ms":asr_received_input_ms, **extra}

        def finish():
            nonlocal closing_at
            if closing_at is None:
                closing_at = self.clock(); upstream.send(json.dumps({"type": "endStream"}))

        try:
            raw = browser.recv(timeout=8)
            if not isinstance(raw, str): raise VoiceError("modular_options", "Falta la configuración de traducción.")
            options = json.loads(raw)
            if not isinstance(options, dict) or options.get("type") != "start" or options.get("consent") is not True:
                raise VoiceError("dubbing_consent", "Confirma el envío del audio a Meta y de sus fragmentos a Cloudflare.")
            if set(options)-{"type", "consent", "source_language", "target_language", "max_seconds"}:
                raise VoiceError("modular_options", "La sesión incluye opciones no admitidas.")
            seconds = options.get("max_seconds", 60)
            if options.get("source_language", "en") != "en" or options.get("target_language", "es") != "es" or type(seconds) is not int or not 5 <= seconds <= 60:
                raise VoiceError("modular_options", "La primera ruta modular admite inglés a español y sesiones de 5 a 60 segundos.")
            if not self.status().get("configured"):
                raise VoiceError("modular_not_configured", "La ruta modular necesita Muse, traducción y voz Cloudflare configurados. Revisa las etapas en ajustes.")
            translation_session = None if self.translator is not None else CloudflareTranslationSession()
            translate_segment = self.translator if self.translator is not None else translation_session
            handshake = muse_handshake({"type": "start", "consent": True, "mode": "english", "language": "en-US"})
            upstream = connect(MUSE_URL, open_timeout=8, close_timeout=2, max_size=65536, max_queue=8, compression=None, proxy=None)
            with self.connections_lock: self.connections.add(upstream)
            upstream.send(json.dumps(handshake)); ack = json.loads(upstream.recv(timeout=8))
            if not isinstance(ack, dict) or not isinstance(ack.get("sessionId"), str): raise VoiceError("modular_asr_rejected", "Muse no confirmó la sesión de traducción.")
            emit({"type": "ready", "provider": "Meta modular", "model": "muse-m2m100-melodi", "sample_rate": 24000,
                  "max_seconds": seconds, "drain_seconds":DRAIN_SECONDS, "max_requests":MAX_REQUESTS})
            started = pacing_at = self.clock(); pacing_balance = .5

            def receive_asr():
                nonlocal first_asr_partial_ms, first_segment_ready_ms, asr_received_input_ms
                events = MuseEvents()
                try:
                    while not stopped.is_set():
                        try: raw = upstream.recv(timeout=.25)
                        except TimeoutError: continue
                        if not isinstance(raw, str): raise VoiceError("modular_asr_protocol", "Muse envió un evento no válido.")
                        incoming = json.loads(raw)
                        if not isinstance(incoming, dict): raise VoiceError("modular_asr_protocol", "Muse envió un evento no válido.")
                        normalized = events.accept(incoming)
                        if not normalized or normalized["type"] != "transcript": continue
                        observed_at=self.clock()
                        if normalized["text"].strip() and normalized["final"] is not True and first_asr_partial_ms is None and first_input_at is not None:
                            first_asr_partial_ms=round((observed_at-first_input_at)*1000,2)
                            # This is input audio duration forwarded when the first
                            # nonempty partial arrived, not recognition progress.
                            asr_received_input_ms=round(sent_bytes/BYTES_PER_SECOND*1000,2)
                            emit(metrics())
                        with state_lock: segments = clauses.accept(normalized,now=observed_at)
                        if segments and first_segment_ready_ms is None and first_input_at is not None:
                            first_segment_ready_ms=round((observed_at-first_input_at)*1000,2)
                            emit(metrics())
                        emit({"type": "transcript", "source": "original", "text": normalized["text"],
                            "operation": "replace", "replace": True, "segment_id": f'original-{normalized["id"]}',
                            "turn_id": normalized["id"], "revision": clauses.revision(normalized["id"]),
                            "provisional": not normalized["final"], "correction": bool(segments and segments[0].correction)})
                        for segment in segments:
                            if segment.correction and segment.replaces_turn:
                                retained=[]
                                while True:
                                    try: old=pending.get_nowait()
                                    except queue.Empty: break
                                    if valid(old): retained.append(old)
                                for old in retained: pending.put_nowait(old)
                                # An in-flight old HTTP call can finish, but no
                                # further PCM from its obsolete revision is emitted.
                                response = active_tts[0]
                                if response is not None and active_segment[0] is not None and active_segment[0].turn_id==segment.turn_id:
                                    try: response.close()
                                    except OSError: pass
                            try: pending.put_nowait(segment)
                            except queue.Full: raise VoiceError("modular_backlog", "La traducción acumuló demasiadas cláusulas. La sesión se detuvo para no doblar contenido atrasado.")
                except ConnectionClosed:
                    if closing_at is None and not stopped.is_set(): fail(VoiceError("modular_asr_incomplete", "Muse se desconectó antes de terminar la entrada."))
                except Exception as exc: fail(exc)
                finally: asr_done.set()

            def process_segments():
                nonlocal output_bytes, translated_segments, first_output_ms, mt_requests_started, tts_requests_started
                playback_until = self.clock()
                try:
                    while not stopped.is_set():
                        try: segment = pending.get(timeout=.1)
                        except queue.Empty:
                            if asr_done.is_set():
                                emit(metrics(stage="summary",first_output_audio_ms=first_output_ms, bytes_sent=sent_bytes,
                                    output_bytes=output_bytes, translated_segments=translated_segments,
                                    last_mt_request_ms=mt_times[-1] if mt_times else None,
                                    last_tts_first_audio_ms=tts_times[-1] if tts_times else None))
                                emit({"type": "done"}); completed.set(); return
                            continue
                        if not valid(segment): continue
                        segment_wait_ms=round((self.clock()-segment.created_at)*1000,2)
                        if segment_wait_ms > MAX_SEGMENT_AGE_SECONDS*1000:
                            raise VoiceError("modular_backlog", "Una cláusula esperó demasiado. Se detuvo el doblaje atrasado.")
                        if mt_requests_started+tts_requests_started>=MAX_REQUESTS: raise VoiceError("modular_request_limit", "La sesión alcanzó el presupuesto de peticiones de traducción y voz. Inicia otra prueba si necesitas continuar.")
                        mt_requests_started+=1
                        translated = translate_segment(segment.text, "en", "es")
                        if not valid(segment): continue
                        text = translated.get("text")
                        if not isinstance(text, str) or not text.strip() or len(text) > 1800:
                            raise VoiceError("modular_translation", "La traducción no produjo un fragmento de voz válido.")
                        mt = translated.get("request_ms"); mt_times.append(mt if type(mt) in {int,float} else None)
                        translated_segments += 1
                        # MT latency must be observable even when TTS is slow or
                        # fails. Its own event is emitted once per completed MT.
                        emit(metrics(stage="translation",segment_id=segment.id,
                            mt_request_ms=mt_times[-1],segment_wait_ms=segment_wait_ms))
                        emit({"type": "transcript", "source": "translation", "text": text,
                            "operation": "replace", "replace": True, "segment_id": segment.id,
                            "turn_id": segment.turn_id, "revision": segment.revision,
                            "provisional": segment.provisional, "correction": segment.correction,
                            "replaces_turn": segment.replaces_turn})
                        # Correct the captions explicitly. Repeating a full turn
                        # in speech after part was heard would create a false echo.
                        if segment.correction and segment.turn_id in spoken_turns:
                            emit({"type": "correction", "turn_id": segment.turn_id, "message": "El texto final corrigió un fragmento. La voz ya emitida no se puede deshacer."})
                            continue
                        if mt_requests_started+tts_requests_started>=MAX_REQUESTS: raise VoiceError("modular_request_limit", "La sesión alcanzó el presupuesto de peticiones de traducción y voz. Inicia otra prueba si necesitas continuar.")
                        synthesis_started = self.clock(); first_tts = None; segment_bytes = 0; carry = b""
                        segment_first_audio_ms=None
                        tts_requests_started+=1
                        response = self.synthesizer(text); active_tts[0] = response; active_segment[0] = segment
                        try:
                            while valid(segment):
                                data = response.read1(3840) if hasattr(response,"read1") else response.read(3840)
                                if not data: break
                                if not isinstance(data,bytes): raise VoiceError("modular_tts_format", "La voz no devolvió PCM válido.")
                                if not valid(segment): break
                                segment_bytes += len(data)
                                if segment_bytes > BYTES_PER_SECOND*20: raise VoiceError("modular_tts_limit", "Una cláusula excedió el límite de voz.")
                                if first_tts is None:
                                    first_tts = round((self.clock()-synthesis_started)*1000,2); tts_times.append(first_tts)
                                    emit(metrics(stage="synthesis",segment_id=segment.id,tts_first_audio_ms=first_tts))
                                data = carry+data; carry = data[-1:] if len(data)%2 else b""; data = data[:-1] if carry else data
                                for offset in range(0,len(data),1920):
                                    if not valid(segment): break
                                    chunk=data[offset:offset+1920]; duration=len(chunk)/BYTES_PER_SECOND
                                    while playback_until+duration-self.clock()>.4 and valid(segment): stopped.wait(.01)
                                    if not valid(segment): break
                                    playback_until=max(playback_until,self.clock())+duration
                                    output_bytes+=len(chunk)
                                    if output_bytes>BYTES_PER_SECOND*90: raise VoiceError("modular_tts_limit", "La salida total de voz excedió 90 segundos.")
                                    if first_output_ms is None and first_input_at is not None:
                                        first_output_ms=round((self.clock()-first_input_at)*1000,2)
                                        emit(metrics(first_output_audio_ms=first_output_ms))
                                    if segment_first_audio_ms is None:
                                        segment_first_audio_ms=round((self.clock()-segment.created_at)*1000,2)
                                        emit(metrics(stage="segment_audio",segment_id=segment.id,
                                            segment_ready_to_first_audio_ms=segment_first_audio_ms))
                                    spoken_turns.add(segment.turn_id)
                                    emit({"type":"audio","audio":base64.b64encode(chunk).decode("ascii"),"sample_rate":24000,
                                        "turn_id":segment.turn_id,"segment_id":segment.id,"revision":segment.revision})
                            if valid(segment) and (not segment_bytes or carry): raise VoiceError("modular_tts_format", "La voz llegó vacía o incompleta.")
                        except (OSError, ValueError):
                            if valid(segment): raise VoiceError("modular_tts_connection", "La voz traducida se interrumpió.") from None
                        finally:
                            active_tts[0] = None; active_segment[0] = None; response.close()
                except Exception as exc: fail(exc)

            reader=threading.Thread(target=receive_asr,daemon=True);worker=threading.Thread(target=process_segments,daemon=True)
            reader.start();worker.start()
            while not stopped.is_set() and not completed.is_set():
                now=self.clock()
                if closing_at is not None:
                    if now-closing_at>DRAIN_SECONDS: raise VoiceError("modular_drain_timeout", "La cadena no terminó dentro del límite de cierre.")
                elif now-started>=seconds:
                    finish();emit({"type":"input-ended","reason":"session_limit"})
                try: message=browser.recv(timeout=.1)
                except TimeoutError: continue
                if isinstance(message,bytes):
                    if closing_at is not None: continue
                    if not message or len(message)>min(MAX_INPUT_CHUNK,7680) or len(message)%2: raise VoiceError("modular_audio_format", "Envía PCM16 mono de 24 kHz en bloques de hasta 160 ms.")
                    if sent_bytes+len(message)>seconds*BYTES_PER_SECOND: raise VoiceError("modular_input_limit", "El audio superó el límite de esta sesión.")
                    now=self.clock();pacing_balance=min(.5,pacing_balance+now-pacing_at);pacing_at=now
                    if len(message)/BYTES_PER_SECOND>pacing_balance: raise VoiceError("modular_backlog", "El audio llegó más rápido que su reproducción.")
                    pacing_balance-=len(message)/BYTES_PER_SECOND
                    if first_input_at is None:first_input_at=self.clock()
                    sent_bytes+=len(message);upstream.send(message)
                else:
                    control=json.loads(message)
                    if control=={"type":"cancel"}:break
                    if control=={"type":"finish"}:finish()
                    else:raise VoiceError("modular_options", "Control de traducción no válido.")
        except ConnectionClosed: pass
        except Exception as exc: fail(exc)
        finally:
            stopped.set()
            if translation_session is not None: translation_session.close()
            if upstream:upstream.close()
            response=active_tts[0]
            if response is not None:
                try:response.close()
                except OSError:pass
            browser.close()
            if reader:reader.join(timeout=.5)
            if worker:worker.join(timeout=.5)
            with self.connections_lock:
                self.connections.discard(browser)
                if upstream:self.connections.discard(upstream)
            if worker and worker.is_alive():
                # urllib cannot cancel a request before response headers arrive.
                # Keep the session slot until that bounded request really exits;
                # its revision checks prevent stale audio or further API stages.
                def release_when_idle():
                    worker.join(); self.lock.release()
                threading.Thread(target=release_when_idle,daemon=True).start()
            else: self.lock.release()
