"""Bounded CPU voice-catalog style advice, separate from a person's identity."""
from hashlib import sha256
import math
from pathlib import Path
import threading
import time

import numpy as np


MODEL_PATH = Path(__file__).resolve().parents[2] / 'desktop/assets/audio/robust-voice-timbre.onnx'
MODEL_SHA256 = 'a0934c2f8934878f264dd5072d07b1bbd176f051d285b2a7910dfaa173747695'
MODEL_BYTES = 95387498
MODEL_ID = 'prithivMLmods/Common-Voice-Gender-Detection-ONNX@8d7fc28'
SAMPLE_RATE = 24000
MIN_PCM_BYTES = SAMPLE_RATE * 2
MAX_PCM_BYTES = 8 * SAMPLE_RATE * 2
WINDOW_SAMPLES = 3 * SAMPLE_RATE
CONFIDENCE = .85
_LOCK = threading.RLock()
_SESSION = None


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


def _window(samples):
    """Select one central window; never let a long clip increase inference work."""
    start = max(0, (len(samples) - WINDOW_SAMPLES) // 2)
    return samples[start:start + WINDOW_SAMPLES], start


def _features(window):
    import soxr
    audio = soxr.resample(window, SAMPLE_RATE, 16000, quality='HQ')
    audio = (audio - audio.mean()) / np.sqrt(audio.var() + 1e-7)
    return audio[np.newaxis].astype(np.float32)


def _probabilities(logits):
    values = np.asarray(logits, dtype=np.float64).reshape(-1)
    if values.size != 2 or not np.all(np.isfinite(values)):
        raise ValueError('Invalid local voice-style scores')
    scores = np.exp(values - values.max())
    return scores / scores.sum()


def _selection(probabilities):
    female, male = map(float, probabilities)
    confidence = max(female, male)
    timbre = 'uncertain' if confidence < CONFIDENCE else 'feminine' if female > male else 'masculine'
    return timbre, confidence


def _infer(session, features):
    values = {'input_values': features}
    if any(value.name == 'attention_mask' for value in session.get_inputs()):
        values['attention_mask'] = np.ones(features.shape, dtype=np.int64)
    return _probabilities(session.run(None, values)[0][0])


def warm_robust_timbre():
    """Prepare the optional model outside the source-capture callback."""
    try:
        with _LOCK:
            _infer(_session(), _features(np.zeros(SAMPLE_RATE, dtype=np.float32)))
        return True
    except Exception:
        return False


def analyze_robust_timbre(pcm):
    """Analyze PCM24k mono16 after speech/song gating, at most once per voice.

    The caller owns speaker continuity and must retain uncertain evidence rather
    than interpreting a score as a person's gender. This model cannot establish
    identity or detect mixed speakers. No network or provider calls are made.
    """
    started = time.perf_counter()
    result = {'voice_timbre':'uncertain', 'timbre_confidence':0., 'available':False,
              'local_model':MODEL_ID, 'windows':0, 'latency_ms':0.,
              'confidence_threshold':CONFIDENCE}
    if not isinstance(pcm, bytes) or len(pcm) % 2 or not MIN_PCM_BYTES <= len(pcm) <= MAX_PCM_BYTES:
        return result
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    window, start = _window(samples)
    if float(np.sqrt(np.mean(window * window))) < .004:
        return result
    try:
        with _LOCK:
            probabilities = _infer(_session(), _features(window))
        timbre, confidence = _selection(probabilities)
        if not math.isfinite(confidence):
            return result
        result.update(voice_timbre=timbre, timbre_confidence=round(confidence, 6),
                      female_style_probability=round(float(probabilities[0]), 6),
                      available=True, windows=1, window_start_ms=round(start * 1000 / SAMPLE_RATE),
                      window_duration_ms=round(len(window) * 1000 / SAMPLE_RATE))
    except Exception:
        # Model/dependency failures are optional advisory failures; capture continues.
        result['error_code'] = 'local_robust_timbre_unavailable'
    result['latency_ms'] = round((time.perf_counter() - started) * 1000, 2)
    return result


def analyze_timbre(pcm):
    """Require independent local agreement before choosing a catalog style.

    Both models have produced confident, opposite results on the same public
    speech. Neither model's confidence is a calibrated identity probability.
    Disagreement therefore remains uncertain, rather than seeding a cluster
    with one model's potentially wrong catalog category.
    """
    started = time.perf_counter()
    result = dict(analyze_robust_timbre(pcm))
    result['timbre_inference_source'] = 'local_timbre_consensus'
    if not result.get('available') or result.get('voice_timbre') not in ('masculine', 'feminine'):
        return result
    try:
        from .voice_timbre import analyze_timbre as corroborate
        other = corroborate(pcm)
    except Exception:
        other = {}
    category, confidence = other.get('voice_timbre'), other.get('timbre_confidence')
    valid = (other.get('available') is True and category in ('masculine', 'feminine') and
             type(confidence) in (int, float) and math.isfinite(confidence) and .8 <= confidence <= 1)
    result['corroboration_available'] = valid
    result['corroboration_confidence'] = float(confidence) if valid else 0.
    if valid and category == result['voice_timbre']:
        result['timbre_confidence'] = min(result['timbre_confidence'], float(confidence))
        result['reason'] = 'local_models_agree'
    else:
        result['voice_timbre'] = 'uncertain'
        result['timbre_confidence'] = 0.
        result['reason'] = 'local_models_disagree' if valid else 'local_corroboration_uncertain'
    result['latency_ms'] = round((time.perf_counter() - started) * 1000, 2)
    return result


def warm_timbre():
    from .voice_timbre import warm_timbre as warm_compact
    primary = warm_robust_timbre()
    secondary = warm_compact()
    return primary and secondary
