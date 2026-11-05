"""Durable room dispatch with actual SQLite/files and a substituted Modal SDK."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from io import BytesIO
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from uuid import uuid4

from PIL import Image

from services.spatial.budget import SpatialBudget,BudgetError
from services.spatial.jobs import SpatialService
from services.spatial.room import RoomPreparationService
from services.spatial.room_dispatch import RoomDispatch,RoomDispatchResult,RoomDispatchError,completed_room_dispatch,validate_room_dispatch_record,validate_surface,validate_room_glb
from services.spatial.room_modal_transport import RoomModalTransport
from tests.test_spatial_room import predictions
from workers.spatial_room import read_room_lock,build_surface,canonical


class RoomDispatchTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.folder=Path(self.temporary.name);self.root=self.folder/'spatial'
        self.spatial=SpatialService(self.root,start_worker=False,seed_demo=False);self.addCleanup(self.spatial.close)
        self.capture=str(uuid4());folder=self.root/'captures'/self.capture;(folder/'frames').mkdir(parents=True)
        frames=[]
        for index,color in enumerate(((80,100,120),(140,120,100))):
            stream=BytesIO();Image.new('RGB',(8,6),color).save(stream,format='JPEG');raw=stream.getvalue();relative=f'frames/frame-{index:04}.jpg';(folder/relative).write_bytes(raw)
            frames.append({'id':f'frame-{index:04}','relative_path':relative,'at_seconds':.5+index,'width':8,'height':6,'sha256':hashlib.sha256(raw).hexdigest()})
        self.manifest={'capture_id':self.capture,'source':{'filename':'synthetic.mp4','sha256':'a'*64,'size_bytes':40,'duration_seconds':3.,'width':8,'height':6,'has_audio':False},'frames':frames}
        (folder/'capture.json').write_bytes(canonical(self.manifest))
        self.payload={'expected_source_sha256':'a'*64,'frame_ids':[item['id'] for item in frames],'reviewed':True,'parameters':{'sample_stride':1},'timeout_seconds':10}
        self.preparation=RoomPreparationService(self.spatial);self.budget=SpatialBudget(self.root/'budget.sqlite3')
        self.budget.configure(total_usd='1',per_job_usd='.5',gpu_rate_usd_per_second='.001',extra_reserve_usd='.1')
        self.config=read_room_lock();self.config.update(remote_dispatch_enabled=True,deployment_verified=True)
        self.config['runtime'].update(dependency_lock_complete=True,build_verified=True,cuda_compatibility_verified=True,
            base_image_digest='sha256:'+'b'*64,checkpoint_manifest=[{'path':'model.safetensors','sha256':'b'*64,'size_bytes':1}])
        self.config['model'].update(checkpoint_hashes_verified=True,license_reviewed_by_user=True,access_granted_by_provider=True)
        self.config['budget']={'approved_total_usd':1.,'approved_per_job_usd':.5,'gpu_rate_usd_per_second':.001,'non_gpu_reserve_per_job_usd':.1}
        self.lock_path=self.folder/'synthetic-room.lock.json';self.lock_path.write_bytes(canonical(self.config))
        self.function=Mock();self.call=SimpleNamespace(object_id='fc-synthetic-room-test',get=Mock(side_effect=lambda **_:self.remote(self.last_request)))
        def spawn(request,**_):self.last_request=request;return self.call
        self.function.spawn.side_effect=spawn;self.cancel_call=Mock()
        self.sdk=SimpleNamespace(Function=SimpleNamespace(from_name=Mock(return_value=self.function)),
            FunctionCall=SimpleNamespace(from_id=Mock(return_value=SimpleNamespace(cancel=self.cancel_call))),
            exception=SimpleNamespace(TimeoutError=TimeoutError))
        self.transport=RoomModalTransport(self.root,self.config,sdk=self.sdk,sdk_version=self.config['modal']['sdk_version'])
        self.dispatch=RoomDispatch(self.root,self.preparation,self.budget,lock_path=self.lock_path,transport=self.transport)

    def remote(self,request):
        result=build_surface(predictions(),request['parameters'],request['frames'])
        return {**result,'status':'preview_unverified','provenance':'inferred','pipeline_version':self.config['pipeline_version'],
            'source_capture_id':request['capture_id'],'source_sha256':request['source_sha256'],
            'source_frames':[{key:value for key,value in frame.items() if key!='image_png'} for frame in request['frames']],
            'cache_hit':False,'model_executed_this_call':True,'actual_billed_usd':'999.000000'}

    def submit(self,**changes):return self.dispatch.submit(self.capture,{**self.payload,**changes},execute=True)

    def test_preflight_and_inspection_do_not_create_a_dispatch_or_call_journal(self):
        before=set(self.root.iterdir());plan=self.dispatch.preflight(self.capture,self.payload)
        self.assertFalse(plan['reservation_created']);self.assertEqual(set(self.root.iterdir()),before)
        self.assertFalse((self.root/'room-dispatch.sqlite3').exists());self.assertFalse((self.root/'room-modal-calls.sqlite3').exists())
        self.assertEqual(self.dispatch.list_results(self.capture)['items'],[])
        with self.assertRaises(RoomDispatchError):self.dispatch.inspect(str(uuid4()))
        self.sdk.Function.from_name.assert_not_called()

    def test_shipped_lock_no_execution_or_missing_explicit_authorization_never_reserves(self):
        with self.assertRaises(RoomDispatchError):self.dispatch.submit(self.capture,self.payload)
        closed=RoomDispatch(self.root,self.preparation,self.budget,transport=self.transport)
        with self.assertRaises(RoomDispatchError):closed.submit(self.capture,self.payload,execute=True)
        self.assertEqual(self.budget.status()['reserved_micro_usd'],0);self.sdk.Function.from_name.assert_not_called()

    def test_remote_result_journals_exact_cameras_hashes_unknown_billing_and_duplicate_no_replay(self):
        result=self.submit();self.assertEqual(result['state'],'completed_remote');self.assertEqual(result['origin'],'inferred')
        self.assertIsNone(result['actual_billed_usd']);self.assertFalse(result['actual_cost_known']);self.assertIsNone(result['external_calls'])
        self.assertEqual(self.budget.status()['unknown_count'],1)
        asset=self.root/result['artifact']['relative_path'];surface=self.root/result['surface_manifest']['relative_path']
        self.assertEqual(hashlib.sha256(asset.read_bytes()).hexdigest(),result['artifact']['sha256'])
        self.assertEqual(hashlib.sha256(surface.read_bytes()).hexdigest(),result['surface_manifest']['sha256'])
        metadata=json.loads(surface.read_bytes());self.assertEqual(metadata['cameras'][1]['frame_id'],'frame-0001')
        self.assertFalse(metadata['uncertainty']['holes_filled']);self.assertNotIn('image_png',surface.read_text())
        self.sdk.Function.from_name.assert_called_once_with('brivany-spatial-room','reconstruct_room')
        self.assertEqual(self.submit()['job_id'],result['job_id']);self.function.spawn.assert_called_once()
        complete=completed_room_dispatch(self.root,result['job_id']);self.assertEqual(complete['identity_sha256'],result['identity_sha256'])
        with self.assertRaises(BudgetError):self.budget.reserve(str(uuid4()),'.001')

    def test_explicit_test_stub_remains_separate_and_cannot_claim_a_remote_room(self):
        def execute(request):
            result=self.remote(request);return RoomDispatchResult(result['artifact_bytes'],result['surface'],'0.000000',True)
        stub=SimpleNamespace(simulation=True,execute=execute)
        dispatch=RoomDispatch(self.root,self.preparation,self.budget,lock_path=self.lock_path,transport=stub)
        result=dispatch.submit(self.capture,self.payload,execute=True)
        self.assertEqual(result['state'],'completed_test_stub');self.assertEqual(result['origin'],'test_stub');self.assertFalse(result['model_executed'])
        self.assertEqual(result['external_calls'],0)
        with self.assertRaises(RoomDispatchError):completed_room_dispatch(self.root,result['job_id'])

    def test_unknown_submission_survives_restart_without_another_spawn_or_releasing_hold(self):
        self.function.spawn.side_effect=TimeoutError('provider-submission-uncertain')
        first=self.submit();self.assertEqual(first['state'],'failed_unknown');self.assertEqual(self.budget.status()['unknown_count'],1)
        reopened=RoomDispatch(self.root,self.preparation,self.budget,lock_path=self.lock_path,transport=self.transport)
        second=reopened.submit(self.capture,self.payload,execute=True)
        self.assertEqual(second['job_id'],first['job_id']);self.function.spawn.assert_called_once()
        self.assertEqual(self.transport.inspect(first['job_id'])['state'],'submission_unknown')
        with self.assertRaises(RoomDispatchError):self.submit(seed=1)

    def test_completed_and_timeout_observation_reuses_same_functioncall(self):
        calls=[]
        def get(**kwargs):
            calls.append(kwargs)
            if len(calls)==1:raise TimeoutError()
            return self.remote(self.last_request)
        self.call.get.side_effect=get;result=self.submit()
        self.assertEqual(result['state'],'completed_remote');self.assertEqual(len(calls),2);self.function.spawn.assert_called_once()

    def test_invalid_camera_or_changed_input_output_keeps_unknown_hold_and_no_artefacts(self):
        def invalid(**_):
            result=self.remote(self.last_request);result['surface']['cameras'][1]['at_seconds']=5;return result
        self.call.get.side_effect=invalid;result=self.submit()
        self.assertEqual(result['state'],'failed_unknown');self.assertIsNone(result['artifact']);self.assertFalse((self.root/'room-artifacts').exists())
        self.assertEqual(self.transport.inspect(result['job_id'])['state'],'invalid_result')

    def test_cancellation_from_second_instance_calls_original_id_and_suppresses_publication(self):
        started=threading.Event();release=threading.Event()
        def get(**_):started.set();release.wait(5);return self.remote(self.last_request)
        self.call.get.side_effect=get;job=self.dispatch.preflight(self.capture,self.payload)['job_id']
        other_transport=RoomModalTransport(self.root,self.config,sdk=self.sdk,sdk_version=self.config['modal']['sdk_version'])
        other=RoomDispatch(self.root,self.preparation,self.budget,lock_path=self.lock_path,transport=other_transport)
        with ThreadPoolExecutor(max_workers=1) as pool:
            running=pool.submit(self.submit);self.assertTrue(started.wait(3))
            stopped=other.cancel(job,remote=True);release.set();result=running.result(5)
        self.assertEqual(stopped['state'],'cancelled_unknown');self.assertEqual(result['state'],'cancelled_unknown');self.assertIsNone(result['artifact'])
        self.sdk.FunctionCall.from_id.assert_called_with('fc-synthetic-room-test');self.cancel_call.assert_called_once_with(terminate_containers=False)
        self.assertFalse((self.root/'room-artifacts').exists());self.assertEqual(self.budget.status()['unknown_count'],1)

    def test_operator_reconciliation_is_explicit_and_does_not_repeat_provider(self):
        result=self.submit();known=self.dispatch.reconcile(result['job_id'],'.015000')
        self.assertEqual(known['actual_billed_usd'],'0.015000');self.assertEqual(known['state'],'completed_remote')
        self.assertEqual(self.budget.status()['unknown_count'],0);self.function.spawn.assert_called_once()
        self.assertEqual(completed_room_dispatch(self.root,result['job_id'])['actual_billed_usd'],'0.015000')
        with self.assertRaises(RoomDispatchError):self.dispatch.reconcile(result['job_id'],'.020000')

    def test_two_instances_submit_one_durable_identity_and_never_spawn_twice(self):
        other=RoomDispatch(self.root,self.preparation,self.budget,lock_path=self.lock_path,transport=self.transport)
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda service:service.submit(self.capture,self.payload,execute=True),[self.dispatch,other]))
        self.assertEqual(results[0]['job_id'],results[1]['job_id']);self.function.spawn.assert_called_once()

    def test_corrupted_identity_and_lost_original_modal_receipt_fail_corroboration(self):
        result=self.submit()
        with self.dispatch._db() as db:
            row=dict(db.execute('SELECT * FROM room_dispatch_jobs').fetchone());value=json.loads(row['document']);value['source_frames'][1]['at_seconds']=2.5;row['document']=value
            with self.assertRaises(RoomDispatchError):validate_room_dispatch_record(row)
        with self.transport._db() as db:db.execute("UPDATE modal_calls SET state='result_unknown'")
        with self.assertRaises(RoomDispatchError):completed_room_dispatch(self.root,result['job_id'])

    def test_surface_manifest_cannot_claim_different_mesh_counts_or_positions(self):
        plan=self.preparation.prepare(self.capture,self.payload,reserved_usd=.11,lock=self.config)
        result=self.remote(plan['request']);surface=deepcopy(result['surface']);surface['vertex_count']+=1
        with self.assertRaises(RoomDispatchError):validate_room_glb(result['artifact_bytes'],surface)
        surface=deepcopy(result['surface']);surface['bounds']['max'][0]+=2
        with self.assertRaises(RoomDispatchError):validate_room_glb(result['artifact_bytes'],surface)
        import struct
        raw=result['artifact_bytes'];length=struct.unpack('<I',raw[12:16])[0];model=json.loads(raw[20:20+length]);binary=raw[28+length:]
        accessor=model['accessors'][model['meshes'][0]['primitives'][0]['attributes']['POSITION']]
        accessor['max'][0]+=2
        document=canonical(model);document+=b' '*((-len(document))%4)
        altered=struct.pack('<III',0x46546c67,2,28+len(document)+len(binary))+struct.pack('<II',len(document),0x4e4f534a)+document+struct.pack('<II',len(binary),0x004e4942)+binary
        # Matching false bounds in accessor and sidecar are still inconsistent
        # with the actual position bytes and cannot pass together.
        with self.assertRaises(RoomDispatchError):validate_room_glb(altered,surface)

    def test_cli_preflight_and_inspect_preserve_absence_of_new_journals(self):
        from contextlib import redirect_stdout
        from tools.room_dispatch import main
        from io import StringIO
        buffer=StringIO();before=set(self.root.iterdir())
        with redirect_stdout(buffer):
            code=main(['--root',str(self.root),'--lock',str(self.lock_path),'preflight',self.capture,
                '--source-sha256','a'*64,'--frame','frame-0000','--frame','frame-0001','--reviewed'])
        self.assertEqual(code,0);self.assertFalse(json.loads(buffer.getvalue())['reservation_created']);self.assertEqual(set(self.root.iterdir()),before)
        with redirect_stdout(StringIO()):code=main(['--root',str(self.root),'inspect',str(uuid4())])
        self.assertEqual(code,2);self.assertEqual(set(self.root.iterdir()),before)

    def test_corrupt_glb_result_is_rejected_without_publishing_or_fake_zero_cost(self):
        def corrupt(**_):
            value=self.remote(self.last_request);value['artifact_bytes']=b'not-a-glb';return value
        self.call.get.side_effect=corrupt;result=self.submit()
        self.assertEqual(result['state'],'failed_unknown');self.assertIsNone(result['artifact']);self.assertIsNone(result['actual_billed_usd'])
        self.assertEqual(self.transport.inspect(result['job_id'])['state'],'invalid_result');self.assertEqual(self.budget.status()['unknown_count'],1)
        self.assertFalse((self.root/'room-artifacts').exists())

    def test_observation_expiry_never_resubmits_or_implies_remote_stop(self):
        with patch('services.spatial.room_modal_transport.time.monotonic',side_effect=[0,1000]):result=self.submit()
        self.assertEqual(result['state'],'failed_unknown');self.assertEqual(self.transport.inspect(result['job_id'])['state'],'observation_timeout')
        self.call.get.assert_not_called();self.function.spawn.assert_called_once();self.cancel_call.assert_not_called()
        self.assertEqual(self.submit()['job_id'],result['job_id']);self.function.spawn.assert_called_once()

    def test_new_capture_has_new_identity_but_waits_for_unknown_previous_consumption(self):
        previous=self.submit();capture=str(uuid4());folder=self.root/'captures'/capture;(folder/'frames').mkdir(parents=True)
        manifest=deepcopy(self.manifest);manifest['capture_id']=capture;manifest['source']['sha256']='b'*64
        for frame in manifest['frames']:
            (folder/frame['relative_path']).write_bytes((self.root/'captures'/self.capture/frame['relative_path']).read_bytes())
        (folder/'capture.json').write_bytes(canonical(manifest));payload={**self.payload,'expected_source_sha256':'b'*64}
        next_plan=self.dispatch.preflight(capture,payload);self.assertNotEqual(next_plan['job_id'],previous['job_id'])
        with self.assertRaises(BudgetError):self.dispatch.submit(capture,payload,execute=True)
        self.function.spawn.assert_called_once()
        self.dispatch.reconcile(previous['job_id'],'.015000')
        # The known billing blocker does not consume a new intent. The same
        # capture and exact parameters can be explicitly submitted afterwards.
        current=self.dispatch.submit(capture,payload,execute=True)
        self.assertEqual(current['state'],'completed_remote');self.assertEqual(current['source_sha256'],'b'*64)
        self.assertNotEqual(current['job_id'],previous['job_id']);self.assertEqual(self.function.spawn.call_count,2)

    def test_display_graph_cannot_transform_or_duplicate_the_declared_surface(self):
        import struct
        prepared=self.preparation.prepare(self.capture,self.payload,reserved_usd=.11,lock=self.config);result=self.remote(prepared['request'])
        raw=result['artifact_bytes'];length=struct.unpack('<I',raw[12:16])[0];original=json.loads(raw[20:20+length]);binary=raw[28+length:]
        for change in ('translated','duplicated','extension'):
            model=deepcopy(original)
            if change=='translated':model['nodes'][0]['translation']=[100,0,0]
            elif change=='duplicated':model['nodes'].append({'mesh':0});model['scenes'][0]['nodes'].append(1)
            else:model['extensionsUsed']=['KHR_draco_mesh_compression']
            document=canonical(model);document+=b' '*((-len(document))%4)
            altered=struct.pack('<III',0x46546c67,2,28+len(document)+len(binary))+struct.pack('<II',len(document),0x4e4f534a)+document+struct.pack('<II',len(binary),0x004e4942)+binary
            with self.subTest(change=change),self.assertRaises(RoomDispatchError):validate_room_glb(altered,result['surface'])

    def test_surface_rejects_nonrigid_inconsistent_cameras_and_boolean_numeric_fields(self):
        prepared=self.preparation.prepare(self.capture,self.payload,reserved_usd=.11,lock=self.config);result=self.remote(prepared['request'])
        changes=[lambda surface:surface['cameras'][0]['world_to_camera_opencv'][0].__setitem__(0,2),
            lambda surface:surface['cameras'][0]['camera_to_viewer'][0].__setitem__(3,100),
            lambda surface:surface.__setitem__('requested_stride',True),
            lambda surface:surface['frames'][0].__setitem__('invalid_depth_or_confidence_pixels',100000)]
        for index,change in enumerate(changes):
            surface=deepcopy(result['surface']);change(surface)
            with self.subTest(change=index),self.assertRaises(RoomDispatchError):validate_surface(surface,prepared['request']['frames'])

    def test_cancellation_while_preparing_releases_known_unstarted_reservation(self):
        prepare=self.preparation.prepare;calls=[];job=self.dispatch.preflight(self.capture,self.payload)['job_id']
        other=RoomDispatch(self.root,self.preparation,self.budget,lock_path=self.lock_path,transport=self.transport)
        def cancel_during(capture,payload,**options):
            value=prepare(capture,payload,**options);calls.append(1)
            if options.get('reserved_usd') is not None:other.cancel(job)
            return value
        with patch.object(self.preparation,'prepare',side_effect=cancel_during):result=self.submit()
        self.assertEqual(result['state'],'cancelled_before_start');self.assertTrue(result['cancel_requested'])
        self.assertEqual(self.budget.status()['unknown_count'],0);self.assertEqual(self.budget.status()['reserved_micro_usd'],0)
        self.function.spawn.assert_not_called()

    def test_cancelled_live_result_cannot_overwrite_an_explicit_invoice_reconciliation(self):
        started=threading.Event();release=threading.Event();job=self.dispatch.preflight(self.capture,self.payload)['job_id']
        other=RoomDispatch(self.root,self.preparation,self.budget,lock_path=self.lock_path,transport=self.transport)
        def get(**_):started.set();release.wait(5);return self.remote(self.last_request)
        self.call.get.side_effect=get
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(self.submit);self.assertTrue(started.wait(3));other.cancel(job)
            invoice=other.reconcile(job,'.017000');self.assertEqual(invoice['state'],'cancelled_known')
            release.set();result=future.result(5)
        self.assertEqual(result['state'],'cancelled_known');self.assertEqual(result['actual_billed_usd'],'0.017000')
        self.assertIsNone(result['artifact']);self.assertEqual(self.budget.status()['spent_micro_usd'],17000)
        self.assertEqual(self.budget.status()['unknown_count'],0);self.function.spawn.assert_called_once()

    def test_cancellation_and_publication_linearize_in_the_shared_journal(self):
        from services.spatial.review import _publish
        publishing=threading.Event();cancel_attempt=threading.Event();release=threading.Event()
        job=self.dispatch.preflight(self.capture,self.payload)['job_id']
        other=RoomDispatch(self.root,self.preparation,self.budget,lock_path=self.lock_path,transport=self.transport)
        def delayed(path,raw):
            if path.suffix=='.glb':publishing.set();release.wait(5)
            return _publish(path,raw)
        def cancel():cancel_attempt.set();return other.cancel(job)
        with patch('services.spatial.room_dispatch._publish',side_effect=delayed),ThreadPoolExecutor(max_workers=2) as pool:
            future=pool.submit(self.submit);self.assertTrue(publishing.wait(3));stop=pool.submit(cancel)
            self.assertTrue(cancel_attempt.wait(2));release.set();result=future.result(5);cancelled=stop.result(5)
        self.assertEqual(result['state'],'completed_remote');self.assertFalse(result['cancel_requested'])
        self.assertEqual(cancelled['state'],'completed_remote');self.assertFalse(cancelled['cancel_requested'])
        self.assertEqual(completed_room_dispatch(self.root,job)['artifact'],result['artifact'])
        self.function.spawn.assert_called_once()


if __name__=='__main__':unittest.main()
