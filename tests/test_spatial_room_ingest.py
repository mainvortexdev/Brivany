"""Real local import and portable files; Modal/model output is substituted."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch
from io import BytesIO
from zipfile import ZipFile

from contracts.spatial import SceneManifest
from pydantic import ValidationError
from services.projects import create_project,open_project
from services.spatial.jobs import SpatialService,now
from services.spatial.room_dispatch import RoomDispatchResult
from services.spatial.room_ingest import RoomIngestService,RoomIngestError,scene_id_for_room
from tests import test_spatial_room_dispatch as fixtures
from workers.spatial_room import canonical


def room_fixture(test):
    fixture=fixtures.RoomDispatchTests(methodName='runTest');fixture.setUp();test.addCleanup(fixture.doCleanups)
    stamp=now()
    with fixture.spatial._connect() as db:
        db.execute('INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)',(fixture.capture,'Captura sintética','capture_prepared','capture',None,fixture.capture,stamp,stamp))
    (fixture.root/'captures'/fixture.capture/'preflight.json').write_text('{"status":"prepared_not_reconstructed"}')
    return fixture


class RoomIngestTests(unittest.TestCase):
    def setUp(self):
        self.f=room_fixture(self);self.ingest=RoomIngestService(self.f.spatial)

    def import_(self,dispatch=None,**changes):
        dispatch=dispatch or self.f.submit()
        return self.ingest.import_result(dispatch['job_id'],{
            'expected_source_sha256':dispatch['source_sha256'],'expected_artifact_sha256':dispatch['artifact']['sha256'],
            'expected_surface_sha256':dispatch['surface_manifest']['sha256'],**changes})

    def count(self):
        with self.f.spatial._connect() as db:return db.execute('SELECT count(*) FROM scenes').fetchone()[0]

    def test_completed_surface_import_keeps_cameras_gaps_unknown_billing_and_no_provider(self):
        dispatch=self.f.submit();calls=self.f.function.spawn.call_count;result=self.import_(dispatch)
        scene=result['scene']['scene'];evidence=scene['reconstruction']
        self.assertEqual(scene['scene_id'],scene_id_for_room(dispatch['job_id']));self.assertEqual(scene['origin'],'room_reconstruction')
        self.assertEqual(scene['source_frame_ids'],['frame-0000','frame-0001']);self.assertEqual(scene['units'],'source_relative')
        self.assertEqual([item['frame_id'] for item in evidence['cameras']],scene['source_frame_ids'])
        self.assertFalse(evidence['holes_filled']);self.assertFalse(evidence['cross_view_fusion']);self.assertFalse(evidence['confidence_is_probability'])
        self.assertEqual(evidence['unknown_surfaces'],'unrepresented');self.assertTrue(evidence['colors_include_captured_lighting'])
        self.assertFalse(scene['objects'][0]['editable']);self.assertEqual(scene['objects'][0]['physics']['collider'],'none')
        self.assertFalse(result['import']['provider_invoked']);self.assertEqual(self.f.function.spawn.call_count,calls)
        self.assertEqual(self.f.budget.status()['unknown_count'],1);self.assertEqual(result['space']['status'],'ready')
        self.assertEqual(hashlib.sha256(self.f.spatial.asset(scene['scene_id'],'room-surface')[0]).hexdigest(),dispatch['artifact']['sha256'])

    def test_list_is_passive_then_opens_same_import_without_mutating_databases(self):
        before={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in self.f.root.glob('*.sqlite3')}
        self.assertEqual(self.ingest.list_results(self.f.capture)['items'],[])
        self.assertEqual(before,{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in self.f.root.glob('*.sqlite3')})
        dispatch=self.f.submit();item=self.ingest.list_results(self.f.capture)['items'][0]
        self.assertEqual(item['kind'],'room');self.assertTrue(item['eligible_for_import']);self.assertFalse(item['imported'])
        result=self.import_(dispatch);duplicate=self.import_(dispatch,title='No cambia el nombre original')
        self.assertTrue(duplicate['import']['duplicate']);self.assertEqual(self.count(),1)
        self.assertEqual(duplicate['scene']['scene']['title'],result['scene']['scene']['title'])
        item=self.ingest.list_results(self.f.capture)['items'][0]
        self.assertTrue(item['imported']);self.assertEqual(item['scene_id'],result['scene']['scene']['scene_id'])
        self.f.function.spawn.assert_called_once()

    def test_two_instances_publish_only_one_scene(self):
        dispatch=self.f.submit();other=SpatialService(self.f.root,start_worker=False,seed_demo=False);self.addCleanup(other.close)
        def publish(service):
            return RoomIngestService(service).import_result(dispatch['job_id'],{
                'expected_source_sha256':dispatch['source_sha256'],'expected_artifact_sha256':dispatch['artifact']['sha256'],
                'expected_surface_sha256':dispatch['surface_manifest']['sha256']})
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(publish,[self.f.spatial,other]))
        self.assertEqual(sum(item['import']['duplicate'] for item in results),1);self.assertEqual(self.count(),1)

    def test_changed_source_or_result_hash_rejects_before_publication(self):
        dispatch=self.f.submit()
        for key in ('expected_source_sha256','expected_artifact_sha256','expected_surface_sha256'):
            with self.subTest(key=key),self.assertRaises(RoomIngestError):self.import_(dispatch,**{key:'0'*64})
        frame=self.f.root/'captures'/self.f.capture/'frames/frame-0001.jpg';frame.write_bytes(b'changed')
        with self.assertRaises(RoomIngestError):self.import_(dispatch)
        self.assertEqual(self.count(),0);self.assertFalse((self.f.root/'scenes'/scene_id_for_room(dispatch['job_id'])).exists())

    def test_missing_modal_receipt_or_corrupt_mesh_cannot_be_imported(self):
        dispatch=self.f.submit();mesh=self.f.root/dispatch['artifact']['relative_path'];original=mesh.read_bytes();mesh.write_bytes(original[:-4])
        with self.assertRaises(RoomIngestError):self.import_(dispatch)
        self.assertFalse(self.ingest.list_results(self.f.capture)['items'][0]['eligible_for_import']);mesh.write_bytes(original)
        with self.f.transport._db() as db:db.execute("UPDATE modal_calls SET state='result_unknown'")
        with self.assertRaises(RoomIngestError):self.import_(dispatch)
        self.assertEqual(self.count(),0)

    def test_rollback_removes_only_the_new_published_directory(self):
        dispatch=self.f.submit();original=self.ingest._source;calls=0
        def changed(value):
            nonlocal calls
            calls+=1
            if calls==2:raise RoomIngestError('room_import_source','Fixture changed')
            return original(value)
        with patch.object(self.ingest,'_source',side_effect=changed),self.assertRaises(RoomIngestError):self.import_(dispatch)
        self.assertEqual(self.count(),0);self.assertFalse((self.f.root/'scenes'/scene_id_for_room(dispatch['job_id'])).exists())
        self.assertFalse(self.import_(dispatch)['import']['duplicate'])

    def test_existing_unrelated_directory_is_never_overwritten(self):
        dispatch=self.f.submit();target=self.f.root/'scenes'/scene_id_for_room(dispatch['job_id']);target.mkdir();(target/'sentinel.txt').write_text('keep')
        with self.assertRaises(RoomIngestError):self.import_(dispatch)
        self.assertEqual((target/'sentinel.txt').read_text(),'keep');self.assertEqual(self.count(),0)

    def test_portable_project_reopens_exact_provenance_and_geometry(self):
        dispatch=self.f.submit();scene=self.import_(dispatch)['scene']['scene'];target=self.f.folder/'portable-room'
        create_project(self.f.spatial,scene['scene_id'],target);project=open_project(target)
        self.assertEqual(project['scene']['reconstruction'],scene['reconstruction'])
        self.assertEqual(project['scene']['objects'],scene['objects'])
        self.assertEqual(hashlib.sha256((target/'assets/room-surface.glb').read_bytes()).hexdigest(),dispatch['artifact']['sha256'])

    def test_portable_contract_rejects_fabricated_certainty_movable_room_and_false_counts(self):
        document=self.import_()['scene']['scene']
        changes=[('metric_scale_verified',True),('holes_filled',True),('geometry_fidelity_verified',True),('triangle_count',1)]
        for key,value in changes:
            bad=deepcopy(document);bad['reconstruction'][key]=value
            with self.subTest(key=key),self.assertRaises(ValidationError):SceneManifest.model_validate_json(canonical(bad))
        bad=deepcopy(document);bad['objects'][0]['editable']=True
        with self.assertRaises(ValidationError):SceneManifest.model_validate_json(canonical(bad))

    def test_export_keeps_exact_surface_report_and_rejects_lost_original(self):
        dispatch=self.f.submit();scene=self.import_(dispatch)['scene']['scene'];raw,_,_=self.f.spatial.export_scene(scene['scene_id'])
        with ZipFile(BytesIO(raw)) as archive:
            surface=archive.read('reconstruction/surface.json')
            self.assertEqual(hashlib.sha256(surface).hexdigest(),dispatch['surface_manifest']['sha256'])
            metadata=json.loads(archive.read('export.json'))
            self.assertEqual(metadata['files']['reconstruction/surface.json'],dispatch['surface_manifest']['sha256'])
        (self.f.root/dispatch['surface_manifest']['relative_path']).unlink()
        with self.assertRaises(ValueError):self.f.spatial.export_scene(scene['scene_id'])

    def test_melodi_context_distinguishes_surface_from_separated_objects_without_sending_images(self):
        from services.spatial.assistant import SpatialAssistantService
        scene=self.import_()['scene']['scene']
        context=SpatialAssistantService(self.f.spatial,configured=lambda:False).context(scene['scene_id'],'room-surface',1)
        evidence=context['scene']['reconstruction']
        self.assertEqual(evidence['estimated_camera_count'],2);self.assertFalse(evidence['cross_view_fusion'])
        self.assertFalse(evidence['metric_scale_verified']);self.assertEqual(context['selected_object']['role'],'environment')
        self.assertFalse(context['selected_object']['editable']);self.assertFalse(context['images_sent']);self.assertFalse(context['actions_enabled_for_model'])
        self.assertFalse(context['camera_available_in_this_turn']);self.f.function.spawn.assert_called_once()


if __name__=='__main__':unittest.main()
