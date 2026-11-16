"""Deepgram adapters: pure event mapping to River's Muse shape (no network)."""
import json
import os
import unittest
from unittest.mock import patch

from packages.providers import deepgram_asr as dg
from packages.providers import river_translation as river


class FakeSocket:
    def __init__(self, url, **options): self.url = url; self.options = options; self.sent = []
    def __iter__(self): return iter(())
    def send(self, data): self.sent.append(data)
    def close(self): pass


def make(cls):
    sockets = []
    def connector(url, **options):
        sockets.append(FakeSocket(url, **options)); return sockets[-1]
    adapter = cls(connector=connector, key='synthetic-key')
    return adapter, sockets[0]


class NovaTests(unittest.TestCase):
    def test_url_and_auth_header(self):
        adapter, socket = make(dg.DeepgramAsrSocket)
        self.assertTrue(socket.url.startswith('wss://api.deepgram.com/v1/listen?model=nova-3'))
        self.assertIn('interim_results=true', socket.url); self.assertIn('sample_rate=24000', socket.url)
        self.assertEqual(socket.options['additional_headers'], {'Authorization': 'Token synthetic-key'})

    def test_interim_stretches_become_cumulative_turn_text(self):
        adapter, _ = make(dg.DeepgramAsrSocket)
        result = lambda text, final=False, speech=False, start=0., duration=1.: {'type': 'Results', 'is_final': final, 'speech_final': speech,
            'start': start, 'duration': duration, 'channel': {'alternatives': [{'transcript': text}]}}
        first = adapter.translate(result('so i built'))
        self.assertEqual([e['type'] for e in first], ['speechStart', 'transcript'])
        adapter.translate(result('so I built a tool', final=True))
        update = adapter.translate(result('that maps', start=1., duration=.8))
        self.assertEqual(update[-1]['transcript'], 'so I built a tool that maps')
        self.assertEqual(update[-1]['audioProcessedMs'], 1800.0)
        done = adapter.translate(result('that maps your code.', final=True, speech=True, start=1., duration=1.5))
        self.assertEqual(done[-1]['type'], 'speechComplete')
        self.assertEqual(done[-1]['transcript'], 'so I built a tool that maps your code.')
        self.assertEqual(adapter.translate({'type': 'UtteranceEnd'}), [])
        self.assertEqual(adapter.translate(result('next', start=3.))[0]['turnId'], '2')

    def test_errors_while_ending_are_ignored(self):
        adapter, _ = make(dg.DeepgramAsrSocket)
        self.assertEqual(adapter.translate({'type': 'Error', 'description': 'x'})[0]['type'], 'error')
        adapter.ending = True
        self.assertEqual(adapter.translate({'type': 'Error', 'description': 'x'}), [])


class FluxTests(unittest.TestCase):
    def test_flux_url_and_turn_events(self):
        adapter, socket = make(dg.DeepgramFluxSocket)
        self.assertTrue(socket.url.startswith('wss://api.deepgram.com/v2/listen?model=flux-general-en'))
        info = lambda event, text, end: {'type': 'TurnInfo', 'event': event, 'transcript': text, 'audio_window_start': 0., 'audio_window_end': end}
        start = adapter.translate(info('StartOfTurn', '', .3))
        self.assertEqual(start[0]['type'], 'speechStart')
        self.assertEqual(adapter.translate(info('Update', 'so I built', .9))[-1], {'type': 'transcript', 'transcript': 'so I built', 'audioProcessedMs': 900.0})
        self.assertEqual(adapter.translate(info('EagerEndOfTurn', 'so I built a tool', 1.2))[-1]['type'], 'transcript')
        end = adapter.translate(info('EndOfTurn', 'So I built a tool.', 1.4))
        self.assertEqual(end[-1], {'type': 'speechComplete', 'turnId': '1', 'transcript': 'So I built a tool.', 'audioProcessedMs': 1400.0})


class SelectionTests(unittest.TestCase):
    def test_deepgram_is_an_accepted_direct_provider_and_status_checks_its_key(self):
        river.RiverBridge(0, asr_provider='deepgram')
        with patch.dict(os.environ, {'BRIVANY_DEEPGRAM_API_KEY': ''}):
            self.assertFalse(river.river_status(asr='deepgram', mt='groq')['stages']['asr'])
        with patch.dict(os.environ, {'BRIVANY_DEEPGRAM_API_KEY': 'synthetic'}):
            self.assertTrue(river.river_status(asr='deepgram', mt='groq')['stages']['asr'])


if __name__ == '__main__':
    unittest.main()
