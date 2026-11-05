"""Offline SDK substitutes: invocation/cancellation semantics, never GPU evidence."""
import hashlib
from pathlib import Path
import tempfile
import sqlite3
from contextlib import closing
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from services.spatial.dispatch import DispatchError, _canonical, validate_dispatch_record
from services.spatial.modal_transport import ModalTransport
from services.spatial.demo import make_glb
from workers.spatial_runtime import read_lock, validate_glb
import test_spatial_dispatch as fixtures
from test_spatial_worker import request


class ModalTransportTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        self.lock=read_lock();self.lock['remote_dispatch_enabled']=True;self.lock['deployment_verified']=True
        self.lock['runtime'].update(dependency_lock_complete=True,build_verified=True,cuda_compatibility_verified=True,
            base_image_digest='sha256:'+'b'*64,checkpoint_manifest=[{'path':'fake-only','sha256':'b'*64,'size_bytes':1}])
        self.lock['models']['sam3d_objects'].update(checkpoint_revision='b'*40,checkpoint_hashes_verified=True,license_reviewed_by_user=True)
        self.lock['budget']={'approved_total_usd':1.,'approved_per_job_usd':.5,'gpu_rate_usd_per_second':.001,'non_gpu_reserve_per_job_usd':.1}
        self.input=request();self.raw=make_glb([(0,0,[0,0,0],[1,1,1])]);self.call=Mock(object_id='fc-local-sdk-substitute')
        def spawn(value,*,expected_lock_sha256):
            self.assertEqual(expected_lock_sha256,hashlib.sha256(_canonical(self.lock)).hexdigest())
            self.call.get.return_value=self.result(value);return self.call
        self.function=Mock();self.function.spawn.side_effect=spawn
        self.sdk=SimpleNamespace(Function=SimpleNamespace(from_name=Mock(return_value=self.function)),
            FunctionCall=SimpleNamespace(from_id=Mock(return_value=self.call)),exception=SimpleNamespace(TimeoutError=TimeoutError))
        self.transport=ModalTransport(self.root,self.lock,sdk=self.sdk,sdk_version=self.lock['modal']['sdk_version'])

    def result(self,value):
        return {'status':'preview_unverified','provenance':'inferred','pipeline_version':self.lock['pipeline_version'],
            'source_capture_id':value['capture_id'],'source_frame_id':value['frame_id'],'cache_hit':False,
            'model_executed_this_call':True,'artifact_bytes':self.raw,'artifact':validate_glb(self.raw),'actual_billed_usd':'0.001'}

    def test_shipped_configuration_is_closed_without_sdk_auth_or_journal(self):
        closed=ModalTransport(self.root,read_lock(),sdk=self.sdk,sdk_version='1.6.3')
        self.assertFalse(closed.preflight()['configured'])
        with self.assertRaises(DispatchError):closed.execute(self.input)
        self.sdk.Function.from_name.assert_not_called();self.assertFalse(closed.path.exists())

    def test_success_spawns_once_checks_lock_and_never_invents_invoice(self):
        output=self.transport.execute(self.input)
        self.assertEqual(output.artifact_bytes,self.raw);self.assertTrue(output.model_executed);self.assertIsNone(output.actual_billed_usd)
        self.sdk.Function.from_name.assert_called_once_with('brivany-spatial','reconstruct_single_object')
        self.function.spawn.assert_called_once();self.assertEqual(self.transport.inspect(self.input['job_id'])['state'],'completed')
        saved=self.transport.path.read_bytes();self.assertNotIn(self.input['image_png'],saved)
        self.assertFalse(self.transport.inspect(self.input['job_id'])['actual_cost_known'])

    def test_restart_and_uncertain_submission_cannot_spawn_again(self):
        self.function.spawn.side_effect=RuntimeError('unknown network outcome')
        for instance in (self.transport,ModalTransport(self.root,self.lock,sdk=self.sdk,sdk_version='1.6.3')):
            with self.assertRaises(DispatchError):instance.execute(self.input)
        self.function.spawn.assert_called_once();self.assertEqual(self.transport.inspect(self.input['job_id'])['state'],'submission_unknown')

    def test_timeout_observes_same_call_without_cancel_or_relaunch(self):
        self.call.get.side_effect=TimeoutError()
        with patch('services.spatial.modal_transport.time.monotonic',side_effect=[0,0,1000]):
            with self.assertRaises(DispatchError) as error:self.transport.execute(self.input)
        self.assertEqual(error.exception.code,'modal_observation_timeout');self.function.spawn.assert_called_once();self.call.get.assert_called_once()
        self.call.cancel.assert_not_called();self.assertEqual(self.transport.inspect(self.input['job_id'])['state'],'observation_timeout')

    def test_cancel_targets_original_handle_and_does_not_claim_billing_stopped(self):
        checks=iter([False,True])
        with self.assertRaises(DispatchError):self.transport.execute(self.input,cancelled=lambda:next(checks))
        self.sdk.FunctionCall.from_id.assert_called_once_with(self.call.object_id)
        self.call.cancel.assert_called_once_with(terminate_containers=False);self.call.get.assert_not_called()
        report=self.transport.inspect(self.input['job_id']);self.assertFalse(report['actual_cost_known']);self.assertFalse(report['remote_stop_verified'])

    def test_cache_output_remains_inferred_but_does_not_claim_new_model_execution(self):
        result=self.result(self.input);result.update(cache_hit=True,model_executed_this_call=False)
        self.function.spawn.side_effect=None;self.function.spawn.return_value=self.call;self.call.get.return_value=result
        self.assertFalse(self.transport.execute(self.input).model_executed)

    def test_wrong_provenance_hash_or_capture_is_rejected(self):
        for changes in ({'source_capture_id':'other'},{'artifact':{'sha256':'b'*64}},{'provenance':'test_stub'},{'cache_hit':True}):
            with self.subTest(changes=list(changes)),tempfile.TemporaryDirectory() as folder:
                result=self.result(self.input);result.update(changes);self.call.get.return_value=result;self.function.spawn.side_effect=None;self.function.spawn.return_value=self.call
                transport=ModalTransport(folder,self.lock,sdk=self.sdk,sdk_version='1.6.3')
                with self.assertRaises(DispatchError):transport.execute(self.input)
                self.assertEqual(transport.inspect(self.input['job_id'])['state'],'invalid_result')

    def test_sdk_version_and_deployment_are_checked_before_network(self):
        wrong=ModalTransport(self.root,self.lock,sdk=self.sdk,sdk_version='not-pinned')
        with self.assertRaises(DispatchError):wrong.execute(self.input)
        self.sdk.Function.from_name.assert_not_called()

    def test_orchestrator_preserves_remote_provenance_unknown_cost_and_no_replay(self):
        fixture=fixtures.SpatialDispatchTests('test_duplicate_and_restart_do_not_reexecute_or_copy_inputs');fixture.setUp();self.addCleanup(fixture.doCleanups)
        fixture.config['deployment_verified']=True;fixture.lock_path.write_text(__import__('json').dumps(fixture.config))
        self.lock=fixture.config
        transport=ModalTransport(fixture.root,self.lock,sdk=self.sdk,sdk_version='1.6.3')
        service=fixture.coordinator(transport)
        first=fixture.submit(service);second=fixture.submit(service)
        self.assertEqual(first,second);self.assertEqual(first['state'],'completed_remote');self.assertEqual(first['origin'],'inferred')
        self.assertTrue(first['model_executed']);self.assertIsNone(first['external_calls']);self.assertIsNone(first['gpu_seconds']);self.assertFalse(first['actual_cost_known'])
        self.function.spawn.assert_called_once();self.assertEqual(fixture.budget.status()['unknown_count'],1)
        self.assertEqual(service.reconcile(first['job_id'],'0.020000')['state'],'completed_remote')
        with service._connect() as db:validate_dispatch_record(db.execute('SELECT * FROM dispatch_jobs').fetchone())
        from services.spatial.backup import _validate_modal_calls,BackupError
        documents={first['job_id']:service.inspect(first['job_id'])}
        # The backup validator needs the exact reservation, never a price guess.
        with closing(sqlite3.connect(fixture.budget.path)) as db:
            row=db.execute('SELECT job_id,reserved FROM reservations').fetchone()
        reservations={row[0]:{'reserved':row[1]}}
        _validate_modal_calls(fixture.root,{'modal-calls.sqlite3'},documents,reservations)
        with transport._db() as db:db.execute("UPDATE modal_calls SET call_id='invalid'")
        with self.assertRaises(BackupError):_validate_modal_calls(fixture.root,{'modal-calls.sqlite3'},documents,reservations)


if __name__=='__main__':unittest.main()
