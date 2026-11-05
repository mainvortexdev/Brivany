"""Local reference preparation with synthetic pixels; no API or reconstruction."""
from contextlib import redirect_stdout
from copy import deepcopy
import hashlib
from io import BytesIO, StringIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from services.spatial.references import ReferenceSetError, ReferenceSetService
from tools.import_spatial_images import main


class SpatialReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / 'private'
        self.inputs = self.base / 'user-inputs'
        self.inputs.mkdir()
        self.service = ReferenceSetService(self.root)
        self.paths = [self.image('personal-name-a.png', (1600, 900), (20, 40, 60)),
                      self.image('personal-name-b.jpg', (800, 600), (80, 90, 100))]

    def image(self, filename, size, color, **kwargs):
        path = self.inputs / filename
        mode = 'RGBA' if len(color) == 4 else 'RGB'
        Image.new(mode, size, color).save(path, **kwargs)
        return path

    def folder(self, result):
        return self.root / 'reference-sets' / result['id']

    def test_originals_remain_exact_and_derivatives_are_bounded_jpeg_without_private_paths(self):
        before = [path.read_bytes() for path in self.paths]
        result = self.service.create(self.paths, title='Habitación de prueba')
        self.assertEqual(result['origin'], 'user_provided_images')
        self.assertEqual(result['frames'][0]['label'], 'Vista 1')
        for index, frame in enumerate(result['frames']):
            original, mime, name = self.service.image(result['id'], frame['id'], variant='original')
            self.assertEqual(original, before[index])
            self.assertEqual(hashlib.sha256(original).hexdigest(), frame['sha256'])
            derivative, mime, name = self.service.image(result['id'], frame['id'])
            self.assertEqual(mime, 'image/jpeg')
            self.assertLessEqual(max(frame['thumbnail']['width'], frame['thumbnail']['height']), 1280)
            self.assertEqual(frame['model_input'], frame['thumbnail'])
            with Image.open(BytesIO(derivative)) as image:
                image.load()
                self.assertEqual(image.format, 'JPEG')
                self.assertEqual(len(image.getexif()), 0)
        encoded = json.dumps(result)
        self.assertNotIn(str(self.inputs), encoded)
        self.assertNotIn('personal-name', encoded)
        self.assertNotIn('relative_path', encoded)
        self.assertEqual([path.read_bytes() for path in self.paths], before)
        self.assertEqual(ReferenceSetService(self.root).get(result['id']), result)

    def test_duplicates_and_matching_dimensions_are_review_flags_not_geometry_claims(self):
        result = self.service.create([self.paths[0], self.paths[0]])
        preflight = result['preflight']
        self.assertEqual(preflight['exact_duplicate_groups'], [['frame-0000', 'frame-0001']])
        self.assertTrue(preflight['all_same_dimensions'])
        self.assertTrue(preflight['all_same_aspect_ratio'])
        self.assertFalse(preflight['ready_remote'])
        self.assertFalse(preflight['reconstruction']['model_executed'])
        self.assertFalse(preflight['physics']['metric_scale_verified'])
        self.assertTrue(all(value == 'pending' for value in preflight['human_review'].values()))
        for key in ('capture_timestamps', 'camera_intrinsics', 'camera_extrinsics', 'calibration', 'metric_scale'):
            self.assertEqual(preflight[key], 'unknown')
        self.assertFalse(result['package']['dispatch_enabled'])
        self.assertEqual(result['package']['ordered_frame_ids'], ['frame-0000', 'frame-0001'])

    def test_embedded_orientation_only_changes_derivative_and_alpha_is_flattened(self):
        exif = Image.Exif()
        exif[274] = 6
        exif[315] = 'Synthetic private author'
        rotated = self.image('rotated.jpg', (60, 40), (20, 40, 60), exif=exif)
        transparent = self.image('transparent.png', (60, 40), (0, 0, 0, 0))
        result = self.service.create([rotated, transparent])
        frame = result['frames'][0]
        self.assertEqual((frame['width'], frame['height']), (60, 40))
        self.assertEqual((frame['thumbnail']['width'], frame['thumbnail']['height']), (40, 60))
        self.assertEqual(frame['embedded_exif_orientation'], 6)
        self.assertEqual(result['preflight']['human_review']['orientation'], 'pending')
        self.assertEqual(self.service.image(result['id'], frame['id'], variant='original')[0], rotated.read_bytes())
        raw = self.service.image(result['id'], 'frame-0001')[0]
        with Image.open(BytesIO(raw)) as image:
            self.assertEqual(image.mode, 'RGB')
            self.assertGreater(min(image.getpixel((10, 10))), 250)
        self.assertNotIn('Synthetic private author', json.dumps(result))

    def test_counts_size_and_non_images_reject_without_partial_sets(self):
        for paths in ([], self.paths[:1], self.paths * 7, 'wrong', [None, None]):
            with self.assertRaises(ReferenceSetError): self.service.create(paths)
        invalid = self.inputs / 'pretend.png'
        invalid.write_bytes(b'not an image')
        with self.assertRaises(ReferenceSetError): self.service.create([self.paths[0], invalid])
        with patch('services.spatial.references.MAX_IMAGE_BYTES', 5):
            with self.assertRaises(ReferenceSetError): self.service.create(self.paths)
        with patch('services.spatial.references.MAX_TOTAL_BYTES', len(self.paths[0].read_bytes())):
            with self.assertRaises(ReferenceSetError): self.service.create(self.paths)
        self.assertEqual(list((self.root / 'reference-sets').iterdir()), [])

    def test_truncated_pixels_and_excessive_resolution_are_rejected(self):
        broken = self.inputs / 'broken.png'
        broken.write_bytes(self.paths[0].read_bytes()[:-20])
        with self.assertRaises(ReferenceSetError): self.service.create([self.paths[1], broken])
        with patch('services.spatial.references.MAX_PIXELS', 100):
            with self.assertRaises(ReferenceSetError): self.service.create(self.paths)
        self.assertEqual(list((self.root / 'reference-sets').iterdir()), [])

    def test_manifest_claims_paths_and_saved_bytes_are_checked(self):
        result = self.service.create(self.paths)
        manifest_path = self.folder(result) / 'references.json'
        good = json.loads(manifest_path.read_text(encoding='utf-8'))
        mutations = []
        bad = deepcopy(good); bad['preflight']['ready_remote'] = True; mutations.append(bad)
        bad = deepcopy(good); bad['frames'][0]['relative_path'] = '../../outside.png'; mutations.append(bad)
        bad = deepcopy(good); bad['frames'][0]['order'] = 1; mutations.append(bad)
        bad = deepcopy(good); bad['source_path'] = str(self.paths[0]); mutations.append(bad)
        for bad in mutations:
            manifest_path.write_text(json.dumps(bad), encoding='utf-8')
            with self.assertRaises(ReferenceSetError): self.service.get(result['id'])
        manifest_path.write_text(json.dumps(good), encoding='utf-8')
        derived = self.folder(result) / 'derived/frame-0000.jpg'
        derived.write_bytes(b'tampered')
        with self.assertRaises(ReferenceSetError): self.service.get(result['id'])
        with self.assertRaises(ReferenceSetError): self.service.image(result['id'], 'frame-0000')
        original = self.folder(result) / good['frames'][0]['relative_path']
        original.write_bytes(b'changed')
        with self.assertRaises(ReferenceSetError): self.service.image(result['id'], 'frame-0000', variant='original')

    def test_ids_variants_and_symlinks_cannot_escape_private_storage(self):
        result = self.service.create(self.paths)
        for bad in ('../.env', result['id'].upper(), 'not-a-uuid'):
            with self.assertRaises(ReferenceSetError): self.service.get(bad)
        for bad in ('../references.json', 'frame-0012', 'frame-0000/../frame-0001'):
            with self.assertRaises(ReferenceSetError): self.service.image(result['id'], bad)
        with self.assertRaises(ReferenceSetError): self.service.image(result['id'], 'frame-0000', variant='../../env')
        link = self.inputs / 'link.png'
        try: link.symlink_to(self.paths[0])
        except (OSError, NotImplementedError): return  # Windows may deny symlinks without developer mode.
        with self.assertRaises(ReferenceSetError): self.service.create([link, self.paths[1]])
        derived = self.folder(result) / 'derived/frame-0000.jpg'
        derived.unlink()
        derived.symlink_to(self.paths[0])
        with self.assertRaises(ReferenceSetError): self.service.image(result['id'], 'frame-0000')

    def test_read_only_missing_get_does_not_create_storage_and_cli_hides_input_paths(self):
        missing = self.base / 'never-created'
        with self.assertRaises(ReferenceSetError): ReferenceSetService(missing).get('11111111-1111-4111-8111-111111111111')
        self.assertFalse(missing.exists())
        output = StringIO()
        with redirect_stdout(output):
            status = main(['--root', str(self.root), 'create', *(str(path) for path in self.paths), '--title', 'Prueba CLI'])
        self.assertEqual(status, 0)
        summary = json.loads(output.getvalue())
        self.assertEqual(summary['frame_count'], 2)
        self.assertEqual(summary['external_calls'], 0)
        self.assertFalse(summary['model_executed'])
        self.assertNotIn(str(self.inputs), output.getvalue())
        output = StringIO()
        with redirect_stdout(output): status = main(['--root', str(self.root), 'inspect', summary['id']])
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(output.getvalue())['id'], summary['id'])


if __name__ == '__main__':
    unittest.main()
