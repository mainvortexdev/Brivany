"""Bounded optional CPU inference and uncertainty for acoustic catalog style."""
from hashlib import sha256
from pathlib import Path
import math
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

from packages.providers import robust_voice_timbre as timbre


def speech_like(seconds):
    samples = np.arange(round(seconds * 24000)) / 24000
    return (np.sin(2 * math.pi * 153 * samples) * 5000).astype('<i2').tobytes()


class RobustVoiceTimbreTests(unittest.TestCase):
    def test_catalog_style_requires_two_independent_confident_local_results(self):
        primary={'available':True,'voice_timbre':'feminine','timbre_confidence':.99,'latency_ms':1.}
        variants=[
            ({'available':True,'voice_timbre':'feminine','timbre_confidence':.91},'feminine',.91,'local_models_agree'),
            ({'available':True,'voice_timbre':'masculine','timbre_confidence':.98},'uncertain',0.,'local_models_disagree'),
            ({'available':True,'voice_timbre':'uncertain','timbre_confidence':.7},'uncertain',0.,'local_corroboration_uncertain'),
            ({'available':False,'voice_timbre':'feminine','timbre_confidence':.99},'uncertain',0.,'local_corroboration_uncertain'),
            ({'available':True,'voice_timbre':'feminine','timbre_confidence':True},'uncertain',0.,'local_corroboration_uncertain'),
        ]
        for secondary,category,confidence,reason in variants:
            with self.subTest(secondary=secondary),patch.object(timbre,'analyze_robust_timbre',return_value=primary),patch('packages.providers.voice_timbre.analyze_timbre',return_value=secondary) as corroborate:
                result=timbre.analyze_timbre(b'owned speech')
                self.assertEqual((result['voice_timbre'],result['timbre_confidence'],result['reason']),(category,confidence,reason))
                self.assertEqual(result['timbre_inference_source'],'local_timbre_consensus')
                corroborate.assert_called_once_with(b'owned speech')
        self.assertEqual(primary['voice_timbre'],'feminine','Inference must not mutate a reusable primary result')

    def test_primary_abstention_does_not_run_another_model_and_secondary_failure_stays_uncertain(self):
        with patch.object(timbre,'analyze_robust_timbre',return_value={'available':True,'voice_timbre':'uncertain','timbre_confidence':.7}),patch('packages.providers.voice_timbre.analyze_timbre',side_effect=AssertionError('Must not run')) as secondary:
            self.assertEqual(timbre.analyze_timbre(b'owned')['voice_timbre'],'uncertain')
            secondary.assert_not_called()
        with patch.object(timbre,'analyze_robust_timbre',return_value={'available':True,'voice_timbre':'masculine','timbre_confidence':.99}),patch('packages.providers.voice_timbre.analyze_timbre',side_effect=RuntimeError('Optional local model unavailable')):
            self.assertEqual(timbre.analyze_timbre(b'owned')['voice_timbre'],'uncertain')

    def test_invalid_short_long_or_quiet_audio_never_loads_model(self):
        with patch.object(timbre, '_session', side_effect=AssertionError('Must stay unopened')):
            for raw in (None, b'odd', bytes(47998), bytes(timbre.MAX_PCM_BYTES + 2), bytes(48000)):
                result = timbre.analyze_robust_timbre(raw)
                self.assertEqual(result['voice_timbre'], 'uncertain')
                self.assertFalse(result['available'])

    def test_weak_scores_remain_uncertain_independently_of_pitch(self):
        for probabilities, expected in [([.735,.265], 'uncertain'), ([.849,.151], 'uncertain'),
                                         ([.85,.15], 'feminine'), ([.01,.99], 'masculine')]:
            self.assertEqual(timbre._selection(probabilities)[0], expected)

    def test_one_central_window_limits_work_and_avoids_onset_bias(self):
        captured = []
        def infer(session, features):
            captured.append(features)
            return np.array([.735,.265])
        with patch.object(timbre, '_session', return_value=object()), patch.object(timbre, '_infer', side_effect=infer):
            result = timbre.analyze_robust_timbre(speech_like(7))
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0].shape, (1,48000))
        self.assertEqual((result['window_start_ms'], result['window_duration_ms']), (2000,3000))
        self.assertEqual(result['voice_timbre'], 'uncertain')
        self.assertTrue(result['available'])
        self.assertEqual(result['windows'], 1)

    def test_optional_runtime_failure_leaves_capture_advice_unavailable(self):
        with patch.object(timbre, '_session', side_effect=RuntimeError('Missing optional model')):
            result = timbre.analyze_robust_timbre(speech_like(1))
            self.assertFalse(timbre.warm_robust_timbre())
        self.assertEqual(result['voice_timbre'], 'uncertain')
        self.assertFalse(result['available'])

    def test_nonfinite_or_malformed_logits_cannot_select_voice(self):
        for logits in ([float('nan'), 1], [float('inf'), 1], [1,2,3]):
            with self.assertRaises(ValueError):
                timbre._probabilities(logits)
        probabilities = timbre._probabilities([1000.,999.])
        self.assertTrue(np.isfinite(probabilities).all())
        self.assertAlmostEqual(float(probabilities.sum()), 1.)

    def test_setup_hash_size_and_runtime_agree(self):
        from tools.setup_robust_voice_timbre import MODEL_SHA256, MODEL_BYTES, _verified
        self.assertEqual((MODEL_SHA256, MODEL_BYTES), (timbre.MODEL_SHA256, timbre.MODEL_BYTES))
        with self.assertRaises(ValueError):
            _verified(b'wrong model', MODEL_SHA256, MODEL_BYTES)
        if timbre.MODEL_PATH.is_file():
            self.assertEqual(timbre.MODEL_PATH.stat().st_size, MODEL_BYTES)
            self.assertEqual(sha256(timbre.MODEL_PATH.read_bytes()).hexdigest(), MODEL_SHA256)

    def test_first_inference_loads_once_and_streams_integrity_check_without_full_file_copy(self):
        payload=b'owned model fixture' * 100
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'model.onnx';path.write_bytes(payload)
            session=object()
            from unittest.mock import Mock
            constructor=Mock(return_value=session)
            runtime=SimpleNamespace(SessionOptions=lambda:SimpleNamespace(),
                ExecutionMode=SimpleNamespace(ORT_SEQUENTIAL=0), InferenceSession=constructor)
            with patch.dict('sys.modules',{'onnxruntime':runtime}),patch.object(timbre,'_SESSION',None),patch.object(timbre,'MODEL_PATH',path),patch.object(timbre,'MODEL_BYTES',len(payload)),patch.object(timbre,'MODEL_SHA256',sha256(payload).hexdigest()),patch.object(Path,'read_bytes',side_effect=AssertionError('Must stream model hash')),patch.object(timbre,'_features',return_value=np.zeros((1,16000),dtype=np.float32)),patch.object(timbre,'_infer',return_value=np.array([.99,.01])):
                constructor.assert_not_called()
                first=timbre.analyze_robust_timbre(speech_like(1))
                second=timbre.analyze_robust_timbre(speech_like(1))
                self.assertTrue(first['available']);self.assertTrue(second['available'])
                constructor.assert_called_once()

    def test_streamed_hash_still_rejects_changed_model_before_runtime_initialization(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'model.onnx';path.write_bytes(b'corrupted fixture')
            from unittest.mock import Mock
            constructor=Mock()
            with patch.dict('sys.modules',{'onnxruntime':SimpleNamespace(InferenceSession=constructor)}),patch.object(timbre,'_SESSION',None),patch.object(timbre,'MODEL_PATH',path),patch.object(timbre,'MODEL_BYTES',path.stat().st_size),patch.object(timbre,'MODEL_SHA256','0'*64):
                result=timbre.analyze_robust_timbre(speech_like(1))
                self.assertFalse(result['available']);constructor.assert_not_called()


if __name__ == '__main__':
    unittest.main()
