"""Owned WebView2/private-cookie fixture; no account, audio, screen or model data."""
import argparse
import json
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit
from urllib.request import urlopen
from urllib.error import HTTPError
from desktop.experience.ui_session import DesktopUISession
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler


class FixtureHandler(Handler):
    def send_header(self,key,value):
        if key.lower()=='content-security-policy':value="default-src 'self'; frame-src 'self'; frame-ancestors 'self'"
        super().send_header(key,value)
    def do_GET(self):
        if self.server.desktop_ui_session.handle(self):return
        path=urlsplit(self.path).path
        content={'/brivany-shell':'<p id="ready">native</p><iframe id="module" src="/connections"></iframe>',
                 '/connections':'<p id="ready">module</p>','/work-widget':'<p id="ready">workspace</p>'}.get(path)
        if content is None:self.error(404,'fixture_missing','Fixture missing');return
        self.send_bytes(200,('<!doctype html><html><body>'+content+'</body></html>').encode(),'text/html; charset=utf-8')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true',required=True);parser.parse_args()
    import webview
    output=Path('tmp/native-ui-session/report.json');output.parent.mkdir(parents=True,exist_ok=True)
    report={'status':'failed','native_runtime':'real WebView2','pages':'synthetic local fixture','external_calls':0,'screen_capture':False,'audio_capture':False}
    with LocalDesktopServer(handler=FixtureHandler) as server:
        ui=DesktopUISession({'/brivany-shell','/connections','/work-widget'});server.http.desktop_ui_session=ui
        loaded=threading.Event()
        window=webview.create_window('Brivany · sesión nativa de prueba',ui.entry(server.base_url,'/brivany-shell'),width=400,height=220,hidden=True)
        window.events.loaded+=loaded.set
        def run():
            child=None
            try:
                if not loaded.wait(12):raise RuntimeError('Native entry did not load')
                deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    if window.evaluate_js('document.querySelector("#module")?.contentDocument?.querySelector("#ready")?.textContent')=='module':break
                    time.sleep(.1)
                else:raise RuntimeError('Native iframe did not receive the private session')
                assert window.get_current_url()==server.base_url+'/brivany-shell'
                child=webview.create_window('Brivany · ventana auxiliar de prueba',ui.entry(server.base_url,'/work-widget?surface=bar'),width=300,height=100,hidden=True)
                deadline=time.monotonic()+12
                while time.monotonic()<deadline:
                    try:
                        if child.evaluate_js('document.querySelector("#ready")?.textContent')=='workspace':break
                    except Exception:pass
                    time.sleep(.1)
                else:raise RuntimeError('Native helper did not load')
                assert child.get_current_url()==server.base_url+'/work-widget?surface=bar'
                for path in ('/','/connections','/brivany-shell','/work-widget'):
                    try:urlopen(server.base_url+path,timeout=3)
                    except HTTPError as error:assert error.code==410;error.close()
                    else:raise RuntimeError('Ordinary client accessed a native page')
                report.update(status='passed',native_main=True,same_origin_iframe=True,native_helper=True,clean_native_urls=True,ordinary_clients_rejected=True)
            except Exception as error:report['error_type']=type(error).__name__
            finally:
                output.write_text(json.dumps(report,indent=2),encoding='utf-8')
                if child:child.destroy()
                window.destroy()
        webview.start(run,gui='edgechromium',debug=False,private_mode=True,http_server=False)
    print(json.dumps(report));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
