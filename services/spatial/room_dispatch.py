"""Durable, explicitly authorized multiview work with a shared spatial budget.

Opening/inspecting never resumes a job or constructs a cloud client. The journal
tracks local intent, not an exactly-once guarantee at Modal. Unknown provider
billing retains the common hold and blocks further object/room reservations.
"""
from contextlib import closing,contextmanager
from dataclasses import dataclass
from datetime import datetime,timezone
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3
import threading
import struct
from uuid import UUID,uuid5,NAMESPACE_URL

from services.spatial.budget import BudgetError,micro_usd,usd
from services.spatial.review import _publish
from workers.spatial_room import canonical,parameters,read_room_lock,readiness,validate_room_request,MAX_GLB
from workers.spatial_runtime import validate_glb,SpatialWorkerError

STATES=frozenset({'reserving','reserved','starting','started','completed_test_stub','completed_remote',
    'cancelled_before_start','cancelled_unknown','cancelled_known','failed_unknown','failed_known'})
AMBIGUOUS=frozenset({'starting','started','cancelled_unknown','failed_unknown'})
FIELDS=frozenset({'schema_version','job_id','identity_sha256','capture_id','source_sha256','source_frames','parameters','seed',
    'timeout_seconds','pipeline_version','lock_sha256','transport_kind','origin','model_executed','created_at','updated_at',
    'artifact','surface_manifest','actual_billed_usd','actual_cost_known','cancel_requested','error_code'})
HASH=re.compile('[a-f0-9]{64}')


class RoomDispatchError(ValueError):
    def __init__(self,code,message,status=409):self.code,self.status=code,status;super().__init__(message)


@dataclass(frozen=True)
class RoomDispatchResult:
    artifact_bytes:bytes
    surface:dict
    actual_billed_usd:str|None=None
    model_executed:bool=False


def fail(code,message,status=409):raise RoomDispatchError(code,message,status)
def stamp():return datetime.now(timezone.utc).isoformat()
def digest(raw):return hashlib.sha256(raw).hexdigest()


def identifier(value):
    try:
        if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError()
    except (ValueError,TypeError,AttributeError):fail('room_job','Trabajo multivista no disponible.',404)
    return value


def request_identity(request):
    """Hash only validated metadata; image bytes are private transport inputs."""
    validate_room_request(request)
    value={key:value for key,value in request.items() if key!='frames'}
    value['frames']=[{key:value for key,value in frame.items() if key!='image_png'} for frame in request['frames']]
    return digest(canonical(value))


