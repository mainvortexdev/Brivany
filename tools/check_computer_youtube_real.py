"""Explicit real browser/YouTube search and playback check; bounded provider use."""
import argparse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from uuid import uuid4
from urllib.request import urlopen
from desktop.experience.launcher import experience_handler
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler,load_local_config
from services.computer.service import ComputerService

ROOT=Path(__file__).resolve().parents[1]


class Pages(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        raw=('<!doctype html><title>Melodi YouTube fixture '+self.server.identity+'</title><h1>Prueba de navegación</h1><p>Ventana aislada de prueba.</p>').encode()
        self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',action='store_true',required=True);parser.add_argument('--playback-url');parser.add_argument('--diagnose-player',action='store_true');args=parser.parse_args();load_local_config()
    directory=ROOT/'tmp/computer-youtube-real';directory.mkdir(parents=True,exist_ok=True);workspace=directory/('fixture-'+uuid4().hex[:8]);workspace.mkdir()
    pages=ThreadingHTTPServer(('127.0.0.1',0),Pages);pages.identity=uuid4().hex[:8];threading.Thread(target=pages.serve_forever,daemon=True).start()
    chrome=Path(os.environ.get('PROGRAMFILES',r'C:\Program Files'))/'Google/Chrome/Application/chrome.exe'
    report={'scope':'real Chrome profile, YouTube search and observed player','checks':[], 'cost_amount':None,'browser_network_consumption':'unknown','hardware_audibility_verified':False}
    child=None
    with LocalDesktopServer(handler=experience_handler(Handler)) as server:
        server.http.computer_lock=threading.RLock();current=ComputerService(server.base_url,lambda:None,root=workspace,native=True);server.http.computer=current;current.runtime.diagnostics=True
        token=current.arm()['token'];job={'id':'youtube-real-fixture','kind':'desktop','state':'running','phase':'Prueba YouTube','steps':0,'result':None,'error':None,'external_calls':0,'goal':'Prueba sintética de búsqueda de una canción','cancelled':threading.Event(),'grant':token};current.jobs[job['id']]=job
        try:
            child=subprocess.Popen([str(chrome),'--user-data-dir='+str(workspace/'chrome-profile'),*(['--remote-debugging-port=0'] if args.diagnose_player else []),'--no-first-run','--no-default-browser-check','--disable-background-networking','--force-renderer-accessibility','--new-window','http://127.0.0.1:'+str(pages.server_port)],creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            current.runtime.call('begin_task',roots=list(current.roots),cancelled=job['cancelled'],timeout=25)
            deadline=time.monotonic()+20;window=None
            while time.monotonic()<deadline:
                observation=current.runtime.call('observe',cancelled=job['cancelled'],timeout=20)
                matches=[w for w in observation['windows'] if 'Melodi YouTube fixture '+pages.identity in w.get('title','')]
                if len(matches)==1:window=matches[0];break
                time.sleep(.3)
            if not window:raise ValueError('No se identificó la ventana aislada de la prueba.')
            identity={'handle':str(window['handle']),'process_id':window['processId']}
            def execute(action,params=None,timeout=40):return current.runtime.call('execute',step={'action':action,'params':{**identity,**(params or {})}},cancelled=job['cancelled'],timeout=timeout)
            initial=execute('browser_observe');report['initial_tab_count']=len(initial['tabs'])
            query='Rick Astley Never Gonna Give You Up official music video'
            if args.playback_url:
                navigation=execute('browser_new_tab',{'url':args.playback_url},timeout=45);report['navigation']=navigation
                time.sleep(3)
                observed=execute('browser_observe');tab=next(t for t in observed['tabs'] if t.get('selected'))
                result=execute('browser_resume',{'tab_id':tab['id']},timeout=35)
            else:result=execute('browser_youtube_search',{'query':query},timeout=110)
            report['search_result']=result
            if not result.get('verified') or not result.get('playing'):raise ValueError('No se confirmó el avance del reproductor.')
            report['checks'].append('direct playback URL opened and player advanced' if args.playback_url else 'search selected one observed music result and player advanced')
            observed=execute('browser_observe');tab=next(t for t in observed['tabs'] if t.get('selected'))
            paused=execute('browser_pause',{'tab_id':tab['id']});report['pause_result']=paused
            if not paused.get('verified') or not paused.get('paused'):raise ValueError('No se confirmó la pausa.')
            report['checks'].append('pause verified in the same observed player')
            resumed=execute('browser_resume',{'tab_id':tab['id']});report['resume_result']=resumed
            if not resumed.get('verified') or not resumed.get('playing'):raise ValueError('No se confirmó la reanudación.')
            report['checks'].append('resume verified through observed player progress')
            final_pause=execute('browser_pause',{'tab_id':tab['id']});report['left_paused']=bool(final_pause.get('verified') and final_pause.get('paused'))
            original=next(t for t in observed['tabs'] if pages.identity in t.get('name',''));selected=execute('browser_select_tab',{'tab_id':original['id']})
            report['tabs_preserved']=selected.get('tabs_preserved');report['status']='passed'
        except Exception as error:
            report.update(status='failed',failure=str(error))
            # Read only the isolated browser's observation for actionable state.
            try:
                observed=execute('browser_observe')
                report['visible_player_present']=bool(observed.get('player'))
                if observed.get('player'):report['player_diagnostic']={key:observed['player'].get(key) for key in ('automationId','className','role','width','height')}
                report['player_controls']=[{'name':control.get('name'),'role':control.get('role'),'className':control.get('className'),'position':control.get('position'),'valueText':control.get('valueText'),'inPlayer':control.get('inPlayer')} for control in observed.get('controls',[]) if control.get('inPlayer')][:25]
                report['selected_tabs']=[t.get('name','')[:180] for t in observed.get('tabs',[]) if t.get('selected')]
            except Exception:pass
            if args.diagnose_player:
                # Diagnostic only, in this newly created test profile. Never used
                # by the production executor or as evidence of native UI success.
                try:
                    from websockets.sync.client import connect
                    port=(workspace/'chrome-profile/DevToolsActivePort').read_text().splitlines()[0]
                    targets=json.load(urlopen('http://127.0.0.1:'+port+'/json',timeout=5))
                    target=next(t for t in targets if t.get('type')=='page' and t.get('url','').startswith('https://www.youtube.com/watch?'))
                    samples=[]
                    with connect(target['webSocketDebuggerUrl'],open_timeout=5) as ws:
                        expression="(()=>{const v=document.querySelector('#movie_player video');return v?{time:v.currentTime,paused:v.paused,ready:v.readyState,buffered:v.buffered.length?v.buffered.end(v.buffered.length-1):0,displayTime:document.querySelector('.ytp-time-current')?.textContent,playerClass:document.querySelector('#movie_player')?.className}:null})()"
                        for index in range(2):
                            ws.send(json.dumps({'id':index+1,'method':'Runtime.evaluate','params':{'expression':expression,'returnByValue':True}}))
                            while True:
                                message=json.loads(ws.recv(timeout=5))
                                if message.get('id')==index+1:samples.append(message.get('result',{}).get('result',{}).get('value'));break
                            if index==0:time.sleep(2)
                    report['diagnostic_dom_only']=samples
                except Exception as diagnostic_error:report['diagnostic_failure']=type(diagnostic_error).__name__
        finally:
            job['state']='succeeded' if report['status']=='passed' else 'failed';report['planner_requests']=job['external_calls'];report['native_diagnostics']=current.runtime.diagnostic_events
            try:current.runtime.call('end_task',timeout=5)
            except Exception:current.runtime.cancel()
            current.close();pages.shutdown();pages.server_close()
            if child and child.poll() is None:child.terminate()
            (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({key:report[key] for key in ('status','checks','failure','planner_requests','cost_amount') if key in report},ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
