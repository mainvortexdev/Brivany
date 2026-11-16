"""Private graceful lifecycle: auth, data flush, blockers and no force-kill."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock
from desktop.experience.lifecycle import Lifecycle
from desktop.experience.launcher import experience_handler
from desktop.management import process_identity,wait_stopped
from services.h1.server import Handler

class LifecycleTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.events=[];self.blockers=[];self.save_ok=True
  def save():self.events.append('save');return self.save_ok
  def spawn(*args,**kwargs):self.events.append('spawn');self.spawned=args[0]
  self.service=Lifecycle('http://127.0.0.1:5000',Path(self.temp.name),stop=lambda:self.events.append('stop'),save=save,launch_command=[str(Path(os.sys.executable).absolute())],busy=lambda:self.blockers,spawn=spawn);self.addCleanup(self.service.close);self.service.ready()
 def await_events(self,expected):
  end=time.monotonic()+2
  while time.monotonic()<end and self.events!=expected:time.sleep(.02)
  self.assertEqual(self.events,expected)
 def test_status_and_disk_do_not_expose_control_token(self):
  self.assertNotIn(self.service.token,json.dumps(self.service.status()));self.assertNotIn(self.service.token.encode(),self.service.vault.path.read_bytes());self.assertFalse(self.service.authenticate('wrong'));self.assertTrue(self.service.authenticate(self.service.token));self.assertEqual(self.service.vault.read()['started'],process_identity(os.getpid())['started'])
 def test_restart_saves_before_launching_wait_helper_and_closing(self):
  self.assertTrue(self.service.request('restart','workspace')['accepted']);self.await_events(['save','spawn','stop']);self.assertNotIn(self.service.token,' '.join(self.spawned));self.assertIn('desktop.distribution.restart',self.spawned);self.assertEqual(self.service.state,'stopping')
 def test_save_failure_leaves_program_running(self):
  self.save_ok=False;self.service.request('stop');end=time.monotonic()+2
  while time.monotonic()<end and not self.service.error:time.sleep(.02)
  self.assertEqual(self.events,['save']);self.assertEqual(self.service.state,'running');self.assertIsNotNone(self.service.error)
 def test_prepared_signed_update_uses_existing_updater_without_a_second_launcher(self):
  self.service.prepare_update=lambda:self.events.append('prepared_update') or True;self.service.request('restart');self.await_events(['save','prepared_update','stop'])
 def test_active_transfer_blocks_restart_without_calling_save_or_stop(self):
  self.blockers.append('file_transfer')
  with self.assertRaises(ValueError):self.service.request('restart')
  self.assertEqual(self.events,[])
 def test_close_does_not_delete_a_newer_instances_control_record(self):
  self.service.vault.write({'pid':os.getpid()+100,'token':'new-owner'});self.service.close();self.assertTrue(self.service.vault.path.exists())
 def test_pid_reuse_guard_never_waits_on_a_different_instance(self):
  self.assertTrue(wait_stopped(os.getpid(),'different-start-time',.1))
 def test_http_requires_management_capability_even_with_an_ordinary_browser(self):
  server=ThreadingHTTPServer(('127.0.0.1',0),experience_handler(Handler));server.daemon_threads=True;server.desktop_lifecycle=self.service;threading.Thread(target=server.serve_forever,daemon=True).start();self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
  def get(headers):
   connection=HTTPConnection('127.0.0.1',server.server_port,timeout=3);self.addCleanup(connection.close);connection.request('GET','/api/desktop/lifecycle',headers=headers);response=connection.getresponse();return response.status,response.read()
  self.assertEqual(get({})[0],403);self.assertEqual(get({'X-Brivany-Management':self.service.token,'Origin':'https://other.invalid'})[0],403);status,raw=get({'X-Brivany-Management':self.service.token});self.assertEqual(status,200);self.assertNotIn(self.service.token.encode(),raw)

if __name__=='__main__':unittest.main()
