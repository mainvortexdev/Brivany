"""Offline spatial backup/restore with an allowlist and atomic new-directory publish.

No worker is instantiated, no provider is contacted, and no original video or
uploads are included. Private original reference photos and derived media are
included when present, with explicit indicators in the manifest and summary.
"""
from __future__ import annotations
from contextlib import contextmanager, closing
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import socket
import sqlite3
import stat
import struct
import sys
import tempfile
import zlib
from uuid import UUID
from zipfile import ZipFile, ZIP_DEFLATED, BadZipFile

FORMAT="brivany-spatial-backup-1"
MAX_TOTAL=2*1024*1024*1024
MAX_FILES=10000
MAX_MANIFEST=4*1024*1024
MAX_DATABASE=64*1024*1024
DATABASES={
    "spatial.sqlite3": {
        "spaces":{"id","title","status","origin","scene_id","capture_id","created_at","updated_at"},
        "scenes":{"id","document","baseline","revision"},
        "jobs":{"id","space_id","kind","state","progress","stage","error_code","created_at","updated_at","cache_key","payload"},
        "cache":{"key","kind","result_id"},
        "scene_history":{"scene_id","cursor","states"},
        "scene_layouts":{"id","scene_id","name","created_at","source_revision","transforms"},
        "scene_plan_settings":{"scene_id","revision","document"},
        "scene_imports":{"scene_id","job_id","dispatch_identity","artifact_sha256","source_sha256"},
        "room_scene_imports":{"scene_id","job_id","dispatch_identity","artifact_sha256","surface_sha256","source_sha256"},
    },
    "reviews.sqlite3":{"reviews":{"capture_id","revision","document"}},
    "dispatch.sqlite3":{"dispatch_jobs":{"job_id","identity","state","document"}},
    "modal-calls.sqlite3":{"modal_calls":{"job_id","request_sha256","call_id","state"}},
    "room-dispatch.sqlite3":{"room_dispatch_jobs":{"job_id","identity","state","document"}},
    "room-modal-calls.sqlite3":{"modal_calls":{"job_id","request_sha256","call_id","state"}},
    "presentation.sqlite3":{"presentations":{"scene_id","revision","source_scene_revision","updated_at","document"}},
    "budget.sqlite3":{
        "budget_config":{"id","enabled","total","per_job","rate","extra"},
        "reservations":{"job_id","estimate","reserved","state","actual"},
        "budget_events":{"sequence","job_id","action","amount","recorded_at"},
        "sqlite_sequence":{"name","seq"},
    },
}
REQUIRED={"spatial.sqlite3":{"spaces","scenes","jobs","cache"},"reviews.sqlite3":{"reviews"},
          "budget.sqlite3":{"budget_config","reservations","budget_events","sqlite_sequence"},
          "dispatch.sqlite3":{"dispatch_jobs"},"modal-calls.sqlite3":{"modal_calls"},"presentation.sqlite3":{"presentations"},
          "room-dispatch.sqlite3":{"room_dispatch_jobs"},"room-modal-calls.sqlite3":{"modal_calls"}}
UUID_PATTERN=r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
SHA_PATTERN=r"[0-9a-f]{64}"


class BackupError(ValueError):
    def __init__(self,code,message):self.code=code;super().__init__(message)


def _fail(code="backup_invalid",message="El respaldo espacial no es válido o está incompleto."):
    raise BackupError(code,message)


def _server_listening():
    try:
        with socket.create_connection(("127.0.0.1",8765),timeout=.25):return True
    except (ConnectionRefusedError,TimeoutError,OSError):return False


def _offline(offline):
    if offline is not True:_fail("offline_required","Indica --offline después de cerrar Brivany.")
    if _server_listening():_fail("server_running","Cierra el servidor local de Brivany antes de respaldar o restaurar.")


def _safe_root(path,exists=True):
    path=Path(path).absolute()
    if path.resolve()!=path or exists and (not path.is_dir() or path.is_symlink()):
        _fail("backup_path","La ruta debe ser una carpeta local sin redirecciones.")
    return path


def _safe_name(value):
    if not isinstance(value,str) or not value or "\\" in value or ":" in value or any(ord(c)<32 for c in value):return False
    path=PurePosixPath(value)
    if path.is_absolute() or any(part in {"",".",".."} for part in value.split("/")):return False
    return True


def _allowed(value):
    if not _safe_name(value):return False
    if value in DATABASES:return True
    patterns=(
        rf"scenes/{UUID_PATTERN}/assets/[a-z][a-z0-9_-]{{0,79}}\.(glb|ply)",
        rf"scenes/{UUID_PATTERN}/render\.json",
        rf"captures/{UUID_PATTERN}/(capture|preflight|reconstruction-plan)\.json",
        rf"captures/{UUID_PATTERN}/frames/frame-[0-9]{{4}}\.jpg",
        rf"captures/{UUID_PATTERN}/review/masks/{SHA_PATTERN}\.png",
        rf"captures/{UUID_PATTERN}/review/packages/{SHA_PATTERN}\.zip",
        rf"dispatch-artifacts/{UUID_PATTERN}\.glb",
        rf"room-artifacts/{UUID_PATTERN}\.(?:glb|surface\.json)",
        rf"reference-sets/{UUID_PATTERN}/references\.json",
        rf"reference-sets/{UUID_PATTERN}/originals/frame-00(?:0[0-9]|1[01])\.(png|jpg)",
        rf"reference-sets/{UUID_PATTERN}/derived/frame-00(?:0[0-9]|1[01])\.jpg",
    )
    return any(re.fullmatch(pattern,value) for pattern in patterns)


def _limit(value):
    if value in DATABASES:return MAX_DATABASE
    if value.startswith('room-artifacts/') and value.endswith('.surface.json'):return 512*1024
    if value.startswith('reference-sets/'):
        if '/originals/' in value:return 8*1024*1024
        if value.endswith('/references.json'):return 128*1024
        return 2*1024*1024
    if value.endswith('/render.json'):return 64*1024
    if value.endswith(".json"):return 256*1024
    if value.endswith(".jpg") or "/masks/" in value:return 2*1024*1024
    if value.endswith(".zip"):return 12*1024*1024
    return 100*1024*1024


