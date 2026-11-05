"""Real loopback API and local scene artifacts; no model or cloud dispatch."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import BytesIO
import json
import hashlib
import struct
from pathlib import Path
import tempfile
import threading
import time
import unittest
from uuid import uuid4
from zipfile import ZipFile
from unittest.mock import patch
from urllib.parse import urlsplit,parse_qs

from services.h1.server import Handler
from services.spatial.jobs import SpatialService
from services.spatial.media_access import MediaAccess


class SpatialHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.service=SpatialService(Path(self.directory.name)/'spatial')
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.server.spatial=self.service;self.server.spatial_media_access=MediaAccess()
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.origin=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(3);self.service.close();self.directory.cleanup()
    def call(self,method,route,body=None,headers=None):
        c=HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        supplied={'Content-Type':'application/json','Origin':self.origin};supplied.update(headers or {})
        payload=json.dumps(body).encode() if isinstance(body,dict) else body
        c.request(method,route,body=payload,headers=supplied)
        r=c.getresponse();data=r.read();result=r.status,data,dict(r.getheaders());c.close();return result
    def get_json(self,route):
        code,data,_=self.call('GET',route);self.assertEqual(code,200);return json.loads(data)
    def demo_scene(self):
        library=self.get_json('/api/spatial/spaces');self.assertFalse(library['capabilities']['cloud_dispatch'])
        demo=next(space for space in library['spaces'] if space['origin']=='generated_demo')
        return demo,self.get_json('/api/spatial/scenes/'+demo['scene_id'])

    def test_demo_glb_signed_media_and_static_modules_are_local(self):
        demo,result=self.demo_scene()
        self.assertIsNone(result['scene']['capture_id']);self.assertEqual(result['scene']['source_frame_ids'],[])
        self.assertTrue(all(asset['provenance']=='generated' for asset in result['scene']['assets']))
        url=result['assets'][0]['url'];code,data,headers=self.call('GET',url)
        self.assertEqual(code,200);self.assertEqual(data[:4],b'glTF')
        self.assertEqual(headers['Content-Type'],'model/gltf-binary')
        self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertEqual(self.call('GET',urlsplit(url).path)[0],403)
        self.assertEqual(self.call('GET',url.replace('signature=','signature=0'))[0],403)
        with patch('services.spatial.media_access.time.time',return_value=time.time()+901):self.assertEqual(self.call('GET',url)[0],403)
        for route in ('/spaces','/viewer','/vendor/three/three.module.js','/vendor/three/addons/loaders/GLTFLoader.js'):
            self.assertEqual(self.call('GET',route)[0],200)
        self.assertEqual(self.call('GET','/vendor/three/../../../.env')[0],404)
        self.assertEqual(self.call('GET','/api/spatial/spaces/'+demo['id'])[0],200)

    def test_transforms_persist_and_stale_writes_conflict(self):
        _,result=self.demo_scene();scene=result['scene'];identifier=scene['scene_id']
        item=next(obj for obj in scene['objects'] if obj['editable'])
        transform=dict(item['transform']);transform['position']=[1.2,.3,.4]
        body={'expected_revision':result['revision'],'objects':[{'id':item['id'],'transform':transform}]}
        route='/api/spatial/scenes/'+identifier+'/transforms'
        code,data,_=self.call('POST',route,body);self.assertEqual(code,200)
        updated=json.loads(data);self.assertEqual(updated['revision'],result['revision']+1)
        self.assertEqual(next(obj for obj in updated['scene']['objects'] if obj['id']==item['id'])['transform'],transform)
        self.assertEqual(self.call('POST',route,body)[0],409)
        code,reset,_=self.call('POST','/api/spatial/scenes/'+identifier+'/reset',{'expected_revision':updated['revision']})
        self.assertEqual(code,200);reset=json.loads(reset)
        self.assertEqual(next(obj for obj in reset['scene']['objects'] if obj['id']==item['id'])['transform'],item['transform'])

    def test_history_layouts_and_signed_zip_use_real_http(self):
        _,result=self.demo_scene();identifier=result['scene']['scene_id']
        prefix='/api/spatial/scenes/'+identifier
        self.assertFalse(result['history']['can_undo'])
        patch={'expected_revision':1,'objects':[{'id':'chair','transform':{'position':[2,0,0]}}]}
        self.assertEqual(self.call('POST',prefix+'/transforms',patch)[0],200)
        code,data,_=self.call('POST',prefix+'/layouts',{'expected_revision':2,'name':'Junto a la ventana'})
        self.assertEqual(code,201);layout=json.loads(data)['layout']
        code,data,_=self.call('POST',prefix+'/undo',{'expected_revision':2})
        self.assertEqual(code,200);self.assertTrue(json.loads(data)['history']['can_redo'])
        self.assertEqual(self.call('POST',prefix+'/redo',{'expected_revision':3})[0],200)
        self.assertEqual(self.call('POST',prefix+'/layouts/'+layout['id']+'/apply',{'expected_revision':4})[0],200)
        self.assertEqual(self.call('POST',prefix+'/undo',{'expected_revision':2})[0],409)
        current=self.get_json(prefix);self.assertEqual(len(current['layouts']),1)
        url=current['export_url'];self.assertEqual(self.call('GET',urlsplit(url).path)[0],403)
        code,data,headers=self.call('GET',url)
        self.assertEqual(code,200);self.assertEqual(headers['Content-Type'],'application/zip')
        self.assertIn('attachment;',headers['Content-Disposition'])
        with ZipFile(BytesIO(data)) as package:
            self.assertEqual(json.loads(package.read('scene.json')),current['scene'])
            self.assertEqual(len(package.namelist()),7)

    def test_capture_review_http_is_revisioned_and_masks_are_signed(self):
        capture_id=str(uuid4());folder=self.service.root/'captures'/capture_id;(folder/'frames').mkdir(parents=True)
        jpeg=b'\xff\xd8\xff\xc0'+struct.pack('>HBHHB',8,8,16,16,0)+b'\xff\xd9';digest=hashlib.sha256(jpeg).hexdigest()
        (folder/'frames/frame-0000.jpg').write_bytes(jpeg)
        manifest={'capture_id':capture_id,'source':{'filename':'synthetic.mp4','sha256':'a'*64,'size_bytes':40,
            'duration_seconds':1.0,'width':16,'height':16,'has_audio':False},'frames':[
            {'id':'frame-0000','relative_path':'frames/frame-0000.jpg','at_seconds':.5,'width':16,'height':16,'sha256':digest}]}
        (folder/'capture.json').write_text(json.dumps(manifest),encoding='utf-8')
        url='/api/spatial/captures/'+capture_id+'/review';self.assertEqual(self.get_json(url)['revision'],0)
        body={'expected_revision':0,'length_reference':None,'objects':[{'id':'object-1','label':'Mesa','frame_id':'frame-0000',
            'frame_sha256':digest,'rectangle':{'x':.1,'y':.1,'width':.5,'height':.5},'mask_reviewed':False}]}
        code,raw,_=self.call('POST',url,body);self.assertEqual(code,200);review=json.loads(raw)
        self.assertFalse(review['metric_scale_verified']);self.assertFalse(review['segmentation_model_executed'])
        mask_url=review['objects'][0]['mask_url'];self.assertEqual(self.call('GET',urlsplit(mask_url).path)[0],403)
        self.assertEqual(self.call('GET',mask_url)[1][:8],b'\x89PNG\r\n\x1a\n')
        self.assertEqual(self.call('POST',url,body)[0],409)
        self.assertEqual(self.call('POST','/api/spatial/captures/'+capture_id+'/prepare',{'expected_revision':1,'object_id':'object-1'})[0],409)

    def test_same_origin_limits_and_locked_objects_rejected(self):
        _,result=self.demo_scene();scene=result['scene'];identifier=scene['scene_id']
        self.assertEqual(self.call('POST','/api/spatial/spaces/demo',{'title':'Test'},{'Origin':'https://remote.invalid'})[0],403)
        self.assertEqual(self.call('GET','/api/spatial/spaces',headers={'Host':'remote.invalid'})[0],403)
        room=next(obj for obj in scene['objects'] if not obj['editable'])
        code,data,_=self.call('POST','/api/spatial/scenes/'+identifier+'/transforms',{'expected_revision':result['revision'],'objects':[{'id':room['id'],'transform':room['transform']}]})
        self.assertIn(code,(409,422));self.assertNotIn(b'Traceback',data)
        self.assertEqual(self.call('POST','/api/spatial/captures',b'not-video',{'Content-Type':'video/mp4'})[0],422)
        self.assertEqual(self.call('POST','/api/spatial/captures',b'x',{'Content-Type':'audio/wav'})[0],415)


if __name__=='__main__':unittest.main()
