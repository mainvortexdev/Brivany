"""Portable local spatial projects. No native wrapper, execution or cloud transfer.

A project is a verified directory, with immutable revision documents and an
atomically replaced manifest. Reference originals require an explicit option;
video, credentials, conversations and provider payloads are never copied.
"""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import sqlite3
import threading
from functools import wraps
from uuid import UUID, uuid4
from zipfile import ZipFile, ZIP_DEFLATED

from contracts.spatial import SceneManifest, Transform


FORMAT = 'brivany-project-1'
MAX_TOTAL = 256 * 1024 * 1024
MAX_FILES = 256
MAX_JSON = 2 * 1024 * 1024
MAX_VERSIONS = 100


class ProjectError(ValueError):
    def __init__(self, code, message, status=422):
        self.code, self.status = code, status
        super().__init__(message)


def _fail(code='project_invalid', message='El proyecto local no es válido o está incompleto.', status=422):
    raise ProjectError(code, message, status)


def _checked(function):
    @wraps(function)
    def call(*args, **kwargs):
        try: return function(*args, **kwargs)
        except ProjectError: raise
        except (ValueError, TypeError, KeyError, OSError, sqlite3.Error): _fail()
    return call


class SpatialProjectSource:
    """Read-only CLI snapshot source: never seed, recover jobs or start workers."""
    def __init__(self, root):
        self.root = _root(root)
        self.lock = threading.RLock()
        path = self.root / 'spatial.sqlite3'
        if path.resolve() != path or not path.is_file(): _fail('project_source', 'Falta una instalación espacial existente.')

    @contextmanager
    def _connect(self):
        path = self.root / 'spatial.sqlite3'
        db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA trusted_schema=OFF')
            yield db
        finally: db.close()


