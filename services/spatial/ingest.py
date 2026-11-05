"""Publish a completed Modal object into the local editable scene library.

This does not invoke a provider or infer placement, scale, walls or physics. It
reads the original completed dispatch and Modal-call journals, revalidates the
current reviewed capture package, then copies only the verified GLB. Local
journals are trusted application state, not independent evidence of AI quality.
"""
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile
from uuid import UUID, NAMESPACE_URL, uuid5

from pydantic import ValidationError
from contracts.spatial import SceneManifest
from services.spatial.dispatch import validate_dispatch_record, _validated_package
from services.spatial.dispatch import DispatchError
from services.spatial.review import CaptureReviewService, CaptureReviewError
from workers.spatial_runtime import validate_glb, SpatialWorkerError

MAX_DATABASE = 64 * 1024 * 1024
MAX_GLB = 30 * 1024 * 1024  # Current local viewer's per-asset bound.
IMPORT_COLUMNS = {'scene_id','job_id','dispatch_identity','artifact_sha256','source_sha256'}


class SpatialIngestError(ValueError):
    def __init__(self,code,message,status=409):
        self.code,self.status=code,status
        super().__init__(message)


def _fail(code='ingest_integrity',message='El resultado no coincide con su captura o ejecución registrada.',status=409):
    raise SpatialIngestError(code,message,status)


def scene_id_for_job(job_id):
    try:
        if not isinstance(job_id,str) or str(UUID(job_id))!=job_id:raise ValueError()
    except (ValueError,TypeError,AttributeError):_fail('ingest_job','Trabajo no disponible.',404)
    return str(uuid5(NAMESPACE_URL,'brivany:modal-object-scene:'+job_id))


@contextmanager
def _read_database(root,name):
    path=root/name
    if path.resolve()!=path or not path.is_file() or path.stat().st_size>MAX_DATABASE:
        _fail('ingest_execution_missing','Falta un diario local válido de la ejecución.',404)
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=10)) as db:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA trusted_schema=OFF')
        yield db


def completed_dispatch(root,job_id):
    """Read and corroborate a completed result without constructing dispatch."""
    root=Path(root).absolute();scene_id_for_job(job_id)
    with _read_database(root,'dispatch.sqlite3') as db:
        row=db.execute('SELECT * FROM dispatch_jobs WHERE job_id=?',(job_id,)).fetchone()
        if row is None:_fail('ingest_job','Trabajo no disponible.',404)
        document=validate_dispatch_record(row)
        if row['state']!='completed_remote' or document['transport_kind']!='modal' or document['origin']!='inferred' or document['cancel_requested'] or document['artifact'] is None:
            _fail('ingest_result_pending','Sólo se puede importar un resultado Modal completo y no cancelado.')
    # A changed test_stub label alone cannot manufacture a completed remote
    # receipt: the original per-job FunctionCall and authorized request must agree.
    with _read_database(root,'budget.sqlite3') as db:
        reservation=db.execute('SELECT * FROM reservations WHERE job_id=?',(job_id,)).fetchone()
        if reservation is None or reservation['state'] not in {'settled','unknown'} or type(reservation['reserved']) is not int or reservation['reserved']<=0:
            _fail('ingest_reservation','El resultado perdió su reserva y conciliación de consumo.')
        if document['actual_cost_known']:
            from services.spatial.budget import micro_usd
            if reservation['state']!='settled' or reservation['actual']!=micro_usd(document['actual_billed_usd']):_fail('ingest_reservation')
    request={key:document[key] for key in ('schema_version','job_id','capture_id','frame_id','image_sha256','mask_sha256','seed','timeout_seconds')}
    request.update(mask_reviewed=True,reserved_usd=reservation['reserved']/1_000_000)
    expected=hashlib.sha256(json.dumps(request,sort_keys=True,allow_nan=False).encode()).hexdigest()
    with _read_database(root,'modal-calls.sqlite3') as db:
        call=db.execute('SELECT * FROM modal_calls WHERE job_id=?',(job_id,)).fetchone()
        if (call is None or call['state']!='completed' or call['request_sha256']!=expected or
                not isinstance(call['call_id'],str) or not re.fullmatch(r'fc-[A-Za-z0-9_-]{1,100}',call['call_id'])):
            _fail('ingest_modal_receipt','La llamada Modal original no confirma este resultado completo.')
    return document