def _hash(path):
    digest=hashlib.sha256();size=0
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            size+=len(chunk)
            if size>MAX_TOTAL:_fail("backup_limit","El respaldo supera el límite de tamaño.")
            digest.update(chunk)
    return digest.hexdigest(),size


@contextmanager
def _database(path):
    db=sqlite3.connect(path.as_uri()+"?mode=ro",uri=True,timeout=5)
    try:
        db.execute("PRAGMA trusted_schema=OFF");yield db
    finally:db.close()


def _check_database(path,name):
    if path.stat().st_size>MAX_DATABASE:_fail("backup_database","La base espacial excede el límite.")
    try:
        with _database(path) as db:
            if db.execute("PRAGMA quick_check").fetchall()!=[("ok",)]:_fail("backup_database","La comprobación de SQLite falló.")
            entities=db.execute("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_%'").fetchall()
            tables=set()
            for entity,kind in entities:
                if kind!='table' or entity not in DATABASES[name]:_fail("backup_database","La base contiene estructuras no admitidas.")
                columns={row[1] for row in db.execute('PRAGMA table_info("'+entity+'")')}
                if columns!=DATABASES[name][entity]:_fail("backup_database","El esquema de la base no coincide.")
                tables.add(entity)
            if not REQUIRED[name].issubset(tables):_fail("backup_database","Faltan tablas necesarias para recuperar el espacio.")
            if name=='spatial.sqlite3' and db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','running','cancelling')").fetchone()[0]:
                _fail("backup_pending_jobs","Cierra o cancela los trabajos pendientes antes de crear el respaldo.")
    except sqlite3.Error:_fail("backup_database","No se pudo validar la base SQLite.")


def _nested_package(path):
    try:
        with ZipFile(path) as package:
            entries=package.infolist()
            if len(entries)!=4 or {entry.filename for entry in entries}!={'image.png','mask.png','provenance.json','README.txt'}:
                _fail()
            for entry in entries:
                if entry.flag_bits&1 or stat.S_ISLNK(entry.external_attr>>16) or entry.file_size>8*1024*1024:_fail()
            data=json.loads(package.read('provenance.json'))
            if not isinstance(data,dict):_fail()
            for name in ('image','mask'):
                raw=package.read(name+'.png')
                _check_png(raw)
                if hashlib.sha256(raw).hexdigest()!=data[name+'_sha256']:_fail()
            canonical=json.dumps(data,sort_keys=True,ensure_ascii=False).encode()
            if hashlib.sha256(canonical).hexdigest()!=path.stem:_fail()
            return data
    except (BadZipFile,ValueError,KeyError,TypeError,RuntimeError,OSError):_fail()


def _check_png(raw):
    if not isinstance(raw,bytes) or raw[:8]!=b'\x89PNG\r\n\x1a\n':_fail()
    offset=8;header=False;ended=False;has_pixels=False
    while offset+12<=len(raw):
        size=struct.unpack('>I',raw[offset:offset+4])[0];kind=raw[offset+4:offset+8]
        if size>8*1024*1024 or offset+12+size>len(raw):_fail()
        data=raw[offset+8:offset+8+size];crc=struct.unpack('>I',raw[offset+8+size:offset+12+size])[0]
        if zlib.crc32(kind+data)&0xffffffff!=crc:_fail()
        if not header:
            if kind!=b'IHDR' or size!=13:_fail()
            width,height=struct.unpack('>II',data[:8])
            if not 1<=width<=1280 or not 1<=height<=1280:_fail()
            header=True
        elif kind==b'IHDR':_fail()
        if kind==b'IDAT' and size:has_pixels=True
        if kind==b'IEND':
            if size or offset+12!=len(raw):_fail()
            ended=True;break
        offset+=12+size
    if not header or not ended or not has_pixels:_fail()


def _validate_dispatch(root,paths,capture_ids):
    """Validate durable intent without constructing a coordinator or replaying it."""
    from services.spatial.dispatch import validate_dispatch_record
    from services.spatial.budget import micro_usd
    from workers.spatial_runtime import validate_glb
    if 'dispatch.sqlite3' not in paths:
        if 'modal-calls.sqlite3' in paths:_fail('backup_modal','El diario Modal perdió los trabajos que lo autorizan.')
        return
    with _database(root/'dispatch.sqlite3') as db:
        rows=db.execute('SELECT job_id,identity,state,document FROM dispatch_jobs').fetchall()
    if rows and 'budget.sqlite3' not in paths:_fail("backup_dispatch","Falta el diario de reservas de los trabajos preparados.")
    reservations={}
    if 'budget.sqlite3' in paths:
        with _database(root/'budget.sqlite3') as db:
            reservations={row[0]:{'state':row[1],'reserved':row[2],'actual':row[3]} for row in db.execute('SELECT job_id,state,reserved,actual FROM reservations')}
    for row in rows:
        record=dict(zip(('job_id','identity','state','document'),row));document=validate_dispatch_record(record)
        capture_id=document['capture_id']
        if capture_id not in capture_ids:_fail("backup_dispatch","El trabajo perdió su captura de origen.")
        package_path=f"captures/{capture_id}/review/packages/{document['package_id']}.zip"
        if package_path not in paths or _hash(root/package_path)[0]!=document['package_sha256']:_fail("backup_dispatch","El trabajo perdió su paquete revisado.")
        package=_nested_package(root/package_path)
        for field in ('capture_id','review_revision','frame_id','source_sha256','image_sha256','mask_sha256'):
            if package.get(field)!=document[field]:_fail("backup_dispatch","El paquete no coincide con el trabajo preparado.")
        receipt=reservations.get(record['job_id']);state=record['state']
        if state=='reserving':
            if receipt is not None and receipt['state'] not in {'reserved','released'}:_fail("backup_dispatch","La intención de reserva no coincide con su presupuesto.")
        elif state=='cancelled_before_start':
            if receipt is not None and receipt['state']!='released':_fail("backup_dispatch","Una cancelación previa conserva una reserva iniciada.")
        else:
            if receipt is None:_fail("backup_dispatch","Falta la reserva del trabajo iniciado o preparado.")
            permitted={'reserved':{'reserved'},'starting':{'reserved','started','unknown'},'started':{'started','unknown','settled'},
                'failed_unknown':{'started','unknown'},'cancelled_unknown':{'started','unknown'},
                'completed_test_stub':{'settled'} if document['actual_cost_known'] else {'unknown'},
                'completed_remote':{'settled'} if document['actual_cost_known'] else {'unknown'},
                'failed_known':{'settled'},'cancelled_known':{'settled'}}[state]
            if receipt['state'] not in permitted:_fail("backup_dispatch","El estado del trabajo y su consumo no coinciden.")
            if type(receipt['reserved']) is not int or receipt['reserved']<=0:_fail("backup_dispatch","La reserva no es válida.")
            if document['actual_cost_known'] and receipt['actual']!=micro_usd(document['actual_billed_usd']):_fail("backup_dispatch","El consumo conciliado no coincide.")
        artifact=document['artifact']
        if artifact is not None:
            relative=artifact['relative_path']
            if relative not in paths:_fail("backup_dispatch","Falta un artefacto del transporte de prueba.")
            raw=(root/relative).read_bytes();checked=validate_glb(raw)
            if any(artifact[key]!=value for key,value in checked.items()):_fail("backup_dispatch","El artefacto del transporte cambió.")
    _validate_modal_calls(root,paths,{row[0]:validate_dispatch_record(dict(zip(('job_id','identity','state','document'),row))) for row in rows},reservations)


