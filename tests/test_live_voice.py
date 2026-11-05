"""Provider contracts and real loopback relay with an in-process fake Meta server."""
import io
import json
import os
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError

from websockets.sync.client import connect
from websockets.sync.server import serve
from websockets.exceptions import InvalidStatus
from packages.providers.live_voice import MuseBridge, MuseEvents, MusePace, VoiceError, muse_handshake, open_melodi, voice_status
from services.h1.server import Handler, VOICE_LOCK


class LiveVoiceTests(unittest.TestCase):
    def test_muse_handshake_requires_permissions_and_keeps_key_server_side(self):
        with patch.dict(os.environ, {"BRIVANY_MUSE_API_KEY": "secret-test"}, clear=True):
            for options in ({}, {"type": "start", "consent": False}, {"type": "start", "consent": True, "mode": "meeting", "language": "es-ES"}):
                with self.assertRaises(VoiceError):
                    muse_handshake(options)
            body = muse_handshake({"type": "start", "consent": True, "mode": "practice", "language": "es-ES"})
            self.assertEqual(body["authorization"], {"accessToken": "Bearer secret-test"})
            self.assertEqual(body["mode"], "ENDPOINTING")
            self.assertEqual(body["audioEncoding"], "PCM_24KHZ")
            self.assertNotIn("secret-test", json.dumps(voice_status()))

    def test_overlapping_turns_cumulative_partials_diarization_and_deduplication(self):
        events = MuseEvents()
        events.accept({"type": "speechStart", "turnId": 1, "audioProcessedMs": 800})
        events.accept({"type": "speaker", "label": "A"})
        first = events.accept({"type": "transcript", "transcript": "una idea"})
        revised = events.accept({"type": "transcript", "transcript": "una idea mejor", "final": True})
        self.assertEqual(first["id"], revised["id"])
        self.assertFalse(revised["final"])
        events.accept({"type": "speechStart", "turnId": 2, "audioProcessedMs": 2400})
        events.accept({"type": "speaker", "label": "B"})
        late = events.accept({"type": "speechComplete", "turnId": 1, "transcript": "Una idea mejor."})
        self.assertEqual((late["speaker"], late["at"]), ("A", .8))
        self.assertIsNone(events.accept({"type": "speechComplete", "turnId": 1, "transcript": "Duplicate"}))
        self.assertEqual(events.accept({"type": "speechComplete", "turnId": 2, "transcript": "Sí."})["speaker"], "B")

    def test_empty_transcripts_retract_provisional_ui_without_fabricating_text(self):
        events = MuseEvents()
        events.accept({"type": "speechStart", "turnId": 1})
        partial = events.accept({"type": "transcript", "transcript": ""})
        self.assertEqual(partial["text"], "")
        self.assertFalse(partial["final"])
        final = events.accept({"type": "speechComplete", "turnId": 1, "transcript": ""})
        self.assertEqual(final["text"], "")
        self.assertTrue(final["final"])

    def test_melodi_uses_cartesia_configuration_without_cloudflare(self):
        with patch.dict(os.environ,{'BRIVANY_CARTESIA_API_KEY':'synthetic-only'},clear=True):
            status=voice_status()['tts']
            self.assertTrue(status['configured']);self.assertEqual(status['provider'],'Cartesia')
            self.assertEqual(status['voice_ids']['es'],'3597a26f-80ef-4bd5-8101-9699bc764917')
            self.assertEqual(status['voice_ids']['en'],'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4')
        with patch('packages.providers.cartesia_melodi.open_cartesia_speech') as factory:
            self.assertIs(open_melodi('Hello.',language='en'),factory.return_value)
            factory.assert_called_once_with('Hello.','en',speed=1)

    def test_relay_forwards_pcm_flushes_final_and_rejects_foreign_origin(self):
        received = []
        def upstream(ws):
            received.append(json.loads(ws.recv()))
            ws.send(json.dumps({"sessionId": "fake-session"}))
            received.append(ws.recv())
            ws.send(json.dumps({"type": "speechStart", "turnId": 7, "audioProcessedMs": 0}))
            ws.send(json.dumps({"type": "transcript", "transcript": "Hola"}))
            received.append(json.loads(ws.recv()))
            ws.send(json.dumps({"type": "speechComplete", "turnId": 7, "transcript": "Hola, Melodi."}))
        with serve(upstream, "127.0.0.1", 0, compression=None) as fake:
            threading.Thread(target=fake.serve_forever, daemon=True).start()
            endpoint = f"ws://127.0.0.1:{fake.socket.getsockname()[1]}"
            bridge = MuseBridge(9876).start()
            try:
                url = f"ws://127.0.0.1:{bridge.port}/live"
                with self.assertRaises(InvalidStatus):
                    connect(url, origin="https://foreign.example", proxy=None)
                with patch.dict(os.environ, {"BRIVANY_MUSE_API_KEY": "secret-test"}, clear=True), patch("packages.providers.live_voice.MUSE_URL", endpoint):
                    with connect(url, origin="http://127.0.0.1:9876", proxy=None) as client:
                        client.send(json.dumps({"type": "start", "consent": True, "mode": "meeting", "meetingConsent": True, "language": "es-ES"}))
                        ready = json.loads(client.recv(timeout=3))
                        self.assertEqual(ready["type"], "ready")
                        self.assertNotIn("secret-test", json.dumps(ready))
                        client.send(b"\0" * 3840)
                        self.assertEqual(json.loads(client.recv(timeout=3))["type"], "speech-start")
                        self.assertFalse(json.loads(client.recv(timeout=3))["final"])
                        client.send('{"type":"endStream"}')
                        self.assertEqual(json.loads(client.recv(timeout=3))["text"], "Hola, Melodi.")
                self.assertEqual(received[0]["mode"], "DIARIZATION")
                self.assertEqual(received[1], b"\0" * 3840)
                self.assertEqual(received[2], {"type": "endStream"})
            finally:
                bridge.close()
                fake.shutdown()


    def test_barge_control_stays_local_and_bounded_onset_reaches_muse(self):
        received=[];ended=threading.Event()
        def upstream(ws):
            received.append(json.loads(ws.recv()));ws.send(json.dumps({'sessionId':'synthetic'}))
            for raw in ws:
                received.append(raw)
                if isinstance(raw,str) and json.loads(raw)=={'type':'endStream'}:ended.set();break
        with serve(upstream,'127.0.0.1',0,compression=None) as fake:
            threading.Thread(target=fake.serve_forever,daemon=True).start()
            bridge=MuseBridge(9876).start()
            try:
                with patch.dict(os.environ,{'BRIVANY_MUSE_API_KEY':'synthetic'},clear=True),patch('packages.providers.live_voice.MUSE_URL',f'ws://127.0.0.1:{fake.socket.getsockname()[1]}'):
                    with connect(f'ws://127.0.0.1:{bridge.port}/live',origin='http://127.0.0.1:9876',proxy=None) as client:
                        client.send(json.dumps({'type':'start','consent':True,'mode':'practice','language':'es-ES','bargeIn':True}))
                        self.assertEqual(json.loads(client.recv(timeout=3))['type'],'ready')
                        for _ in range(4):client.send(b'\0'*3840)
                        client.send(json.dumps({'type':'resumeSpeech','replay_frames':4}))
                        for _ in range(4):client.send(b'\x01\x01'*1920)
                        client.send(json.dumps({'type':'endStream'}));self.assertTrue(ended.wait(2))
                self.assertEqual(len(received),10)
                self.assertEqual(received[1:5],[b'\0'*3840]*4)
                self.assertEqual(received[5:9],[b'\x01\x01'*1920]*4)
                self.assertNotIn('resumeSpeech',str(received[0]));self.assertEqual(json.loads(received[-1]),{'type':'endStream'})
            finally:bridge.close();fake.shutdown()


