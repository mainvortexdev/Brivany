"""Real local ZIP/SQLite recovery; all capture and Modal/model data is synthetic."""
from contextlib import closing
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile,ZIP_DEFLATED

from services.spatial.backup import BackupError,create_backup,inspect_backup,restore_backup
from services.spatial.budget import SpatialBudget
from services.spatial.jobs import SpatialService
from services.spatial.room_dispatch import RoomDispatch,RoomDispatchResult
from services.spatial.room_ingest import RoomIngestService
from tests.test_spatial_room_ingest import room_fixture
from workers.spatial_room import canonical


class RoomBackupTests(unittest.TestCase):
    def setUp(self):
        self.f=room_fixture(self);self.archive=self.f.folder/'room-backup.zip'
        offline=patch('services.spatial.backup._server_listening',return_value=False)
        offline.start();self.addCleanup(offline.stop)

    def publish(self,dispatch=None):
        dispatch=dispatch or self.f.submit()
        result=RoomIngestService(self.f.spatial).import_result(dispatch['job_id'],{
            'expected_source_sha256':dispatch['source_sha256'],
            'expected_artifact_sha256':dispatch['artifact']['sha256'],
            'expected_surface_sha256':dispatch['surface_manifest']['sha256']})
        return dispatch,result

    def create(self):return create_backup(self.f.root,self.archive,offline=True)

    def rewrite(self,mutate):
        with ZipFile(self.archive) as archive:files={name:archive.read(name) for name in archive.namelist()}
        mutate(files)
        manifest=json.loads(files['manifest.json']);manifest['files']=[
            {'path':name[5:],'size_bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
            for name,raw in files.items() if name.startswith('data/')]
        manifest['total_size_bytes']=sum(item['size_bytes'] for item in manifest['files'])
        files['manifest.json']=canonical(manifest);destination=self.f.folder/(str(uuid4())+'.zip')
        with ZipFile(destination,'x',compression=ZIP_DEFLATED) as archive:
            for name,raw in files.items():archive.writestr(name,raw)
        return destination

    def mutate_db(self,files,name,sql,params=()):
        path=self.f.folder/(str(uuid4())+'.sqlite3');path.write_bytes(files['data/'+name])
        with closing(sqlite3.connect(path)) as db:
            with db:db.execute(sql,params)
        files['data/'+name]=path.read_bytes()

    def rejected_restore(self,archive):
        target=self.f.folder/('restored-'+str(uuid4()))
        with self.assertRaises(BackupError):restore_backup(archive,target,offline=True)
        self.assertFalse(target.exists());self.assertEqual(list(self.f.folder.glob('.brivany-restore-*')),[])

    def test_round_trip_preserves_surface_cameras_journals_unknown_cost_and_no_replay(self):
        dispatch,result=self.publish();scene=result['scene']['scene'];calls=self.f.function.spawn.call_count
        summary=self.create();self.assertEqual(summary['external_calls'],0);self.assertEqual(summary['gpu_seconds'],0)
        self.assertFalse(summary['service_started']);self.assertFalse(summary['original_media_included'])
        self.assertEqual(inspect_backup(self.archive,offline=True)['status'],'verified')
        with ZipFile(self.archive) as archive:
            required={'data/room-dispatch.sqlite3','data/room-modal-calls.sqlite3','data/budget.sqlite3',
                'data/'+dispatch['artifact']['relative_path'],'data/'+dispatch['surface_manifest']['relative_path']}
            self.assertTrue(required<=set(archive.namelist()));self.assertFalse(any(name.endswith('.mp4') or '.env' in name for name in archive.namelist()))
        target=self.f.folder/'restored';restore_backup(self.archive,target,offline=True)
        service=SpatialService(target,start_worker=False,seed_demo=False);self.addCleanup(service.close)
        reopened=service.scene(scene['scene_id'])['scene']
        self.assertEqual(reopened['reconstruction'],scene['reconstruction']);self.assertEqual(reopened['objects'],scene['objects'])
        self.assertEqual((target/dispatch['artifact']['relative_path']).read_bytes(),(self.f.root/dispatch['artifact']['relative_path']).read_bytes())
        self.assertEqual(SpatialBudget(target/'budget.sqlite3').status()['unknown_count'],1)
        item=RoomIngestService(service).list_results(self.f.capture)['items'][0]
        self.assertTrue(item['imported']);self.assertTrue(item['eligible_for_import'])
        self.assertEqual(self.f.function.spawn.call_count,calls)

    def test_lost_room_import_link_or_table_rejects_before_archive_publication(self):
        self.publish()
        for sql in ('DELETE FROM room_scene_imports','DROP TABLE room_scene_imports'):
            with self.subTest(sql=sql):
                # Preserve bytes between the two independent corruptions.
                source=self.f.root/'spatial.sqlite3';before=source.read_bytes()
                with self.f.spatial._connect() as db:db.execute(sql)
                with self.assertRaises(BackupError):self.create()
                self.assertFalse(self.archive.exists());source.write_bytes(before)

    def test_rehashed_archive_with_missing_diary_budget_or_receipt_is_rejected(self):
        self.publish();self.create()
        for name in ('room-dispatch.sqlite3','room-modal-calls.sqlite3','budget.sqlite3'):
            with self.subTest(name=name):self.rejected_restore(self.rewrite(lambda files,name=name:files.pop('data/'+name)))
        self.rejected_restore(self.rewrite(lambda files:self.mutate_db(files,'room-modal-calls.sqlite3','DELETE FROM modal_calls')))

    def test_rehashed_archive_rejects_cancelled_or_stub_promoted_to_scene(self):
        dispatch,_=self.publish();self.create()
        for field,value,state in (('cancel_requested',True,'completed_remote'),('transport_kind','test_stub','completed_test_stub')):
            def mutate(files,field=field,value=value,state=state):
                document=deepcopy(dispatch)
                # inspect() adds status metadata; retain the exact journal fields.
                with closing(sqlite3.connect(self.f.root/'room-dispatch.sqlite3')) as db:
                    document=json.loads(db.execute('SELECT document FROM room_dispatch_jobs').fetchone()[0])
                document[field]=value
                if field=='transport_kind':document.update(origin='test_stub',model_executed=False)
                self.mutate_db(files,'room-dispatch.sqlite3','UPDATE room_dispatch_jobs SET state=?,document=?',(state,canonical(document).decode()))
            with self.subTest(field=field):self.rejected_restore(self.rewrite(mutate))

    def test_rehashed_archive_cannot_substitute_scene_lineage_or_call_identity(self):
        self.publish();self.create()
        for table,sql,params in (
            ('spatial.sqlite3','UPDATE room_scene_imports SET artifact_sha256=?',('0'*64,)),
            ('spatial.sqlite3','UPDATE room_scene_imports SET surface_sha256=?',('0'*64,)),
            ('room-modal-calls.sqlite3','UPDATE modal_calls SET request_sha256=?',('0'*64,)),
            ('room-modal-calls.sqlite3',"UPDATE modal_calls SET state='result_unknown'",()),
            ('budget.sqlite3',"UPDATE reservations SET state='released'",())):
            with self.subTest(sql=sql):self.rejected_restore(self.rewrite(lambda files:self.mutate_db(files,table,sql,params)))

    def test_rehashed_archive_cannot_remove_or_change_surface_or_glb(self):
        dispatch,_=self.publish();self.create()
        for key in ('artifact','surface_manifest'):
            name='data/'+dispatch[key]['relative_path']
            with self.subTest(key=key,change='missing'):self.rejected_restore(self.rewrite(lambda files:files.pop(name)))
            with self.subTest(key=key,change='bytes'):self.rejected_restore(self.rewrite(lambda files:files.__setitem__(name,files[name][:-4])))

    def test_current_scene_cannot_drop_room_lineage_retained_by_its_baseline(self):
        _,result=self.publish();self.create();scene=deepcopy(result['scene']['scene'])
        scene.update(origin='generated_demo',capture_id=None,source_frame_ids=[],reconstruction=None)
        for asset in scene['assets']:asset.update(provenance='generated',source_frame_ids=[])
        def mutate(files):
            self.mutate_db(files,'spatial.sqlite3','UPDATE scenes SET document=?',(canonical(scene).decode(),))
            self.mutate_db(files,'spatial.sqlite3',"UPDATE spaces SET origin='generated_demo',capture_id=NULL WHERE scene_id IS NOT NULL")
            self.mutate_db(files,'spatial.sqlite3','DELETE FROM room_scene_imports')
        self.rejected_restore(self.rewrite(mutate))

    def test_unimported_test_stub_is_retained_as_stub_without_remote_receipts(self):
        from types import SimpleNamespace
        def execute(request):
            result=self.f.remote(request)
            return RoomDispatchResult(result['artifact_bytes'],result['surface'],'0.000000',True)
        stub=RoomDispatch(self.f.root,self.f.preparation,self.f.budget,lock_path=self.f.lock_path,
            transport=SimpleNamespace(simulation=True,execute=execute))
        dispatch=stub.submit(self.f.capture,self.f.payload,execute=True);self.assertEqual(dispatch['state'],'completed_test_stub')
        self.create();target=self.f.folder/'restored-stub';restore_backup(self.archive,target,offline=True)
        with closing(sqlite3.connect(target/'room-dispatch.sqlite3')) as db:
            row=db.execute('SELECT state,document FROM room_dispatch_jobs').fetchone()
        self.assertEqual(row[0],'completed_test_stub');self.assertEqual(json.loads(row[1])['origin'],'test_stub')
        self.f.function.spawn.assert_not_called()

    def test_missing_source_and_orphan_result_are_rejected_before_publication(self):
        dispatch=self.f.submit();source=self.f.root/'captures'/self.f.capture/'frames/frame-0000.jpg'
        original=source.read_bytes();source.write_bytes(b'changed')
        with self.assertRaises(BackupError):self.create()
        self.assertFalse(self.archive.exists());source.write_bytes(original)
        orphan=self.f.root/'room-artifacts'/(str(uuid4())+'.surface.json');orphan.write_bytes(b'{}')
        with self.assertRaises(BackupError):self.create()
        self.assertFalse(self.archive.exists())


if __name__=='__main__':unittest.main()