def _stamp(): return datetime.now(timezone.utc).isoformat()
def _hash(raw): return hashlib.sha256(raw).hexdigest()
def _json(value): return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def _uuid(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value: _fail()
    except (ValueError, TypeError, AttributeError): _fail()
    return value


def _title(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 120 or any(ord(c) < 32 for c in value): _fail()
    return value.strip()


def _root(value, *, exists=True):
    path = Path(value).absolute()
    if path.resolve() != path or exists and not path.is_dir(): _fail('project_path', 'Elige una carpeta local sin redirecciones.')
    return path


def _allowed(relative):
    if not isinstance(relative, str) or '\\' in relative or ':' in relative or PurePosixPath(relative).is_absolute(): return False
    if any(part in {'', '.', '..'} for part in relative.split('/')): return False
    return any(re.fullmatch(pattern, relative) for pattern in (
        r'assets/[a-z][a-z0-9_-]{0,79}\.(glb|ply)', r'render\.json', r'versions/revision-[0-9]{6}\.json',
        r'reconstruction/surface\.json',
        r'references/(references|source-manifest)\.json', r'references/derived/frame-00(?:0[0-9]|1[01])\.jpg',
        r'references/originals/frame-00(?:0[0-9]|1[01])\.(jpg|png)', r'floorplan/[a-z][a-z0-9_-]{0,79}\.(json|png|jpg|svg)',
    ))


def _limit(relative):
    if relative == 'reconstruction/surface.json': return 512 * 1024
    if relative.endswith(('/references.json', '/source-manifest.json')): return 128 * 1024
    if relative == 'render.json': return 64 * 1024
    if relative.startswith('references/originals/'): return 8 * 1024 * 1024
    if relative.endswith(('.jpg', '.png')): return 2 * 1024 * 1024
    if relative.endswith('.json'): return MAX_JSON
    return 32 * 1024 * 1024


def _read(root, relative, limit):
    path = root / relative
    if path.resolve() != path.absolute() or not path.is_relative_to(root) or not path.is_file(): _fail('project_path')
    before = path.stat()
    if not 0 < before.st_size <= limit: _fail('project_limit', 'Un archivo del proyecto excede sus límites.')
    with path.open('rb') as stream: raw = stream.read(limit + 1)
    after = path.stat()
    if len(raw) != before.st_size or len(raw) > limit or (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino) or path.resolve() != path.absolute(): _fail('project_changed', 'Un archivo cambió durante la lectura.', 409)
    return raw


def _transforms(value, scene):
    expected = {item.id for item in scene.objects if item.editable and item.role != 'environment'}
    if not isinstance(value, dict) or set(value) != expected: _fail()
    for transform in value.values():
        parsed = Transform.model_validate(transform)
        if any(abs(number) > 50 for number in parsed.position) or any(number < .05 or number > 10 for number in parsed.scale): _fail()


def _version(value):
    required = {'revision', 'scene_revision', 'title', 'scene', 'history', 'layouts', 'source_jobs', 'saved_at'}
    if not isinstance(value, dict) or not required<=set(value) or set(value)-required-{'plan_config','presentation_config','presentation_source_scene_revision'} or type(value['revision']) is not int or value['revision'] < 1 or type(value['scene_revision']) is not int or value['scene_revision'] < 1: _fail()
    if 'plan_config' in value:
        from services.spatial.plan_settings import validate_plan_config
        validate_plan_config(value['plan_config'])
    _title(value['title'])
    scene = SceneManifest.model_validate_json(_json(value['scene']))
    if 'presentation_config' in value:
        from services.spatial.presentation import validate_presentation_config
        validate_presentation_config(value['presentation_config'],object_ids={item.id for item in scene.objects})
    if 'presentation_source_scene_revision' in value:
        source=value['presentation_source_scene_revision']
        if 'presentation_config' not in value or source is not None and (type(source) is not int or not 1<=source<=value['scene_revision']):_fail()
        if source is None and value['presentation_config']['points']:_fail()
    if scene.title != value['title']: _fail()
    history = value['history']
    if not isinstance(history, dict) or set(history) != {'cursor', 'states'} or not isinstance(history['states'], list) or not 1 <= len(history['states']) <= 100 or type(history['cursor']) is not int or not 0 <= history['cursor'] < len(history['states']): _fail()
    for state in history['states']:
        if not isinstance(state, dict) or set(state) != {'label', 'transforms'}: _fail()
        if not isinstance(state['label'], str) or not 1 <= len(state['label']) <= 240: _fail()
        _transforms(state['transforms'], scene)
    current_transforms = {obj.id: obj.transform.model_dump(mode='json') for obj in scene.objects if obj.editable and obj.role != 'environment'}
    if history['states'][history['cursor']]['transforms'] != current_transforms: _fail()
    if not isinstance(value['layouts'], list) or len(value['layouts']) > 20: _fail()
    layout_ids = set()
    for layout in value['layouts']:
        if not isinstance(layout, dict) or set(layout) != {'id', 'name', 'created_at', 'source_revision', 'transforms'}: _fail()
        _uuid(layout['id']); _title(layout['name']); _transforms(layout['transforms'], scene)
        if layout['id'] in layout_ids or type(layout['source_revision']) is not int or not 1 <= layout['source_revision'] <= value['scene_revision']: _fail()
        layout_ids.add(layout['id'])
    if not isinstance(value['source_jobs'], list) or len(value['source_jobs']) > 1000: _fail()
    for job in value['source_jobs']:
        if not isinstance(job, dict) or set(job) != {'id', 'kind', 'state', 'progress', 'stage', 'error_code', 'created_at', 'updated_at'}: _fail()
        _uuid(job['id'])
    return scene


def _load(path):
    root = _root(path)
    try:
        manifest = json.loads(_read(root, 'manifest.json', MAX_JSON))
        fields = {'format', 'project_id', 'title', 'created_at', 'updated_at', 'revision', 'source_scene_id', 'origin', 'units', 'flags', 'files', 'versions'}
        if not isinstance(manifest, dict) or set(manifest) != fields or manifest['format'] != FORMAT: _fail()
        _uuid(manifest['project_id']); _uuid(manifest['source_scene_id']); _title(manifest['title'])
        flag_fields = {'reference_metadata_included', 'reference_originals_included', 'original_video_included',
                       'original_video_not_retained_or_not_exported', 'private_project', 'native_application', 'automatic_execution'}
        flags = manifest['flags']
        if (not isinstance(flags, dict) or set(flags) != flag_fields or any(type(value) is not bool for value in flags.values()) or
                flags['original_video_included'] or not flags['original_video_not_retained_or_not_exported'] or
                not flags['private_project'] or flags['native_application'] or flags['automatic_execution'] or
                flags['reference_originals_included'] and not flags['reference_metadata_included']): _fail()
        revision = manifest['revision']
        if type(revision) is not int or not 1 <= revision <= MAX_VERSIONS or not isinstance(manifest['versions'], list) or len(manifest['versions']) != revision: _fail()
        files = manifest['files']
        if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES: _fail()
        payloads, total = {}, 0
        for entry in files:
            if not isinstance(entry, dict) or set(entry) != {'path', 'sha256', 'size_bytes'}: _fail()
            relative = entry['path']
            if not _allowed(relative) or relative in payloads or type(entry['size_bytes']) is not int: _fail()
            raw = _read(root, relative, _limit(relative)); total += len(raw)
            if total > MAX_TOTAL or len(raw) != entry['size_bytes'] or _hash(raw) != entry['sha256']: _fail('project_integrity', 'Los hashes del proyecto no coinciden.', 409)
            payloads[relative] = raw
        versions = []; expected_files = set()
        for index, descriptor in enumerate(manifest['versions'], 1):
            if not isinstance(descriptor, dict) or set(descriptor) != {'revision', 'path', 'sha256', 'saved_at'} or descriptor['revision'] != index or descriptor['path'] != f'versions/revision-{index:06d}.json': _fail()
            raw = payloads[descriptor['path']]
            if _hash(raw) != descriptor['sha256']: _fail()
            document = json.loads(raw); scene = _version(document)
            if document['revision'] != index or str(scene.scene_id) != manifest['source_scene_id'] or scene.origin != manifest['origin'] or scene.units != manifest['units']: _fail()
            for asset in scene.assets:
                if asset.relative_path not in payloads or _hash(payloads[asset.relative_path]) != asset.sha256: _fail()
                expected_files.add(asset.relative_path)
                if asset.kind == 'mesh':
                    from workers.spatial_runtime import validate_glb
                    validate_glb(payloads[asset.relative_path])
            if scene.origin == 'room_reconstruction':
                from services.spatial.room_ingest import validate_portable_room
                sidecar = 'reconstruction/surface.json'
                if sidecar not in payloads: _fail('project_room_surface', 'Falta el manifiesto completo de la superficie multivista.')
                validate_portable_room(scene, payloads[scene.assets[0].relative_path], payloads[sidecar])
                expected_files.add(sidecar)
            expected_files.add(descriptor['path'])
            versions.append(document)
        if versions[-1]['title'] != manifest['title']: _fail()
        if manifest['origin'] != 'room_reconstruction' and (root / 'reconstruction/surface.json').exists():
            _fail('project_room_surface', 'La superficie multivista no corresponde a este proyecto.')
        if 'render.json' in payloads:
            from services.spatial.backup import _render_config
            _render_config(root / 'render.json')
            expected_files.add('render.json')
        elif manifest['origin'] == 'reference_interpretation': _fail('project_render', 'Falta la configuración visual de la interpretación.')
        if 'references/references.json' in payloads:
            if not flags['reference_metadata_included']: _fail()
            expected_files.update(_validate_references(json.loads(payloads['references/references.json']), payloads, versions[-1]['scene'], flags))
        elif manifest['flags']['reference_metadata_included']: _fail()
        if set(payloads) != expected_files: _fail('project_inventory', 'Hay archivos declarados sin relación con el proyecto.')
        return root, manifest, payloads, versions
    except ProjectError: raise
    except (ValueError, TypeError, KeyError, OSError): _fail()


def _validate_references(document, payloads, scene, flags):
    fields = {'format', 'id', 'title', 'origin', 'source_manifest_sha256', 'originals_included', 'frames', 'preflight'}
    if not isinstance(document, dict) or set(document) != fields or document['format'] != 'brivany-project-references-1': _fail()
    _uuid(document['id'])
    if document['id'] != scene.get('reference_set_id') or type(document['originals_included']) is not bool or document['originals_included'] != flags['reference_originals_included']: _fail()
    if not isinstance(document['frames'], list) or not 2 <= len(document['frames']) <= 12: _fail()
    from services.spatial.references import ReferenceManifest, _decode
    source_raw = payloads['references/source-manifest.json']
    if _hash(source_raw) != document['source_manifest_sha256']: _fail()
    source = ReferenceManifest.model_validate_json(source_raw)
    if (source.id != document['id'] or source.title != document['title'] or source.origin != document['origin'] or
            source.preflight != document['preflight'] or len(source.frames) != len(document['frames'])): _fail()
    expected = {'references/references.json', 'references/source-manifest.json'}
    for index, frame in enumerate(document['frames']):
        if frame['id'] != f'frame-{index:04d}' or set(frame) != {'id', 'label', 'source_sha256', 'source_width', 'source_height', 'source_mime_type', 'derived_path', 'derived_sha256', 'original_path'}: _fail()
        if frame['derived_path'] != f'references/derived/{frame["id"]}.jpg' or _hash(payloads[frame['derived_path']]) != frame['derived_sha256']: _fail()
        original_frame = source.frames[index]
        if any(frame[key] != value for key, value in {'label': original_frame.label, 'source_sha256': original_frame.sha256,
                'source_width': original_frame.width, 'source_height': original_frame.height,
                'source_mime_type': original_frame.mime_type, 'derived_sha256': original_frame.thumbnail.sha256}.items()): _fail()
        derived = payloads[frame['derived_path']]
        metadata, _ = _decode(derived)
        if (len(derived) != original_frame.thumbnail.size_bytes or metadata['mime_type'] != 'image/jpeg' or
                metadata['width'] != original_frame.thumbnail.width or metadata['height'] != original_frame.thumbnail.height): _fail()
        expected.add(frame['derived_path'])
        original = frame['original_path']
        if document['originals_included']:
            extension = {'image/png': 'png', 'image/jpeg': 'jpg'}[frame['source_mime_type']]
            if original != f'references/originals/{frame["id"]}.{extension}' or _hash(payloads[original]) != frame['source_sha256']: _fail()
            metadata, _ = _decode(payloads[original])
            if (len(payloads[original]) != original_frame.size_bytes or metadata['width'] != frame['source_width'] or
                    metadata['height'] != frame['source_height'] or metadata['mime_type'] != frame['source_mime_type']): _fail()
            expected.add(original)
        elif original is not None: _fail()
    originals = any(path.startswith('references/originals/') for path in payloads)
    if originals != document['originals_included']: _fail()
    return expected


def open_project(path):
    _, manifest, payloads, versions = _load(path)
    from services.spatial.plan_settings import DEFAULT
    from services.spatial.presentation import DEFAULT as PRESENTATION_DEFAULT
    return {'project': manifest, 'revision': manifest['revision'], **{key: deepcopy(value) for key, value in versions[-1].items() if key != 'revision'},
            'plan_config':deepcopy(versions[-1].get('plan_config',DEFAULT)),
            'presentation_config':deepcopy(versions[-1].get('presentation_config',PRESENTATION_DEFAULT)),
            'presentation_source_scene_revision':versions[-1].get('presentation_source_scene_revision',versions[-1]['scene_revision'] if 'presentation_config' in versions[-1] else None),
            'render_config': json.loads(payloads['render.json']) if 'render.json' in payloads else None,
            'references': json.loads(payloads['references/references.json']) if 'references/references.json' in payloads else None}


def list_versions(path):
    _, manifest, _, _ = _load(path)
    return {'project_id': manifest['project_id'], 'revision': manifest['revision'], 'versions': deepcopy(manifest['versions'])}


def _entry(relative, raw):
    if not _allowed(relative) or not 0 < len(raw) <= _limit(relative): _fail('project_limit')
    return {'path': relative, 'sha256': _hash(raw), 'size_bytes': len(raw)}


def _publish_manifest(root, manifest):
    raw = _json(manifest)
    if len(raw) > MAX_JSON: _fail('project_limit')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=root, prefix='.manifest-', delete=False) as stream:
            temporary = Path(stream.name); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, root / 'manifest.json')
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


