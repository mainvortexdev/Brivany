"""Permission/mode integration with substituted planner and native file adapter."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from services.computer.access import AccessPolicy
from services.computer.service import ComputerService
from services.terminal.service import TerminalService
from tests.test_computer_control import Runtime,Planner


class FileRuntime(Runtime):
    def call(self,method,**kwargs):
        if method=='file_action_prepare':
            self.calls.append((method,kwargs));p=kwargs['step']['params']
            return {'ticket':'owned-native-ticket','summary':{'action':kwargs['step']['action'],'source':p.get('path',p.get('source')),'destination':p.get('destination'),'size':12,'sha256':'a'*64}}
        return super().call(method,**kwargs)


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.runtime=FileRuntime();self.planner=Planner()
        self.service=ComputerService('http://127.0.0.1:1',lambda:None,root=self.root,runtime=self.runtime,planner=self.planner,native=True)
    def tearDown(self):self.service.close();self.temp.cleanup()
    def wait(self,identifier):
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            job=self.service.jobs[identifier]
            if job['state'] not in {'queued','planning','running'}:return job
            time.sleep(.01)
        self.fail('Fixture did not settle')
    def job(self,action):
        params={'path':'C:/owned/a.txt'} if action=='delete_file' else {'source':'C:/owned/a.txt','destination':'C:/owned/b.txt'}
        self.planner.generate=lambda p,d,**k: {'done':True} if d.get('completed_steps') else {'done':False,'step':{'action':action,'params':params}}
        token=self.service.arm()['token'];value=self.service.enqueue('desktop','Fixture: '+action,token);return self.wait(value['id'])
    def test_default_persistence_and_fail_closed_config(self):
        self.assertEqual(self.service.access.mode,'normal');policy=self.service.access.configure('full');self.assertFalse(policy['uac_auto_approval']);self.assertFalse(policy['registry_edits_allowed'])
        self.assertEqual(AccessPolicy(self.root).mode,'full');self.service.access.path.write_text('{"mode":"full","uac_auto_approval":true}')
        self.assertEqual(AccessPolicy(self.root).mode,'normal')
        with self.assertRaises(ValueError):self.service.access.configure('administrator')
    def test_normal_move_waits_and_only_exact_approval_resumes(self):
        job=self.job('move_file');self.assertEqual(job['state'],'awaiting_approval')
        self.assertNotIn('execute',[m for m,k in self.runtime.calls]);self.assertNotIn('ticket',job['approval'])
        with self.assertRaises(ValueError):self.service.approve_file_action(job['id'],'wrong',True)
        approval=job['approval']['id'];self.service.approve_file_action(job['id'],approval,True)
        self.assertEqual(self.wait(job['id'])['state'],'succeeded');self.assertEqual([m for m,k in self.runtime.calls].count('file_action_commit'),1)
        with self.assertRaises(ValueError):self.service.approve_file_action(job['id'],approval,True)
    def test_full_moves_without_prompt_but_delete_and_replace_always_wait(self):
        self.service.configure_access('full');self.assertEqual(self.job('move_file')['state'],'succeeded')
        for action in ['delete_file','replace_file']:
            job=self.job(action);self.assertEqual(job['state'],'awaiting_approval')
            self.service.approve_file_action(job['id'],job['approval']['id'],False);self.assertEqual(job['state'],'cancelled')
        self.assertNotIn('file_action_commit',[m for m,k in self.runtime.calls])
    def test_expiry_mode_change_and_disarm_revoke_pending_decisions(self):
        job=self.job('delete_file');job['_file_approval']['expires']-=301;self.service.expire_approvals();self.assertEqual(job['state'],'cancelled')
        job=self.job('delete_file');old=job['grant'];self.service.configure_access('full');self.assertEqual(job['state'],'cancelled');self.assertFalse(self.service.authorized(old))
        self.assertNotIn('file_action_commit',[m for m,k in self.runtime.calls])
    def test_changed_file_failure_is_not_reported_as_success(self):
        job=self.job('replace_file');old=self.runtime.call
        def changed(method,**kwargs):
            if method=='file_action_commit':raise ValueError('File changed')
            return old(method,**kwargs)
        self.runtime.call=changed;self.service.approve_file_action(job['id'],job['approval']['id'],True)
        self.assertEqual(self.wait(job['id'])['state'],'failed')
    def test_receipts_do_not_persist_executable_tickets_or_original_request(self):
        job=self.job('delete_file');deadline=time.monotonic()+3
        file=self.service.receipts/(job['id']+'.json')
        while time.monotonic()<deadline:
            raw=file.read_text(encoding='utf-8')
            if 'awaiting_approval' in raw:break
            time.sleep(.01)
        self.assertNotIn('owned-native-ticket',raw);self.assertNotIn('Fixture: delete_file',raw)
        other=ComputerService('http://127.0.0.1:1',lambda:None,root=self.root,runtime=Runtime(),planner=Planner(),native=True)
        try:self.assertEqual(other.jobs[job['id']]['state'],'interrupted');self.assertNotIn('_file_approval',other.jobs[job['id']])
        finally:other.close()
    def test_cleanup_chat_only_previews_never_removes_files(self):
        terminal=TerminalService(self.root/'terminal')
        try:
            with patch('services.terminal.temporary.TemporaryCleanup') as cleanup:
                cleanup.return_value.preview.return_value={'id':'fixture','files':[{'name':'old.txt'}],'bytes':10}
                result=terminal.run('Limpia los temporales',decide=lambda *a:{'operation':'cleanup_temporary'},identifier='fixture',cancelled=threading.Event(),progress=lambda *a:None)
                self.assertTrue(result['requires_user']);self.assertFalse(result['execution_started']);cleanup.return_value.execute.assert_not_called()
        finally:terminal.close()
    def test_http_cannot_approve_or_change_mode_even_with_a_control_grant(self):
        from urllib.request import Request,urlopen
        from urllib.error import HTTPError
        from desktop.launcher import LocalDesktopServer
        from desktop.experience.launcher import experience_handler
        from services.h1.server import Handler
        job=self.job('delete_file')
        with LocalDesktopServer(handler=experience_handler(Handler)) as server:
            server.http.computer_lock=threading.RLock();server.http.computer=self.service
            headers={'Origin':server.base_url,'Content-Type':'application/json','X-Brivany-Control':job['grant']}
            for route in ['/api/computer/file-approve','/api/computer/access-mode']:
                with self.assertRaises(HTTPError) as failure:urlopen(Request(server.base_url+route,data=json.dumps({'id':job['id'],'approval':job['approval']['id'],'accepted':True,'mode':'full'}).encode(),headers=headers),timeout=4)
                self.assertEqual(failure.exception.code,404)
        self.assertEqual(job['state'],'awaiting_approval');self.assertEqual(self.service.access.mode,'normal')
        self.assertNotIn('file_action_commit',[m for m,k in self.runtime.calls])


if __name__=='__main__':unittest.main()
