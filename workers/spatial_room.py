"""Bounded VGGT room adapter and deterministic image-supported surface export.

Importing this module needs neither torch, numpy, Modal nor authentication. Only
an explicit configured execute call can start the fixed CUDA subprocess. Arrays
from known synthetic cameras exercise geometry without pretending to reconstruct
a real room. Gaps and overlapping view surfaces are deliberately not filled.
"""
from __future__ import annotations
from copy import deepcopy
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import time
from uuid import UUID

from workers.spatial_runtime import SpatialWorkerError,validate_glb,verify_weight_tree,budget_estimate

ROOT=Path(__file__).resolve().parents[1]
LOCK_PATH=ROOT/'config/spatial-room.lock.json'
MAX_GLB=30*1024*1024
DEFAULT_PARAMETERS={'confidence_percentile':25.0,'sample_stride':4,'max_depth_ratio':1.15,
    'max_edge_length_ratio':0.15,'max_vertices':180000,'max_triangles':300000}


def fail(code,message):raise SpatialWorkerError(code,message)
def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()
def finite(value):return type(value) in (int,float) and math.isfinite(value)


def read_room_lock(path=None):
    path=Path(path) if path is not None else LOCK_PATH
    try:
        if not path.is_file() or path.resolve()!=path.absolute() or path.stat().st_size>65536:raise ValueError()
        value=json.loads(path.read_text(encoding='utf-8'))
        if value.get('schema_version')!='0.1.0' or not re.fullmatch('[a-z0-9._-]{1,80}',value['pipeline_version']):raise ValueError()
        if value['model']['checkpoint_repository']!='facebook/VGGT-1B-Commercial':raise ValueError()
        if value['model']['input_resolution']!=518 or value['runtime']['checkpoint_filename']!='model.safetensors':raise ValueError()
        if not re.fullmatch('[a-f0-9]{40}',value['model']['code_revision']):raise ValueError()
        if not isinstance(value.get('source_files'),dict) or not value['source_files']:raise ValueError()
        for relative,item in value['source_files'].items():
            if relative.startswith('/') or '\\' in relative or ':' in relative or any(p in {'','.','..'} for p in relative.split('/')) or not re.fullmatch('[a-f0-9]{64}',item['sha256']):raise ValueError()
        return value
    except (OSError,ValueError,TypeError,KeyError,AttributeError):fail('room_lock','El lock multivista no es válido.')


def readiness(lock=None):
    lock=read_room_lock() if lock is None else deepcopy(lock)
    runtime,model,budget=lock.get('runtime',{}),lock.get('model',{}),lock.get('budget',{})
    pending=[]
    for field in ('remote_dispatch_enabled','deployment_verified'):
        if lock.get(field) is not True:pending.append(field+'_pending')
    for field in ('dependency_lock_complete','build_verified','cuda_compatibility_verified'):
        if runtime.get(field) is not True:pending.append(field+'_pending')
    if not re.fullmatch('sha256:[a-f0-9]{64}',str(runtime.get('base_image_digest',''))):pending.append('base_image_digest_pending')
    if not re.fullmatch('[a-f0-9]{40}',str(model.get('checkpoint_revision',''))):pending.append('checkpoint_revision_pending')
    for field in ('checkpoint_hashes_verified','license_reviewed_by_user','access_granted_by_provider'):
        if model.get(field) is not True:pending.append(field+'_pending')
    manifest=runtime.get('checkpoint_manifest',[])
    if not manifest or not any(item.get('path')=='model.safetensors' for item in manifest):pending.append('checkpoint_manifest_pending')
    if model.get('checkpoint_repository')!='facebook/VGGT-1B-Commercial':pending.append('commercial_checkpoint_required')
    if any(not finite(budget.get(field)) or budget[field]<=0 for field in ('approved_per_job_usd','approved_total_usd','gpu_rate_usd_per_second','non_gpu_reserve_per_job_usd')):pending.append('monetary_budget_pending')
    return {'status':'prepared_not_deployed' if pending else 'configured_not_execution_verified',
        'pending':pending,'remote_dispatch_enabled':not pending,'pipeline_version':lock.get('pipeline_version'),
        'gpu_execution_verified':False,'metric_scale_verified':False,'external_calls':0,'gpu_seconds':0}


