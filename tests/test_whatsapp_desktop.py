import base64
import copy
import json
from io import BytesIO
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from uuid import uuid4
from unittest.mock import patch
from services.whatsapp_desktop import WhatsAppDesktop

NOW=1800000000
class Store:
    def __init__(self,value=None):self.value=value
    def load(self):return copy.deepcopy(self.value)
    def save(self,value):self.value=copy.deepcopy(value)
class Account:
    def status(self):return{'signed_in':True,'account':{'id':'user-a'}}
class Computer:
    def __init__(self):self.jobs={};self.schedule_authorities={};self.enqueued=0;self.cancelled=[];self.approvals=[]
    def enqueue(self,kind,goal,token,**kwargs):
        self.enqueued+=1;key=str(uuid4());self.jobs[key]={'id':key,'state':'running','phase':'Working','result':None,'error':None,'external_calls':0};return self.jobs[key]
    def public(self,value):return dict(value)
    def cancel(self,key):self.cancelled.append(key);self.jobs[key]['state']='cancelled'
    def approve_file_action(self,*args):self.approvals.append(args)
class Remote:
    def __init__(self,device):self.device=device;self.command=None;self.calls=[];self.fail_ack=False;self.controls=[];self.change=None
    def call(self,path,body,token=None):
        self.calls.append((path,copy.deepcopy(body)))
        if path=='poll':
            if self.change:self.change()
            command=self.command;self.command=None
            return {'enabled':True,'command':command,'controls':self.controls}
        if path=='update':return{'accepted':not self.fail_ack,'state':'running'}
        return{'stored':True}
