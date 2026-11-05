"""Owned invoice/inventory state machine; native input, Meta and search substituted."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from services.computer.service import ComputerService
from services.computer.app_memory import ApplicationMemory
from tests.test_computer_control import Runtime
from tests.test_edits_mcp import EditorFixture

def task(key,kind,title,after=()):return {'key':key,'kind':kind,'title':title,'instruction':title,'after':list(after),'criteria':['Resultado comprobable del encargo.']}

class Inventory(Runtime):
    def __init__(self):super().__init__();self.opened=threading.Event();self.research=threading.Event();self.sequence=0;self.fields={};self.invoices=[];self.stock=[];self.version='1';self.current=[]
    def call(self,method,**kwargs):
        self.calls.append((method,kwargs))
        if method=='observe':
            self.sequence+=1;self.current=[{'id':'3.'+str(self.sequence)+'.'+str(i),'name':name,'role':'ControlType.Edit' if i<2 else 'ControlType.Button'} for i,name in enumerate(['Cliente','Existencias','Crear borrador','Añadir existencias'])]
            return {'foreground':{'processName':'facturalab','version':self.version,'className':'Fixture'},'controls':self.current,'windows':[{'handle':'10','processId':5,'title':'FacturaLab'}]}
        if method!='execute':return {'verified':True}
        step=kwargs['step'];p=step['params']
        if step['action']=='launch_app':
            if not self.research.wait(2):raise ValueError('Research did not run concurrently')
            self.opened.set();return {'verified':True}
        control=next(c for c in self.current if c['id']==p['control_id'])
        if step['action']=='type_text':self.fields[control['name']]=p['text'];return {'text_value_verified':True,'input_sent':True}
        if control['name']=='Crear borrador':self.invoices.append(self.fields['Cliente'])
        if control['name']=='Añadir existencias':self.stock.append(self.fields['Existencias'])
        return {'input_sent':True,'verified':True}

class Planner:
    def __init__(self):self.customer='Cliente sintético privado';self.quantity='7';self.reused=False
    def generate(self,prompt,data,**kwargs):
        if 'evaluate_agent' in prompt:return {'accepted':True,'checks':[{'index':0,'passed':True,'evidence':'Evidencia sintética comprobada por el evaluador sustituido.'}],'correction':''}
        count=len(data.get('completed_steps',[]));goal=data.get('goal')
        if goal=='Abrir FacturaLab':return {'done':True} if count else {'done':False,'step':{'action':'launch_app','params':{'app':'FacturaLab'}}}
        if count>=4:return {'done':True}
        self.reused|=bool(data.get('learned_application_skills'))
        control=data['observation']['controls'][[0,2,1,3][count]];action='type_text' if count in (0,2) else 'click_control';params={'handle':'10','process_id':5,'control_id':control['id']}
        if action=='type_text':params['text']=self.customer if count==0 else self.quantity
        return {'done':False,'step':{'action':action,'params':params}}

class Tools:
    def __init__(self,runtime):self.runtime=runtime
    def plan(self,*args):return [task('t1','desktop','Abrir FacturaLab'),task('t2','research','Manual de FacturaLab'),task('t3','desktop','Factura borrador y existencias',['t1','t2'])]
    def research(self,goal,directory,identifier,cancelled,charge):
        self.runtime.research.set()
        if not self.runtime.opened.wait(2):raise ValueError('Application did not open during research')
        Path(directory).mkdir(parents=True,exist_ok=True);path=Path(directory)/(identifier+'.md');path.write_text('Manual sintético: Cliente, Crear borrador, Existencias, Añadir existencias.',encoding='utf-8')
        return {'path':str(path),'verified':True,'web_search_verified':True,'sources':[{'url':'https://manual.fixture.test/facturalab'}],'simulated':True}

class ApplicationLearningTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.runtime=Inventory();self.planner=Planner()
        self.service=ComputerService('http://127.0.0.1:1',lambda:None,root=Path(self.temp.name)/'computer',runtime=self.runtime,planner=self.planner,native=True,edits_factory=EditorFixture)
        self.service.orchestrator.tools=Tools(self.runtime);self.addCleanup(self.service.close);self.token=self.service.arm()['token']
    def wait(self,job):
        actual=self.service.jobs[job['id']];self.assertTrue(actual['finished'].wait(8));self.assertEqual(actual['state'],'succeeded',actual.get('error'));return actual
    def test_parallel_open_research_then_business_operations_learn_without_user_skill_request(self):
        activity=[];self.service.activity_callback=activity.append
        parent=self.wait(self.service.enqueue('orchestrator','Crear una factura borrador y añadir existencias en FacturaLab.',self.token))
        self.assertEqual(len(self.runtime.invoices),1);self.assertEqual(self.runtime.stock,['7']);self.assertTrue(self.runtime.opened.is_set() and self.runtime.research.is_set())
        self.assertEqual(len(parent['result']['learned_application_skills']),1)
        self.assertTrue(any(value['working'] for value in activity));self.assertFalse(max(activity,key=lambda value:value['revision'])['working'])
        stored=''.join(p.read_text(encoding='utf-8') for p in self.service.app_memory.root.glob('*.json'));self.assertNotIn(self.planner.customer,stored);self.assertNotIn('control_id',stored);self.assertNotIn('process_id',stored);self.assertIn('user_value',stored)
        record=self.service.app_memory.catalog()[0];self.assertEqual(record['application'],'facturalab');self.assertEqual(record['steps'],4)
        loaded=ApplicationMemory(self.service.app_memory.root);self.assertEqual(len(loaded.lookup(self.runtime.call('observe'))),1)
        self.planner.customer='Otro cliente de prueba';self.planner.quantity='3'
        self.wait(self.service.enqueue('desktop','Nueva operación explícita',self.token));self.assertTrue(self.planner.reused);self.assertEqual(self.runtime.invoices[-1],'Otro cliente de prueba');self.assertEqual(self.runtime.stock[-1],'3')
        self.runtime.version='2';self.assertEqual(loaded.lookup(self.runtime.call('observe')),[])
    def test_unreviewed_or_failed_work_never_becomes_a_verified_skill(self):
        observation=self.runtime.call('observe');job={'id':'own-unreviewed','state':'failed'};control=observation['controls'][2]
        self.service.app_memory.observe_step(job,observation,{'action':'click_control','params':{'control_id':control['id']}},{'verified':True})
        self.assertEqual(self.service.app_memory.remember(job),[]);job.update(state='succeeded',review_state='pending');self.assertEqual(self.service.app_memory.remember(job),[])
    def test_repeated_reviewed_work_uses_one_decision_and_fresh_control_ids(self):
        for _ in range(2):
            value=self.wait(self.service.enqueue('desktop','Crear borrador y añadir existencias en FacturaLab',self.token))
            value['review_state']='accepted';self.service.app_memory.remember(value)
        observation=self.runtime.call('observe');recipe=self.service.app_memory.lookup(observation)[0];self.assertTrue(recipe['shortcut_ready'])
        decisions=[]
        def plan(prompt,data,**kw):
            decisions.append(data)
            return {'done':False,'recipe':{'id':recipe['id'],'values':{'0':'Cliente actual distinto','2':'2'}}}
        self.planner.generate=plan
        value=self.wait(self.service.enqueue('desktop','Crear otro borrador y añadir dos existencias en FacturaLab',self.token))
        self.assertEqual(len(decisions),1);self.assertEqual(value['steps'],4);self.assertEqual(self.runtime.invoices[-1],'Cliente actual distinto');self.assertEqual(self.runtime.stock[-1],'2')
        value['review_state']='accepted';self.service.app_memory.remember(value);performance=self.service.app_memory.catalog()[0]['performance']
        self.assertEqual(performance['successful_runs'],3);self.assertEqual(performance['reused_runs'],1);self.assertGreaterEqual(performance['saved_decisions'],3)
        stored=''.join(p.read_text(encoding='utf-8') for p in self.service.app_memory.root.glob('*.json'));self.assertNotIn('Cliente actual distinto',stored)
        loaded=ApplicationMemory(self.service.app_memory.root);self.assertEqual(loaded.catalog()[0]['performance'],performance)
        program=loaded.bind({'id':recipe['id'],'values':{'0':'Otro','2':'1'}},self.runtime.call('observe'))
        foreground_only=self.runtime.call('observe');foreground_only['foreground']['windowHandle']='10'
        self.assertEqual(loaded.next_step(program,foreground_only)['params']['process_id'],5)
        changed=self.runtime.call('observe');changed['controls']=[changed['controls'][1]];self.assertIsNone(loaded.next_step(program,changed))
        loaded.penalize(recipe['id']);self.assertFalse(loaded.lookup(self.runtime.call('observe'))[0]['shortcut_ready'])
    def test_shortcuts_require_exact_current_inputs_and_do_not_enable_sensitive_buttons(self):
        for _ in range(2):
            value=self.wait(self.service.enqueue('desktop','Crear borrador y añadir existencias en FacturaLab',self.token));value['review_state']='accepted';self.service.app_memory.remember(value)
        observation=self.runtime.call('observe');recipe=self.service.app_memory.lookup(observation)[0]
        with self.assertRaises(ValueError):self.service.app_memory.bind({'id':recipe['id'],'values':{'0':'Cliente'}},observation)
        with self.assertRaises(ValueError):self.service.app_memory.bind({'id':'inexistente','values':{}},observation)
        self.service.app_memory.records[recipe['id']]['steps'][1]['selector']['name']='Enviar factura'
        self.assertFalse(self.service.app_memory.lookup(observation)[0]['shortcut_ready'])
    def test_documentation_cannot_add_executable_actions_or_old_typed_values(self):
        job={'id':'own-code','state':'succeeded','review_state':'accepted'};observation=self.runtime.call('observe')
        for action in ['shell','delete_file','launch_app','press_key']:
            self.service.app_memory.observe_step(job,observation,{'action':action,'params':{'text':'arbitrary code'}},{'verified':True})
        self.assertEqual(self.service.app_memory.remember(job),[]);self.assertFalse(list(self.service.app_memory.root.glob('*.json')))
    def test_unordered_application_plan_is_repaired_before_any_business_action(self):
        calls=[];original=self.service.orchestrator.tools.plan
        def plan(request,*args):
            calls.append(request.copy())
            return [task('t1','desktop','Abrir y operar'),task('t2','research','Manual')] if len(calls)==1 else original(request,*args)
        self.service.orchestrator.tools.plan=plan
        parent={'goal':'Usa el programa FacturaLab y aprende a crear facturas e inventario.','user_request':'Usa el programa FacturaLab y aprende a crear facturas e inventario.','grant':self.token,'cancelled':threading.Event()}
        prepared=self.service.orchestrator.prepare_plan(parent);self.assertEqual(len(prepared),3);self.assertIn('plan_feedback',calls[1]);self.assertEqual(self.runtime.calls,[])
    def test_string_criteria_is_repaired_before_any_action(self):
        calls=[];original=self.service.orchestrator.tools.plan
        def plan(request,*args):
            calls.append(request.copy());return [{**task('t1','desktop','Inspeccionar'),'criteria':'Texto en vez de lista'}] if len(calls)==1 else original(request,*args)
        self.service.orchestrator.tools.plan=plan
        parent={'goal':'Usar la aplicación','grant':self.token,'cancelled':threading.Event()}
        self.assertEqual(len(self.service.orchestrator.prepare_plan(parent)),3);self.assertIn('plan_feedback',calls[1]);self.assertEqual(self.runtime.calls,[])

if __name__=='__main__':unittest.main()