def parameters(value=None):
    value={} if value is None else value
    if not isinstance(value,dict) or set(value)-set(DEFAULT_PARAMETERS):fail('room_parameters','Parámetros multivista desconocidos.')
    result={**DEFAULT_PARAMETERS,**value}
    if (not finite(result['confidence_percentile']) or not 0<=result['confidence_percentile']<=90 or
        type(result['sample_stride']) is not int or not 1<=result['sample_stride']<=16 or
        not finite(result['max_depth_ratio']) or not 1.001<=result['max_depth_ratio']<=2 or
        not finite(result['max_edge_length_ratio']) or not .001<=result['max_edge_length_ratio']<=.5 or
        type(result['max_vertices']) is not int or not 3<=result['max_vertices']<=180000 or
        type(result['max_triangles']) is not int or not 1<=result['max_triangles']<=300000):
        fail('room_parameters','Los límites de geometría no son válidos.')
    return result


def validate_room_request(request):
    required={'schema_version','job_id','capture_id','source_sha256','frames','reviewed','parameters','seed','timeout_seconds','reserved_usd'}
    try:
        if not isinstance(request,dict) or set(request)!=required or request['schema_version']!='0.1.0':raise ValueError()
        for name in ('job_id','capture_id'):
            if not isinstance(request[name],str) or str(UUID(request[name]))!=request[name]:raise ValueError()
        if not isinstance(request['source_sha256'],str) or not re.fullmatch('[a-f0-9]{64}',request['source_sha256']):raise ValueError()
        if request['reviewed'] is not True or type(request['seed']) is not int or not 0<=request['seed']<=2147483647:raise ValueError()
        if type(request['timeout_seconds']) is not int or not 1<=request['timeout_seconds']<=180 or not finite(request['reserved_usd']) or request['reserved_usd']<=0:raise ValueError()
        frames=request['frames']
        if not isinstance(frames,list) or not 2<=len(frames)<=8:raise ValueError()
        seen=set();seen_hashes=set();seen_images=set();previous=-1;total=0
        from PIL import Image
        for frame in frames:
            if not isinstance(frame,dict) or set(frame)!={'id','at_seconds','source_frame_sha256','image_sha256','image_png'}:raise ValueError()
            if not re.fullmatch('frame-[0-9]{4}',frame['id']) or frame['id'] in seen:raise ValueError()
            if not finite(frame['at_seconds']) or not previous<frame['at_seconds']<=60:raise ValueError()
            for name in ('source_frame_sha256','image_sha256'):
                if not isinstance(frame[name],str) or not re.fullmatch('[a-f0-9]{64}',frame[name]):raise ValueError()
            raw=frame['image_png'];total+=len(raw) if isinstance(raw,bytes) else 0
            if not isinstance(raw,bytes) or not 33<=len(raw)<=8*1024*1024 or digest(raw)!=frame['image_sha256'] or raw[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError()
            if frame['source_frame_sha256'] in seen_hashes or frame['image_sha256'] in seen_images:raise ValueError()
            with Image.open(BytesIO(raw)) as image:
                if image.format!='PNG' or not 2<=min(image.size) or max(image.size)>1280:raise ValueError()
                image.verify()
            seen.add(frame['id']);seen_hashes.add(frame['source_frame_sha256']);seen_images.add(frame['image_sha256']);previous=frame['at_seconds']
        if total>32*1024*1024:raise ValueError()
        parameters(request['parameters'])
        return {key:request[key] for key in ('job_id','capture_id','source_sha256')}
    except (ValueError,TypeError,KeyError,AttributeError,OSError):
        fail('room_input','Revisa de dos a ocho vistas diferentes, sus hashes, tiempos, límites y autorización.')


def cache_key(request,lock):
    validate_room_request(request)
    return digest(canonical({'pipeline':lock['pipeline_version'],'model':lock['model'],
        'source_files':lock['source_files'],'weights':lock['runtime']['checkpoint_manifest'],
        'image_digest':lock['runtime']['base_image_digest'],'source_sha256':request['source_sha256'],
        'frames':[{key:frame[key] for key in ('id','at_seconds','source_frame_sha256','image_sha256')} for frame in request['frames']],
        'parameters':parameters(request['parameters']),'seed':request['seed']}))


def _arrays(predictions):
    import numpy as np
    try:
        depth=np.asarray(predictions['depth'],dtype=np.float64)
        if depth.ndim==4 and depth.shape[-1]==1:depth=depth[...,0]
        conf=np.asarray(predictions['depth_conf'],dtype=np.float64)
        intrinsic=np.asarray(predictions['intrinsic'],dtype=np.float64);extrinsic=np.asarray(predictions['extrinsic'],dtype=np.float64)
        images=np.asarray(predictions['images'])
        if depth.ndim!=3:raise ValueError()
        frames,height,width=depth.shape
        if not 2<=frames<=8 or not 2<=height<=518 or not 2<=width<=518 or conf.shape!=depth.shape or intrinsic.shape!=(frames,3,3) or extrinsic.shape!=(frames,3,4) or images.shape!=(frames,height,width,3) or images.dtype!=np.uint8:raise ValueError()
        if not np.isfinite(intrinsic).all() or not np.isfinite(extrinsic).all():raise ValueError()
        if not np.allclose(intrinsic[:,2,:],[0,0,1],atol=1e-6) or not np.allclose(intrinsic[:,0,1],0,atol=1e-6) or not np.allclose(intrinsic[:,1,0],0,atol=1e-6) or (intrinsic[:,[0,1],[0,1]]<=0).any():raise ValueError()
        rotation=extrinsic[:,:,:3]
        if not np.allclose(rotation@rotation.transpose(0,2,1),np.eye(3),atol=1e-3) or not np.allclose(np.linalg.det(rotation),1,atol=1e-3):raise ValueError()
        bounds=np.asarray(predictions.get('image_bounds',[[0,0,width,height]]*frames),dtype=np.float64)
        if bounds.shape!=(frames,4) or not np.isfinite(bounds).all() or (bounds[:,0:2]<0).any() or (bounds[:,2]>width).any() or (bounds[:,3]>height).any() or (bounds[:,2:]<=bounds[:,:2]).any():raise ValueError()
        return depth,conf,intrinsic,extrinsic,images,bounds
    except (ValueError,KeyError,TypeError):fail('room_prediction','Las salidas de cámaras y profundidad no cumplen el contrato VGGT.')


def backproject(depth,intrinsic,extrinsic):
    """OpenCV camera-from-world -> viewer basis, without scale normalization."""
    import numpy as np
    height,width=depth.shape;u,v=np.meshgrid(np.arange(width),np.arange(height))
    camera=np.stack(((u-intrinsic[0,2])*depth/intrinsic[0,0],(v-intrinsic[1,2])*depth/intrinsic[1,1],depth),axis=-1)
    world=(camera-extrinsic[:,3])@extrinsic[:,:3]
    return world*np.array([1,-1,-1])


def _glb(positions,normals,colors,indices,metadata):
    import numpy as np
    binary=bytearray();views=[];accessors=[]
    def add(array,component,kind,target,normalized=False,bounds=False):
        raw=array.tobytes();offset=len(binary);binary.extend(raw);binary.extend(b'\0'*((-len(binary))%4))
        views.append({'buffer':0,'byteOffset':offset,'byteLength':len(raw),'target':target})
        entry={'bufferView':len(views)-1,'componentType':component,'count':len(array),'type':kind}
        if normalized:entry['normalized']=True
        if bounds:entry.update(min=array.min(axis=0).astype(float).tolist(),max=array.max(axis=0).astype(float).tolist())
        accessors.append(entry);return len(accessors)-1
    p=add(np.asarray(positions,dtype='<f4'),5126,'VEC3',34962,bounds=True)
    n=add(np.asarray(normals,dtype='<f4'),5126,'VEC3',34962)
    # Images are sRGB while glTF COLOR_0 uses a linear transfer function.
    # UNORM16 preserves dark source tones through that conversion; RGBA's
    # eight-byte elements also meet glTF's four-byte vertex alignment rule.
    srgb=np.asarray(colors,dtype=np.float64)/255.
    linear=np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)
    rgb16=np.rint(linear*65535).astype('<u2')
    rgba=np.column_stack((rgb16,np.full(len(colors),65535,dtype='<u2')))
    c=add(np.asarray(rgba,dtype='<u2'),5123,'VEC4',34962,normalized=True)
    i=add(np.asarray(indices.reshape(-1),dtype='<u4'),5125,'SCALAR',34963)
    document={'asset':{'version':'2.0','generator':'Brivany image-supported VGGT surface'},
        'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors,
        'materials':[{'name':'Image colors with captured lighting','doubleSided':True,'pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':1}}],
        'meshes':[{'name':'Partial multiview surface','primitives':[{'attributes':{'POSITION':p,'NORMAL':n,'COLOR_0':c},'indices':i,'mode':4,'material':0}]}],
        'nodes':[{'mesh':0}],'scenes':[{'nodes':[0]}],'scene':0,
        'extras':{'brivany':{'format':'brivany-room-surface-1','units':'source_relative','metric_scale_verified':False,
            'scene_coverage_verified':False,'geometry_fidelity_verified':False,'physical_realism_verified':False,
            'coordinate_transform_opencv_world_to_viewer':[1,-1,-1],'vertex_count':metadata['vertex_count'],'triangle_count':metadata['triangle_count'],
            'vertex_color_transfer':'linear','source_color_transfer':'srgb','vertex_color_encoding':'rgba-unorm16'}}}
    encoded=canonical(document);encoded+=b' '*((-len(encoded))%4)
    total=12+8+len(encoded)+8+len(binary)
    if total>MAX_GLB:fail('room_output_limit','La superficie excede el límite GLB del visor.')
    return struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+bytes(binary)


