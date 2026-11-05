"""Read-only capture-to-VGGT request preparation, with explicit reviewed views.

No journal, reservation, cloud client, directory or output is created. Callers
must separately reserve funds and authorize any eventual remote execution.
"""
from io import BytesIO
import hashlib
from pathlib import Path
import re
from uuid import UUID,uuid5,NAMESPACE_URL

from contracts.spatial import CaptureManifest
from services.spatial.capture import jpeg_size
from workers.spatial_room import canonical,parameters,read_room_lock,readiness,validate_room_request,fail


class RoomPreparationService:
    def __init__(self,spatial):
        self.spatial=spatial;self.root=Path(spatial.root).absolute()
        if self.root.resolve()!=self.root:fail('room_storage','El almacenamiento de captura no puede redirigirse.')

    def prepare(self,capture_id,payload,*,reserved_usd=None,lock=None):
        """Return private request bytes and a separate public preflight document.

        The request is returned only if a caller supplies its actual reservation
        amount. Merely preparing the preflight neither reserves nor spends it.
        """
        required={'expected_source_sha256','frame_ids','reviewed'}
        if not isinstance(payload,dict) or not required<=set(payload) or set(payload)-required-{'parameters','seed','timeout_seconds'}:
            fail('room_input','Confirma captura, vistas revisadas y parámetros.')
        try:
            if str(UUID(capture_id))!=capture_id:raise ValueError()
            if payload['reviewed'] is not True or not re.fullmatch('[a-f0-9]{64}',payload['expected_source_sha256']):raise ValueError()
            ids=payload['frame_ids']
            if not isinstance(ids,list) or not 2<=len(ids)<=8 or len(set(ids))!=len(ids) or any(not isinstance(value,str) or not re.fullmatch('frame-[0-9]{4}',value) for value in ids):raise ValueError()
            manifest_path=self.spatial._owned('captures',capture_id,'capture.json')
            if not manifest_path.is_file() or manifest_path.stat().st_size>65536:raise ValueError()
            manifest=CaptureManifest.model_validate_json(manifest_path.read_bytes())
            if str(manifest.capture_id)!=capture_id or manifest.source.sha256!=payload['expected_source_sha256']:raise ValueError()
            available={frame.id:frame for frame in manifest.frames}
            selected=[available[value] for value in ids]
            if any(after.at_seconds<=before.at_seconds for before,after in zip(selected,selected[1:])):raise ValueError()
        except (ValueError,TypeError,KeyError,AttributeError,OSError):fail('room_source','La captura o selección de vistas cambió; revisa sus hashes y orden.')
        frames=[]
        from PIL import Image
        for frame in selected:
            path=self.spatial._owned('captures',capture_id,*frame.relative_path.split('/'))
            if not path.is_file() or path.stat().st_size>2*1024*1024:fail('room_source','Una vista no está disponible dentro de límites.')
            raw=path.read_bytes()
            if hashlib.sha256(raw).hexdigest()!=frame.sha256 or jpeg_size(raw)!=(frame.width,frame.height):fail('room_source','Una vista cambió respecto a su manifiesto.')
            with Image.open(BytesIO(raw)) as image:
                output=BytesIO();image.convert('RGB').save(output,format='PNG');png=output.getvalue()
            frames.append({'id':frame.id,'at_seconds':frame.at_seconds,'source_frame_sha256':frame.sha256,
                'image_sha256':hashlib.sha256(png).hexdigest(),'image_png':png})
        configured=read_room_lock() if lock is None else lock
        params=parameters(payload.get('parameters'));seed=payload.get('seed',0);timeout=payload.get('timeout_seconds',180)
        identity={'pipeline':configured['pipeline_version'],'lock_sha256':hashlib.sha256(canonical(configured)).hexdigest(),
            'capture_id':capture_id,'source_sha256':manifest.source.sha256,'frames':[{key:value for key,value in frame.items() if key!='image_png'} for frame in frames],
            'parameters':params,'seed':seed,'timeout_seconds':timeout}
        identity_sha=hashlib.sha256(canonical(identity)).hexdigest();job_id=str(uuid5(NAMESPACE_URL,'brivany:room:'+identity_sha))
        # A positive placeholder is used only for structural validation, never
        # returned as a reservation or described as a cost/budget assertion.
        request={'schema_version':'0.1.0','job_id':job_id,'capture_id':capture_id,'source_sha256':manifest.source.sha256,
            'frames':frames,'reviewed':True,'parameters':params,'seed':seed,'timeout_seconds':timeout,
            'reserved_usd':1 if reserved_usd is None else reserved_usd}
        validate_room_request(request)
        state=readiness(configured)
        public={'schema_version':'0.1.0','status':'prepared_not_reconstructed','job_id':job_id,'identity_sha256':identity_sha,
            'capture_id':capture_id,'source_sha256':manifest.source.sha256,'frames':identity['frames'],'parameters':params,
            'seed':seed,'timeout_seconds':timeout,'reviewed':True,'configuration_ready':not state['pending'],'pending':state['pending'],
            'reservation_created':False,'provider_invoked':False,'external_calls':0,'gpu_seconds':0,
            'metric_scale_verified':False,'scene_coverage_verified':False,'timestamp_scope':'requested_capture_seek_positions',
            'limitations':['Selected views do not establish camera overlap or full room coverage.','No walls, floorplan, scale or physics have been reconstructed.']}
        return {'preflight':public,'request':None if reserved_usd is None else request}
