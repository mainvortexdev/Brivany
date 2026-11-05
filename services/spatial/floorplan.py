"""Geometry-derived plan projection, not a reconstructed or certified survey.

GLB vertices and current scene transforms are the source of truth. Object hulls
are conservative projections; architectural lines are a horizontal mesh section.
Measurements entered by a user fit a scale but never verify geometry or coverage.
This module has no provider, file execution, network or implicit persistence.
"""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import hashlib
import json
import math
import struct
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from contracts.spatial import SceneManifest
from workers.spatial_runtime import validate_glb

MAX_TRIANGLES = 400_000
MAX_SEGMENTS = 20_000
MAX_COORDINATE = 100_000


class FloorPlanError(ValueError):
    def __init__(self, code, message, status=422):
        self.code, self.status = code, status
        super().__init__(message)


def _fail(message='La geometría del plano no cumple los límites locales.'):
    raise FloorPlanError('floorplan_geometry', message)


class _Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False,
                              str_strip_whitespace=True, frozen=True)


Point = list[float]


def _point(point):
    if len(point) != 2 or any(not math.isfinite(v) or abs(v) > MAX_COORDINATE for v in point):
        raise ValueError('Use two finite scene coordinates')


class PlanReference(_Contract):
    id: str = Field(pattern=r'^[a-z][a-z0-9_-]{0,79}$')
    points: list[Point] = Field(min_length=2, max_length=2)
    measured_m: float = Field(gt=0, le=1000)
    method: Literal['tape_measure', 'laser', 'other']
    note: str = Field(min_length=1, max_length=300)
    provenance: Literal['user_declared'] = 'user_declared'

    @model_validator(mode='after')
    def coherent(self):
        for point in self.points: _point(point)
        if math.dist(*self.points) < 1e-6 or any(ord(c) < 32 for c in self.note):
            raise ValueError('A reference needs distinct points and a measurement note')
        return self


class PlanAnnotation(_Contract):
    id: str = Field(pattern=r'^[a-z][a-z0-9_-]{0,79}$')
    kind: Literal['door', 'window', 'opening', 'note']
    points: list[Point] = Field(min_length=2, max_length=2)
    label: str = Field(min_length=1, max_length=160)
    provenance: Literal['user_declared', 'author_estimated']
    note: str = Field(min_length=1, max_length=300)

    @model_validator(mode='after')
    def coherent(self):
        for point in self.points: _point(point)
        if math.dist(*self.points) < 1e-6 or any(ord(c) < 32 for c in self.label+self.note):
            raise ValueError('An opening annotation needs explicit finite endpoints and provenance')
        return self


class UncertaintyZone(_Contract):
    id: str = Field(pattern=r'^[a-z][a-z0-9_-]{0,79}$')
    polygon: list[Point] = Field(min_length=3, max_length=100)
    reason: str = Field(min_length=1, max_length=400)
    provenance: Literal['derived_unverified', 'user_declared', 'author_estimated']
    verified: Literal[False] = False

    @model_validator(mode='after')
    def coherent(self):
        for point in self.polygon: _point(point)
        if any(ord(c) < 32 for c in self.reason): raise ValueError('Invalid reason')
        return self


class Footprint(_Contract):
    id: str
    label: str
    role: Literal['object', 'environment']
    editable: bool
    asset_id: str
    asset_sha256: str
    provenance: Literal['observed', 'inferred', 'generated']
    polygon: list[Point]
    y_min: float
    y_max: float
    overhead: bool
    geometry_method: Literal['projected_convex_hull'] = 'projected_convex_hull'


class SectionSegment(_Contract):
    object_id: str
    points: list[Point]
    provenance: Literal['observed', 'inferred', 'generated']


class PlanScale(_Contract):
    status: Literal['source_relative', 'scene_documented_unchecked', 'user_declared_fit']
    label: str
    meters_per_unit: float | None
    metric_scale_verified: Literal[False] = False
    independent_validation: Literal[False] = False
    fit_method: Literal['least_squares_through_origin'] | None
    references: list[PlanReference]
    residuals: list[dict]
    rms_residual_m: float | None
    max_abs_residual_m: float | None
    measurement_accuracy_verified: Literal[False] = False


