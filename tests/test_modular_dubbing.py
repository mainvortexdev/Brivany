"""Real loopback Muse relay with injected MT/TTS. No paid API or microphone."""
import io
import json
import os
import threading
import time
import unittest
from unittest.mock import Mock, patch
from websockets.sync.client import connect
from websockets.sync.server import serve
from websockets.exceptions import ConnectionClosed, InvalidStatus
from packages.providers.modular_dubbing import ModularBridge, StableClauses
from packages.providers.live_voice import VoiceError

OPTIONS={"type":"start","consent":True,"source_language":"en","target_language":"es","max_seconds":5}
PCM=b"\0\1"*960


def acknowledge(ws):
    handshake=json.loads(ws.recv(timeout=2))
    ws.send(json.dumps({"sessionId":"test-muse"}));return handshake


def speech(ws, text, final=False, turn=1):
    ws.send(json.dumps({"type":"speechComplete" if final else "transcript","turnId":turn,"transcript":text}))


class StableClauseTests(unittest.TestCase):
    def test_revised_partials_only_emit_stable_punctuated_clauses_then_final_tail(self):
        clauses=StableClauses()
        def accept(text,final=False):return clauses.accept({"id":"1","text":text,"final":final},now=0)
        self.assertEqual(accept("The room is blue"),[])
        self.assertEqual(accept("The room is green. Next"),[])
        first=accept("The room is green. Next detail")
        self.assertEqual([item.text for item in first],["The room is green."])
        self.assertTrue(first[0].provisional)
        self.assertEqual(accept("The room is green. Next detail"),[])
        tail=accept("The room is green. Next detail.",True)
        self.assertEqual([item.text for item in tail],["Next detail."])
        self.assertEqual(accept("The room is green. Next detail.",True),[])
        self.assertNotEqual(first[0].id,tail[0].id)

    def test_late_final_correction_revisions_invalidate_old_units(self):
        clauses=StableClauses()
        for text in ("The room is blue. Next", "The room is blue. Next detail"):
            result=clauses.accept({"id":"1","text":text,"final":False})
        old=result[0]
        corrected=clauses.accept({"id":"1","text":"The room is green. Another detail.","final":True})
        self.assertEqual(corrected[0].revision,old.revision+1)
        self.assertTrue(corrected[0].correction);self.assertTrue(corrected[0].replaces_turn)
        self.assertEqual(clauses.revision("1"),1)

    def test_chunk_and_context_limits_are_bounded(self):
        clauses=StableClauses();text="A useful clause. "*60
        result=clauses.accept({"id":"1","text":text,"final":True})
        self.assertTrue(all(0<len(item.text)<=400 for item in result))
        with self.assertRaises(VoiceError):clauses.accept({"id":"2","text":"x"*6001,"final":True})

    def test_final_capitalization_and_punctuation_changes_do_not_duplicate_prefix(self):
        clauses=StableClauses()
        clauses.accept({"id":"1","text":"the room is ready. More","final":False})
        clauses.accept({"id":"1","text":"the room is ready. More detail","final":False})
        tail=clauses.accept({"id":"1","text":"The room is ready! Bring the measurements.","final":True})
        self.assertEqual([item.text for item in tail],["Bring the measurements."])
        self.assertTrue(all(not item.correction and item.revision==0 for item in tail))

    def test_semantic_correction_preserves_new_final_tail_or_stops_if_unalignable(self):
        clauses=StableClauses()
        clauses.accept({"id":"1","text":"The room is blue. Next","final":False})
        clauses.accept({"id":"1","text":"The room is blue. Next detail","final":False})
        corrected=clauses.accept({"id":"1","text":"The room is green. Bring the measurements.","final":True})
        self.assertEqual([item.text for item in corrected],["The room is green.","Bring the measurements."])
        self.assertTrue(corrected[0].correction);self.assertFalse(corrected[1].correction)
        other=StableClauses()
        other.accept({"id":"2","text":"The room is blue. Next","final":False})
        other.accept({"id":"2","text":"The room is blue. Next detail","final":False})
        with self.assertRaises(VoiceError) as error:other.accept({"id":"2","text":"An entirely unrelated final instruction without any reliable boundary","final":True})
        self.assertEqual(error.exception.code,"modular_correction_alignment")


