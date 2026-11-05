"""Manual capture review and local single-object input preparation.

A rectangle is a coarse user selection, never a Meta segmentation or evidence
of coverage/geometry. Masks, input PNG and packages remain private on this host.
"""
from contextlib import contextmanager
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import struct
import tempfile
import threading
from uuid import UUID
from zipfile import ZipFile, ZIP_DEFLATED, BadZipFile
import zlib

from contracts.spatial import CaptureManifest, ScaleReference
from services.spatial.capture import CaptureError, _run, jpeg_size


class CaptureReviewError(ValueError):
    def __init__(self, code, message, status=422):
        self.code, self.status = code, status
        super().__init__(message)


def _hash(data): return hashlib.sha256(data).hexdigest()


def _publish(path, raw):
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent,prefix='review-',delete=False) as stream:
            temporary=Path(stream.name);stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        if temporary is not None:temporary.unlink(missing_ok=True)


def _package_info(raw, package_id):
    try:
        with ZipFile(BytesIO(raw)) as package:
            expected={'provenance.json','image.png','mask.png','README.txt'}
            if len(package.infolist())!=4 or set(package.namelist())!=expected:raise ValueError()
            if any(entry.file_size>8*1024*1024 for entry in package.infolist()):raise ValueError()
            if package.getinfo('provenance.json').file_size>16384 or package.getinfo('mask.png').file_size>2*1024*1024:raise ValueError()
            info=json.loads(package.read('provenance.json'))
            if (_hash(json.dumps(info,sort_keys=True,ensure_ascii=False).encode())!=package_id or
                _hash(package.read('image.png'))!=info['image_sha256'] or
                _hash(package.read('mask.png'))!=info['mask_sha256']):raise ValueError()
            return info
    except (BadZipFile,KeyError,ValueError,TypeError,RuntimeError):
        raise CaptureReviewError('review_integrity','El paquete cambió; no se usará.',409) from None


def rectangle_mask(width, height, rectangle):
    """8-bit grayscale PNG with only 0/255 pixels, using standard library."""
    left = math.floor(rectangle['x']*width); top = math.floor(rectangle['y']*height)
    right = min(width, math.ceil((rectangle['x']+rectangle['width'])*width))
    bottom = min(height, math.ceil((rectangle['y']+rectangle['height'])*height))
    if right <= left or bottom <= top:
        raise CaptureReviewError('review_rectangle', 'Marca una región visible del objeto.')
    empty = b'\0'*(width+1)
    filled = b'\0'+b'\0'*left+b'\xff'*(right-left)+b'\0'*(width-right)
    pixels = b''.join(filled if top <= y < bottom else empty for y in range(height))
    def chunk(kind, data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,0,0,0,0))+
            chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b''))


def validate_review_document(manifest, document, revision):
    """Validate persisted/imported review metadata without opening a database."""
    try:
        fields={'capture_id','revision','source_sha256','objects','length_reference','selection_method',
                'metric_scale_verified','segmentation_model_executed'}
        if not isinstance(document,dict) or set(document)!=fields:raise ValueError()
        if (type(revision) is not int or revision<0 or document['revision']!=revision or
            document['capture_id']!=str(manifest.capture_id) or document['source_sha256']!=manifest.source.sha256 or
            document['selection_method']!='manual_rectangle' or document['metric_scale_verified'] is not False or
            document['segmentation_model_executed'] is not False):raise ValueError()
        if not isinstance(document['objects'],list) or len(document['objects'])>3:raise ValueError()
        frames={frame.id:frame for frame in manifest.frames};seen=set()
        for item in document['objects']:
            if not isinstance(item,dict) or set(item)!={'id','label','frame_id','frame_sha256','rectangle','mask_reviewed','mask_sha256','mask_kind','width','height'}:raise ValueError()
            if item['id'] not in {'object-1','object-2','object-3'} or item['id'] in seen:raise ValueError()
            seen.add(item['id']);frame=frames[item['frame_id']]
            if (item['frame_sha256']!=frame.sha256 or item['width']!=frame.width or item['height']!=frame.height or
                item['mask_kind']!='manual_rectangle' or type(item['mask_reviewed']) is not bool or
                not isinstance(item['mask_sha256'],str) or not re.fullmatch('[0-9a-f]{64}',item['mask_sha256']) or
                not isinstance(item['label'],str) or not 1<=len(item['label'].strip())<=160 or any(ord(c)<32 for c in item['label'])):raise ValueError()
            rect=item['rectangle']
            if not isinstance(rect,dict) or set(rect)!={'x','y','width','height'} or any(type(v) not in {int,float} or not math.isfinite(v) for v in rect.values()):raise ValueError()
            x,y,w,h=(rect[key] for key in ('x','y','width','height'))
            if not (0<=x<1 and 0<=y<1 and w>0 and h>0 and x+w<=1+1e-10 and y+h<=1+1e-10):raise ValueError()
        if document['length_reference'] is not None:ScaleReference.model_validate(document['length_reference'])
    except (ValueError,KeyError,TypeError):
        raise CaptureReviewError('review_integrity','La revisión guardada no cumple el formato esperado.',409) from None
    return document