class FloorPlanDocument(_Contract):
    schema_version: Literal['floorplan-1'] = 'floorplan-1'
    scene_id: str
    scene_revision: int = Field(ge=0)
    title: str
    scene_origin: str
    source_units: str
    coordinate_system: Literal['scene_x_z_y_up'] = 'scene_x_z_y_up'
    section_height_scene_units: float
    bounds: list[Point]
    objects: list[Footprint]
    architecture: list[SectionSegment]
    annotations: list[PlanAnnotation]
    uncertainty_zones: list[UncertaintyZone]
    scale: PlanScale
    scene_metric_evidence: dict | None
    coverage_verified: Literal[False] = False
    architectural_accuracy_verified: Literal[False] = False
    model_executed: Literal[False] = False
    limitations: list[str]


def _number(value):
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > MAX_COORDINATE: _fail()
    return float(value)


def _matrix(trs):
    if 'matrix' in trs:
        value=trs['matrix']
        if not isinstance(value,list) or len(value)!=16: _fail()
        result=tuple(_number(v) for v in value)
        if any(abs(result[i])>1e-8 for i in (3,7,11)) or abs(result[15]-1)>1e-8: _fail()
        return result
    position=trs.get('translation',[0,0,0]);q=trs.get('rotation',[0,0,0,1]);scale=trs.get('scale',[1,1,1])
    if any(not isinstance(value,list) for value in (position,q,scale)) or tuple(map(len,(position,q,scale)))!=(3,4,3): _fail()
    position=list(map(_number,position));x,y,z,w=map(_number,q);sx,sy,sz=map(_number,scale)
    if not math.isclose(x*x+y*y+z*z+w*w,1,abs_tol=1e-4) or min(abs(sx),abs(sy),abs(sz))<1e-9: _fail()
    return ((1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0.,
            2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0.,
            2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0.,*position,1.)


_IDENTITY=(1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.)


def _multiply(a,b):
    return tuple(sum(a[k*4+row]*b[col*4+k] for k in range(4)) for col in range(4) for row in range(4))


def _transform(m,p):
    result=tuple(m[row]*p[0]+m[4+row]*p[1]+m[8+row]*p[2]+m[12+row] for row in range(3))
    if any(not math.isfinite(v) or abs(v)>MAX_COORDINATE for v in result): _fail()
    return result


def _mesh_geometry(raw):
    """Read real indexed triangles, honoring node transforms and buffer strides."""
    validate_glb(raw)
    json_size=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+json_size]);offset=20+json_size
    binary_size,kind=struct.unpack_from('<II',raw,offset)
    if kind!=0x004E4942: _fail()
    binary=raw[offset+8:offset+8+binary_size]
    nodes=doc.get('nodes',[]);meshes=doc.get('meshes',[]);scenes=doc.get('scenes',[])
    if not isinstance(nodes,list) or not 1<=len(nodes)<=10_000 or not isinstance(scenes,list) or not scenes: _fail()
    scene_index=doc.get('scene',0)
    if type(scene_index) is not int or not 0<=scene_index<len(scenes): _fail()
    roots=scenes[scene_index].get('nodes',[])
    if not isinstance(roots,list) or len(roots)>10_000: _fail()
    primitives=[];visited=set();triangles=0;points_count=0

    def accessor(index,position=False):
        if type(index) is not int or not 0<=index<len(doc['accessors']): _fail()
        entry=doc['accessors'][index];view=doc['bufferViews'][entry['bufferView']]
        if position:
            if entry['componentType']!=5126 or entry['type']!='VEC3' or entry.get('normalized',False): _fail()
            fmt,width='<fff',12
        else:
            fmt,width={5121:('<B',1),5123:('<H',2),5125:('<I',4)}.get(entry['componentType'],(None,None))
            if fmt is None or entry['type']!='SCALAR': _fail()
        start=view.get('byteOffset',0)+entry.get('byteOffset',0);stride=view.get('byteStride',width)
        return [struct.unpack_from(fmt,binary,start+i*stride) for i in range(entry['count'])]

    def visit(index,parent,path):
        nonlocal triangles,points_count
        if type(index) is not int or not 0<=index<len(nodes) or index in path or index in visited: _fail()
        visited.add(index);node=nodes[index]
        if not isinstance(node,dict) or node.get('skin') is not None: _fail('El plano aún no admite geometría deformada por esqueletos.')
        matrix=_multiply(parent,_matrix(node));mesh_index=node.get('mesh')
        if mesh_index is not None:
            if type(mesh_index) is not int or not 0<=mesh_index<len(meshes): _fail()
            for primitive in meshes[mesh_index]['primitives']:
                if primitive.get('mode',4)!=4 or primitive.get('targets'): _fail('El plano admite mallas triangulares estáticas.')
                positions=accessor(primitive['attributes']['POSITION'],True);points_count+=len(positions)
                if points_count>1_200_000: _fail('La escena supera el límite de vértices del plano local.')
                points=tuple(_transform(matrix,p) for p in positions)
                indices=tuple(value[0] for value in accessor(primitive['indices'])) if 'indices' in primitive else tuple(range(len(points)))
                if len(indices)%3 or any(type(i) is not int or not 0<=i<len(points) for i in indices): _fail()
                triangles+=len(indices)//3
                if triangles>MAX_TRIANGLES: _fail('La escena supera el límite de triángulos del plano local.')
                primitives.append((points,indices))
        children=node.get('children',[])
        if not isinstance(children,list) or len(children)>10_000: _fail()
        for child in children:visit(child,matrix,path|{index})

    try:
        for root in roots:visit(root,_IDENTITY,set())
    except (TypeError,KeyError,IndexError,RecursionError,struct.error): _fail()
    if not primitives: _fail('El GLB no contiene geometría visible para el plano.')
    return tuple(primitives)