def build_surface(predictions,options=None,frames=None):
    """Triangulate adjacent samples within each view, never across gaps/views.

    Confidence filtering and depth discontinuity rejection are heuristic. They
    expose omissions and do not certify that remaining inferred depths are true.
    """
    import numpy as np
    options=parameters(options);depth,conf,intrinsics,extrinsics,images,bounds=_arrays(predictions)
    count,height,width=depth.shape
    if frames is None:frames=[{'id':f'frame-{index:04}','at_seconds':float(index)} for index in range(count)]
    if len(frames)!=count:fail('room_prediction','Las cámaras no corresponden a las vistas de origen.')
    stride=options['sample_stride']
    while count*math.ceil(height/stride)*math.ceil(width/stride)>options['max_vertices'] or count*2*(math.ceil(height/stride)-1)*(math.ceil(width/stride)-1)>options['max_triangles']:
        stride+=1
        if stride>=max(height,width):fail('room_geometry_limit','Los límites no permiten conservar ninguna superficie.')
    all_positions=[];all_colors=[];all_faces=[];frame_reports=[];cameras=[];offset=0
    for index in range(count):
        rows=np.arange(0,height,stride);cols=np.arange(0,width,stride);u,v=np.meshgrid(cols,rows)
        d=depth[index][np.ix_(rows,cols)];score=conf[index][np.ix_(rows,cols)];left,top,right,bottom=bounds[index]
        inside=(u>=left)&(u<right)&(v>=top)&(v<bottom)
        valid=inside&np.isfinite(d)&(d>1e-8)&(d<1e6)&np.isfinite(score)&(score>0)
        threshold=float(np.percentile(score[valid],options['confidence_percentile'])) if valid.any() else None
        retained=valid&(score>=threshold) if threshold is not None else valid
        # Sanitize rejected depths before matrix arithmetic; they never become vertices.
        clean=np.where(np.isfinite(depth[index]),depth[index],0)
        world=backproject(clean,intrinsics[index],extrinsics[index])[np.ix_(rows,cols)]
        grid=np.arange(d.size).reshape(d.shape)
        if min(d.shape)<2:fail('room_geometry_limit','El muestreo dejó menos de dos filas o columnas.')
        a,b,c,e=grid[:-1,:-1],grid[:-1,1:],grid[1:,:-1],grid[1:,1:]
        faces=np.concatenate((np.stack((a,c,b),axis=-1).reshape(-1,3),np.stack((b,c,e),axis=-1).reshape(-1,3)))
        initial=len(faces);mask=retained.reshape(-1)[faces].all(axis=1)
        faces=faces[mask];candidate=len(faces)
        if len(faces):
            face_depth=d.reshape(-1)[faces]
            continuity=face_depth.max(axis=1)/face_depth.min(axis=1)<=options['max_depth_ratio']
            xyz=world.reshape(-1,3)[faces]
            edge=np.stack((np.linalg.norm(xyz[:,0]-xyz[:,1],axis=1),np.linalg.norm(xyz[:,1]-xyz[:,2],axis=1),np.linalg.norm(xyz[:,2]-xyz[:,0],axis=1)),axis=1).max(axis=1)
            max_edge=float(np.median(d[retained]))*options['max_edge_length_ratio']
            area=np.linalg.norm(np.cross(xyz[:,1]-xyz[:,0],xyz[:,2]-xyz[:,0]),axis=1)
            faces=faces[continuity&(edge<=max_edge)&(area>1e-12)]
        if len(faces):
            used=np.unique(faces);mapping=np.full(d.size,-1,dtype=np.int64);mapping[used]=np.arange(len(used))
            positions=world.reshape(-1,3)[used];colors=images[index][np.ix_(rows,cols)].reshape(-1,3)[used]
            all_positions.append(positions);all_colors.append(colors);all_faces.append(mapping[faces]+offset);offset+=len(used)
        rotation=extrinsics[index,:,:3];translation=extrinsics[index,:,3]
        c2v=np.eye(4);c2v[:3,:3]=np.diag([1,-1,-1])@rotation.T;c2v[:3,3]=np.diag([1,-1,-1])@(-rotation.T@translation)
        cameras.append({'frame_id':frames[index]['id'],'at_seconds':frames[index]['at_seconds'],
            'intrinsic':intrinsics[index].tolist(),'world_to_camera_opencv':extrinsics[index].tolist(),
            'camera_to_viewer':c2v.tolist(),'image_bounds':bounds[index].tolist()})
        frame_reports.append({'frame_id':frames[index]['id'],'sampled_image_pixels':int(inside.sum()),
            'invalid_depth_or_confidence_pixels':int((inside&~valid).sum()),'low_confidence_pixels':int((valid&~retained).sum()),
            'confidence_score_threshold':threshold,'candidate_triangles':initial,'triangles_rejected_missing_samples':initial-candidate,
            'triangles_rejected_discontinuity_or_degenerate':candidate-len(faces),'triangles_retained':len(faces)})
    if not all_faces:fail('room_empty_surface','No hay superficie continua suficiente después de excluir zonas inciertas.')
    positions=np.concatenate(all_positions);colors=np.concatenate(all_colors);faces=np.concatenate(all_faces)
    if not np.isfinite(positions).all() or (np.abs(positions)>1e7).any():fail('room_prediction','La geometría quedó fuera de límites finitos.')
    face_normals=np.cross(positions[faces[:,1]]-positions[faces[:,0]],positions[faces[:,2]]-positions[faces[:,0]])
    normals=np.zeros_like(positions)
    for column in range(3):np.add.at(normals,faces[:,column],face_normals)
    lengths=np.linalg.norm(normals,axis=1);normals/=np.maximum(lengths[:,None],1e-12)
    metadata={'format':'brivany-room-surface-1','units':'source_relative','vertex_count':len(positions),'triangle_count':len(faces),
        'requested_stride':options['sample_stride'],'effective_stride':stride,'parameters':options,'frames':frame_reports,'cameras':cameras,
        'bounds':{'min':positions.min(axis=0).tolist(),'max':positions.max(axis=0).tolist()},
        'geometry_kind':'per_view_image_supported_depth_surface','metric_scale_verified':False,'geometry_fidelity_verified':False,
        'physical_realism_verified':False,'scene_coverage_verified':False,'camera_orientation_verified':False,
        'uncertainty':{'scope':'entire_scene','holes_filled':False,'cross_view_fusion':False,'unknown_surfaces':'unrepresented',
            'confidence_is_probability':False,'colors_include_captured_lighting':True,
            'note':'Model-inferred depth is supported by selected image pixels only; open gaps, duplicate surfaces and unseen areas remain unverified.'}}
    raw=_glb(positions,normals,colors,faces,metadata);artifact=validate_glb(raw)
    return {'artifact_bytes':raw,'artifact':artifact,'surface':metadata}


