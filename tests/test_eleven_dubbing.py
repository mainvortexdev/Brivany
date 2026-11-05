"""ElevenLabs Realtime Translation wire tests: loopback only, no paid calls."""
import base64
import json
import os
import threading
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit
from websockets.sync.client import connect
from websockets.sync.server import serve
from websockets.exceptions import ConnectionClosed
from packages.providers.eleven_dubbing import ElevenBridge,ElevenEvents,dubbing_status,endpoint,parse_event,start_options
from packages.providers.live_voice import VoiceError

OPTIONS={"type":"start","consent":True,"source_language":"en","target_language":"es","max_seconds":5}
CONFIG={"BRIVANY_ELEVENLABS_API_KEY":"test-secret","BRIVANY_ELEVENLABS_VOICE_ID":"available-voice"}
PCM=b"\0\1"*2400


def ready(ws):
    ws.send(json.dumps({"message_type":"session_started","session_id":"test"}))
    ws.send(json.dumps({"message_type":"status","status":"started"}))


class ElevenDubbingTests(unittest.TestCase):
    def test_consent_key_voice_limits_and_no_secret_query(self):
        with patch.dict(os.environ,{},clear=True):
            self.assertFalse(dubbing_status()["configured"])
            with self.assertRaises(VoiceError): start_options(OPTIONS)
        with patch.dict(os.environ,{"BRIVANY_ELEVENLABS_API_KEY":"test-secret"},clear=True):
            with self.assertRaises(VoiceError) as error: start_options(OPTIONS)
            self.assertEqual(error.exception.code,"dubbing_voice_required")
        with patch.dict(os.environ,CONFIG,clear=True):
            self.assertEqual(start_options(OPTIONS),("en","es",5))
            for options in ({**OPTIONS,"consent":False},{**OPTIONS,"max_seconds":True},{**OPTIONS,"max_seconds":61},{**OPTIONS,"source_language":"es"},{**OPTIONS,"voice_id":"client-override"}):
                with self.assertRaises(VoiceError): start_options(options)
            query=parse_qs(urlsplit(endpoint("en","es")).query)
            self.assertEqual(query["input_format"],["pcm_24000"]);self.assertEqual(query["output_format"],["pcm_24000"])
            self.assertEqual(query["tts_model_id"],["eleven_flash_v2_5"]);self.assertEqual(query["eagerness"],["high"])
            self.assertNotIn("test-secret",endpoint("en","es"));self.assertNotIn("test-secret",json.dumps(dubbing_status()))

    def test_event_formats_final_segments_and_actionable_sanitized_errors(self):
        events=ElevenEvents()
        self.assertIsNone(events.accept({"message_type":"partial_transcript","text":"partial"}))
        self.assertEqual(events.accept({"message_type":"final_transcript","text":"Hello"})["source"],"original")
        self.assertEqual(events.accept({"message_type":"translation","text":"Hola"})["text"],"Hola ")
        self.assertEqual(base64.b64decode(events.accept({"message_type":"audio","sample_rate":24000,"data":base64.b64encode(PCM).decode()})["audio"]),PCM)
        for event in ({"message_type":"audio","sample_rate":22050,"data":""},{"message_type":"audio","sample_rate":24000,"data":"bad"}):
            with self.assertRaises(VoiceError): events.accept(event)
        for kind in ("auth_error","quota_exceeded","payment_issue","unaccepted_terms","rate_limited"):
            with self.assertRaises(VoiceError) as error: parse_event(json.dumps({"message_type":kind,"error":"test-secret private"}))
            self.assertNotIn("test-secret",str(error.exception))

    def with_relay(self,handler,body):
        with serve(handler,"127.0.0.1",0,compression=None) as fake:
            threading.Thread(target=fake.serve_forever,daemon=True).start()
            bridge=ElevenBridge(9876).start()
            try:
                with patch.dict(os.environ,CONFIG,clear=True),patch("packages.providers.eleven_dubbing.URL",f"ws://127.0.0.1:{fake.socket.getsockname()[1]}"):body(bridge)
            finally:bridge.close()

    @staticmethod
    def browser(bridge):return connect(f"ws://127.0.0.1:{bridge.port}/dub",origin="http://127.0.0.1:9876",proxy=None)

    def test_real_wire_pcm_final_tail_stopped_and_metrics(self):
        received=[]
        def upstream(ws):
            self.assertEqual(ws.request.headers["xi-api-key"],"test-secret");self.assertNotIn("test-secret",ws.request.path)
            ready(ws);received.append(json.loads(ws.recv()));received.append(json.loads(ws.recv()))
            ws.send(json.dumps({"message_type":"translation","text":"Hola"}))
            ws.send(json.dumps({"message_type":"audio","sample_rate":24000,"data":base64.b64encode(PCM).decode()}))
            ws.send(json.dumps({"message_type":"status","status":"stopped"}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));self.assertEqual(json.loads(browser.recv(timeout=2))["type"],"ready")
                browser.send(PCM);browser.send(json.dumps({"type":"finish"}));values=[]
                while True:
                    event=json.loads(browser.recv(timeout=2));values.append(event)
                    if event["type"]=="done":break
                self.assertTrue(any(event["type"]=="audio" for event in values))
                self.assertTrue(all(event["inference_ms"] is None and event["inference_verified"] is False for event in values if event["type"]=="metrics"))
        self.with_relay(upstream,body)
        self.assertEqual(received[0]["message_type"],"input_audio_chunk");self.assertEqual(base64.b64decode(received[0]["audio_base_64"]),PCM)
        self.assertEqual(received[1],{"message_type":"end_of_stream"})

    def test_missing_voice_does_not_contact_provider(self):
        bridge=ElevenBridge(9876).start()
        try:
            with patch.dict(os.environ,{"BRIVANY_ELEVENLABS_API_KEY":"test-secret"},clear=True),patch("packages.providers.eleven_dubbing.connect") as upstream:
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS));self.assertEqual(json.loads(browser.recv(timeout=2))["code"],"dubbing_voice_required")
                upstream.assert_not_called()
        finally:bridge.close()

    def test_cancel_concurrency_and_format_failures(self):
        disconnected=threading.Event()
        def upstream(ws):
            ready(ws)
            try:
                for _ in ws:pass
            finally:disconnected.set()
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2)
                with self.browser(bridge) as other:self.assertEqual(json.loads(other.recv(timeout=2))["code"],"dubbing_busy")
                browser.send(json.dumps({"type":"cancel"}));self.assertTrue(disconnected.wait(2))
            for data,count,code in ((b"odd",1,"dubbing_audio_format"),(b"\0"*9602,1,"dubbing_audio_format"),(b"\0"*9600,3,"dubbing_backlog")):
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS));browser.recv(timeout=2)
                    for _ in range(count):browser.send(data)
                    self.assertEqual(json.loads(browser.recv(timeout=2))["code"],code)
        self.with_relay(upstream,body)

    def test_enterprise_denial_has_actionable_error_without_fallback(self):
        def upstream(ws):ws.send(json.dumps({"message_type":"auth_error","error":"test-secret enterprise"}))
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));error=json.loads(browser.recv(timeout=2))
                self.assertEqual(error["code"],"dubbing_access");self.assertIn("Enterprise",error["message"]);self.assertNotIn("test-secret",error["message"])
        self.with_relay(upstream,body)

    def test_finish_timeout_and_idle_wall_deadline(self):
        def waiting(ws):
            ready(ws)
            try:
                for _ in ws:pass
            except ConnectionClosed:pass
        def body(bridge):
            with self.browser(bridge) as browser,patch("packages.providers.eleven_dubbing.DRAIN_SECONDS",.05):
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(json.dumps({"type":"finish"}))
                self.assertEqual(json.loads(browser.recv(timeout=2))["code"],"dubbing_drain_timeout")
        self.with_relay(waiting,body)
        def ended(ws):
            ready(ws);self.assertEqual(json.loads(ws.recv(timeout=7)),{"message_type":"end_of_stream"})
            ws.send(json.dumps({"message_type":"status","status":"stopped"}))
        def idle_body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2)
                while True:
                    event=json.loads(browser.recv(timeout=7))
                    if event["type"]=="metrics":self.assertIsNone(event["first_output_audio_ms"])
                    if event["type"]=="done":break
        self.with_relay(ended,idle_body)


if __name__=="__main__":unittest.main()