@lru_cache(maxsize=8)
def _small_mesh_geometry(raw):
    return _mesh_geometry(raw)


def _hull(points):
    values=sorted(set((round(p[0],7),round(p[1],7)) for p in points))
    if len(values)<=2:return [list(p) for p in values]
    def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower=[];upper=[]
    for p in values:
        while len(lower)>=2 and cross(lower[-2],lower[-1],p)<=0:lower.pop()
        lower.append(p)
    for p in reversed(values):
        while len(upper)>=2 and cross(upper[-2],upper[-1],p)<=0:upper.pop()
        upper.append(p)
    return [list(p) for p in lower[:-1]+upper[:-1]]


def _section(triangle,height):
    crossings=[]
    for a,b in zip(triangle,triangle[1:]+triangle[:1]):
        da,db=a[1]-height,b[1]-height
        if abs(da)<1e-8:crossings.append((a[0],a[2]))
        if da*db<0:
            t=da/(da-db);crossings.append((a[0]+t*(b[0]-a[0]),a[2]+t*(b[2]-a[2])))
    crossings=list(dict.fromkeys((round(x,7),round(z,7)) for x,z in crossings))
    if len(crossings)!=2 or math.dist(*crossings)<1e-7:return None
    return tuple(sorted(crossings))


def fit_scale(references=(),*,scene_units='source_relative'):
    if not isinstance(references,(list,tuple)) or len(references)>20:raise FloorPlanError('floorplan_references','Usa hasta veinte referencias.')
    try:values=[PlanReference.model_validate(value) for value in references]
    except ValueError:raise FloorPlanError('floorplan_references','Revisa puntos, distancia medida y procedencia de cada referencia.') from None
    if len({v.id for v in values})!=len(values) or len({tuple(sorted(tuple(p) for p in v.points)) for v in values})!=len(values):
        raise FloorPlanError('floorplan_references','Las referencias deben ser distintas; repetir una medida no la valida.')
    distances=[math.dist(*value.points) for value in values]
    scale=sum(d*value.measured_m for d,value in zip(distances,values))/sum(d*d for d in distances) if distances else None
    # A one-reference zero residual is a tautology and never reported as accuracy.
    residuals=[{'id':value.id,'scene_distance':d,'declared_m':value.measured_m,
                'fitted_m':d*scale,'residual_m':d*scale-value.measured_m} for d,value in zip(distances,values)] if len(values)>=2 else []
    return PlanScale(status='user_declared_fit' if values else 'scene_documented_unchecked' if scene_units=='meters' else 'source_relative',
        label='Escala declarada · sin verificación independiente' if values else 'Escala documentada en escena · plano sin verificar' if scene_units=='meters' else 'Unidades relativas · no métrico',
        meters_per_unit=scale,fit_method='least_squares_through_origin' if values else None,references=values,residuals=residuals,
        rms_residual_m=math.sqrt(sum(v['residual_m']**2 for v in residuals)/len(residuals)) if residuals else None,
        max_abs_residual_m=max(abs(v['residual_m']) for v in residuals) if residuals else None).model_dump(mode='json')


