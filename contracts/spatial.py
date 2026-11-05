"""Spatial preview contracts. Evidence and assumptions are separate from geometry.

These schemas validate structure, not reconstruction accuracy or physical realism.
They do not dispatch GPU work, certify metric dimensions, or execute model output.
"""
from __future__ import annotations

import math
from pathlib import PurePosixPath
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from contracts.room_evidence import RoomEvidence


Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
FrameId = Annotated[str, Field(pattern=r"^frame-[0-9]{4}$")]
AssetId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{0,79}$")]


class SpatialContract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False,
                              str_strip_whitespace=True, frozen=True)


class CaptureSource(SpatialContract):
    filename: str = Field(min_length=1, max_length=180)
    sha256: Sha256
    size_bytes: int = Field(gt=0, le=25 * 1024 * 1024)
    duration_seconds: float = Field(gt=0, le=60)
    width: int = Field(gt=0, le=7680)
    height: int = Field(gt=0, le=7680)
    has_audio: bool

    @model_validator(mode="after")
    def basename_only(self):
        if any(char in self.filename for char in ("/", "\\", ":")) or any(ord(char) < 32 for char in self.filename):
            raise ValueError("Capture filenames must be basenames, without paths or control characters")
        return self


class CaptureFrame(SpatialContract):
    id: FrameId
    relative_path: str = Field(pattern=r"^frames/frame-[0-9]{4}\.jpg$")
    at_seconds: float = Field(ge=0)
    timestamp_basis: Literal["requested_seek"] = "requested_seek"
    width: int = Field(gt=0, le=1280)
    height: int = Field(gt=0, le=1280)
    sha256: Sha256

    @model_validator(mode="after")
    def path_matches_id(self):
        if self.relative_path != f"frames/{self.id}.jpg":
            raise ValueError("Frame path must match its identifier")
        return self


class ScaleReference(SpatialContract):
    description: str = Field(min_length=1, max_length=300)
    length_m: float = Field(gt=0, le=1000)
    provenance: Literal["user_declared"] = "user_declared"


class CaptureManifest(SpatialContract):
    schema_version: Literal["0.1.0"] = "0.1.0"
    capture_id: UUID
    source: CaptureSource
    frames: list[CaptureFrame] = Field(min_length=1, max_length=8)
    calibration: ScaleReference | None = None

    @model_validator(mode="after")
    def coherent_frames(self):
        ids = [frame.id for frame in self.frames]
        times = [frame.at_seconds for frame in self.frames]
        if len(ids) != len(set(ids)) or len(times) != len(set(times)):
            raise ValueError("Frames and sample times must be distinct")
        if times != sorted(times) or any(at >= self.source.duration_seconds for at in times):
            raise ValueError("Frame times must increase and remain inside the capture")
        return self


class ReconstructionPlan(SpatialContract):
    schema_version: Literal["0.1.0"] = "0.1.0"
    capture_id: UUID
    mode: Literal["preview"] = "preview"
    execution_target: Literal["modal"] = "modal"
    stages: list[Literal["segmentation", "camera_depth", "object_reconstruction", "scene_assembly"]] = Field(
        default_factory=lambda: ["segmentation", "camera_depth", "object_reconstruction", "scene_assembly"],
        min_length=1, max_length=4)
    max_frames: int = Field(default=6, ge=1, le=8)
    max_objects: int = Field(default=3, ge=1, le=10)
    gpu_seconds_limit: int = Field(default=180, ge=1, le=900)
    requires_gpu: Literal[True] = True
    dispatch_enabled: Literal[False] = False

    @model_validator(mode="after")
    def unique_stages(self):
        if len(self.stages) != len(set(self.stages)):
            raise ValueError("Reconstruction stages must be distinct")
        return self