def _validate_modal_calls(root,paths,documents,reservations):
    """Retain remote call handles without contacting Modal or resubmitting work."""
    if 'modal-calls.sqlite3' not in paths:return
    states={'submitting','started','completed','submission_unknown','result_unknown','cancel_requested',
        'cancelled_before_spawn','observation_timeout','invalid_result'}
    with _database(root/'modal-calls.sqlite3') as db:
        for job_id,digest,call_id,state in db.execute('SELECT job_id,request_sha256,call_id,state FROM modal_calls'):
            document=documents.get(job_id);receipt=reservations.get(job_id)
            if not document or document['transport_kind']!='modal' or not receipt or state not in states:
                _fail('backup_modal','Una llamada Modal perdió su trabajo o presupuesto.')
            if call_id is not None and (not isinstance(call_id,str) or not re.fullmatch(r'fc-[A-Za-z0-9_-]{1,100}',call_id)):
                _fail('backup_modal','Identificador de llamada Modal inválido.')
            if state in {'started','completed','result_unknown','cancel_requested','observation_timeout','invalid_result'} and call_id is None:
                _fail('backup_modal','Una llamada iniciada perdió su identificador remoto.')
            request={key:document[key] for key in ('schema_version','job_id','capture_id','frame_id','image_sha256','mask_sha256','seed','timeout_seconds')}
            request.update(mask_reviewed=True,reserved_usd=receipt['reserved']/1000000)
            expected=hashlib.sha256(json.dumps(request,sort_keys=True,allow_nan=False).encode()).hexdigest()
            if not isinstance(digest,str) or digest!=expected:_fail('backup_modal','La llamada Modal no corresponde a su solicitud autorizada.')