def build_floorplan(scene,asset_bytes,*,revision=0,references=(),annotations=(),uncertainty_zones=(),cut_height=1.0):
    """Build from the current manifest and verified GLBs; no coordinate guesses.

    `cut_height` is in scene units, never implicitly metres. Annotation endpoints
    must come from explicit authored/user input. Missing doors are not invented.
    """
    try:document=SceneManifest.model_validate_json(json.dumps(scene)) if not isinstance(scene,SceneManifest) else scene
    except ValueError:raise FloorPlanError('floorplan_scene','La escena no cumple el contrato espacial.') from None
    if type(revision) is not int or revision<0 or type(cut_height) not in (int,float) or not math.isfinite(cut_height) or not -1000<=cut_height<=1000:
        raise FloorPlanError('floorplan_parameters','Revisa la revisión y la altura del corte en unidades de escena.')
    if not isinstance(asset_bytes,dict):raise FloorPlanError('floorplan_assets','Faltan los GLB verificados del espacio.')
    if not isinstance(annotations,(list,tuple)) or not isinstance(uncertainty_zones,(list,tuple)) or len(annotations)>100 or len(uncertainty_zones)>100:
        raise FloorPlanError('floorplan_annotations','Usa listas de hasta cien anotaciones o zonas.')
    try:notes=[PlanAnnotation.model_validate(v) for v in annotations];zones=[UncertaintyZone.model_validate(v) for v in uncertainty_zones]
    except ValueError:raise FloorPlanError('floorplan_annotations','Revisa geometría, etiqueta y procedencia de las anotaciones.') from None
    if len({v.id for v in notes})!=len(notes) or len({v.id for v in zones})!=len(zones):raise FloorPlanError('floorplan_annotations','Las anotaciones deben tener identificadores únicos.')
    assets={asset.id:asset for asset in document.assets};meshes={};total_bytes=0
    for asset in document.assets:
        raw=asset_bytes.get(asset.id)
        if asset.kind!='mesh' or not isinstance(raw,bytes) or hashlib.sha256(raw).hexdigest()!=asset.sha256:
            raise FloorPlanError('floorplan_assets','El plano necesita GLB completos cuyo hash coincida con la escena.')
        total_bytes+=len(raw)
        if total_bytes>60*1024*1024:raise FloorPlanError('floorplan_assets','La escena supera el límite de carga local de 60 MiB.')
        # Avoid retaining large uploaded geometry in a process-wide cache.
        meshes[asset.id]=_small_mesh_geometry(raw) if len(raw)<=512*1024 else _mesh_geometry(raw)
    footprints=[];sections=[];all_points=[];triangles=0
    for obj in document.objects:
        t=obj.transform;matrix=_matrix({'translation':t.position,'rotation':t.rotation_xyzw,'scale':t.scale});vertices=[];unique=set()
        for local,indices in meshes[obj.asset_id]:
            world=tuple(_transform(matrix,p) for p in local);vertices.extend(world);triangles+=len(indices)//3
            if triangles>MAX_TRIANGLES: _fail('El plano supera el límite total de triángulos transformados.')
            if obj.role=='environment':
                for offset in range(0,len(indices),3):
                    segment=_section(tuple(world[indices[offset+i]] for i in range(3)),cut_height)
                    if segment is not None:unique.add(segment)
        polygon=_hull([(p[0],p[2]) for p in vertices]);all_points.extend(polygon)
        ymin=min(p[1] for p in vertices);ymax=max(p[1] for p in vertices);asset=assets[obj.asset_id]
        footprints.append(Footprint(id=obj.id,label=obj.label,role=obj.role,editable=obj.editable,asset_id=obj.asset_id,
            asset_sha256=asset.sha256,provenance=asset.provenance,polygon=polygon,y_min=ymin,y_max=ymax,overhead=ymin>cut_height))
        sections.extend(SectionSegment(object_id=obj.id,points=[list(p) for p in segment],provenance=asset.provenance) for segment in sorted(unique))
        if len(sections)>MAX_SEGMENTS: _fail('El corte produce demasiados segmentos para un plano legible.')
    if not all_points:raise FloorPlanError('floorplan_empty','La escena no contiene objetos proyectables.')
    xmin=min(p[0] for p in all_points);xmax=max(p[0] for p in all_points);zmin=min(p[1] for p in all_points);zmax=max(p[1] for p in all_points)
    bounds=[[xmin,zmin],[xmax,zmax]]
    if 'geometry-unverified' not in {zone.id for zone in zones}:
        zones.insert(0,UncertaintyZone(id='geometry-unverified',polygon=[[xmin,zmin],[xmax,zmin],[xmax,zmax],[xmin,zmax]],
            reason='Cobertura y precisión geométrica del plano sin validación independiente.',provenance='derived_unverified'))
    result=FloorPlanDocument(scene_id=str(document.scene_id),scene_revision=revision,title=document.title,
        scene_origin=document.origin,source_units=document.units,section_height_scene_units=float(cut_height),bounds=bounds,
        objects=footprints,architecture=sections,annotations=notes,uncertainty_zones=zones,
        scale=PlanScale.model_validate(fit_scale(references,scene_units=document.units)),
        scene_metric_evidence=document.metric_verification.model_dump(mode='json') if document.metric_verification else None,
        limitations=['Proyección de la geometría actual; no reconstruye un espacio ni completa zonas ausentes.',
            'Huellas convexas: pueden cubrir huecos y sobreestimar el espacio ocupado por un objeto.',
            'El corte arquitectónico depende de la altura elegida, en unidades de escena; no identifica puertas automáticamente.',
            'La calibración declarada ajusta distancias y residuales; no certifica escala, cobertura ni precisión profesional.'])
    return result.model_dump(mode='json')


