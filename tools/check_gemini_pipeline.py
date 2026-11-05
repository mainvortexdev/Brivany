"""Real UI and native-audio relay against a loopback-only Gemini simulation."""
import base64
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
import json
import os
import subprocess
import threading
from unittest.mock import patch
from websockets.sync.server import serve
from packages.providers.gemini_dubbing import GeminiBridge
from services.h1.server import Handler, ROOT
from tools.check_dubbing_pipeline import ensure_fixture


def main():
    ensure_fixture(ROOT / "tmp/dubbing-test/synthetic-video.mp4")
    received = {"connections": 0, "pcm_packets": 0, "pcm_bytes": 0, "end_messages": 0}
    failures = []
    pcm = base64.b64encode(b"\0\1" * 2400).decode("ascii")
    def result(text, final=False):
        return {"serverContent": {"outputTranscription": {"text": text},
            "modelTurn": {"parts": [{"inlineData": {"mimeType": "audio/pcm;rate=24000", "data": pcm}}]},
            "turnComplete": final}}
    def upstream(ws):
        try:
            received["connections"] += 1
            if ws.request.headers.get("x-goog-api-key") != "gemini-local-simulation-key" or "?" in ws.request.path:
                raise AssertionError("Simulation key must only be in the header.")
            setup = json.loads(ws.recv(timeout=5))["setup"]
            if (setup["model"] != "models/gemini-3.5-live-translate-preview" or
                setup["generationConfig"]["translationConfig"]["targetLanguageCode"] != "es"):
                raise AssertionError("Translation configuration missing.")
            ws.send(json.dumps({"setupComplete": {}}))
            for raw in ws:
                event = json.loads(raw)["realtimeInput"]
                if "audio" in event:
                    if event["audio"]["mimeType"] != "audio/pcm;rate=16000": raise AssertionError("Wrong rate.")
                    data = base64.b64decode(event["audio"]["data"], validate=True)
                    if not data or len(data) % 2 or len(data) > 3200: raise AssertionError("Invalid PCM.")
                    received["pcm_packets"] += 1; received["pcm_bytes"] += len(data)
                    if received["pcm_packets"] == 1:
                        ws.send(json.dumps(result("La habitación está lista. ")))
                elif event == {"audioStreamEnd": True}:
                    received["end_messages"] += 1
                    # The dedicated translation stream need not emit a final
                    # turn marker. Local draining must work without that signal.
                    ws.send(json.dumps(result("Trae las medidas.", final=False)))
                    for _ in ws: pass
                    return
                else: raise AssertionError("Unexpected provider control.")
        except Exception as error:
            failures.append(type(error).__name__); raise
    with serve(upstream, "127.0.0.1", 0, compression=None) as fake:
        threading.Thread(target=fake.serve_forever, daemon=True).start()
        endpoint = f"ws://127.0.0.1:{fake.socket.getsockname()[1]}"
        with patch.dict(os.environ, {"BRIVANY_GEMINI_API_KEY": "gemini-local-simulation-key"}), \
             patch("packages.providers.gemini_dubbing.URL", endpoint):
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            bridge = GeminiBridge(server.server_port).start(); server.gemini_bridge = bridge
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                process = subprocess.run(["node", "tools/check_modular_pipeline.cjs"], cwd=ROOT,
                    env={**os.environ, "BRIVANY_TEST_URL": f"http://127.0.0.1:{server.server_port}", "BRIVANY_TEST_PROVIDER": "gemini"},
                    capture_output=True, timeout=35, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if process.returncode: raise RuntimeError((process.stdout + process.stderr).decode("utf-8", errors="replace"))
                if failures or received["connections"] != 1 or received["end_messages"] != 1 or received["pcm_packets"] < 2:
                    raise AssertionError("The Gemini simulation did not complete.")
                path = ROOT / "tmp/ui/gemini-pipeline.json"
                report = json.loads(path.read_text(encoding="utf-8"))
                report.update({"checked_at": datetime.now(timezone.utc).isoformat(), "provider_received": received,
                    "provider_input_rate": 16000, "provider_completion_signals_sent": 0,
                    "limitations": ["Simulated Gemini only: no Google model, latency, bilingual quality or real access evaluated. Local closure does not prove provider flush."]})
                path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
                print(json.dumps(report, indent=2, ensure_ascii=False))
            finally:
                server.shutdown(); server.server_close(); thread.join(3); bridge.close()


if __name__ == "__main__": main()
