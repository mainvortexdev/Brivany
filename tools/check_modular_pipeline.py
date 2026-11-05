"""Real browser/PCM/Muse relay with deterministic local ASR, MT and TTS substitutes."""
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
import io
import json
import os
import subprocess
import threading
from unittest.mock import patch
from websockets.sync.server import serve
from packages.providers.modular_dubbing import ModularBridge, modular_status
from services.h1.server import Handler, ROOT
from tools.check_dubbing_pipeline import ensure_fixture


def main():
    ensure_fixture(ROOT / "tmp/dubbing-test/synthetic-video.mp4")
    received = {"connections": 0, "pcm_packets": 0, "pcm_bytes": 0, "finish_messages": 0,
                "translation_requests": 0, "synthesis_requests": 0, "translation_before_finish": False}
    finished = threading.Event()
    failures = []

    def muse(ws):
        try:
            received["connections"] += 1
            handshake = json.loads(ws.recv(timeout=5))
            if handshake["authorization"]["accessToken"] != "Bearer modular-local-simulation-key":
                raise AssertionError("The simulation credential was not used.")
            if handshake["mode"] != "ENDPOINTING": raise AssertionError("Expected endpointing.")
            ws.send(json.dumps({"sessionId": "modular-local-simulation"}))
            for data in ws:
                if isinstance(data, bytes):
                    received["pcm_packets"] += 1; received["pcm_bytes"] += len(data)
                    if not data or len(data) % 2: raise AssertionError("Invalid PCM.")
                    if received["pcm_packets"] == 1:
                        for event in ({"type": "speechStart", "turnId": 7, "audioProcessedMs": 0},
                                      {"type": "transcript", "transcript": "The room is ready."},
                                      {"type": "transcript", "transcript": "The room is ready. Bring the measurements."}):
                            ws.send(json.dumps(event))
                elif json.loads(data) == {"type": "endStream"}:
                    received["finish_messages"] += 1; finished.set()
                    ws.send(json.dumps({"type": "speechComplete", "turnId": 7,
                        "transcript": "The room is ready. Bring the measurements."})); return
                else: raise AssertionError("Unexpected Muse control.")
        except Exception as error:
            failures.append(type(error).__name__); raise

    def translate(text, source, target):
        if (source, target) != ("en", "es"): raise AssertionError("Unexpected languages.")
        received["translation_requests"] += 1
        if not finished.is_set(): received["translation_before_finish"] = True
        return {"text": "La habitación está lista." if "room" in text else "Trae las medidas.", "request_ms": 5}

    def synthesize(text):
        received["synthesis_requests"] += 1
        return io.BytesIO(b"\0\1" * 2400)  # 100 ms PCM; no TTS service.

    with serve(muse, "127.0.0.1", 0, compression=None) as fake:
        threading.Thread(target=fake.serve_forever, daemon=True).start()
        endpoint = f"ws://127.0.0.1:{fake.socket.getsockname()[1]}"
        environment = {"BRIVANY_META_API_KEY": "modular-local-simulation-key",
            "BRIVANY_MUSE_API_KEY": "modular-local-simulation-key", "BRIVANY_CLOUDFLARE_ACCOUNT_ID": "a" * 32,
            "BRIVANY_CLOUDFLARE_API_TOKEN": "modular-local-simulation-cf-token"}
        with patch.dict(os.environ, environment), patch("packages.providers.modular_dubbing.MUSE_URL", endpoint):
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            bridge = ModularBridge(server.server_port, translator=translate, synthesizer=synthesize).start()
            server.modular_bridge = bridge
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                result = subprocess.run(["node", "tools/check_modular_pipeline.cjs"], cwd=ROOT,
                    env={**os.environ, "BRIVANY_TEST_URL": f"http://127.0.0.1:{server.server_port}"},
                    capture_output=True, timeout=35, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if result.returncode:
                    raise RuntimeError((result.stdout + result.stderr).decode("utf-8", errors="replace"))
                if (failures or received["connections"] != 1 or received["finish_messages"] != 1
                        or received["translation_requests"] != 2 or received["synthesis_requests"] != 2
                        or not received["translation_before_finish"] or received["pcm_packets"] < 2):
                    raise AssertionError("The incremental pipeline did not complete exactly once.")
                path = ROOT / "tmp/ui/modular-pipeline.json"
                report = json.loads(path.read_text(encoding="utf-8"))
                report.update({"checked_at": datetime.now(timezone.utc).isoformat(), "provider_received": received,
                    "limitations": ["Local deterministic ASR/MT/TTS substitutes; no model inference, translation quality or physical audio latency measured."]})
                path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
                print(json.dumps(report, indent=2, ensure_ascii=False))
            finally:
                server.shutdown(); server.server_close(); thread.join(3); bridge.close()


if __name__ == "__main__": main()
