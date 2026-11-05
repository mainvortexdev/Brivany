import json
from pathlib import Path
import tempfile
import unittest

from tools.inline_translation_lab import Lab, PUBLIC_TRIAL, sanitize_report,ERROR_MESSAGES
from tools.run_isolated_inline import trial_minimum_source_end


class InlineTrialCoverageTests(unittest.TestCase):
    def test_opening_failure_preserves_only_known_phase_code_and_partial_prefix_diagnostics(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'inline-sync-owned.json'
            path.write_text(json.dumps({'type':PUBLIC_TRIAL,'error_code':'source_navigation_timeout','opening_phase':'navegar-video',
                'error':'raw URL or private error must not be forwarded','prefix':{'diagnostic_partial':True,'prepared_before_activation':False,
                'pcm_sent_ms':7040,'error_code':'prefix_asr_timeout','turns':[], 'preparation_metrics':{'asr_ms':2300}},'cues':[]}),encoding='utf-8')
            safe=sanitize_report(path)
            self.assertEqual((safe['error_code'],safe['opening_phase']),('source_navigation_timeout','navegar-video'))
            self.assertIn(safe['error_code'],ERROR_MESSAGES)
            self.assertNotIn('error',safe)
            self.assertTrue(safe['prefix']['diagnostic_partial'])
            self.assertFalse(safe['prefix']['prepared_before_activation'])
            self.assertEqual(safe['prefix']['pcm_sent_ms'],7040)
            path.write_text(json.dumps({'type':PUBLIC_TRIAL,'error_code':'private URL text','opening_phase':'untrusted','cues':[]}),encoding='utf-8')
            unknown=sanitize_report(path)
            self.assertIsNone(unknown['error_code'])
            self.assertNotIn('opening_phase',unknown)
            path.write_text(json.dumps({'type':PUBLIC_TRIAL,'error_code':['untrusted'],'opening_phase':{},'cues':[]}),encoding='utf-8')
            malformed=sanitize_report(path)
            self.assertIsNone(malformed['error_code'])
            self.assertNotIn('opening_phase',malformed)

    def test_prefix_phase_durations_are_numeric_bounded_and_preserve_missing_phases(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'inline-sync-owned.json'
            path.write_text(json.dumps({'type':PUBLIC_TRIAL,'prefix':{'preparation_metrics':{
                'asr_ms':2100.5,'total_ms':3200,'capture_receive_ms':7040,'prosody_ms':True,
                'local_timbre_ms':-1,'content_gate_ms':float('inf'),'transcript':'fixture text'}},'cues':[]}),encoding='utf-8')
            safe=sanitize_report(path)
        self.assertEqual(safe['prefix']['preparation_metrics'],{'asr_ms':2100.5,'total_ms':3200,'capture_receive_ms':7040})

    def test_minimum_coverage_keeps_the_existing_observation_budget(self):
        self.assertEqual(trial_minimum_source_end(12),12)
        self.assertEqual(trial_minimum_source_end(20),20)
        for value in (-1,21,121,True,float('nan'),float('inf')):
            with self.assertRaises(ValueError):trial_minimum_source_end(value)
        self.assertEqual(trial_minimum_source_end(),0)
        self.assertEqual(trial_minimum_source_end(long_trial=True),31)
        self.assertEqual(trial_minimum_source_end(extended=True),120)
        self.assertEqual(trial_minimum_source_end(120,extended=True),120)

    def test_deep_lab_reports_twelve_seconds_without_claiming_opening_preparation(self):
        lab=Lab(position=300,target='en',minimum_source_end=12)
        status=lab.status()
        self.assertEqual(status['required_source_end_ms'],12000)
        self.assertEqual(status['required_live_source_end_ms'],0)
        self.assertEqual(status['observation_limit_seconds'],28)
        self.assertFalse(status['prefix_requested'])
        self.assertFalse(status['continuity_trial'])

    def test_required_and_completed_coverage_survive_report_sanitization(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'inline-sync-owned.json'
            path.write_text(json.dumps({'type':PUBLIC_TRIAL,'required_source_end_ms':12000,
                                        'completed_source_end_ms':15250,'cues':[]}),encoding='utf-8')
            safe=sanitize_report(path)
        self.assertEqual(safe['required_source_end_ms'],12000)
        self.assertEqual(safe['completed_source_end_ms'],15250)

    def test_production_signal_and_recovery_metrics_survive_without_audio_or_text(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'inline-sync-owned.json'
            path.write_text(json.dumps({'type':PUBLIC_TRIAL,'production_audio_diagnostics':{
                'signaled_voices':3,'completed_voice_count':3,'completed_voices_with_signal':3,
                'first_signal_after_capture_ms':4173,'recorder_gap_recoveries':1,
                'transcript':'untrusted fixture text','pcm_base64':'not audio', 'other':5},'cues':[]}),encoding='utf-8')
            safe=sanitize_report(path)
        self.assertEqual(safe['production_audio_diagnostics'],{
            'signaled_voices':3,'completed_voice_count':3,'completed_voices_with_signal':3,
            'first_signal_after_capture_ms':4173,'recorder_gap_recoveries':1})

    def test_parallel_request_diagnostics_keep_explicit_partial_and_numeric_correlation_only(self):
        rows=[{'type':'stage-metrics','stage':'mt_start','segment_index':1,'request_ms':0,'attempts':1},
              {'type':'stage-metrics','stage':'mt_first','segment_index':2,'request_to_first_ms':1701},
              {'type':'stage-metrics','stage':'mt_skipped','segment_index':1,'phase':'sse','partial':False,
               'request_ms':6505,'segment_id':'untrusted-identifier','transcript':'fixture','pcm_base64':'fixture'},
              {'type':'stage-metrics','stage':'mt_done','segment_index':2,'request_ms':1775,'total_attempts':7},
              {'type':'stage-metrics','stage':'tts_done','request_to_last_chunk_ms':900,'last_chunk_to_done_ms':12,'pcm_base64':'fixture'},
              {'type':'stage-metrics','stage':'cue_ready','published_ahead':True,'leading_padding_ms':70.125,'trailing_padding_ms':0},
              {'segment_index':129,'phase':'untrusted','partial':'false','request_ms':-1,'attempts':True,'last_chunk_to_done_ms':-1},
              {'segment_index':1.5,'request_ms':float('inf'),'total_attempts':513}]
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'inline-sync-owned.json'
            path.write_text(json.dumps({'type':PUBLIC_TRIAL,'protocol':rows,'cues':[]}),encoding='utf-8')
            safe=sanitize_report(path)
        self.assertEqual([row.get('segment_index') for row in safe['protocol']],[1,2,1,2,None,None,None,None])
        self.assertEqual(safe['protocol'][2],{'type':'stage-metrics','stage':'mt_skipped','segment_index':1,
            'phase':'sse','partial':False,'request_ms':6505})
        self.assertNotIn('partial',safe['protocol'][0])
        self.assertEqual(safe['protocol'][4],{'type':'stage-metrics','stage':'tts_done','request_to_last_chunk_ms':900,'last_chunk_to_done_ms':12})
        self.assertEqual(safe['protocol'][5],{'type':'stage-metrics','stage':'cue_ready','published_ahead':True,'leading_padding_ms':70.125,'trailing_padding_ms':0})
        self.assertEqual(safe['protocol'][-2:],[{},{}])
