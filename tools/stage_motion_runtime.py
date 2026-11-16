"""Reversible local motion-runtime patch; dry-run unless --apply is explicit.

This stages only application resources into the existing 0.1.0 release. It never
opens Brivany, changes current.json/version, accesses User Data, reads .env or
publishes an update feed. Stop Brivany normally before applying or restoring.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.1.0'
SCHEMA = 1
FIXED_FILES = (
    'services/vetsa_account.py','desktop/experience/account.py','desktop/experience/account_window.py',
    'desktop/experience/account.js','desktop/experience/account.css',
    'services/private_store.py','services/chat_history.py','desktop/experience/chat_http.py',
    'desktop/experience/agents.js','packages/providers/melodi_dialogue.py',
    'packages/providers/general_chat.py','packages/providers/conversation.py',
    'desktop/experience/index.html','desktop/experience/shell.js','desktop/experience/chat.js',
    'desktop/experience/chat-text.js','desktop/experience/chat.html','desktop/experience/chat-history.js','desktop/experience/chat-activity.js','desktop/experience/chat-activity.css',
    'desktop/experience/chat.css','desktop/experience/references.js','desktop/experience/image-viewer.js','desktop/experience/image-viewer.css',
    'desktop/experience/window_bounds.py',
    'desktop/experience/reveal_file.py',
    'desktop/experience/shell-boot.js','desktop/experience/minimal.css',
    'desktop/experience/official_transfer.py','desktop/experience/workspace_phone.py',
    'desktop/experience/workspace-phone.js','desktop/experience/workspace-phone-settings.js',
    'desktop/experience/workspace-locales/en.json','desktop/experience/workspace-locales/fr.json','desktop/experience/workspace-locales/pt-BR.json',
    'desktop/experience/drop_transfer.py','desktop/experience/drop_http.py','desktop/experience/drop-peer.js',
    'desktop/experience/workspace-drop.js','desktop/experience/workspace-drop.css',
    'desktop/experience/workspace_files.py','desktop/experience/workspace-files.js','desktop/experience/workspace-files.css',
    'desktop/experience/workspace-settings.js','desktop/experience/work-widget.html','services/h1/server.py',
    'desktop/management.py','desktop/experience/lifecycle.py','desktop/distribution/restart.py',
    'desktop/distribution/entry.py',
    'services/telephony/sip.py','services/telephony/sip_engine.py','services/telephony/realtime.py',
    'services/computer/service.py', 'services/computer/planner.py', 'services/computer/http.py',
    'services/computer/skills.py',
    'services/orchestration/meta.py', 'services/orchestration/results.py',
    'services/orchestration/image_studio.py',
    'services/orchestration/deliveries.py',
    'services/orchestration/team.py', 'services/orchestration/motion_result.py',
    'desktop/experience/launcher.py', 'desktop/experience/computer.js',
    'desktop/experience/workspace-results.js',
)
RESULT_COMPANIONS = ('workspace-results.css', 'workspace-results.js.LEGAL.txt',
                     'workspace-results.LICENSE.txt')
PRIVATE_PARTS = {'.git', '.local', '.cache', '__pycache__', '.bin'}
PRIVATE_SUFFIXES = {'.pyc', '.pyo', '.dpapi', '.pfx', '.p12', '.key', '.sqlite', '.sqlite3', '.log'}


class StageError(ValueError):
    pass


def filehash(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def canonical(path):
    value = Path(path).absolute()
    for parent in (value, *value.parents):
        if parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)():
            raise ValueError('No se admiten enlaces o junctions en el despliegue local.')
    if value.resolve() != value:
        raise ValueError('La ruta del despliegue debe ser local y canónica.')
    return value


def under(path, root):
    value = canonical(path)
    if not value.is_relative_to(canonical(root)):
        raise ValueError('Un archivo sale de la carpeta de despliegue prevista.')
    return value


def private(relative):
    relative = Path(relative)
    return (any(p.casefold() in PRIVATE_PARTS or p.casefold().startswith('.env') for p in relative.parts)
            or relative.suffix.casefold() in PRIVATE_SUFFIXES)


def allowed_runtime_path(relative):
    value = Path(relative);name = value.as_posix()
    if (value.is_absolute() or '..' in value.parts or private(value) or
            any(re.search(r'[<>:"|?*\x00-\x1f]', p) or p[-1:] in {'.', ' '} for p in value.parts)):
        return False
    if name in FIXED_FILES or name in {'desktop/experience/'+n for n in RESULT_COMPANIONS}:
        return True
    if name in {'services/brand.py','desktop/experience/typography.py','web/typography.css'}:return True
    if name.startswith('web/fonts/'):return value.name in {'BrivanyEditorial-'+style+ext for style in ('Light','Regular','Medium') for ext in ('.ttf','.woff2')} or value.name in {'LICENSE-AND-ATTRIBUTION.txt','README.txt','manifest.json'}
    if name.startswith('services/motion/'):
        return value.suffix.casefold() == '.py' or (name.startswith('services/motion/assets/') and
            value.suffix.casefold() in {'.svg', '.js', '.woff2', '.md', '.json'})
    if name.startswith('motion-studio/node_modules/'):
        return True
    return name.startswith('runtime-bin/') and value.suffix.casefold() in {'.exe', '.dll', '.txt'}


def checked_tree_path(root, relative, checked_directories):
    """Inspect shared parent directories once per phase, not 70k times on NTFS."""
    relative = Path(relative)
    if relative.is_absolute() or relative.drive or '..' in relative.parts:
        raise ValueError('La ruta relativa del runtime no es válida.')
    current = root
    for part in relative.parts[:-1]:
        current = current/part
        if current not in checked_directories:
            if current.is_symlink() or getattr(current, 'is_junction', lambda: False)():
                raise ValueError('No se admiten enlaces en el árbol del runtime.')
            if current.exists() and not current.is_dir():
                raise ValueError('Un contenedor del runtime dejó de ser carpeta.')
            checked_directories.add(current)
    result = root/relative
    if result.is_symlink() or getattr(result, 'is_junction', lambda: False)():
        raise ValueError('No se admiten enlaces en archivos de runtime.')
    return result


def tree_files(directory, source_root):
    directory = under(directory, source_root)
    if not directory.is_dir():
        raise ValueError('No está preparada la dependencia local: ' + directory.name)
    for folder, names, files in os.walk(directory, followlinks=False):
        parent = canonical(folder)
        kept = []
        for name in sorted(names):
            child = parent/name
            if private(child.relative_to(source_root)):
                continue
            under(child, source_root)
            kept.append(name)
        names[:] = kept
        for name in sorted(files):
            source = parent/name
            relative = source.relative_to(source_root)
            if private(relative):
                continue
            # parent was fully checked above; this name comes from os.walk.
            if source.is_symlink() or getattr(source, 'is_junction', lambda: False)():
                raise ValueError('No se admiten enlaces en dependencias locales.')
            if not source.is_file():
                raise ValueError('El recurso no es un archivo normal.')
            yield relative.as_posix(), source


def node_runtime_entries(source_root=ROOT):
    """Return the pinned, installed Node package tree, without private caches."""
    source_root = canonical(source_root)
    cli = source_root/'motion-studio/node_modules/hyperframes/bin/hyperframes.mjs'
    if not canonical(cli).is_file():
        raise ValueError('Falta HyperFrames local en motion-studio/node_modules; no se descargará durante el empaquetado.')
    return list(tree_files(source_root/'motion-studio/node_modules', source_root))


def portable_binary_entries():
    """Use binaries already on PATH; never download or resolve model URLs."""
    result = []
    for name in ('node', 'ffmpeg', 'ffprobe'):
        found = shutil.which(name)
        if not found:
            raise ValueError('Falta ' + name + ' en PATH para incluir el runtime portable.')
        source = canonical(found)
        if source.suffix.casefold() != '.exe' or not source.is_file():
            raise ValueError('El runtime portable requiere ejecutables Windows reales.')
        result.append(('runtime-bin/' + name + '.exe', source))
        if name == 'ffmpeg':
            # Shared Windows builds need their adjacent codec DLLs.
            for file in sorted(source.parent.glob('*.dll')):
                file = canonical(file)
                if file.is_file():
                    result.append(('runtime-bin/' + file.name, file))
        for license_name in ('LICENSE', 'LICENSE.txt', 'LICENSE.md', 'COPYING', 'COPYING.txt'):
            for folder in (source.parent, source.parent.parent):
                notice = canonical(folder/license_name)
                if notice.is_file():
                    result.append(('runtime-bin/licenses/' + name + '-' + license_name + '.txt', notice))
                    break
            else:
                continue
            break
    return list(dict(result).items())


def application_entries(source_root=ROOT, *, bundle_binaries=False):
    source_root = canonical(source_root)
    result = {name: file for name, file in tree_files(source_root/'services/motion', source_root)
              if allowed_runtime_path(name)}
    for relative in FIXED_FILES:
        source = under(source_root/relative, source_root)
        if not source.is_file():
            raise ValueError('Falta el archivo de integración: ' + relative)
        result[relative] = source
    for name in RESULT_COMPANIONS:
        source = under(source_root/'desktop/experience'/name, source_root)
        if source.is_file():
            result[source.relative_to(source_root).as_posix()] = source
    result.update(node_runtime_entries(source_root))
    if bundle_binaries:
        result.update(portable_binary_entries())
    if len({name.casefold() for name in result}) != len(result):
        raise ValueError('Hay nombres duplicados para Windows en el runtime.')
    return sorted(result.items())


def default_app_root():
    local = os.environ.get('LOCALAPPDATA')
    if not local:
        raise ValueError('No se encontró LOCALAPPDATA de Windows.')
    return Path(local)/'Programs/Brivany/releases'/VERSION/'app'


def installed_app(path):
    app = canonical(path)
    if app.name != 'app' or app.parent.name != VERSION or app.parent.parent.name != 'releases':
        raise ValueError('El parche sólo corresponde al release existente 0.1.0/app.')
    if not (app/'desktop/distribution/entry.py').is_file() or not (app.parent/'python/python.exe').is_file():
        raise ValueError('No se encontró una instalación completa existente; no se creará otra app.')
    install = app.parents[2]
    current = json.loads((install/'current.json').read_text(encoding='utf-8'))
    if current != {'version': VERSION}:
        raise ValueError('La versión seleccionada cambió; no se tocará el release.')
    return app


def running_brivany():
    if os.name != 'nt':
        raise ValueError('Este helper sólo comprueba procesos de la instalación Windows.')
    code = r"""$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object {
 $_.Name -eq 'Brivany.exe' -or
 (($_.Name -eq 'pythonw.exe' -or $_.Name -eq 'python.exe') -and
  ($_.CommandLine -match 'desktop[\\/](distribution[\\/]entry\.py|experience[\\/]launcher\.py)' -or
   $_.CommandLine -match '-m\s+desktop\.(experience\.launcher|distribution\.entry)' -or
   ($_.Name -eq 'pythonw.exe' -and -not $_.CommandLine)))
} | Select-Object ProcessId,Name) | ConvertTo-Json -Compress"""
    process = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', code],
        check=True, capture_output=True, text=True, timeout=25,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    value = json.loads(process.stdout.strip() or '[]')
    return value if isinstance(value, list) else [value]


def require_closed():
    active = running_brivany()
    if active:
        raise ValueError('Brivany sigue abierto. Ciérralo normalmente antes de aplicar/restaurar; no se terminarán procesos.')


def make_plan(app_root, source_root=ROOT, *, bundle_binaries=False):
    app = installed_app(app_root)
    records = [];checked_directories = {app}
    for relative, source in application_entries(source_root, bundle_binaries=bundle_binaries):
        if not allowed_runtime_path(relative):
            raise ValueError('Un recurso no pertenece a esta integración.')
        target = checked_tree_path(app, relative, checked_directories)
        after = filehash(source)
        if target.exists() and not target.is_file():
            raise ValueError('Un recurso instalado no es un archivo normal: ' + relative)
        before = filehash(target) if target.exists() else None
        if before == after:
            continue
        records.append({'path': relative, 'source': str(source), 'before_sha256': before,
                        'after_sha256': after, 'bytes': source.stat().st_size})
    return {'schema': SCHEMA, 'kind': 'brivany-motion-runtime-local-patch',
            'version': VERSION, 'app_root': str(app), 'source_root': str(canonical(source_root)),
            'created_utc': datetime.now(timezone.utc).isoformat(), 'state': 'planned',
            'records': records, 'applied_paths': [], 'created_directories': [],
            'user_data_accessed': False, 'package_version_changed': False,
            'portable_binaries': bool(bundle_binaries)}


def save_manifest(folder, manifest):
    file = under(folder/'manifiesto.json', folder)
    stage = folder/('manifest-'+uuid4().hex+'.json')
    stage.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(stage, file)
    return file


def _backup_root(path, app):
    root = canonical(path)
    if root.is_relative_to(app) or app.is_relative_to(root):
        raise ValueError('El respaldo debe estar fuera del árbol de la app.')
    local = os.environ.get('LOCALAPPDATA')
    if local:
        user_data = canonical(Path(local)/'Brivany/User Data')
        if root.is_relative_to(user_data) or user_data.is_relative_to(root):
            raise ValueError('El respaldo no puede estar dentro de User Data.')
    return root


def apply_plan(manifest, backup_root):
    require_closed()
    app = installed_app(manifest['app_root'])
    backup_root = _backup_root(backup_root, app)
    backup_root.mkdir(parents=True, exist_ok=True)
    folder = backup_root/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid4().hex[:8])
    folder.mkdir(exist_ok=False)
    backups = folder/'files';backups.mkdir()
    file = save_manifest(folder, manifest)
    try:
        # Back up every replacement before changing the first installed file.
        checked_directories = {app};source_root = canonical(manifest['source_root']);source_directories = {source_root}
        def checked_source(row):
            source = Path(row['source']).absolute()
            return (checked_tree_path(source_root, source.relative_to(source_root), source_directories)
                    if source.is_relative_to(source_root) else canonical(source))
        for row in manifest['records']:
            target = checked_tree_path(app, row['path'], checked_directories)
            current = filehash(target) if target.is_file() else None
            if current != row['before_sha256'] or filehash(checked_source(row)) != row['after_sha256']:
                raise ValueError('Un archivo cambió desde la planificación; no se sobrescribirá.')
            if current is not None:
                saved = under(backups/row['path'], backups)
                saved.parent.mkdir(parents=True, exist_ok=True);shutil.copy2(target, saved)
                if filehash(saved) != current:
                    raise ValueError('No se pudo verificar una copia de respaldo.')
        manifest['state'] = 'backup_complete';save_manifest(folder, manifest)
        require_closed()
        checked_directories = {app};source_directories = {source_root}
        for index, row in enumerate(manifest['records']):
            if index and index % 500 == 0:
                require_closed()
            target = checked_tree_path(app, row['path'], checked_directories)
            current = filehash(target) if target.is_file() else None
            if current != row['before_sha256']:
                raise ValueError('Otro proceso cambió un archivo instalado; se conserva el respaldo.')
            source = checked_source(row)
            if filehash(source) != row['after_sha256']:
                raise ValueError('La fuente cambió mientras se aplicaba el parche.')
            missing = []
            parent = target.parent
            while not parent.exists():
                missing.append(parent);parent = parent.parent
            target.parent.mkdir(parents=True, exist_ok=True)
            manifest['created_directories'].extend(p.relative_to(app).as_posix() for p in reversed(missing))
            stage = target.parent/('.stage-'+uuid4().hex)
            try:
                shutil.copy2(source, stage)
                if filehash(stage) != row['after_sha256']:
                    raise ValueError('La copia del runtime no coincide con su hash.')
                os.replace(stage, target)
            finally:
                if stage.exists():stage.unlink()
            manifest['applied_paths'].append(row['path'])
            if index % 500 == 0:
                save_manifest(folder, manifest)
        manifest['state'] = 'applied';save_manifest(folder, manifest)
        return file
    except BaseException as error:
        manifest['state'] = 'failed';manifest['error_type'] = type(error).__name__
        save_manifest(folder, manifest)
        raise StageError('El parche no terminó. Respaldo: '+str(file)+'. Motivo: '+str(error)) from error


def restoration_plan(file):
    file = canonical(file)
    if not file.is_file() or file.stat().st_size > 16*1024**2:
        raise ValueError('El manifiesto de respaldo no es válido.')
    manifest = json.loads(file.read_text(encoding='utf-8'))
    if (manifest.get('schema') != SCHEMA or manifest.get('kind') != 'brivany-motion-runtime-local-patch'
            or manifest.get('version') != VERSION or not isinstance(manifest.get('records'), list)):
        raise ValueError('El manifiesto no pertenece al runtime de Melodi.')
    app = installed_app(manifest['app_root']);folder = file.parent
    checked_directories = {app}
    for row in manifest['records']:
        relative = Path(row['path'])
        if not allowed_runtime_path(relative):
            raise ValueError('El manifiesto contiene una ruta no admitida.')
        target = checked_tree_path(app, relative, checked_directories)
        current = filehash(target) if target.is_file() else None
        if current not in {row['before_sha256'], row['after_sha256'], None}:
            raise ValueError('Un archivo se editó después del parche; no se perderá ese cambio.')
        if row['before_sha256'] is not None and current != row['before_sha256']:
            saved = under(folder/'files'/relative, folder/'files')
            if not saved.is_file() or filehash(saved) != row['before_sha256']:
                raise ValueError('El respaldo no conserva el archivo original verificado.')
    return manifest


def restore(file):
    require_closed();file = canonical(file);manifest = restoration_plan(file)
    app = installed_app(manifest['app_root'])
    checked_directories = {app}
    for row in reversed(manifest['records']):
        target = checked_tree_path(app, row['path'], checked_directories)
        current = filehash(target) if target.is_file() else None
        if current == row['before_sha256']:
            continue
        if row['before_sha256'] is None:
            if current == row['after_sha256']:
                target.unlink()  # One exact, hash-checked new file inside app.
        else:
            saved = under(file.parent/'files'/row['path'], file.parent/'files')
            target.parent.mkdir(parents=True, exist_ok=True);shutil.copy2(saved, target)
    for relative in sorted(set(manifest['created_directories']), key=lambda v: len(Path(v).parts), reverse=True):
        directory = under(app/relative, app)
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()
    manifest['state'] = 'restored';manifest['restored_utc'] = datetime.now(timezone.utc).isoformat()
    save_manifest(file.parent, manifest)
    return manifest


def summary(manifest):
    rows = manifest['records']
    return {'state': manifest['state'], 'version': manifest['version'], 'app_root': manifest['app_root'],
            'changed_files': len(rows), 'replacements': sum(v['before_sha256'] is not None for v in rows),
            'new_files': sum(v['before_sha256'] is None for v in rows),
            'copy_bytes': sum(v['bytes'] for v in rows), 'portable_binaries': manifest['portable_binaries'],
            'user_data_accessed': False, 'app_launched': False,
            'integration_files': [v['path'] for v in rows if not v['path'].startswith('motion-studio/node_modules/')]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply explicitly; otherwise inspect only.')
    parser.add_argument('--app-root', type=Path, default=None)
    parser.add_argument('--backup-root', type=Path, default=ROOT/'.local/motion-runtime-backups')
    parser.add_argument('--bundle-binaries', action='store_true')
    parser.add_argument('--restore', type=Path, metavar='MANIFEST')
    args = parser.parse_args(argv)
    require_closed()
    if args.restore:
        value = restore(args.restore) if args.apply else restoration_plan(args.restore)
        print(json.dumps(summary(value), ensure_ascii=False, indent=2));return 0
    manifest = make_plan(args.app_root or default_app_root(), bundle_binaries=args.bundle_binaries)
    if args.apply:
        backup = apply_plan(manifest, args.backup_root)
        print(json.dumps({**summary(manifest), 'backup_manifest': str(backup)}, ensure_ascii=False, indent=2))
    else:
        print(json.dumps({**summary(manifest), 'dry_run': True,
                          'next': 'Use --apply only after review; no installed files changed.'}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