def _validate_room_dispatch(root,paths,capture_ids):
    """Read room intents, exact artifacts and call identities without a worker."""
    from contracts.spatial import CaptureManifest
    from services.spatial.budget import micro_usd
    from services.spatial.room_dispatch import validate_room_dispatch_record,validate_surface,validate_room_glb,completed_room_dispatch
    from workers.spatial_room import canonical
    room_paths={path for path in paths if path.startswith('room-artifacts/')}
    if 'room-dispatch.sqlite3' not in paths:
        if 'room-modal-calls.sqlite3' in paths or room_paths:_fail('backup_room','Los artefactos multivista perdieron su diario de trabajo.')
        return
    with _database(root/'room-dispatch.sqlite3') as db:
        db.row_factory=sqlite3.Row;rows=db.execute('SELECT * FROM room_dispatch_jobs').fetchall()
    if rows and 'budget.sqlite3' not in paths:_fail('backup_room','Falta el presupuesto de los trabajos multivista.')
    reservations={}
    if 'budget.sqlite3' in paths:
        with _database(root/'budget.sqlite3') as db:
            reservations={row[0]:{'state':row[1],'reserved':row[2],'actual':row[3]} for row in db.execute('SELECT job_id,state,reserved,actual FROM reservations')}
    documents={};expected_paths=set()
    for row in rows:
        document=validate_room_dispatch_record(row);documents[row['job_id']]=document
        if document['capture_id'] not in capture_ids:_fail('backup_room','Un trabajo multivista perdió su captura de origen.')
        capture=CaptureManifest.model_validate_json((root/f"captures/{document['capture_id']}/capture.json").read_bytes())
        if capture.source.sha256!=document['source_sha256']:_fail('backup_room','El trabajo multivista cambió su fuente.')
        frames={frame.id:frame for frame in capture.frames}
        for source in document['source_frames']:
            frame=frames.get(source['id'])
            if frame is None or source['source_frame_sha256']!=frame.sha256 or source['at_seconds']!=frame.at_seconds:
                _fail('backup_room','Las vistas revisadas no coinciden con la captura.')
            # The request sent losslessly encoded PNG pixels derived from each
            # retained JPEG. Preserve that second identity as well, without
            # constructing SpatialService or creating a new dispatch.
            from io import BytesIO
            from PIL import Image
            with Image.open(BytesIO((root/'captures'/document['capture_id']/frame.relative_path).read_bytes())) as image:
                output=BytesIO();image.convert('RGB').save(output,format='PNG')
            if hashlib.sha256(output.getvalue()).hexdigest()!=source['image_sha256']:
                _fail('backup_room','Los píxeles revisados no coinciden con la solicitud multivista.')
        receipt=reservations.get(row['job_id']);state=row['state']
        if state=='reserving':
            if receipt is not None and receipt['state'] not in {'reserved','released'}:_fail('backup_room','La reserva inicial multivista no coincide.')
        elif state=='cancelled_before_start':
            if receipt is not None and receipt['state']!='released':_fail('backup_room','Una cancelación previa mantiene consumo iniciado.')
        else:
            if receipt is None or type(receipt['reserved']) is not int or receipt['reserved']<=0:_fail('backup_room','Falta una reserva válida del trabajo multivista.')
            permitted={'reserved':{'reserved'},'starting':{'reserved','started','unknown'},'started':{'started','unknown','settled'},
                'failed_unknown':{'started','unknown'},'cancelled_unknown':{'started','unknown'},
                'completed_test_stub':{'settled'} if document['actual_cost_known'] else {'unknown'},
                'completed_remote':{'settled'} if document['actual_cost_known'] else {'unknown'},
                'failed_known':{'settled'},'cancelled_known':{'settled'}}[state]
            if receipt['state'] not in permitted:_fail('backup_room','El estado multivista no coincide con el consumo.')
            if document['actual_cost_known'] and receipt['actual']!=micro_usd(document['actual_billed_usd']):_fail('backup_room','La conciliación multivista cambió.')
        if document['artifact'] is not None:
            for key in ('artifact','surface_manifest'):
                item=document[key];relative=item['relative_path'];expected_paths.add(relative)
                if relative not in paths or _hash(root/relative)!=(item['sha256'],item['size_bytes']):_fail('backup_room','Un artefacto multivista cambió o falta.')
            surface=json.loads((root/document['surface_manifest']['relative_path']).read_bytes())
            validate_surface(surface,document['source_frames'])
            if surface['parameters']!=document['parameters']:_fail('backup_room','Los parámetros de superficie cambiaron.')
            checked=validate_room_glb((root/document['artifact']['relative_path']).read_bytes(),surface)
            if any(document['artifact'].get(key)!=value for key,value in checked.items()):_fail('backup_room','El GLB multivista no coincide con su registro.')
        if state=='completed_remote':completed_room_dispatch(root,row['job_id'])
    if room_paths!=expected_paths:_fail('backup_room','Hay resultados multivista sin un trabajo que los declare.')
    if 'room-modal-calls.sqlite3' not in paths:return
    states={'submitting','started','completed','submission_unknown','result_unknown','cancel_requested','cancelled_before_spawn','observation_timeout','invalid_result'}
    with _database(root/'room-modal-calls.sqlite3') as db:
        for job_id,request_sha256,call_id,state in db.execute('SELECT job_id,request_sha256,call_id,state FROM modal_calls'):
            document=documents.get(job_id);receipt=reservations.get(job_id)
            if document is None or document['transport_kind']!='modal' or receipt is None or state not in states:_fail('backup_room_modal','Una llamada multivista perdió su trabajo o presupuesto.')
            if call_id is not None and (not isinstance(call_id,str) or not re.fullmatch('fc-[A-Za-z0-9_-]{1,100}',call_id)):_fail('backup_room_modal','La identidad Modal multivista no es válida.')
            if state in {'started','completed','result_unknown','cancel_requested','observation_timeout','invalid_result'} and call_id is None:_fail('backup_room_modal','Falta la identidad remota de una llamada multivista iniciada.')
            request={'schema_version':'0.1.0','job_id':job_id,'capture_id':document['capture_id'],'source_sha256':document['source_sha256'],
                'frames':document['source_frames'],'reviewed':True,'parameters':document['parameters'],'seed':document['seed'],
                'timeout_seconds':document['timeout_seconds'],'reserved_usd':receipt['reserved']/1000000}
            if request_sha256!=hashlib.sha256(canonical(request)).hexdigest():_fail('backup_room_modal','La llamada multivista no corresponde a las vistas y reserva autorizadas.')


def _render_config(path):
    """Bounded inert JSON only; rendering configuration cannot import resources."""
    value=json.loads(path.read_bytes())
    if not isinstance(value,dict):_fail('backup_render','La configuración visual no es un objeto JSON.')
    remaining=4096
    def visit(item,depth=0):
        nonlocal remaining
        remaining-=1
        if remaining<0 or depth>10:_fail('backup_render','La configuración visual excede sus límites.')
        if item is None or type(item) is bool:return
        if type(item) in {int,float}:
            if not math.isfinite(item) or abs(item)>1_000_000:_fail('backup_render','Valor visual fuera de límites.')
        elif isinstance(item,str):
            if (len(item)>240 or any(ord(char)<32 for char in item) or '/' in item or '\\' in item or
                re.match(r'(?i)^(?:[a-z]:|file:|data:|javascript:)',item)):
                _fail('backup_render','La configuración visual contiene una ruta o recurso no permitido.')
        elif isinstance(item,list):
            for child in item:visit(child,depth+1)
        elif isinstance(item,dict):
            for key,child in item.items():
                if (not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_]{0,79}',key) or
                    key.lower() in {'url','uri','path','src','filename','file','href'} or key.lower().endswith(('_url','_uri','_path'))):
                    _fail('backup_render','La configuración visual contiene un campo no permitido.')
                visit(child,depth+1)
        else:_fail('backup_render','La configuración visual contiene un valor no permitido.')
    visit(value)