def validate_surface(surface,frames):
    """Validate bounded numerical provenance, not reconstruction quality."""
    import math
    required={'format','units','vertex_count','triangle_count','requested_stride','effective_stride','parameters','frames','cameras',
        'bounds','geometry_kind','metric_scale_verified','geometry_fidelity_verified','physical_realism_verified',
        'scene_coverage_verified','camera_orientation_verified','uncertainty'}
    def finite(value):return type(value) in (int,float) and math.isfinite(value)
    def matrix(value,rows,cols):
        return isinstance(value,list) and len(value)==rows and all(isinstance(row,list) and len(row)==cols and all(finite(item) and abs(item)<=1e7 for item in row) for row in value)
    try:
        if not isinstance(surface,dict) or set(surface)!=required or len(canonical(surface))>512*1024:raise ValueError()
        if surface['format']!='brivany-room-surface-1' or surface['units']!='source_relative' or surface['geometry_kind']!='per_view_image_supported_depth_surface':raise ValueError()
        if any(surface[key] is not False for key in ('metric_scale_verified','geometry_fidelity_verified','physical_realism_verified','scene_coverage_verified','camera_orientation_verified')):raise ValueError()
        if type(surface['vertex_count']) is not int or not 3<=surface['vertex_count']<=180000 or type(surface['triangle_count']) is not int or not 1<=surface['triangle_count']<=300000:raise ValueError()
        params=parameters(surface['parameters'])
        if params!=surface['parameters'] or type(surface['requested_stride']) is not int or surface['requested_stride']!=params['sample_stride'] or type(surface['effective_stride']) is not int or not params['sample_stride']<=surface['effective_stride']<=517:raise ValueError()
        if surface['vertex_count']>params['max_vertices'] or surface['triangle_count']>params['max_triangles']:raise ValueError()
        bounds=surface['bounds']
        if not isinstance(bounds,dict) or set(bounds)!={'min','max'} or any(not isinstance(bounds[key],list) or len(bounds[key])!=3 or not all(finite(item) and abs(item)<=1e7 for item in bounds[key]) for key in bounds):raise ValueError()
        if any(low>high for low,high in zip(bounds['min'],bounds['max'])):raise ValueError()
        reports=surface['frames'];cameras=surface['cameras']
        if not isinstance(reports,list) or not isinstance(cameras,list) or len(reports)!=len(frames) or len(cameras)!=len(frames):raise ValueError()
        total=0
        report_fields={'frame_id','sampled_image_pixels','invalid_depth_or_confidence_pixels','low_confidence_pixels','confidence_score_threshold','candidate_triangles','triangles_rejected_missing_samples','triangles_rejected_discontinuity_or_degenerate','triangles_retained'}
        for source,report,camera in zip(frames,reports,cameras):
            if set(report)!=report_fields or report['frame_id']!=source['id']:raise ValueError()
            for key in report_fields-{'frame_id','confidence_score_threshold'}:
                if type(report[key]) is not int or not 0<=report[key]<=8*518*518:raise ValueError()
            if report['confidence_score_threshold'] is not None and (not finite(report['confidence_score_threshold']) or report['confidence_score_threshold']<0):raise ValueError()
            if report['invalid_depth_or_confidence_pixels']+report['low_confidence_pixels']>report['sampled_image_pixels']:raise ValueError()
            if report['triangles_retained'] and report['confidence_score_threshold'] is None:raise ValueError()
            if report['candidate_triangles']!=report['triangles_rejected_missing_samples']+report['triangles_rejected_discontinuity_or_degenerate']+report['triangles_retained']:raise ValueError()
            total+=report['triangles_retained']
            if set(camera)!={'frame_id','at_seconds','intrinsic','world_to_camera_opencv','camera_to_viewer','image_bounds'} or camera['frame_id']!=source['id'] or not finite(camera['at_seconds']) or camera['at_seconds']!=source['at_seconds']:raise ValueError()
            if not matrix(camera['intrinsic'],3,3) or not matrix(camera['world_to_camera_opencv'],3,4) or not matrix(camera['camera_to_viewer'],4,4):raise ValueError()
            if camera['camera_to_viewer'][3]!=[0,0,0,1] or camera['intrinsic'][2]!=[0,0,1] or camera['intrinsic'][0][0]<=0 or camera['intrinsic'][1][1]<=0:raise ValueError()
            intrinsic=camera['intrinsic'];extrinsic=camera['world_to_camera_opencv'];inverse=camera['camera_to_viewer']
            if abs(intrinsic[0][1])>1e-6 or abs(intrinsic[1][0])>1e-6:raise ValueError()
            rotation=[row[:3] for row in extrinsic];translation=[row[3] for row in extrinsic]
            for a in range(3):
                for b in range(3):
                    if abs(sum(rotation[a][k]*rotation[b][k] for k in range(3))-(1 if a==b else 0))>1e-3:raise ValueError()
            determinant=(rotation[0][0]*(rotation[1][1]*rotation[2][2]-rotation[1][2]*rotation[2][1])-
                rotation[0][1]*(rotation[1][0]*rotation[2][2]-rotation[1][2]*rotation[2][0])+
                rotation[0][2]*(rotation[1][0]*rotation[2][1]-rotation[1][1]*rotation[2][0]))
            if abs(determinant-1)>1e-3:raise ValueError()
            for a,sign in enumerate((1,-1,-1)):
                for b in range(3):
                    if abs(inverse[a][b]-sign*rotation[b][a])>1e-5:raise ValueError()
                expected=-sign*sum(rotation[k][a]*translation[k] for k in range(3))
                if abs(inverse[a][3]-expected)>1e-5*max(1,abs(expected)):raise ValueError()
            box=camera['image_bounds']
            if not isinstance(box,list) or len(box)!=4 or not all(finite(item) and 0<=item<=518 for item in box) or box[2]<=box[0] or box[3]<=box[1]:raise ValueError()
        if total!=surface['triangle_count']:raise ValueError()
        uncertainty=surface['uncertainty']
        if (not isinstance(uncertainty,dict) or set(uncertainty)!={'scope','holes_filled','cross_view_fusion','unknown_surfaces','confidence_is_probability','colors_include_captured_lighting','note'} or
            uncertainty['scope']!='entire_scene' or uncertainty['holes_filled'] is not False or uncertainty['cross_view_fusion'] is not False or
            uncertainty['unknown_surfaces']!='unrepresented' or uncertainty['confidence_is_probability'] is not False or uncertainty['colors_include_captured_lighting'] is not True or
            not isinstance(uncertainty['note'],str) or not 1<=len(uncertainty['note'])<=500 or any(ord(c)<32 for c in uncertainty['note'])):raise ValueError()
    except (ValueError,TypeError,KeyError,AttributeError,SpatialWorkerError):fail('room_surface_invalid','La superficie y sus cámaras no cumplen el contrato acotado.')
    return surface