def validate_import_link(row,scene,dispatch):
    """Pure referential validator shared with offline backup/import checks."""
    try:
        value=dict(row)
        if set(value)!=IMPORT_COLUMNS or value['scene_id']!=scene_id_for_job(value['job_id']):raise ValueError()
        if (value['job_id']!=dispatch['job_id'] or value['dispatch_identity']!=dispatch['identity'] or
                value['artifact_sha256']!=dispatch['artifact']['sha256'] or value['source_sha256']!=dispatch['source_sha256'] or
                dispatch['transport_kind']!='modal' or dispatch['origin']!='inferred' or dispatch['cancel_requested']):raise ValueError()
        document=scene.model_dump(mode='json') if isinstance(scene,SceneManifest) else scene
        if (document['scene_id']!=value['scene_id'] or document['origin']!='capture_reconstruction' or
                document['capture_id']!=dispatch['capture_id'] or document['source_frame_ids']!=[dispatch['frame_id']] or
                document['units']!='source_relative' or document['metric_verification'] is not None or len(document['assets'])!=1 or len(document['objects'])!=1):raise ValueError()
        asset=document['assets'][0]
        if (asset['id']!='reconstructed-object' or asset['relative_path']!='assets/reconstructed-object.glb' or
                asset['sha256']!=value['artifact_sha256'] or asset['provenance']!='inferred' or asset['source_frame_ids']!=[dispatch['frame_id']]):raise ValueError()
    except (ValueError,KeyError,TypeError,AttributeError):_fail('ingest_link','La escena perdió la procedencia de su resultado importado.')
    return value


