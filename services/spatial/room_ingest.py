"""Publish a completed multiview surface locally without invoking a provider.

The local Modal receipt and budget history authenticate application provenance,
not independent proof of geometry/model quality. Original capture, hashes and
all numerical output are revalidated before publication. No walls/doors/objects
are invented and the input's relative coordinate system stays unverified.
"""
from contextlib import closing
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile
from uuid import UUID,uuid5,NAMESPACE_URL

from pydantic import ValidationError
from contracts.spatial import SceneManifest
from services.spatial.room import RoomPreparationService
from services.spatial.room_dispatch import completed_room_dispatch,validate_surface,validate_room_glb,read_database,RoomDispatchError
from workers.spatial_room import canonical
from workers.spatial_runtime import SpatialWorkerError

LINK_COLUMNS={'scene_id','job_id','dispatch_identity','artifact_sha256','surface_sha256','source_sha256'}


class RoomIngestError(ValueError):
    def __init__(self,code,message,status=409):self.code,self.status=code,status;super().__init__(message)


def fail(code='room_import_integrity',message='La superficie multivista perdió su procedencia o integridad.',status=409):raise RoomIngestError(code,message,status)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def scene_id_for_room(job_id):
    try:
        if not isinstance(job_id,str) or str(UUID(job_id))!=job_id:raise ValueError()
    except (ValueError,TypeError,AttributeError):fail('room_import_job','Trabajo multivista no disponible.',404)
    return str(uuid5(NAMESPACE_URL,'brivany:room-scene:'+job_id))


def evidence(dispatch,surface):
    return {'format':'brivany-room-evidence-1','job_id':dispatch['job_id'],'dispatch_identity':dispatch['identity_sha256'],
        'pipeline_version':dispatch['pipeline_version'],'source_sha256':dispatch['source_sha256'],
        'artifact_sha256':dispatch['artifact']['sha256'],'surface_sha256':dispatch['surface_manifest']['sha256'],
        'geometry_kind':surface['geometry_kind'],'vertex_count':surface['vertex_count'],'triangle_count':surface['triangle_count'],
        'cameras':surface['cameras'],'frame_reports':surface['frames'],
        **{key:surface['uncertainty'][key] for key in ('holes_filled','cross_view_fusion','confidence_is_probability','colors_include_captured_lighting','unknown_surfaces')},
        **{key:surface[key] for key in ('camera_orientation_verified','scene_coverage_verified','geometry_fidelity_verified','metric_scale_verified','physical_realism_verified')}}


def validate_room_link(row,scene,dispatch,surface):
    """Pure lineage check shared by import, offline backup and restore."""
    try:
        link=dict(row);document=scene.model_dump(mode='json') if isinstance(scene,SceneManifest) else scene
        expected={'scene_id':scene_id_for_room(dispatch['job_id']),'job_id':dispatch['job_id'],
            'dispatch_identity':dispatch['identity_sha256'],'artifact_sha256':dispatch['artifact']['sha256'],
            'surface_sha256':dispatch['surface_manifest']['sha256'],'source_sha256':dispatch['source_sha256']}
        if set(link)!=LINK_COLUMNS or link!=expected:raise ValueError()
        if (dispatch['transport_kind']!='modal' or dispatch['origin']!='inferred' or dispatch['cancel_requested'] or
            document['scene_id']!=expected['scene_id'] or document['origin']!='room_reconstruction' or document['capture_id']!=dispatch['capture_id'] or
            document['source_frame_ids']!=[frame['id'] for frame in dispatch['source_frames']] or document['units']!='source_relative' or document['metric_verification'] is not None):raise ValueError()
        # Normalize only the typed portable structure; the exact original surface
        # has a separate verified content hash and remains in the result store.
        from contracts.room_evidence import RoomEvidence
        normalized=RoomEvidence.model_validate_json(canonical(evidence(dispatch,surface))).model_dump(mode='json')
        if document['reconstruction']!=normalized or len(document['assets'])!=1 or len(document['objects'])!=1:raise ValueError()
        asset=document['assets'][0];obj=document['objects'][0]
        if asset['id']!='room-surface' or asset['relative_path']!='assets/room-surface.glb' or asset['sha256']!=expected['artifact_sha256'] or asset['provenance']!='inferred' or asset['source_frame_ids']!=document['source_frame_ids']:raise ValueError()
        if obj['id']!='room-surface' or obj['asset_id']!='room-surface' or obj['editable'] or obj['role']!='environment' or obj['physics']['collider']!='none':raise ValueError()
        if obj['transform']!={'position':[0.,0.,0.],'rotation_xyzw':[0.,0.,0.,1.],'scale':[1.,1.,1.]}:raise ValueError()
    except (ValueError,KeyError,TypeError,AttributeError,ValidationError):fail()
    return link


