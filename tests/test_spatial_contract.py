"""Spatial evidence and physical assumptions; no network, provider or GPU calls."""
from copy import deepcopy
import json
import unittest
from uuid import uuid4

from pydantic import ValidationError
from contracts.spatial import CaptureManifest, ReconstructionPlan, SceneManifest, spatial_schemas


def capture():
    return {"capture_id": uuid4(), "source": {"filename": "room.mp4", "sha256": "a" * 64,
        "size_bytes": 4000, "duration_seconds": 12.0, "width": 1920, "height": 1080, "has_audio": False},
        "frames": [{"id": "frame-0000", "relative_path": "frames/frame-0000.jpg", "at_seconds": 1.0,
                    "width": 1024, "height": 576, "sha256": "b" * 64}],
        "calibration": {"description": "Ancho declarado de la puerta", "length_m": 0.8}}


def scene():
    return {"scene_id": uuid4(), "capture_id": uuid4(), "title": "Cuarto de prueba",
        "source_frame_ids": ["frame-0000"],
        "assets": [{"id": "chair-mesh", "kind": "mesh", "relative_path": "assets/chair.glb",
                    "sha256": "c" * 64, "provenance": "inferred", "source_frame_ids": ["frame-0000"],
                    "note": "Las superficies ocultas son inferidas."}],
        "objects": [{"id": "chair", "label": "Silla", "asset_id": "chair-mesh"}],
        "limitations": ["Reconstrucción aproximada, sin calibración métrica."]}


class SpatialContractTests(unittest.TestCase):
    def test_capture_preserves_declared_scale_without_certifying_geometry(self):
        manifest = CaptureManifest.model_validate(capture())
        self.assertEqual(manifest.calibration.provenance, "user_declared")
        self.assertNotIn("units", manifest.model_dump())
        self.assertEqual(CaptureManifest.model_validate_json(manifest.model_dump_json()), manifest)

    def test_capture_rejects_out_of_bounds_duplicate_or_nonfinite_times(self):
        for at in (12.0, 13.0, float("nan"), float("inf"), -1.0):
            value = capture(); value["frames"][0]["at_seconds"] = at
            with self.subTest(at=at), self.assertRaises(ValidationError): CaptureManifest.model_validate(value)
        value = capture(); value["frames"].append(deepcopy(value["frames"][0]))
        with self.assertRaises(ValidationError): CaptureManifest.model_validate(value)

    def test_paths_are_relative_assets_not_urls_or_traversals(self):
        for path in ("../frame.jpg", "C:/room.jpg", "https://example.com/frame.jpg", "frames/frame-0001.jpg"):
            value = capture(); value["frames"][0]["relative_path"] = path
            with self.subTest(path=path), self.assertRaises(ValidationError): CaptureManifest.model_validate(value)
        for path in ("../secret.glb", "assets/../../secret.glb", "https://example.com/a.glb", "assets/a.ply"):
            value = scene(); value["assets"][0]["relative_path"] = path
            with self.subTest(path=path), self.assertRaises(ValidationError): SceneManifest.model_validate(value)

    def test_plan_is_bounded_and_never_dispatches(self):
        plan = ReconstructionPlan(capture_id=uuid4())
        self.assertFalse(plan.dispatch_enabled); self.assertEqual(plan.execution_target, "modal")
        for change in ({"dispatch_enabled": True}, {"gpu_seconds_limit": 901}, {"max_frames": 9},
                       {"stages": ["object_reconstruction", "object_reconstruction"]}, {"execute": "shell"}):
            with self.subTest(change=change), self.assertRaises(ValidationError):
                ReconstructionPlan(capture_id=uuid4(), **change)

    def test_scene_references_must_exist(self):
        value = scene(); value["objects"][0]["asset_id"] = "missing"
        with self.assertRaises(ValidationError): SceneManifest.model_validate(value)
        value = scene(); value["assets"][0]["source_frame_ids"] = ["frame-0002"]
        with self.assertRaises(ValidationError): SceneManifest.model_validate(value)
        value = scene(); value["assets"][0]["source_frame_ids"] = []
        with self.assertRaises(ValidationError): SceneManifest.model_validate(value)

    def test_metric_units_need_verification_and_dynamic_bodies_need_scale(self):
        value = scene(); value["units"] = "meters"
        with self.assertRaises(ValidationError): SceneManifest.model_validate(value)
        value = scene(); value["objects"][0]["physics"] = {"body_type": "dynamic", "mass_kg": 3.0,
            "mass_provenance": "assumed", "collider": "box", "collider_provenance": "simplified"}
        with self.assertRaises(ValidationError): SceneManifest.model_validate(value)
        value["units"] = "meters"
        value["metric_verification"] = {"reference": {"description": "Referencia medida", "length_m": 1.0},
            "meters_per_unit": 0.5, "method": "measured_reference", "verified_by": "human", "evidence_note": "Comparación registrada con una regla."}
        result = SceneManifest.model_validate(value)
        self.assertEqual(result.objects[0].physics.mass_provenance, "assumed")
        self.assertEqual(result.status, "preview_unverified")

    def test_splats_cannot_masquerade_as_collision_meshes(self):
        value = scene(); value["assets"][0].update(kind="splat", relative_path="assets/chair.ply")
        value["objects"][0]["physics"] = {"collider": "convex_hull", "collider_provenance": "simplified"}
        with self.assertRaises(ValidationError): SceneManifest.model_validate(value)

    def test_physical_measurements_and_transforms_need_explicit_valid_evidence(self):
        for change in ({"mass_kg": 2.0}, {"friction_provenance": "measured"}, {"restitution": 1.1},
                       {"mass_kg": -2.0, "mass_provenance": "assumed"}):
            value = scene(); value["objects"][0]["physics"] = change
            with self.subTest(change=change), self.assertRaises(ValidationError): SceneManifest.model_validate(value)
        for transform in ({"position": [float("inf"), 0.0, 0.0]}, {"rotation_xyzw": [0.0, 0.0, 0.0, 0.0]}, {"scale": [-1.0, 1.0, 1.0]}):
            value = scene(); value["objects"][0]["transform"] = transform
            with self.subTest(transform=transform), self.assertRaises(ValidationError): SceneManifest.model_validate(value)

    def test_schema_export_does_not_modify_legacy_contracts(self):
        schemas = spatial_schemas()
        self.assertEqual(set(schemas), {"CaptureManifest", "ReconstructionPlan", "SceneManifest"})
        self.assertFalse(schemas["SceneManifest"]["additionalProperties"])
        self.assertIn('"const": false', json.dumps(schemas["ReconstructionPlan"]))


if __name__ == "__main__": unittest.main()