def verify_code(model_root,lock):
    model_root=Path(model_root).absolute()
    if model_root.resolve()!=model_root or not model_root.is_dir():fail('room_code','Falta el checkout VGGT fijado.')
    try:
        for arguments,expected in ((['rev-parse','HEAD'],lock['model']['code_revision']),(['status','--porcelain','--untracked-files=all'],'')):
            result=subprocess.run(['git','-C',str(model_root),*arguments],capture_output=True,timeout=5,check=True,
                creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.stdout.decode('utf-8').strip()!=expected:raise ValueError()
        for relative,item in lock['source_files'].items():
            path=model_root/relative
            if path.resolve()!=path or not path.is_file() or digest(path.read_bytes())!=item['sha256']:raise ValueError()
    except (ValueError,OSError,subprocess.SubprocessError):fail('room_code','El código VGGT no coincide con el commit limpio fijado.')


def _run(job,timeout,cancelled):
    with (job/'private-runner.log').open('wb') as log:
        process=subprocess.Popen([sys.executable,'-B','-m','workers.spatial_room','--run',str(job)],cwd=ROOT,
            stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        deadline=time.monotonic()+timeout
        while process.poll() is None:
            if cancelled() or time.monotonic()>=deadline:
                process.kill();process.wait(timeout=5);fail('room_cancelled' if cancelled() else 'room_timeout','El trabajo multivista se canceló o agotó su plazo.')
            time.sleep(.05)
        if process.returncode!=0:fail('room_inference','VGGT no produjo una superficie válida en este entorno.')


def _publish_cache(source,target):
    """Exclusive atomic directory publication without importing app services."""
    import os
    if os.name=='nt':source.rename(target);return
    import ctypes
    native=ctypes.CDLL(None,use_errno=True)
    if sys.platform.startswith('linux') and hasattr(native,'renameat2'):
        function=native.renameat2;function.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
        result=function(-100,os.fsencode(source),-100,os.fsencode(target),1)
    elif sys.platform=='darwin' and hasattr(native,'renamex_np'):
        function=native.renamex_np;function.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_uint]
        result=function(os.fsencode(source),os.fsencode(target),4)
    else:fail('room_storage','El sistema no ofrece publicación exclusiva de caché.')
    if result:fail('room_cache','La caché ya existe o no se pudo publicar exclusivamente.')


def execute(request,workspace,weights,*,lock=None,cancelled=lambda:False):
    """Prepared real worker entrypoint; the shipped lock fails before any work."""
    lock=read_room_lock() if lock is None else deepcopy(lock)
    if readiness(lock)['pending']:fail('room_not_configured','Completa acceso, pesos, licencia, imagen y presupuesto antes de ejecutar VGGT.')
    validate_room_request(request)
    if request['reserved_usd']<budget_estimate(lock,request['timeout_seconds']):fail('room_budget','La reserva no cubre la estimación configurada.')
    if cancelled():fail('room_cancelled','El trabajo ya está cancelado.')
    start=time.monotonic();verify_code(lock['runtime']['model_root'],lock);verify_weight_tree(weights,lock['runtime']['checkpoint_manifest'])
    verification_seconds=time.monotonic()-start
    root=Path(workspace).absolute();weight_root=Path(weights).absolute()
    if root.resolve()!=root or weight_root.resolve()!=weight_root or str(weight_root)!=lock['runtime']['weights_root']:fail('room_storage','Las carpetas del worker no coinciden con el lock.')
    root.mkdir(parents=True,exist_ok=True);key=cache_key(request,lock);cache=root/key
    if cache.exists():
        try:
            if cache.resolve()!=cache or not cache.is_dir():raise ValueError()
            result_path=cache/'result.json';asset_path=cache/'room.glb'
            if result_path.resolve()!=result_path or asset_path.resolve()!=asset_path or result_path.stat().st_size>512*1024 or asset_path.stat().st_size>MAX_GLB:raise ValueError()
            result=json.loads(result_path.read_bytes());raw=asset_path.read_bytes()
            if result['cache_key']!=key or result['artifact']!=validate_glb(raw):raise ValueError()
            return {**result,'artifact_bytes':raw,'cache_hit':True,'model_executed_this_call':False,'actual_billed_usd':None,
                'request_job_id':request['job_id'],'source_capture_id':request['capture_id']}
        except (OSError,ValueError,KeyError,TypeError):fail('room_cache','La caché multivista no coincide con su resultado.')
    with tempfile.TemporaryDirectory(prefix='.room-',dir=root) as temporary:
        job=Path(temporary);metadata={key:value for key,value in request.items() if key!='frames'}
        metadata['frames']=[]
        for frame in request['frames']:
            (job/(frame['id']+'.png')).write_bytes(frame['image_png']);metadata['frames'].append({key:value for key,value in frame.items() if key!='image_png'})
        (job/'request.json').write_bytes(canonical(metadata));(job/'room-lock.json').write_bytes(canonical(lock))
        before=time.monotonic();_run(job,request['timeout_seconds'],cancelled);inference_seconds=time.monotonic()-before
        if cancelled():fail('room_cancelled','El trabajo se canceló antes de publicar el resultado.')
        if (job/'room.glb').stat().st_size>MAX_GLB or (job/'surface.json').stat().st_size>512*1024:fail('room_output_limit','El resultado multivista excede el límite.')
        raw=(job/'room.glb').read_bytes();artifact=validate_glb(raw);surface=json.loads((job/'surface.json').read_bytes())
        result={'status':'preview_unverified','provenance':'inferred','pipeline_version':lock['pipeline_version'],
            'source_capture_id':request['capture_id'],'source_sha256':request['source_sha256'],
            'source_frames':metadata['frames'],'cache_key':key,'artifact':artifact,'surface':surface,
            'cache_hit':False,'model_executed_this_call':True,'actual_billed_usd':None,
            'timings':{'code_and_weight_verification_seconds':verification_seconds,'model_and_surface_seconds':inference_seconds},
            'billing_scope':'unknown_provider_invoice_required','metric_scale_verified':False,'geometry_fidelity_verified':False}
        publication=job/'cache';publication.mkdir();(publication/'room.glb').write_bytes(raw);(publication/'result.json').write_bytes(canonical(result))
        _publish_cache(publication,cache)
        return {**result,'artifact_bytes':raw}


def run_fixed_model(job):
    """Fixed official VGGT camera/depth heads; local safetensors, no downloads."""
    job=Path(job).absolute();lock=read_room_lock(job/'room-lock.json');request=json.loads((job/'request.json').read_bytes())
    if readiness(lock)['pending']:fail('room_not_configured','El runner multivista continúa cerrado.')
    input_frames=[];paths=[]
    for frame in request.get('frames',[]):
        if not isinstance(frame,dict) or not re.fullmatch('frame-[0-9]{4}',str(frame.get('id',''))):fail('room_input','Una vista tiene un identificador no admitido.')
        path=job/(frame['id']+'.png')
        if path.resolve()!=path or not path.is_file() or path.stat().st_size>8*1024*1024:fail('room_input','Una vista cambió dentro del worker.')
        input_frames.append({**frame,'image_png':path.read_bytes()});paths.append(str(path))
    validate_room_request({**request,'frames':input_frames})
    import numpy as np
    import torch
    from safetensors.torch import load_file
    if not torch.cuda.is_available() or torch.cuda.get_device_properties(0).total_memory<32*1024**3:fail('room_gpu','El worker requiere CUDA y al menos 32 GiB de VRAM; compatibilidad real pendiente.')
    root=Path(lock['runtime']['model_root']);sys.path.insert(0,str(root))
    from vggt.models.vggt import VGGT
    from vggt.utils.load_fn import load_and_preprocess_images_square
    from vggt.utils.pose_enc import pose_encoding_to_extri_intri
    torch.manual_seed(request['seed']);np.random.seed(request['seed'])
    model=VGGT();model.load_state_dict(load_file(str(Path(lock['runtime']['weights_root'])/'model.safetensors'),device='cpu'),strict=True)
    model=model.to('cuda').eval();images,bounds=load_and_preprocess_images_square(paths,target_size=518);images=images.to('cuda')
    dtype=torch.bfloat16 if torch.cuda.get_device_capability()[0]>=8 else torch.float16
    with torch.no_grad():
        with torch.cuda.amp.autocast(dtype=dtype):tokens,patch_start=model.aggregator(images[None])
        # Mirrors the official demo_colmap camera/depth path; point/track heads
        # are not invoked and there is no bundle adjustment in this first path.
        pose=model.camera_head(tokens)[-1];extrinsic,intrinsic=pose_encoding_to_extri_intri(pose,images.shape[-2:])
        depth,confidence=model.depth_head(tokens,images[None],patch_start)
    predictions={'depth':depth.squeeze(0).float().cpu().numpy(),'depth_conf':confidence.squeeze(0).float().cpu().numpy(),
        'extrinsic':extrinsic.squeeze(0).float().cpu().numpy(),'intrinsic':intrinsic.squeeze(0).float().cpu().numpy(),
        'images':np.rint(images.float().cpu().numpy().transpose(0,2,3,1)*255).clip(0,255).astype(np.uint8),
        'image_bounds':bounds[:,:4].cpu().numpy()}
    result=build_surface(predictions,request['parameters'],request['frames'])
    (job/'room.glb').write_bytes(result['artifact_bytes']);(job/'surface.json').write_bytes(canonical(result['surface']))


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description='Prepared bounded VGGT room worker')
    parser.add_argument('--run');arguments=parser.parse_args()
    if arguments.run:run_fixed_model(arguments.run)
    else:print(json.dumps(readiness(),ensure_ascii=False,indent=2))