def validate_room_glb(raw,surface):
    """Correlate the bounded standard GLB attributes with its surface manifest."""
    try:
        checked=validate_glb(raw)
        if len(raw)>MAX_GLB:raise ValueError()
        length=struct.unpack('<I',raw[12:16])[0];model=json.loads(raw[20:20+length]);binary=raw[28+length:]
        # The worker emits one identity node. Extra transforms or mesh instances
        # would change the displayed surface without changing accessor hashes.
        if (model.get('scene')!=0 or model.get('scenes')!=[{'nodes':[0]}] or model.get('nodes')!=[{'mesh':0}] or
            any(name in model for name in ('extensionsUsed','extensionsRequired','animations','skins'))):raise ValueError()
        if len(model['meshes'])!=1 or len(model['meshes'][0]['primitives'])!=1:raise ValueError()
        primitive=model['meshes'][0]['primitives'][0]
        if primitive.get('mode',4)!=4 or set(primitive['attributes'])!={'POSITION','NORMAL','COLOR_0'}:raise ValueError()
        expected_materials=[{'name':'Image colors with captured lighting','doubleSided':True,'pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':1}}]
        if primitive.get('material')!=0 or model.get('materials')!=expected_materials:raise ValueError()
        vertex_count=surface['vertex_count'];triangle_count=surface['triangle_count'];accessors=model['accessors'];views=model['bufferViews']
        def array(index,component,kind,count):
            accessor=accessors[index];view=views[accessor['bufferView']]
            if accessor['componentType']!=component or accessor['type']!=kind or accessor['count']!=count or accessor.get('byteOffset',0)!=0 or 'byteStride' in view or view.get('byteOffset',0)%4:raise ValueError()
            return accessor,binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
        position,positions=array(primitive['attributes']['POSITION'],5126,'VEC3',vertex_count)
        _normal,normals=array(primitive['attributes']['NORMAL'],5126,'VEC3',vertex_count)
        color,colors=array(primitive['attributes']['COLOR_0'],5123,'VEC4',vertex_count)
        _indices,indices=array(primitive['indices'],5125,'SCALAR',triangle_count*3)
        if len(positions)!=vertex_count*12 or len(normals)!=vertex_count*12 or len(colors)!=vertex_count*8 or len(indices)!=triangle_count*12 or color.get('normalized') is not True:raise ValueError()
        color_metadata=model.get('extras',{}).get('brivany',{})
        if (color_metadata.get('vertex_color_transfer')!='linear' or color_metadata.get('source_color_transfer')!='srgb' or
                color_metadata.get('vertex_color_encoding')!='rgba-unorm16' or any(rgba[3]!=65535 for rgba in struct.iter_unpack('<HHHH',colors))):raise ValueError()
        actual_min=[math.inf]*3;actual_max=[-math.inf]*3
        for vertex in struct.iter_unpack('<fff',positions):
            for axis,value in enumerate(vertex):
                if not math.isfinite(value) or abs(value)>1e7:raise ValueError()
                actual_min[axis]=min(actual_min[axis],value);actual_max[axis]=max(actual_max[axis],value)
        if any(not all(math.isfinite(value) for value in vector) or not .9<=sum(value*value for value in vector)<=1.1 for vector in struct.iter_unpack('<fff',normals)):raise ValueError()
        if any(value[0]>=vertex_count for value in struct.iter_unpack('<I',indices)):raise ValueError()
        for key in ('min','max'):
            if (not isinstance(position.get(key),list) or len(position[key])!=3 or
                not all(type(item) in (int,float) and math.isfinite(item) for item in position[key])):raise ValueError()
            actual=actual_min if key=='min' else actual_max
            for declared in (position[key],surface['bounds'][key]):
                if any(abs(a-b)>1e-5*max(1,abs(b)) for a,b in zip(actual,declared)):raise ValueError()
        return checked
    except (ValueError,KeyError,TypeError,IndexError,struct.error,SpatialWorkerError):fail('room_glb_invalid','La malla no coincide con los atributos y cantidades de su superficie.')