class FloorPlanService:
    """Read the current scene, including saved layout transforms, without writes."""
    def __init__(self,spatial):self.spatial=spatial

    def get(self,scene_id,*,expected_revision=None,**parameters):
        payload=self.spatial.scene(scene_id)
        if expected_revision is not None and (type(expected_revision) is not int or payload['revision']!=expected_revision):
            raise FloorPlanError('floorplan_conflict','El espacio cambió. Actualiza el plano antes de calibrar.',409)
        from services.spatial.plan_settings import PlanSettingsService,DEFAULT
        settings={'revision':0,'config':deepcopy(DEFAULT),'persisted':False}
        if hasattr(self.spatial,'_connect') and hasattr(self.spatial,'lock'):
            with self.spatial.lock,self.spatial._connect() as db:
                settings=PlanSettingsService._read(db,scene_id);settings['persisted']=settings['revision']>0
        parameters={**settings['config'],**parameters}
        scene=payload['scene'];assets={asset['id']:self.spatial.asset(scene_id,asset['id'])[0] for asset in scene['assets']}
        result=build_floorplan(scene,assets,revision=payload['revision'],**parameters)
        result['settings_revision']=settings['revision'];result['settings_persisted']=settings['persisted'];result['config']=deepcopy(parameters)
        # Detect editing during geometry extraction; do not label stale geometry current.
        if self.spatial.scene(scene_id)['revision']!=payload['revision']:
            raise FloorPlanError('floorplan_conflict','El espacio cambió mientras se generaba el plano.',409)
        return result