def _validate_references(root,paths,required):
    # Construction is read-only: unlike SpatialService, this does not create a
    # database, seed, worker, folder or dispatch intent.
    from services.spatial.references import ReferenceManifest,ReferenceSetService
    ids={relative.split('/')[1] for relative in paths if relative.startswith('reference-sets/')}
    if not required.issubset(ids):_fail('backup_references','Una escena perdió sus referencias originales.')
    service=ReferenceSetService(root)
    for set_id in ids:
        prefix=f'reference-sets/{set_id}/';manifest_path=prefix+'references.json'
        if manifest_path not in paths:_fail('backup_references','Falta el manifiesto de imágenes de referencia.')
        document=ReferenceManifest.model_validate_json((root/manifest_path).read_bytes())
        expected={manifest_path}
        for frame in document.frames:
            expected.update({prefix+frame.relative_path,prefix+frame.thumbnail.relative_path})
        if {relative for relative in paths if relative.startswith(prefix)}!=expected:
            _fail('backup_references','El conjunto de referencias está incompleto o contiene imágenes sin declarar.')
        service.get(set_id)  # Validates canonical identity, hashes, sizes and decoded dimensions.


def _validate_tree(root,paths):
    from contracts.spatial import CaptureManifest,SceneManifest,Transform
    def valid_uuid(value):
        if not isinstance(value,str) or str(UUID(value))!=value:_fail()
    def transforms(value,scene):
        expected={obj.id for obj in scene.objects if obj.editable and obj.role!='environment'}
        if not isinstance(value,dict) or set(value)!=expected:_fail()
        for transform in value.values():
            item=Transform.model_validate(transform)
            if any(abs(number)>50 for number in item.position) or any(number<.05 or number>10 for number in item.scale):_fail()
    for name in DATABASES:
        if name in paths:_check_database(root/name,name)
    if 'spatial.sqlite3' not in paths:_fail("backup_database","Falta la base espacial principal.")
    try:
        with _database(root/'spatial.sqlite3') as db:
            scenes={};capture_ids=set();reference_ids=set()
            for scene_id,raw,baseline,revision in db.execute("SELECT id,document,baseline,revision FROM scenes"):
                valid_uuid(scene_id)
                if type(revision) is not int or revision<1:_fail()
                for serialized in (raw,baseline):
                    scene=SceneManifest.model_validate_json(serialized)
                    if str(scene.scene_id)!=scene_id:_fail()
                    if scene.capture_id is not None:capture_ids.add(str(scene.capture_id))
                    if scene.reference_set_id is not None:reference_ids.add(str(scene.reference_set_id))
                    for asset in scene.assets:
                        relative=f'scenes/{scene_id}/{asset.relative_path}'
                        if relative not in paths or _hash(root/relative)[0]!=asset.sha256:_fail()
                scenes[scene_id]=(SceneManifest.model_validate_json(raw),revision)
            spaces=set()
            for space_id,scene_id,capture_id,origin,status in db.execute("SELECT id,scene_id,capture_id,origin,status FROM spaces"):
                valid_uuid(space_id);spaces.add(space_id)
                if scene_id is not None:
                    valid_uuid(scene_id)
                    if scene_id not in scenes:_fail()
                    scene=scenes[scene_id][0]
                    if origin=='generated_demo' and scene.origin!='generated_demo':_fail()
                    if origin=='reference_interpretation' and scene.origin!='reference_interpretation':_fail()
                    if origin=='capture_reconstruction' and scene.origin!='capture_reconstruction':_fail()
                    if origin=='room_reconstruction' and scene.origin!='room_reconstruction':_fail()
                    if scene.capture_id is not None and str(scene.capture_id)!=capture_id:_fail()
                if capture_id is not None:
                    valid_uuid(capture_id);capture_ids.add(capture_id)
                if origin in {'generated_demo','reference_interpretation'} and capture_id is not None:_fail()
                if status=='ready' and scene_id is None or status=='capture_prepared' and capture_id is None:_fail()
            for job_id,space_id in db.execute("SELECT id,space_id FROM jobs"):
                valid_uuid(job_id)
                if space_id not in spaces:_fail()
            for kind,result_id in db.execute("SELECT kind,result_id FROM cache"):
                valid_uuid(result_id)
                if kind=='demo':
                    if result_id not in scenes or scenes[result_id][0].origin!='generated_demo':_fail()
                elif kind=='capture':
                    if result_id not in capture_ids:_fail()
                else:_fail()
            for capture_id in capture_ids:
                valid_uuid(capture_id)
                relative=f'captures/{capture_id}/capture.json'
                if relative not in paths:_fail()
                manifest=CaptureManifest.model_validate_json((root/relative).read_bytes())
                if str(manifest.capture_id)!=capture_id:_fail()
                for frame in manifest.frames:
                    item=f'captures/{capture_id}/{frame.relative_path}'
                    if item not in paths or _hash(root/item)[0]!=frame.sha256:_fail()
            tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'scene_history' in tables:
                for scene_id,cursor,raw in db.execute("SELECT scene_id,cursor,states FROM scene_history"):
                    if scene_id not in scenes:_fail()
                    states=json.loads(raw)
                    if not isinstance(states,list) or not 1<=len(states)<=100 or type(cursor) is not int or not 0<=cursor<len(states):_fail()
                    for state in states:
                        if (not isinstance(state,dict) or set(state)!={'label','transforms'} or not isinstance(state['label'],str) or
                            not 1<=len(state['label'])<=240 or any(ord(character)<32 for character in state['label'])):_fail()
                        transforms(state['transforms'],scenes[scene_id][0])
            if 'scene_layouts' in tables:
                counts={}
                for layout_id,scene_id,name,revision,raw in db.execute("SELECT id,scene_id,name,source_revision,transforms FROM scene_layouts"):
                    valid_uuid(layout_id)
                    if scene_id not in scenes or type(revision) is not int or not 1<=revision<=scenes[scene_id][1]:_fail()
                    if not isinstance(name,str) or not 1<=len(name.strip())<=80 or any(ord(character)<32 for character in name):_fail()
                    counts[scene_id]=counts.get(scene_id,0)+1
                    if counts[scene_id]>20:_fail()
                    transforms(json.loads(raw),scenes[scene_id][0])
            if 'scene_plan_settings' in tables:
                from services.spatial.plan_settings import validate_plan_config
                for scene_id,revision,raw in db.execute('SELECT scene_id,revision,document FROM scene_plan_settings'):
                    if scene_id not in scenes or type(revision) is not int or revision<1:_fail('backup_plan','Una configuración de plano perdió su escena o revisión.')
                    validate_plan_config(json.loads(raw))
        if 'presentation.sqlite3' in paths:
            from services.spatial.presentation import validate_presentation_config
            with _database(root/'presentation.sqlite3') as db:
                for scene_id,revision,source_revision,updated,raw in db.execute('SELECT scene_id,revision,source_scene_revision,updated_at,document FROM presentations'):
                    if scene_id not in scenes or type(revision) is not int or revision<1 or type(source_revision) is not int or not 1<=source_revision<=scenes[scene_id][1]:
                        _fail('backup_presentation','Un recorrido perdió su escena o revisión de origen.')
                    moment=datetime.fromisoformat(updated)
                    if moment.tzinfo is None:_fail('backup_presentation','La fecha del recorrido no incluye zona horaria.')
                    validate_presentation_config(json.loads(raw),object_ids={item.id for item in scenes[scene_id][0].objects})
        if 'reviews.sqlite3' in paths:
            from services.spatial.review import validate_review_document
            with _database(root/'reviews.sqlite3') as db:
                for capture_id,revision,raw in db.execute("SELECT capture_id,revision,document FROM reviews"):
                    document=json.loads(raw)
                    if capture_id not in capture_ids or document['capture_id']!=capture_id or document['revision']!=revision:_fail()
                    source=CaptureManifest.model_validate_json((root/f'captures/{capture_id}/capture.json').read_bytes())
                    validate_review_document(source,document,revision)
                    if document['source_sha256']!=source.source.sha256:_fail()
                    frames={frame.id:frame for frame in source.frames}
                    for item in document['objects']:
                        frame=frames[item['frame_id']]
                        mask=f"captures/{capture_id}/review/masks/{item['mask_sha256']}.png"
                        if item['frame_sha256']!=frame.sha256 or mask not in paths or _hash(root/mask)[0]!=item['mask_sha256']:_fail()
        for relative in paths:
            if '/review/packages/' in relative:_nested_package(root/relative)
            elif '/review/masks/' in relative:_check_png((root/relative).read_bytes())
            elif relative.endswith('/render.json'):
                if relative.split('/')[1] not in scenes:_fail('backup_render','La configuración visual perdió su escena.')
                _render_config(root/relative)
        for scene_id,(scene,revision) in scenes.items():
            if scene.origin=='reference_interpretation' and f'scenes/{scene_id}/render.json' not in paths:
                _fail('backup_render','La interpretación perdió su configuración visual.')
        _validate_references(root,paths,reference_ids)
        _validate_dispatch(root,paths,capture_ids)
        _validate_room_dispatch(root,paths,capture_ids)
        _validate_scene_imports(root,paths)
        _validate_room_scene_imports(root,paths)
    except (ValueError,TypeError,KeyError,OSError,sqlite3.Error):_fail()


