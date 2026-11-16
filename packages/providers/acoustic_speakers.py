"""Anonymous, memory-only speaker grouping from local neural audio embeddings.

Neither ASR label letters, vocal pitch nor the selected catalog gender enter
the similarity calculation. A cluster is a provisional session label, never
a real identity. The caller must exclude songs before offering a sample.
"""
from collections import deque
from hashlib import sha256
from pathlib import Path
import threading
import time

import numpy as np


ASSETS = Path(__file__).resolve().parents[2] / 'desktop/assets/audio'
MODEL_PATH = ASSETS / 'speaker-embedding.onnx'
MODEL_ID = 'iic/speech_campplus_sv_zh_en_16k-common_advanced@v1.0.0'
MODEL_SHA256 = 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2'
MODEL_BYTES = 28281164
MIN_SAMPLES = 28800  # 1.2 seconds after trimming a clause's uncertain edges.
CONSISTENCY_SAMPLES = 43200  # Do not compare phoneme-heavy 1.2 s halves.
MAX_SAMPLES = 8 * 24000
WINDOW_SAMPLES = 3 * 24000
MATCH_THRESHOLD = .65
NOVEL_THRESHOLD = .45
MATCH_MARGIN = .12
TENTATIVE_THRESHOLD = .5
TENTATIVE_MARGIN = .05
MAX_SPEAKERS = 8
_LOCK = threading.RLock()
_EXTRACTOR = None


def _extractor():
    global _EXTRACTOR
    if _EXTRACTOR is None:
        import sherpa_onnx
        if MODEL_PATH.stat().st_size != MODEL_BYTES or sha256(MODEL_PATH.read_bytes()).hexdigest() != MODEL_SHA256:
            raise ValueError('El modelo de hablantes no coincide con su versión verificada.')
        config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(MODEL_PATH), num_threads=1, debug=False, provider='cpu')
        _EXTRACTOR = sherpa_onnx.SpeakerEmbeddingExtractor(config)
    return _EXTRACTOR


def _unit(vector):
    try:
        vector = np.asarray(vector, dtype=np.float32)
    except (TypeError, ValueError):
        return None
    if vector.shape != (192,) or not np.isfinite(vector).all():
        return None
    length = float(np.linalg.norm(vector))
    return vector / length if length > 1e-8 else None


def _compute(model, samples):
    import soxr
    # Explicit resampling avoids per-stream native diagnostics and keeps the
    # feature extractor on its documented 16 kHz input, not audible output.
    audio = soxr.resample(samples, 24000, 16000, quality='HQ')
    stream = model.create_stream()
    stream.accept_waveform(sample_rate=16000, waveform=audio)
    stream.input_finished()
    if not model.is_ready(stream):
        return None
    return _unit(model.compute(stream))


def warm_speaker_embedding():
    """Load once outside capture; optional failure never prevents playback."""
    try:
        with _LOCK:
            _compute(_extractor(), np.zeros(MIN_SAMPLES, dtype=np.float32))
        return True
    except Exception:
        return False


def extract_embedding(pcm):
    """Return a bounded audio vector, rejecting weak or conflicting windows."""
    started = time.perf_counter()
    result = {'available':False, 'reason':'invalid_sample', 'windows':0, 'latency_ms':0.}
    if not isinstance(pcm, bytes) or len(pcm) % 2 or not MIN_SAMPLES * 2 <= len(pcm) <= MAX_SAMPLES * 2:
        return result
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    if np.sqrt(np.mean(samples * samples)) < .004:
        result['reason'] = 'quiet_sample'
        return result
    # Two non-overlapping, sufficiently long windows must agree before a long
    # span can train a cluster. This is a guard, not full overlap diarization.
    check_windows = len(samples) >= 2 * CONSISTENCY_SAMPLES
    width = min(WINDOW_SAMPLES, len(samples) // 2 if check_windows else len(samples))
    offsets = (0, len(samples) - width) if check_windows else ((len(samples) - width) // 2,)
    try:
        with _LOCK:
            model = _extractor()
            vectors = [_compute(model, samples[offset:offset + width]) for offset in offsets]
        result['windows'] = len(vectors)
        if any(vector is None for vector in vectors):
            result['reason'] = 'invalid_embedding'
        elif len(vectors) == 2 and float(np.dot(*vectors)) < MATCH_THRESHOLD:
            result['reason'] = 'inconsistent_windows'
        else:
            result.update(available=True, reason='speech_embedding', embedding=_unit(np.mean(vectors, axis=0)))
    except Exception:
        result['reason'] = 'local_embedding_unavailable'
    result['latency_ms'] = round((time.perf_counter() - started) * 1000, 2)
    return result


class SessionSpeakers:
    """Conservative clustering; all vectors disappear with the translation."""
    def __init__(self, *, extractor=extract_embedding):
        self.extract = extractor
        self.clusters = {}
        self.lock = threading.Lock()

    def associate(self, pcm):
        observation = self.extract(pcm)
        result = {key:observation.get(key) for key in ('available', 'reason', 'windows', 'latency_ms')}
        result.update(cluster=None, similarity=None)
        vector = _unit(observation.get('embedding')) if observation.get('available') else None
        if vector is None:
            return result
        with self.lock:
            return self._match(vector,result)

    def _match(self,vector,result):
        ranking = sorted(((float(np.dot(vector, row['center'])), identifier)
                          for identifier, row in self.clusters.items()), reverse=True)
        best, identifier = ranking[0] if ranking else (-1., None)
        second = ranking[1][0] if len(ranking) > 1 else -1.
        if ranking:
            result['similarity'] = round(best, 4)
        if best >= MATCH_THRESHOLD and best - second >= MATCH_MARGIN:
            row = self.clusters[identifier]
            row['vectors'].append(vector)
            row['center'] = _unit(np.mean(row['vectors'], axis=0))
            result.update(cluster=identifier, reason='matched')
        elif not ranking or best < NOVEL_THRESHOLD:
            if len(self.clusters) >= MAX_SPEAKERS:
                result['reason'] = 'speaker_limit'
            else:
                identifier = len(self.clusters) + 1
                self.clusters[identifier] = {'center':vector, 'vectors':deque([vector], maxlen=4)}
                result.update(cluster=identifier, reason='new_cluster')
        else:
            # Do not turn a borderline match into an extra speaker, and do
            # not learn from a sample which could match either known voice.
            result['reason'] = 'ambiguous_match'
            # Advisory for voice continuity only: a clearly leading known
            # speaker. The cluster centre is not updated.
            if best >= TENTATIVE_THRESHOLD and best - second >= TENTATIVE_MARGIN:
                result['best_cluster'] = identifier
        return result

    def only_cluster(self):
        """The single known speaker, when exactly one exists (else None)."""
        with self.lock:
            return next(iter(self.clusters)) if len(self.clusters) == 1 else None
