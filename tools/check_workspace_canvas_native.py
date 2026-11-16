"""Owned WebView2 editor: synthetic input, real PNG export, substituted picker.

No model, account, microphone, desktop capture or interactive clipboard access.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit

import webview
from PIL import Image
from desktop.experience.canvas_window import CanvasWindow
from desktop.experience.launcher import experience_handler, NATIVE_PAGES
from desktop.experience.scripts import evaluate_script, post_script
from desktop.experience.ui_session import DesktopUISession

ROOT = Path(__file__).resolve().parents[1]


def main():
    directory = ROOT / 'tmp/workspace-canvas-native'; directory.mkdir(parents=True, exist_ok=True)
    report = {'passed': False, 'mode': 'owned_real_webview2_editor_synthetic_pointer_events_real_png_export',
        'external_calls': 0, 'gpu_seconds': None, 'interactive_clipboard_opened': False,
        'picker': 'substituted_selected_fixture_path', 'checks': []}
    def phase(value):
        report['phase'] = value
        (directory / 'window.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    class Base(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def local_request(self):
            return self.client_address[0] == '127.0.0.1' and self.headers.get('Host') == urlsplit(base).netloc
        def send_headers(self, code, mime, size):
            self.send_response(code); self.send_header('Content-Type', mime); self.send_header('Content-Length', str(size))
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
            self.end_headers()
        def send_bytes(self, code, data, mime):
            self.send_headers(code, mime, len(data)); self.wfile.write(data)
        def error(self, code, *_): self.send_bytes(code, b'', 'text/plain')
        def do_GET(self):
            if self.path == '/fixture-root': self.send_bytes(200, b'<!doctype html><title>Owned canvas fixture</title>', 'text/html')
            else: self.error(404)
    server = ThreadingHTTPServer(('127.0.0.1', 0), experience_handler(Base)); base = 'http://127.0.0.1:' + str(server.server_port)
    session = DesktopUISession(NATIVE_PAGES | {'/fixture-root'}); server.desktop_ui_session = session
    worker_server = threading.Thread(target=server.serve_forever, daemon=True); worker_server.start()
    root = webview.create_window('Brivany canvas fixture', session.entry(base, '/fixture-root'), width=300, height=200, hidden=True)
    session.bind_window(root, base)
    manager = CanvasWindow(base, session); done = threading.Event()
    def wait_for(check, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if check(): return
            time.sleep(.05)
        raise AssertionError('Timed out in phase: ' + report['phase'])
    def js(script): return evaluate_script(manager.window, script, timeout=2)
    def trial():
        try:
            phase('lazy_open'); assert manager.window is None
            manager.open(); wait_for(lambda: manager.is_ready)
            window = manager.window
            report['checks'].append('Editor created lazily and authenticated in real WebView2.')
            assert js('window.BrivanyCanvas.state().width') == 1600
            manager.open(); assert manager.window is window
            phase('synthetic_drawing')
            post_script(window, """(()=>{const v=document.querySelector('#viewport'),a=BrivanyCanvas.clientPoint(200,300),b=BrivanyCanvas.clientPoint(650,550);document.querySelector('[data-tool=rect]').click();document.querySelector('#fill').checked=true;document.querySelector('#fill').dispatchEvent(new Event('change'));for(const [type,p] of [['pointerdown',a],['pointermove',b],['pointerup',b]])v.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:7,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:p.x,clientY:p.y}))})()""", 'canvas-trial')
            wait_for(lambda: manager.dirty)
            assert js('window.BrivanyCanvas.state().history') == 1
            phase('native_close_cancel')
            window.destroy()
            wait_for(lambda: js("document.querySelector('#close-dialog').open") is True)
            post_script(window, "document.querySelector('#close-cancel').click()", 'canvas-trial')
            wait_for(lambda: js("document.querySelector('#close-dialog').open") is False)
            assert manager.window is window and manager.dirty
            report['checks'].append('Native Close opens unsaved dialog; Cancel retains the actual window and drawing.')
            phase('export_selected_fixture')
            target = directory / 'native-dibujo.png'
            window.create_file_dialog = lambda *_args, **_kwargs: (str(target),)
            post_script(window, "document.querySelector('#export').click()", 'canvas-trial')
            wait_for(lambda: target.is_file() and not manager.dirty)
            with Image.open(target) as image:
                assert image.size == (1600, 1000)
                assert image.getpixel((350, 400)) == (29, 29, 31)
                assert image.getpixel((50, 50)) == (255, 255, 255)
            report['checks'].append('Real renderer-to-Python PNG export preserves dimensions and expected white/ink pixels; only dialog selection substituted.')
            phase('close_and_reopen')
            completed = threading.Event(); assert manager.request_close(completed.set)
            assert completed.wait(8); assert manager.window is None
            manager.open(); wait_for(lambda: manager.is_ready)
            assert js('window.BrivanyCanvas.state().history') == 0
            completed.clear(); manager.request_close(completed.set); assert completed.wait(8)
            assert manager.window is None and manager.guard is None
            report['checks'].append('Clean close resumes app exit; reopening starts a blank document; owned child disposed with no startup timer.')
            report['passed'] = True; phase('complete')
        except Exception as error:
            report['error'] = type(error).__name__ + ': ' + str(error); phase('failed')
        finally:
            manager.close(); done.set(); root.destroy()
    def start_trial(): threading.Thread(target=trial, daemon=True, name='canvas-native-trial').start()
    root.events.loaded += start_trial
    def watchdog():
        if not done.is_set():
            phase('watchdog_timeout'); manager.close(); root.destroy()
    guard = threading.Timer(50, watchdog); guard.daemon = True; guard.start()
    phase('native_start')
    try: webview.start(gui='edgechromium', private_mode=True, http_server=False, debug=False)
    finally:
        guard.cancel(); manager.close(); server.shutdown(); server.server_close(); worker_server.join(2)
    print(json.dumps(report, ensure_ascii=False)); return 0 if report['passed'] else 1


if __name__ == '__main__': raise SystemExit(main())
