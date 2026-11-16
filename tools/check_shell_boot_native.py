"""Real WebView2 startup against the real local handler and a synthetic profile.

No personal profile, browser, model, audio, or OS input is used.
"""
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from urllib.parse import urlsplit


def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--inert-first-load',action='store_true');args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='brivany-shell-boot-') as directory:
        os.environ['BRIVANY_DATA_DIR']=directory
        from desktop.experience.launcher import experience_handler,NATIVE_PAGES,MODULE_ROUTES
        from desktop.experience.ui_session import DesktopUISession
        from desktop.experience.workspace_preferences import WorkspacePreferences
        from desktop.experience.startup_recovery import StartupRecovery
        from desktop.launcher import LocalDesktopServer
        from services.h1.server import Handler
        import webview

        requests=[];shell_loads=0
        class FixtureHandler(experience_handler(Handler)):
            def send_response(self,status,message=None):
                route=urlsplit(self.path).path
                requests.append({'path':'/_desktop/[entry]' if route.startswith('/_desktop/') else route,'status':status})
                super().send_response(status,message)
            def do_GET(self):
                nonlocal shell_loads
                path=urlsplit(self.path).path
                if path=='/brivany-shell':shell_loads+=1
                if args.inert_first_load and shell_loads==1 and path.endswith('.js'):
                    self.send_bytes(503,b'','text/javascript; charset=utf-8');return
                if path=='/api/desktop/chats':self.send_json(200,{'active':None,'conversations':[]});return
                if path=='/api/status':self.send_json(200,{'voice':{'asr':{'available':False},'tts':{'configured':False}}});return
                if path.startswith('/api/') and path!='/api/desktop/workspace-preferences':self.send_json(200,{'jobs':[],'services':[]});return
                super().do_GET()
            def do_POST(self):
                self.send_json(200,{'ok':True})
        class FixtureAPI:
            def workspace_chat_publish(self,value):return {'ok':True}
            def music_voice_active(self,active):return {'ok':True}
            def music_media_active(self,active):return {'ok':True}

        server=LocalDesktopServer(handler=FixtureHandler).start()
        session=DesktopUISession(NATIVE_PAGES|MODULE_ROUTES)
        server.http.desktop_ui_session=session
        server.http.workspace_preferences=WorkspacePreferences(Path(directory)/'preferences.json')
        window=webview.create_window('Brivany · Comprobación de arranque',session.entry(server.base_url,'/brivany-shell'),js_api=FixtureAPI(),width=960,height=680,hidden=True)
        session.bind_window(window,server.base_url)
        recovery=StartupRecovery(window,server.base_url)
        window.events.loaded+=recovery.start;window.events.closed+=recovery.close
        report={'passed':False,'mode':'real_webview2_real_http_synthetic_profile','external_calls':0,'personal_profile_opened':False,'OS_input_sent':False,'audio_devices_opened':0}
        done=threading.Event()
        def probe():
            if done.is_set():return
            done.set()
            try:
                deadline=time.monotonic()+18
                while time.monotonic()<deadline:
                    try:value=window.evaluate_js("(()=>{const frame=document.querySelector('#module-frame');let chat=false,composer=false;try{chat=!!frame?.contentWindow.BrivanyChat;composer=!!frame?.contentDocument.querySelector('#chat-composer')&&!frame.contentDocument.querySelector('#chat-composer').inert}catch{}return {document_ready:document.readyState,boot:window.BrivanyShellBoot?.snapshot()||null,chat_ready:chat,composer_ready:composer,frame_src:frame?.getAttribute('src'),logo_decoded:document.querySelector('.brand-icon')?.naturalWidth>0,resources:performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,status:r.responseStatus||0,bytes:r.transferSize||0}))}})()")
                    except Exception:
                        time.sleep(.2);continue
                    if not isinstance(value,dict):time.sleep(.2);continue
                    report['document']=value
                    if value.get('chat_ready') and value.get('composer_ready'):
                        until=time.monotonic()+1
                        while recovery.snapshot()['state'] in {'waiting','retrying'} and time.monotonic()<until:time.sleep(.05)
                        report['passed']=True
                        report['native_recovery']=recovery.snapshot()
                        if report['native_recovery']['state']=='retrying':
                            import sys,traceback
                            worker=next((item for item in threading.enumerate() if item.name=='brivany-shell-recovery'),None)
                            if worker and worker.ident in sys._current_frames():report['worker_stack']=[{'function':frame.name,'file':Path(frame.filename).name,'line':frame.lineno} for frame in traceback.extract_stack(sys._current_frames()[worker.ident])]
                        if args.inert_first_load:report['passed']=report['native_recovery']=={'state':'recovered','retries':1} and shell_loads==2
                        else:report['passed']=report['native_recovery']=={'state':'ready','retries':0}
                        break
                    time.sleep(.2)
            except Exception as error:report['error']=type(error).__name__
            finally:
                report['native_recovery']=recovery.snapshot()
                report['requests']=list(requests)
                window.destroy()
        window.events.loaded+=lambda:threading.Thread(target=probe,daemon=True).start()
        guard=threading.Timer(35,lambda:window.destroy());guard.daemon=True;guard.start()
        try:webview.start(gui='edgechromium',private_mode=True,http_server=False,debug=False,storage_path=str(Path(directory)/'webview'))
        finally:guard.cancel();server.close()
        destination=Path(__file__).resolve().parents[1]/'tmp/shell-boot-native'
        destination.mkdir(parents=True,exist_ok=True)
        path=destination/('report-'+str(time.time_ns())+'.json')
        path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({key:value for key,value in report.items() if key not in {'document','requests'}},ensure_ascii=False))
        raise SystemExit(0 if report['passed'] else 1)


if __name__=='__main__':main()