def verified_result_files(root,dispatch):
    root=Path(root).absolute();blobs={}
    for key,maximum in (('artifact',30*1024*1024),('surface_manifest',512*1024)):
        item=dispatch[key];path=root/item['relative_path']
        if path.resolve()!=path or not path.is_file() or path.stat().st_size!=item['size_bytes'] or path.stat().st_size>maximum:fail('room_import_asset','Falta la malla o su manifiesto multivista íntegro.')
        raw=path.read_bytes()
        if digest(raw)!=item['sha256']:fail('room_import_asset','El resultado multivista cambió.')
        blobs[key]=raw
    surface=json.loads(blobs['surface_manifest']);validate_surface(surface,dispatch['source_frames'])
    checked=validate_room_glb(blobs['artifact'],surface)
    if any(dispatch['artifact'].get(key)!=value for key,value in checked.items()):fail('room_import_asset')
    return blobs['artifact'],surface


def validate_portable_room(scene,raw_glb,raw_surface):
    """Offline structural coherence; no provider receipt or accuracy claim."""
    try:
        document=scene.model_dump(mode='json') if isinstance(scene,SceneManifest) else scene
        record=document['reconstruction']
        if document['origin']!='room_reconstruction' or len(raw_surface)>512*1024 or digest(raw_surface)!=record['surface_sha256'] or digest(raw_glb)!=record['artifact_sha256']:fail('room_portable_integrity')
        surface=json.loads(raw_surface)
        validate_surface(surface,[{'id':camera['frame_id'],'at_seconds':camera['at_seconds']} for camera in record['cameras']])
        validate_room_glb(raw_glb,surface)
        from contracts.room_evidence import RoomEvidence
        source={'job_id':record['job_id'],'identity_sha256':record['dispatch_identity'],'pipeline_version':record['pipeline_version'],
            'source_sha256':record['source_sha256'],'artifact':{'sha256':record['artifact_sha256']},'surface_manifest':{'sha256':record['surface_sha256']}}
        expected=RoomEvidence.model_validate_json(canonical(evidence(source,surface))).model_dump(mode='json')
        if expected!=record:fail('room_portable_integrity')
        return surface
    except (RoomIngestError,RoomDispatchError):raise
    except (ValueError,TypeError,KeyError):fail('room_portable_integrity')


