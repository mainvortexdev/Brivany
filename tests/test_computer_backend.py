"""Tiny offline bundle fixtures and real child-process cancellation, no providers."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from services.computer import backend
from services.computer.runtime import NativeRuntime
from services.computer.models import run_compiler,compiler_command


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.source=self.root/'source';self.source.mkdir();self.output=self.root/'bundles'
        files={'electron/adapter.cjs':b'module.exports={fixture:true};','node_modules/electron/dist/electron.exe':b'synthetic-runtime-not-executed','node_modules/three/LICENSE':b'synthetic-notice'}
        for name,raw in files.items():
            path=self.source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        hashes={name:hashlib.sha256(raw).hexdigest() for name,raw in files.items()}
        self.source_lock={'files':{'electron/adapter.cjs':hashes.pop('electron/adapter.cjs')}}
        self.runtime_lock={'schema_version':1,'target':'win32-x64','versions':{'electron':'fixture','node':'fixture','three':'fixture'},'files':hashes}
        self.lock_patch=patch('services.computer.backend.locks',return_value=(self.source_lock,self.runtime_lock));self.lock_patch.start()
    def tearDown(self):self.lock_patch.stop();self.temp.cleanup()
    def build(self):return backend.build_bundle(self.source,self.output)
    def native_runtime(self,directory):
        with patch('services.computer.runtime.resolve_backend',return_value=backend.BackendLocation(Path(directory),'bundled')):
            return NativeRuntime(self.root/'workspace',proxy='http://127.0.0.1:1',token='synthetic-only')
    def test_only_pinned_files_and_licenses_are_copied_and_build_is_repeatable(self):
        (self.source/'.env').write_text('synthetic-secret');(self.source/'user-profile').mkdir();(self.source/'user-profile/conversation.txt').write_text('synthetic-private')
        first=self.build();second=self.build();self.assertEqual(first['id'],second['id']);directory=Path(first['directory'])
        self.assertEqual(first['file_count'],4);self.assertFalse((directory/'.env').exists());self.assertFalse((directory/'user-profile').exists())
        self.assertIn('Vortex Developer',(directory/'BRIVANY-NOTICE.txt').read_text())
        self.assertEqual(backend.verify_bundle(directory)['target'],'win32-x64')
    def test_cached_verification_rejects_payload_tampering_and_new_files(self):
        result=self.build();directory=Path(result['directory']);backend.verify_bundle(directory)
        (directory/'stray.dll').write_bytes(b'undeclared')
        with self.assertRaises(backend.BackendError):backend.verify_bundle(directory)
        (directory/'stray.dll').unlink();file=directory/'electron/adapter.cjs';raw=file.read_bytes();file.write_bytes(b'X'*len(raw))
        with self.assertRaises(backend.BackendError):backend.verify_bundle(directory)
    def test_status_polls_share_one_recent_bundle_verification(self):
        runtime=self.native_runtime(self.build()['directory'])
        with patch('services.computer.runtime.verify_bundle',wraps=backend.verify_bundle) as verify:
            with ThreadPoolExecutor(max_workers=6) as pool:
                statuses=list(pool.map(lambda _:runtime.availability(),range(24)))
            self.assertTrue(all(status['source_lock_matches'] for status in statuses))
            self.assertEqual(verify.call_count,1)
    def test_status_cache_expires_and_manifest_changes_refresh_immediately(self):
        directory=Path(self.build()['directory']);runtime=self.native_runtime(directory)
        with patch('services.computer.runtime.verify_bundle',wraps=backend.verify_bundle) as verify:
            with patch('services.computer.runtime.time.monotonic',side_effect=[0,29,31]):
                for _ in range(3):self.assertTrue(runtime.availability()['source_lock_matches'])
            self.assertEqual(verify.call_count,2)
            file=directory/'bundle-manifest.json';file.write_bytes(file.read_bytes()+b'\n')
            with patch('services.computer.runtime.time.monotonic',return_value=32):
                self.assertTrue(runtime.availability()['source_lock_matches'])
            self.assertEqual(verify.call_count,3)
    def test_native_start_rejects_changed_payload_despite_recent_available_status(self):
        directory=Path(self.build()['directory']);runtime=self.native_runtime(directory)
        self.assertTrue(runtime.availability()['source_lock_matches'])
        file=directory/'electron/adapter.cjs';raw=file.read_bytes();file.write_bytes(b'X'*len(raw))
        with patch('services.computer.runtime.subprocess.Popen') as spawn:
            with self.assertRaisesRegex(ValueError,'no está disponible'):runtime.start()
            spawn.assert_not_called()
    def test_native_call_rechecks_new_files_before_sending_work(self):
        directory=Path(self.build()['directory']);runtime=self.native_runtime(directory)
        self.assertTrue(runtime.availability()['source_lock_matches'])
        (directory/'electron/undeclared.dll').write_bytes(b'synthetic extra file')
        with patch.object(runtime,'start'),patch.object(runtime,'cancel') as cancel:
            with self.assertRaisesRegex(ValueError,'cambió durante la sesión'):runtime.call('query_windows')
            cancel.assert_called_once_with()
    def test_manifest_cannot_redefine_pinned_hashes(self):
        result=self.build();directory=Path(result['directory']);file=directory/'bundle-manifest.json';value=json.loads(file.read_text())
        value['files']['electron/adapter.cjs']['sha256']='0'*64;file.write_bytes(backend.canonical(value))
        with self.assertRaises(backend.BackendError):backend.verify_bundle(directory)
    def test_failed_build_never_activates_or_leaves_stage(self):
        result=self.build();backend.activate_bundle(result['directory'],self.output);pointer=(self.output/'active.json').read_bytes()
        (self.source/'electron/adapter.cjs').write_text('changed source')
        with self.assertRaises(backend.BackendError):self.build()
        self.assertEqual(pointer,(self.output/'active.json').read_bytes());self.assertFalse(list(self.output.glob('stage-*')))
    def test_activated_bundle_preferred_and_bad_pointer_never_falls_back(self):
        result=self.build();backend.activate_bundle(result['directory'],self.output)
        selected=backend.resolve_backend(bundle_root=self.output,environ={});self.assertEqual(selected.mode,'bundled');self.assertEqual(selected.source,Path(result['directory']))
        (self.output/'active.json').write_text('{"schema_version":1,"id":"../../elsewhere"}')
        bad=backend.resolve_backend(bundle_root=self.output,environ={});self.assertEqual(bad.mode,'bundled');self.assertIsNotNone(bad.error)
        explicit=backend.resolve_backend(source=self.source,bundle_root=self.output,environ={});self.assertEqual(explicit.mode,'development')
    def test_missing_manifest_of_bundle_cannot_be_treated_as_development_source(self):
        result=self.build();directory=Path(result['directory']);(directory/'bundle-manifest.json').unlink()
        with self.assertRaises(OSError):backend.verify_source(directory)
    def test_path_traversal_never_enters_bundle(self):
        for rel in ('../secret','/secret','C:/secret','node_modules/../secret','node_modules\\secret'):
            with self.assertRaises(backend.BackendError):backend.plain_path(self.source,rel)
    def test_links_never_enter_bundle(self):
        file=self.source/'electron/adapter.cjs';file.unlink()
        try:file.symlink_to(self.source/'node_modules/three/LICENSE')
        except OSError:self.skipTest('Creating symlinks is unavailable for this Windows account.')
        with self.assertRaises(backend.BackendError):self.build()
    def test_runtime_children_do_not_receive_provider_or_session_credentials(self):
        with patch.dict(os.environ,{'BRIVANY_META_API_KEY':'fixture','AWS_SECRET_ACCESS_KEY':'fixture','SESSION_TOKEN':'fixture','PASSWORD':'fixture','SYSTEMROOT':'system-fixture','ELECTRON_RUN_AS_NODE':'1'}):
            env=backend.child_environment()
        for key in ('BRIVANY_META_API_KEY','AWS_SECRET_ACCESS_KEY','SESSION_TOKEN','PASSWORD','ELECTRON_RUN_AS_NODE'):self.assertNotIn(key,env)
        self.assertEqual(env['SYSTEMROOT'],'system-fixture')
    @unittest.skipUnless(os.name=='nt','Windows bundled compiler selection')
    def test_bundled_compiler_uses_electron_node_without_system_node(self):
        result=self.build()
        with patch('services.computer.models.shutil.which',side_effect=AssertionError('No system Node expected')):
            command,env=compiler_command(result['directory'])
        self.assertEqual(Path(command[0]),Path(result['directory'])/'node_modules/electron/dist/electron.exe');self.assertEqual(env['ELECTRON_RUN_AS_NODE'],'1')


class CompilerCancellationTests(unittest.TestCase):
    def test_cancellation_stops_own_compiler_process_promptly(self):
        with tempfile.TemporaryDirectory() as temp:
            started=Path(temp)/'started';cancelled=threading.Event();outcomes=[];children=[];real_popen=subprocess.Popen
            def capture(*args,**kwargs):
                child=real_popen(*args,**kwargs);children.append(child);return child
            def run():
                try:run_compiler([sys.executable,'-c',"import pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text('ready');time.sleep(20)",str(started)],backend.child_environment(),'X'*512000,cancelled)
                except Exception as error:outcomes.append(error)
            with patch('services.computer.models.subprocess.Popen',side_effect=capture):
                thread=threading.Thread(target=run);thread.start();deadline=time.monotonic()+5
                while not started.exists() and time.monotonic()<deadline:time.sleep(.01)
                self.assertTrue(started.exists());stamp=time.monotonic();cancelled.set();thread.join(3)
            self.assertFalse(thread.is_alive());self.assertLess(time.monotonic()-stamp,3);self.assertIsInstance(outcomes[0],ValueError);self.assertIsNotNone(children[0].poll())
    def test_already_cancelled_model_never_spawns_compiler(self):
        cancelled=threading.Event();cancelled.set()
        with patch('services.computer.models.subprocess.Popen') as spawn:
            with self.assertRaises(ValueError):run_compiler(['unused'],{},'{}',cancelled)
            spawn.assert_not_called()
    def test_compile_timeout_terminates_without_retry(self):
        with self.assertRaisesRegex(ValueError,'agotó el tiempo'):
            run_compiler([sys.executable,'-c','import time;time.sleep(20)'],backend.child_environment(),'{}',threading.Event(),timeout=.2)


if __name__=='__main__':unittest.main()