class ModularDubbingTests(unittest.TestCase):
    def setUp(self):
        self.translator=Mock(side_effect=lambda text,*_: {"text":"ES: "+text,"request_ms":12.0})
        self.synthesizer=Mock(side_effect=lambda _:io.BytesIO(PCM*2))

    def run_relay(self,upstream,body,*,translator=None,synthesizer=None,configured=True,clock=None):
        with serve(upstream,"127.0.0.1",0,compression=None) as fake:
            threading.Thread(target=fake.serve_forever,daemon=True).start()
            bridge=ModularBridge(9876,translator=translator or self.translator,synthesizer=synthesizer or self.synthesizer,status=lambda:{"configured":configured},clock=clock).start()
            try:
                with patch.dict(os.environ,{"BRIVANY_META_API_KEY":"fake-muse-secret"},clear=True),patch("packages.providers.modular_dubbing.MUSE_URL",f"ws://127.0.0.1:{fake.socket.getsockname()[1]}"):body(bridge)
            finally:bridge.close()

    @staticmethod
    def browser(bridge):return connect(f"ws://127.0.0.1:{bridge.port}/dub",origin="http://127.0.0.1:9876",proxy=None)

    def test_real_muse_stream_stable_clauses_mt_tts_finish_and_honest_metrics(self):
        received=[]
        def upstream(ws):
            received.append(acknowledge(ws));received.append(ws.recv(timeout=2))
            ws.send(json.dumps({"type":"speechStart","turnId":1,"audioProcessedMs":0}))
            speech(ws,"This room is bright. More")
            speech(ws,"This room is bright. More detail")
            received.append(json.loads(ws.recv(timeout=2)))
            speech(ws,"This room is bright. More detail.",True)
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));self.assertEqual(json.loads(browser.recv(timeout=2))["provider"],"Meta modular")
                browser.send(PCM);browser.send(json.dumps({"type":"finish"}));values=[]
                while True:
                    event=json.loads(browser.recv(timeout=3));values.append(event)
                    if event["type"]=="done":break
                translated=[event for event in values if event.get("source")=="translation"]
                self.assertEqual([event["text"] for event in translated],["ES: This room is bright.","ES: More detail."])
                self.assertTrue(all(event["operation"]=="replace" and event["segment_id"] for event in translated))
                self.assertTrue(any(event["type"]=="audio" for event in values))
                metrics=[event for event in values if event["type"]=="metrics"]
                self.assertTrue(all(event["inference_ms"] is None and event["inference_verified"] is False for event in metrics))
                self.assertEqual(metrics[-1]["translated_segments"],2)
                self.assertEqual((metrics[-1]["mt_requests_started"],metrics[-1]["tts_requests_started"]),(2,2))
        self.run_relay(upstream,body)
        self.assertEqual(received[0]["audioEncoding"],"PCM_24KHZ");self.assertEqual(received[1],PCM)
        self.assertEqual(received[2],{"type":"endStream"});self.assertEqual(self.translator.call_count,2);self.assertEqual(self.synthesizer.call_count,2)

    def test_final_correction_replaces_caption_without_repeating_spoken_turn(self):
        heard=threading.Event()
        def upstream(ws):
            acknowledge(ws);ws.recv(timeout=2)
            ws.send(json.dumps({"type":"speechStart","turnId":1}))
            speech(ws,"The room is blue. Next")
            speech(ws,"The room is blue. Next detail")
            heard.wait(2);ws.recv(timeout=2)
            speech(ws,"The room is green. Next detail.",True)
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(PCM)
                while json.loads(browser.recv(timeout=3))["type"]!="audio":pass
                heard.set();browser.send(json.dumps({"type":"finish"}));values=[]
                while True:
                    event=json.loads(browser.recv(timeout=3));values.append(event)
                    if event["type"]=="done":break
                replacement=next(event for event in values if event.get("source")=="translation" and event.get("correction"))
                self.assertTrue(replacement["replaces_turn"]);self.assertEqual(replacement["revision"],1)
                self.assertTrue(any(event["type"]=="correction" for event in values))
        self.run_relay(upstream,body)
        self.assertEqual(self.synthesizer.call_count,2)
        self.assertEqual(self.synthesizer.call_args_list[-1].args,("ES: Next detail.",))

    def test_cancel_during_mt_discards_old_output_and_keeps_slot_until_request_returns(self):
        entered,release=threading.Event(),threading.Event()
        def translate(*_):entered.set();release.wait(3);return {"text":"Late output","request_ms":1}
        def upstream(ws):
            acknowledge(ws);ws.recv(timeout=2);ws.send(json.dumps({"type":"speechStart","turnId":1}));speech(ws,"One clause.",True)
            try:
                for _ in ws:pass
            except ConnectionClosed:pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(PCM);self.assertTrue(entered.wait(2))
                browser.send(json.dumps({"type":"cancel"}))
                with self.browser(bridge) as other:self.assertEqual(json.loads(other.recv(timeout=2))["code"],"dubbing_busy")
                release.set()
                deadline=time.monotonic()+2
                while bridge.lock.locked() and time.monotonic()<deadline:time.sleep(.01)
                self.assertFalse(bridge.lock.locked())
        self.run_relay(upstream,body,translator=translate);self.synthesizer.assert_not_called()

    def test_input_permissions_configuration_and_origin_prevent_provider_calls(self):
        bridge=ModularBridge(9876,status=lambda:{"configured":False}).start()
        try:
            with self.assertRaises(InvalidStatus):connect(f"ws://127.0.0.1:{bridge.port}/dub",origin="https://foreign.example",proxy=None)
            with patch("packages.providers.modular_dubbing.connect") as upstream:
                for options in ({**OPTIONS,"consent":False},{**OPTIONS,"source_language":"es"},OPTIONS):
                    with self.browser(bridge) as browser:
                        browser.send(json.dumps(options));self.assertEqual(json.loads(browser.recv(timeout=2))["type"],"error")
                upstream.assert_not_called()
        finally:bridge.close()

    def test_queue_overflow_stops_instead_of_spending_on_unbounded_segments(self):
        entered,release=threading.Event(),threading.Event()
        def slow(*_):entered.set();release.wait(3);return {"text":"Late","request_ms":1}
        def upstream(ws):
            acknowledge(ws);ws.recv(timeout=2)
            for turn in range(1,9):
                ws.send(json.dumps({"type":"speechStart","turnId":turn}));speech(ws,f"Clause {turn}.",True,turn)
            try:
                for _ in ws:pass
            except ConnectionClosed:pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(PCM)
                while True:
                    event=json.loads(browser.recv(timeout=3))
                    if event["type"]=="error":break
                self.assertEqual(event["code"],"modular_backlog");release.set()
        self.run_relay(upstream,body,translator=slow);self.synthesizer.assert_not_called()

    def test_provider_error_is_not_hidden_by_local_success(self):
        def failed(*_):raise VoiceError("mt_rejected","Provider rejected.")
        def upstream(ws):
            acknowledge(ws);ws.recv(timeout=2);ws.send(json.dumps({"type":"speechStart","turnId":1}));speech(ws,"One clause.",True)
            try:
                for _ in ws:pass
            except ConnectionClosed:pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(PCM)
                while True:
                    event=json.loads(browser.recv(timeout=3))
                    if event["type"]=="error":break
                self.assertEqual(event["code"],"mt_rejected")
        self.run_relay(upstream,body,translator=failed);self.synthesizer.assert_not_called()

    def test_cancel_closes_active_tts_and_stops_late_pcm(self):
        reading,closed=threading.Event(),threading.Event()
        class BlockingPCM:
            count=0
            def read1(self,_):
                self.count+=1
                if self.count==1:return PCM
                reading.set();closed.wait(2);return PCM
            def close(self):closed.set()
        def upstream(ws):
            acknowledge(ws);ws.recv(timeout=2);ws.send(json.dumps({"type":"speechStart","turnId":1}));speech(ws,"A clause.",True)
            try:
                for _ in ws:pass
            except ConnectionClosed:pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(PCM)
                self.assertTrue(reading.wait(2));browser.send(json.dumps({"type":"cancel"}))
                self.assertTrue(closed.wait(2))
                deadline=time.monotonic()+2
                while bridge.lock.locked() and time.monotonic()<deadline:time.sleep(.01)
                self.assertFalse(bridge.lock.locked())
        self.run_relay(upstream,body,synthesizer=lambda _:BlockingPCM())

    def test_audio_limits_prevent_unbounded_or_invalid_muse_input(self):
        def upstream(ws):
            acknowledge(ws)
            try:
                for _ in ws:pass
            except ConnectionClosed:pass
        def body(bridge):
            for data,count,code in ((b"odd",1,"modular_audio_format"),(b"\0"*7682,1,"modular_audio_format"),(b"\0"*7680,4,"modular_backlog")):
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS));self.assertEqual(json.loads(browser.recv(timeout=2))["type"],"ready")
                    for _ in range(count):browser.send(data)
                    while True:
                        event=json.loads(browser.recv(timeout=2))
                        if event["type"]=="error":break
                    self.assertEqual(event["code"],code)
                deadline=time.monotonic()+2
                while bridge.lock.locked() and time.monotonic()<deadline:time.sleep(.01)
                self.assertFalse(bridge.lock.locked())
        self.run_relay(upstream,body);self.translator.assert_not_called();self.synthesizer.assert_not_called()

    def test_request_budget_stops_before_starting_another_paid_stage(self):
        def upstream(ws):
            acknowledge(ws);ws.recv(timeout=2)
            for turn in (1,2):
                ws.send(json.dumps({"type":"speechStart","turnId":turn}));speech(ws,f"Clause {turn}.",True,turn)
            try:
                for _ in ws:pass
            except ConnectionClosed:pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(PCM);values=[]
                while True:
                    event=json.loads(browser.recv(timeout=3));values.append(event)
                    if event["type"]=="error":break
                self.assertEqual(values[-1]["code"],"modular_request_limit")
                metrics=[event for event in values if event["type"]=="metrics"][-1]
                self.assertEqual((metrics["mt_requests_started"],metrics["tts_requests_started"]),(1,1))
        with patch("packages.providers.modular_dubbing.MAX_REQUESTS",2):self.run_relay(upstream,body)
        self.assertEqual(self.translator.call_count,1);self.assertEqual(self.synthesizer.call_count,1)

    def test_stage_metrics_use_monotonic_boundaries_and_mt_is_emitted_before_tts(self):
        class Clock:
            value=100.0
            def __call__(self):return self.value
            def advance(self,amount):self.value+=amount
        clock=Clock();partial_observed=threading.Event();mt_reported=threading.Event()
        def upstream(ws):
            acknowledge(ws);ws.recv(timeout=2)
            ws.send(json.dumps({"type":"speechStart","turnId":1}))
            clock.advance(.1);speech(ws,"A stable clause. Next")
            self.assertTrue(partial_observed.wait(2))
            clock.advance(.3);speech(ws,"A stable clause. Next detail")
            ws.recv(timeout=2);speech(ws,"A stable clause.",True)
        def translate(*_):clock.advance(.2);return {"text":"Una cláusula estable.","request_ms":200.0}
        class PCMResponse:
            count=0
            def read1(self,_):
                self.count+=1
                if self.count>1:return b""
                self.assertion=mt_reported.wait(2)
                if not self.assertion:raise AssertionError("MT metrics must reach the client before first TTS PCM")
                clock.advance(.15);return PCM
            def close(self):pass
        def body(bridge):
            with self.browser(bridge) as browser:
                browser.send(json.dumps(OPTIONS));browser.recv(timeout=2);browser.send(PCM);values=[]
                while True:
                    event=json.loads(browser.recv(timeout=3));values.append(event)
                    if event["type"]=="metrics" and event.get("first_asr_partial_ms") is not None:
                        partial_observed.set()
                    if event.get("stage")=="translation":
                        self.assertEqual(event["mt_request_ms"],200.0)
                        self.assertEqual(event["segment_wait_ms"],0.0)
                        self.assertNotIn("tts_first_audio_ms",event)
                        mt_reported.set();browser.send(json.dumps({"type":"finish"}))
                    if event["type"]=="done":break
                metrics=[event for event in values if event["type"]=="metrics"]
                self.assertEqual(metrics[-1]["first_asr_partial_ms"],100.0)
                self.assertEqual(metrics[-1]["asr_received_input_ms"],40.0)
                self.assertEqual(metrics[-1]["first_segment_ready_ms"],400.0)
                synthesis=next(event for event in metrics if event.get("stage")=="synthesis")
                self.assertEqual(synthesis["tts_first_audio_ms"],150.0)
                self.assertNotIn("mt_request_ms",synthesis)
                audio_metric=next(event for event in metrics if event.get("stage")=="segment_audio")
                self.assertEqual(audio_metric["segment_ready_to_first_audio_ms"],350.0)
                self.assertEqual(metrics[-1]["first_output_audio_ms"],750.0)
                self.assertEqual(sum("mt_request_ms" in event for event in metrics),1)
                self.assertTrue(all(event["inference_ms"] is None for event in metrics))
        self.run_relay(upstream,body,translator=translate,synthesizer=lambda _:PCMResponse(),clock=clock)

    def test_default_translation_client_is_owned_and_closed_per_session(self):
        clients=[Mock(return_value={"text":"Una prueba.","request_ms":10.0}) for _ in range(2)]
        def upstream(ws):
            acknowledge(ws);ws.recv(timeout=2)
            ws.send(json.dumps({"type":"speechStart","turnId":1}))
            ws.recv(timeout=2);speech(ws,"A test.",True)
        def body(bridge):
            bridge.translator=None
            for client in clients:
                with self.browser(bridge) as browser:
                    browser.send(json.dumps(OPTIONS));browser.recv(timeout=2)
                    browser.send(PCM);browser.send(json.dumps({"type":"finish"}))
                    while json.loads(browser.recv(timeout=3))["type"]!="done":pass
                deadline=time.monotonic()+2
                while bridge.lock.locked() and time.monotonic()<deadline:time.sleep(.01)
                client.assert_called_once_with("A test.","en","es")
                client.close.assert_called_once()
        with patch("packages.providers.modular_dubbing.CloudflareTranslationSession",side_effect=clients) as factory:
            self.run_relay(upstream,body)
        self.assertEqual(factory.call_count,2)


if __name__=="__main__":unittest.main()
