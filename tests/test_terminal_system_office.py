"""System queries, harmless shutdown simulation and Office config invariants."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
from services.terminal.system_info import answer
from services.terminal.power import PowerScheduler,delay_from_request
from services.terminal.office import configuration
from services.terminal.office import OfficeInstaller
from services.terminal.policy import TerminalError
from services.terminal.executor import TerminalExecutor
from services.terminal.elevation import ElevationRequests,diagnostic_command
from services.terminal.checklist import CommandChecklist
from services.computer.planner import MetaPlanner
from packages.providers.conversation import ConversationRequest

FACTS={'observed_at':'2026-11-01T05:00:00+00:00','uptime_seconds':90061,'computer':{'manufacturer':'Fixture','model':'PC','hypervisor_present':False},'cpu':[{'Name':'Fixture CPU','NumberOfCores':4,'NumberOfLogicalProcessors':8,'VirtualizationFirmwareEnabled':True}],'os':{'name':'Windows fixture','architecture':'64 bits'},'memory_modules':[{'Capacity':12*1024**3}],'gpu':[{'Name':'Fixture GPU'}],'disks':[{'Model':'Fixture SSD','Size':512*10**9}]}


class SystemOfficeTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
    def tearDown(self):self.temp.cleanup()
    def scheduler(self,clock,action):
        value=PowerScheduler(self.root,action,clock=lambda:clock[0],start_worker=False);self.addCleanup(value.close);return value

    def test_answers_use_facts_and_state_uptime_basis(self):
        self.assertIn('1 días, 1 h 1 min 1 s',answer(FACTS,'uptime')['message'])
        self.assertIn('kernel',answer(FACTS,'uptime')['message']);self.assertIn('habilitada',answer(FACTS,'virtualization')['message'])
        self.assertIn('12 GiB',answer(FACTS,'specifications')['message']);self.assertIn('512 GB',answer(FACTS,'specifications')['message'])
        self.assertEqual(answer(FACTS,'all')['facts'],FACTS)

    def test_unknown_virtualization_is_not_reported_disabled(self):
        facts={**FACTS,'cpu':[{**FACTS['cpu'][0],'VirtualizationFirmwareEnabled':None}]}
        self.assertIn('no devolvió un estado concluyente',answer(facts,'virtualization')['message'])
        facts['computer']={**FACTS['computer'],'hypervisor_present':True}
        self.assertIn('hipervisor activo',answer(facts,'virtualization')['message'])

    def test_shutdown_examples_questions_negation_are_not_actions(self):
        for text in ('Si le digo apaga mi PC en 10 minutos','Por ejemplo apaga mi PC en 2 horas','No apagar el PC en 10 minutos','Cómo apagar mi PC en 10 minutos'):
            with self.subTest(text=text):self.assertIsNone(delay_from_request(text))
        self.assertEqual(delay_from_request('Apaga mi PC en 2 horas y 15 minutos'),8100)
        self.assertEqual(delay_from_request('Apaga mi PC en 10 minutos'),600)
        self.assertEqual(delay_from_request('Apaga mi PC en media hora'),1800)
        self.assertEqual(delay_from_request('Apaga mi PC en una hora y media'),5400)
        self.assertEqual(delay_from_request('Apaga mi PC en quince minutos; no fuerces las aplicaciones'),900)
        self.assertIsNone(delay_from_request('Explícame apagar mi PC en 10 minutos'))

    def test_shutdown_wait_can_be_cancelled_without_calling_os(self):
        clock=[1000];calls=[];s=self.scheduler(clock,lambda:calls.append('must not happen'))
        result=s.schedule(600,'synthetic-consent');self.assertFalse(result['executed']);self.assertTrue(result['requires_brivany_running'])
        clock[0]=1599;s.tick();self.assertEqual(calls,[]);self.assertTrue(s.cancel()['cancelled']);clock[0]=2000;s.tick();self.assertEqual(calls,[])

    def test_shutdown_is_requested_once_even_with_two_workers(self):
        clock=[1000];calls=[]
        def action():calls.append('harmless fixture');return {'id':'fixture','exit_code':0,'interrupted':False}
        a=self.scheduler(clock,action);result=a.schedule(60,'synthetic-consent');b=self.scheduler(clock,action)
        clock[0]=1061;a.tick();b.tick();a.tick();self.assertEqual(len(calls),1)
        saved=json.loads((a.directory/(result['power_id']+'.json')).read_text());self.assertEqual(saved['state'],'shutdown_requested');self.assertFalse(saved['force_apps_closed'])

    def test_overdue_shutdown_is_missed_on_restart(self):
        clock=[1000];s=self.scheduler(clock,lambda:self.fail('No actual power action'));result=s.schedule(60,'fixture')
        clock[0]=2000;restarted=self.scheduler(clock,lambda:self.fail('No overdue shutdown'));restarted.tick()
        self.assertEqual(restarted.pending(),[])
        self.assertEqual(json.loads((s.directory/(result['power_id']+'.json')).read_text())['state'],'missed_while_closed')

    def test_shutdown_adapter_never_uses_force_or_timed_force_flag(self):
        e=TerminalExecutor(self.root)
        with patch.object(e,'run',return_value={'fixture':True}) as run:e.request_poweroff()
        self.assertEqual(run.call_args.args[2],['/s','/t','0']);self.assertEqual(run.call_args.kwargs['_system_capability'],'graceful_poweroff')

    def test_office_config_for_only_word_excludes_other_apps(self):
        root=ET.fromstring(configuration('microsoft365',['word'],self.root))
        self.assertEqual(root.find('Add/Product').attrib['ID'],'O365HomePremRetail')
        excluded={r.attrib['ID'] for r in root.findall('Add/Product/ExcludeApp')}
        self.assertIn('Excel',excluded);self.assertIn('PowerPoint',excluded);self.assertNotIn('Word',excluded)
        props={r.attrib['Name']:r.attrib['Value'] for r in root.findall('Property')}
        self.assertEqual(props['AUTOACTIVATE'],'0');self.assertEqual(props['FORCEAPPSHUTDOWN'],'FALSE')
        self.assertEqual(root.find('Display').attrib['AcceptEULA'],'FALSE');self.assertIsNone(root.find('RemoveMSI'));self.assertIsNone(root.find('Remove'))

    def test_office_config_rejects_mismatched_product_and_unknown_app(self):
        for product,apps in [('word2024',['excel']),('microsoft365',['word','powershell']),('ProPlus2021Volume',['word'])]:
            with self.subTest(product=product,apps=apps),self.assertRaises(TerminalError):configuration(product,apps,self.root)

    @unittest.skipUnless(__import__('os').name=='nt','Windows Office elevation path')
    def test_office_requests_regular_elevation_without_waiting_unelevated(self):
        installer=OfficeInstaller(TerminalExecutor(self.root));prepared={'id':'fixture','setup':'fixture.exe'}
        with patch.object(installer,'signature'),patch.object(installer,'save'),patch('services.terminal.office.ctypes.windll.shell32.IsUserAnAdmin',return_value=False),patch.object(installer,'request_elevation',return_value={'requires_user':True}) as elevate,patch.object(installer.executor,'run') as run:
            self.assertTrue(installer.install(prepared)['requires_user']);elevate.assert_called_once_with('fixture',None);run.assert_not_called()

    def test_new_requests_route_to_terminal(self):
        planner=MetaPlanner()
        for request in ('Cuánto lleva mi PC encendido','Apaga mi PC en 10 minutos','Instala sólo Word de Microsoft Office'):
            with self.subTest(request=request),patch.object(planner,'generate',return_value={'kind':'terminal','goal':request}):
                self.assertEqual(planner.route(ConversationRequest(text=request,consent=True))['kind'],'terminal')

    @unittest.skipUnless(__import__('os').name=='nt','Windows fixed elevation request')
    def test_elevation_profile_is_readonly_and_uses_regular_uac(self):
        requests=ElevationRequests(self.root/'elevations');request=requests.prepare_chkdsk()
        self.assertEqual(request['profile'],'chkdsk-readonly');self.assertFalse(request['repair_requested'])
        self.assertEqual(len(request['arguments']),1);self.assertTrue(request['arguments'][0].endswith(':'))
        with patch('services.terminal.elevation.os.startfile') as launch:result=requests.launch(request)
        self.assertEqual(launch.call_args.kwargs['operation'],'runas')
        command=launch.call_args.kwargs['arguments'];self.assertNotIn('ExecutionPolicy',command);self.assertNotIn('EncodedCommand',command)
        self.assertIn('chkdsk.exe',command);self.assertTrue(result['requires_windows_consent']);self.assertFalse(result['diagnostic_started_verified'])

    @unittest.skipUnless(__import__('os').name=='nt','Windows fixed elevation receipt')
    def test_elevation_receipt_needs_matching_request_and_admin_token(self):
        requests=ElevationRequests(self.root/'elevations');request=requests.prepare_chkdsk()
        value={'request_id':request['id'],'nonce':request['nonce'],'profile':request['profile'],'binary':request['binary'],'arguments':request['arguments'],'cwd':request['directory'],'repair_requested':False,'admin_token':False,'pid':123,'exit_code':0,'output':'synthetic diagnostic'}
        path=Path(request['result']);path.write_text(json.dumps(value),encoding='utf-8')
        with self.assertRaises(TerminalError):requests.result(request)
        value['admin_token']=True;value['nonce']='wrong';path.write_text(json.dumps(value),encoding='utf-8')
        with self.assertRaises(TerminalError):requests.result(request)
        value['nonce']=request['nonce'];path.write_text(json.dumps(value),encoding='utf-8');self.assertEqual(requests.result(request)['pid'],123)


if __name__=='__main__':unittest.main()
