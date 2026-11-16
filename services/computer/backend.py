"""Pinned local backend bundles. Never copy a checkout or user profile wholesale."""
from packages.runtime_paths import DATA_ROOT, CONFIG_PATH
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import threading
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[2]
BUNDLES=DATA_ROOT/'.local/computer/backend'
NOTICE='''Brivany / Melodi local computer backend

Cognira Desktop / Stacy: Vortex Developer. Source reused from the directory
explicitly supplied by this computer's user, without modifying that checkout.
This local bundle does not establish a public redistribution license for Cognira.
Retain the source attribution and obtain applicable rights before distribution.

Electron and Chromium notices: node_modules/electron/dist/LICENSE and
node_modules/electron/dist/LICENSES.chromium.html.
Three.js: node_modules/three/LICENSE.
Brivany's adapter and application remain outside this dependency bundle.
No credentials, .env files, user profiles, conversations or recordings are included.
'''


class BackendError(ValueError):pass


def digest(path):
    value=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):value.update(chunk)
    return value.hexdigest()


def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()


def plain_path(base,relative):
    """Resolve an allowlisted regular file without following links/junctions."""
    rel=PurePosixPath(relative)
    if not relative or rel.is_absolute() or '\\' in relative or ':' in relative or any(p in {'','..','.'} or p.startswith('.') for p in rel.parts):raise BackendError('Ruta de backend no admitida.')
    base=Path(base).absolute();candidate=base.joinpath(*rel.parts)
    for current in (candidate,*candidate.parents):
        if current.is_symlink() or getattr(current,'is_junction',lambda:False)():raise BackendError('No se admiten enlaces de backend.')
    if not candidate.resolve().is_relative_to(base.resolve()):raise BackendError('Ruta fuera del backend.')
    return candidate


def locks():
    source=json.loads((ROOT/'config/computer-source.json').read_text(encoding='utf-8'))
    runtime=json.loads((ROOT/'config/computer-runtime.json').read_text(encoding='utf-8'))
    if runtime.get('schema_version')!=1 or runtime.get('target')!='win32-x64':raise BackendError('Lock de runtime no admitido.')
    return source,runtime


def expected_files(source_lock,runtime_lock):
    values={**source_lock['files'],**runtime_lock['files']}
    if set(source_lock['files']) & set(runtime_lock['files']):raise BackendError('Los locks de backend se superponen.')
    if any(not re.fullmatch('[0-9a-f]{64}',value) for value in values.values()):raise BackendError('Hash de backend inválido.')
    values['BRIVANY-NOTICE.txt']=hashlib.sha256(NOTICE.encode()).hexdigest()
    return values


_cache={}
_cache_lock=threading.RLock()


def verify_bundle(directory,*,force=False,source_lock=None,runtime_lock=None):
    directory=Path(directory).absolute()
    if source_lock is None or runtime_lock is None:source_lock,runtime_lock=locks()
    expected=expected_files(source_lock,runtime_lock)
    manifest_file=plain_path(directory,'bundle-manifest.json')
    if manifest_file.stat().st_size>100000:raise BackendError('Manifiesto de backend demasiado grande.')
    manifest=json.loads(manifest_file.read_text(encoding='utf-8'))
    if set(manifest)!={'schema_version','target','versions','files'} or manifest['schema_version']!=1 or manifest['target']!=runtime_lock['target'] or manifest['versions']!=runtime_lock['versions']:raise BackendError('Manifiesto de backend incompatible.')
    identifier=hashlib.sha256(canonical(manifest)).hexdigest()[:32]
    if directory.name!=identifier:raise BackendError('La identidad del paquete no coincide.')
    if not isinstance(manifest['files'],dict) or set(manifest['files'])!=set(expected):raise BackendError('El paquete no contiene exactamente los archivos admitidos.')
    metadata=[]
    for name,wanted in expected.items():
        entry=manifest['files'][name]
        if not isinstance(entry,dict) or set(entry)!={'sha256','bytes'} or entry['sha256']!=wanted or type(entry['bytes']) is not int or entry['bytes']<0:raise BackendError('El paquete no coincide con los locks revisados.')
        file=plain_path(directory,name);stat=file.stat()
        if not file.is_file() or stat.st_size!=entry['bytes']:raise BackendError('Falta un archivo verificado del backend.')
        metadata.append((name,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns,stat.st_ino))
    fingerprint=(digest(manifest_file),tuple(metadata))
    # Enumerate even on a cache hit: adding a JS/DLL must invalidate availability.
    actual=set()
    for node in directory.rglob('*'):
        if node.is_symlink() or getattr(node,'is_junction',lambda:False)():raise BackendError('El paquete contiene enlaces.')
        if node.is_file():actual.add(node.relative_to(directory).as_posix())
    if actual!=set(expected)|{'bundle-manifest.json'}:raise BackendError('El paquete contiene archivos no declarados.')
    with _cache_lock:
        if not force and _cache.get(str(directory))==fingerprint:return manifest
        for name,wanted in expected.items():
            if digest(plain_path(directory,name))!=wanted:raise BackendError('Un archivo del backend fue alterado; no se iniciará.')
        _cache[str(directory)]=fingerprint
    return manifest


