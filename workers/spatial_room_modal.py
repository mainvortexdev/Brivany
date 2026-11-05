"""Explicit guarded declaration of a VGGT room function; no deployment on import."""
from __future__ import annotations
import hashlib
import importlib.metadata
import re

from workers.spatial_room import ROOT,canonical,execute,read_room_lock,readiness,fail


def function_options(lock):
    options=lock.get('modal',{})
    required={'min_containers':0,'max_containers':1,'buffer_containers':0,'retries':0,
        'timeout_seconds':180,'startup_timeout_seconds':600,'scaledown_window_seconds':2}
    if any(type(options.get(key)) is not int or options[key]!=value for key,value in required.items()) or options.get('gpu')!='L40S':
        fail('room_limits','El worker multivista exige L40S, un contenedor máximo y cero reintentos de aplicación.')
    return {'gpu':'L40S','min_containers':0,'max_containers':1,'buffer_containers':0,'retries':0,
        'timeout':180,'startup_timeout':600,'scaledown_window':2,'cpu':4,'memory':32768}


def create_app(*,lock=None):
    lock=read_room_lock() if lock is None else lock
    if readiness(lock)['pending']:fail('room_not_configured','Faltan acceso, pesos, licencia, imagen validada o presupuesto para declarar Modal.')
    options=function_options(lock)
    if importlib.metadata.version('modal')!=lock['modal']['sdk_version']:fail('room_sdk','El SDK Modal no coincide con el lock.')
    import modal
    runtime=lock['runtime'];digest=runtime['base_image_digest']
    if not re.fullmatch('sha256:[a-f0-9]{64}',digest):fail('room_image','Falta la imagen inmutable validada.')
    # The immutable image must already contain the clean upstream checkout,
    # torch/CUDA/safetensors/Pillow/numpy and all locked dependencies. This code
    # never installs dependencies or retrieves checkpoints during inference.
    image=(modal.Image.from_registry(runtime['candidate_base_image'].split('@')[0]+'@'+digest)
        .add_local_dir(ROOT/'workers',remote_path='/root/workers')
        .add_local_file(ROOT/'config/spatial-room.lock.json',remote_path='/root/config/spatial-room.lock.json'))
    weights=modal.Volume.from_name(lock['modal']['weight_volume_name'],create_if_missing=False)
    results=modal.Volume.from_name(lock['modal']['result_volume_name'],create_if_missing=False)
    app=modal.App('brivany-spatial-room')

    @app.function(image=image,volumes={'/weights':weights,'/results':results},**options)
    def reconstruct_room(request,*,expected_lock_sha256):
        configured=read_room_lock()
        if not isinstance(expected_lock_sha256,str) or expected_lock_sha256!=hashlib.sha256(canonical(configured)).hexdigest():
            fail('room_lock_mismatch','El despliegue multivista no coincide con el trabajo autorizado.')
        value=execute(request,'/results/room-cache',configured['runtime']['weights_root'],lock=configured)
        results.commit();return value

    return app,reconstruct_room


if __name__=='__main__':
    import json
    print(json.dumps(readiness(),ensure_ascii=False,indent=2))
