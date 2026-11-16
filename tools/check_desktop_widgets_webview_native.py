"""Real WebView2 -> production bridge -> native widgets -> WebView2.

An owned tool-only shell avoids models/accounts. The actual JS controller, root
origin guard, Python service and WinForms host run unchanged with private data.
"""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import time
from urllib.parse import urlsplit

import webview
from desktop.experience.desktop_widgets import DesktopWidgets,DesktopWidgetsBridge
from desktop.experience.launcher import experience_handler,ExperienceBridge
from desktop.experience.scripts import post_script,evaluate_script
from desktop.experience.ui_session import DesktopUISession

ROOT=Path(__file__).resolve().parents[1]


def main():
    out=ROOT/'tmp/desktop-widgets-webview-native';out.mkdir(parents=True,exist_ok=True)
    report={'passed':False,'mode':'owned_webview2_production_controller_bridge_winforms_roundtrip',
        'external_calls':0,'gpu_seconds':None,'OS_input_sent':False,'checks':[]}
    def phase(value):
        report['phase']=value;(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    class Base(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def local_request(self):return self.client_address[0]=='127.0.0.1' and self.headers.get('Host')==urlsplit(base).netloc
        def send_headers(self,code,mime,size):
            self.send_response(code);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(size));self.end_headers()
        def send_bytes(self,code,data,mime):self.send_headers(code,mime,len(data));self.wfile.write(data)
        def error(self,code,*_):self.send_bytes(code,b'','text/plain')
        def do_GET(self):self.error(404)
    class Handler(experience_handler(Base)):
        def do_GET(self):
            if self.server.desktop_ui_session.handle(self):return
            if urlsplit(self.path).path=='/brivany-shell':
                if not self.local_request():return
                raw=b'''<!doctype html><html lang="es"><head><meta charset="utf-8"><link rel="stylesheet" href="/desktop-shell/workspace-widgets.css"><script src="/desktop-shell/workspace-widgets.js" defer></script><script src="/desktop-shell/workspace-desktop-widgets.js" defer></script></head><body data-surface="bar" data-expanded="true" data-panel="widgets"><main id="workspace-widgets"></main></body></html>'''
                self.send_bytes(200,raw,'text/html; charset=utf-8');return
            super().do_GET()
    class Bridge(DesktopWidgetsBridge):
        _trusted=ExperienceBridge._trusted
    with tempfile.TemporaryDirectory(prefix='brivany-widget-roundtrip-') as temp:
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);base='http://127.0.0.1:'+str(server.server_port)
        session=DesktopUISession({'/brivany-shell'});server.desktop_ui_session=session
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        bridge=Bridge();bridge._base=base;bridge._window=None
        window=webview.create_window('Brivany widget roundtrip fixture',session.entry(base,'/brivany-shell'),js_api=bridge,width=600,height=380,hidden=True)
        session.bind_window(window,base);bridge._window=bridge._bar_window=window
        service=DesktopWidgets(Path(temp)/'state.json',dispatcher=lambda:window.native,publish=bridge._publish_desktop_widgets);bridge._desktop_widget_service=service
        done=threading.Event()
        def wait_for(check,timeout=8):
            until=time.monotonic()+timeout
            while time.monotonic()<until:
                if check():return
                time.sleep(.05)
            raise AssertionError('Timed out at '+report['phase'])
        def js(script):return evaluate_script(window,script,timeout=1.5)
        def ui(callback):
            from System import Action
            result=[];event=threading.Event()
            def run():
                try:result.append(callback())
                finally:event.set()
            window.native.BeginInvoke(Action(run));assert event.wait(2)
            return result[0] if result else None
        def trial():
            try:
                phase('native_binding_and_pin')
                wait_for(lambda:js('window.BrivanyDesktopWidgets?.state().connected') is True)
                assert service.host is None
                post_script(window,"BrivanyWorkspaceWidgets.selectTab('notes');document.querySelector('#widget-desktop-open').click()",'widget-trial')
                wait_for(lambda:bool(service.host and 'notes' in service.host.metadata()['windows']))
                assert len(webview.windows)==1
                post_script(window,"(()=>{const n=document.querySelector('#widget-note');n.value='Texto propio desde WebView2.';n.dispatchEvent(new Event('input'))})()",'widget-trial')
                wait_for(lambda:service.model.snapshot()['note']=='Texto propio desde WebView2.')
                wait_for(lambda:ui(lambda:str(service.host.records['notes']['note'].Text))=='Texto propio desde WebView2.')
                ui(lambda:setattr(service.host.records['notes']['note'],'Text','Texto propio desde ventana nativa.'))
                wait_for(lambda:js("document.querySelector('#widget-note').value")=='Texto propio desde ventana nativa.')
                report['checks'].append('Actual JS desktop icon opens a native Notes window; real note edits round-trip through the native bridge in both directions.')
                phase('native_timer_roundtrip')
                post_script(window,"BrivanyWorkspaceWidgets.selectTab('timer');document.querySelector('#widget-timer-minutes').value=0;document.querySelector('#widget-timer-seconds').value=2;document.querySelector('#widget-timer-action').click();document.querySelector('#widget-desktop-open').click()",'widget-trial')
                wait_for(lambda:bool(service.host and 'timer' in service.host.metadata()['windows']) and service.model.snapshot()['timer']['state']=='running')
                ui(lambda:service.host.records['timer']['action'].PerformClick())
                wait_for(lambda:js('window.BrivanyWorkspaceWidgets.state().state')=='paused')
                ui(lambda:service.host.records['timer']['action'].PerformClick())
                wait_for(lambda:js('window.BrivanyWorkspaceWidgets.state().state')=='finished')
                report['checks'].append('WebView2 starts the real deadline; native Pause/Resume and completion update the renderer without polling the bridge.')
                phase('native_clock_and_shutdown')
                post_script(window,"BrivanyWorkspaceWidgets.selectTab('clock');document.querySelector('#widget-desktop-open').click()",'widget-trial')
                wait_for(lambda:'clock' in service.host.metadata()['windows']);assert len(webview.windows)==1
                bridge._close_desktop_widgets();wait_for(lambda:service.host.metadata()['windows']==[])
                assert service.model.alarm is None and service.host.ticker is None
                assert json.loads(service.model.path.read_text())['note']=='Texto propio desde ventana nativa.'
                report['checks'].append('Three native widgets reuse the original WebView count of one; root cleanup closes them, stops timers and flushes the latest note.')
                report['passed']=True;phase('complete')
            except Exception as error:
                report['error']=type(error).__name__+': '+str(error);phase('failed')
            finally:bridge._close_desktop_widgets();done.set();window.destroy()
        window.events.loaded+=lambda:threading.Thread(target=trial,daemon=True,name='widget-webview-trial').start()
        def stop():
            if not done.is_set():phase('watchdog_timeout');bridge._close_desktop_widgets();window.destroy()
        guard=threading.Timer(35,stop);guard.daemon=True;guard.start();phase('starting_webview2')
        try:webview.start(gui='edgechromium',private_mode=True,http_server=False,debug=False)
        finally:guard.cancel();bridge._close_desktop_widgets();server.shutdown();server.server_close();thread.join(2)
    print(json.dumps(report,ensure_ascii=False));return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
