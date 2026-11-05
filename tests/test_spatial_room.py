"""Known-array room geometry and guarded worker tests; no model, CUDA or network."""
from copy import deepcopy
from contextlib import closing
from io import BytesIO
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch,Mock
from uuid import uuid4

import numpy as np
from PIL import Image

from services.spatial.jobs import SpatialService,now
from services.spatial.room import RoomPreparationService
from workers.spatial_room import (DEFAULT_PARAMETERS,SpatialWorkerError,backproject,build_surface,cache_key,
    canonical,execute,parameters,read_room_lock,readiness,validate_room_request,verify_code)
from workers.spatial_room_modal import create_app,function_options


def png(color):
    stream=BytesIO();Image.new('RGB',(8,6),color).save(stream,format='PNG');return stream.getvalue()


def request():
    frames=[]
    for index,color in enumerate(((80,100,120),(140,120,100))):
        raw=png(color);frames.append({'id':f'frame-{index:04}','at_seconds':.5+index,'source_frame_sha256':str(index+1)*64,
            'image_sha256':hashlib.sha256(raw).hexdigest(),'image_png':raw})
    return {'schema_version':'0.1.0','job_id':str(uuid4()),'capture_id':str(uuid4()),'source_sha256':'a'*64,
        'frames':frames,'reviewed':True,'parameters':dict(DEFAULT_PARAMETERS),'seed':0,'timeout_seconds':10,'reserved_usd':.5}


def predictions(size=5):
    intrinsic=np.array([[10.,0,2],[0,10.,2],[0,0,1]])
    extrinsic=np.concatenate((np.eye(3),np.zeros((3,1))),axis=1)
    second=extrinsic.copy();second[0,3]=-1
    return {'depth':np.full((2,size,size,1),2.),'depth_conf':np.full((2,size,size),10.),
        'intrinsic':np.stack((intrinsic,intrinsic)),'extrinsic':np.stack((extrinsic,second)),
        'images':np.full((2,size,size,3),[100,140,180],dtype=np.uint8)}


def glb_arrays(raw):
    json_size=struct.unpack('<I',raw[12:16])[0];document=json.loads(raw[20:20+json_size]);binary=raw[28+json_size:]
    result={}
    for name,index in document['meshes'][0]['primitives'][0]['attributes'].items():
        accessor=document['accessors'][index];view=document['bufferViews'][accessor['bufferView']]
        dtype={5126:'<f4',5121:'u1',5123:'<u2'}[accessor['componentType']]
        width={'VEC3':3,'VEC4':4}[accessor['type']]
        result[name]=np.frombuffer(binary[view['byteOffset']:view['byteOffset']+view['byteLength']],dtype=dtype).reshape(-1,width)
    index=document['meshes'][0]['primitives'][0]['indices'];accessor=document['accessors'][index];view=document['bufferViews'][accessor['bufferView']]
    result['indices']=np.frombuffer(binary[view['byteOffset']:view['byteOffset']+view['byteLength']],dtype='<u4').reshape(-1,3)
    return document,result


