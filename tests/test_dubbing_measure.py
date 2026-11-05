"""Measurement correctness against a loopback relay; no upstream providers."""
import base64
import json
import threading
import unittest
from unittest.mock import patch
from websockets.sync.server import serve
from tools.measure_dubbing import run_trial, provider_price, TrialError, safe_gemini_diagnostics, read_status

STATUS = {"provider": "Meta modular", "model": "muse-m2m100-melodi"}


class MeasurementTests(unittest.TestCase):
    def test_openai_preflight_requires_selected_route_and_a_dedicated_configured_key(self):
        from unittest.mock import MagicMock
        def response(value):
            item=MagicMock();item.__enter__.return_value.read.return_value=json.dumps(value).encode();return item
        endpoint='ws://127.0.0.1:9877/dub'
        with patch('tools.measure_dubbing.build_opener') as opener:
            opener.return_value.open.return_value=response({'provider':'OpenAI','model':'gpt-realtime-translate','configured':False,'available':False})
            with self.assertRaises(TrialError) as failure:read_status('http://127.0.0.1:9876','openai')
            self.assertEqual(failure.exception.code,'not_configured')
            opener.return_value.open.return_value=response({'provider':'Palabra','model':'speech-to-speech','configured':True,'available':True,'websocket_url':endpoint})
            with self.assertRaises(TrialError) as failure:read_status('http://127.0.0.1:9876','openai')
            self.assertEqual(failure.exception.code,'unexpected_model')
            opener.return_value.open.return_value=response({'provider':'OpenAI','model':'gpt-realtime-translate','configured':True,'available':True,'websocket_url':endpoint})
            status,url=read_status('http://127.0.0.1:9876','openai')
            self.assertEqual(status['provider'],'OpenAI');self.assertEqual(url,endpoint)

    def test_palabra_partials_are_requested_but_not_assumed_observed_or_audible(self):
        status={"provider":"Palabra","model":"speech-to-speech"};pcm=b"\0\1"*1920
        def relay(ws):
            options=json.loads(ws.recv());self.assertIs(options["translate_partials"],True)
            ws.send(json.dumps({"type":"ready",**status,"sample_rate":24000,"max_seconds":5,
                "translate_partials_requested":True,"translate_partials_observed":None}))
            for raw in ws:
                if isinstance(raw,bytes):continue
                if json.loads(raw)=={"type":"finish"}:
                    ws.send(json.dumps({"type":"audio","audio":base64.b64encode(pcm).decode(),"sample_rate":24000}))
                    ws.send(json.dumps({"type":"done"}));return
        with serve(relay,"127.0.0.1",0,compression=None) as fake:
            threading.Thread(target=fake.serve_forever,daemon=True).start()
            report=run_trial("http://127.0.0.1:9876",f"ws://127.0.0.1:{fake.socket.getsockname()[1]}/dub",
                "es",pcm,{"duration_seconds":.08},provider_status=status,source_language="en",palabra_partials=True)
        self.assertEqual(report["status"],"passed")
        self.assertTrue(report["palabra_translate_partials_requested"])
        self.assertIsNone(report["palabra_translate_partials_observed"])
        self.assertEqual(report["target_audible_delay_ms"],500)
        self.assertFalse(report["audible_delay_verified"])
        self.assertFalse(report["physical_playback_measured"])

    def test_opt_in_review_collects_only_audio_and_text_and_never_provider_metadata(self):
        from unittest.mock import Mock
        review=Mock(); pcm=b"\0\1"*1920
        def relay(ws):
            ws.recv();ws.send(json.dumps({"type":"ready",**STATUS,"sample_rate":24000,"max_seconds":5}))
            for raw in ws:
                if isinstance(raw,bytes):continue
                if json.loads(raw)=={"type":"finish"}:
                    ws.send(json.dumps({"type":"metrics","private_field":"must-not-enter-review"}))
                    ws.send(json.dumps({"type":"transcript","source":"translation","text":"Una prueba."}))
                    ws.send(json.dumps({"type":"audio","audio":base64.b64encode(pcm).decode(),"sample_rate":24000}))
                    ws.send(json.dumps({"type":"done"}));return
        with serve(relay,"127.0.0.1",0,compression=None) as fake:
            threading.Thread(target=fake.serve_forever,daemon=True).start()
            result=run_trial("http://127.0.0.1:9876",f"ws://127.0.0.1:{fake.socket.getsockname()[1]}/dub",
                "es",pcm,{"duration_seconds":.08},provider_status=STATUS,source_language="en",synthetic_review=review)
        self.assertEqual(result["status"],"passed")
        self.assertEqual([call.args[0]["type"] for call in review.collect.call_args_list],["transcript","audio"])
        self.assertFalse(review.finish.called)

    def test_google_local_closure_is_not_provider_flush_or_verified_translation(self):
        status={"provider":"Google Gemini","model":"gemini-3.5-live-translate-preview"}
        pcm=b"\0\1"*1920
        def relay(ws):
            options=json.loads(ws.recv());self.assertEqual(options["source_language"],"en")
            self.assertEqual(options["tail_silence_seconds"],2)
            ws.send(json.dumps({"type":"ready",**status,"sample_rate":24000,"max_seconds":5}))
            for raw in ws:
                if isinstance(raw,bytes):continue
                if json.loads(raw)=={"type":"finish"}:
                    ws.send(json.dumps({"type":"audio","audio":base64.b64encode(pcm).decode(),"sample_rate":24000}))
                    ws.send(json.dumps({"type":"metrics","provider_input_bytes":66560,"provider_real_input_bytes":2560,
                        "provider_input_sample_rate":16000,"padding_input_bytes":64000,"padding_input_seconds":2}))
                    ws.send(json.dumps({"type":"done","session_closed_locally":True,"finalization_verified":False,
                        "completion_method":"bounded_post_input_drain","completion_reason":"quiet_window"}));return
        with serve(relay,"127.0.0.1",0,compression=None) as fake:
            threading.Thread(target=fake.serve_forever,daemon=True).start()
            result=run_trial("http://127.0.0.1:9876",f"ws://127.0.0.1:{fake.socket.getsockname()[1]}/dub",
                "es",pcm,{"duration_seconds":.08},provider_status=status,source_language="en",gemini_tail_silence=2)
        self.assertEqual(result["status"],"passed")
        self.assertTrue(result["session_closed_locally"])
        self.assertFalse(result["provider_finalization_verified"])
        self.assertFalse(result["full_translation_verified"])
        self.assertEqual(result["local_close_method"],"bounded_post_input_drain")
        self.assertEqual(result["local_close_reason"],"quiet_window")
        self.assertGreaterEqual(result["first_output_relative_input_end_ms"],0)
        self.assertGreaterEqual(result["input_end_to_done_ms"],0)
        self.assertEqual(result["estimated_base_service_usd"],.000226)
        self.assertEqual(result["experimental_tail_silence_seconds"],2)
        self.assertEqual(result["padding_input_bytes"],64000)
        self.assertTrue(result["estimate_uses_provider_input_counter"])
        self.assertIsNone(result["actual_billed_usd"])
        self.assertIsNone(result["inference_ms"])
        self.assertEqual(result["target_status"],"unverified")
        self.assertEqual(result["pcm_observation"]["sample_rate_hz"],24000)
        self.assertGreaterEqual(result["pcm_observation"]["first_above_threshold_ms"],0)
        self.assertEqual(result["pcm_observation"]["total_pcm_seconds"],.08)
        self.assertNotIn("audio",result["pcm_observation"])

    def test_gemini_diagnostics_only_persist_allowed_numeric_counters(self):
        result=safe_gemini_diagnostics({"events_received":5,"private-secret":"private-secret",
            "top_fields":{"serverContent":4,"private-secret":9},
            "server_content_fields":{"generationComplete":1,"modelTurn":True},
            "boolean_signals":{"generationComplete":{"true":1,"false":0,"private-secret":7}},
            "audio_stream_end_sent":True,"input_audio_frames_sent":-1})
        self.assertEqual(result["events_received"],5)
        self.assertEqual(result["top_fields"],{"serverContent":4})
        self.assertEqual(result["server_content_fields"],{"generationComplete":1})
        self.assertNotIn("private-secret",json.dumps(result))
        self.assertNotIn("input_audio_frames_sent",result)
        self.assertTrue(result["audio_stream_end_sent"])

    def test_modular_measurement_keeps_unknown_cost_and_internal_inference(self):
        received = []
        pcm = b"\0\1" * 1920
        def relay(ws):
            received.append(json.loads(ws.recv()))
            ws.send(json.dumps({"type": "ready", **STATUS, "sample_rate": 24000, "max_seconds": 5}))
            for raw in ws:
                if isinstance(raw, bytes): received.append(raw)
                elif json.loads(raw) == {"type": "finish"}:
                    ws.send(json.dumps({"type": "metrics", "segment_id": "synthetic-1", "mt_request_ms": 123,
                        "tts_first_audio_ms": 42, "segment_wait_ms": 3, "segment_ready_to_first_audio_ms": 168,
                        "first_asr_partial_ms": 20, "first_segment_ready_ms": 40,
                        "asr_received_input_ms": 40, "inference_ms": None}))
                    ws.send(json.dumps({"type": "audio", "audio": base64.b64encode(pcm).decode(), "sample_rate": 24000}))
                    ws.send(json.dumps({"type": "metrics", "mt_request_ms": 123, "tts_first_audio_ms": 42,
                        "mt_requests_started": 1, "tts_requests_started": 1, "inference_ms": None}))
                    ws.send(json.dumps({"type": "done"})); return
        with serve(relay, "127.0.0.1", 0, compression=None) as fake:
            thread = threading.Thread(target=fake.serve_forever, daemon=True); thread.start()
            report = run_trial("http://127.0.0.1:9876", f"ws://127.0.0.1:{fake.socket.getsockname()[1]}/dub",
                "es", pcm, {"duration_seconds": .08}, provider_status=STATUS, source_language="en")
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["input_bytes_sent"], len(pcm))
        self.assertEqual(b"".join(item for item in received if isinstance(item, bytes)), pcm)
        self.assertEqual(received[0]["source_language"], "en")
        self.assertIsNone(report["estimated_base_service_usd"])
        self.assertIsNone(report["actual_billed_usd"])
        self.assertIsNone(report["inference_ms"])
        self.assertEqual(report["target_status"], "unverified")
        self.assertEqual(report["mt_request_ms"], [123])
        self.assertEqual(report["tts_first_audio_ms"], [42])
        self.assertEqual(report["mt_requests_started"], 1)
        self.assertEqual(report["tts_requests_started"], 1)
        self.assertEqual(report["segment_wait_ms"], [3])
        self.assertEqual(report["segment_ready_to_first_audio_ms"], [168])
        self.assertEqual(report["first_asr_partial_ms"], 20)
        self.assertEqual(report["first_segment_ready_ms"], 40)
        self.assertEqual(report["asr_received_input_ms"], 40)

    def test_unknown_route_or_unsupported_modular_direction_never_opens_connection(self):
        with patch("tools.measure_dubbing.connect") as connect:
            with self.assertRaises(TrialError): provider_price({"provider": "unknown", "model": "unknown"})
            with self.assertRaises(TrialError):
                run_trial("http://127.0.0.1:9876", "ws://127.0.0.1:9877/dub", "en", b"\0\1", {},
                    provider_status=STATUS, source_language="es")
            connect.assert_not_called()


if __name__ == "__main__": unittest.main()