def build_bundle(source,output_root=BUNDLES,*,source_lock=None,runtime_lock=None):
    """Copy only pinned files into a new immutable directory; no downloads."""
    if source_lock is None or runtime_lock is None:source_lock,runtime_lock=locks()
    source=Path(source).absolute();output_root=Path(output_root).absolute()
    if source.resolve().is_relative_to(output_root.resolve()) or output_root.resolve().is_relative_to(source.resolve()):raise BackendError('El paquete debe estar separado del directorio fuente.')
    if any(node.is_symlink() or getattr(node,'is_junction',lambda:False)() for node in (output_root,*output_root.parents)):raise BackendError('El destino no admite enlaces.')
    output_root.mkdir(parents=True,exist_ok=True)
    expected=expected_files(source_lock,runtime_lock);stage=output_root/('stage-'+uuid4().hex);stage.mkdir()
    try:
        entries={}
        for name,wanted in expected.items():
            destination=plain_path(stage,name);destination.parent.mkdir(parents=True,exist_ok=True)
            if name=='BRIVANY-NOTICE.txt':destination.write_bytes(NOTICE.encode())
            else:
                original=plain_path(source,name)
                if not original.is_file():raise BackendError('Falta un archivo del backend fuente.')
                shutil.copyfile(original,destination)
            if digest(destination)!=wanted:raise BackendError('El backend fuente no coincide con el lock; no se activó.')
            entries[name]={'sha256':wanted,'bytes':destination.stat().st_size}
        manifest={'schema_version':1,'target':runtime_lock['target'],'versions':runtime_lock['versions'],'files':entries}
        identifier=hashlib.sha256(canonical(manifest)).hexdigest()[:32];destination=output_root/identifier
        (stage/'bundle-manifest.json').write_bytes(canonical(manifest))
        if destination.exists():verify_bundle(destination,force=True,source_lock=source_lock,runtime_lock=runtime_lock)
        else:stage.rename(destination)
        verify_bundle(destination,force=True,source_lock=source_lock,runtime_lock=runtime_lock)
        return {'id':identifier,'directory':str(destination),'file_count':len(entries),'bytes':sum(item['bytes'] for item in entries.values()),'target':manifest['target'],'versions':manifest['versions']}
    finally:
        # This invocation owns the stage UUID. Check its absolute parent before deletion.
        if stage.exists() and stage.resolve().parent==output_root.resolve() and re.fullmatch('stage-[0-9a-f]{32}',stage.name):shutil.rmtree(stage)


def activate_bundle(directory,output_root=BUNDLES):
    directory=Path(directory).absolute();output_root=Path(output_root).absolute()
    if directory.resolve().parent!=output_root.resolve():raise BackendError('El backend debe estar dentro de la carpeta de paquetes.')
    verify_bundle(directory,force=True)
    pointer=output_root/'active.json';temporary=output_root/('active-'+uuid4().hex+'.tmp')
    temporary.write_bytes(canonical({'schema_version':1,'id':directory.name}));temporary.replace(pointer)


@dataclass(frozen=True)
class BackendLocation:
    source:Path
    mode:str
    error:str|None=None


def resolve_backend(source=None,*,bundle_root=BUNDLES,environ=None):
    environ=os.environ if environ is None else environ
    explicit=source or environ.get('BRIVANY_COGNIRA_SOURCE')
    if explicit:
        path=Path(explicit).absolute();return BackendLocation(path,'bundled' if is_bundle(path) else 'development')
    bundle_root=Path(bundle_root).absolute();pointer=bundle_root/'active.json'
    if pointer.exists() or pointer.is_symlink():
        try:
            if pointer.is_symlink() or getattr(pointer,'is_junction',lambda:False)() or pointer.stat().st_size>1000:raise BackendError('Selección de backend inválida.')
            value=json.loads(pointer.read_text(encoding='utf-8'))
            if set(value)!={'schema_version','id'} or value['schema_version']!=1 or not re.fullmatch('[0-9a-f]{32}',value['id']):raise BackendError('Selección de backend inválida.')
            return BackendLocation(bundle_root/value['id'],'bundled')
        except (OSError,ValueError,TypeError):return BackendLocation(bundle_root/'unavailable','bundled','invalid_bundle_selection')
    # A private, allowlisted distribution can carry the same verified backend
    # read-only. User-selected bundles retain priority; no personal profile ships.
    installed=ROOT/'computer-backend'
    if installed!=bundle_root and (installed/'active.json').is_file():return resolve_backend(bundle_root=installed,environ={})
    return BackendLocation(ROOT.parent/'cognira-desktop','development')


def is_bundle(source):return (Path(source)/'bundle-manifest.json').is_file() or bool(re.fullmatch('[0-9a-f]{32}',Path(source).name))


def verify_source(source,*,force=False):
    """Verify bundle fully, or the pinned source modules of a deliberate checkout."""
    source=Path(source)
    if is_bundle(source):return verify_bundle(source,force=force)
    source_lock,_=locks()
    if any(digest(plain_path(source,name))!=wanted for name,wanted in source_lock['files'].items()):raise BackendError('El backend fuente no coincide con el lock.')
    return None


def child_environment():
    # The dependency/runtime processes have no provider keys or caller session grants.
    excluded={'ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE'}
    return {key:value for key,value in os.environ.items() if not (re.search('API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|^BRIVANY_',key,re.I) or key in excluded)}
