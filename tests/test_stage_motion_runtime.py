"""Exercise patch/restore only in synthetic temporary releases, never installed app."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.stage_motion_runtime import (SCHEMA, StageError, VERSION, allowed_runtime_path,
    apply_plan, filehash, restoration_plan, restore)


class StageMotionRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name).resolve()
        self.install = self.base/'install'
        self.app = self.install/'releases'/VERSION/'app'
        (self.app/'desktop/distribution').mkdir(parents=True)
        (self.app/'desktop/distribution/entry.py').write_text('# test fixture', encoding='utf-8')
        (self.app.parent/'python').mkdir()
        (self.app.parent/'python/python.exe').write_bytes(b'synthetic interpreter; never executed')
        (self.install/'current.json').write_text(json.dumps({'version': VERSION}), encoding='utf-8')
        self.source = self.base/'source';self.source.mkdir()
        self.backups = self.base/'backups'
        self.closed = patch('tools.stage_motion_runtime.require_closed')
        self.closed.start()
    def tearDown(self):
        self.closed.stop();self.temp.cleanup()

    def manifest(self):
        original = self.app/'services/motion/service.py'
        original.parent.mkdir(parents=True);original.write_bytes(b'old source\n')
        first = self.source/'old.py';first.write_bytes(b'new source\n')
        second = self.source/'new.py';second.write_bytes(b'new module\n')
        return {'schema': SCHEMA, 'kind': 'brivany-motion-runtime-local-patch',
                'version': VERSION, 'app_root': str(self.app), 'source_root': str(self.source),
                'state': 'planned', 'applied_paths': [], 'created_directories': [],
                'portable_binaries': False,
                'records': [{'path': 'services/motion/service.py', 'source': str(first),
                             'before_sha256': filehash(original), 'after_sha256': filehash(first), 'bytes': first.stat().st_size},
                            {'path': 'services/motion/assets/new.svg', 'source': str(second),
                             'before_sha256': None, 'after_sha256': filehash(second), 'bytes': second.stat().st_size}]}

    def test_synthetic_release_is_backed_up_and_restored_without_version_changes(self):
        value = self.manifest();manifest_file = apply_plan(value, self.backups)
        self.assertEqual((self.app/'services/motion/service.py').read_bytes(), b'new source\n')
        self.assertTrue((self.app/'services/motion/assets/new.svg').exists())
        saved = manifest_file.parent/'files/services/motion/service.py'
        self.assertEqual(saved.read_bytes(), b'old source\n')
        self.assertEqual(json.loads(manifest_file.read_text(encoding='utf-8'))['state'], 'applied')
        self.assertEqual(restoration_plan(manifest_file)['version'], VERSION)
        restore(manifest_file)
        self.assertEqual((self.app/'services/motion/service.py').read_bytes(), b'old source\n')
        self.assertFalse((self.app/'services/motion/assets/new.svg').exists())
        self.assertFalse((self.app/'services/motion/assets').exists())
        self.assertEqual(json.loads((self.install/'current.json').read_text())['version'], VERSION)

    def test_restore_refuses_to_overwrite_a_later_user_change(self):
        manifest_file = apply_plan(self.manifest(), self.backups)
        original = self.app/'services/motion/service.py';original.write_bytes(b'new independent edit')
        with self.assertRaises(ValueError):
            restore(manifest_file)
        self.assertEqual(original.read_bytes(), b'new independent edit')

    def test_changed_source_stops_before_first_installed_write_and_keeps_manifest(self):
        value = self.manifest()
        (self.source/'new.py').write_bytes(b'changed after plan')
        with self.assertRaises(StageError):
            apply_plan(value, self.backups)
        self.assertEqual((self.app/'services/motion/service.py').read_bytes(), b'old source\n')
        self.assertFalse((self.app/'services/motion/assets/new.svg').exists())
        manifest_file = next(self.backups.glob('*/manifiesto.json'))
        self.assertEqual(json.loads(manifest_file.read_text())['state'], 'failed')
        restore(manifest_file)
        self.assertEqual((self.app/'services/motion/service.py').read_bytes(), b'old source\n')

    def test_private_or_out_of_scope_paths_are_never_accepted(self):
        for name in ['.env', 'services/motion/assets/.env', 'services/motion/voice.wav',
                     '../User Data/.env', 'desktop/distribution/version.json', 'runtime-bin/secret.dpapi']:
            with self.subTest(name=name):self.assertFalse(allowed_runtime_path(name))
        for name in ['services/motion/story_service.py', 'services/motion/assets/STYLE.md',
                     'runtime-bin/node.exe', 'motion-studio/node_modules/hyperframes/bin/hyperframes.mjs']:
            with self.subTest(name=name):self.assertTrue(allowed_runtime_path(name))


if __name__ == '__main__':
    unittest.main()
