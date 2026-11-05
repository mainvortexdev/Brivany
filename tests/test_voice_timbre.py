"""Local feature parity and uncertainty gates for synthetic voice selection."""
from hashlib import sha256
import importlib.util
import math
import unittest
from unittest.mock import patch

import numpy as np

from packages.providers import voice_timbre as timbre


class VoiceTimbreTests(unittest.TestCase):
    def test_invalid_short_or_quiet_audio_never_loads_the_model(self):
        with patch.object(timbre, '_session', side_effect=AssertionError('Model must remain unopened')):
            for raw in (None, b'odd', bytes(47998), bytes(timbre.MAX_PCM_BYTES + 2), bytes(48000)):
                result = timbre.analyze_timbre(raw)
                self.assertEqual(result['voice_timbre'], 'uncertain')
                self.assertFalse(result['available'])

    def test_disagreeing_strong_windows_and_weak_scores_stay_uncertain(self):
        for probabilities, expected, mixed in [([.01,.99], 'uncertain', True), ([.51,.58], 'uncertain', False),
                                                 ([.02,.09], 'masculine', False), ([.91,.98], 'feminine', False)]:
            selected, _, _, conflicting = timbre._selection(probabilities)
            self.assertEqual((selected, conflicting), (expected, mixed))

    def test_model_setup_and_runtime_hash_agree(self):
        from tools.setup_voice_timbre import MODEL_SHA256
        self.assertEqual(MODEL_SHA256, timbre.MODEL_SHA256)
        if timbre.MODEL_PATH.is_file():
            self.assertEqual(sha256(timbre.MODEL_PATH.read_bytes()).hexdigest(), MODEL_SHA256)

    def test_features_are_bounded_float32_even_for_quiet_input(self):
        features = timbre._mfcc(np.zeros(16000 * 5, dtype=np.float32))
        self.assertEqual((features.shape, features.dtype), ((1,40,301), np.dtype('float32')))
        self.assertTrue(np.isfinite(features).all())

    def test_failed_optional_model_preserves_uncertain_result(self):
        samples = (np.sin(np.arange(24000) * 2 * math.pi * 150 / 24000) * 5000).astype('<i2').tobytes()
        with patch.object(timbre, '_session', side_effect=Exception('Optional model runtime error')):
            result = timbre.analyze_timbre(samples)
        self.assertEqual(result['voice_timbre'], 'uncertain')
        self.assertFalse(result['available'])

    @unittest.skipUnless(importlib.util.find_spec('librosa'), 'Optional offline reference library is not installed')
    def test_feature_and_logit_parity_with_model_card_reference(self):
        import librosa
        import soxr
        x = np.arange(3 * 24000) / 24000
        signals = [(.15*np.sin(2*np.pi*137*x)+.05*np.sin(2*np.pi*274*x)).astype(np.float32),
                   (np.sin(2*np.pi*(150*x+20*x*x))*.2).astype(np.float32),
                   np.random.default_rng(71).normal(0,.04,len(x)).astype(np.float32)]
        for samples in signals:
            audio = soxr.resample(samples, 24000, 16000, quality='HQ')
            reference = librosa.feature.mfcc(y=audio, sr=16000, n_mfcc=40, n_fft=512, hop_length=160, n_mels=80)
            reference = ((reference-reference.mean(axis=1,keepdims=True)) /
                         (reference.std(axis=1,keepdims=True)+1e-8))[None].astype(np.float32)
            actual = timbre._mfcc(audio)
            relative = np.linalg.norm(reference-actual) / max(1e-9,np.linalg.norm(reference))
            self.assertLess(relative, .001)
            if timbre.MODEL_PATH.is_file():
                with timbre._LOCK:
                    model = timbre._session()
                    expected_logit = float(model.run(['logits'], {'mfcc':reference})[0][0,0])
                    actual_logit = float(model.run(['logits'], {'mfcc':actual})[0][0,0])
                self.assertLess(abs(expected_logit-actual_logit)/max(1e-9,abs(expected_logit)), .001)


if __name__ == '__main__':
    unittest.main()