def validate_room_dispatch_record(row):
    try:
        value=json.loads(row['document']) if isinstance(row['document'],str) else row['document']
        if not isinstance(value,dict) or set(value)!=FIELDS or row['state'] not in STATES or value['schema_version']!='0.1.0' or value['job_id']!=row['job_id'] or value['identity_sha256']!=row['identity']:raise ValueError()
        identifier(value['job_id']);identifier(value['capture_id'])
        for key in ('identity_sha256','source_sha256','lock_sha256'):
            if not isinstance(value[key],str) or not HASH.fullmatch(value[key]):raise ValueError()
        if not re.fullmatch('[a-z0-9._-]{1,80}',value['pipeline_version']):raise ValueError()
        if type(value['seed']) is not int or not 0<=value['seed']<=2147483647 or type(value['timeout_seconds']) is not int or not 1<=value['timeout_seconds']<=180:raise ValueError()
        if parameters(value['parameters'])!=value['parameters']:raise ValueError()
        frames=value['source_frames'];previous=-1;seen=set();hashes=set()
        if not isinstance(frames,list) or not 2<=len(frames)<=8:raise ValueError()
        for frame in frames:
            if not isinstance(frame,dict) or set(frame)!={'id','at_seconds','source_frame_sha256','image_sha256'} or not re.fullmatch('frame-[0-9]{4}',frame['id']) or frame['id'] in seen:raise ValueError()
            if type(frame['at_seconds']) not in (int,float) or not previous<frame['at_seconds']<=60:raise ValueError()
            for key in ('source_frame_sha256','image_sha256'):
                if not isinstance(frame[key],str) or not HASH.fullmatch(frame[key]):raise ValueError()
            if frame['image_sha256'] in hashes:raise ValueError()
            previous=frame['at_seconds'];seen.add(frame['id']);hashes.add(frame['image_sha256'])
        identity={'pipeline':value['pipeline_version'],'lock_sha256':value['lock_sha256'],'capture_id':value['capture_id'],
            'source_sha256':value['source_sha256'],'frames':frames,'parameters':value['parameters'],'seed':value['seed'],'timeout_seconds':value['timeout_seconds']}
        if digest(canonical(identity))!=value['identity_sha256'] or value['job_id']!=str(uuid5(NAMESPACE_URL,'brivany:room:'+value['identity_sha256'])):raise ValueError()
        if value['transport_kind']=='modal':
            if value['origin']!='inferred' or row['state']=='completed_test_stub':raise ValueError()
        elif value['transport_kind']=='test_stub':
            if value['origin']!='test_stub' or value['model_executed'] is not False or row['state']=='completed_remote':raise ValueError()
        else:raise ValueError()
        for key in ('model_executed','actual_cost_known','cancel_requested'):
            if type(value[key]) is not bool:raise ValueError()
        if value['actual_cost_known']!=(value['actual_billed_usd'] is not None):raise ValueError()
        if value['actual_billed_usd'] is not None:
            if not isinstance(value['actual_billed_usd'],str):raise ValueError()
            micro_usd(value['actual_billed_usd'])
        for key in ('created_at','updated_at'):
            if datetime.fromisoformat(value[key]).utcoffset() is None:raise ValueError()
        if value['error_code'] not in {None,'input_changed','dispatch_interrupted','transport_failed','artifact_invalid','storage_failed'}:raise ValueError()
        for name,suffix,maximum in (('artifact','.glb',MAX_GLB),('surface_manifest','.surface.json',512*1024)):
            artifact=value[name]
            if artifact is not None:
                if artifact.get('relative_path')!='room-artifacts/'+value['job_id']+suffix or not HASH.fullmatch(artifact.get('sha256','')) or type(artifact.get('size_bytes')) is not int or not 1<=artifact['size_bytes']<=maximum:raise ValueError()
                if name=='surface_manifest':
                    if set(artifact)!={'relative_path','sha256','size_bytes','format'} or artifact['format']!='brivany-room-surface-1':raise ValueError()
                elif (set(artifact)!={'relative_path','sha256','size_bytes','format','structure_checks_passed','validation_scope','geometry_fidelity_verified','physical_realism_verified'} or artifact['format']!='glb' or artifact['structure_checks_passed'] is not True or artifact['geometry_fidelity_verified'] is not False or artifact['physical_realism_verified'] is not False):raise ValueError()
        if (value['artifact'] is None)!=(value['surface_manifest'] is None):raise ValueError()
        if row['state'] in {'completed_remote','completed_test_stub'} and value['artifact'] is None:raise ValueError()
        if row['state'] in {'completed_remote','completed_test_stub'} and value['cancel_requested']:raise ValueError()
        if row['state'] in {'failed_unknown','cancelled_unknown'} and value['actual_cost_known']:raise ValueError()
        if row['state'] in {'failed_known','cancelled_known'} and not value['actual_cost_known']:raise ValueError()
        return value
    except (ValueError,KeyError,TypeError,AttributeError,BudgetError,SpatialWorkerError):fail('room_dispatch_integrity','El diario multivista no coincide con su identidad o procedencia.')