@_checked
def create_project(spatial, scene_id, destination, *, include_references=True, include_originals=False):
    if type(include_references) is not bool or type(include_originals) is not bool or include_originals and not include_references: _fail()
    destination = _root(destination, exists=False)
    if destination.exists() or not destination.parent.is_dir(): _fail('project_destination', 'La carpeta de destino debe ser nueva.', 409)
    _uuid(scene_id)
    entries = {}
    with spatial.lock, spatial._connect() as db:
        db.execute('BEGIN')
        row = db.execute('SELECT * FROM scenes WHERE id=?', (scene_id,)).fetchone()
        if row is None: _fail('scene_unavailable', 'Escena no disponible.', 404)
        scene = SceneManifest.model_validate_json(row['document']).model_dump(mode='json')
        history_row = db.execute('SELECT cursor,states FROM scene_history WHERE scene_id=?', (scene_id,)).fetchone()
        state = {obj['id']: obj['transform'] for obj in scene['objects'] if obj['editable'] and obj['role'] != 'environment'}
        history = {'cursor': history_row['cursor'], 'states': json.loads(history_row['states'])} if history_row else {'cursor': 0, 'states': [{'label': 'Distribución inicial', 'transforms': state}]}
        layouts = [{**{key: value[key] for key in ('id', 'name', 'created_at', 'source_revision')}, 'transforms': json.loads(value['transforms'])} for value in db.execute('SELECT * FROM scene_layouts WHERE scene_id=?', (scene_id,))]
        jobs = [dict(value) for value in db.execute('SELECT id,kind,state,progress,stage,error_code,created_at,updated_at FROM jobs WHERE space_id=? ORDER BY created_at,id', (scene_id,))]
        for asset in scene['assets']:
            raw = _read(spatial.root / 'scenes' / scene_id, asset['relative_path'], 32 * 1024 * 1024)
            if _hash(raw) != asset['sha256']: _fail('project_integrity')
            if asset['kind'] == 'mesh':
                from workers.spatial_runtime import validate_glb
                validate_glb(raw)
            entries[asset['relative_path']] = raw
        if scene['origin'] == 'room_reconstruction':
            from services.spatial.room_ingest import validate_portable_room
            surface = _read(spatial.root, f"room-artifacts/{scene['reconstruction']['job_id']}.surface.json", 512 * 1024)
            validate_portable_room(scene, entries[scene['assets'][0]['relative_path']], surface)
            entries['reconstruction/surface.json'] = surface
        render = spatial.root / 'scenes' / scene_id / 'render.json'
        if render.exists(): entries['render.json'] = _read(render.parent, 'render.json', 64 * 1024)
        revision = {'revision': 1, 'scene_revision': row['revision'], 'title': scene['title'], 'scene': scene,
                    'history': history, 'layouts': layouts, 'source_jobs': jobs, 'saved_at': _stamp()}
        from services.spatial.plan_settings import PlanSettingsService
        # Same read-only SQLite snapshot as the scene; no lazy table creation or
        # service/worker construction while exporting an existing installation.
        revision['plan_config']=PlanSettingsService._read(db,scene_id)['config']
        from services.spatial.presentation import PresentationService
        # Every presentation writer claims the spatial DB before its independent
        # journal. This open scene snapshot therefore pins both reads together.
        presentation=PresentationService(spatial)._read(scene_id)
        revision['presentation_config']=presentation['config']
        revision['presentation_source_scene_revision']=presentation['source_scene_revision']
    reference_id = scene.get('reference_set_id')
    included, originals = False, False
    if include_references and reference_id is not None:
        from services.spatial.references import ReferenceSetService
        service = ReferenceSetService(spatial.root); references = service.get(reference_id)
        original_manifest = _read(spatial.root / 'reference-sets' / reference_id, 'references.json', 128 * 1024)
        entries['references/source-manifest.json'] = original_manifest
        frames = []
        for frame in references['frames']:
            derived_path = f'references/derived/{frame["id"]}.jpg'
            raw, _, _ = service.image(reference_id, frame['id']); entries[derived_path] = raw
            original_path = None
            if include_originals:
                raw, mime, _ = service.image(reference_id, frame['id'], variant='original')
                original_path = f'references/originals/{frame["id"]}.{"png" if mime == "image/png" else "jpg"}'; entries[original_path] = raw
            frames.append({'id': frame['id'], 'label': frame['label'], 'source_sha256': frame['sha256'],
                'source_width': frame['width'], 'source_height': frame['height'], 'source_mime_type': frame['mime_type'],
                'derived_path': derived_path, 'derived_sha256': frame['thumbnail']['sha256'], 'original_path': original_path})
        entries['references/references.json'] = _json({'format': 'brivany-project-references-1', 'id': reference_id,
            'title': references['title'], 'origin': references['origin'], 'source_manifest_sha256': _hash(original_manifest),
            'originals_included': include_originals, 'frames': frames, 'preflight': references['preflight']})
        included, originals = True, include_originals
    version_path = 'versions/revision-000001.json'; entries[version_path] = _json(revision)
    manifest = {'format': FORMAT, 'project_id': str(uuid4()), 'title': _title(scene['title']), 'created_at': _stamp(), 'updated_at': _stamp(),
        'revision': 1, 'source_scene_id': scene_id, 'origin': scene['origin'], 'units': scene['units'],
        'flags': {'reference_metadata_included': included, 'reference_originals_included': originals,
                  'original_video_included': False, 'original_video_not_retained_or_not_exported': True,
                  'private_project': True, 'native_application': False, 'automatic_execution': False},
        'files': [_entry(relative, raw) for relative, raw in sorted(entries.items())],
        'versions': [{'revision': 1, 'path': version_path, 'sha256': _hash(entries[version_path]), 'saved_at': revision['saved_at']}]}
    if len(entries) > MAX_FILES or sum(len(raw) for raw in entries.values()) > MAX_TOTAL: _fail('project_limit')
    with tempfile.TemporaryDirectory(prefix='.brivany-project-', dir=destination.parent) as temporary:
        staging = Path(temporary) / 'project'; staging.mkdir()
        for relative, raw in entries.items():
            target = staging / relative; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
        _publish_manifest(staging, manifest); _load(staging)
        from services.spatial.backup import _publish_directory
        try: _publish_directory(staging, destination)
        except FileExistsError: _fail('project_destination', 'El destino ya existe; no se reemplazará.', 409)
    return open_project(destination)


