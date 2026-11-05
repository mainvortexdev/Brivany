"""Authored, private camera tours tied to a scene revision.

Tour points describe views of the current geometry. They do not prove capture
coverage, reconstruction fidelity, scale, or a public sharing capability.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime,timezone
import json
import math
from pathlib import Path
import re
import sqlite3
from uuid import UUID

from contracts.spatial import SceneManifest
from services.spatial.jobs import SpatialServiceError,identifier

DEFAULT={'title':'Recorrido del espacio','points':[]}
MAX_POINTS=12


class PresentationError(ValueError):
    def __init__(self,code,message,status=422):self.code,self.status=code,status;super().__init__(message)


def fail(code='presentation_input',message='Revisa los puntos y las vistas del recorrido.',status=422):raise PresentationError(code,message,status)


def _text(value,maximum,*,empty=False):
    if not isinstance(value,str) or len(value)>maximum or not empty and not value.strip() or any(ord(char)<32 and char not in '\n\t' for char in value):fail()
    # Tour notes are authored text, not links, markup, embedded resources or code.
    if re.search(r'(?:[a-z][a-z0-9+.-]*://|\b(?:https?|ftp|file|data|javascript|mailto|tel):|\bwww\.|[<>])',value,re.I):fail('presentation_text','Usa texto simple sin enlaces ni etiquetas en el recorrido.')
    return value.strip()


def validate_camera(value):
    if not isinstance(value,dict) or set(value)!={'position','target','fov'}:fail('presentation_camera','La vista debe contener posición, centro y campo de visión.')
    result={}
    for name in ('position','target'):
        vector=value[name]
        if not isinstance(vector,list) or len(vector)!=3 or any(type(item) not in (int,float) or not math.isfinite(item) or abs(item)>100000 for item in vector):fail('presentation_camera','La posición y el centro deben ser finitos y estar dentro del visor.')
        result[name]=[float(item) for item in vector]
    distance=math.dist(result['position'],result['target'])
    if not .01<=distance<=200000:fail('presentation_camera','Aleja la cámara de su centro de mirada.')
    fov=value['fov']
    if type(fov) not in (int,float) or not math.isfinite(fov) or not 15<=fov<=100:fail('presentation_camera','Usa un campo de visión entre 15 y 100 grados.')
    result['fov']=float(fov);return result


def validate_presentation_config(value,*,object_ids=None):
    if not isinstance(value,dict) or set(value)!={'title','points'} or not isinstance(value['points'],list) or len(value['points'])>MAX_POINTS:fail()
    result={'title':_text(value['title'],120),'points':[]};seen=set()
    for point in value['points']:
        if not isinstance(point,dict) or set(point)!={'id','label','note','camera','object_id'}:fail()
        key=point['id']
        try:
            if not isinstance(key,str) or str(UUID(key))!=key or key in seen:raise ValueError()
        except (ValueError,TypeError,AttributeError):fail('presentation_point','Cada punto necesita un identificador único.')
        seen.add(key);object_id=point['object_id']
        if object_id is not None and (not isinstance(object_id,str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,79}',object_id)):fail('presentation_object','La referencia al objeto no es válida.')
        if object_ids is not None and object_id is not None and object_id not in object_ids:fail('presentation_object','Uno de los puntos hace referencia a un objeto que ya no está en la escena.',409)
        result['points'].append({'id':key,'label':_text(point['label'],120),'note':_text(point['note'],1000,empty=True),
            'camera':validate_camera(point['camera']),'object_id':object_id})
    if len(json.dumps(result,ensure_ascii=False,allow_nan=False).encode())>24000:fail('presentation_limit','El recorrido supera el límite de texto.')
    return result


class PresentationService:
    def __init__(self,spatial):
        self.spatial=spatial;self.database=Path(spatial.root)/'presentation.sqlite3'
        if self.database.resolve()!=self.database.absolute():fail('presentation_storage','El recorrido no puede guardarse en una ubicación redirigida.',503)

    @contextmanager
    def db(self):
        if self.database.resolve()!=self.database.absolute():fail('presentation_storage','El almacén del recorrido fue redirigido.',503)
        connection=sqlite3.connect(self.database,timeout=10,isolation_level=None);connection.row_factory=sqlite3.Row
        try:
            connection.execute('PRAGMA trusted_schema=OFF');connection.execute('BEGIN IMMEDIATE')
            connection.execute('CREATE TABLE IF NOT EXISTS presentations(scene_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,source_scene_revision INTEGER NOT NULL,updated_at TEXT NOT NULL,document TEXT NOT NULL)')
            yield connection;connection.execute('COMMIT')
        except Exception:
            if connection.in_transaction:connection.execute('ROLLBACK')
            raise
        finally:connection.close()

    def _read(self,scene_id):
        if not self.database.exists():return {'revision':0,'source_scene_revision':None,'updated_at':None,'config':deepcopy(DEFAULT)}
        if self.database.resolve()!=self.database.absolute():fail('presentation_storage','El almacén del recorrido fue redirigido.',503)
        db=sqlite3.connect(self.database.as_uri()+'?mode=ro',uri=True,timeout=10);db.row_factory=sqlite3.Row
        try:
            db.execute('PRAGMA trusted_schema=OFF');row=db.execute('SELECT * FROM presentations WHERE scene_id=?',(scene_id,)).fetchone()
        finally:db.close()
        if row is None:return {'revision':0,'source_scene_revision':None,'updated_at':None,'config':deepcopy(DEFAULT)}
        if type(row['revision']) is not int or row['revision']<1 or type(row['source_scene_revision']) is not int or row['source_scene_revision']<1:fail('presentation_storage','El diario de recorridos no coincide con sus revisiones.',503)
        return {'revision':row['revision'],'source_scene_revision':row['source_scene_revision'],'updated_at':row['updated_at'],
            'config':validate_presentation_config(json.loads(row['document']))}

    @staticmethod
    def _dto(scene_id,scene_revision,value):
        return {**value,'scene_id':scene_id,'scene_revision':scene_revision,'persisted':value['revision']>0,
            'needs_scene_review':value['source_scene_revision'] is not None and value['source_scene_revision']!=scene_revision,
            'shared':False,'public_link_implemented':False,'reconstruction_fidelity_verified':False}

    def get(self,scene_id):
        identifier(scene_id)
        with self.spatial.lock,self.spatial._connect() as db:
            db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT revision FROM scenes WHERE id=?',(scene_id,)).fetchone()
            if row is None:raise SpatialServiceError('scene_unavailable','La escena del recorrido no está disponible.',404)
            value=self._read(scene_id)
        return self._dto(scene_id,row['revision'],value)

    def save(self,scene_id,payload):
        identifier(scene_id)
        if not isinstance(payload,dict) or set(payload)!={'expected_revision','expected_scene_revision','config'} or any(type(payload[name]) is not int or payload[name]<0 for name in ('expected_revision','expected_scene_revision')):fail()
        # Lock geometry while claiming the independent tour revision. All writers
        # take the geometry DB first, preventing a stale scene from being bound.
        with self.spatial.lock,self.spatial._connect() as scene_db:
            scene_db.execute('BEGIN IMMEDIATE');row=scene_db.execute('SELECT document,revision FROM scenes WHERE id=?',(scene_id,)).fetchone()
            if row is None:raise SpatialServiceError('scene_unavailable','La escena del recorrido no está disponible.',404)
            if row['revision']!=payload['expected_scene_revision']:fail('presentation_scene_conflict','El espacio cambió. Actualiza y revisa las vistas antes de guardar.',409)
            scene=SceneManifest.model_validate_json(row['document']);config=validate_presentation_config(payload['config'],object_ids={item.id for item in scene.objects})
            with self.db() as db:
                old=db.execute('SELECT revision FROM presentations WHERE scene_id=?',(scene_id,)).fetchone()
                if (old['revision'] if old else 0)!=payload['expected_revision']:fail('presentation_conflict','El recorrido cambió en otra ventana. Actualiza antes de guardar.',409)
                revision=payload['expected_revision']+1;updated=datetime.now(timezone.utc).isoformat()
                db.execute('INSERT OR REPLACE INTO presentations VALUES(?,?,?,?,?)',(scene_id,revision,row['revision'],updated,json.dumps(config,ensure_ascii=False,allow_nan=False)))
        return self._dto(scene_id,row['revision'],{'revision':revision,'source_scene_revision':row['revision'],'updated_at':updated,'config':config})