class RoomIngestService:
    def __init__(self,spatial):
        self.spatial=spatial;self.root=Path(spatial.root).absolute()
        if self.root.resolve()!=self.root:fail('room_import_storage','El almacén multivista no puede redirigirse.')

    def _source(self,dispatch):
        # The original lock hash remains in the durable dispatch. Current shipped
        # configuration can be closed while importing a previously completed job.
        prepared=RoomPreparationService(self.spatial).prepare(dispatch['capture_id'],{
            'expected_source_sha256':dispatch['source_sha256'],'frame_ids':[frame['id'] for frame in dispatch['source_frames']],
            'reviewed':True,'parameters':dispatch['parameters'],'seed':dispatch['seed'],'timeout_seconds':dispatch['timeout_seconds']})['preflight']
        if prepared['frames']!=dispatch['source_frames']:fail('room_import_source','Los fotogramas ya no coinciden con el trabajo completado.')

    def list_results(self,capture_id):
        scene_id_for_room(capture_id)
        empty={'items':[],'has_more':False,'provider_invoked':False,'external_calls':0,'gpu_seconds':0,'source_revalidation_required':True}
        try:
            with read_database(self.root,'spatial.sqlite3') as db:
                if not db.execute('SELECT 1 FROM spaces WHERE capture_id=?',(capture_id,)).fetchone():fail('room_import_capture','Captura no disponible.',404)
                exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='room_scene_imports'").fetchone()
                links={row['job_id']:dict(row) for row in db.execute('SELECT * FROM room_scene_imports')} if exists else {}
                scenes={row['id']:dict(row) for row in db.execute('SELECT id,document,baseline FROM scenes')}
            if not (self.root/'room-dispatch.sqlite3').exists():return empty
            with read_database(self.root,'room-dispatch.sqlite3') as db:
                rows=db.execute("SELECT * FROM room_dispatch_jobs WHERE state='completed_remote' AND CASE WHEN json_valid(document) THEN json_extract(document,'$.capture_id') END=? ORDER BY rowid DESC LIMIT 21",(capture_id,)).fetchall()
            items=[]
            for row in rows[:20]:
                item={'kind':'room','job_id':row['job_id'],'scene_id':None,'imported':False,'eligible_for_import':False,
                    'source_sha256':None,'artifact_sha256':None,'surface_sha256':None,'error_code':None,'title':'Superficie multivista'}
                try:
                    dispatch=completed_room_dispatch(self.root,row['job_id']);raw,surface=verified_result_files(self.root,dispatch)
                    item.update(source_sha256=dispatch['source_sha256'],artifact_sha256=dispatch['artifact']['sha256'],surface_sha256=dispatch['surface_manifest']['sha256'])
                    link=links.get(row['job_id'])
                    if link:
                        stored=scenes.get(link['scene_id'])
                        if not stored:fail()
                        for key in ('document','baseline'):validate_room_link(link,SceneManifest.model_validate_json(stored[key]),dispatch,surface)
                        path=self.spatial._owned('scenes',link['scene_id'],'assets','room-surface.glb')
                        if not path.is_file() or path.stat().st_size>30*1024*1024 or digest(path.read_bytes())!=link['artifact_sha256']:fail('room_import_asset')
                        item.update(scene_id=link['scene_id'],imported=True)
                    item['eligible_for_import']=True
                except (RoomIngestError,RoomDispatchError,SpatialWorkerError) as error:item['error_code']=error.code
                except (ValueError,TypeError,KeyError,OSError,sqlite3.Error):item['error_code']='room_import_invalid'
                items.append(item)
            return {**empty,'items':items,'has_more':len(rows)>20}
        except RoomIngestError:raise
        except (RoomDispatchError,SpatialWorkerError) as error:fail(error.code,str(error),getattr(error,'status',409))
        except (ValueError,TypeError,KeyError,OSError,sqlite3.Error):fail('room_import_invalid')

    def import_result(self,job_id,payload):
        scene_id=scene_id_for_room(job_id);published=False;committed=False
        try:
            required={'expected_source_sha256','expected_artifact_sha256','expected_surface_sha256'}
            if not isinstance(payload,dict) or not required<=set(payload) or set(payload)-required-{'title'}:fail('room_import_request','Confirma captura, malla y manifiesto revisados.',422)
            if any(not isinstance(payload[key],str) or not re.fullmatch('[a-f0-9]{64}',payload[key]) for key in required):fail('room_import_request','Los hashes esperados no son válidos.',422)
            title=payload.get('title','Habitación · superficie multivista')
            if not isinstance(title,str) or not 1<=len(title.strip())<=120 or any(ord(char)<32 for char in title):fail('room_import_title','Escribe un nombre de hasta 120 caracteres.',422)
            dispatch=completed_room_dispatch(self.root,job_id)
            if payload['expected_source_sha256']!=dispatch['source_sha256'] or payload['expected_artifact_sha256']!=dispatch['artifact']['sha256'] or payload['expected_surface_sha256']!=dispatch['surface_manifest']['sha256']:fail('room_import_changed','El resultado cambió desde su consulta.')
            self._source(dispatch);raw,surface=verified_result_files(self.root,dispatch)
            frames=[frame['id'] for frame in dispatch['source_frames']]
            document=SceneManifest.model_validate_json(canonical({'scene_id':scene_id,'capture_id':dispatch['capture_id'],'origin':'room_reconstruction',
                'title':title.strip(),'units':'source_relative','source_frame_ids':frames,'reconstruction':evidence(dispatch,surface),
                'assets':[{'id':'room-surface','kind':'mesh','relative_path':'assets/room-surface.glb','sha256':dispatch['artifact']['sha256'],
                    'provenance':'inferred','source_frame_ids':frames,'note':'Superficie apoyada en profundidad estimada de varias vistas. Cámaras, orientación, cobertura y escala sin verificar. Colores con iluminación capturada; no son materiales PBR recuperados.'}],
                'objects':[{'id':'room-surface','label':'Superficie del espacio','asset_id':'room-surface','role':'environment','editable':False}],
                'limitations':['Superficie multivista de observaciones parciales; no es un plano profesional ni una vivienda completa verificada.',
                    'Sin fusión entre vistas: pueden existir solapamientos, duplicados y huecos. Las superficies desconocidas no se rellenan.',
                    'Cámaras y profundidad inferidas; orientación, cobertura, escala y fidelidad requieren comparación con la captura y medidas reales.',
                    'Unidades relativas: la referencia declarada de captura no certifica dimensiones del modelo.',
                    'Los colores incluyen luz y sombras capturadas. No se han recuperado materiales, luces ni sombras físicas separadas.',
                    'No hay objetos separados, articulaciones ni colliders calibrados. La superficie permanece fija.']})).model_dump(mode='json')
            link={'scene_id':scene_id,'job_id':job_id,'dispatch_identity':dispatch['identity_sha256'],'artifact_sha256':dispatch['artifact']['sha256'],
                'surface_sha256':dispatch['surface_manifest']['sha256'],'source_sha256':dispatch['source_sha256']}
            validate_room_link(link,document,dispatch,surface);target=self.spatial._owned('scenes',scene_id)
            with self.spatial.lock,self.spatial._connect() as db:
                if self.spatial._closed:fail('room_import_closed','El servicio espacial está cerrado.',503)
                db.execute('BEGIN IMMEDIATE')
                db.execute('CREATE TABLE IF NOT EXISTS room_scene_imports(scene_id TEXT PRIMARY KEY,job_id TEXT UNIQUE NOT NULL,dispatch_identity TEXT NOT NULL,artifact_sha256 TEXT NOT NULL,surface_sha256 TEXT NOT NULL,source_sha256 TEXT NOT NULL)')
                old=db.execute('SELECT * FROM room_scene_imports WHERE job_id=?',(job_id,)).fetchone()
                if old:
                    stored=db.execute('SELECT document,baseline FROM scenes WHERE id=?',(scene_id,)).fetchone()
                    if not stored:fail()
                    for key in ('document','baseline'):validate_room_link(old,SceneManifest.model_validate_json(stored[key]),dispatch,surface)
                    path=self.spatial._owned('scenes',scene_id,'assets','room-surface.glb')
                    if not path.is_file() or path.stat().st_size>30*1024*1024 or digest(path.read_bytes())!=link['artifact_sha256']:fail('room_import_asset')
                else:
                    if db.execute('SELECT count(*) FROM spaces').fetchone()[0]>=100:fail('spatial_library_full','La biblioteca está llena.',429)
                    if not db.execute('SELECT 1 FROM spaces WHERE capture_id=?',(dispatch['capture_id'],)).fetchone():fail('room_import_capture','La captura no está en la biblioteca.')
                    if target.exists() or db.execute('SELECT 1 FROM scenes WHERE id=?',(scene_id,)).fetchone():fail('room_import_exists','No se reemplazará un destino existente.')
                    with tempfile.TemporaryDirectory(prefix='.room-import-',dir=self.root/'scenes') as staging:
                        folder=Path(staging)/'scene';(folder/'assets').mkdir(parents=True);(folder/'assets/room-surface.glb').write_bytes(raw)
                        from services.spatial.backup import _publish_directory
                        _publish_directory(folder,target);published=True
                    stamp=datetime.now(timezone.utc).isoformat();encoded=canonical(document).decode()
                    db.execute('INSERT INTO scenes VALUES(?,?,?,1)',(scene_id,encoded,encoded))
                    db.execute('INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)',(scene_id,title.strip(),'ready','room_reconstruction',scene_id,dispatch['capture_id'],stamp,stamp))
                    db.execute('INSERT INTO room_scene_imports VALUES(?,?,?,?,?,?)',tuple(link[key] for key in ('scene_id','job_id','dispatch_identity','artifact_sha256','surface_sha256','source_sha256')))
                current=completed_room_dispatch(self.root,job_id)
                if current['identity_sha256']!=dispatch['identity_sha256'] or current['artifact']!=dispatch['artifact'] or current['surface_manifest']!=dispatch['surface_manifest']:fail()
                self._source(current);self.spatial._history_ensure(db,db.execute('SELECT * FROM scenes WHERE id=?',(scene_id,)).fetchone())
            committed=True
            return {'space':self.spatial.get_space(scene_id),'scene':self.spatial.scene(scene_id),'import':{'job_id':job_id,'scene_id':scene_id,
                'duplicate':old is not None,'scope':'multiview_supported_surface_preview','source_sha256':link['source_sha256'],
                'artifact_sha256':link['artifact_sha256'],'surface_sha256':link['surface_sha256'],'provider_invoked':False,
                'external_calls':0,'gpu_seconds':0,'metric_scale_verified':False,'scene_coverage_verified':False,'physical_realism_verified':False}}
        except RoomIngestError:raise
        except (RoomDispatchError,SpatialWorkerError) as error:fail(error.code,str(error),getattr(error,'status',409))
        except (OSError,sqlite3.Error,ValueError,TypeError,KeyError,ValidationError):fail('room_import_invalid','No se pudo validar o guardar la superficie con su procedencia.')
        finally:
            if published and not committed:self.spatial._remove_owned('scenes',scene_id)
