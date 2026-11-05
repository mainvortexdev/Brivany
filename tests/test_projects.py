"""Temporary portable projects: independent recovery, atomic saves and no secrets."""
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile

from PIL import Image

from services.projects import (ProjectError, SpatialProjectSource, create_project, open_project,
                               list_versions, save_project, export_project)
from services.spatial.demo import DEMO_ID
from services.spatial.jobs import SpatialService
from services.spatial.references import ReferenceSetService
from tools.projects import main


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.source = self.root / 'spatial'; self.destination = self.root / 'portable'
        self.service = SpatialService(self.source, start_worker=False); self.addCleanup(self.service.close)
        self.service.update_transforms(DEMO_ID, {'expected_revision': 1, 'objects': [{'id': 'chair', 'transform': {'position': [1., 0., .5]}}]})
        self.layout = self.service.save_layout(DEMO_ID, {'name': 'Ventana', 'expected_revision': 2})

    def create(self, scene_id=DEMO_ID, **kwargs):
        return create_project(self.service, scene_id, self.destination, **kwargs)

    def reference_scene(self):
        paths = []
        for index in range(2):
            path = self.root / f'private-personal-input-{index}.png'
            Image.new('RGB', (80, 60), (20 + index * 20, 50, 70)).save(path); paths.append(path)
        references = ReferenceSetService(self.source).create(paths, title='Referencia sintética')
        scene = deepcopy(self.service.scene(DEMO_ID)['scene']); identifier = str(uuid4())
        scene.update(scene_id=identifier, origin='reference_interpretation', reference_set_id=references['id'])
        directory = self.source / 'scenes' / identifier; (directory / 'assets').mkdir(parents=True)
        for asset in scene['assets']:
            (directory / asset['relative_path']).write_bytes((self.source / 'scenes' / DEMO_ID / asset['relative_path']).read_bytes())
        render = {'version': 'synthetic-1', 'background': '#eeeeee', 'exposure': 1., 'layout': {'metric_scale_verified': False}}
        (directory / 'render.json').write_text(json.dumps(render), encoding='utf-8')
        with self.service._connect() as db:
            serialized = json.dumps(scene)
            db.execute('INSERT INTO scenes VALUES(?,?,?,1)', (identifier, serialized, serialized))
            db.execute('INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)', (identifier, scene['title'], 'ready', 'reference_interpretation', identifier, None, 'today', 'today'))
        return identifier, references, [path.read_bytes() for path in paths], render

    def rewrite_file(self, relative, value):
        target = self.destination / relative
        raw = json.dumps(value, ensure_ascii=False).encode() if not isinstance(value, bytes) else value
        target.write_bytes(raw)
        manifest_path = self.destination / 'manifest.json'; manifest = json.loads(manifest_path.read_bytes())
        for entry in manifest['files']:
            if entry['path'] == relative: entry.update(sha256=hashlib.sha256(raw).hexdigest(), size_bytes=len(raw))
        for version in manifest['versions']:
            if version['path'] == relative: version['sha256'] = hashlib.sha256(raw).hexdigest()
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')

    def test_complete_scene_history_layout_and_jobs_are_independent_of_source(self):
        job_id = str(uuid4())
        with self.service._connect() as db:
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)', (job_id, DEMO_ID, 'demo', 'succeeded', 1, 'done', None, 'today', 'today', 'key', '{"secret":"excluded"}'))
        created = self.create(); self.assertEqual(created['revision'], 1); self.assertEqual(created['scene_revision'], 2)
        self.assertEqual(created['history']['cursor'], 1); self.assertEqual(len(created['history']['states']), 2)
        self.assertEqual(created['layouts'][0]['id'], self.layout['id'])
        self.assertEqual(created['source_jobs'][0]['id'], job_id); self.assertNotIn('payload', created['source_jobs'][0])
        self.service.update_transforms(DEMO_ID, {'expected_revision': 2, 'objects': [{'id': 'chair', 'transform': {'position': [2., 0., 0.]}}]})
        reopened = open_project(self.destination)
        chair = next(item for item in reopened['scene']['objects'] if item['id'] == 'chair')
        self.assertEqual(chair['transform']['position'], [1., 0., .5])
        self.assertFalse(reopened['project']['flags']['original_video_included'])
        self.assertFalse(reopened['project']['flags']['native_application'])

    def test_references_default_to_derived_only_with_source_provenance_and_no_original_claim(self):
        identifier, references, originals, render = self.reference_scene()
        result = self.create(identifier)
        self.assertTrue(result['project']['flags']['reference_metadata_included'])
        self.assertFalse(result['project']['flags']['reference_originals_included'])
        self.assertEqual(result['references']['id'], references['id'])
        self.assertEqual(result['render_config'], render)
        self.assertFalse((self.destination / 'references/originals').exists())
        self.assertTrue((self.destination / 'references/source-manifest.json').is_file())
        self.assertTrue(all(frame['original_path'] is None for frame in result['references']['frames']))
        self.assertEqual(open_project(self.destination)['references'], result['references'])
        self.assertNotIn('private-personal-input', json.dumps(result))

    def test_explicit_originals_are_exact_and_exclusion_can_omit_all_reference_media(self):
        identifier, references, originals, render = self.reference_scene()
        result = self.create(identifier, include_originals=True)
        self.assertTrue(result['project']['flags']['reference_originals_included'])
        for index, raw in enumerate(originals):
            self.assertEqual((self.destination / f'references/originals/frame-{index:04d}.png').read_bytes(), raw)
        excluded = self.root / 'no-references'
        result = create_project(self.service, identifier, excluded, include_references=False)
        self.assertIsNone(result['references']); self.assertFalse((excluded / 'references').exists())
        with self.assertRaises(ProjectError):
            create_project(self.service, identifier, self.root / 'invalid-options', include_references=False, include_originals=True)

    def test_save_is_optimistic_keeps_immutable_versions_and_locks_environment(self):
        created = self.create(); before = (self.destination / 'versions/revision-000001.json').read_bytes()
        updated = save_project(self.destination, expected_revision=1, title='Proyecto editado', objects=[{'id': 'chair', 'transform': {'position': [3., 0., 0.]}}])
        self.assertEqual(updated['revision'], 2); self.assertEqual(updated['scene_revision'], 3)
        self.assertEqual(updated['scene']['title'], 'Proyecto editado'); self.assertEqual(len(updated['history']['states']), 3)
        self.assertEqual((self.destination / 'versions/revision-000001.json').read_bytes(), before)
        self.assertEqual(len(list_versions(self.destination)['versions']), 2)
        with self.assertRaises(ProjectError) as error: save_project(self.destination, expected_revision=1, title='stale')
        self.assertEqual(error.exception.code, 'project_conflict')
        for objects in ([{'id': 'room', 'transform': {'position': [1., 0., 0.]}}],
                        [{'id': 'chair', 'transform': {'position': [51., 0., 0.]}}],
                        [{'id': '../outside', 'transform': {}}]):
            with self.assertRaises(ProjectError): save_project(self.destination, expected_revision=2, objects=objects)
        self.assertEqual(open_project(self.destination)['revision'], 2)

    def test_failed_save_preserves_manifest_and_cleans_only_its_own_new_version(self):
        self.create(); before = (self.destination / 'manifest.json').read_bytes()
        with patch('services.projects._publish_manifest', side_effect=OSError('synthetic disk failure')):
            with self.assertRaises(ProjectError): save_project(self.destination, expected_revision=1, title='failed')
        self.assertEqual((self.destination / 'manifest.json').read_bytes(), before)
        self.assertFalse((self.destination / 'versions/revision-000002.json').exists())
        self.assertFalse((self.destination / '.project.lock').exists())
        self.assertEqual(open_project(self.destination)['revision'], 1)

    def test_competing_version_file_is_never_deleted_after_exclusive_open_failure(self):
        self.create(); target = self.destination / 'versions/revision-000002.json'
        original_open = Path.open
        def race(path, mode='r', *args, **kwargs):
            if path == target and mode == 'xb':
                with original_open(path, 'wb') as stream: stream.write(b'concurrent-owned-by-someone-else')
                raise FileExistsError()
            return original_open(path, mode, *args, **kwargs)
        with patch.object(Path, 'open', race):
            with self.assertRaises(ProjectError): save_project(self.destination, expected_revision=1, title='raced')
        self.assertEqual(target.read_bytes(), b'concurrent-owned-by-someone-else')
        self.assertEqual(open_project(self.destination)['revision'], 1)

    def test_changed_assets_and_forged_history_are_rejected(self):
        self.create(); asset = self.destination / 'assets/chair.glb'; original = asset.read_bytes()
        asset.write_bytes(b'changed')
        with self.assertRaises(ProjectError): open_project(self.destination)
        with self.assertRaises(ProjectError): export_project(self.destination, self.root / 'bad.zip')
        asset.write_bytes(original)
        revision = json.loads((self.destination / 'versions/revision-000001.json').read_bytes())
        revision['history']['cursor'] = 200; self.rewrite_file('versions/revision-000001.json', revision)
        with self.assertRaises(ProjectError): open_project(self.destination)

    def test_reference_metadata_must_match_source_manifest_and_original_flags(self):
        identifier, references, originals, render = self.reference_scene(); self.create(identifier)
        relative = 'references/references.json'; path = self.destination / relative
        good = json.loads(path.read_bytes())
        forged = deepcopy(good); forged['frames'][0]['source_width'] += 10
        self.rewrite_file(relative, forged)
        with self.assertRaises(ProjectError): open_project(self.destination)
        self.rewrite_file(relative, good)
        manifest_path = self.destination / 'manifest.json'; manifest = json.loads(manifest_path.read_bytes())
        manifest['flags']['reference_originals_included'] = True
        manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaises(ProjectError): open_project(self.destination)

    def test_paths_symlinks_oversize_and_unknown_declared_files_are_rejected(self):
        self.create(); manifest_path = self.destination / 'manifest.json'; original = manifest_path.read_bytes()
        for bad_path in ('../outside', '/absolute', 'C:/secret', 'assets\\chair.glb', 'assets/../chair.glb'):
            manifest = json.loads(original); manifest['files'][0]['path'] = bad_path
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaises(ProjectError): open_project(self.destination)
        manifest_path.write_bytes(original)
        with patch('services.projects.MAX_TOTAL', 10):
            with self.assertRaises(ProjectError): open_project(self.destination)
        try:
            link = self.root / 'linked'; link.symlink_to(self.destination, target_is_directory=True)
        except (OSError, NotImplementedError): return
        with self.assertRaises(ProjectError): open_project(link)

    def test_existing_destinations_and_publication_races_never_replace_user_files(self):
        self.destination.mkdir(); (self.destination / 'keep').write_text('private')
        with self.assertRaises(ProjectError): self.create()
        self.assertEqual((self.destination / 'keep').read_text(), 'private')
        target = self.root / 'raced'
        def raced(staging, destination):
            destination.mkdir(); (destination / 'keep').write_text('concurrent'); raise FileExistsError()
        with patch('services.spatial.backup._publish_directory', side_effect=raced):
            with self.assertRaises(ProjectError): create_project(self.service, DEMO_ID, target)
        self.assertEqual((target / 'keep').read_text(), 'concurrent')
        self.assertEqual(list(self.root.glob('.brivany-project-*')), [])

    def test_export_copies_only_verified_inventory_without_credentials_or_extra_media(self):
        self.create(); (self.destination / '.env').write_text('private-key')
        (self.destination / 'unlisted.mp4').write_bytes(b'private-video')
        archive = self.root / 'project.zip'; result = export_project(self.destination, archive)
        self.assertFalse(result['automatic_execution'])
        with ZipFile(archive) as package:
            self.assertNotIn('.env', package.namelist()); self.assertNotIn('unlisted.mp4', package.namelist())
            self.assertEqual(set(package.namelist()), {'manifest.json', *(entry['path'] for entry in open_project(self.destination)['project']['files'])})
        before = archive.read_bytes()
        with self.assertRaises(ProjectError): export_project(self.destination, archive)
        self.assertEqual(archive.read_bytes(), before)

    def test_cli_creation_is_read_only_to_source_jobs_and_reports_no_private_paths(self):
        job_id = str(uuid4())
        with self.service._connect() as db:
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)', (job_id, DEMO_ID, 'demo', 'queued', 0, 'queued', None, 'today', 'today', 'key', '{}'))
        output = StringIO()
        with redirect_stdout(output):
            status = main(['create', '--spatial-root', str(self.source), '--scene-id', DEMO_ID, '--destination', str(self.destination)])
        self.assertEqual(status, 0)
        result = json.loads(output.getvalue()); self.assertEqual(result['revision'], 1)
        self.assertNotIn(str(self.root), output.getvalue())
        with self.service._connect() as db:
            self.assertEqual(db.execute('SELECT state FROM jobs WHERE id=?', (job_id,)).fetchone()[0], 'queued')
        output = StringIO()
        with redirect_stdout(output): status = main(['open', '--project', str(self.destination)])
        self.assertEqual(status, 0)

    def test_plan_settings_export_uses_scene_snapshot_and_stays_portable(self):
        from services.spatial.plan_settings import PlanSettingsService,DEFAULT
        config=deepcopy(DEFAULT);config['references']=[{'id':'ref-one','points':[[0.,0.],[2.,0.]],'measured_m':3.,'method':'tape_measure','note':'Synthetic declared measurement'}]
        settings=PlanSettingsService(self.service)
        saved=settings.save(DEMO_ID,{'expected_revision':0,'expected_scene_revision':2,'config':config})
        result=self.create();self.assertEqual(result['plan_config'],saved['config'])
        self.assertEqual(result['scene_revision'],2)
        settings.save(DEMO_ID,{'expected_revision':1,'expected_scene_revision':2,'config':deepcopy(DEFAULT)})
        self.assertEqual(open_project(self.destination)['plan_config'],saved['config'])

    def test_plan_only_save_is_versioned_without_changing_scene_or_history(self):
        from services.spatial.plan_settings import DEFAULT
        before=self.create();config=deepcopy(DEFAULT)
        config['annotations']=[{'id':'opening-one','kind':'opening','points':[[0.,0.],[1.,0.]],'label':'Declared opening','provenance':'user_declared','note':'Synthetic annotation'}]
        saved=save_project(self.destination,expected_revision=1,plan_config=config)
        self.assertEqual(saved['revision'],2);self.assertEqual(saved['scene_revision'],before['scene_revision'])
        self.assertEqual(saved['scene'],before['scene']);self.assertEqual(saved['history'],before['history'])
        self.assertEqual(saved['plan_config']['annotations'][0]['id'],'opening-one')
        self.assertEqual(list_versions(self.destination)['revision'],2)
        archive=self.root/'project-with-plan.zip';export_project(self.destination,archive)
        with ZipFile(archive) as package:
            revision=json.loads(package.read('versions/revision-000002.json'))
        self.assertEqual(revision['plan_config'],saved['plan_config'])

    def test_legacy_versions_without_plan_config_keep_working_and_invalid_plan_does_not_publish(self):
        from services.spatial.plan_settings import DEFAULT
        self.create();path='versions/revision-000001.json'
        legacy=json.loads((self.destination/path).read_bytes());legacy.pop('plan_config')
        self.rewrite_file(path,legacy)
        self.assertEqual(open_project(self.destination)['plan_config'],DEFAULT)
        for config in ({**DEFAULT,'script':'run'},{**DEFAULT,'references':[{'id':'bad'}]},{**DEFAULT,'cut_height':float('nan')}):
            with self.assertRaises(ProjectError):save_project(self.destination,expected_revision=1,plan_config=config)
            self.assertEqual(open_project(self.destination)['revision'],1)
        self.assertFalse((self.destination/'versions/revision-000002.json').exists())


if __name__ == '__main__': unittest.main()