def _validate_scene_imports(root,paths):
    """Import lineage survives offline restore without replaying a provider."""
    from contracts.spatial import CaptureManifest,SceneManifest
    from services.spatial.ingest import completed_dispatch,validate_import_link
    with _database(root/'spatial.sqlite3') as db:
        db.row_factory=sqlite3.Row
        expected={row['id'] for row in db.execute('SELECT id,document FROM scenes')
            if SceneManifest.model_validate_json(row['document']).origin=='capture_reconstruction'}
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scene_imports'").fetchone():
            if expected:_fail('backup_import','La escena importada perdió su procedencia de ejecución.')
            return
        if {row['scene_id'] for row in db.execute('SELECT scene_id FROM scene_imports')}!=expected:
            _fail('backup_import','La escena importada perdió su procedencia de ejecución.')
        for row in db.execute('SELECT * FROM scene_imports'):
            if not {'dispatch.sqlite3','modal-calls.sqlite3','budget.sqlite3'}<=paths:
                _fail('backup_import','La escena importada perdió sus diarios de ejecución.')
            dispatch=completed_dispatch(root,row['job_id'])
            scene=db.execute('SELECT document,baseline FROM scenes WHERE id=?',(row['scene_id'],)).fetchone()
            space=db.execute('SELECT origin,scene_id,capture_id FROM spaces WHERE id=?',(row['scene_id'],)).fetchone()
            if scene is None or space is None or space['origin']!='capture_reconstruction' or space['scene_id']!=row['scene_id'] or space['capture_id']!=dispatch['capture_id']:
                _fail('backup_import','La importación perdió su escena o captura.')
            for raw in (scene['document'],scene['baseline']):validate_import_link(row,SceneManifest.model_validate_json(raw),dispatch)
            manifest=CaptureManifest.model_validate_json((root/'captures'/dispatch['capture_id']/'capture.json').read_bytes())
            package=_nested_package(root/'captures'/dispatch['capture_id']/'review/packages'/(dispatch['package_id']+'.zip'))
            frame=next((frame for frame in manifest.frames if frame.id==dispatch['frame_id']),None)
            if frame is None or frame.sha256!=package.get('frame_sha256') or manifest.source.sha256!=row['source_sha256']:
                _fail('backup_import','La escena importada no corresponde al fotograma original.')


