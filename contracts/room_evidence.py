"""Portable numerical room provenance; structure is not physical verification."""
from typing import Annotated,Literal
from uuid import UUID
from pydantic import BaseModel,ConfigDict,Field,field_validator,model_validator

Hash=Annotated[str,Field(pattern='^[a-f0-9]{64}$')]
Frame=Annotated[str,Field(pattern='^frame-[0-9]{4}$')]
V3=Annotated[list[float],Field(min_length=3,max_length=3)]
V4=Annotated[list[float],Field(min_length=4,max_length=4)]


class RoomEvidenceModel(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True,allow_inf_nan=False,frozen=True)


class RoomCamera(RoomEvidenceModel):
    frame_id:Frame
    at_seconds:float=Field(ge=0,le=60)
    intrinsic:Annotated[list[V3],Field(min_length=3,max_length=3)]
    world_to_camera_opencv:Annotated[list[V4],Field(min_length=3,max_length=3)]
    camera_to_viewer:Annotated[list[V4],Field(min_length=4,max_length=4)]
    image_bounds:V4

    @model_validator(mode='after')
    def numerical_bounds(self):
        values=[item for matrix in (self.intrinsic,self.world_to_camera_opencv,self.camera_to_viewer) for row in matrix for item in row]
        if any(abs(item)>1e7 for item in values) or any(not 0<=item<=518 for item in self.image_bounds):raise ValueError('Room camera exceeds numerical bounds')
        if self.intrinsic[2]!=[0,0,1] or self.intrinsic[0][0]<=0 or self.intrinsic[1][1]<=0 or self.camera_to_viewer[3]!=[0,0,0,1]:raise ValueError('Room camera has invalid homogeneous coordinates')
        if abs(self.intrinsic[0][1])>1e-6 or abs(self.intrinsic[1][0])>1e-6:raise ValueError('Unsupported camera skew')
        rotation=[row[:3] for row in self.world_to_camera_opencv];translation=[row[3] for row in self.world_to_camera_opencv]
        for a in range(3):
            for b in range(3):
                if abs(sum(rotation[a][k]*rotation[b][k] for k in range(3))-(1 if a==b else 0))>1e-3:raise ValueError('Camera rotation is not rigid')
        determinant=(rotation[0][0]*(rotation[1][1]*rotation[2][2]-rotation[1][2]*rotation[2][1])-
            rotation[0][1]*(rotation[1][0]*rotation[2][2]-rotation[1][2]*rotation[2][0])+
            rotation[0][2]*(rotation[1][0]*rotation[2][1]-rotation[1][1]*rotation[2][0]))
        if abs(determinant-1)>1e-3:raise ValueError('Camera rotation changes handedness')
        for a,sign in enumerate((1,-1,-1)):
            if any(abs(self.camera_to_viewer[a][b]-sign*rotation[b][a])>1e-5 for b in range(3)):raise ValueError('Camera transforms disagree')
            expected=-sign*sum(rotation[k][a]*translation[k] for k in range(3))
            if abs(self.camera_to_viewer[a][3]-expected)>1e-5*max(1,abs(expected)):raise ValueError('Camera translations disagree')
        if self.image_bounds[2]<=self.image_bounds[0] or self.image_bounds[3]<=self.image_bounds[1]:raise ValueError('Room camera has empty supported image bounds')
        return self


class RoomFrameReport(RoomEvidenceModel):
    frame_id:Frame
    sampled_image_pixels:int=Field(ge=0,le=8*518*518)
    invalid_depth_or_confidence_pixels:int=Field(ge=0,le=8*518*518)
    low_confidence_pixels:int=Field(ge=0,le=8*518*518)
    confidence_score_threshold:float|None=Field(default=None,ge=0)
    candidate_triangles:int=Field(ge=0,le=8*518*518)
    triangles_rejected_missing_samples:int=Field(ge=0,le=8*518*518)
    triangles_rejected_discontinuity_or_degenerate:int=Field(ge=0,le=8*518*518)
    triangles_retained:int=Field(ge=0,le=300000)

    @model_validator(mode='after')
    def triangle_accounting(self):
        if self.invalid_depth_or_confidence_pixels+self.low_confidence_pixels>self.sampled_image_pixels:raise ValueError('Rejected pixels exceed samples')
        if self.triangles_retained and self.confidence_score_threshold is None:raise ValueError('Retained triangles need a confidence threshold')
        if self.candidate_triangles!=self.triangles_rejected_missing_samples+self.triangles_rejected_discontinuity_or_degenerate+self.triangles_retained:raise ValueError('Room triangle accounting does not agree')
        return self


class RoomEvidence(RoomEvidenceModel):
    format:Literal['brivany-room-evidence-1']='brivany-room-evidence-1'
    job_id:UUID
    dispatch_identity:Hash
    pipeline_version:str=Field(pattern='^[a-z0-9._-]{1,80}$')
    source_sha256:Hash
    artifact_sha256:Hash
    surface_sha256:Hash
    geometry_kind:Literal['per_view_image_supported_depth_surface']
    vertex_count:int=Field(ge=3,le=180000)
    triangle_count:int=Field(ge=1,le=300000)
    cameras:Annotated[list[RoomCamera],Field(min_length=2,max_length=8)]
    frame_reports:Annotated[list[RoomFrameReport],Field(min_length=2,max_length=8)]
    holes_filled:Literal[False]=False
    cross_view_fusion:Literal[False]=False
    confidence_is_probability:Literal[False]=False
    colors_include_captured_lighting:Literal[True]=True
    unknown_surfaces:Literal['unrepresented']='unrepresented'
    camera_orientation_verified:Literal[False]=False
    scene_coverage_verified:Literal[False]=False
    geometry_fidelity_verified:Literal[False]=False
    metric_scale_verified:Literal[False]=False
    physical_realism_verified:Literal[False]=False

    @field_validator('holes_filled','cross_view_fusion','confidence_is_probability','colors_include_captured_lighting',
        'camera_orientation_verified','scene_coverage_verified','geometry_fidelity_verified','metric_scale_verified','physical_realism_verified',mode='before')
    @classmethod
    def actual_booleans(cls,value):
        if type(value) is not bool:raise ValueError('Evidence flags must be JSON booleans')
        return value

    @model_validator(mode='after')
    def source_coherence(self):
        frames=[item.frame_id for item in self.cameras]
        if len(set(frames))!=len(frames) or frames!=[item.frame_id for item in self.frame_reports]:raise ValueError('Room cameras/reports need matching unique frames')
        if any(after.at_seconds<=before.at_seconds for before,after in zip(self.cameras,self.cameras[1:])):raise ValueError('Room camera times must be ordered')
        if sum(item.triangles_retained for item in self.frame_reports)!=self.triangle_count:raise ValueError('Room triangle count differs from its frame reports')
        return self
