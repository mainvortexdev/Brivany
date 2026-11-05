"""Synthetic local transport and exact toy tariff; no model, SDK, API or GPU."""
from copy import deepcopy
import hashlib
from io import BytesIO, StringIO
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
from uuid import uuid4

from services.spatial.budget import SpatialBudget, BudgetError
from services.spatial.demo import make_glb
from services.spatial.dispatch import SpatialDispatch, DispatchError, DispatchResult, preflight_package, validate_dispatch_record
from services.spatial.review import CaptureReviewService, CaptureReviewError, rectangle_mask
from tools.spatial_dispatch import main
from workers.spatial_runtime import read_lock, validate_request


class FakeTransport:
    simulation=True
    def __init__(self,action=None):self.calls=0;self.action=action
    def execute(self,request):
        self.calls+=1;validate_request(request)
        if self.action:return self.action(request)
        return DispatchResult(make_glb([(0,0,[0,0,0],[1,1,1])]),'0.000000')


class SpatialDispatchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.capture_id=str(uuid4());self.folder=self.root/'captures'/self.capture_id
        (self.folder/'frames').mkdir(parents=True)
        jpeg=b'\xff\xd8\xff\xc0'+struct.pack('>HBHHB',8,8,16,16,0)+b'\xff\xd9';digest=hashlib.sha256(jpeg).hexdigest()
        (self.folder/'frames/frame-0000.jpg').write_bytes(jpeg)
        manifest={'capture_id':self.capture_id,'source':{'filename':'synthetic.mp4','sha256':'a'*64,'size_bytes':40,
            'duration_seconds':1.0,'width':16,'height':16,'has_audio':False},'frames':[{'id':'frame-0000',
            'relative_path':'frames/frame-0000.jpg','at_seconds':.5,'width':16,'height':16,'sha256':digest}]}
        (self.folder/'capture.json').write_text(json.dumps(manifest),encoding='utf-8')
        self.reviews=CaptureReviewService(self.root)
        self.item={'id':'object-1','label':'Synthetic object','frame_id':'frame-0000','frame_sha256':digest,
            'rectangle':{'x':.25,'y':.25,'width':.5,'height':.5},'mask_reviewed':True}
        self.reviews.save(self.capture_id,{'expected_revision':0,'objects':[self.item],'length_reference':None})
        image=rectangle_mask(16,16,{'x':0,'y':0,'width':1,'height':1})
        with patch('services.spatial.review.shutil.which',return_value='ffmpeg'),patch('services.spatial.review._run',side_effect=lambda args,**kw:Path(args[-1]).write_bytes(image)):
            self.package=self.reviews.prepare(self.capture_id,{'expected_revision':1,'object_id':'object-1'})
        self.budget=SpatialBudget(self.root/'budget.sqlite3')
        # A synthetic test tariff, never a published Modal price.
        self.budget.configure(total_usd='1',per_job_usd='0.5',gpu_rate_usd_per_second='0.001',extra_reserve_usd='0.1')
        self.config=read_lock();self.config['remote_dispatch_enabled']=True
        self.config['runtime'].update(dependency_lock_complete=True,build_verified=True,cuda_compatibility_verified=True,
            base_image_digest='sha256:'+'b'*64,checkpoint_manifest=[{'path':'test-only','sha256':'b'*64,'size_bytes':1}])
        self.config['models']['sam3d_objects'].update(checkpoint_revision='b'*40,checkpoint_hashes_verified=True,license_reviewed_by_user=True)
        self.config['budget']={'approved_total_usd':1.0,'approved_per_job_usd':.5,'gpu_rate_usd_per_second':.001,'non_gpu_reserve_per_job_usd':.1}
        self.lock_path=self.root/'test-only.lock.json';self.lock_path.write_text(json.dumps(self.config))
        self.transport=FakeTransport();self.service=self.coordinator()

    def coordinator(self,transport=None,lock_path=None):
        return SpatialDispatch(self.root,self.reviews,self.budget,lock_path=lock_path or self.lock_path,transport=transport or self.transport)

    def preflight(self,**kwargs):
        return preflight_package(self.reviews,self.capture_id,self.package['package_id'],expected_revision=1,timeout_seconds=10,**kwargs)

    def submit(self,service=None,**kwargs):
        return (service or self.service).submit(self.capture_id,self.package['package_id'],expected_revision=1,timeout_seconds=10,execute=True,**kwargs)

    def test_preflight_is_stable_read_only_and_bytes_private(self):
        before=self.budget.path.read_bytes();first=self.preflight();second=self.preflight()
        self.assertEqual(first,second);self.assertEqual(self.budget.path.read_bytes(),before)
        self.assertFalse(first['configuration_ready']);self.assertFalse(first['reservation_created'])
        self.assertIn('remote_dispatch_disabled',first['pending']);self.assertNotIn('image_png',first)
        self.assertNotIn('mask_png',first);self.assertEqual(self.transport.calls,0)
        with self.service._connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM dispatch_jobs').fetchone()[0],0)

    def test_closed_gates_and_explicit_execute_precede_transport_and_reservation(self):
        closed=self.coordinator(lock_path=Path(__file__).resolve().parents[1]/'config/spatial-models.lock.json')
        with patch.object(self.budget,'reserve') as reserve:
            with self.assertRaises(DispatchError) as error:self.submit(closed)
            self.assertEqual(error.exception.code,'dispatch_not_configured');reserve.assert_not_called()
            with self.assertRaises(DispatchError):self.service.submit(self.capture_id,self.package['package_id'],expected_revision=1)
        self.assertEqual(self.transport.calls,0)
        no_transport=SpatialDispatch(self.root,self.reviews,self.budget,lock_path=self.lock_path)
        with self.assertRaises(DispatchError) as error:self.submit(no_transport)
        self.assertEqual(error.exception.code,'dispatch_transport_pending')

    def test_duplicate_and_restart_do_not_reexecute_or_copy_inputs(self):
        first=self.submit();second=self.submit();third=self.submit(self.coordinator())
        self.assertEqual(first,second);self.assertEqual(second,third);self.assertEqual(self.transport.calls,1)
        self.assertEqual(first['state'],'completed_test_stub');self.assertEqual(first['origin'],'test_stub')
        self.assertFalse(first['model_executed']);self.assertTrue(first['actual_cost_known'])
        artifact=self.root/first['artifact']['relative_path'];self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(),first['artifact']['sha256'])
        self.assertEqual(self.budget.status()['reserved_micro_usd'],0)
        with self.service._connect() as db:
            row=dict(db.execute('SELECT * FROM dispatch_jobs').fetchone());document=validate_dispatch_record(row)
            self.assertNotIn('image_png',document);self.assertNotIn('label',document)
            self.assertNotIn('Synthetic object',row['document'])

    def test_ambiguous_failure_holds_budget_and_never_replays_after_restart(self):
        def failure(_):raise RuntimeError('PRIVATE raw provider log key=do-not-persist')
        transport=FakeTransport(failure);service=self.coordinator(transport)
        first=self.submit(service);second=self.submit(self.coordinator(transport))
        self.assertEqual(first['state'],'failed_unknown');self.assertTrue(first['consumption_uncertain'])
        self.assertEqual(second,first);self.assertEqual(transport.calls,1)
        self.assertEqual(self.budget.status()['unknown_count'],1)
        with self.assertRaises(DispatchError) as error:self.submit(service,seed=1)
        self.assertEqual(error.exception.code,'dispatch_unresolved')
        self.assertNotIn('PRIVATE',self.service.database.read_bytes().decode('utf-8',errors='ignore'))
        settled=service.reconcile(first['job_id'],'0.020000');self.assertEqual(settled['state'],'failed_known')
        self.assertEqual(self.budget.status()['spent_usd'],'0.020000')

    def test_invalid_zip_stale_revision_or_unreviewed_mask_never_dispatch(self):
        self.reviews.save(self.capture_id,{'expected_revision':1,'objects':[self.item],'length_reference':None})
        with self.assertRaises(DispatchError):self.preflight()
        with self.assertRaises(DispatchError):preflight_package(self.reviews,self.capture_id,self.package['package_id'],expected_revision=2)
        item=deepcopy(self.item);item['mask_reviewed']=False
        self.reviews.save(self.capture_id,{'expected_revision':2,'objects':[item],'length_reference':None})
        with self.assertRaises(DispatchError):preflight_package(self.reviews,self.capture_id,self.package['package_id'],expected_revision=3)
        path=self.folder/'review/packages'/(self.package['package_id']+'.zip');path.write_bytes(b'corrupt')
        with self.assertRaises(CaptureReviewError):preflight_package(self.reviews,self.capture_id,self.package['package_id'],expected_revision=3)
        self.assertEqual(self.transport.calls,0)

    def test_frame_tamper_is_rejected_without_reserving(self):
        frame=self.folder/'frames/frame-0000.jpg';frame.write_bytes(b'changed')
        with self.assertRaises(CaptureReviewError):self.preflight()
        self.assertEqual(self.budget.status()['reserved_micro_usd'],0)

    def test_success_without_invoice_retains_hold_until_explicit_reconciliation(self):
        transport=FakeTransport(lambda _:DispatchResult(make_glb([(0,0,[0,0,0],[1,1,1])]),None))
        service=self.coordinator(transport);first=self.submit(service)
        self.assertEqual(first['state'],'completed_test_stub');self.assertTrue(first['consumption_uncertain'])
        self.assertEqual(self.budget.status()['unknown_count'],1)
        self.assertEqual(self.submit(self.coordinator(transport)),first);self.assertEqual(transport.calls,1)
        settled=service.reconcile(first['job_id'],'0.040000')
        self.assertFalse(settled['consumption_uncertain']);self.assertEqual(settled['actual_billed_usd'],'0.040000')

    def test_failure_across_start_boundary_is_not_released_or_replayed(self):
        update=self.service._update
        def fail_once(job_id,state,**changes):
            if state=='started':raise OSError('synthetic interrupted journal write')
            return update(job_id,state,**changes)
        with patch.object(self.service,'_update',side_effect=fail_once):
            with self.assertRaises(OSError):self.submit()
        self.assertEqual(self.transport.calls,0);self.assertEqual(self.budget.status()['unknown_count'],1)
        resumed=self.submit(self.coordinator());self.assertEqual(resumed['state'],'failed_unknown')
        self.assertFalse(resumed['replay_allowed']);self.assertEqual(self.transport.calls,0)

    def test_invalid_output_preserves_known_cost_and_never_publishes(self):
        transport=FakeTransport(lambda _:DispatchResult(b'not a glb','0.030000'))
        result=self.submit(self.coordinator(transport))
        self.assertEqual(result['state'],'failed_known');self.assertEqual(result['error_code'],'artifact_invalid')
        self.assertIsNone(result['artifact']);self.assertEqual(self.budget.status()['spent_usd'],'0.030000')
        self.assertFalse((self.root/'dispatch-artifacts').exists())

    def test_cancellation_during_transport_retains_unknown_then_reconciles(self):
        started=threading.Event();release=threading.Event();results=[]
        def action(_):started.set();release.wait(3);return DispatchResult(make_glb([(0,0,[0,0,0],[1,1,1])]),None)
        service=self.coordinator(FakeTransport(action));job_id=self.preflight(lock=self.config)['job_id']
        thread=threading.Thread(target=lambda:results.append(self.submit(service)));thread.start()
        self.assertTrue(started.wait(3))
        try:
            cancelled=self.coordinator().cancel(job_id);self.assertEqual(cancelled['state'],'cancelled_unknown')
            self.assertEqual(self.budget.status()['unknown_count'],1)
        finally:release.set();thread.join(3)
        self.assertFalse(thread.is_alive());self.assertEqual(results[0]['state'],'cancelled_unknown')
        self.assertIsNone(results[0]['artifact']);self.assertFalse((self.root/'dispatch-artifacts').exists())
        self.assertEqual(service.reconcile(job_id,'0.010000')['state'],'cancelled_known')

    def test_other_instance_cancellation_at_start_boundary_keeps_hold_and_skips_transport(self):
        other=self.coordinator();update=self.service._update
        def cancel_before_started(job_id,state,**changes):
            if state=='started':other.cancel(job_id)
            return update(job_id,state,**changes)
        with patch.object(self.service,'_update',side_effect=cancel_before_started):result=self.submit()
        self.assertEqual(result['state'],'cancelled_unknown');self.assertTrue(result['cancel_requested'])
        self.assertEqual(self.transport.calls,0);self.assertIsNone(result['artifact'])
        self.assertEqual(self.budget.status()['unknown_count'],1)

    def test_cli_never_installs_transport_or_spends_even_with_execute(self):
        before=self.budget.path.read_bytes()
        with patch('sys.stdout',new_callable=StringIO) as output:
            code=main(['--root',str(self.root),'--lock',str(self.lock_path),'submit',self.capture_id,
                self.package['package_id'],'--expected-revision','1','--execute'])
        self.assertEqual(code,2);self.assertIn('dispatch_transport_pending',output.getvalue())
        self.assertEqual(self.budget.path.read_bytes(),before);self.assertEqual(self.transport.calls,0)


if __name__=='__main__':unittest.main()
