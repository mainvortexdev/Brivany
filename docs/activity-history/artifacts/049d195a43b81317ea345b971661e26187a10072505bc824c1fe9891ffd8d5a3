"""Explicit bounded real Meta + native browser test on synthetic local pages."""
import argparse
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from urllib.request import Request, urlopen
from uuid import uuid4

from desktop.experience.launcher import experience_handler
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler, load_local_config
from services.computer.planner import MetaPlanner
from services.computer.service import ComputerService
from tools.check_computer_browser_real import Pages

ROOT=Path(__file__).resolve().parents[1]


class CountingPlanner(MetaPlanner):
    def __init__(self):super().__init__();self.requests=0;self.decisions=[];self.failures=[]
    def generate(self,*args,**kwargs):
        if self.requests>=6:raise ValueError('Máximo de seis solicitudes para esta prueba.')
        self.requests+=1
        try:result=super().generate(*args,**kwargs)
        except Exception as error:
            self.failures.append({'type':type(error).__name__,'http_status':getattr(error,'code',None),'message':str(error)[:200] if isinstance(error,ValueError) else None})
            raise
        step=result.get('step') or {};self.decisions.append({'keys':list(result),'kind':result.get('kind'),'done':result.get('done'),'action':step.get('action'),'parameter_keys':list(step.get('params') or {})})
        return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',required=True,action='store_true');parser.parse_args();load_local_config()
    directory=ROOT/'tmp/computer-agent-browser-real';directory.mkdir(parents=True,exist_ok=True)
    workspace=directory/('fixture-'+uuid4().hex[:8]);workspace.mkdir()
    pages=ThreadingHTTPServer(('127.0.0.1',0),Pages);pages.fixture_id=uuid4().hex[:8];pages.clicks=0
    threading.Thread(target=pages.serve_forever,daemon=True).start();base='http://127.0.0.1:'+str(pages.server_port)
    planner=CountingPlanner();report={'scope':'real HTTP turn routing, Meta planning and native Chrome on synthetic local pages',
        'checks':[],'physical_audio_verified':False,'browser_network_consumption':'unknown','cost_amount':None}
    child=None
    with LocalDesktopServer(handler=experience_handler(Handler)) as server:
        server.http.computer_lock=threading.RLock()
        current=ComputerService(server.base_url,lambda:None,root=workspace,planner=planner,native=True);server.http.computer=current
        token=current.arm()['token'];native_call=current.runtime.call
        try:
            chrome=Path(os.environ.get('PROGRAMFILES',r'C:\Program Files'))/'Google/Chrome/Application/chrome.exe'
            child=subprocess.Popen([str(chrome),'--user-data-dir='+str(workspace/'chrome-profile'),'--no-first-run','--no-default-browser-check',
                '--disable-background-networking','--force-renderer-accessibility','--new-window',base+'/a'],
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            deadline=time.monotonic()+25;window=None
            while time.monotonic()<deadline:
                observed=native_call('observe',timeout=20)
                matches=[w for w in observed['windows'] if 'Melodi browser fixture '+pages.fixture_id+' A' in w.get('title','')]
                if len(matches)==1:window=matches[0];break
                time.sleep(.3)
            if not window:raise ValueError('No se identificó la ventana aislada.')
            handle=str(window['handle']);process_id=window['processId']
            def isolated_call(method,**kwargs):
                if method=='execute':
                    step=kwargs['step'];params=step['params']
                    report['last_action']={'action':step['action'],'handle_matches':str(params.get('handle'))==handle,'handle_type':type(params.get('handle')).__name__,'process_matches':params.get('process_id')==process_id}
                    if step['action'] not in {'focus_window','click_control','browser_observe','browser_read','browser_new_tab'} or str(params.get('handle'))!=handle or params.get('process_id')!=process_id:
                        raise ValueError('La prueba sólo admite la ventana y acciones de la fixture.')
                try:result=native_call(method,**kwargs)
                except Exception as error:report['native_failure']={'method':method,'code':getattr(error,'code',type(error).__name__)};raise
                if method=='observe':
                    # Real observations, filtered before sending anything to Meta.
                    result['windows']=[w for w in result['windows'] if str(w['handle'])==handle and w['processId']==process_id]
                    if not result.get('foreground') or str(result['foreground']['windowHandle'])!=handle:result.update(foreground=None,controls=[])
                return result
            current.runtime.call=isolated_call
            goal=f"En la ventana de Chrome titulada Melodi browser fixture {pages.fixture_id} A, haz clic UNA sola vez en Cambiar estado de prueba. Después abre una pestaña NUEVA con la dirección exacta {base}/b, conservando la pestaña anterior. Comprueba lo observado y termina. No cierres pestañas ni hagas otras acciones."
            request=Request(server.base_url+'/api/computer/turn',method='POST',data=json.dumps({'text':goal,'consent':True,'language':'es','history':[]}).encode(),
                headers={'Content-Type':'application/json','Origin':server.base_url,'X-Brivany-Control':token})
            with urlopen(request,timeout=45) as response:events=[json.loads(line) for line in response.read().decode().splitlines() if line.strip()]
            job=next(event['job'] for event in events if event.get('type')=='computer_task')
            report['checks'].append('real turn router dispatched a desktop task')
            deadline=time.monotonic()+180
            while time.monotonic()<deadline:
                result=current.jobs[job['id']]
                if result['state'] not in {'queued','planning','running'}:break
                time.sleep(.25)
            report['task_state']=result['state'];report['steps']=result['steps']
            if result['state']!='succeeded':raise ValueError('La tarea no terminó con éxito; estado '+result['state'])
            if pages.clicks!=1:raise ValueError('El botón no recibió exactamente un clic.')
            report['checks'].append('one native observed click reached the synthetic page')
            after=native_call('execute',step={'action':'browser_observe','params':{'handle':handle,'process_id':process_id}},timeout=30)
            if len(after['tabs'])!=2 or not any(pages.fixture_id+' A' in t['name'] for t in after['tabs']) or not any(t.get('selected') and pages.fixture_id+' B' in t['name'] for t in after['tabs']):raise ValueError('No se conservaron las dos pestañas de la fixture.')
            report['checks'].append('new requested tab B selected and original tab A preserved')
            report.update(status='passed',button_events=pages.clicks,tab_count=len(after['tabs']))
        except Exception as error:report.update(status='failed',failure=str(error))
        finally:
            report['planner_requests']=planner.requests
            report['planner_decisions']=planner.decisions
            report['planner_failures']=planner.failures
            current.close();pages.shutdown();pages.server_close()
            if child and child.poll() is None:child.terminate()
            (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