class CaptureReviewService:
    def __init__(self, root):
        self.root = Path(root).absolute()
        if self.root.resolve() != self.root or not self.root.is_dir():
            raise CaptureReviewError('review_storage','Almacenamiento local no disponible.',503)
        self.database = self.root/'reviews.sqlite3'; self.lock = threading.RLock()
        with self._connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS reviews(capture_id TEXT PRIMARY KEY, revision INTEGER, document TEXT)')

    @contextmanager
    def _connect(self):
        db=sqlite3.connect(self.database,timeout=10);db.row_factory=sqlite3.Row
        try:
            with db: yield db
        finally: db.close()

    def _path(self, capture_id, *parts):
        try:
            if not isinstance(capture_id,str) or str(UUID(capture_id)) != capture_id: raise ValueError()
        except ValueError:
            raise CaptureReviewError('capture_not_found','Captura no disponible.',404) from None
        target=self.root/'captures'/capture_id
        target=target.joinpath(*parts)
        if target.resolve()!=target.absolute() or not target.is_relative_to(self.root/'captures'):
            raise CaptureReviewError('review_storage','La ruta de captura no es válida.',409)
        return target

    def _manifest(self, capture_id):
        path=self._path(capture_id,'capture.json')
        if not path.is_file():raise CaptureReviewError('capture_not_found','Captura no disponible.',404)
        if path.stat().st_size>65536:raise CaptureReviewError('review_integrity','El manifiesto excede el límite.',409)
        manifest=CaptureManifest.model_validate_json(path.read_text(encoding='utf-8'))
        if str(manifest.capture_id)!=capture_id:raise CaptureReviewError('review_integrity','La identidad de la captura cambió.',409)
        return manifest

    def _frame(self, capture_id, frame):
        path=self._path(capture_id,*frame.relative_path.split('/'))
        if not path.is_file() or path.stat().st_size>2*1024*1024:
            raise CaptureReviewError('review_integrity','Fotograma no disponible o fuera de límites.',409)
        raw=path.read_bytes()
        if _hash(raw)!=frame.sha256:raise CaptureReviewError('review_integrity','El fotograma cambió; vuelve a preparar la captura.',409)
        try:
            if jpeg_size(raw)!=(frame.width,frame.height):raise CaptureError('dimensions')
        except CaptureError:raise CaptureReviewError('review_integrity','El fotograma no coincide con sus dimensiones.',409) from None
        return raw

    @staticmethod
    def _default(manifest):
        return {'capture_id':str(manifest.capture_id),'revision':0,'source_sha256':manifest.source.sha256,
                'objects':[],'length_reference':None,'selection_method':'manual_rectangle',
                'metric_scale_verified':False,'segmentation_model_executed':False}

    def _read(self, db, manifest):
        row=db.execute('SELECT * FROM reviews WHERE capture_id=?',(str(manifest.capture_id),)).fetchone()
        try:document=json.loads(row['document']) if row else self._default(manifest)
        except ValueError:raise CaptureReviewError('review_integrity','La revisión guardada no es legible.',409) from None
        return validate_review_document(manifest,document,row['revision'] if row else 0)

    def get(self, capture_id):
        with self.lock,self._connect() as db:
            manifest=self._manifest(capture_id);document=self._read(db,manifest)
            frames={frame.id:frame for frame in manifest.frames}
            for item in document['objects']:
                frame=frames.get(item['frame_id'])
                if frame is None or frame.sha256!=item['frame_sha256']:
                    raise CaptureReviewError('review_integrity','La revisión no coincide con sus fotogramas.',409)
                self._frame(capture_id,frame)
            notes_path=self._path(capture_id,'preflight.json')
            notes=json.loads(notes_path.read_text(encoding='utf-8')) if notes_path.is_file() and notes_path.stat().st_size<131072 else {}
            document['quality']=notes.get('heuristics',{'status':'not_assessed','coverage_assessed':False,'overlap_assessed':False})
            return document

    def save(self, capture_id, payload):
        if not isinstance(payload,dict) or set(payload)!={'expected_revision','objects','length_reference'}:
            raise CaptureReviewError('review_request','Revisa los objetos y la referencia de longitud.')
        if type(payload['expected_revision']) is not int or not isinstance(payload['objects'],list) or len(payload['objects'])>3:
            raise CaptureReviewError('review_request','Selecciona hasta tres objetos para esta captura.')
        with self.lock,self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            manifest=self._manifest(capture_id);current=self._read(db,manifest)
            if current['revision']!=payload['expected_revision']:
                raise CaptureReviewError('review_conflict','La revisión cambió en otra ventana. Vuelve a abrirla.',409)
            frames={frame.id:frame for frame in manifest.frames};seen=set();objects=[];masks={}
            for item in payload['objects']:
                fields={'id','label','frame_id','frame_sha256','rectangle','mask_reviewed'}
                if not isinstance(item,dict) or set(item)!=fields or item.get('id') not in {'object-1','object-2','object-3'} or item['id'] in seen:
                    raise CaptureReviewError('review_object','Los identificadores de objetos no son válidos.')
                label=item['label'];frame=frames.get(item['frame_id'])
                if not isinstance(label,str) or not 1<=len(label.strip())<=160 or any(ord(c)<32 for c in label):
                    raise CaptureReviewError('review_label','Escribe una etiqueta de hasta 160 caracteres.')
                if frame is None or item['frame_sha256']!=frame.sha256:
                    raise CaptureReviewError('review_integrity','El objeto debe referirse al fotograma vigente.',409)
                self._frame(capture_id,frame)
                rect=item['rectangle']
                if not isinstance(rect,dict) or set(rect)!={'x','y','width','height'} or any(type(v) not in {int,float} or not math.isfinite(v) for v in rect.values()):
                    raise CaptureReviewError('review_rectangle','La selección debe ser un rectángulo dentro de la imagen.')
                x,y,w,h=(rect[key] for key in ('x','y','width','height'))
                if not (0<=x<1 and 0<=y<1 and w>0 and h>0 and x+w<=1+1e-10 and y+h<=1+1e-10):
                    raise CaptureReviewError('review_rectangle','La selección debe quedar dentro de la imagen.')
                if type(item['mask_reviewed']) is not bool:
                    raise CaptureReviewError('review_mask','Indica si revisaste la selección.')
                raw=rectangle_mask(frame.width,frame.height,rect);digest=_hash(raw);masks[digest]=raw
                objects.append({**item,'label':label.strip(),'mask_sha256':digest,'mask_kind':'manual_rectangle',
                    'width':frame.width,'height':frame.height})
                seen.add(item['id'])
            reference=payload['length_reference']
            if reference is not None:
                if not isinstance(reference,dict) or set(reference)!={'description','length_m'}:
                    raise CaptureReviewError('review_reference','La referencia requiere descripción y longitud en metros.')
                reference=ScaleReference.model_validate(reference).model_dump(mode='json')
            result={**self._default(manifest),'revision':current['revision']+1,'objects':objects,'length_reference':reference}
            directory=self._path(capture_id,'review','masks');directory.mkdir(parents=True,exist_ok=True)
            for digest,raw in masks.items():
                target=self._path(capture_id,'review','masks',digest+'.png')
                if target.exists() and _hash(target.read_bytes())!=digest:raise CaptureReviewError('review_integrity','Una máscara guardada cambió.',409)
                if not target.exists():_publish(target,raw)
            db.execute('INSERT OR REPLACE INTO reviews VALUES(?,?,?)',(capture_id,result['revision'],json.dumps(result,ensure_ascii=False)))
        return self.get(capture_id)

    def mask(self,capture_id,object_id):
        with self.lock:
            review=self.get(capture_id)
            item=next((obj for obj in review['objects'] if obj['id']==object_id),None)
            if item is None:raise CaptureReviewError('review_not_found','Selección no disponible.',404)
            path=self._path(capture_id,'review','masks',item['mask_sha256']+'.png');raw=path.read_bytes()
            if len(raw)>2*1024*1024 or _hash(raw)!=item['mask_sha256']:
                raise CaptureReviewError('review_integrity','La máscara cambió; no se usará.',409)
            return raw,'image/png',object_id+'.png'

    def prepare(self,capture_id,payload):
        if not isinstance(payload,dict) or set(payload)!={'expected_revision','object_id'}:
            raise CaptureReviewError('review_request','Elige un objeto revisado para preparar.')
        with self.lock:
            review=self.get(capture_id)
            if type(payload['expected_revision']) is not int or payload['expected_revision']!=review['revision']:
                raise CaptureReviewError('review_conflict','La revisión cambió. Vuelve a abrirla.',409)
            item=next((obj for obj in review['objects'] if obj['id']==payload['object_id']),None)
            if item is None or item['mask_reviewed'] is not True:
                raise CaptureReviewError('review_required','Guarda y revisa la selección antes de preparar el objeto.',409)
            manifest=self._manifest(capture_id);frame=next(frame for frame in manifest.frames if frame.id==item['frame_id'])
            jpeg=self._frame(capture_id,frame);mask=self.mask(capture_id,item['id'])[0]
            executable=shutil.which('ffmpeg')
            if not executable:raise CaptureReviewError('review_ffmpeg','Falta FFmpeg para convertir el fotograma.',503)
            with tempfile.TemporaryDirectory(prefix='brivany-object-') as directory:
                source=Path(directory)/'frame.jpg';target=Path(directory)/'image.png';source.write_bytes(jpeg)
                try:
                    _run([executable,'-hide_banner','-loglevel','error','-nostdin','-threads','2','-protocol_whitelist','file,pipe',
                          '-i',str(source),'-frames:v','1','-an','-threads','2',str(target)])
                except CaptureError:raise CaptureReviewError('review_decode','No se pudo convertir el fotograma.',422) from None
                if not target.is_file() or target.stat().st_size>8*1024*1024:raise CaptureReviewError('review_decode','La imagen excede el límite.',422)
                image=target.read_bytes()
                if image[:8]!=b'\x89PNG\r\n\x1a\n' or len(image)<24 or struct.unpack('>II',image[16:24])!=(frame.width,frame.height):
                    raise CaptureReviewError('review_decode','La imagen convertida no coincide con la máscara.',409)
            provenance={'schema_version':'0.1.0','capture_id':capture_id,'source_sha256':manifest.source.sha256,
                'frame_id':frame.id,'frame_sha256':frame.sha256,'review_revision':review['revision'],'object_id':item['id'],
                'label':item['label'],'rectangle':item['rectangle'],'mask_reviewed':True,'mask_kind':'manual_rectangle',
                'length_reference':review['length_reference'],'metric_scale_verified':False,
                'image_sha256':_hash(image),'mask_sha256':_hash(mask),'status':'prepared_not_executed',
                'pending':['model_checkpoints_and_licenses','validated_cuda_image','approved_budget','remote_dispatch'],
                'model_executed':False,'external_calls':0,'gpu_seconds':0}
            canonical=json.dumps(provenance,sort_keys=True,ensure_ascii=False).encode();package_id=_hash(canonical)
            archive=self._path(capture_id,'review','packages',package_id+'.zip');archive.parent.mkdir(parents=True,exist_ok=True)
            output=BytesIO()
            with ZipFile(output,'w',compression=ZIP_DEFLATED) as package:
                package.writestr('image.png',image);package.writestr('mask.png',mask);package.writestr('provenance.json',canonical)
                package.writestr('README.txt','Entrada local de UN objeto. Máscara rectangular manual, no segmentación de Meta.\n'
                    'No es una solicitud lista para ejecutar: faltan pesos, entorno validado, reserva y autorización de dispatch.\n'
                    'La referencia de longitud es declarada, sin escala geométrica verificada.\n')
            raw=output.getvalue()
            if archive.exists():
                if archive.stat().st_size>12*1024*1024:raise CaptureReviewError('review_integrity','El paquete supera el límite.',409)
                _package_info(archive.read_bytes(),package_id)
            else:_publish(archive,raw)
            return {**provenance,'package_id':package_id,'size_bytes':archive.stat().st_size,'package_sha256':_hash(archive.read_bytes())}

    def package(self,capture_id,package_id):
        if not isinstance(package_id,str) or not re.fullmatch('[0-9a-f]{64}',package_id):raise CaptureReviewError('review_not_found','Paquete no disponible.',404)
        path=self._path(capture_id,'review','packages',package_id+'.zip')
        if not path.is_file() or path.stat().st_size>12*1024*1024:raise CaptureReviewError('review_not_found','Paquete no disponible.',404)
        raw=path.read_bytes()
        info=_package_info(raw,package_id)
        return raw,'application/zip','brivany-object-'+info['object_id']+'.zip'
