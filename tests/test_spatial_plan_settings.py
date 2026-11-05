"""Persist actual declaration metadata, never certify scale from a fixture."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from services.spatial.demo import DEMO_ID
from services.spatial.jobs import SpatialService
from services.spatial.floorplan import FloorPlanError,FloorPlanService
from services.spatial.plan_settings import PlanSettingsService,DEFAULT,validate_plan_config
from services.spatial.backup import create_backup,restore_backup


class PlanSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        self.spatial=SpatialService(self.root/'source',start_worker=False);self.addCleanup(self.spatial.close);self.settings=PlanSettingsService(self.spatial)

    def config(self):
        value=deepcopy(DEFAULT);value['references']=[{'id':'ref-1','points':[[0.,0.],[2.,0.]],'measured_m':3.,'method':'tape_measure','note':'Tramo sintético declarado.'}]
        return value

    def save(self,service=None):
        return (service or self.settings).save(DEMO_ID,{'expected_revision':0,'expected_scene_revision':1,'config':self.config()})

    def test_initial_read_is_passive_and_save_reopens_without_scene_mutation(self):
        before=self.spatial.scene(DEMO_ID);self.assertEqual(self.settings.get(DEMO_ID)['revision'],0)
        with self.spatial._connect() as db:self.assertIsNone(db.execute("SELECT 1 FROM sqlite_master WHERE name='scene_plan_settings'").fetchone())
        result=self.save();self.assertEqual(result['revision'],1);self.assertFalse(result['metric_scale_verified'])
        self.assertEqual(PlanSettingsService(self.spatial).get(DEMO_ID)['config']['references'][0]['measured_m'],3.)
        self.assertEqual(self.spatial.scene(DEMO_ID),before)
        plan=FloorPlanService(self.spatial).get(DEMO_ID);self.assertEqual(plan['scale']['meters_per_unit'],1.5);self.assertFalse(plan['scale']['metric_scale_verified'])
        self.assertTrue(plan['settings_persisted']);self.assertEqual(plan['settings_revision'],1)

    def test_two_writers_cannot_overwrite_same_revision(self):
        def save(_):
            try:self.save(PlanSettingsService(self.spatial));return 'saved'
            except FloorPlanError as error:return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(save,range(2)))
        self.assertEqual(results.count('saved'),1);self.assertIn(409,results)

    def test_changed_scene_revision_rejects_stale_declaration_save(self):
        self.spatial.update_transforms(DEMO_ID,{'expected_revision':1,'objects':[{'id':'chair','transform':{'position':[1.,0.,0.]}}]})
        with self.assertRaises(FloorPlanError) as error:self.save()
        self.assertEqual(error.exception.status,409);self.assertEqual(self.settings.get(DEMO_ID)['revision'],0)

    def test_reject_duplicate_spans_reserved_uncertainty_and_nonfinite(self):
        config=self.config();config['references'].append({**config['references'][0],'id':'ref-2'})
        with self.assertRaises(FloorPlanError):validate_plan_config(config)
        for value in (float('nan'),True):
            with self.assertRaises(FloorPlanError):validate_plan_config({**deepcopy(DEFAULT),'cut_height':value})
        zone={'id':'geometry-unverified','polygon':[[0.,0.],[1.,0.],[1.,1.]],'reason':'Ocultar advertencia','provenance':'user_declared'}
        with self.assertRaises(FloorPlanError):validate_plan_config({**deepcopy(DEFAULT),'uncertainty_zones':[zone]})

    def test_backup_roundtrip_keeps_plan_config_and_opens_without_services(self):
        self.save();archive=self.root/'backup.zip';destination=self.root/'restored'
        with patch('services.spatial.backup._server_listening',return_value=False):
            create_backup(self.spatial.root,archive,offline=True);restore_backup(archive,destination,offline=True)
        restored=SpatialService(destination,start_worker=False);self.addCleanup(restored.close)
        self.assertEqual(PlanSettingsService(restored).get(DEMO_ID)['config']['references'][0]['measured_m'],3.)


if __name__=='__main__':unittest.main()
