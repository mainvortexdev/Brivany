"""Transactional scene edit history, named layouts and self-contained export.

Only editable object transforms are versioned; visual assets are never copied
for an edit. These operations do not infer geometry or validate metric scale.
"""
from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import re
from uuid import uuid4
from zipfile import ZipFile, ZIP_DEFLATED

from contracts.spatial import SceneManifest, Transform

HISTORY_LIMIT = 100
LAYOUT_LIMIT = 20
EXPORT_LIMIT = 100 * 1024 * 1024


def _error(code, message, status=422):
    from services.spatial.jobs import SpatialServiceError
    return SpatialServiceError(code, message, status)


def _stamp():
    return datetime.now(timezone.utc).isoformat()


def _state(document):
    return {obj['id']: obj['transform'] for obj in document['objects']
            if obj['editable'] and obj['role'] != 'environment'}


class SceneHistoryMixin:
    @staticmethod
    def _history_schema(db):
        db.executescript('''CREATE TABLE IF NOT EXISTS scene_history(
            scene_id TEXT PRIMARY KEY, cursor INTEGER NOT NULL, states TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS scene_layouts(
            id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, name TEXT NOT NULL,
            created_at TEXT NOT NULL, source_revision INTEGER NOT NULL, transforms TEXT NOT NULL);''')

    def _history_ensure(self, db, row):
        found = db.execute('SELECT * FROM scene_history WHERE scene_id=?', (row['id'],)).fetchone()
        if found:
            return json.loads(found['states']), found['cursor']
        states = [{'label': 'Distribución inicial', 'transforms': _state(json.loads(row['document']))}]
        db.execute('INSERT INTO scene_history VALUES(?,?,?)', (row['id'], 0, json.dumps(states)))
        return states, 0

    def _history_record(self, db, row, document, label):
        states, cursor = self._history_ensure(db, row)
        states = (states[:cursor + 1] + [{'label': label, 'transforms': _state(document)}])[-HISTORY_LIMIT:]
        db.execute('UPDATE scene_history SET cursor=?,states=? WHERE scene_id=?',
                   (len(states)-1, json.dumps(states), row['id']))

    def _history_dto(self, db, row):
        states, cursor = self._history_ensure(db, row)
        return {'can_undo': cursor > 0, 'can_redo': cursor < len(states)-1,
                'undo_steps': cursor, 'redo_steps': len(states)-1-cursor, 'limit': HISTORY_LIMIT,
                'undo_label': states[cursor]['label'] if cursor else None,
                'redo_label': states[cursor+1]['label'] if cursor < len(states)-1 else None}

    @staticmethod
    def _layouts(db, scene_id):
        return [dict(row) for row in db.execute(
            'SELECT id,name,created_at,source_revision FROM scene_layouts WHERE scene_id=? ORDER BY created_at,id', (scene_id,))]

    def _scene_row(self, db, scene_id, expected_revision=None):
        from services.spatial.jobs import identifier
        identifier(scene_id)
        row = db.execute('SELECT * FROM scenes WHERE id=?', (scene_id,)).fetchone()
        if not row:
            raise _error('scene_unavailable', 'Escena no disponible.', 404)
        if expected_revision is not None and (type(expected_revision) is not int or row['revision'] != expected_revision):
            raise _error('scene_conflict', 'La escena cambió. Recarga antes de guardar.', 409)
        return row

    def scene_history(self, scene_id):
        with self.lock, self._connect() as db:
            return self._history_dto(db, self._scene_row(db, scene_id))

    @staticmethod
    def _restore_transforms(document, transforms):
        if not isinstance(transforms, dict) or set(transforms) != set(_state(document)):
            raise _error('layout_invalid', 'La distribución ya no corresponde a los objetos de la escena.', 409)
        for obj in document['objects']:
            if obj['id'] not in transforms:
                continue
            transform = Transform.model_validate(transforms[obj['id']])
            if any(abs(x)>50 for x in transform.position) or any(x<.05 or x>10 for x in transform.scale):
                raise _error('layout_invalid', 'La distribución contiene una transformación fuera de límites.', 409)
            obj['transform'] = transform.model_dump(mode='json')
        return SceneManifest.model_validate_json(json.dumps(document))

    def _history_move(self, scene_id, expected_revision, direction):
        if type(expected_revision) is not int:
            raise _error('scene_conflict', 'Recarga la escena antes de cambiar su historial.', 409)
        with self.lock, self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = self._scene_row(db, scene_id, expected_revision)
            states, cursor = self._history_ensure(db, row)
            target = cursor + direction
            if not 0 <= target < len(states):
                raise _error('history_empty', 'No hay otro cambio en esa dirección.', 409)
            validated = self._restore_transforms(json.loads(row['document']), states[target]['transforms'])
            db.execute('UPDATE scenes SET document=?,revision=revision+1 WHERE id=?', (validated.model_dump_json(), scene_id))
            db.execute('UPDATE scene_history SET cursor=? WHERE scene_id=?', (target, scene_id))
            db.execute('UPDATE spaces SET updated_at=? WHERE scene_id=?', (_stamp(), scene_id))
        return self.scene(scene_id)

    def undo_scene(self, scene_id, expected_revision):
        return self._history_move(scene_id, expected_revision, -1)

    def redo_scene(self, scene_id, expected_revision):
        return self._history_move(scene_id, expected_revision, 1)

    def list_layouts(self, scene_id):
        with self.lock, self._connect() as db:
            self._scene_row(db, scene_id)
            return {'layouts': self._layouts(db, scene_id), 'limit': LAYOUT_LIMIT}

    def save_layout(self, scene_id, payload):
        if not isinstance(payload, dict) or set(payload) != {'name','expected_revision'}:
            raise _error('layout_request', 'Escribe un nombre para guardar la distribución.')
        name = payload['name']
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(ord(c)<32 for c in name):
            raise _error('layout_name', 'Escribe un nombre de hasta 80 caracteres.')
        if type(payload['expected_revision']) is not int:
            raise _error('scene_conflict', 'Recarga antes de guardar la distribución.', 409)
        with self.lock, self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = self._scene_row(db, scene_id, payload['expected_revision'])
            existing = self._layouts(db, scene_id)
            if len(existing) >= LAYOUT_LIMIT:
                raise _error('layout_limit', 'Esta escena ya tiene veinte distribuciones guardadas.', 409)
            if any(item['name'].casefold() == name.strip().casefold() for item in existing):
                raise _error('layout_duplicate', 'Ya existe una distribución con ese nombre.', 409)
            result = {'id': str(uuid4()), 'name': name.strip(), 'created_at': _stamp(), 'source_revision': row['revision']}
            db.execute('INSERT INTO scene_layouts VALUES(?,?,?,?,?,?)',
                (result['id'], scene_id, result['name'], result['created_at'], row['revision'], json.dumps(_state(json.loads(row['document'])))))
            return result

    def apply_layout(self, scene_id, layout_id, expected_revision):
        from services.spatial.jobs import identifier
        identifier(layout_id)
        if type(expected_revision) is not int:
            raise _error('scene_conflict', 'Recarga antes de aplicar la distribución.', 409)
        with self.lock, self._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = self._scene_row(db, scene_id, expected_revision)
            layout = db.execute('SELECT * FROM scene_layouts WHERE scene_id=? AND id=?', (scene_id,layout_id)).fetchone()
            if not layout:
                raise _error('layout_not_found', 'Distribución no disponible.', 404)
            validated = self._restore_transforms(json.loads(row['document']), json.loads(layout['transforms']))
            self._history_record(db, row, validated.model_dump(mode='json'), 'Aplicar '+layout['name'])
            db.execute('UPDATE scenes SET document=?,revision=revision+1 WHERE id=?', (validated.model_dump_json(),scene_id))
            db.execute('UPDATE spaces SET updated_at=? WHERE scene_id=?', (_stamp(), scene_id))
        return self.scene(scene_id)

    def export_scene(self, scene_id):
        with self.lock:
            current = self.scene(scene_id)
            document = current['scene']
            entries = {}
            total = 0
            for asset in document['assets']:
                relative = asset['relative_path']
                if not re.fullmatch(r'assets/[a-zA-Z0-9_-]+\.glb', relative):
                    raise _error('export_path', 'El artefacto no tiene una ruta exportable.', 409)
                path = self._owned('scenes', scene_id, *relative.split('/'))
                if path.stat().st_size > EXPORT_LIMIT-total:
                    raise _error('export_limit', 'La escena supera el límite de exportación de 100 MiB.', 413)
                raw = path.read_bytes(); total += len(raw)
                if hashlib.sha256(raw).hexdigest() != asset['sha256']:
                    raise _error('asset_integrity', 'Un artefacto cambió; no se exportará.', 409)
                entries[relative] = raw
            if document['origin']=='room_reconstruction':
                from services.spatial.room_ingest import validate_portable_room
                try:
                    path=self.root/'room-artifacts'/(document['reconstruction']['job_id']+'.surface.json')
                    if path.resolve()!=path.absolute() or not path.is_file() or path.stat().st_size>512*1024:raise ValueError()
                    surface=path.read_bytes()
                    validate_portable_room(document,entries[document['assets'][0]['relative_path']],surface)
                except (ValueError,OSError):raise _error('export_room_integrity','Falta el manifiesto multivista íntegro de esta superficie.',409)
                entries['reconstruction/surface.json']=surface
            entries['scene.json'] = json.dumps(document,ensure_ascii=False,indent=2).encode('utf-8')
            entries['export.json'] = json.dumps({'format':'brivany-scene-1','scene_id':scene_id,
                'revision':current['revision'],'origin':document['origin'],'exported_at':_stamp(),
                'files':{name:hashlib.sha256(raw).hexdigest() for name,raw in entries.items()},
                'contains_original_capture':False,'metric_scale_verified':False,'physics_verified':False},indent=2).encode()
            entries['README.txt'] = ('Brivany - escena local\nAbrir scene.json como manifiesto con sus assets GLB.\n'
                'Las transformaciones están en scene.json, no horneadas en cada GLB.\n'
                'Procedencia: '+document['origin']+'\n'
                'No incluye videos, fotogramas, claves ni conversaciones.\n'
                'La escala métrica, fidelidad geométrica y física no están verificadas.\n').encode('utf-8')
            target = BytesIO()
            with ZipFile(target,'w',compression=ZIP_DEFLATED) as package:
                for name, raw in entries.items(): package.writestr(name, raw)
            return target.getvalue(), 'application/zip', 'brivany-scene-'+scene_id+'.zip'
