"""Real OS lock and activation, isolated name; no UI, microphone or network."""
import json
import os
import subprocess
import sys
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4
from desktop.experience.single_instance import DesktopInstance


class DesktopInstanceTests(unittest.TestCase):
    def test_secondary_process_activates_existing_instance_and_can_restart_after_close(self):
        name='Brivany.Test.'+uuid4().hex;seen=[];event=threading.Event()
        def activated(workspace):seen.append(workspace);event.set()
        with DesktopInstance(name) as first:
            self.assertTrue(first.primary);first.listen(activated)
            with DesktopInstance(name) as local_secondary:
                self.assertFalse(local_secondary.primary);self.assertTrue(local_secondary.activate(workspace=True));self.assertTrue(event.wait(3))
            script="from desktop.experience.single_instance import DesktopInstance; import sys,json;\nwith DesktopInstance(sys.argv[1]) as guard: print(json.dumps({'primary':guard.primary,'activated':guard.activate(workspace=sys.argv[2]=='workspace')}))"
            for mode,expected in [('workspace',True),('open',False)]:
                event.clear();result=subprocess.run([sys.executable,'-B','-c',script,name,mode],check=True,capture_output=True,text=True,timeout=8,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                self.assertEqual(json.loads(result.stdout),{'primary':False,'activated':True});self.assertTrue(event.wait(3));self.assertEqual(seen[-1],expected)
        with DesktopInstance(name) as reopened:self.assertTrue(reopened.primary)

    def test_concurrent_openings_elect_exactly_one_primary(self):
        name='Brivany.Test.'+uuid4().hex;barrier=threading.Barrier(8);results=[]
        def race():
            with DesktopInstance(name) as guard:
                results.append(guard.primary);barrier.wait(timeout=5)
        threads=[threading.Thread(target=race) for _ in range(8)]
        for thread in threads:thread.start()
        for thread in threads:thread.join(6)
        self.assertEqual(results.count(True),1);self.assertEqual(len(results),8)

    def test_concurrent_workspace_requests_create_only_one_set_of_windows(self):
        from desktop.experience.work import WorkBridge
        class Event:
            def __iadd__(self,callback):return self
        titles=[];bridge=WorkBridge();bridge._trusted=lambda:None;bridge._base='http://127.0.0.1:1'
        bridge._work_factory=lambda:SimpleNamespace(start=lambda:None);bridge._sync_work=lambda:None;bridge._window=SimpleNamespace(hide=lambda:None)
        def create(title,*args,**kwargs):
            titles.append(title);time.sleep(.02)
            return SimpleNamespace(events=SimpleNamespace(loaded=Event(),closed=Event()),hide=lambda:None,evaluate_js=lambda script:None)
        with patch('webview.create_window',create),patch('webview.screens',[]):
            threads=[threading.Thread(target=bridge.start_work) for _ in range(8)]
            for thread in threads:thread.start()
            for thread in threads:thread.join(3)
        self.assertEqual(titles.count('Melodi WorkSpace'),1);self.assertEqual(len(titles),3)