@contextmanager
def read_database(root,name):
    root=Path(root).absolute();path=root/name
    if path.resolve()!=path or not path.is_file() or path.stat().st_size>64*1024*1024:fail('room_journal_missing','Falta un diario local multivista válido.',404)
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=10)) as db:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA trusted_schema=OFF');yield db


def completed_room_dispatch(root,job_id):
    """Corroborate local completed journals and reservation for later import."""
    identifier(job_id);root=Path(root).absolute()
    with read_database(root,'room-dispatch.sqlite3') as db:
        row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(job_id,)).fetchone()
        if row is None:fail('room_job','Trabajo multivista no disponible.',404)
        value=validate_room_dispatch_record(row)
        if row['state']!='completed_remote' or value['transport_kind']!='modal' or value['cancel_requested']:fail('room_result_pending','No existe un resultado remoto completo y vigente.')
    with read_database(root,'budget.sqlite3') as db:
        reservation=db.execute('SELECT * FROM reservations WHERE job_id=?',(job_id,)).fetchone()
        if reservation is None or reservation['state'] not in {'unknown','settled'} or type(reservation['reserved']) is not int or reservation['reserved']<=0:fail('room_reservation','La habitación perdió su reserva original.')
        if value['actual_cost_known']:
            if reservation['state']!='settled' or reservation['actual']!=micro_usd(value['actual_billed_usd']):fail('room_reservation','El consumo no coincide con la conciliación.')
        elif reservation['state']!='unknown' or reservation['actual'] is not None:fail('room_reservation','El diario multivista y el consumo pendiente no coinciden.')
    request={'schema_version':'0.1.0','job_id':job_id,'capture_id':value['capture_id'],'source_sha256':value['source_sha256'],
        'frames':value['source_frames'],'reviewed':True,'parameters':value['parameters'],'seed':value['seed'],
        'timeout_seconds':value['timeout_seconds'],'reserved_usd':reservation['reserved']/1_000_000}
    with read_database(root,'room-modal-calls.sqlite3') as db:
        row=db.execute('SELECT * FROM modal_calls WHERE job_id=?',(job_id,)).fetchone()
        if row is None or row['state']!='completed' or row['request_sha256']!=digest(canonical(request)) or not re.fullmatch('fc-[A-Za-z0-9_-]{1,100}',row['call_id'] or ''):fail('room_modal_receipt','La llamada Modal original no confirma este resultado.')
    return value