@contextmanager
def _write_lock(root):
    path = root / '.project.lock'
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError: _fail('project_busy', 'El proyecto está siendo guardado; no se modificó.', 409)
    try:
        os.close(descriptor); yield
    finally: path.unlink(missing_ok=True)


@_checked
def save_project(path, *, expected_revision, title=None, objects=None, plan_config=None,presentation_config=None):
    root = _root(path)
    with _write_lock(root):
        _, manifest, payloads, versions = _load(root)
        if type(expected_revision) is not int or manifest['revision'] != expected_revision: _fail('project_conflict', 'El proyecto cambió; vuelve a abrirlo.', 409)
        if expected_revision >= MAX_VERSIONS: _fail('project_version_limit', 'El proyecto alcanzó cien versiones.', 429)
        document = deepcopy(versions[-1]); scene = document['scene']
        if plan_config is not None:
            from services.spatial.plan_settings import validate_plan_config
            document['plan_config']=validate_plan_config(plan_config)
        if title is not None: document['title'] = scene['title'] = _title(title)
        if objects is not None:
            if not isinstance(objects, list) or len(objects) > 100: _fail()
            known = {item['id']: item for item in scene['objects']}; seen = set()
            for patch in objects:
                if not isinstance(patch, dict) or set(patch) != {'id', 'transform'} or not isinstance(patch['id'], str) or patch['id'] in seen or patch['id'] not in known: _fail()
                obj = known[patch['id']]; seen.add(patch['id'])
                if not obj['editable'] or obj['role'] == 'environment': _fail('project_locked_object', 'El entorno no puede moverse.', 409)
                obj['transform'] = Transform.model_validate(patch['transform']).model_dump(mode='json')
            transforms = {obj['id']: obj['transform'] for obj in scene['objects'] if obj['editable'] and obj['role'] != 'environment'}
            _transforms(transforms, SceneManifest.model_validate_json(_json(scene)))
            states = document['history']['states'][:document['history']['cursor'] + 1]
            states = (states + [{'label': 'Guardar proyecto', 'transforms': transforms}])[-100:]
            document['history'] = {'cursor': len(states) - 1, 'states': states}
            document['scene_revision'] += 1
        if presentation_config is not None:
            from services.spatial.presentation import validate_presentation_config
            document['presentation_config']=validate_presentation_config(presentation_config,object_ids={item['id'] for item in scene['objects']})
            document['presentation_source_scene_revision']=document['scene_revision']
        document.update(revision=expected_revision + 1, saved_at=_stamp()); _version(document)
        relative = f'versions/revision-{document["revision"]:06d}.json'; raw = _json(document)
        entry = _entry(relative, raw)
        if sum(item['size_bytes'] for item in manifest['files']) + len(raw) > MAX_TOTAL or len(manifest['files']) >= MAX_FILES: _fail('project_limit')
        target = root / relative
        if target.parent.resolve() != target.parent or target.exists(): _fail('project_conflict', 'La ruta de versión ya existe.', 409)
        manifest.update(revision=document['revision'], title=document['title'], updated_at=_stamp())
        manifest['files'].append(entry); manifest['versions'].append({'revision': document['revision'], 'path': relative, 'sha256': _hash(raw), 'saved_at': document['saved_at']})
        published, created = False, False
        try:
            with target.open('xb') as stream:
                created = True; stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            _publish_manifest(root, manifest); published = True
        finally:
            if created and not published: target.unlink(missing_ok=True)
    return open_project(root)


@_checked
def export_project(path, destination):
    root = _root(path); destination = Path(destination).absolute()
    if destination.resolve() != destination or destination.exists() or not destination.parent.is_dir() or destination.is_relative_to(root): _fail('project_destination', 'El ZIP de destino debe ser nuevo y estar fuera del proyecto.', 409)
    with _write_lock(root):
        _, manifest, payloads, _ = _load(root)
        with tempfile.TemporaryDirectory(prefix='.brivany-project-export-', dir=destination.parent) as temporary:
            archive = Path(temporary) / 'project.zip'
            with ZipFile(archive, 'x', compression=ZIP_DEFLATED) as package:
                package.writestr('manifest.json', _json(manifest))
                for relative, raw in payloads.items(): package.writestr(relative, raw)
            try: os.link(archive, destination)
            except FileExistsError: _fail('project_destination', 'El destino ya existe; no se reemplazará.', 409)
    return {'status': 'exported', 'project_id': manifest['project_id'], 'revision': manifest['revision'],
            'archive_sha256': _hash(destination.read_bytes()), 'files': len(payloads) + 1,
            'reference_originals_included': manifest['flags']['reference_originals_included'], 'automatic_execution': False}