class RoomTests(unittest.TestCase):
    def test_import_is_lazy_and_shipped_configuration_stops_before_optional_dependencies(self):
        script='import sys; import workers.spatial_room; import workers.spatial_room_modal; print(int(any(name in sys.modules for name in ("torch","numpy","modal"))))'
        value=subprocess.run([sys.executable,'-B','-c',script],capture_output=True,check=True)
        self.assertEqual(value.stdout.strip(),b'0')
        with patch('workers.spatial_room._run') as run,self.assertRaises(SpatialWorkerError) as error:
            execute(request(),'does-not-create','does-not-load')
        self.assertEqual(error.exception.code,'room_not_configured');run.assert_not_called()
        with patch('importlib.metadata.version') as version,self.assertRaises(SpatialWorkerError):create_app()
        version.assert_not_called();self.assertIn('checkpoint_manifest_pending',readiness()['pending'])

    def test_input_contract_checks_source_order_bytes_duplicates_and_bounded_limits(self):
        source=request();validate_room_request(source)
        changes=[{'frames':source['frames'][:1]},{'frames':source['frames']*5},{'reviewed':False},{'timeout_seconds':181},
            {'reserved_usd':float('nan')},{'parameters':{'sample_stride':True}},{'source_sha256':'bad'}]
        for change in changes:
            with self.subTest(change=list(change)),self.assertRaises(SpatialWorkerError):validate_room_request({**source,**change})
        for frame_change in ({'image_sha256':'b'*64},{'at_seconds':0},{'image_png':b'bad'},{'id':'../evil'}):
            value=deepcopy(source);value['frames'][1].update(frame_change)
            with self.subTest(change=list(frame_change)),self.assertRaises(SpatialWorkerError):validate_room_request(value)
        value=deepcopy(source);value['frames'][1]={**value['frames'][0],'id':'frame-0001','at_seconds':2}
        with self.assertRaises(SpatialWorkerError):validate_room_request(value)

    def test_backprojection_applies_inverse_camera_translation_rotation_and_viewer_basis(self):
        depth=np.full((2,2),2.);intrinsic=np.eye(3);extrinsic=np.concatenate((np.eye(3),np.array([[-1],[0],[0]])),axis=1)
        points=backproject(depth,intrinsic,extrinsic)
        np.testing.assert_allclose(points[0,0],[1,0,-2]);np.testing.assert_allclose(points[1,1],[3,-2,-2])
        rotation=np.array([[0,0,1],[0,1,0],[-1,0,0.]])
        turned=np.concatenate((rotation,np.zeros((3,1))),axis=1)
        np.testing.assert_allclose(backproject(depth,intrinsic,turned)[0,0],[-2,0,0])

    def test_surface_contains_colors_normals_triangles_exact_known_positions_and_cameras(self):
        value=build_surface(predictions(),{'sample_stride':1})
        document,arrays=glb_arrays(value['artifact_bytes']);surface=value['surface']
        self.assertEqual(surface['vertex_count'],50);self.assertEqual(surface['triangle_count'],64)
        np.testing.assert_allclose(arrays['POSITION'][0],[-.4,.4,-2],atol=1e-6)
        np.testing.assert_allclose(arrays['POSITION'][25],[.6,.4,-2],atol=1e-6)
        np.testing.assert_allclose(arrays['NORMAL'],np.tile([0,0,1],(50,1)),atol=1e-6)
        srgb=np.array([100,140,180],dtype=float)/255
        expected=np.rint(np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)*65535).astype(int)
        np.testing.assert_array_equal(arrays['COLOR_0'][0],[*expected,65535]);self.assertLess(arrays['indices'].max(),50)
        self.assertEqual(surface['cameras'][1]['camera_to_viewer'][0][3],1)
        self.assertFalse(surface['uncertainty']['holes_filled']);self.assertFalse(surface['metric_scale_verified'])
        self.assertFalse(surface['scene_coverage_verified']);self.assertEqual(document['meshes'][0]['primitives'][0]['mode'],4)

    def test_linear_unorm16_colors_roundtrip_all_srgb_bytes_including_dark_tones(self):
        from services.spatial.room_dispatch import validate_room_glb
        value=predictions(16);ramp=np.arange(256,dtype=np.uint8).reshape(16,16)
        colors=np.stack((ramp,255-ramp,np.roll(ramp,17)),axis=-1)
        value['images'][:]=colors
        result=build_surface(value,{'sample_stride':1});document,arrays=glb_arrays(result['artifact_bytes'])
        encoded=arrays['COLOR_0'];linear=encoded[:256,:3].astype(float)/65535
        srgb=np.where(linear<=.0031308,linear*12.92,1.055*np.power(linear,1/2.4)-.055)*255
        self.assertLessEqual(float(np.max(np.abs(srgb-colors.reshape(-1,3)))),1.)
        self.assertGreater(int(encoded[1,0]),0);self.assertTrue((encoded[:,3]==65535).all())
        self.assertEqual(document['extras']['brivany']['vertex_color_transfer'],'linear')
        index=document['meshes'][0]['primitives'][0]['attributes']['COLOR_0'];accessor=document['accessors'][index]
        self.assertEqual(accessor['componentType'],5123);self.assertTrue(accessor['normalized']);self.assertEqual(accessor['type'],'VEC4')
        for view in document['bufferViews']:self.assertEqual(view.get('byteOffset',0)%4,0)
        validate_room_glb(result['artifact_bytes'],result['surface'])

    def test_room_validator_rejects_old_color_encoding_false_transfer_and_misalignment(self):
        from services.spatial.room_dispatch import validate_room_glb,RoomDispatchError
        result=build_surface(predictions(),{'sample_stride':1});raw=result['artifact_bytes'];length=struct.unpack('<I',raw[12:16])[0]
        document=json.loads(raw[20:20+length]);binary=raw[28+length:]
        color_index=document['meshes'][0]['primitives'][0]['attributes']['COLOR_0']
        variants=[]
        changed=deepcopy(document);changed['accessors'][color_index]['componentType']=5121;variants.append(changed)
        changed=deepcopy(document);changed['accessors'][color_index]['normalized']=False;variants.append(changed)
        changed=deepcopy(document);changed['extras']['brivany']['vertex_color_transfer']='srgb';variants.append(changed)
        changed=deepcopy(document);changed['extras']['brivany']['vertex_color_encoding']='rgba-unorm8';variants.append(changed)
        changed=deepcopy(document);changed['materials'][0]['pbrMetallicRoughness']['baseColorFactor']=[0,0,0,1];variants.append(changed)
        changed=deepcopy(document);changed['meshes'][0]['primitives'][0]['material']=1;variants.append(changed)
        changed=deepcopy(document);view=changed['bufferViews'][changed['accessors'][color_index]['bufferView']];view['byteOffset']+=2;variants.append(changed)
        for index,changed in enumerate(variants):
            encoded=canonical(changed);encoded+=b' '*((-len(encoded))%4)
            altered=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
            with self.subTest(case=index),self.assertRaises(RoomDispatchError):validate_room_glb(altered,result['surface'])

    def test_low_confidence_invalid_depth_and_padding_are_removed_without_hole_filling(self):
        value=predictions();value['depth'][0,2,2,0]=np.nan;value['depth_conf'][1,2,2]=0
        value['image_bounds']=[[1,1,5,5],[1,1,5,5]]
        result=build_surface(value,{'sample_stride':1})
        self.assertLess(result['surface']['triangle_count'],64)
        self.assertEqual(sum(item['invalid_depth_or_confidence_pixels'] for item in result['surface']['frames']),2)
        for report in result['surface']['frames']:self.assertEqual(report['sampled_image_pixels'],16)
        _,arrays=glb_arrays(result['artifact_bytes']);self.assertFalse(np.isnan(arrays['POSITION']).any())

    def test_depth_discontinuity_never_bridges_foreground_background(self):
        value=predictions();value['depth'][:,:,3:,0]=10
        result=build_surface(value,{'sample_stride':1,'max_edge_length_ratio':.5})
        self.assertGreater(sum(item['triangles_rejected_discontinuity_or_degenerate'] for item in result['surface']['frames']),0)
        _,arrays=glb_arrays(result['artifact_bytes'])
        for triangle in arrays['POSITION'][arrays['indices']]:self.assertLessEqual(abs(triangle[:,2].max()-triangle[:,2].min()),.001)

    def test_bad_camera_shapes_nonrigid_rotation_and_empty_surfaces_are_rejected(self):
        for name,changed in (('intrinsic',np.eye(3)),('extrinsic',np.zeros((2,3,4))),('images',np.zeros((2,5,5,3),dtype=np.float32))):
            with self.subTest(name=name),self.assertRaises(SpatialWorkerError):build_surface({**predictions(),name:changed})
        value=predictions();value['depth_conf'][:]=0
        with self.assertRaises(SpatialWorkerError) as error:build_surface(value)
        self.assertEqual(error.exception.code,'room_empty_surface')

    def test_geometry_limits_raise_stride_evenly_and_export_stays_deterministic(self):
        value=predictions(40);options={'sample_stride':1,'max_vertices':400,'max_triangles':600}
        value['intrinsic'][:,0,0]=100;value['intrinsic'][:,1,1]=100
        first=build_surface(value,options);second=build_surface(value,options)
        self.assertGreater(first['surface']['effective_stride'],1);self.assertLessEqual(first['surface']['vertex_count'],400)
        self.assertLessEqual(first['surface']['triangle_count'],600);self.assertEqual(first['artifact_bytes'],second['artifact_bytes'])

    def test_cache_key_changes_with_views_times_parameters_model_and_weight_identity(self):
        source=request();lock=read_room_lock();first=cache_key(source,lock)
        for field,value in (('seed',1),('parameters',{'sample_stride':5}),('source_sha256','b'*64)):
            self.assertNotEqual(cache_key({**source,field:value},lock),first)
        changed=deepcopy(source);changed['frames'][1]['at_seconds']=2.;self.assertNotEqual(cache_key(changed,lock),first)
        changed=deepcopy(lock);changed['runtime']['checkpoint_manifest']=[{'path':'model.safetensors','sha256':'f'*64,'size_bytes':10}]
        self.assertNotEqual(cache_key(source,changed),first)
        changed=deepcopy(lock);changed['pipeline_version']='spatial-room-vggt-observed-surface-0.1.0'
        self.assertNotEqual(cache_key(source,changed),first)
        self.assertEqual(cache_key({**source,'job_id':str(uuid4()),'reserved_usd':.7},lock),first)

    def test_code_checkout_and_file_hashes_are_checked_without_downloading(self):
        lock=read_room_lock()
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);lock['source_files']={'critical.py':{'sha256':hashlib.sha256(b'good').hexdigest()}}
            (root/'critical.py').write_bytes(b'good')
            with patch('workers.spatial_room.subprocess.run',side_effect=[SimpleNamespace(stdout=lock['model']['code_revision'].encode()),SimpleNamespace(stdout=b'')]):verify_code(root,lock)
            (root/'critical.py').write_bytes(b'changed')
            with patch('workers.spatial_room.subprocess.run',side_effect=[SimpleNamespace(stdout=lock['model']['code_revision'].encode()),SimpleNamespace(stdout=b'')]),self.assertRaises(SpatialWorkerError):verify_code(root,lock)

    def configured(self,root):
        lock=read_room_lock();lock.update(remote_dispatch_enabled=True,deployment_verified=True)
        lock['model'].update(checkpoint_hashes_verified=True,license_reviewed_by_user=True,access_granted_by_provider=True)
        weights=root/'weights';weights.mkdir();(weights/'model.safetensors').write_bytes(b'synthetic-not-model')
        lock['runtime'].update(dependency_lock_complete=True,build_verified=True,cuda_compatibility_verified=True,
            base_image_digest='sha256:'+'b'*64,model_root=str(root/'code'),weights_root=str(weights),
            checkpoint_manifest=[{'path':'model.safetensors','sha256':hashlib.sha256(b'synthetic-not-model').hexdigest(),'size_bytes':19}])
        lock['budget']={'approved_per_job_usd':1,'approved_total_usd':2,'gpu_rate_usd_per_second':.001,'non_gpu_reserve_per_job_usd':.1}
        return lock,weights

    def test_worker_publishes_and_reuses_exact_cache_without_running_model_again(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);lock,weights=self.configured(root);source=request();generated=build_surface(predictions(),{'sample_stride':1})
            def runner(job,*_):
                (job/'room.glb').write_bytes(generated['artifact_bytes']);(job/'surface.json').write_bytes(canonical(generated['surface']))
            with patch('workers.spatial_room.verify_code'),patch('workers.spatial_room._run',side_effect=runner) as run:
                first=execute(source,root/'cache',weights,lock=lock)
                second=execute({**source,'job_id':str(uuid4())},root/'cache',weights,lock=lock)
            run.assert_called_once();self.assertEqual(first['artifact_bytes'],second['artifact_bytes'])
            self.assertTrue(second['cache_hit']);self.assertFalse(second['model_executed_this_call']);self.assertIsNone(first['actual_billed_usd'])
            self.assertFalse(first['surface']['geometry_fidelity_verified'])
            folder=root/'cache'/cache_key(source,lock);(folder/'room.glb').write_bytes(b'changed')
            with patch('workers.spatial_room.verify_code'),patch('workers.spatial_room._run') as run,self.assertRaises(SpatialWorkerError):execute(source,root/'cache',weights,lock=lock)
            run.assert_not_called()

    def test_budget_cancel_and_weight_tamper_stop_before_runner(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);lock,weights=self.configured(root);source=request()
            for change,stopped in (({'reserved_usd':.001},False),({},True)):
                with patch('workers.spatial_room._run') as run,self.assertRaises(SpatialWorkerError):execute({**source,**change},root/'cache',weights,lock=lock,cancelled=lambda:stopped)
                run.assert_not_called()
            (weights/'model.safetensors').write_bytes(b'bad')
            with patch('workers.spatial_room.verify_code'),patch('workers.spatial_room._run') as run,self.assertRaises(SpatialWorkerError):execute(source,root/'cache',weights,lock=lock)
            run.assert_not_called()

    def test_modal_factory_limits_cannot_be_relaxed_and_offline_import_does_not_load_sdk(self):
        lock=read_room_lock();self.assertEqual(function_options(lock)['retries'],0)
        lock['modal']['max_containers']=2
        with self.assertRaises(SpatialWorkerError):function_options(lock)

    def test_capture_preparation_uses_exact_source_frames_and_does_not_create_reservation(self):
        with tempfile.TemporaryDirectory() as temporary,closing(SpatialService(Path(temporary)/'spatial',start_worker=False,seed_demo=False)) as spatial:
            capture=str(uuid4());folder=spatial.root/'captures'/capture;(folder/'frames').mkdir(parents=True)
            frames=[]
            for index,color in enumerate(((80,100,120),(140,120,100))):
                output=BytesIO();Image.new('RGB',(8,6),color).save(output,format='JPEG');raw=output.getvalue();relative=f'frames/frame-{index:04}.jpg';(folder/relative).write_bytes(raw)
                frames.append({'id':f'frame-{index:04}','relative_path':relative,'at_seconds':.5+index,'width':8,'height':6,'sha256':hashlib.sha256(raw).hexdigest()})
            manifest={'capture_id':capture,'source':{'filename':'synthetic.mp4','sha256':'a'*64,'size_bytes':40,'duration_seconds':3.,'width':8,'height':6,'has_audio':False},'frames':frames}
            (folder/'capture.json').write_text(json.dumps(manifest));service=RoomPreparationService(spatial)
            payload={'expected_source_sha256':'a'*64,'frame_ids':[frame['id'] for frame in frames],'reviewed':True}
            before=set(spatial.root.iterdir());result=service.prepare(capture,payload)
            self.assertIsNone(result['request']);self.assertFalse(result['preflight']['reservation_created']);self.assertFalse(result['preflight']['configuration_ready'])
            self.assertEqual(set(spatial.root.iterdir()),before);self.assertFalse((spatial.root/'budget.sqlite3').exists())
            request_=service.prepare(capture,payload,reserved_usd=.5)['request'];validate_room_request(request_)
            self.assertEqual(request_['frames'][1]['source_frame_sha256'],frames[1]['sha256'])
            (folder/'frames/frame-0001.jpg').write_bytes(b'bad')
            with self.assertRaises(SpatialWorkerError):service.prepare(capture,payload,reserved_usd=.5)


if __name__=='__main__':unittest.main()
