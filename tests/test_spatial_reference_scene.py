"""Objective checks on a manual procedural interpretation, never fidelity tests."""
from io import BytesIO
import hashlib
import json
import math
import struct
import unittest

from PIL import Image

from workers.spatial_runtime import validate_glb


SCENE_ID = '22222222-2222-4222-8222-222222222222'
REFERENCE_ID = '33333333-3333-4333-8333-333333333333'


def glb_parts(raw):
    offset, document, binary = 12, None, None
    while offset < len(raw):
        length, kind = struct.unpack_from('<I4s', raw, offset)
        content = raw[offset + 8:offset + 8 + length]
        if kind == b'JSON': document = json.loads(content)
        if kind == b'BIN\0': binary = content
        offset += 8 + length
    return document, binary


def values(document, binary, index):
    accessor = document['accessors'][index]
    view = document['bufferViews'][accessor['bufferView']]
    components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    code = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[accessor['componentType']]
    packed = struct.Struct('<' + code * components)
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', packed.size)
    return [packed.unpack_from(binary, start + row * stride) for row in range(accessor['count'])]


def transform(point, node):
    scale = node.get('scale', [1, 1, 1])
    x, y, z = (point[i] * scale[i] for i in range(3))
    qx, qy, qz, qw = node.get('rotation', [0, 0, 0, 1])
    # q * p * conjugate(q), with a normalized glTF quaternion.
    tx, ty, tz = 2 * (qy * z - qz * y), 2 * (qz * x - qx * z), 2 * (qx * y - qy * x)
    rotated = [x + qw * tx + qy * tz - qz * ty,
               y + qw * ty + qz * tx - qx * tz,
               z + qw * tz + qx * ty - qy * tx]
    return [rotated[i] + node.get('translation', [0, 0, 0])[i] for i in range(3)]


def node_points(document, binary, node_index, ancestors=()):
    node = document['nodes'][node_index]
    chain = ancestors + (node,)
    if 'mesh' in node:
        for primitive in document['meshes'][node['mesh']]['primitives']:
            for point in values(document, binary, primitive['attributes']['POSITION']):
                for current in reversed(chain):
                    point = transform(point, current)
                yield point
    for child in node.get('children', []):
        yield from node_points(document, binary, child, chain)


class SpatialReferenceSceneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from services.spatial.reference_scene import scene_document
        cls.build = staticmethod(scene_document)
        cls.scene, cls.assets, cls.render = cls.build(SCENE_ID, 'Interpretación local de prueba', REFERENCE_ID)

    def test_valid_glb_assets_and_real_resource_budgets(self):
        self.assertIsInstance(self.scene, dict)
        self.assertIsInstance(self.render, dict)
        self.assertLessEqual(len(self.scene['objects']), 22)
        self.assertLess(sum(len(raw) for raw in self.assets.values()), 12 * 1024 * 1024)
        self.assertEqual({asset['id'] for asset in self.scene['assets']}, set(self.assets))
        per_asset_triangles, per_asset_primitives = {}, {}
        for asset in self.scene['assets']:
            raw = self.assets[asset['id']]
            validate_glb(raw)
            self.assertEqual(hashlib.sha256(raw).hexdigest(), asset['sha256'])
            document, binary = glb_parts(raw)
            triangles, primitives = 0, 0
            for node in document['nodes']:
                if 'mesh' not in node: continue
                for primitive in document['meshes'][node['mesh']]['primitives']:
                    index = document['accessors'][primitive['indices']]
                    self.assertEqual(index['count'] % 3, 0)
                    triangles += index['count'] // 3
                    primitives += 1
            per_asset_triangles[asset['id']] = triangles
            per_asset_primitives[asset['id']] = primitives
        # A shared chair GLB is drawn six times; the scene budget counts every
        # object instance rather than only the unique downloaded assets.
        triangles = sum(per_asset_triangles[item['asset_id']] for item in self.scene['objects'])
        primitives = sum(per_asset_primitives[item['asset_id']] for item in self.scene['objects'])
        self.assertGreater(triangles, 0)
        self.assertLess(triangles, 80_000)
        self.assertGreater(primitives, 0)
        self.assertLessEqual(primitives, 100)

    def test_embedded_png_textures_uv_normals_and_indices_are_usable(self):
        image_count = 0
        for asset_id, raw in self.assets.items():
            document, binary = glb_parts(raw)
            image_count += len(document.get('images', []))
            for image in document.get('images', []):
                self.assertNotIn('uri', image)
                self.assertEqual(image['mimeType'], 'image/png')
                view = document['bufferViews'][image['bufferView']]
                start = view.get('byteOffset', 0)
                encoded = binary[start:start + view['byteLength']]
                with Image.open(BytesIO(encoded)) as texture:
                    texture.load()
                    self.assertEqual(texture.format, 'PNG')
                    self.assertLessEqual(max(texture.size), 1024)
            for mesh in document['meshes']:
                for primitive in mesh['primitives']:
                    attributes = primitive['attributes']
                    self.assertTrue({'POSITION', 'NORMAL', 'TEXCOORD_0'}.issubset(attributes), asset_id)
                    positions = values(document, binary, attributes['POSITION'])
                    normals = values(document, binary, attributes['NORMAL'])
                    uv = values(document, binary, attributes['TEXCOORD_0'])
                    self.assertEqual(len(positions), len(normals))
                    self.assertEqual(len(positions), len(uv))
                    self.assertTrue(all(math.isfinite(value) for row in positions + normals + uv for value in row))
                    for normal in normals:
                        self.assertAlmostEqual(sum(value * value for value in normal), 1, delta=.001)
                    for index in values(document, binary, primitive['indices']):
                        self.assertGreaterEqual(index[0], 0)
                        self.assertLess(index[0], len(positions))
                    material = document['materials'][primitive['material']]['pbrMetallicRoughness']
                    if 'baseColorTexture' in material:
                        texture = document['textures'][material['baseColorTexture']['index']]
                        self.assertLess(texture['source'], len(document['images']))
        self.assertGreater(image_count, 0)

    def test_editable_furniture_pivots_touch_local_floor_without_metric_claim(self):
        editable = [item for item in self.scene['objects'] if item['editable']]
        self.assertTrue(editable)
        for item in editable:
            document, binary = glb_parts(self.assets[item['asset_id']])
            roots = document['scenes'][document.get('scene', 0)]['nodes']
            heights = [point[1] for root in roots for point in node_points(document, binary, root)]
            self.assertTrue(heights, item['id'])
            self.assertAlmostEqual(min(heights), 0, delta=.025, msg=item['id'])
            self.assertGreater(max(heights), 0)
        self.assertEqual(self.scene['units'], 'source_relative')
        self.assertIsNone(self.scene.get('metric_verification'))

    def test_generation_is_deterministic_and_claims_manual_interpretation(self):
        scene, assets, render = self.build(SCENE_ID, 'Interpretación local de prueba', REFERENCE_ID)
        self.assertEqual((scene, assets, render), (self.scene, self.assets, self.render))
        self.assertEqual(scene['origin'], 'reference_interpretation')
        self.assertEqual(scene['reference_set_id'], REFERENCE_ID)
        self.assertIsNone(scene.get('capture_id'))
        self.assertEqual(scene['source_frame_ids'], [])
        self.assertEqual(scene['status'], 'preview_unverified')
        self.assertTrue(scene['limitations'])
        self.assertTrue(any(word in ' '.join(scene['limitations']).lower() for word in ('manual', 'interpret')))
        for asset in scene['assets']:
            self.assertEqual(asset['provenance'], 'generated')
            self.assertEqual(asset['source_frame_ids'], [])
        for item in scene['objects']:
            physics = item.get('physics', {})
            self.assertEqual(physics.get('body_type', 'static'), 'static')
            self.assertEqual(physics.get('collider', 'none'), 'none')
            self.assertIsNone(physics.get('mass_kg'))
            self.assertNotEqual(physics.get('mass_provenance'), 'measured')
            self.assertNotEqual(physics.get('friction_provenance'), 'measured')
            if item['role'] == 'environment': self.assertFalse(item['editable'])
        json.dumps(render, allow_nan=False)

    def test_render_configuration_has_bounded_cameras_light_and_separate_obstacle_boxes(self):
        presets = self.render['camera_presets']
        self.assertGreaterEqual(len(presets), 2)
        self.assertEqual(len({preset['id'] for preset in presets}), len(presets))
        for preset in presets:
            for key in ('position', 'target'):
                self.assertEqual(len(preset[key]), 3)
                self.assertTrue(all(type(value) in {int, float} and math.isfinite(value) for value in preset[key]))
            self.assertGreater(sum((a - b) ** 2 for a, b in zip(preset['position'], preset['target'])), 0)
            self.assertGreater(preset['fov'], 10)
            self.assertLess(preset['fov'], 100)
        sun = self.render['sun']
        self.assertGreater(sun['intensity'], 0)
        self.assertTrue(math.isfinite(sun['intensity']))
        for key in ('position', 'target'):
            self.assertEqual(len(sun[key]), 3)
            self.assertTrue(all(math.isfinite(value) for value in sun[key]))
        boxes = self.render['environmentBoxes']
        self.assertTrue(boxes)
        self.assertEqual(len({box['id'] for box in boxes}), len(boxes))
        for box in boxes:
            self.assertEqual(len(box['position']), 3)
            self.assertEqual(len(box['halfExtents']), 3)
            self.assertTrue(all(math.isfinite(value) for value in box['position']))
            self.assertTrue(all(math.isfinite(value) and value > 0 for value in box['halfExtents']))


if __name__ == '__main__':
    unittest.main()