class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.computer=Computer()
        self.device=str(uuid4());self.store=Store({'deviceId':self.device,'deviceKey':'a'*64,'userId':'user-a','enabled':True,'name':'Synthetic PC','jobs':{},'pull':None})
        self.http=Remote(self.device);self.account=Account();self.host=WhatsAppDesktop(self.temp.name,lambda:self.computer,self.account,store=self.store,http=self.http,now=lambda:NOW)
    def command(self):return {'id':str(uuid4()),'deviceId':self.device,'phone':'18095550101','type':'instruction','instruction':'Synthetic task','payload':{},'expiresAt':(NOW+60)*1000}
    def test_a_polled_command_gets_one_exact_scoped_grant_and_no_global_arm(self):
        value=self.command();self.http.command=value;self.host.tick()
        self.assertEqual(self.computer.enqueued,1);self.assertEqual(len(self.computer.schedule_authorities),1)
        self.http.command=value;self.host.tick();self.assertEqual(self.computer.enqueued,1)
    def test_an_unacknowledged_claim_never_executes(self):
        self.http.fail_ack=True;self.http.command=self.command();self.host.tick();self.assertEqual(self.computer.enqueued,0)
    def test_a_response_after_disable_cannot_start_a_task(self):
        self.http.command=self.command();self.http.change=lambda:self.host.configure(False);self.host.tick();self.assertEqual(self.computer.enqueued,0)
    def test_sign_out_cancels_only_owned_jobs_and_removes_their_grants(self):
        self.http.command=self.command();self.host.tick();self.account.status=lambda:{'signed_in':False};self.host.tick()
        self.assertEqual(len(self.computer.cancelled),1);self.assertEqual(self.computer.schedule_authorities,{})
    def test_restart_does_not_repeat_a_received_or_starting_command(self):
        remote=str(uuid4());self.store.value['jobs']={remote:{'lease':'b'*64,'state':'starting','local_id':None,'revision':0}}
        restored=WhatsAppDesktop(self.temp.name,lambda:self.computer,self.account,store=self.store,http=self.http,now=lambda:NOW);restored.tick()
        self.assertEqual(self.computer.enqueued,0);self.assertTrue(any(path=='update' and body['state']=='interrupted' for path,body in self.http.calls))
    def test_an_approval_response_is_consumed_once_and_reaches_the_exact_local_job(self):
        value=self.command();self.http.command=value;self.host.tick();local=self.host.jobs[value['id']]['local_id']
        self.http.controls=[{'id':value['id'],'action':'approval','revision':1,'approvalId':'x'*32,'accepted':True}];self.host.tick();self.host.tick()
        self.assertEqual(self.computer.approvals,[(local,'x'*32,True)])
    def test_invalid_and_expired_commands_do_not_enqueue(self):
        for changes in [{'deviceId':str(uuid4())},{'expiresAt':NOW*1000},{'instruction':'x'*2001},{'type':'call'}]:
            self.http.command={**self.command(),**changes}
            with self.assertRaises(ValueError):self.host.tick()
        self.assertEqual(self.computer.enqueued,0)
    def test_results_are_not_claimed_before_the_computer_finishes(self):
        value=self.command();self.http.command=value;self.host.tick();local=self.host.jobs[value['id']]['local_id']
        self.assertFalse(any(path=='update' and body['state']=='succeeded' for path,body in self.http.calls))
        self.computer.jobs[local].update(state='succeeded',result={'message':'Synthetic result verified.'});self.host.tick()
        self.assertTrue(any(path=='update' and body['state']=='succeeded' for path,body in self.http.calls));self.assertEqual(self.computer.schedule_authorities,{})
    def test_private_operator_enrollment_stops_after_account_change_or_later_sign_out(self):
        self.host.profile['operator_enrolled']=True;self.account.status=lambda:{'signed_in':False}
        self.assertTrue(self.host._valid_account())
        self.account.status=lambda:{'signed_in':True,'account':{'id':'user-a'}};self.assertTrue(self.host._valid_account())
        self.account.status=lambda:{'signed_in':False};self.assertFalse(self.host._valid_account())
        self.account.status=lambda:{'signed_in':True,'account':{'id':'other-user'}};self.assertFalse(self.host._valid_account())
    def test_image_reference_is_decoded_as_data_and_attached_to_only_its_task(self):
        from PIL import Image
        from services.computer.references import ReferenceStore
        self.computer.references=ReferenceStore();output=BytesIO();Image.new('RGB',(32,32),'green').save(output,'PNG')
        self.http.reference=lambda body:(output.getvalue(),'image/png')
        observed={};original=self.computer.enqueue
        def enqueue(*args,**kwargs):observed.update(kwargs);return original(*args,**kwargs)
        self.computer.enqueue=enqueue;value={**self.command(),'type':'instruction_reference'};self.http.command=value;self.host.tick()
        self.assertEqual(len(observed['references']),1);self.assertEqual(observed['user_request'],value['instruction'])
        self.assertEqual(observed['selected'],[])
    def test_return_artifact_rejects_paths_outside_the_workspace(self):
        self.computer.workspace=Path(self.temp.name)/'workspace';self.computer.workspace.mkdir()
        outside=Path(self.temp.name)/'private.txt';outside.write_text('SYNTHETIC PRIVATE DATA')
        job={'id':str(uuid4()),'state':'succeeded','result':{'path':str(outside)}}
        self.assertIsNone(self.host._result_artifact(self.computer,job))
        inside=self.computer.workspace/'result.txt';inside.write_text('SYNTHETIC OUTPUT');job['result']['path']=str(inside)
        self.assertEqual(self.host._result_artifact(self.computer,job),(inside,'text/plain','document'))
    def test_scoped_whatsapp_grant_allows_its_team_without_widening_folders(self):
        from services.computer.service import ComputerService
        from unittest.mock import Mock
        service=ComputerService('http://local.test',lambda:None,root=Path(self.temp.name)/'computer');self.addCleanup(service.close)
        goal='Prepara un documento ficticio';grant='synthetic-scoped-grant'
        service.schedule_authorities[grant]={'expires':time.monotonic()+60,'kind':'orchestrator','goal':goal}
        with patch.object(service.queues['orchestrator'],'submit',Mock()):parent_id=service.enqueue('orchestrator',goal,grant)['id']
        managed={'parent_id':parent_id,'agent_key':'a','task_key':'t1','title':'Documento','attempt':1,'criteria':['Texto ficticio']}
        with patch.object(service.queues['document'],'submit',Mock()):
            child=service.enqueue('document','Redacta el texto ficticio',grant,managed=managed,roots=service.roots,selected=[])
            self.assertEqual(service.jobs[child['id']]['parent_id'],parent_id)
            with self.assertRaises(PermissionError):service.enqueue('document','Otra tarea',grant,managed=managed,roots=[str(Path(self.temp.name)/'outside')])
            with self.assertRaises(PermissionError):service.enqueue('document','Otra tarea',grant)
    def test_switching_accounts_does_not_publish_old_jobs_with_the_new_device_identity(self):
        self.http.command=self.command();self.host.tick();self.assertEqual(len(self.host.jobs),1)
        self.account.status=lambda:{'signed_in':True,'account':{'id':'user-b'}}
        self.account.call_whatsapp=lambda *args,**kwargs:{'registered':True}
        with patch.object(self.host,'start'):
            self.host.configure(True)
        self.assertEqual(self.host.profile['userId'],'user-b');self.assertEqual(self.host.jobs,{})
        self.assertNotEqual(self.host.profile['deviceId'],self.device)

if __name__=='__main__':unittest.main()