class MusePaceTests(unittest.TestCase):
    def test_repeated_short_onset_replays_do_not_accumulate_false_backlog(self):
        pace=MusePace(True);elapsed=0
        for _ in range(20):
            for _ in range(4):
                elapsed+=.08;pace.audio(b'\0'*3840,elapsed)
            pace.resume({'type':'resumeSpeech','replay_frames':4})
            for _ in range(4):pace.audio(b'\x01\x01'*1920,elapsed)
        self.assertEqual(pace.credit,20*4*3840)

    def test_unnegotiated_or_unbacked_replay_and_fast_audio_are_rejected(self):
        for pace,frames in [(MusePace(),3),(MusePace(True),3),(MusePace(True),5),(MusePace(True),True)]:
            with self.assertRaises(VoiceError):pace.resume({'type':'resumeSpeech','replay_frames':frames})
        pace=MusePace(True)
        with self.assertRaises(VoiceError):pace.audio(b'\x01'*100000,0)


class SpeechHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def call(self, data):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request("POST", "/api/voice/speech", json.dumps(data), {"Content-Type": "application/json"})
        response = connection.getresponse()
        result = response.status, response.read(), response.getheader("Content-Type")
        connection.close()
        return result

    def test_speech_requires_consent_and_rejects_provider_override(self):
        with patch("services.h1.server.open_melodi") as provider:
            self.assertEqual(self.call({"text": "Hola"})[0], 422)
            self.assertEqual(self.call({"text": "Hola", "consent": True, "url": "http://foreign"})[0], 422)
            self.assertEqual(self.call({"text": "a" * 1801, "consent": True})[0], 422)
            provider.assert_not_called()

    def test_streams_pcm_without_caching_and_rejects_concurrency(self):
        with patch("services.h1.server.open_melodi", return_value=io.BytesIO(b"\0\1" * 4000)):
            status, body, content_type = self.call({"text": "Hola", "consent": True})
            self.assertEqual(status, 200)
            self.assertEqual(len(body), 8000)
            self.assertTrue(content_type.startswith("audio/pcm"))
        VOICE_LOCK.acquire()
        try:
            self.assertEqual(self.call({"text": "Hola", "consent": True})[0], 409)
        finally:
            VOICE_LOCK.release()


if __name__ == "__main__":
    unittest.main()
