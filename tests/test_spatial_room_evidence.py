"""Adversarial portable-room invariants, with generated geometry/Modal stub."""
from copy import deepcopy
import hashlib
import json
import unittest

from pydantic import ValidationError
from contracts.spatial import SceneManifest
from services.projects import create_project,open_project,ProjectError
from services.spatial.room_ingest import RoomIngestService
from tests.test_spatial_room_ingest import room_fixture
from workers.spatial_room import canonical


class RoomEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.f=room_fixture(self);dispatch=self.f.submit()
        self.scene=RoomIngestService(self.f.spatial).import_result(dispatch['job_id'],{
            'expected_source_sha256':dispatch['source_sha256'],'expected_artifact_sha256':dispatch['artifact']['sha256'],
            'expected_surface_sha256':dispatch['surface_manifest']['sha256']})['scene']['scene']

    def rejects(self,value):
        with self.assertRaises(ValidationError):SceneManifest.model_validate_json(canonical(value))

    def test_portable_camera_requires_rigid_rotation_and_corresponding_inverse(self):
        invalid=[]
        value=deepcopy(self.scene);value['reconstruction']['cameras'][0]['world_to_camera_opencv'][0][0]=2.;invalid.append(('scale instead of rotation',value))
        value=deepcopy(self.scene);value['reconstruction']['cameras'][0]['camera_to_viewer'][0][3]+=10.;invalid.append(('inconsistent inverse position',value))
        value=deepcopy(self.scene);value['reconstruction']['cameras'][0]['intrinsic'][0][1]=.25;invalid.append(('unsupported intrinsic skew',value))
        for label,value in invalid:
            with self.subTest(case=label):self.rejects(value)

    def test_portable_reports_require_coherent_pixel_counts_and_thresholds(self):
        value=deepcopy(self.scene);frame=value['reconstruction']['frame_reports'][0]
        frame['invalid_depth_or_confidence_pixels']=frame['sampled_image_pixels']+1
        self.rejects(value)
        value=deepcopy(self.scene);value['reconstruction']['frame_reports'][0]['confidence_score_threshold']=None
        self.rejects(value)

    def test_portable_camera_alignment_requires_identity_environment_transform(self):
        value=deepcopy(self.scene);value['objects'][0]['transform']['position']=[10.,0.,0.]
        self.rejects(value)

    def test_portable_flags_are_booleans_not_numeric_literals(self):
        for key in ('holes_filled','scene_coverage_verified','colors_include_captured_lighting'):
            value=deepcopy(self.scene);value['reconstruction'][key]=int(value['reconstruction'][key])
            with self.subTest(flag=key):self.rejects(value)

    def test_open_project_rejects_camera_corruption_even_with_recomputed_envelope_hashes(self):
        destination=self.f.folder/'portable-camera-review';create_project(self.f.spatial,self.scene['scene_id'],destination)
        descriptor=destination/'versions/revision-000001.json';document=json.loads(descriptor.read_bytes())
        document['scene']['reconstruction']['cameras'][0]['camera_to_viewer'][1][3]+=8.
        raw=canonical(document);descriptor.write_bytes(raw);sha=hashlib.sha256(raw).hexdigest()
        manifest_path=destination/'manifest.json';manifest=json.loads(manifest_path.read_bytes())
        manifest['versions'][0]['sha256']=sha
        for item in manifest['files']:
            if item['path']=='versions/revision-000001.json':item.update(sha256=sha,size_bytes=len(raw))
        manifest_path.write_bytes(canonical(manifest))
        with self.assertRaises(ProjectError):open_project(destination)


if __name__=='__main__':unittest.main()
