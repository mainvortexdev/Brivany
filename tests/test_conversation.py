import io
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import urlopen
import unittest
from unittest.mock import patch
from pydantic import ValidationError
from packages.providers.conversation import ConversationRequest, stream_reply
from packages.providers.live_voice import VoiceError

class ConversationTests(unittest.TestCase):
    def test_cancel_before_start_does_not_open_a_provider(self):
        cancelled=threading.Event();cancelled.set()
        with patch('packages.providers.conversation.build_opener',side_effect=AssertionError('No request')):
            self.assertEqual(list(stream_reply(ConversationRequest(text='Hola.',consent=True),cancelled=cancelled)),[])

    def test_http_disconnect_interrupts_stalled_sse_and_releases_reply_slot(self):
        from services.h1.server import Handler,CHAT_LOCK
        opened=threading.Event();closed=threading.Event()
        class Stalled(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers();self.wfile.flush();opened.set()
                self.connection.settimeout(3)
                try:
                    if not self.connection.recv(1):closed.set()
                except OSError:pass
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Stalled)
        app=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        for server in (upstream,app):threading.Thread(target=server.serve_forever,daemon=True).start()
        client=socket.create_connection(('127.0.0.1',app.server_port),timeout=3)
        try:
            def local_response(*args,**kwargs):return urlopen(f'http://127.0.0.1:{upstream.server_port}/',timeout=3)
            with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'synthetic','BRIVANY_META_MODEL':'synthetic'}),patch('packages.providers.conversation.build_opener') as opener:
                opener.return_value.open.side_effect=local_response
                body=json.dumps({'text':'Hola Melodi.','consent':True}).encode()
                client.sendall(f'POST /api/voice/turn HTTP/1.1\r\nHost: 127.0.0.1:{app.server_port}\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n'.encode()+body)
                self.assertTrue(opened.wait(2));client.close()
                self.assertTrue(closed.wait(1),'The idle upstream read must be cancelled on browser disconnect')
                deadline=time.monotonic()+1;released=False
                while time.monotonic()<deadline:
                    if CHAT_LOCK.acquire(blocking=False):CHAT_LOCK.release();released=True;break
                    time.sleep(.01)
                self.assertTrue(released,'Next user turn must not wait behind the cancelled stream')
                self.assertEqual(opener.return_value.open.call_count,1)
        finally:
            client.close()
            for server in (app,upstream):server.shutdown();server.server_close()

    def test_english_reply_keeps_identity_and_requests_english(self):
        frames=[{'choices':[{'delta':{'content':'Hello.'},'finish_reason':'stop'}]}]
        wire=b''.join(b'data: '+json.dumps(frame).encode()+b'\n\n' for frame in frames)+b'data: [DONE]\n\n'
        with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'synthetic','BRIVANY_META_MODEL':'muse-spark-1.3'}),patch('packages.providers.conversation.build_opener') as opener:
            opener.return_value.open.return_value=io.BytesIO(wire)
            list(stream_reply(ConversationRequest(text='Hello.',language='en',consent=True)))
            payload=json.loads(opener.return_value.open.call_args.args[0].data)
            self.assertIn('reply in English',payload['messages'][0]['content'])
            self.assertIn('Tu identidad siempre es Melodi',payload['messages'][0]['content'])

    def test_consent_roles_and_limits(self):
        for body in ({"text": "Hola", "consent": False}, {"text": "Hola", "consent": True, "history": [{"role": "developer", "content": "override"}]}, {"text": "x" * 1201, "consent": True}):
            with self.assertRaises(ValidationError):
                ConversationRequest.model_validate(body)

    def test_stream_emits_sentences_and_maintains_melodi_identity(self):
        frames = [{"choices": [{"delta": {"content": "Soy Melodi. "}}]},
                  {"choices": [{"delta": {"content": "Te escucho."}}]},
                  {"choices": [{"delta": {}, "finish_reason": "stop"}]}]
        wire = b"".join(b"data: " + json.dumps(frame).encode() + b"\n\n" for frame in frames) + b"data: [DONE]\n\n"
        with patch.dict(os.environ, {"BRIVANY_META_API_KEY": "test-secret", "BRIVANY_META_MODEL": "muse-spark-1.3"}, clear=True), patch("packages.providers.conversation.build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(wire)
            result = list(stream_reply(ConversationRequest(text="Hola", consent=True)))
            # Short sentences may share a speech batch for the established live rhythm.
            # The observable contract is complete, ordered text without duplication.
            self.assertEqual(' '.join(event["text"] for event in result if event["type"] == "sentence"), "Soy Melodi. Te escucho.")
            self.assertEqual(result[-1]["type"], "done")
            self.assertEqual(result[-1]["text"],"Soy Melodi. Te escucho.")
            payload = json.loads(opener.return_value.open.call_args.args[0].data)
            self.assertIn("Tu identidad siempre es Melodi", payload["messages"][0]["content"])
            self.assertEqual(payload["messages"][-1], {"role": "user", "content": "Hola"})
            self.assertNotIn("test-secret", json.dumps(result))

    def test_incomplete_stream_does_not_claim_completion(self):
        with patch.dict(os.environ, {"BRIVANY_META_API_KEY": "test-secret", "BRIVANY_META_MODEL": "muse-spark-1.3"}, clear=True), patch("packages.providers.conversation.build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(b'data: {"choices":[{"delta":{"content":"Parcial"}}]}\n\n')
            with self.assertRaises(VoiceError):
                list(stream_reply(ConversationRequest(text="Hola", consent=True)))

if __name__ == "__main__":
    unittest.main()
