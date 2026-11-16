"""Local-only: Groq translation session and its selection in direct capture."""
import json
import unittest
from unittest.mock import patch

from packages.providers import meta_translation as mt
from packages.providers import river_translation as river


class Reply:
    status = 200
    def __init__(self, frames):self.frames = frames; self.headers = {}
    def getheader(self, name, default=None):return {'Content-Type':'text/event-stream'}.get(name, default)
    def read(self, *_):return b''


class GroqSessionTests(unittest.TestCase):
    def test_configuration_requires_key_and_known_model(self):
        with patch.dict('os.environ', {'BRIVANY_GROQ_API_KEY':'', 'BRIVANY_GROQ_MODEL':''}):
            self.assertFalse(mt.groq_configuration()[2])
            with self.assertRaises(Exception):mt.GroqTranslationSession()
        with patch.dict('os.environ', {'BRIVANY_GROQ_API_KEY':'synthetic-only', 'BRIVANY_GROQ_MODEL':''}):
            key, model, ok = mt.groq_configuration()
            self.assertEqual((model, ok), ('qwen/qwen3.8-27b', True))
        with patch.dict('os.environ', {'BRIVANY_GROQ_API_KEY':'synthetic-only', 'BRIVANY_GROQ_MODEL':'unknown/model'}):
            self.assertFalse(mt.groq_configuration()[2])

    def test_request_goes_to_groq_with_system_role_and_no_reasoning(self):
        captured = {}
        class Connection:
            sock = None
            def __init__(self, host, port, timeout):captured['host'] = host
            def request(self, method, path, body, headers):
                captured.update(path=path, body=json.loads(body), auth=headers['Authorization'])
                raise OSError('stop after capture')
            def close(self):pass
        with patch.dict('os.environ', {'BRIVANY_GROQ_API_KEY':'synthetic-only', 'BRIVANY_GROQ_MODEL':''}):
            session = mt.GroqTranslationSession(_connection_factory=Connection)
            with self.assertRaises(Exception):
                list(session.stream('Hola a todos.', 'auto', 'en'))
        self.assertEqual((captured['host'], captured['path']), ('api.groq.com', '/openai/v1/chat/completions'))
        body = captured['body']
        self.assertEqual(body['model'], 'qwen/qwen3.8-27b')
        self.assertEqual(body['messages'][0]['role'], 'system')
        self.assertEqual(body['messages'][0]['content'], mt.INSTRUCTIONS)
        self.assertEqual(body['reasoning_effort'], 'none')
        self.assertTrue(body['stream'])
        self.assertEqual(json.loads(body['messages'][1]['content'])['source_text'], 'Hola a todos.')

    def test_meta_payload_is_unchanged(self):
        body = json.loads(mt._payload('Hola.', 'auto', 'en', None, 'muse-spark-1.3'))
        self.assertEqual((body['messages'][0]['role'], body['reasoning_effort']), ('developer', 'minimal'))


class SelectionTests(unittest.TestCase):
    def test_status_checks_groq_not_meta_for_groq(self):
        with patch.dict('os.environ', {'BRIVANY_GROQ_API_KEY':'synthetic-only', 'BRIVANY_META_API_KEY':'', 'BRIVANY_META_MODEL':''}):
            self.assertTrue(river.river_status(mt='groq')['stages']['translation'])
            self.assertFalse(river.river_status()['stages']['translation'])

    def test_metastream_uses_groq_session_when_asked(self):
        with patch.dict('os.environ', {'BRIVANY_GROQ_API_KEY':'synthetic-only', 'BRIVANY_GROQ_MODEL':''}):
            stream = river.MetaStream(provider='groq'); self.addCleanup(stream.close)
            self.assertIsInstance(stream.session, mt.GroqTranslationSession)
        with self.assertRaises(ValueError):river.MetaStream(provider='other')

    def test_inline_video_stream_uses_groq_with_inline_timeout(self):
        with patch.dict('os.environ', {'BRIVANY_GROQ_API_KEY':'synthetic-only', 'BRIVANY_GROQ_MODEL':''}):
            stream = river.MetaStream(inline_video=True, provider='groq'); self.addCleanup(stream.close)
        self.assertIsInstance(stream.session, mt.GroqTranslationSession)
        self.assertEqual(stream.session.timeout_seconds, river.INLINE_MT_TIMEOUT)

    def test_bridge_rejects_unknown_translation_provider(self):
        with self.assertRaises(ValueError):
            river.RiverBridge(0, translation_provider='other')


if __name__ == '__main__':
    unittest.main()
