"""Portable multiview project recovery using synthetic room/Modal fixtures only."""
from copy import deepcopy
import hashlib
import json
import unittest

from services.projects import ProjectError,create_project,open_project,save_project,export_project
from services.spatial.demo import DEMO_ID
from services.spatial.jobs import SpatialService
from services.spatial.room_ingest import RoomIngestService
from tests.test_spatial_room_ingest import room_fixture
from workers.spatial_room import canonical


class RoomPortableTests(unittest.TestCase):
    def setUp(self):
        self.f=room_fixture(self);self.dispatch=self.f.submit()
        result=RoomIngestService(self.f.spatial).import_result(self.dispatch['job_id'],{
            'expected_source_sha256':self.dispatch['source_sha256'],
            'expected_artifact_sha256':self.dispatch['artifact']['sha256'],
            'expected_surface_sha256':self.dispatch['surface_manifest']['sha256']})
        self.scene=result['scene']['scene'];self.target=self.f.folder/'portable'
        self.surface=(self.f.root/self.dispatch['surface_manifest']['relative_path']).read_bytes()

    def create(self):return create_project(self.f.spatial,self.scene['scene_id'],self.target)

    def manifest(self):return json.loads((self.target/'manifest.json').read_bytes())

    def rewrite(self,relative,value):
        raw=value if isinstance(value,bytes) else canonical(value)
        path=self.target/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        manifest=self.manifest();found=False
        for entry in manifest['files']:
            if entry['path']==relative:entry.update(sha256=hashlib.sha256(raw).hexdigest(),size_bytes=len(raw));found=True
        if not found:manifest['files'].append({'path':relative,'sha256':hashlib.sha256(raw).hexdigest(),'size_bytes':len(raw)})
        for descriptor in manifest['versions']:
            if descriptor['path']==relative:descriptor['sha256']=hashlib.sha256(raw).hexdigest()
        (self.target/'manifest.json').write_bytes(canonical(manifest))

    def test_exact_surface_is_portable_offline_without_source_receipts_or_model_clients(self):
        created=self.create();self.assertEqual((self.target/'reconstruction/surface.json').read_bytes(),self.surface)
        entry=next(item for item in created['project']['files'] if item['path']=='reconstruction/surface.json')
        self.assertEqual(entry['sha256'],self.dispatch['surface_manifest']['sha256'])
        self.assertEqual(created['scene']['reconstruction'],self.scene['reconstruction'])
        self.f.root.rename(self.f.folder/'source-unavailable')
        reopened=open_project(self.target);self.assertEqual(reopened['scene']['reconstruction'],self.scene['reconstruction'])
        self.assertEqual(reopened['scene']['units'],'source_relative');self.f.function.spawn.assert_called_once()
        self.assertFalse((self.target/'room-modal-calls.sqlite3').exists());self.assertFalse((self.target/'budget.sqlite3').exists())

    def test_save_reopen_and_zip_keep_the_same_inert_surface_and_immutable_versions(self):
        self.create();original=(self.target/'versions/revision-000001.json').read_bytes()
        updated=save_project(self.target,expected_revision=1,title='Visita multivista')
        self.assertEqual(updated['revision'],2);self.assertEqual((self.target/'reconstruction/surface.json').read_bytes(),self.surface)
        self.assertEqual((self.target/'versions/revision-000001.json').read_bytes(),original)
        self.assertEqual(open_project(self.target)['scene']['reconstruction'],self.scene['reconstruction'])
        destination=self.f.folder/'portable.zip';export_project(self.target,destination)
        from zipfile import ZipFile
        with ZipFile(destination) as archive:
            self.assertEqual(archive.read('reconstruction/surface.json'),self.surface)
            self.assertFalse(any(name.endswith('.sqlite3') or name.endswith('.mp4') for name in archive.namelist()))

    def test_missing_surface_rejects_even_if_removed_from_inventory(self):
        self.create();(self.target/'reconstruction/surface.json').unlink()
        with self.assertRaises(ProjectError):open_project(self.target)
        manifest=self.manifest();manifest['files']=[item for item in manifest['files'] if item['path']!='reconstruction/surface.json']
        (self.target/'manifest.json').write_bytes(canonical(manifest))
        with self.assertRaises(ProjectError):open_project(self.target)

    def test_changed_rehashed_surface_cannot_bypass_scene_evidence_hash(self):
        self.create();surface=json.loads(self.surface);surface['vertex_count']+=1
        self.rewrite('reconstruction/surface.json',surface)
        with self.assertRaises(ProjectError):open_project(self.target)

    def test_rehashed_counts_matching_scene_still_must_match_actual_glb(self):
        self.create();surface=json.loads(self.surface);surface['vertex_count']+=1;raw=canonical(surface)
        self.rewrite('reconstruction/surface.json',raw)
        version=json.loads((self.target/'versions/revision-000001.json').read_bytes())
        version['scene']['reconstruction'].update(vertex_count=surface['vertex_count'],surface_sha256=hashlib.sha256(raw).hexdigest())
        self.rewrite('versions/revision-000001.json',version)
        with self.assertRaises(ProjectError):open_project(self.target)

    def test_every_immutable_version_is_validated_against_the_surface(self):
        self.create();save_project(self.target,expected_revision=1,title='Segunda visita')
        version=json.loads((self.target/'versions/revision-000001.json').read_bytes())
        version['scene']['reconstruction']['surface_sha256']='0'*64
        self.rewrite('versions/revision-000001.json',version)
        with self.assertRaises(ProjectError):open_project(self.target)

    def test_source_sidecar_corruption_fails_before_new_directory_publication(self):
        source=self.f.root/self.dispatch['surface_manifest']['relative_path'];source.write_bytes(self.surface[:-4])
        with self.assertRaises(ProjectError):self.create()
        self.assertFalse(self.target.exists());self.assertEqual(list(self.f.folder.glob('.brivany-project-*')),[])

    def test_non_room_project_rejects_declared_and_unlisted_orphan_sidecar(self):
        service=SpatialService(self.f.folder/'demo',start_worker=False);self.addCleanup(service.close)
        create_project(service,DEMO_ID,self.target)
        path=self.target/'reconstruction/surface.json';path.parent.mkdir();path.write_bytes(self.surface)
        with self.assertRaises(ProjectError):open_project(self.target)
        self.rewrite('reconstruction/surface.json',self.surface)
        with self.assertRaises(ProjectError):open_project(self.target)

    def test_surface_has_its_own_512kib_bound(self):
        self.create();self.rewrite('reconstruction/surface.json',b' '*(512*1024+1))
        with self.assertRaises(ProjectError) as error:open_project(self.target)
        self.assertEqual(error.exception.code,'project_limit')


if __name__=='__main__':unittest.main()