class SpatialIngestService:
    def __init__(self,spatial):
        self.spatial=spatial;self.root=Path(spatial.root).absolute()
        if self.root.resolve()!=self.root:_fail('ingest_storage','El almacenamiento espacial no puede redirigirse.')

    def list_results(self,capture_id):
        """List completed local receipts, without polling or constructing clients.

        Eligibility checks the journals and saved GLB. Import still revalidates
        the current review, source frame and prepared package at the explicit
        publication boundary. The list must not initialize history or databases.
        """
        scene_id_for_job(capture_id)
        empty={'items':[],'has_more':False,'review_revalidation_required':True,
            'provider_invoked':False,'external_calls':0,'gpu_seconds':0}
        try:
            with _read_database(self.root,'spatial.sqlite3') as db:
                if not db.execute('SELECT 1 FROM spaces WHERE capture_id=?',(capture_id,)).fetchone():
                    _fail('ingest_capture_missing','La captura preparada no está en la biblioteca.',404)
                has_links=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_imports'").fetchone()
                links={row['job_id']:dict(row) for row in db.execute('SELECT * FROM scene_imports')} if has_links else {}
                scenes={row['id']:dict(row) for row in db.execute('SELECT id,document,baseline FROM scenes')}
            # Absence is an ordinary initial state; do not create an empty journal.
            if not (self.root/'dispatch.sqlite3').exists():return empty
            with _read_database(self.root,'dispatch.sqlite3') as db:
                rows=db.execute("""SELECT * FROM dispatch_jobs WHERE state='completed_remote'
                    AND CASE WHEN json_valid(document) THEN json_extract(document,'$.capture_id') END=?
                    ORDER BY rowid DESC LIMIT 21""",(capture_id,)).fetchall()
            items=[]
            for row in rows[:20]:
                item={'job_id':row['job_id'],'state':row['state'],'source_sha256':None,
                    'artifact_sha256':None,'scene_id':None,'imported':False,
                    'eligible_for_import':False,'error_code':None}
                try:
                    dispatch=completed_dispatch(self.root,row['job_id']);self._artifact(dispatch)
                    item.update(source_sha256=dispatch['source_sha256'],artifact_sha256=dispatch['artifact']['sha256'])
                    link=links.get(row['job_id'])
                    if link is not None:
                        scene=scenes.get(link['scene_id'])
                        if scene is None:_fail('ingest_link')
                        for key in ('document','baseline'):
                            validate_import_link(link,SceneManifest.model_validate_json(scene[key]),dispatch)
                        stored=self.spatial._owned('scenes',link['scene_id'],'assets','reconstructed-object.glb')
                        if not stored.is_file() or stored.stat().st_size>MAX_GLB or hashlib.sha256(stored.read_bytes()).hexdigest()!=link['artifact_sha256']:
                            _fail('ingest_asset')
                        item.update(scene_id=link['scene_id'],imported=True)
                    item['eligible_for_import']=True
                except (SpatialIngestError,DispatchError) as error:item['error_code']=error.code
                except (OSError,sqlite3.Error,ValueError,TypeError):item['error_code']='ingest_invalid'
                items.append(item)
            return {**empty,'items':items,'has_more':len(rows)>20}
        except SpatialIngestError:raise
        except (OSError,sqlite3.Error,ValueError,TypeError):
            _fail('ingest_invalid','No se pudieron consultar los resultados locales.')

    def _input(self,job_id,payload):
        if not isinstance(payload,dict) or set(payload)-{'expected_source_sha256','expected_artifact_sha256','title'} or not {'expected_source_sha256','expected_artifact_sha256'}<=set(payload):
            _fail('ingest_request','Confirma los hashes de la captura y del resultado antes de importarlo.',422)
        for key in ('expected_source_sha256','expected_artifact_sha256'):
            if not isinstance(payload[key],str) or not re.fullmatch('[0-9a-f]{64}',payload[key]):_fail('ingest_request','Los hashes de importación no son válidos.',422)
        title=payload.get('title')
        if title is not None and (not isinstance(title,str) or not 1<=len(title.strip())<=120 or any(ord(c)<32 for c in title)):
            _fail('ingest_title','Escribe un nombre de hasta 120 caracteres.',422)
        document=completed_dispatch(self.root,job_id)
        if document['source_sha256']!=payload['expected_source_sha256'] or document['artifact']['sha256']!=payload['expected_artifact_sha256']:
            _fail('ingest_expected_hash','El resultado o la captura ya no coincide con lo que revisaste.')
        return document,title.strip() if title is not None else None

    def _reviewed(self,document):
        if not (self.root/'reviews.sqlite3').is_file():_fail('ingest_review_missing','Falta la revisión del objeto de origen.')
        reviews=CaptureReviewService(self.root)
        info,image,mask,package_sha=_validated_package(reviews,document['capture_id'],document['package_id'],document['review_revision'])
        if (package_sha!=document['package_sha256'] or info['source_sha256']!=document['source_sha256'] or info['frame_id']!=document['frame_id'] or
                hashlib.sha256(image).hexdigest()!=document['image_sha256'] or hashlib.sha256(mask).hexdigest()!=document['mask_sha256']):_fail()
        return info

    def _artifact(self,document):
        path=self.root/'dispatch-artifacts'/(document['job_id']+'.glb')
        if path.resolve()!=path or not path.is_file() or path.stat().st_size>MAX_GLB:
            _fail('ingest_asset','Falta un GLB íntegro de hasta 30 MiB compatible con el visor.')
        raw=path.read_bytes();checked=validate_glb(raw)
        if any(document['artifact'].get(key)!=value for key,value in checked.items()):_fail('ingest_asset','El artefacto cambió o no coincide con su manifiesto.')
        return raw

    def import_result(self,job_id,payload):
        """Atomic library publication; duplicate imports preserve user edits."""
        scene_id=scene_id_for_job(job_id);published=False;committed=False
        try:
            dispatch,title=self._input(job_id,payload);info=self._reviewed(dispatch);raw=self._artifact(dispatch)
            label=info['label'];title=title or ('Objeto · '+label)[:120]
            document=SceneManifest.model_validate_json(json.dumps({
                'scene_id':scene_id,'capture_id':dispatch['capture_id'],'origin':'capture_reconstruction',
                'title':title,'units':'source_relative','source_frame_ids':[dispatch['frame_id']],
                'assets':[{'id':'reconstructed-object','kind':'mesh','relative_path':'assets/reconstructed-object.glb',
                    'sha256':dispatch['artifact']['sha256'],'provenance':'inferred','source_frame_ids':[dispatch['frame_id']],
                    'note':'Resultado de reconstrucción de un objeto a partir de una imagen y máscara revisadas. Superficies ocultas inferidas; fidelidad y escala sin verificar.'}],
                'objects':[{'id':info['object_id'],'label':label,'asset_id':'reconstructed-object'}],
                'limitations':[
                    'Vista parcial de un único objeto: no es una habitación reconstruida ni un plano completo.',
                    'Las zonas ocultas son inferidas; fidelidad visual, geometría, cámaras y orientación necesitan revisión.',
                    'Unidades relativas. La referencia de longitud de la captura no verifica la escala del resultado.',
                    'Posición inicial en el origen del modelo, sin alineación a la habitación ni relación espacial estimada.',
                    'No se asignan masa medida, colisiones ni dinámica física.']
            },ensure_ascii=False)).model_dump(mode='json')
            link={'scene_id':scene_id,'job_id':job_id,'dispatch_identity':dispatch['identity'],
                'artifact_sha256':dispatch['artifact']['sha256'],'source_sha256':dispatch['source_sha256']}
            validate_import_link(link,document,dispatch)
            target=self.spatial._owned('scenes',scene_id)
            with self.spatial.lock,self.spatial._connect() as db:
                if self.spatial._closed:_fail('ingest_service_closed','El servicio espacial está cerrado.',503)
                db.execute('BEGIN IMMEDIATE')
                db.execute('CREATE TABLE IF NOT EXISTS scene_imports(scene_id TEXT PRIMARY KEY,job_id TEXT UNIQUE NOT NULL,dispatch_identity TEXT NOT NULL,artifact_sha256 TEXT NOT NULL,source_sha256 TEXT NOT NULL)')
                existing=db.execute('SELECT * FROM scene_imports WHERE job_id=?',(job_id,)).fetchone()
                if existing:
                    row=db.execute('SELECT document,baseline FROM scenes WHERE id=?',(scene_id,)).fetchone()
                    if row is None:_fail('ingest_link')
                    for value in (row['document'],row['baseline']):validate_import_link(existing,SceneManifest.model_validate_json(value),dispatch)
                    stored=self.spatial._owned('scenes',scene_id,'assets','reconstructed-object.glb')
                    if stored.resolve()!=stored or not stored.is_file() or hashlib.sha256(stored.read_bytes()).hexdigest()!=link['artifact_sha256']:_fail('ingest_asset')
                    committed=True
                else:
                    if db.execute('SELECT count(*) FROM spaces').fetchone()[0]>=100:_fail('spatial_library_full','La biblioteca local está llena.',429)
                    if not db.execute('SELECT 1 FROM spaces WHERE capture_id=?',(dispatch['capture_id'],)).fetchone():_fail('ingest_capture_missing','La captura preparada no está en la biblioteca.')
                    if target.exists() or db.execute('SELECT 1 FROM scenes WHERE id=?',(scene_id,)).fetchone():_fail('ingest_target_exists','Ya existe otro contenido en el destino; no se reemplazará.')
                    with tempfile.TemporaryDirectory(prefix='.ingest-',dir=self.root/'scenes') as staging:
                        folder=Path(staging)/'scene';(folder/'assets').mkdir(parents=True)
                        (folder/'assets'/'reconstructed-object.glb').write_bytes(raw)
                        from services.spatial.backup import _publish_directory
                        _publish_directory(folder,target);published=True
                    stamp=datetime.now(timezone.utc).isoformat();encoded=json.dumps(document,ensure_ascii=False,allow_nan=False)
                    db.execute('INSERT INTO scenes VALUES(?,?,?,1)',(scene_id,encoded,encoded))
                    db.execute('INSERT INTO spaces VALUES(?,?,?,?,?,?,?,?)',(scene_id,title,'ready','capture_reconstruction',scene_id,dispatch['capture_id'],stamp,stamp))
                    db.execute('INSERT INTO scene_imports VALUES(?,?,?,?,?)',tuple(link[key] for key in ('scene_id','job_id','dispatch_identity','artifact_sha256','source_sha256')))
                    # Repeat current input checks before committing publication;
                    # another review cannot silently replace the source evidence.
                    current=completed_dispatch(self.root,job_id)
                    if current['identity']!=dispatch['identity'] or current['artifact']!=dispatch['artifact']:_fail()
                    self._reviewed(current)
                # Reading a scene lazily creates its initial history. Do this
                # under the publication write lock so concurrent imports through
                # separate service instances cannot race that initialization.
                self.spatial._history_ensure(db,db.execute('SELECT * FROM scenes WHERE id=?',(scene_id,)).fetchone())
            committed=True
            return {'space':self.spatial.get_space(scene_id),'scene':self.spatial.scene(scene_id),'import':{
                'job_id':job_id,'scene_id':scene_id,'scope':'single_object_preview','duplicate':existing is not None,
                'source_sha256':dispatch['source_sha256'],'artifact_sha256':dispatch['artifact']['sha256'],
                'provider_invoked':False,'external_calls':0,'gpu_seconds':0,'metric_scale_verified':False,
                'geometry_fidelity_verified':False,'physical_realism_verified':False}}
        except SpatialIngestError:raise
        except (OSError,sqlite3.Error,ValueError,ValidationError,SpatialWorkerError,CaptureReviewError):
            _fail('ingest_invalid','No se pudo validar o guardar el resultado con su evidencia local.')
        finally:
            if published and not committed:self.spatial._remove_owned('scenes',scene_id)
