"""Local persistence and export invariants; no remote providers."""
from io import BytesIO
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from services.spatial.demo import DEMO_ID
from services.spatial.jobs import SpatialService, SpatialServiceError


class SceneHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'spatial'
        self.service = SpatialService(self.root, start_worker=False); self.addCleanup(self.service.close)

    def change(self, x):
        return self.service.update_transforms(DEMO_ID, {'expected_revision':self.service.scene(DEMO_ID)['revision'],
            'objects':[{'id':'chair','transform':{'position':[x,0,0]}}]})

    def chair(self, value):
        return next(obj for obj in value['scene']['objects'] if obj['id']=='chair')['transform']['position'][0]

    def test_undo_redo_persist_and_revision_always_increases(self):
        start = self.service.scene(DEMO_ID)
        self.assertFalse(start['history']['can_undo'])
        self.change(2)
        back = self.service.undo_scene(DEMO_ID, 2)
        self.assertEqual(self.chair(back), self.chair(start)); self.assertEqual(back['revision'],3)
        self.assertTrue(back['history']['can_redo'])
        self.service.close()
        self.service = SpatialService(self.root,start_worker=False); self.addCleanup(self.service.close)
        forward = self.service.redo_scene(DEMO_ID,3)
        self.assertEqual(self.chair(forward),2); self.assertEqual(forward['revision'],4)
        with self.assertRaises(SpatialServiceError): self.service.undo_scene(DEMO_ID,2)
        self.assertEqual(self.service.scene(DEMO_ID)['revision'],4)

    def test_new_edit_discards_redo_branch_and_reset_can_be_undone(self):
        self.change(2); self.change(3)
        self.service.undo_scene(DEMO_ID,3)
        edited = self.change(4)
        self.assertFalse(edited['history']['can_redo'])
        with self.assertRaises(SpatialServiceError): self.service.redo_scene(DEMO_ID,5)
        reset = self.service.reset_scene(DEMO_ID,5)
        restored = self.service.undo_scene(DEMO_ID,reset['revision'])
        self.assertEqual(self.chair(restored),4)

    def test_history_is_bounded_without_losing_current_state(self):
        for index in range(104): self.change(index/10)
        current = self.service.scene(DEMO_ID)
        self.assertEqual(current['history']['undo_steps'],99)
        self.assertEqual(current['history']['limit'],100)
        self.assertEqual(self.chair(current),10.3)

    def test_layouts_apply_as_undoable_transforms_and_require_revision(self):
        self.change(2)
        saved = self.service.save_layout(DEMO_ID, {'expected_revision':2,'name':'Ventana'})
        self.assertEqual(self.service.scene(DEMO_ID)['revision'],2)
        self.change(3)
        applied = self.service.apply_layout(DEMO_ID,saved['id'],3)
        self.assertEqual(self.chair(applied),2)
        undone = self.service.undo_scene(DEMO_ID,4)
        self.assertEqual(self.chair(undone),3)
        with self.assertRaises(SpatialServiceError): self.service.save_layout(DEMO_ID,{'expected_revision':2,'name':'Otra'})
        with self.assertRaises(SpatialServiceError): self.service.save_layout(DEMO_ID,{'expected_revision':5,'name':'ventana'})
        self.assertEqual(len(self.service.list_layouts(DEMO_ID)['layouts']),1)

    def test_layout_limit_and_locked_object_tampering_rejected(self):
        for index in range(20): self.service.save_layout(DEMO_ID,{'expected_revision':1,'name':'Variante '+str(index)})
        with self.assertRaises(SpatialServiceError):self.service.save_layout(DEMO_ID,{'expected_revision':1,'name':'Extra'})
        layout = self.service.list_layouts(DEMO_ID)['layouts'][0]
        with self.service._connect() as db:
            db.execute('UPDATE scene_layouts SET transforms=? WHERE id=?',(json.dumps({'room':{'position':[1,2,3]}}),layout['id']))
        with self.assertRaises(SpatialServiceError): self.service.apply_layout(DEMO_ID,layout['id'],1)
        self.assertEqual(self.service.scene(DEMO_ID)['revision'],1)

    def test_export_contains_exact_edited_manifest_assets_hashes_no_private_input(self):
        current = self.change(2)
        raw,mime,name = self.service.export_scene(DEMO_ID)
        self.assertEqual(mime,'application/zip'); self.assertTrue(name.endswith('.zip'))
        with ZipFile(BytesIO(raw)) as package:
            self.assertEqual(set(package.namelist()),{'scene.json','export.json','README.txt',
                'assets/room.glb','assets/chair.glb','assets/table.glb','assets/lamp.glb'})
            manifest = json.loads(package.read('scene.json'))
            self.assertEqual(manifest,current['scene']); self.assertEqual(manifest['origin'],'generated_demo')
            info = json.loads(package.read('export.json'))
            self.assertEqual(info['revision'],2); self.assertFalse(info['metric_scale_verified'])
            for path, digest in info['files'].items():self.assertEqual(hashlib.sha256(package.read(path)).hexdigest(),digest)
        (self.root/'scenes'/DEMO_ID/'assets'/'chair.glb').write_bytes(b'changed')
        with self.assertRaises(SpatialServiceError):self.service.export_scene(DEMO_ID)


if __name__ == '__main__': unittest.main()
