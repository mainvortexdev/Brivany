"""Actual native invoice/inventory fixture; planner/search/review are scripted."""
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from uuid import uuid4
from services.computer.service import ComputerService
from services.computer.runtime import NativeRuntime,ROOT
from tests.test_application_memory import Tools,Planner
from tests.test_edits_mcp import EditorFixture

SOURCE=r'''
using System;using System.IO;using System.Windows.Forms;using System.Drawing;
class Lab:Form {
 TextBox customer=new TextBox(),stock=new TextBox();Button invoice=new Button(),add=new Button();int invoices=0,inventory=0;string target;
 public Lab(string file){target=file;Text="FacturaLab prueba nativa";Width=560;Height=300;StartPosition=FormStartPosition.CenterScreen;
 customer.AccessibleName="Cliente";customer.SetBounds(30,40,240,28);stock.AccessibleName="Existencias";stock.SetBounds(30,150,240,28);
 invoice.Text="Crear borrador";invoice.AccessibleName="Crear borrador";invoice.SetBounds(300,40,200,36);add.Text="Añadir existencias";add.AccessibleName="Añadir existencias";add.SetBounds(300,150,200,36);
 invoice.Click+=(s,e)=>{if(customer.Text.Length>0){invoices++;invoice.Text="Borrador creado";customer.Clear();Save();}};
 add.Click+=(s,e)=>{int n;if(Int32.TryParse(stock.Text,out n)){inventory+=n;add.Text="Existencias actualizadas";stock.Clear();Save();}};
 Controls.AddRange(new Control[]{customer,stock,invoice,add});Save();}
 void Save(){File.WriteAllText(target,"{\"invoices\":"+invoices+",\"stock\":"+inventory+"}");}
 [STAThread]static void Main(string[] args){Application.EnableVisualStyles();Application.Run(new Lab(args[0]));}
}'''

class NativeInventory(NativeRuntime):
    def __init__(self,workspace):
        super().__init__(workspace,proxy='http://127.0.0.1:1',token='owned-fixture-'+uuid4().hex,diagnostics=True);self.opened=threading.Event();self.research=threading.Event()
    def call(self,method,**kwargs):
        try:result=super().call(method,**kwargs)
        except Exception as error:self.failure=str(error)[:240];raise
        if method=='execute' and kwargs['step']['action']=='focus_window':
            if not self.research.wait(2):raise ValueError('Manual research did not run in parallel')
            self.opened.set()
        return result

class NativePlanner(Planner):
    def generate(self,prompt,data,**kwargs):
        if 'evaluate_agent' in prompt:return super().generate(prompt,data,**kwargs)
        observation=data['observation'];count=len(data['completed_steps']);window=next(w for w in observation['windows'] if w.get('title')=='FacturaLab prueba nativa')
        if data['goal']=='Abrir FacturaLab':return {'done':True} if count else {'done':False,'step':{'action':'focus_window','params':{'handle':str(window['handle']),'process_id':window['processId']}}}
        count=sum(row['action'] in ('click_control','type_text') for row in data['completed_steps'])
        if count>=4:return {'done':True}
        if str((observation.get('foreground') or {}).get('windowHandle'))!=str(window['handle']):return {'done':False,'step':{'action':'focus_window','params':{'handle':str(window['handle']),'process_id':window['processId']}}}
        self.reused|=bool(data.get('learned_application_skills'))
        name=['Cliente','Crear borrador','Existencias','Añadir existencias'][count];matches=[c for c in observation['controls'] if c.get('name')==name]
        if len(matches)!=1:
            self.probe=self.runtime.call('control_probe',timeout=20)
            self.failure='Expected '+name+': '+json.dumps(self.probe,ensure_ascii=False)[:900];raise ValueError(self.failure)
        control=matches[0];action='type_text' if count in (0,2) else 'click_control';params={'handle':str(window['handle']),'process_id':window['processId'],'control_id':control['id']}
        if action=='type_text':params['text']=self.customer if count==0 else self.quantity
        return {'done':False,'step':{'action':action,'params':params}}

class NativeTools(Tools):
    def research(self,*args):
        self.runtime.research.set()
        if not self.runtime.opened.wait(40):raise ValueError('Native application did not become ready during manual research')
        return super().research(*args)