def _validate_room_scene_imports(root,paths):
    """Retain exact multiview lineage, without submitting or resuming work."""
    from contracts.spatial import SceneManifest
    from services.spatial.room_dispatch import completed_room_dispatch
    from services.spatial.room_ingest import validate_room_link,verified_result_files
    with _database(root/'spatial.sqlite3') as db:
        db.row_factory=sqlite3.Row
        scenes={row['id']:dict(row) for row in db.execute('SELECT id,document,baseline FROM scenes')}
        expected={scene_id for scene_id,row in scenes.items()
            if any(SceneManifest.model_validate_json(row[key]).origin=='room_reconstruction' for key in ('document','baseline'))}
        exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='room_scene_imports'").fetchone()
        if not exists:
            if expected:_fail('backup_room_import','La superficie importada perdió su procedencia multivista.')
            return
        rows=db.execute('SELECT * FROM room_scene_imports').fetchall()
        if {row['scene_id'] for row in rows}!=expected:
            _fail('backup_room_import','Las superficies importadas no coinciden con sus vínculos de procedencia.')
        for row in rows:
            if not {'room-dispatch.sqlite3','room-modal-calls.sqlite3','budget.sqlite3'}<=paths:
                _fail('backup_room_import','La superficie importada perdió sus diarios multivista.')
            dispatch=completed_room_dispatch(root,row['job_id'])
            raw,surface=verified_result_files(root,dispatch)
            scene=scenes[row['scene_id']]
            space=db.execute('SELECT origin,scene_id,capture_id FROM spaces WHERE id=?',(row['scene_id'],)).fetchone()
            if space is None or space['origin']!='room_reconstruction' or space['scene_id']!=row['scene_id'] or space['capture_id']!=dispatch['capture_id']:
                _fail('backup_room_import','La superficie importada perdió su espacio o captura.')
            for key in ('document','baseline'):
                validate_room_link(row,SceneManifest.model_validate_json(scene[key]),dispatch,surface)
            relative=f"scenes/{row['scene_id']}/assets/room-surface.glb"
            if relative not in paths or (root/relative).read_bytes()!=raw:
                _fail('backup_room_import','La malla de la escena no coincide con su resultado multivista.')


def _manifest(entries):
    references=any(item['path'].startswith('reference-sets/') and '/originals/' in item['path'] for item in entries)
    return {"format":FORMAT,"created_at":datetime.now(timezone.utc).isoformat(),"files":entries,
        "total_size_bytes":sum(item['size_bytes'] for item in entries),"original_media_included":references,
        "original_reference_images_included":references,
        "excluded":["uploads","original_audio_video","credentials","activity_ledger","derived_capture_bundle_zip"],
        "limitations":["Private original reference photos, derived media and spatial text are included when present.","Offline assertion and port check do not lock unrelated processes.","Restore does not start services, cloud work or models."]}


def _summary(manifest):
    references=any(item['path'].startswith('reference-sets/') and '/originals/' in item['path'] for item in manifest['files'])
    return {"format":FORMAT,"files":len(manifest['files']),"total_size_bytes":manifest['total_size_bytes'],
        "original_media_included":references,"original_reference_images_included":references,
        "external_calls":0,"gpu_seconds":0,"service_started":False}


def _publish_directory(staging,destination):
    """Atomically rename without replacing a destination created by another process."""
    if os.name=='nt':
        staging.rename(destination);return
    import ctypes
    native=ctypes.CDLL(None,use_errno=True)
    source=os.fsencode(staging);target=os.fsencode(destination)
    if sys.platform.startswith('linux') and hasattr(native,'renameat2'):
        method=native.renameat2;method.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
        result=method(-100,source,-100,target,1)  # RENAME_NOREPLACE
    elif sys.platform=='darwin' and hasattr(native,'renamex_np'):
        method=native.renamex_np;method.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_uint]
        result=method(source,target,4)  # RENAME_EXCL
    else:_fail("backup_publish","El sistema no ofrece publicación atómica exclusiva para esta operación.")
    if result:
        import errno
        error=ctypes.get_errno()
        if error==errno.EEXIST:raise FileExistsError(error,'Destination already exists')
        raise OSError(error,'Atomic directory publication failed')


def create_backup(source,destination,*,offline=False):
    _offline(offline);source=_safe_root(source);destination=Path(destination).absolute()
    if destination.resolve()!=destination or not destination.parent.is_dir() or destination.exists() or destination.is_relative_to(source):
        _fail("backup_destination","El ZIP de destino debe ser nuevo y estar fuera de la carpeta espacial.")
    with tempfile.TemporaryDirectory(prefix='.brivany-backup-',dir=destination.parent) as work:
        staging=Path(work);data_root=staging/'data';data_root.mkdir();entries=[];total=0
        candidates=[]
        for name in DATABASES:
            path=source/name
            if path.exists():
                if path.is_symlink() or path.resolve()!=path:_fail("backup_path","No se admiten enlaces o redirecciones.")
                if path.stat().st_size>MAX_DATABASE:_fail("backup_database","La base espacial excede el límite.")
                target=data_root/name
                try:
                    with _database(path) as reader:
                        page_size=reader.execute('PRAGMA page_size').fetchone()[0]
                        def bounded_snapshot(status,remaining,pages):
                            if pages*page_size>MAX_DATABASE:_fail("backup_database","La instantánea SQLite excede el límite.")
                        with closing(sqlite3.connect(target)) as writer:reader.backup(writer,pages=128,progress=bounded_snapshot)
                except sqlite3.Error:_fail("backup_database","No se pudo crear la instantánea SQLite.")
                candidates.append((name,target))
                total+=target.stat().st_size
        for category in ('scenes','captures','dispatch-artifacts','room-artifacts','reference-sets'):
            directory=source/category
            if not directory.exists():continue
            if directory.is_symlink() or directory.resolve()!=directory:_fail("backup_path","No se admiten enlaces o redirecciones.")
            for parent,dirs,files in os.walk(directory,followlinks=False):
                for child in dirs:
                    path=Path(parent)/child
                    if path.is_symlink() or path.resolve()!=path.absolute():_fail("backup_path","No se admiten enlaces o redirecciones.")
                for name in files:
                    path=Path(parent)/name;relative=path.relative_to(source).as_posix()
                    if not _allowed(relative):continue
                    if path.is_symlink() or path.resolve()!=path.absolute():_fail("backup_path","No se admiten enlaces o redirecciones.")
                    if len(candidates)>=MAX_FILES:_fail("backup_limit","El respaldo excede el límite de archivos.")
                    if path.stat().st_size>_limit(relative):_fail("backup_limit","Un artefacto excede su límite.")
                    target=data_root/relative;target.parent.mkdir(parents=True,exist_ok=True)
                    before=path.stat();digest=hashlib.sha256();size=0
                    with path.open('rb') as reader,target.open('xb') as writer:
                        for chunk in iter(lambda:reader.read(1024*1024),b''):
                            size+=len(chunk)
                            if size>_limit(relative) or total+size>MAX_TOTAL:_fail("backup_limit","El respaldo excede el límite.")
                            digest.update(chunk);writer.write(chunk)
                    after=path.stat()
                    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):_fail("backup_changed","El almacenamiento cambió durante la copia.")
                    candidates.append((relative,target));total+=size
        for relative,path in sorted(candidates):
            digest,size=_hash(path);entries.append({'path':relative,'sha256':digest,'size_bytes':size})
        if len(entries)>MAX_FILES or sum(item['size_bytes'] for item in entries)>MAX_TOTAL:_fail("backup_limit","El respaldo excede el límite.")
        _validate_tree(data_root,{item['path'] for item in entries})
        manifest=_manifest(entries);archive=staging/'backup.zip'
        with ZipFile(archive,'x',compression=ZIP_DEFLATED,compresslevel=6,allowZip64=True) as package:
            package.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
            for item in entries:package.write(data_root/item['path'],'data/'+item['path'])
        _offline(offline)
        # Hard-link publication cannot replace an existing destination, including
        # one created during the snapshot; no delete/move of user data occurs.
        try:os.link(archive,destination)
        except FileExistsError:_fail("backup_destination","El destino ya existe; no se reemplazará.")
        except OSError:_fail("backup_publish","No se pudo publicar el ZIP de forma exclusiva en este disco.")
    return {"status":"created","destination":str(destination),"archive_sha256":_hash(destination)[0],**_summary(manifest)}