class SceneAsset(SpatialContract):
    id: AssetId
    kind: Literal["mesh", "splat"]
    relative_path: str = Field(pattern=r"^assets/[a-z][a-z0-9_-]{0,79}\.(glb|ply)$")
    sha256: Sha256
    provenance: Literal["observed", "inferred", "generated"]
    source_frame_ids: list[FrameId] = Field(max_length=8)
    note: str = Field(min_length=1, max_length=600)

    @model_validator(mode="after")
    def coherent_asset(self):
        extension = PurePosixPath(self.relative_path).suffix
        if extension != {"mesh": ".glb", "splat": ".ply"}[self.kind]:
            raise ValueError("Asset type and extension differ")
        if self.provenance != "generated" and not self.source_frame_ids:
            raise ValueError("Observed or inferred assets need capture references")
        if len(set(self.source_frame_ids)) != len(self.source_frame_ids):
            raise ValueError("Asset source references must be distinct")
        return self


class Transform(SpatialContract):
    position: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], min_length=3, max_length=3)
    rotation_xyzw: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0, 1.0], min_length=4, max_length=4)
    scale: list[float] = Field(default_factory=lambda: [1.0, 1.0, 1.0], min_length=3, max_length=3)

    @model_validator(mode="after")
    def normalized_rotation(self):
        norm = math.sqrt(sum(value * value for value in self.rotation_xyzw))
        if not math.isclose(norm, 1, abs_tol=1e-4) or any(value <= 0 for value in self.scale):
            raise ValueError("Transforms require a unit quaternion and positive scale")
        return self


class PhysicsProperties(SpatialContract):
    body_type: Literal["static", "dynamic", "kinematic"] = "static"
    collider: Literal["none", "box", "convex_hull", "mesh"] = "none"
    collider_provenance: Literal["not_set", "simplified", "measured"] = "not_set"
    mass_kg: float | None = Field(default=None, gt=0, le=1_000_000)
    mass_provenance: Literal["unknown", "assumed", "measured"] = "unknown"
    friction: float = Field(default=0.5, ge=0, le=10)
    friction_provenance: Literal["assumed", "measured"] = "assumed"
    restitution: float = Field(default=0.0, ge=0, le=1)
    restitution_provenance: Literal["assumed", "measured"] = "assumed"
    measurement_note: str | None = Field(default=None, min_length=1, max_length=600)

    @model_validator(mode="after")
    def declared_physics(self):
        if (self.mass_kg is None) != (self.mass_provenance == "unknown"):
            raise ValueError("Mass requires a value and explicit provenance, or unknown")
        if (self.collider == "none") != (self.collider_provenance == "not_set"):
            raise ValueError("Collider provenance must describe an existing collider")
        if self.body_type == "dynamic" and (self.mass_kg is None or self.collider == "none"):
            raise ValueError("Dynamic bodies need declared mass and a collider")
        if self.body_type == "dynamic" and self.collider == "mesh":
            raise ValueError("Preview dynamics use box or convex colliders, not triangle meshes")
        if "measured" in (self.collider_provenance, self.mass_provenance, self.friction_provenance, self.restitution_provenance) and not self.measurement_note:
            raise ValueError("Measured physical properties require a measurement note")
        return self


class MetricVerification(SpatialContract):
    reference: ScaleReference
    meters_per_unit: float = Field(gt=0, le=1000)
    method: Literal["measured_reference", "calibrated_depth"]
    verified_by: Literal["human", "sensor"]
    evidence_note: str = Field(min_length=1, max_length=600)


class SceneObject(SpatialContract):
    id: AssetId
    label: str = Field(min_length=1, max_length=160)
    asset_id: AssetId
    transform: Transform = Field(default_factory=Transform)
    physics: PhysicsProperties = Field(default_factory=PhysicsProperties)
    skill_ids: list[UUID] = Field(default_factory=list, max_length=20)
    editable: bool = True
    role: Literal["object", "environment"] = "object"