def main():
    folder=ROOT/'tmp/application-learning-native'/uuid4().hex;folder.mkdir(parents=True);source=folder/'FacturaLabFixture.cs';source.write_text(SOURCE,encoding='utf-8-sig');exe=folder/'FacturaLabFixture.exe';state=folder/'state.json'
    compiler=Path(os.environ.get('WINDIR',r'C:\Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    report={'passed':False,'type':'actual_owned_native_application_with_scripted_planner_research_and_review','provider_requests':0,'native_input_real':True,'real_application_data_used':False,'real_commercial_application_verified':False};child=None;service=None
    failures=[]
    def trace(frame,event,arg):
        if frame.f_code.co_filename.endswith('computer/service.py') or frame.f_code.co_filename.endswith('computer\\service.py'):
            if frame.f_code.co_name=='_run_job':
                if event=='exception':failures.append(type(arg[1]).__name__+': '+str(arg[1])[:220])
                return trace
        return None
    threading.settrace(trace)
    try:
        subprocess.run([str(compiler),'/nologo','/target:winexe','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/out:'+str(exe),str(source)],check=True,capture_output=True,timeout=20)
        child=subprocess.Popen([str(exe),str(state)],creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));deadline=time.monotonic()+8
        while not state.is_file() and time.monotonic()<deadline:time.sleep(.1)
        runtime=NativeInventory(folder/'workspace');planner=NativePlanner();planner.runtime=runtime;service=ComputerService('http://127.0.0.1:1',lambda:None,root=folder/'computer',runtime=runtime,planner=planner,native=True,edits_factory=EditorFixture);service.orchestrator.tools=NativeTools(runtime);token=service.arm()['token']
        first=service.enqueue('orchestrator','En FacturaLab, crea una factura borrador para un cliente sintético y añade siete existencias.',token);job=service.jobs[first['id']]
        if not job['finished'].wait(100):raise ValueError('Native test deadline')
        if job['state']!='succeeded':raise ValueError('Native team: '+str(getattr(runtime,'failure',getattr(planner,'failure',job.get('error')))))
        actual=json.loads(state.read_text());assert actual=={'invoices':1,'stock':7},actual
        assert len(job['result']['learned_application_skills'])==1
        memory=service.app_memory.catalog();assert memory[0]['steps']==4,memory
        planner.customer='Cliente nuevo sintético';planner.quantity='3';second=service.enqueue('desktop','Segunda operación autorizada en la misma aplicación',token);next_job=service.jobs[second['id']]
        if not next_job['finished'].wait(70):raise ValueError('Reuse deadline')
        if next_job['state']!='succeeded':raise ValueError('Reuse failed: '+str(next_job.get('error')))
        actual=json.loads(state.read_text());assert actual=={'invoices':2,'stock':10},actual;assert planner.reused
        next_job['review_state']='accepted';service.app_memory.remember(next_job)
        recipe=service.app_memory.lookup(runtime.call('observe',timeout=20))[0];assert recipe['shortcut_ready']
        decisions=[]
        def shortcut(prompt,data,**kwargs):
            decisions.append(True);return {'done':False,'recipe':{'id':recipe['id'],'values':{'0':'Cliente tercero sintético','2':'2'}}}
        planner.generate=shortcut;third=service.enqueue('desktop','Tercera operación autorizada en FacturaLab',token);third_job=service.jobs[third['id']]
        if not third_job['finished'].wait(70):raise ValueError('Shortcut deadline')
        if third_job['state']!='succeeded':raise ValueError('Shortcut failed: '+str(third_job.get('error')))
        actual=json.loads(state.read_text());assert actual=={'invoices':3,'stock':12},actual;assert len(decisions)==1
        third_job['review_state']='accepted';service.app_memory.remember(third_job);performance=service.app_memory.catalog()[0]['performance']
        report.update(passed=True,invoices=3,stock=12,skills_saved=len(memory),reused_with_new_values=True,parallel_open_and_manual=True,steps=4,shortcut_decision_calls=len(decisions),baseline_step_decision_calls=5,review='scripted after inspecting owned fixture output',performance=performance,fixture_started_by_test_harness=True,application_focused_and_operated_by_executor=True)
    except Exception as error:
        report['error']=str(error)[:300]
        report['own_fixture_exceptions']=failures[-6:]
        if 'planner' in locals() and hasattr(planner,'probe'):report['own_fixture_control_probe']=planner.probe
    finally:
        threading.settrace(None)
        if service:service.close()
        if child and child.poll() is None:child.terminate();child.wait(timeout=5)
    output=ROOT/'tmp/application-learning-native/report.json';output.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report));return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
