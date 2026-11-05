"""Private local image references, with no inference, upload or reconstruction.

Original bytes are retained unchanged. A bounded JPEG derivative strips embedded
metadata and applies a declared EXIF orientation, without verifying that the
orientation, camera, overlap or geometry is correct.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Literal
from uuid import UUID, uuid4
import warnings

from pydantic import BaseModel, ConfigDict, Field, StrictInt, ValidationError, field_validator, model_validator


MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 60 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_DIMENSION = 12_000
MAX_EDGE = 1280
MAX_DERIVED_BYTES = 2 * 1024 * 1024
MAX_MANIFEST_BYTES = 128 * 1024
MIME = {'PNG': 'image/png', 'JPEG': 'image/jpeg'}
EXTENSION = {'image/png': 'png', 'image/jpeg': 'jpg'}


class ReferenceSetError(ValueError):
    def __init__(self, code, message, status=422):
        self.code, self.status = code, status
        super().__init__(message)


def _hash(raw):
    return hashlib.sha256(raw).hexdigest()


def _uuid(value):
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise ValueError('canonical UUID required')
    return value


def _label(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 120 or any(ord(c) < 32 for c in value):
        raise ValueError('invalid label')
    return value.strip()


class _Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Derivative(_Strict):
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    size_bytes: StrictInt = Field(gt=0, le=MAX_DERIVED_BYTES)
    width: StrictInt = Field(ge=1, le=MAX_EDGE)
    height: StrictInt = Field(ge=1, le=MAX_EDGE)
    mime_type: Literal['image/jpeg']
    relative_path: str


class ReferenceFrame(_Strict):
    id: str = Field(pattern=r'^frame-00(?:0[0-9]|1[01])$')
    order: StrictInt = Field(ge=0, le=11)
    label: str
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    size_bytes: StrictInt = Field(gt=0, le=MAX_IMAGE_BYTES)
    width: StrictInt = Field(ge=1, le=MAX_DIMENSION)
    height: StrictInt = Field(ge=1, le=MAX_DIMENSION)
    mime_type: Literal['image/png', 'image/jpeg']
    relative_path: str
    embedded_exif_orientation: StrictInt | None = Field(default=None, ge=1, le=8)
    thumbnail: Derivative
    model_input: Derivative

    @model_validator(mode='after')
    def consistent(self):
        if (self.id != f'frame-{self.order:04d}' or self.label != f'Vista {self.order + 1}' or
                self.relative_path != f'originals/{self.id}.{EXTENSION[self.mime_type]}' or
                self.width * self.height > MAX_PIXELS or
                self.thumbnail.relative_path != f'derived/{self.id}.jpg' or
                self.thumbnail != self.model_input):
            raise ValueError('inconsistent frame descriptor')
        expected = (self.height, self.width) if self.embedded_exif_orientation in {5, 6, 7, 8} else (self.width, self.height)
        if (self.thumbnail.width > expected[0] or self.thumbnail.height > expected[1] or
                abs(self.thumbnail.width * expected[1] - self.thumbnail.height * expected[0]) > max(expected)):
            raise ValueError('inconsistent derivative dimensions')
        return self


def _preflight(frames):
    hashes, dimensions, aspects = {}, {}, {}
    for frame in frames:
        hashes.setdefault(frame.sha256, []).append(frame.id)
        dimensions.setdefault((frame.width, frame.height), []).append(frame.id)
        divisor = math.gcd(frame.width, frame.height)
        aspects.setdefault((frame.width // divisor, frame.height // divisor), []).append(frame.id)
    duplicates = [ids for ids in hashes.values() if len(ids) > 1]
    same_dimensions = len(dimensions) == 1
    same_aspect = len(aspects) == 1
    flags = ['orientation_and_mirroring_need_review', 'multi_view_consistency_unverified']
    if duplicates: flags.append('exact_duplicate_images')
    if same_dimensions: flags.append('shared_dimensions_do_not_prove_overlap')
    if same_aspect: flags.append('shared_aspect_ratio_does_not_prove_common_camera')
    return {
        'status': 'prepared_not_reconstructed', 'ready_remote': False,
        'exact_duplicate_groups': duplicates,
        'all_same_dimensions': same_dimensions, 'all_same_aspect_ratio': same_aspect,
        'review_flags': flags,
        'capture_timestamps': 'unknown', 'camera_intrinsics': 'unknown',
        'camera_extrinsics': 'unknown', 'calibration': 'unknown', 'metric_scale': 'unknown',
        'human_review': {key: 'pending' for key in ('orientation', 'mirroring', 'view_consistency', 'overlap', 'coverage')},
        'renderer': {'status': 'not_built', 'shadows_verified': False},
        'reconstruction': {'status': 'not_executed', 'geometry_verified': False, 'model_executed': False},
        'physics': {'status': 'not_prepared', 'metric_scale_verified': False,
                    'mass': 'unknown', 'friction': 'unknown', 'colliders': 'not_built'},
    }


def _package(frames):
    return {
        'kind': 'multi_view_reference_set', 'format': 'local_directory_manifest',
        'ordered_frame_ids': [frame.id for frame in frames],
        'input_mime_type': 'image/jpeg', 'max_input_edge': MAX_EDGE,
        'candidate_tasks': ['multi_view_camera_and_geometry_estimation', 'reviewed_object_reconstruction'],
        'dispatch_enabled': False, 'model_executed': False,
        'missing': ['human_multi_view_review', 'model_specific_input_adapter',
                    'verified_model_access_and_runtime', 'explicit_compute_budget'],
    }


class ReferenceManifest(_Strict):
    schema_version: Literal['brivany.reference-set.v1']
    id: str
    title: str
    created_at: str
    origin: Literal['user_provided_images']
    private: Literal[True]
    original_bytes_preserved: Literal[True]
    embedded_metadata_in_derivatives: Literal[False]
    frames: list[ReferenceFrame] = Field(min_length=2, max_length=12)
    preflight: dict[str, Any]
    package: dict[str, Any]

    _id_valid = field_validator('id')(_uuid)
    _title_valid = field_validator('title')(_label)

    @model_validator(mode='after')
    def consistent(self):
        moment = datetime.fromisoformat(self.created_at)
        if (moment.tzinfo is None or [frame.order for frame in self.frames] != list(range(len(self.frames))) or
                sum(frame.size_bytes for frame in self.frames) > MAX_TOTAL_BYTES or
                self.preflight != _preflight(self.frames) or self.package != _package(self.frames)):
            raise ValueError('inconsistent reference manifest')
        return self


def _decoder():
    try:
        from PIL import Image, ImageOps
        return Image, ImageOps
    except ImportError:
        raise ReferenceSetError('image_decoder_unavailable', 'Falta Pillow para validar y preparar imágenes localmente.', 503) from None


def _decode(raw, *, derivative=False):
    Image, ImageOps = _decoder()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as probe:
                image_format = probe.format
                width, height = probe.size
                if (image_format not in MIME or not 1 <= width <= MAX_DIMENSION or not 1 <= height <= MAX_DIMENSION or
                        width * height > MAX_PIXELS or getattr(probe, 'n_frames', 1) != 1):
                    raise ValueError()
                probe.verify()
            with Image.open(BytesIO(raw)) as image:
                image.load()  # Reject truncated pixels, not just valid-looking headers.
                orientation = image.getexif().get(274)
                orientation = orientation if type(orientation) is int and 1 <= orientation <= 8 else None
                if not derivative:
                    return {'width': width, 'height': height, 'mime_type': MIME[image_format],
                            'embedded_exif_orientation': orientation}, None
                normalized = ImageOps.exif_transpose(image)
                if normalized.mode in {'RGBA', 'LA'} or (normalized.mode == 'P' and 'transparency' in normalized.info):
                    foreground = normalized.convert('RGBA')
                    rgb = Image.new('RGB', foreground.size, (255, 255, 255))
                    rgb.paste(foreground, mask=foreground.getchannel('A'))
                else:
                    rgb = normalized.convert('RGB')
                rgb.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
                encoded = BytesIO()
                rgb.save(encoded, format='JPEG', quality=90, optimize=False, progressive=False)
                output = encoded.getvalue()
                if len(output) > MAX_DERIVED_BYTES:
                    raise ValueError()
                return {'width': width, 'height': height, 'mime_type': MIME[image_format],
                        'embedded_exif_orientation': orientation}, (output, rgb.width, rgb.height)
    except ReferenceSetError:
        raise
    except (ValueError, OSError, SyntaxError, RuntimeError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise ReferenceSetError('invalid_image', 'La imagen no es un PNG/JPEG completo o excede los límites de resolución.') from None


def _read_file(path, limit, *, integrity=False):
    try:
        path = Path(path).absolute()
        if path.resolve() != path or not path.is_file(): raise OSError()
        before = path.stat()
        if not 0 < before.st_size <= limit: raise OSError()
        with path.open('rb') as stream:
            opened = os.fstat(stream.fileno())
            raw = stream.read(limit + 1)
            after_open = os.fstat(stream.fileno())
        after = path.stat()
        signature = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns)
        if (len(raw) != before.st_size or len(raw) > limit or path.resolve() != path or
                len({signature(item) for item in (before, opened, after_open, after)}) != 1):
            raise OSError()
        return raw
    except (OSError, ValueError, RuntimeError):
        if integrity:
            raise ReferenceSetError('reference_integrity', 'Una imagen guardada falta, cambió o supera sus límites.', 409) from None
        raise ReferenceSetError('invalid_source', 'Selecciona imágenes locales regulares, estables y de hasta 8 MiB; no se admiten enlaces.') from None


class ReferenceSetService:
    def __init__(self, root):
        self.root = Path(root).absolute()
        if self.root.resolve() != self.root:
            raise ReferenceSetError('reference_storage', 'La ruta local de referencias no es válida.', 409)
        self.base = self.root / 'reference-sets'

    def _path(self, set_id, *parts):
        try: _uuid(set_id)
        except (ValueError, TypeError, AttributeError):
            raise ReferenceSetError('reference_not_found', 'Conjunto de referencias no disponible.', 404) from None
        path = self.base.joinpath(set_id, *parts)
        if path.resolve() != path.absolute() or not path.is_relative_to(self.base):
            raise ReferenceSetError('reference_integrity', 'La ruta guardada de referencias no es válida.', 409)
        return path

    @staticmethod
    def _dto(manifest):
        result = manifest.model_dump(mode='json')
        for frame in result['frames']:
            frame.pop('relative_path')
            frame['thumbnail'].pop('relative_path')
            frame['model_input'].pop('relative_path')
        return result

    def create(self, paths, *, title='Referencia interior'):
        try:
            title = _label(title)
            if isinstance(paths, (str, bytes, Path)): raise ValueError()
            paths = list(paths)
            if not 2 <= len(paths) <= 12 or any(not isinstance(path, (str, Path)) for path in paths): raise ValueError()
        except (ValueError, TypeError):
            raise ReferenceSetError('invalid_reference_set', 'Elige entre dos y doce imágenes y un título de hasta 120 caracteres.') from None
        # No path names or embedded EXIF are copied into the public manifest.
        if self.base.resolve() != self.base:
            raise ReferenceSetError('reference_storage', 'La carpeta privada no es válida.', 409)
        self.base.mkdir(parents=True, exist_ok=True)
        set_id = str(uuid4())
        target = self._path(set_id)
        if target.exists():
            raise ReferenceSetError('reference_exists', 'Ese conjunto ya existe.', 409)
        with tempfile.TemporaryDirectory(dir=self.base, prefix='.import-') as temporary:
            staging = Path(temporary) / 'set'
            (staging / 'originals').mkdir(parents=True)
            (staging / 'derived').mkdir()
            frames, total = [], 0
            for order, path in enumerate(paths):
                source = Path(path)
                if source.suffix.lower() not in {'.png', '.jpg', '.jpeg'}:
                    raise ReferenceSetError('invalid_image', 'Sólo se admiten imágenes PNG o JPEG.')
                raw = _read_file(source, MAX_IMAGE_BYTES)
                total += len(raw)
                if total > MAX_TOTAL_BYTES:
                    raise ReferenceSetError('reference_size_limit', 'El conjunto supera 60 MiB.')
                metadata, converted = _decode(raw, derivative=True)
                frame_id = f'frame-{order:04d}'
                relative = f'originals/{frame_id}.{EXTENSION[metadata["mime_type"]]}'
                derived_path = f'derived/{frame_id}.jpg'
                output, width, height = converted
                (staging / relative).write_bytes(raw)
                (staging / derived_path).write_bytes(output)
                derivative = Derivative(sha256=_hash(output), size_bytes=len(output), width=width, height=height,
                                        mime_type='image/jpeg', relative_path=derived_path)
                frames.append(ReferenceFrame(id=frame_id, order=order, label=f'Vista {order + 1}',
                    sha256=_hash(raw), size_bytes=len(raw), relative_path=relative, **metadata,
                    thumbnail=derivative, model_input=derivative))
            manifest = ReferenceManifest(schema_version='brivany.reference-set.v1', id=set_id, title=title,
                created_at=datetime.now(timezone.utc).isoformat(), origin='user_provided_images', private=True,
                original_bytes_preserved=True, embedded_metadata_in_derivatives=False, frames=frames,
                preflight=_preflight(frames), package=_package(frames))
            encoded = manifest.model_dump_json(indent=2).encode('utf-8')
            if len(encoded) > MAX_MANIFEST_BYTES: raise ReferenceSetError('reference_size_limit', 'Manifiesto fuera de límites.')
            (staging / 'references.json').write_bytes(encoded)
            if target.exists(): raise ReferenceSetError('reference_exists', 'Ese conjunto ya existe.', 409)
            staging.rename(target)
        return self._dto(manifest)

    def _manifest(self, set_id):
        path = self._path(set_id, 'references.json')
        if not path.is_file():
            raise ReferenceSetError('reference_not_found', 'Conjunto de referencias no disponible.', 404)
        try:
            manifest = ReferenceManifest.model_validate_json(_read_file(path, MAX_MANIFEST_BYTES, integrity=True))
            if manifest.id != set_id: raise ValueError()
            return manifest
        except (ValidationError, ValueError, TypeError):
            raise ReferenceSetError('reference_integrity', 'El manifiesto de referencias cambió o no es válido.', 409) from None

    def _verified(self, set_id, descriptor):
        raw = _read_file(self._path(set_id, *descriptor.relative_path.split('/')),
                         MAX_IMAGE_BYTES if isinstance(descriptor, ReferenceFrame) else MAX_DERIVED_BYTES, integrity=True)
        if len(raw) != descriptor.size_bytes or _hash(raw) != descriptor.sha256:
            raise ReferenceSetError('reference_integrity', 'La imagen no coincide con su hash guardado.', 409)
        try: metadata, _ = _decode(raw)
        except ReferenceSetError:
            raise ReferenceSetError('reference_integrity', 'La imagen guardada dejó de ser válida.', 409) from None
        if any(metadata[key] != getattr(descriptor, key) for key in ('width', 'height', 'mime_type')):
            raise ReferenceSetError('reference_integrity', 'Las dimensiones guardadas no coinciden.', 409)
        return raw

    def get(self, set_id):
        manifest = self._manifest(set_id)
        for frame in manifest.frames:
            self._verified(set_id, frame)
            self._verified(set_id, frame.thumbnail)
        return self._dto(manifest)

    def image(self, set_id, image_id, *, variant='thumbnail'):
        if not isinstance(image_id, str) or not re.fullmatch(r'frame-00(?:0[0-9]|1[01])', image_id):
            raise ReferenceSetError('reference_image_not_found', 'Imagen de referencia no disponible.', 404)
        if variant not in {'original', 'thumbnail', 'model_input'}:
            raise ReferenceSetError('invalid_image_variant', 'Variante de imagen no admitida.')
        manifest = self._manifest(set_id)
        frame = next((item for item in manifest.frames if item.id == image_id), None)
        if frame is None:
            raise ReferenceSetError('reference_image_not_found', 'Imagen de referencia no disponible.', 404)
        descriptor = frame if variant == 'original' else getattr(frame, variant)
        raw = self._verified(set_id, descriptor)
        return raw, descriptor.mime_type, f'{image_id}.{EXTENSION[descriptor.mime_type]}'
