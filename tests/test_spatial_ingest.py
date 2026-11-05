"""Local scene publication with generated GLB and a substituted Modal SDK.

These tests exercise real capture/package/journal/files/SQLite transitions. They
do not reconstruct anything, call a model/GPU, or establish geometry fidelity.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from io import BytesIO
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from uuid import uuid4

from PIL import Image
from services.spatial.backup import create_backup,restore_backup,BackupError
from services.spatial.budget import SpatialBudget
from services.spatial.demo import make_glb
from services.spatial.dispatch import SpatialDispatch,DispatchResult
from services.spatial.ingest import SpatialIngestService,SpatialIngestError,scene_id_for_job
from services.spatial.jobs import SpatialService,now
from services.spatial.modal_transport import ModalTransport
from services.spatial.review import CaptureReviewService,rectangle_mask
from workers.spatial_runtime import read_lock,validate_glb


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.folder=Path(self.temporary.name);self.root=self.folder/'spatial'
        self.spatial=SpatialService(self.root,start_worker=False,seed_demo=False);self.addCleanup(self.spatial.close)
        self.capture=str(uuid4());capture=self.root/'captures'/self.capture;(capture/'frames').mkdir(parents=True)
        jpeg=BytesIO();Image.new('RGB',(16,16),(150,120,90)).save(jpeg,format='JPEG');raw=jpeg.getvalue();sha=hashlib.sha256(raw).hexdigest()
        (capture/'frames/frame-0000.jpg').write_bytes(raw)
        manifest={'capture_id':self.capture,'source':{'filename':'synthetic.mp4','sha256':'a'*64,'size_bytes':40,
            'duration_seconds':1.0,'width':16,'height':16,'has_audio':False},'frames':[{'id':'frame-0000',
            'relative_path':'frames/frame-0000.jpg','at_seconds':.5,'width':16,'height':16,'sha256':sha}]}
        (capture/'capture.json').write_text(json.dumps(manifest));(capture/'preflight.json').write_text('{"status":"prepared_not_reconstructed"}')
        stamp=now()
        with self.spatial._connect() as db:db.execute('INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)',(self.capture,'Captura sintética','capture_prepared','capture',None,self.capture,stamp,stamp))
        self.reviews=CaptureReviewService(self.root)
        self.item={'id':'object-1','label':'Objeto sintético','frame_id':'frame-0000','frame_sha256':sha,
            'rectangle':{'x':.25,'y':.25,'width':.5,'height':.5},'mask_reviewed':True}
        self.reviews.save(self.capture,{'expected_revision':0,'objects':[self.item],'length_reference':None})
        image=rectangle_mask(16,16,{'x':0,'y':0,'width':1,'height':1})
        with patch('services.spatial.review.shutil.which',return_value='ffmpeg'),patch('services.spatial.review._run',side_effect=lambda args,**kw:Path(args[-1]).write_bytes(image)):
            self.package=self.reviews.prepare(self.capture,{'expected_revision':1,'object_id':self.item['id']})
        self.budget=SpatialBudget(self.root/'budget.sqlite3');self.budget.configure(total_usd='1',per_job_usd='.5',gpu_rate_usd_per_second='.001',extra_reserve_usd='.1')
        config=read_lock();config.update(remote_dispatch_enabled=True,deployment_verified=True)
        config['runtime'].update(dependency_lock_complete=True,build_verified=True,cuda_compatibility_verified=True,
            base_image_digest='sha256:'+'b'*64,checkpoint_manifest=[{'path':'synthetic-only','sha256':'b'*64,'size_bytes':1}])
        config['models']['sam3d_objects'].update(checkpoint_revision='b'*40,checkpoint_hashes_verified=True,license_reviewed_by_user=True)
        config['budget']={'approved_total_usd':1.,'approved_per_job_usd':.5,'gpu_rate_usd_per_second':.001,'non_gpu_reserve_per_job_usd':.1}
        self.config=config;self.lock=self.folder/'synthetic.lock.json';self.lock.write_text(json.dumps(config))
        self.raw=make_glb([(0,0,[0,0,0],[1,1,1])]);self.sdk=SimpleNamespace(exception=SimpleNamespace(TimeoutError=TimeoutError))
        function=Mock();self.sdk.Function=SimpleNamespace(from_name=Mock(return_value=function))
        def spawn(value,**kwargs):
            return SimpleNamespace(object_id='fc-synthetic-ingest-test',get=lambda **_:self.remote(value))
        function.spawn.side_effect=spawn
        self.transport=ModalTransport(self.root,config,sdk=self.sdk,sdk_version=config['modal']['sdk_version'])
        self.dispatch=SpatialDispatch(self.root,self.reviews,self.budget,lock_path=self.lock,transport=self.transport)
        self.ingest=SpatialIngestService(self.spatial)

    def remote(self,value):
        return {'status':'preview_unverified','provenance':'inferred','pipeline_version':self.config['pipeline_version'],
            'source_capture_id':value['capture_id'],'source_frame_id':value['frame_id'],'cache_hit':False,
            'model_executed_this_call':True,'artifact_bytes':self.raw,'artifact':validate_glb(self.raw)}

    def submit(self,service=None):
        return (service or self.dispatch).submit(self.capture,self.package['package_id'],expected_revision=1,timeout_seconds=10,execute=True)

    def import_(self,document=None,**changes):
        document=document or self.submit()
        return self.ingest.import_result(document['job_id'],{'expected_source_sha256':document['source_sha256'],
            'expected_artifact_sha256':document['artifact']['sha256'],**changes})

    def scenes(self):
        with self.spatial._connect() as db:return db.execute('SELECT count(*) FROM scenes').fetchone()[0]

    def test_completed_object_becomes_actual_scene_library_asset_with_uncertainty(self):
        dispatch=self.submit();before=self.sdk.Function.from_name.call_count;result=self.import_(dispatch)
        document=result['scene']['scene'];identifier=document['scene_id']
        self.assertEqual(document['origin'],'capture_reconstruction');self.assertEqual(document['capture_id'],self.capture)
        self.assertEqual(document['units'],'source_relative');self.assertIsNone(document['metric_verification'])
        self.assertEqual(len(document['objects']),1);self.assertEqual(document['assets'][0]['provenance'],'inferred')
        self.assertEqual(document['objects'][0]['physics']['collider'],'none');self.assertIsNone(document['objects'][0]['physics']['mass_kg'])
        self.assertTrue(any('único objeto' in note for note in document['limitations']))
        self.assertEqual(self.spatial.asset(identifier,'reconstructed-object')[0],self.raw)
        self.assertEqual(result['space']['object_count'],1);self.assertEqual(result['space']['status'],'ready')
        self.assertEqual(self.sdk.Function.from_name.call_count,before);self.assertFalse(result['import']['provider_invoked'])
        self.assertFalse(result['import']['geometry_fidelity_verified']);self.assertEqual(self.budget.status()['unknown_count'],1)

    def test_duplicate_import_preserves_user_edits_and_does_not_create_another_scene(self):
        dispatch=self.submit();first=self.import_(dispatch);scene_id=first['scene']['scene']['scene_id']
        self.spatial.update_transforms(scene_id,{'expected_revision':1,'objects':[{'id':self.item['id'],'transform':{'position':[1.,0.,0.]}}]})
        second=self.import_(dispatch,title='Otro título no reemplaza el primero')
        self.assertTrue(second['import']['duplicate']);self.assertEqual(second['scene']['revision'],2);self.assertEqual(self.scenes(),1)
        self.assertEqual(second['scene']['scene']['objects'][0]['transform']['position'],[1.,0.,0.])

    def test_two_instances_publish_one_scene_with_a_unique_import_link(self):
        dispatch=self.submit()
        second=SpatialService(self.root,start_worker=False,seed_demo=False);self.addCleanup(second.close)
        def import_(spatial):return SpatialIngestService(spatial).import_result(dispatch['job_id'],{'expected_source_sha256':dispatch['source_sha256'],'expected_artifact_sha256':dispatch['artifact']['sha256']})
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(import_,[self.spatial,second]))
        self.assertEqual(sum(result['import']['duplicate'] for result in results),1);self.assertEqual(self.scenes(),1)

    def test_stub_and_relabelled_stub_without_original_modal_call_cannot_be_imported(self):
        stub=SimpleNamespace(simulation=True,execute=lambda _:DispatchResult(self.raw,'0.000000'))
        dispatch=self.submit(SpatialDispatch(self.root,self.reviews,self.budget,lock_path=self.lock,transport=stub))
        with self.assertRaises(SpatialIngestError):self.import_(dispatch)
        with self.dispatch._connect() as db:
            row=db.execute('SELECT * FROM dispatch_jobs').fetchone();value=json.loads(row['document'])
            value.update(transport_kind='modal',origin='inferred',model_executed=True)
            db.execute('UPDATE dispatch_jobs SET state=?,document=?',('completed_remote',json.dumps(value)))
        with self.assertRaises(SpatialIngestError):self.import_(dispatch)
        self.assertEqual(self.scenes(),0)

    def test_cancelled_incomplete_and_conflicting_expected_hashes_are_rejected(self):
        dispatch=self.submit()
        for changes in ({'expected_source_sha256':'b'*64},{'expected_artifact_sha256':'b'*64},{'title':'../bad\nname'},{'filename':'somewhere.glb'}):
            with self.subTest(changes=changes),self.assertRaises(SpatialIngestError):self.import_(dispatch,**changes)
        with self.dispatch._connect() as db:
            row=db.execute('SELECT * FROM dispatch_jobs').fetchone();value=json.loads(row['document']);value['cancel_requested']=True
            db.execute('UPDATE dispatch_jobs SET document=?',(json.dumps(value),))
        with self.assertRaises(SpatialIngestError):self.import_(dispatch)
        self.assertEqual(self.scenes(),0)

    def test_artifact_or_source_frame_tamper_never_publishes_a_scene(self):
        dispatch=self.submit();path=self.root/'dispatch-artifacts'/(dispatch['job_id']+'.glb');path.write_bytes(make_glb([(0,0,[1,0,0],[1,1,1])]))
        with self.assertRaises(SpatialIngestError):self.import_(dispatch)
        path.write_bytes(self.raw);(self.root/'captures'/self.capture/'frames/frame-0000.jpg').write_bytes(b'changed')
        with self.assertRaises(SpatialIngestError):self.import_(dispatch)
        self.assertEqual(self.scenes(),0)

    def test_current_review_change_rejects_stale_result_without_reexecuting_provider(self):
        dispatch=self.submit();self.reviews.save(self.capture,{'expected_revision':1,'objects':[{**self.item,'label':'Revisión nueva'}],'length_reference':None})
        before=self.sdk.Function.from_name.call_count
        with self.assertRaises(SpatialIngestError):self.import_(dispatch)
        self.assertEqual(self.scenes(),0);self.assertEqual(self.sdk.Function.from_name.call_count,before)

    def test_failure_after_file_publication_rolls_back_scene_and_owned_files(self):
        dispatch=self.submit();read=self.ingest._reviewed;calls=[]
        def changed(value):
            calls.append(1)
            if len(calls)==2:raise SpatialIngestError('test_input_changed','Fuente cambió durante la importación.')
            return read(value)
        with patch.object(self.ingest,'_reviewed',side_effect=changed),self.assertRaises(SpatialIngestError):self.import_(dispatch)
        self.assertEqual(self.scenes(),0);self.assertFalse((self.root/'scenes'/scene_id_for_job(dispatch['job_id'])).exists())
        self.assertTrue((self.root/'dispatch-artifacts'/(dispatch['job_id']+'.glb')).is_file())

    def test_a_saved_copy_tamper_is_detected_on_duplicate_import(self):
        dispatch=self.submit();result=self.import_(dispatch);identifier=result['scene']['scene']['scene_id']
        (self.root/'scenes'/identifier/'assets/reconstructed-object.glb').write_bytes(b'changed')
        with self.assertRaises(SpatialIngestError):self.import_(dispatch)
        self.assertEqual(self.scenes(),1)

    def test_backup_roundtrip_preserves_import_lineage_and_reopen_never_reexecutes(self):
        dispatch=self.submit();result=self.import_(dispatch);archive=self.folder/'backup.zip';destination=self.folder/'restored'
        with patch('services.spatial.backup._server_listening',return_value=False):
            create_backup(self.root,archive,offline=True);restore_backup(archive,destination,offline=True)
        restored=SpatialService(destination,start_worker=False,seed_demo=False);self.addCleanup(restored.close)
        reopened=SpatialIngestService(restored).import_result(dispatch['job_id'],{'expected_source_sha256':dispatch['source_sha256'],'expected_artifact_sha256':dispatch['artifact']['sha256']})
        self.assertTrue(reopened['import']['duplicate']);self.assertEqual(reopened['scene']['scene'],result['scene']['scene'])
        self.sdk.Function.from_name.assert_called_once()

    def test_backup_rejects_import_whose_modal_call_is_no_longer_completed(self):
        dispatch=self.submit();self.import_(dispatch)
        with closing(sqlite3.connect(self.root/'modal-calls.sqlite3')) as db:
            db.execute("UPDATE modal_calls SET state='started'");db.commit()
        with patch('services.spatial.backup._server_listening',return_value=False),self.assertRaises(BackupError):create_backup(self.root,self.folder/'invalid.zip',offline=True)

    def test_result_listing_is_read_only_and_distinguishes_imported_scene(self):
        dispatch=self.submit();before=self.sdk.Function.from_name.call_count
        def snapshot():
            return {path.name:(hashlib.sha256(path.read_bytes()).hexdigest(),path.stat().st_mtime_ns)
                for path in self.root.glob('*.sqlite3')}
        previous=snapshot();listed=self.ingest.list_results(self.capture)
        self.assertEqual(snapshot(),previous)
        self.assertEqual(len(listed['items']),1);item=listed['items'][0]
        self.assertEqual(item['job_id'],dispatch['job_id']);self.assertTrue(item['eligible_for_import'])
        self.assertFalse(item['imported']);self.assertIsNone(item['scene_id'])
        self.assertEqual(item['source_sha256'],dispatch['source_sha256'])
        self.assertEqual(item['artifact_sha256'],dispatch['artifact']['sha256'])
        self.assertTrue(listed['review_revalidation_required']);self.assertFalse(listed['provider_invoked'])
        imported=self.import_(dispatch);previous=snapshot();listed=self.ingest.list_results(self.capture)
        self.assertEqual(snapshot(),previous);self.assertTrue(listed['items'][0]['imported'])
        self.assertEqual(listed['items'][0]['scene_id'],imported['import']['scene_id'])
        self.assertEqual(self.sdk.Function.from_name.call_count,before)

    def test_result_listing_without_journal_does_not_create_a_database(self):
        (self.root/'dispatch.sqlite3').unlink()
        before=set(path.name for path in self.root.iterdir())
        self.assertEqual(self.ingest.list_results(self.capture)['items'],[])
        self.assertEqual(set(path.name for path in self.root.iterdir()),before)
        self.assertFalse((self.root/'dispatch.sqlite3').exists())
        with self.assertRaises(SpatialIngestError):self.ingest.list_results(str(uuid4()))

    def test_result_listing_flags_a_tampered_artifact_without_publishing(self):
        dispatch=self.submit()
        (self.root/'dispatch-artifacts'/(dispatch['job_id']+'.glb')).write_bytes(b'changed')
        listed=self.ingest.list_results(self.capture)
        self.assertEqual(len(listed['items']),1);self.assertFalse(listed['items'][0]['eligible_for_import'])
        self.assertIsNotNone(listed['items'][0]['error_code']);self.assertEqual(self.scenes(),0)

    def test_backup_rejects_reconstruction_without_its_import_link_or_table(self):
        dispatch=self.submit();self.import_(dispatch)
        with self.spatial._connect() as db:db.execute('DELETE FROM scene_imports')
        with patch('services.spatial.backup._server_listening',return_value=False),self.assertRaises(BackupError):create_backup(self.root,self.folder/'unlinked.zip',offline=True)
        with self.spatial._connect() as db:db.execute('DROP TABLE scene_imports')
        with patch('services.spatial.backup._server_listening',return_value=False),self.assertRaises(BackupError):create_backup(self.root,self.folder/'missing-table.zip',offline=True)


if __name__=='__main__':unittest.main()
