from dataclasses import FrozenInstanceError
from email import policy
from email.parser import BytesParser
import io
import json
import math
import os
import threading
import unittest
from unittest.mock import Mock, patch
import wave

from packages.providers import prefix_translation as prefix
from packages.providers.live_voice import VoiceError


PCM = bytes(prefix.PREFIX_BYTES)


def turn(identifier, start, end, text, speaker=None):
    return {'turnId': identifier, 'startMs': start, 'endMs': end, 'transcript': text, 'speaker': speaker}


def transcription(*rows):
    return {'audioDurationMs': prefix.PREFIX_MS, 'turns': list(rows)}


class PrefixTests(unittest.TestCase):
    def test_local_timbres_overlap_two_advisories_but_use_one_serial_worker(self):
        barrier = threading.Barrier(3)
        lock = threading.Lock()
        counts = {'local':0, 'local_active':0, 'local_peak':0, 'remote_active':0, 'remote_peak':0}
        class Filter:
            def classify(self, _raw):return {'kind':'speech', 'skip':False}
        class Advisor:
            def analyze(self, _raw, *, cancelled):
                with lock:
                    counts['remote_active'] += 1
                    counts['remote_peak'] = max(counts['remote_peak'], counts['remote_active'])
                try:
                    barrier.wait(timeout=2)
                    return {'emotion':'calm', 'confidence':.8, 'voice_register':'low', 'register_confidence':.9}
                finally:
                    with lock:counts['remote_active'] -= 1
            def close(self):pass
        def timbre(_raw):
            with lock:
                counts['local'] += 1
                first = counts['local'] == 1
                counts['local_active'] += 1
                counts['local_peak'] = max(counts['local_peak'], counts['local_active'])
            try:
                if first:barrier.wait(timeout=2)
                return {'available':True, 'voice_timbre':'masculine', 'timbre_confidence':.99}
            finally:
                with lock:counts['local_active'] -= 1
        with patch.object(prefix, 'analyze_timbre', side_effect=timbre):
            result = prefix.prepare_prefix(PCM, cancelled=threading.Event(), content_filter_factory=Filter,
                prosody_factory=Advisor, transcriber=lambda *_args, **_kwargs:transcription(
                    turn(1,0,1200,'First owned phrase.'), turn(2,1200,2400,'Second owned phrase.'),
                    turn(3,2400,3600,'Third owned phrase.')))
        self.assertEqual((counts['local'], counts['local_peak'], counts['remote_peak']), (3,1,2))
        self.assertEqual([row.prosody.voice_timbre for row in result.turns], ['masculine']*3)
        metrics = dict(result.preparation_metrics)
        self.assertEqual(set(metrics), {'content_gate_ms','asr_ms','turn_classification_ms','prosody_ms',
                                      'local_timbre_ms','postprocess_ms','total_ms'})
        self.assertTrue(all(type(value) is float and math.isfinite(value) and value >= 0 for value in metrics.values()))
        self.assertIsInstance(result.preparation_metrics, tuple)
        self.assertTrue(all(isinstance(row, tuple) for row in result.preparation_metrics))
        self.assertNotIn('preparation_metrics', repr(result))

    def test_cancellation_after_one_local_model_never_starts_the_next_turn(self):
        cancelled = threading.Event()
        class Filter:
            def classify(self, _raw):return {'kind':'speech', 'skip':False}
        def timbre(_raw):
            cancelled.set()
            return {'available':True, 'voice_timbre':'masculine', 'timbre_confidence':.99}
        with patch.object(prefix, 'analyze_timbre', side_effect=timbre) as model:
            with self.assertRaisesRegex(VoiceError, 'canceló'):
                prefix.prepare_prefix(PCM, cancelled=cancelled, content_filter_factory=Filter,
                    transcriber=lambda *_args, **_kwargs:transcription(
                        turn(1,0,1200,'First owned phrase.'), turn(2,1200,2400,'Second owned phrase.')))
        self.assertEqual(model.call_count,1)

    def test_parallel_result_merge_preserves_confident_remote_or_available_local_abstention(self):
        class Filter:
            def classify(self, _raw):return {'kind':'speech', 'skip':False}
        class Advisor:
            def analyze(self, _raw, *, cancelled):
                return {'emotion':'calm','confidence':.8,'voice_register':'high','register_confidence':.9,
                        'voice_timbre':'feminine','timbre_confidence':.94}
            def close(self):pass
        local = [{'available':False,'voice_timbre':'uncertain','timbre_confidence':0.},
                 {'available':True,'voice_timbre':'uncertain','timbre_confidence':.81}]
        with patch.object(prefix,'analyze_timbre',side_effect=local):
            result = prefix.prepare_prefix(PCM, cancelled=threading.Event(), content_filter_factory=Filter,
                prosody_factory=Advisor, transcriber=lambda *_args, **_kwargs:transcription(
                    turn(1,0,1200,'First owned phrase.'), turn(2,1200,2400,'Second owned phrase.')))
        first, second = (row.prosody for row in result.turns)
        self.assertEqual((first.voice_timbre,first.timbre_confidence,first.timbre_source),('feminine',.94,'meta_audio_timbre'))
        self.assertEqual((second.voice_timbre,second.timbre_confidence,second.timbre_source),('uncertain',.81,'local_robust_voice_timbre'))
        self.assertEqual((first.emotion,second.emotion),('calm','calm'))

    def test_no_speech_omits_unrun_advisory_and_model_phases(self):
        class Filter:
            def classify(self, _raw):return {'kind':'unknown', 'skip':False}
        with patch.object(prefix,'analyze_timbre',side_effect=AssertionError('No local model without speech')):
            result = prefix.prepare_prefix(PCM, cancelled=threading.Event(), content_filter_factory=Filter,
                prosody_factory=Mock(side_effect=AssertionError('No advisor without turns')),
                transcriber=lambda *_args, **_kwargs:transcription())
        self.assertEqual(set(dict(result.preparation_metrics)),
            {'content_gate_ms','asr_ms','turn_classification_ms','postprocess_ms','total_ms'})

    def test_buffered_muse_upload_uses_one_exact_wav_and_diarization(self):
        requests = []
        closed = []

        class Response:
            status = 200

            def read(self, _limit):
                return json.dumps(transcription()).encode()

            def close(self):
                closed.append('response')

        class Connection:
            def request(self, method, path, *, body, headers):
                requests.append((method, path, body, headers))

            def getresponse(self):
                return Response()

            def close(self):
                closed.append('connection')

        with patch.dict(os.environ, {'BRIVANY_MUSE_API_KEY': 'synthetic-prefix-key'}):
            result = prefix._transcribe(PCM, cancelled=threading.Event(), connection_factory=lambda *_args, **_kwargs: Connection())
        self.assertEqual(result, transcription())
        self.assertEqual(closed, ['response', 'connection'])
        self.assertEqual(len(requests), 1)
        method, path, body, headers = requests[0]
        self.assertEqual((method, path), ('POST', '/v1/asr/transcribe'))
        self.assertEqual(headers['Authorization'], 'Bearer synthetic-prefix-key')
        self.assertNotIn(b'synthetic-prefix-key', body)
        message = BytesParser(policy=policy.default).parsebytes(
            ('Content-Type: ' + headers['Content-Type'] + '\r\n\r\n').encode() + body)
        settings, audio = list(message.iter_parts())
        config = json.loads(settings.get_payload(decode=True))
        self.assertEqual((config['mode'], config['audioEncoding']), ('DIARIZATION', 'WAV'))
        with wave.open(io.BytesIO(audio.get_payload(decode=True))) as source:
            self.assertEqual((source.getframerate(), source.getnchannels(), source.getsampwidth()), (24000, 1, 2))
            self.assertEqual(source.readframes(source.getnframes()), PCM)

    def test_cutoff_only_reuses_confirmed_turns_and_keeps_content_in_memory(self):
        rows = transcription(turn(0, 80, 2200, '   Owned    words. ', 'A'),
                             turn(1, 2500, 4500, 'Owned song lyrics.', 'B'),
                             turn(2, 6200, 0, ''))
        classified = []
        advisories = []

        class Filter:
            def classify(self, raw):
                classified.append(len(raw))
                return {'kind': 'singing', 'skip': True} if len(raw) == 96000 else {'kind': 'speech', 'skip': False}

        class Advisor:
            def analyze(self, raw, *, cancelled):
                advisories.append((len(raw), cancelled.is_set()))
                return {'emotion': 'calm', 'confidence': .8, 'voice_register': 'low', 'register_confidence': .9}

            def close(self):
                pass

        result = prefix.prepare_prefix(PCM, cancelled=threading.Event(), prosody_factory=Advisor,
                                       content_filter_factory=Filter, transcriber=lambda *_args, **_kwargs: rows)
        self.assertEqual((result.duration_ms, result.resume_from_ms), (7000, 6200))
        self.assertEqual([(row.speaker, row.content) for row in result.turns], [('A', 'speech'), ('B', 'singing')])
        self.assertEqual(classified, [prefix.PREFIX_BYTES, 101760, 96000])
        self.assertEqual(advisories, [(101760, False)])
        self.assertEqual(result.turns[0].text, 'Owned words.')
        self.assertEqual(result.turns[0].prosody.as_dict('en')['voice_register'], 'low')
        self.assertTrue(result.turns[0].prosody.as_dict('en')['applied'])
        self.assertFalse(result.turns[0].prosody.as_dict('es')['applied'])
        self.assertIsNone(result.turns[1].prosody)
        self.assertEqual(result.turns[0].prosody.as_dict('en')['voice_timbre'],'uncertain')
        self.assertNotIn('Owned', repr(result))
        with self.assertRaises(FrozenInstanceError):
            result.resume_from_ms = 0

    def test_prefix_keeps_confident_catalog_timbre_separate_from_pitch(self):
        class Filter:
            def classify(self,_raw):return {'kind':'speech','skip':False}
        class Advisor:
            def analyze(self,_raw,*,cancelled):
                return {'emotion':'calm','confidence':.8,'voice_register':'high','register_confidence':.95,
                        'voice_timbre':'masculine','timbre_confidence':.91}
            def close(self):pass
        result=prefix.prepare_prefix(PCM,cancelled=threading.Event(),prosody_factory=Advisor,
            content_filter_factory=Filter,transcriber=lambda *_args,**_kwargs:transcription(turn(1,0,2500,'Owned speech.','A')))
        advisory=result.turns[0].prosody.as_dict('en')
        self.assertEqual((advisory['voice_register'],advisory['voice_timbre'],advisory['timbre_confidence']),('high','masculine',.91))

    def test_invalid_prefix_size_and_cancellation_stop_before_provider(self):
        entered = []
        def transcriber(*_args, **_kwargs):
            entered.append(True)
            return transcription()
        with self.assertRaisesRegex(VoiceError, 'siete segundos'):
            prefix.prepare_prefix(PCM[:-2], cancelled=threading.Event(), transcriber=transcriber)
        cancelled = threading.Event()
        cancelled.set()
        with self.assertRaisesRegex(VoiceError, 'canceló'):
            prefix.prepare_prefix(PCM, cancelled=cancelled, transcriber=transcriber)
        self.assertEqual(entered, [])

    def test_prefix_keeps_robust_model_abstention_and_confidence_for_voice_matching(self):
        class Filter:
            def classify(self,_raw):return {'kind':'speech','skip':False}
        uncertain={'available':True,'voice_timbre':'uncertain','timbre_confidence':.806631}
        with patch.object(prefix,'analyze_timbre',return_value=uncertain):
            result=prefix.prepare_prefix(PCM,cancelled=threading.Event(),content_filter_factory=Filter,
                transcriber=lambda *_args,**_kwargs:transcription(turn(1,0,2500,'Owned speech.','A')))
        advice=result.turns[0].prosody.as_dict('en')
        self.assertEqual((advice['voice_timbre'],advice['timbre_confidence'],advice['timbre_inference_source']),
            ('uncertain',.806631,'local_robust_voice_timbre'))
        self.assertFalse(advice['applied']);self.assertEqual(result.resume_from_ms,7000)

    def test_cancelling_active_upload_interrupts_provider_headers(self):
        cancelled = threading.Event()
        interrupted = threading.Event()

        class Connection:
            @property
            def sock(self):
                return self

            def request(self, *_args, **_kwargs):
                pass

            def getresponse(self):
                cancelled.set()
                if not interrupted.wait(.5):
                    raise AssertionError('The provider socket was not interrupted')
                raise OSError('Synthetic disconnect')

            def shutdown(self, _how):
                interrupted.set()

            def close(self):
                pass

        with patch.dict(os.environ, {'BRIVANY_MUSE_API_KEY': 'synthetic-prefix-key'}):
            with self.assertRaisesRegex(VoiceError, 'canceló'):
                prefix._transcribe(PCM, cancelled=cancelled, connection_factory=lambda *_args, **_kwargs: Connection())
        self.assertTrue(interrupted.is_set())

    def test_fully_transcribed_or_silent_prefix_resumes_at_seven_seconds(self):
        result = prefix.prepare_prefix(PCM, cancelled=threading.Event(), transcriber=lambda *_args, **_kwargs: transcription())
        self.assertEqual((result.turns, result.resume_from_ms), ((), 7000))

    def test_music_or_singing_only_opening_never_calls_muse_or_prosody(self):
        for kind in ('music', 'singing'):
            with self.subTest(kind=kind):
                decision = {'kind': kind, 'skip': True, 'speech_score': .03, f'{kind}_score': .95}
                content_filter = Mock()
                content_filter.classify.return_value = decision
                transcriber, prosody_factory = Mock(), Mock()
                with patch.object(prefix,'analyze_timbre',side_effect=AssertionError('Songs do not open the local voice model')):
                    result = prefix.prepare_prefix(PCM, cancelled=threading.Event(), prosody_factory=prosody_factory,
                        transcriber=transcriber, content_filter_factory=lambda: content_filter)
                transcriber.assert_not_called()
                prosody_factory.assert_not_called()
                self.assertEqual(content_filter.classify.call_count, 10)
                self.assertEqual(result.resume_from_ms, 7000)
                interval, = result.turns
                self.assertEqual((interval.start_ms, interval.end_ms, interval.content, interval.text), (0, 7000, kind, ''))
                self.assertEqual(set(dict(result.preparation_metrics)), {'content_gate_ms','total_ms'})

    def test_brief_speech_between_whole_clip_windows_still_reaches_muse(self):
        marker = b'\x01\x02' * 120
        start = 1200 * prefix.PCM_BYTES_PER_MS
        mixed = PCM[:start] + marker + PCM[start + len(marker):]

        class Filter:
            def classify(self, raw):
                if len(raw) < prefix.PREFIX_BYTES and marker in raw:
                    return {'kind': 'speech', 'skip': False, 'speech_score': .9}
                return {'kind': 'music', 'skip': True, 'speech_score': .03, 'music_score': .95}

        row = turn(-1, 1200, 2000, 'Owned speech over music.')
        del row['speaker']
        transcriber = Mock(return_value={'sessionId': 'test', 'transcript': row['transcript'], **transcription(row)})
        result = prefix.prepare_prefix(mixed, cancelled=threading.Event(), transcriber=transcriber, content_filter_factory=Filter)
        transcriber.assert_called_once()
        speaker, = result.turns
        self.assertEqual((speaker.turn_id, speaker.speaker, speaker.content, speaker.text), ('-1', None, 'speech', row['transcript']))

    def test_duplicate_or_out_of_range_provider_turn_is_rejected(self):
        for rows in (transcription(turn(0, 100, 1000, 'Owned.'), turn(0, 1500, 2000, 'Again.')),
                     transcription(turn(1, 100, 7200, 'Owned.'))):
            with self.subTest(rows=rows), self.assertRaisesRegex(VoiceError, 'turno'):
                prefix.prepare_prefix(PCM, cancelled=threading.Event(), transcriber=lambda *_args, **_kwargs: rows)


if __name__ == '__main__':
    unittest.main()