class SceneManifest(SpatialContract):
    schema_version: Literal["0.1.0"] = "0.1.0"
    scene_id: UUID
    capture_id: UUID | None = None
    reference_set_id: UUID | None = None
    origin: Literal["capture_reconstruction", "room_reconstruction", "generated_demo", "reference_interpretation"] = "capture_reconstruction"
    title: str = Field(min_length=1, max_length=180)
    status: Literal["preview_unverified"] = "preview_unverified"
    coordinate_system: Literal["right_handed_y_up"] = "right_handed_y_up"
    units: Literal["source_relative", "meters"] = "source_relative"
    metric_verification: MetricVerification | None = None
    reconstruction:RoomEvidence|None=None
    source_frame_ids: list[FrameId] = Field(default_factory=list, max_length=8)
    assets: list[SceneAsset] = Field(min_length=1, max_length=100)
    objects: list[SceneObject] = Field(min_length=1, max_length=100)
    limitations: list[Annotated[str, Field(min_length=1, max_length=600)]] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def coherent_scene(self):
        if self.origin in {"capture_reconstruction","room_reconstruction"} and (self.capture_id is None or not self.source_frame_ids):
            raise ValueError("Capture reconstruction requires real capture and frame references")
        if self.origin=='room_reconstruction':
            room=self.reconstruction
            if room is None or self.units!='source_relative' or self.source_frame_ids!=[item.frame_id for item in room.cameras]:raise ValueError('Room reconstruction needs unverified relative geometry and its original cameras')
            if len(self.assets)!=1 or self.assets[0].sha256!=room.artifact_sha256 or self.assets[0].provenance!='inferred':raise ValueError('Room geometry must retain the source artifact')
            if len(self.objects)!=1 or self.objects[0].role!='environment' or self.objects[0].editable or self.objects[0].physics.collider!='none':raise ValueError('Observed room surface is fixed, not a separated movable object or collider')
            obj=self.objects[0]
            if obj.transform.position!=[0,0,0] or obj.transform.rotation_xyzw!=[0,0,0,1] or obj.transform.scale!=[1,1,1] or obj.physics.body_type!='static':raise ValueError('Room surface must keep its original fixed coordinate system')
        elif self.reconstruction is not None:raise ValueError('Room provenance belongs only to a room reconstruction')
        if self.origin == "generated_demo" and (self.capture_id is not None or self.source_frame_ids or
                self.reference_set_id is not None or any(asset.provenance != "generated" or asset.source_frame_ids for asset in self.assets)):
            raise ValueError("Generated demos must not invent capture evidence")
        if self.origin == 'reference_interpretation' and (self.reference_set_id is None or self.capture_id is not None or
                self.source_frame_ids or any(asset.provenance != 'generated' or asset.source_frame_ids for asset in self.assets)):
            raise ValueError('Reference interpretations need a reference set, never inferred capture evidence')
        if self.origin != 'reference_interpretation' and self.reference_set_id is not None:
            raise ValueError('Reference sets belong to explicitly identified interpretations')
        if (self.units == "meters") != (self.metric_verification is not None):
            raise ValueError("Metric geometry requires explicit scale verification")
        for values in ([asset.id for asset in self.assets], [item.id for item in self.objects], self.source_frame_ids):
            if len(values) != len(set(values)):
                raise ValueError("Scene identifiers must be distinct")
        assets = {asset.id: asset for asset in self.assets}
        for asset in self.assets:
            if not set(asset.source_frame_ids).issubset(self.source_frame_ids):
                raise ValueError("Asset references an absent capture frame")
        for item in self.objects:
            if item.asset_id not in assets:
                raise ValueError("Object references an absent asset")
            if item.physics.collider != "none" and assets[item.asset_id].kind != "mesh":
                raise ValueError("A visual splat is not a collision mesh")
            if item.physics.body_type == "dynamic" and self.units != "meters":
                raise ValueError("Metric scale is required before enabling physical dynamics")
        return self


def spatial_schemas() -> dict[str, dict]:
    return {model.__name__: model.model_json_schema() for model in (CaptureManifest, ReconstructionPlan, SceneManifest)}
