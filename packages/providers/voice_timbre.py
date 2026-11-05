"""Local catalog voice-style matching from bounded speech, with no network."""
from hashlib import sha256
import math
from pathlib import Path
import threading
import time

import numpy as np


ASSETS = Path(__file__).resolve().parents[2] / 'desktop/assets/audio'
MODEL_PATH = ASSETS / 'voice-timbre.onnx'
MODEL_SHA256 = 'e98f8bc6d7960a8a2169368fe4533636903e712790e96dbff81b679ede5de252'
MODEL_BYTES = 670311
MODEL_ID = 'syntropicsignal-ai/gender-voice-classifier@248c107'
MAX_PCM_BYTES = 8 * 24000 * 2
MIN_PCM_BYTES = 24000 * 2
WINDOW_SAMPLES = 3 * 24000
CONFIDENCE = .8
_LOCK = threading.RLock()
_SESSION = None
_MEL_FILTER = None


def _mel_filter():
    global _MEL_FILTER
    if _MEL_FILTER is not None:
        return _MEL_FILTER
    # Slaney's mel scale and area-normalized triangular filters match the
    # model card's librosa defaults. Keep float32 rounding at the filter step.
    minimum, maximum = 0., 15. + math.log(8000 / 1000) / (math.log(6.4) / 27)
    mels = np.linspace(minimum, maximum, 82)
    frequencies = 200 / 3 * mels
    logarithmic = mels >= 15
    frequencies[logarithmic] = 1000 * np.exp((math.log(6.4) / 27) * (mels[logarithmic] - 15))
    ramps = frequencies[:, None] - np.linspace(0, 8000, 257)[None, :]
    distances = np.diff(frequencies)
    filters = np.maximum(0, np.minimum(-ramps[:-2] / distances[:-1, None],
                                      ramps[2:] / distances[1:, None])).astype(np.float32)
    filters *= (2. / (frequencies[2:] - frequencies[:-2]))[:, None]
    _MEL_FILTER = filters
    return filters


def _mfcc(audio_16k):
    """40 normalized MFCCs from at most 3 seconds of float32 mono audio."""
    from scipy.fft import dct, rfft
    signal = np.pad(np.asarray(audio_16k, dtype=np.float32)[:48000], (256, 256))
    frames = np.lib.stride_tricks.sliding_window_view(signal, 512)[::160]
    window = .5 - .5 * np.cos(2 * np.pi * np.arange(512) / 512)
    spectra = rfft(frames * window, axis=1, workers=1).astype(np.complex64)
    power = np.abs(spectra).T ** 2
    # This small reduction stays in NumPy's serial loop instead of starting a
    # process-wide BLAS worker pool in the browser capture path.
    mel = np.einsum('mf,ft->mt', _mel_filter(), power, optimize=False)
    decibels = 10 * np.log10(np.maximum(np.float32(1e-10), mel))
    decibels = np.maximum(decibels, decibels.max() - 80)
    coefficients = dct(decibels, type=2, axis=0, norm='ortho', workers=1)[:40]
    coefficients = (coefficients - coefficients.mean(axis=1, keepdims=True)) / (coefficients.std(axis=1, keepdims=True) + 1e-8)
    return coefficients[np.newaxis].astype(np.float32)


def _session():
    global _SESSION
    if _SESSION is None:
        import onnxruntime as ort
        if MODEL_PATH.stat().st_size != MODEL_BYTES or sha256(MODEL_PATH.read_bytes()).hexdigest() != MODEL_SHA256:
            raise ValueError('El modelo local de timbre no coincide con su versión verificada.')
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        _SESSION = ort.InferenceSession(str(MODEL_PATH), sess_options=options, providers=['CPUExecutionProvider'])
    return _SESSION


def warm_timbre():
    """Load CPU inference and feature transforms outside the capture path."""
    try:
        import soxr
        with _LOCK:
            session = _session()
            audio = soxr.resample(np.zeros(24000, dtype=np.float32), 24000, 16000, quality='HQ')
            session.run(['logits'], {'mfcc': _mfcc(audio)})
        return True
    except Exception:
        return False


def _selection(probabilities):
    probability = float(np.median(probabilities))
    confidence = max(probability, 1 - probability)
    mixed = min(probabilities) <= 1 - CONFIDENCE and max(probabilities) >= CONFIDENCE
    timbre = 'uncertain' if mixed or confidence < CONFIDENCE else 'feminine' if probability > .5 else 'masculine'
    return timbre, confidence, probability, mixed


def analyze_timbre(pcm):
    """Classify synthetic catalog style after the caller's speech/song gate.

    The score describes acoustic matching. It does not establish a person's
    gender identity. Contradictory windows and weak signals stay uncertain.
    """
    started = time.perf_counter()
    result = {'voice_timbre':'uncertain', 'timbre_confidence':0., 'available':False,
              'local_model':MODEL_ID, 'windows':0, 'mixed':False, 'latency_ms':0.}
    if not isinstance(pcm, bytes) or len(pcm) % 2 or not MIN_PCM_BYTES <= len(pcm) <= MAX_PCM_BYTES:
        return result
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    if np.sqrt(np.mean(samples * samples)) < .004:
        return result
    offsets = np.linspace(0, max(0, len(samples) - WINDOW_SAMPLES),
                          min(3, 1 + max(0, len(samples) - WINDOW_SAMPLES) // 24000), dtype=int)
    try:
        import soxr
        probabilities = []
        with _LOCK:
            session = _session()
            for offset in offsets:
                window = samples[offset:offset + WINDOW_SAMPLES]
                if np.sqrt(np.mean(window * window)) < .004:
                    continue
                audio = soxr.resample(window, 24000, 16000, quality='HQ')
                logits = session.run(['logits'], {'mfcc': _mfcc(audio)})
                logit = float(logits[0][0, 0])
                if not math.isfinite(logit):
                    return result
                probabilities.append(1 / (1 + math.exp(-max(-80, min(80, logit)))))
        if probabilities:
            timbre, confidence, probability, mixed = _selection(probabilities)
            result.update(voice_timbre=timbre, timbre_confidence=round(confidence, 6),
                          female_style_probability=round(probability, 6), mixed=mixed,
                          available=True, windows=len(probabilities))
    except Exception:
        # ONNX Runtime raises its own Exception subclasses for graph/runtime
        # failures. This optional catalog advice must leave capture running.
        result['error_code'] = 'local_timbre_unavailable'
    result['latency_ms'] = round((time.perf_counter() - started) * 1000, 2)
    return result