def _read_archive(archive,staging):
    archive=Path(archive).absolute()
    if not archive.is_file() or archive.resolve()!=archive or archive.stat().st_size>MAX_TOTAL+MAX_MANIFEST+MAX_FILES*512:_fail()
    try:
        with ZipFile(archive) as package:
            infos=package.infolist()
            if len(infos)>MAX_FILES+1 or len({item.filename for item in infos})!=len(infos):_fail()
            mapping={item.filename:item for item in infos}
            if 'manifest.json' not in mapping or mapping['manifest.json'].file_size>MAX_MANIFEST:_fail()
            for item in infos:
                mode=item.external_attr>>16
                if not _safe_name(item.filename) or item.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in {0,stat.S_IFREG}) or item.flag_bits&1:_fail()
            manifest=json.loads(package.read('manifest.json'))
            if not isinstance(manifest,dict) or manifest.get('format')!=FORMAT or not isinstance(manifest.get('files'),list):_fail()
            entries=manifest['files']
            if not 1<=len(entries)<=MAX_FILES:_fail()
            paths=set();total=0
            for entry in entries:
                if not isinstance(entry,dict) or set(entry)!={'path','size_bytes','sha256'}:_fail()
                relative=entry['path'];size=entry['size_bytes'];digest=entry['sha256']
                if not _allowed(relative) or relative in paths or type(size) is not int or not 0<size<=_limit(relative) or not isinstance(digest,str) or not re.fullmatch(SHA_PATTERN,digest):_fail()
                paths.add(relative);total+=size
                if total>MAX_TOTAL:_fail("backup_limit","El respaldo excede el límite.")
                info=mapping.get('data/'+relative)
                if info is None or info.file_size!=size:_fail()
            if (set(mapping)!={'manifest.json',*('data/'+name for name in paths)} or
                type(manifest.get('total_size_bytes')) is not int or manifest['total_size_bytes']!=total):_fail()
            originals=any(relative.startswith('reference-sets/') and '/originals/' in relative for relative in paths)
            if (manifest.get('original_media_included') is not originals or
                'original_reference_images_included' in manifest and manifest['original_reference_images_included'] is not originals):
                _fail('backup_references','La declaración de fotos originales no coincide con el contenido.')
            for entry in entries:
                target=staging/entry['path'];target.parent.mkdir(parents=True,exist_ok=True);digest=hashlib.sha256();count=0
                with package.open('data/'+entry['path']) as reader,target.open('xb') as writer:
                    for chunk in iter(lambda:reader.read(1024*1024),b''):
                        count+=len(chunk)
                        if count>entry['size_bytes']:_fail()
                        digest.update(chunk);writer.write(chunk)
                if count!=entry['size_bytes'] or digest.hexdigest()!=entry['sha256']:_fail("backup_hash","Los bytes del respaldo no coinciden con el manifiesto.")
            _validate_tree(staging,paths)
            return manifest
    except (BadZipFile,json.JSONDecodeError,RuntimeError,NotImplementedError,EOFError):_fail()


def inspect_backup(archive,*,offline=False):
    _offline(offline)
    with tempfile.TemporaryDirectory(prefix='brivany-inspect-') as temporary:
        manifest=_read_archive(archive,Path(temporary))
    return {"status":"verified",**_summary(manifest)}


def restore_backup(archive,destination,*,offline=False):
    _offline(offline);destination=Path(destination).absolute()
    if destination.resolve()!=destination or destination.exists() or not destination.parent.is_dir():
        _fail("backup_destination","La restauración requiere una carpeta de destino nueva.")
    with tempfile.TemporaryDirectory(prefix='.brivany-restore-',dir=destination.parent) as temporary:
        staging=Path(temporary)/'spatial';staging.mkdir()
        manifest=_read_archive(archive,staging)
        _offline(offline)
        if destination.exists():_fail("backup_destination","La carpeta de destino apareció durante la validación.")
        try:_publish_directory(staging,destination)
        except FileExistsError:_fail("backup_destination","El destino ya existe; no se reemplazará.")
        except OSError:_fail("backup_publish","No se pudo publicar la carpeta de forma atómica y exclusiva.")
    return {"status":"restored","destination":str(destination),**_summary(manifest)}