class RoomDispatch:
    def __init__(self,root,preparation,budget,*,lock_path=None,transport=None):
        self.root=Path(root).absolute();self.database=self.root/'room-dispatch.sqlite3'
        if self.root.resolve()!=self.root or self.database.resolve()!=self.database or budget.path!=self.root/'budget.sqlite3' or preparation.root!=self.root:fail('room_storage','Captura, diario y presupuesto deben pertenecer al mismo almacenamiento.')
        self.preparation,self.budget,self.lock_path,self.transport=preparation,budget,lock_path,transport;self.lock=threading.RLock()

    @contextmanager
    def _db(self):
        self.root.mkdir(parents=True,exist_ok=True);db=sqlite3.connect(self.database,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE');db.execute('CREATE TABLE IF NOT EXISTS room_dispatch_jobs(job_id TEXT PRIMARY KEY,identity TEXT UNIQUE NOT NULL,state TEXT NOT NULL,document TEXT NOT NULL)')
            yield db;db.execute('COMMIT')
        except Exception:
            if db.in_transaction:db.execute('ROLLBACK')
            raise
        finally:db.close()

    def preflight(self,capture_id,payload):return self.preparation.prepare(capture_id,payload,lock=read_room_lock(self.lock_path))['preflight']

    @staticmethod
    def _dto(row):
        value=validate_room_dispatch_record(row);real=value['transport_kind']=='modal'
        return {**value,'state':row['state'],'replay_allowed':False,'external_calls':None if real else 0,'gpu_seconds':None if real else 0,
            'billing_basis':'provider_invoice_pending' if real and not value['actual_cost_known'] else 'operator_reconciliation' if real else 'test_stub_report',
            'geometry_fidelity_verified':False,'metric_scale_verified':False,'physical_realism_verified':False}

    def inspect(self,job_id):
        identifier(job_id)
        with read_database(self.root,'room-dispatch.sqlite3') as db:row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(job_id,)).fetchone()
        if row is None:fail('room_job','Trabajo multivista no disponible.',404)
        return self._dto(row)

    def list_results(self,capture_id):
        identifier(capture_id)
        if not self.database.exists():return {'items':[],'has_more':False,'external_calls':0,'gpu_seconds':0}
        with read_database(self.root,'room-dispatch.sqlite3') as db:
            rows=db.execute("SELECT * FROM room_dispatch_jobs WHERE CASE WHEN json_valid(document) THEN json_extract(document,'$.capture_id') END=? ORDER BY rowid DESC LIMIT 21",(capture_id,)).fetchall()
        return {'items':[self._dto(row) for row in rows[:20]],'has_more':len(rows)>20,'external_calls':0,'gpu_seconds':0}

    def _update(self,job_id,state,**changes):
        with self._db() as db:
            row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(job_id,)).fetchone()
            return self._write(db,row,state,**changes)

    @staticmethod
    def _write(db,row,state,**changes):
        value={**validate_room_dispatch_record(row),**changes,'updated_at':stamp()}
        validated={'job_id':row['job_id'],'identity':row['identity'],'state':state,'document':value}
        validate_room_dispatch_record(validated)
        db.execute('UPDATE room_dispatch_jobs SET state=?,document=? WHERE job_id=?',(state,canonical(value).decode(),row['job_id']))
        return RoomDispatch._dto(validated)

    def _finish(self,job,result=None,*,real,error_code=None):
        """Serialize cancellation, reconciliation and final artifact publication.

        The SQLite write lock covers the decision and publication, including
        separate service instances. A cancellation committed before this lock
        suppresses output; a request after completed publication is a no-op.
        """
        with self.lock,self._db() as db:
            row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(job,)).fetchone();current=validate_room_dispatch_record(row)
            actual=current['actual_billed_usd']
            if actual is None and not real and isinstance(result,RoomDispatchResult) and result.actual_billed_usd is not None:
                try:actual=usd(micro_usd(result.actual_billed_usd))
                except BudgetError:pass
            if not current['actual_cost_known']:self.budget.settle(job,actual)
            changes={'actual_billed_usd':actual,'actual_cost_known':actual is not None}
            if current['cancel_requested']:
                return self._write(db,row,'cancelled_known' if actual is not None else 'cancelled_unknown',**changes)
            if result is None:
                return self._write(db,row,'failed_known' if actual is not None else 'failed_unknown',error_code=error_code or 'transport_failed',**changes)
            try:
                if not isinstance(result,RoomDispatchResult) or not isinstance(result.artifact_bytes,bytes) or len(result.artifact_bytes)>MAX_GLB:raise ValueError()
                validate_surface(result.surface,current['source_frames']);artifact=validate_room_glb(result.artifact_bytes,result.surface);raw=canonical(result.surface)
                folder=self.root/'room-artifacts'
                if folder.resolve()!=folder:raise OSError()
                folder.mkdir(exist_ok=True);asset=folder/(job+'.glb');surface=folder/(job+'.surface.json')
                if asset.resolve()!=asset or surface.resolve()!=surface:raise OSError()
                _publish(asset,result.artifact_bytes);_publish(surface,raw)
                artifact['relative_path']='room-artifacts/'+asset.name
                manifest={'relative_path':'room-artifacts/'+surface.name,'sha256':digest(raw),'size_bytes':len(raw),'format':'brivany-room-surface-1'}
                return self._write(db,row,'completed_remote' if real else 'completed_test_stub',artifact=artifact,surface_manifest=manifest,model_executed=result.model_executed if real else False,**changes)
            except Exception:
                return self._write(db,row,'failed_known' if actual is not None else 'failed_unknown',error_code='artifact_invalid',**changes)

    def submit(self,capture_id,payload,*,execute=False):
        if execute is not True:fail('room_explicit_execution','La reconstrucción multivista requiere ejecución explícita.')
        lock=read_room_lock(self.lock_path)
        if readiness(lock)['pending']:fail('room_not_configured','El lock multivista sigue cerrado por acceso, pesos, entorno o presupuesto pendiente.')
        from services.spatial.room_modal_transport import RoomModalTransport
        real=isinstance(self.transport,RoomModalTransport)
        if self.transport is None or not real and getattr(self.transport,'simulation',None) is not True:fail('room_transport_pending','Falta el adaptador Modal multivista validado.')
        if real and (self.transport.preflight()['pending'] or digest(canonical(lock))!=digest(canonical(self.transport.lock))):fail('room_transport_pending','El transporte no comparte el lock configurado.')
        plan=self.preparation.prepare(capture_id,payload,lock=lock)['preflight'];job=plan['job_id']
        with self.lock:
            with self._db() as db:
                row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(job,)).fetchone()
                if row is not None:return self._dto(row)
                if db.execute("SELECT 1 FROM room_dispatch_jobs WHERE state IN ('reserving','reserved','starting','started','failed_unknown','cancelled_unknown') LIMIT 1").fetchone():fail('room_unresolved','Hay otro trabajo multivista pendiente de terminar o conciliar.')
                config=self.budget.status();money=lock['budget']
                for key,field in (('approved_total_usd','total_usd'),('approved_per_job_usd','per_job_usd'),('gpu_rate_usd_per_second','rate_usd_per_gpu_second'),('non_gpu_reserve_per_job_usd','extra_reserve_usd')):
                    if micro_usd(str(money[key]))!=micro_usd(config[field]):fail('room_budget_mismatch','El presupuesto compartido no coincide con el lock multivista.')
                # A known billing blocker must not consume a new intent that
                # never reached the provider. The later atomic reserve still
                # rejects a race with another object/room reservation.
                if config['unknown_count']:raise BudgetError('budget_unknown_cost','Hay un consumo desconocido pendiente de conciliar.')
                if not config['enabled']:raise BudgetError('budget_disabled','El presupuesto aún no está habilitado.')
                value={key:plan[key] for key in ('schema_version','job_id','identity_sha256','capture_id','source_sha256','parameters','seed','timeout_seconds')}
                value.update(source_frames=plan['frames'],pipeline_version=lock['pipeline_version'],lock_sha256=digest(canonical(lock)),
                    transport_kind='modal' if real else 'test_stub',origin='inferred' if real else 'test_stub',model_executed=False,
                    created_at=stamp(),updated_at=stamp(),artifact=None,surface_manifest=None,actual_billed_usd=None,actual_cost_known=False,cancel_requested=False,error_code=None)
                validate_room_dispatch_record({'job_id':job,'identity':plan['identity_sha256'],'state':'reserving','document':value})
                db.execute('INSERT INTO room_dispatch_jobs VALUES(?,?,?,?)',(job,plan['identity_sha256'],'reserving',canonical(value).decode()))
            try:
                estimate=self.budget.estimate(plan['timeout_seconds']);receipt=self.budget.reserve(job,estimate['estimated_usd'])
                with self._db() as db:
                    row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(job,)).fetchone()
                    if validate_room_dispatch_record(row)['cancel_requested']:
                        self.budget.cancel_before_start(job)
                        return self._write(db,row,'cancelled_before_start')
                    if receipt['state']!='reserved':fail('room_budget_state','La reserva original ya no permite iniciar.')
                    self._write(db,row,'reserved')
                prepared=self.preparation.prepare(capture_id,payload,reserved_usd=float(Decimal(receipt['reserved_usd'])),lock=lock)
                if prepared['preflight']['identity_sha256']!=plan['identity_sha256']:fail('room_input_changed','Las vistas cambiaron antes de ejecutar.')
                request=prepared['request']
                with self._db() as db:
                    row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(job,)).fetchone()
                    if validate_room_dispatch_record(row)['cancel_requested']:
                        self.budget.cancel_before_start(job)
                        return self._write(db,row,'cancelled_before_start')
                    self._write(db,row,'starting');self.budget.mark_started(job);self._write(db,row,'started')
            except Exception:
                try:self.budget.cancel_before_start(job);self._update(job,'cancelled_before_start',error_code='dispatch_interrupted')
                except BudgetError as error:
                    if error.code=='budget_reservation_missing':self._update(job,'cancelled_before_start',error_code='dispatch_interrupted')
                    else:self.budget.settle(job,None);self._update(job,'failed_unknown',error_code='dispatch_interrupted')
                raise
        if self.inspect(job)['cancel_requested']:
            return self._finish(job,real=real)
        try:result=self.transport.execute(request,cancelled=lambda:self.inspect(job)['cancel_requested']) if real else self.transport.execute(request)
        except Exception:
            return self._finish(job,real=real,error_code='transport_failed')
        return self._finish(job,result,real=real)

    def cancel(self,job_id,*,remote=False):
        with self.lock,self._db() as db:
            row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(identifier(job_id),)).fetchone()
            if row is None:fail('room_job','Trabajo multivista no disponible.',404)
            current=self._dto(row)
            if current['state'] in {'reserving','reserved'}:
                try:self.budget.cancel_before_start(job_id)
                except BudgetError as error:
                    if error.code!='budget_reservation_missing':raise
                self._write(db,row,'cancelled_before_start',cancel_requested=True)
            elif current['state'] in AMBIGUOUS:
                if current['state']=='starting':self.budget.mark_started(job_id)
                self.budget.settle(job_id,None);self._write(db,row,'cancelled_unknown',cancel_requested=True)
        result=self.inspect(job_id)
        if remote is True and result['transport_kind']=='modal' and result['cancel_requested'] and self.transport is not None:
            result['remote_cancellation']=self.transport.cancel(job_id)
        return result

    def reconcile(self,job_id,actual_usd):
        amount=usd(micro_usd(actual_usd))
        with self.lock,self._db() as db:
            row=db.execute('SELECT * FROM room_dispatch_jobs WHERE job_id=?',(identifier(job_id),)).fetchone()
            if row is None:fail('room_job','Trabajo multivista no disponible.',404)
            current=self._dto(row)
            if current['state'] not in {'failed_unknown','cancelled_unknown','completed_remote','completed_test_stub'} or current['actual_cost_known']:fail('room_reconcile','Conciliación disponible sólo para un resultado local terminado con consumo pendiente.')
            self.budget.settle(job_id,amount)
            state='cancelled_known' if current['cancel_requested'] else ('completed_remote' if current['transport_kind']=='modal' else 'completed_test_stub') if current['artifact'] else 'failed_known'
            return self._write(db,row,state,actual_billed_usd=amount,actual_cost_known=True)
