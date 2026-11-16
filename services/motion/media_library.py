"""Official, attributed media choices for Melodi; models select IDs, never URLs.

``catalog(exclude_music=(), query=None)`` returns public candidates. ``search``
filters this curated catalog; it is deliberately not a global web search.
``fetch_video(id, start, duration, destination, *, executor, cancelled, require)``
extracts a NEW, silent MP4. ``fetch_music`` obtains a NEW MP3. Both return
{id, kind, path, credit, license, license_url, source_page, source_start,
duration, reused, provenance}. The destination must be below the library root.
Acquisition never purchases media, changes originals or removes attribution.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
from uuid import uuid4

from services.terminal.policy import scoped

ROOT = Path(__file__).resolve().parents[2]
MAX_MUSIC_BYTES = 40 * 1024 * 1024
MAX_CLIP_BYTES = 80 * 1024 * 1024
HISTORY_LOCK = threading.RLock()


def _film(title, uuid, source, duration, credit, version, page, tags, shots=()):
    return {'title': title, 'kind': 'video', 'source': source, 'duration': duration,
            'credit': credit, 'license': 'CC BY ' + version,
            'license_url': 'https://creativecommons.org/licenses/by/' + version + '/',
            'source_page': 'https://video.blender.org/videos/watch/' + uuid,
            'license_source': page, 'tags': tags,
            'shots': [{'start': start, 'description': text} for start, text in shots]}


VIDEOS = {
    'sintel': _film('Sintel', '0eb052d0-fd51-43e6-aa33-ecdbf77a5d40',
        'https://video.blender.org/object-storage/web_videos/0eb052d0-fd51-43e6-aa33-ecdbf77a5d40-818.mp4',
        888, '© copyright Blender Foundation | durian.blender.org', '3.0',
        'https://durian.blender.org/sharing/', ['fantasy', 'journey', 'dragon', 'cinematic', 'fantasía', 'viaje'],
        [(180, 'Sintel en las azoteas'), (245, 'El dragón pequeño'),
         (299, 'Sintel al atardecer'), (371, 'Paisaje de dunas')]),
    'charge': _film('Charge', '04da454b-9893-4184-98f3-248d00625efe',
        'https://video.blender.org/object-storage/web_videos/01d4421b-55f7-4349-bb6c-b8aa3053ffe4-1080.mp4',
        263, 'Charge © Blender Foundation | studio.blender.org', '4.0',
        'https://studio.blender.org/remixing/', ['science fiction', 'robot', 'energy', 'action', 'ciencia ficción', 'energía']),
    'spring': _film('Spring', '3d95fb3d-c866-42c8-9db1-fe82f48ccb95',
        'https://video.blender.org/object-storage/web_videos/3d95fb3d-c866-42c8-9db1-fe82f48ccb95-804.mp4',
        464, '© Blender Foundation | cloud.blender.org/spring', '4.0',
        'https://studio.blender.org/projects/spring/pages/about/', ['nature', 'fantasy', 'mountains', 'naturaleza', 'montañas']),
    'elephants-dream': _film('Elephants Dream', 'cccc3e60-0291-4ecc-aa56-39b2e2c7d0d5',
        'https://video.blender.org/object-storage/web_videos/cccc3e60-0291-4ecc-aa56-39b2e2c7d0d5-720.mp4',
        654, '© 2006 Blender Foundation / Netherlands Media Art Institute / www.elephantsdream.org', '2.5',
        'https://orange.blender.org/blog/creative-commons-license-2/', ['surreal', 'machine', 'industrial', 'máquinas']),
    'big-buck-bunny': _film('Big Buck Bunny', 'bf1f3fb5-b119-4f9f-9930-8e20e892b898',
        'https://video.blender.org/object-storage/web_videos/bf1f3fb5-b119-4f9f-9930-8e20e892b898-720.mp4',
        596, '© copyright 2008, Blender Foundation / www.bigbuckbunny.org', '3.0',
        'https://peach.blender.org/about/', ['comedy', 'nature', 'animals', 'comedia', 'animales']),
    'cosmos-laundromat': _film('Cosmos Laundromat', 'f507dfdc-e73e-45a4-9778-d758cbe1ce96',
        'https://video.blender.org/object-storage/web_videos/f507dfdc-e73e-45a4-9778-d758cbe1ce96-720.mp4',
        730, '© Blender Foundation | gooseberry.blender.org', '3.0',
        'https://gooseberry.blender.org/license/', ['surreal', 'island', 'animals', 'fantasy', 'isla', 'fantasía']),
}


def _song(title, source, tags, used=False):
    return {'title': title, 'kind': 'music', 'source': source,
            'credit': "'" + title + "' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
            'license': 'CC BY 4.0', 'license_url': 'https://creativecommons.org/licenses/by/4.0/',
            'source_page': 'https://www.scottbuckley.com.au/library/' + title.lower().replace(' ', '-') + '/',
            'tags': tags, 'used_in_prior_brivany': used}


MUSIC = {
    'origami': _song('Origami', 'https://www.scottbuckley.com.au/library/wp-content/uploads/2025/10/Origami.mp3',
        ['electrojazz', 'upbeat', 'groove', 'educational', 'educativo'], True),
    'neon': _song('Neon', 'https://www.scottbuckley.com.au/library/wp-content/uploads/2019/09/sb_neon_nomelody.mp3',
        ['synthwave', 'electronic', 'pulse', 'electrónica'], True),
    'electric-dreams': _song('Electric Dreams', 'https://www.scottbuckley.com.au/library/wp-content/uploads/2020/09/sb_electricdreams.mp3',
        ['synthwave', 'warm', 'upbeat', 'electronic', 'cálido', 'pulso']),
}

# These are full music files, or video excerpts with recorded original in-points.
# A match can be reused as media, never as a prebuilt promotional composition.
MUSIC_CACHES = {
    'origami': ROOT/'videos/brivany-que-es-20261109/assets/origami.mp3',
    'neon': ROOT/'videos/brivany-ritmo-20261108/assets/neon-nomelody.mp3',
}
VIDEO_CACHES = {
    'sintel': [(180, 4.7, ROOT/'videos/brivany-que-es-20261109/assets/sintel-rooftop.mp4'),
               (245, 5.1, ROOT/'videos/brivany-que-es-20261109/assets/sintel-dragon.mp4'),
               (299, 4.2, ROOT/'videos/brivany-que-es-20261109/assets/sintel-sunset.mp4'),
               (371, 4.2, ROOT/'videos/brivany-que-es-20261109/assets/sintel-journey.mp4')],
}


def _official(url, kind):
    parsed = urlsplit(url)
    host = 'video.blender.org' if kind == 'video' else 'www.scottbuckley.com.au'
    prefix = '/object-storage/web_videos/' if kind == 'video' else '/library/wp-content/uploads/'
    suffix = '.mp4' if kind == 'video' else '.mp3'
    if (parsed.scheme != 'https' or parsed.hostname != host or parsed.netloc != host or
            parsed.username or parsed.password or parsed.query or parsed.fragment or
            not parsed.path.startswith(prefix) or not parsed.path.endswith(suffix) or
            '..' in parsed.path or '%' in parsed.path):
        raise ValueError('La fuente no pertenece al catálogo oficial autorizado.')
    return url


class _OfficialMusicRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        _official(newurl, 'music')
        return super().redirect_request(request, fp, code, message, headers, newurl)


def _check(cancelled, require):
    require()
    if cancelled is not None and cancelled.is_set():
        raise ValueError('Adquisición de medios cancelada.')


def _local_file(path):
    path = Path(path).absolute()
    for parent in (path, *path.parents):
        if parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)():
            raise ValueError('No se admiten enlaces en la biblioteca de medios.')
    if path.resolve() != path or not path.is_file():
        raise ValueError('No se encontró el archivo local de medios.')
    return path


class MediaLibrary:
    def __init__(self, root, *, opener=None):
        self.root = Path(root).absolute()
        scoped(self.root, [self.root])
        self.root.mkdir(parents=True, exist_ok=True)
        self.opener = opener or build_opener(_OfficialMusicRedirect())

    def _history(self):
        file = scoped(self.root/'.media-library-history.json', [self.root])
        if not file.exists():
            return {'music': []}
        if file.stat().st_size > 100000:
            raise ValueError('El historial local de música superó el límite.')
        value = json.loads(file.read_text(encoding='utf-8'))
        if not isinstance(value, dict) or set(value) != {'music'} or not isinstance(value['music'], list) or any(v not in MUSIC for v in value['music']):
            raise ValueError('El historial local de música no es válido.')
        return value

    def _record_music(self, asset_id):
        with HISTORY_LOCK:
            value = self._history()
            if asset_id in value['music']:
                return
            value['music'].append(asset_id)
            stage = self.root/('.history-'+uuid4().hex+'.json')
            try:
                stage.write_text(json.dumps(value), encoding='utf-8')
                target = scoped(self.root/'.media-library-history.json', [self.root])
                os.replace(stage, target)
            finally:
                if stage.exists():
                    stage.unlink()

    def catalog(self, exclude_music=(), query=None):
        if isinstance(exclude_music, str) or not isinstance(exclude_music, (list, tuple, set, frozenset)) or any(not isinstance(v, str) or v not in MUSIC for v in exclude_music):
            raise ValueError('Los identificadores de música excluida no son válidos.')
        if query is not None and (not isinstance(query, str) or len(query) > 200):
            raise ValueError('La búsqueda del catálogo no es válida.')
        query = (query or '').strip().casefold()
        used = set(self._history()['music'])

        def public(identifier, row):
            result = {'id': identifier, **deepcopy({k: v for k, v in row.items() if k != 'source'})}
            if row['kind'] == 'music':
                result['used_in_prior_brivany'] = row['used_in_prior_brivany'] or identifier in used
            return result

        def matches(row):
            return not query or query in (' '.join([row['title'], *row['tags']])).casefold()

        videos = [public(k, v) for k, v in VIDEOS.items() if matches(v)]
        music = [public(k, v) for k, v in MUSIC.items() if k not in exclude_music and matches(v)]
        music.sort(key=lambda v: v['used_in_prior_brivany'])
        return {'search_scope': 'curated_official_catalog', 'videos': videos, 'music': music,
                'exclusions_applied': sorted(exclude_music),
                'global_web_search': False,
                'limits': 'Catálogo inicial de obras oficiales con atribución; no incluye cualquier película comercial ni garantiza coincidencia visual exacta.'}

    def search(self, query, kind=None, *, exclude_music=()):
        if kind is not None and (not isinstance(kind, str) or kind not in {'video', 'music'}):
            raise ValueError('Tipo de búsqueda no admitido.')
        result = self.catalog(exclude_music=exclude_music, query=query)
        return {**result, 'videos': result['videos'] if kind != 'music' else [],
                'music': result['music'] if kind != 'video' else []}

    def _target(self, destination, suffix):
        target = Path(destination)
        if not target.is_absolute():
            target = self.root/target
        target = scoped(target, [self.root])
        if (target.suffix.lower() != suffix or not 1 <= len(target.name) <= 120 or
                any(re.search(r'[<>:"|?*\x00-\x1f]', part) or part[-1:] in {'.', ' '} or
                    re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part)
                    for part in target.relative_to(self.root).parts)):
            raise ValueError('El destino del medio no tiene un nombre o formato admitido.')
        if target.exists():
            raise FileExistsError('No se sobrescriben medios existentes.')
        target.parent.mkdir(parents=True, exist_ok=True)
        scoped(target.parent, [self.root], existing=True)
        return target

    @staticmethod
    def _publish(stage, target):
        # Hard-link creation is exclusive even if another writer races us.
        os.link(stage, target)
        stage.unlink()

    @staticmethod
    def _probe(path, executor, cancelled):
        receipt = executor.run('motion.media_probe', executor.binary('ffprobe'),
            ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', str(path)],
            cwd=path.parent, cancelled=cancelled, timeout=30)
        executor.require_success(receipt)
        return json.loads(receipt['output'])

    def fetch_video(self, asset_id, start, duration, destination, *, executor, cancelled, require=lambda: None):
        _check(cancelled, require)
        if not isinstance(asset_id, str) or asset_id not in VIDEOS:
            raise ValueError('Selecciona una película del catálogo observado.')
        row = VIDEOS[asset_id]
        if (type(start) not in (int, float) or type(duration) not in (int, float) or
                not math.isfinite(start) or not math.isfinite(duration) or
                start < 0 or not .2 <= duration <= 30 or start + duration > row['duration']):
            raise ValueError('El fragmento debe durar entre 0,2 y 30 segundos y pertenecer a la película.')
        target = self._target(destination, '.mp4')
        source = _official(row['source'], 'video')
        relative_start = float(start)
        provenance = 'official_https_excerpt'
        for origin, seconds, local in VIDEO_CACHES.get(asset_id, ()):
            if origin <= start and start + duration <= origin + seconds + .001 and local.is_file():
                source = str(_local_file(local))
                relative_start = start - origin
                provenance = 'existing_project_excerpt'
                break
        stage = target.parent/('.media-'+uuid4().hex+'.mp4')
        try:
            protocols = 'file,pipe' if provenance != 'official_https_excerpt' else 'https,tls,tcp'
            receipt = executor.run('motion.media_excerpt', executor.binary('ffmpeg'),
                ['-nostdin', '-hide_banner', '-v', 'error', '-n', '-protocol_whitelist', protocols,
                 '-ss', f'{relative_start:.6f}', '-f', 'mov', '-i', source, '-t', f'{duration:.6f}',
                 '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', 'fps=30', '-c:v', 'libx264',
                 '-preset', 'fast', '-crf', '19', '-threads', '2', '-pix_fmt', 'yuv420p',
                 '-fs', str(MAX_CLIP_BYTES), '-movflags', '+faststart', str(stage)],
                cwd=target.parent, cancelled=cancelled, timeout=120)
            executor.require_success(receipt)
            _check(cancelled, require)
            if not stage.is_file() or not 0 < stage.stat().st_size <= MAX_CLIP_BYTES:
                raise ValueError('El fragmento no se recibió completo dentro del límite.')
            info = self._probe(stage, executor, cancelled)
            stream = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), None)
            actual = float(info.get('format', {}).get('duration', 0))
            if (not stream or not math.isfinite(actual) or abs(actual - duration) > .15 or
                    not 0 < stream.get('width', 0) <= 3840 or not 0 < stream.get('height', 0) <= 2160):
                raise ValueError('El fragmento no coincide con la duración o imagen solicitadas.')
            _check(cancelled, require)
            self._publish(stage, target)
            return {'id': asset_id, 'kind': 'video', 'title': row['title'], 'path': str(target), 'credit': row['credit'],
                    'license': row['license'], 'license_url': row['license_url'],
                    'source_page': row['source_page'], 'license_source': row['license_source'],
                    'source_start': start, 'duration': actual, 'reused': provenance != 'official_https_excerpt',
                    'provenance': provenance, 'original_audio': False, 'bytes': target.stat().st_size,
                    'changes': 'Fragmento recortado y sin audio original.'}
        finally:
            if stage.exists():
                stage.unlink()

    def _download_music(self, row, stage, cancelled, require):
        url = _official(row['source'], 'music')
        deadline = time.monotonic() + 90
        with self.opener.open(Request(url, headers={'User-Agent': 'Brivany/1.0'}), timeout=20) as response:
            _official(response.geturl(), 'music')
            size = response.headers.get('Content-Length')
            if size and (not size.isdecimal() or int(size) > MAX_MUSIC_BYTES):
                raise ValueError('La música supera el límite de descarga.')
            media_type = response.headers.get('Content-Type', '').split(';')[0].strip().lower()
            if media_type and media_type not in {'audio/mpeg', 'audio/mp3', 'application/octet-stream'}:
                raise ValueError('La fuente no devolvió un archivo de música.')
            total = 0
            with stage.open('xb') as output:
                while True:
                    _check(cancelled, require)
                    if time.monotonic() > deadline:
                        raise ValueError('La descarga de música excedió su tiempo máximo.')
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_MUSIC_BYTES:
                        raise ValueError('La música supera el límite de descarga.')
                    output.write(chunk)
        if total < 128:
            raise ValueError('El archivo de música llegó incompleto.')

    def fetch_music(self, asset_id, destination, *, executor, cancelled, require=lambda: None):
        _check(cancelled, require)
        if not isinstance(asset_id, str) or asset_id not in MUSIC:
            raise ValueError('Selecciona una pista del catálogo observado.')
        target = self._target(destination, '.mp3')
        self._history()  # Fail before producing output if persistent state is invalid.
        row = MUSIC[asset_id]
        stage = target.parent/('.media-'+uuid4().hex+'.mp3')
        cache_dir = scoped(self.root/'.media-cache', [self.root])
        cache_dir.mkdir(exist_ok=True)
        cache = scoped(cache_dir/(asset_id+'.mp3'), [self.root])
        candidate = cache if cache.exists() else MUSIC_CACHES.get(asset_id)
        provenance = 'official_https_download'
        try:
            if candidate is not None and candidate.is_file():
                source = _local_file(candidate)
                if not 128 <= source.stat().st_size <= MAX_MUSIC_BYTES:
                    raise ValueError('La copia musical no tiene un tamaño admitido.')
                with source.open('rb') as src, stage.open('xb') as dst:
                    shutil.copyfileobj(src, dst, 65536)
                provenance = 'media_cache' if candidate == cache else 'existing_project_music'
            else:
                self._download_music(row, stage, cancelled, require)
            _check(cancelled, require)
            info = self._probe(stage, executor, cancelled)
            duration = float(info.get('format', {}).get('duration', 0))
            if not any(s.get('codec_type') == 'audio' for s in info.get('streams', [])) or not math.isfinite(duration) or not 0 < duration <= 1800:
                raise ValueError('No se pudo comprobar una pista de música válida.')
            if not cache.exists():
                temporary = cache_dir/('.cache-'+uuid4().hex+'.mp3')
                try:
                    with stage.open('rb') as src, temporary.open('xb') as dst:
                        shutil.copyfileobj(src, dst, 65536)
                    try:
                        os.link(temporary, cache)
                    except FileExistsError:
                        pass
                finally:
                    if temporary.exists():
                        temporary.unlink()
            _check(cancelled, require)
            self._publish(stage, target)
            self._record_music(asset_id)
            with target.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            return {'id': asset_id, 'kind': 'music', 'title': row['title'], 'path': str(target), 'credit': row['credit'],
                    'license': row['license'], 'license_url': row['license_url'],
                    'source_page': row['source_page'], 'source_start': 0, 'duration': duration,
                    'reused': provenance != 'official_https_download', 'provenance': provenance,
                    'bytes': target.stat().st_size,
                    'sha256': digest}
        finally:
            if stage.exists():
                stage.unlink()
