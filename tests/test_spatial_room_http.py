"""Actual loopback room publication; remote SDK and model output substituted."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import hashlib
import json
import threading
import unittest

from services.h1.server import Handler
from services.spatial.media_access import MediaAccess
from tests.test_spatial_room_ingest import room_fixture


class QuietHandler(Handler):
    def log_message(self,*args):pass


class RoomHttpTests(unittest.TestCase):
    def setUp(self):
        self.f=room_fixture(self)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        self.server.spatial=self.f.spatial;self.server.spatial_media_access=MediaAccess()
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.stop)
        self.origin=f'http://127.0.0.1:{self.server.server_port}'

    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join(3)

    def call(self,method,path,value=None,headers=None):
        supplied={'Content-Type':'application/json','Origin':self.origin};supplied.update(headers or {})
        client=HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        client.request(method,path,json.dumps(value) if value is not None else None,supplied)
        response=client.getresponse();raw=response.read();content=json.loads(raw) if response.getheader('Content-Type','').startswith('application/json') else raw
        result=response.status,content,dict(response.getheaders());client.close();return result

    def body(self,dispatch):
        return {'expected_source_sha256':dispatch['source_sha256'],'expected_artifact_sha256':dispatch['artifact']['sha256'],
            'expected_surface_sha256':dispatch['surface_manifest']['sha256']}

    def test_readonly_list_then_explicit_import_and_signed_scene_preserve_evidence(self):
        route=f'/api/spatial/captures/{self.f.capture}/room-results'
        code,result,headers=self.call('GET',route);self.assertEqual(code,200);self.assertEqual(result['items'],[])
        self.assertEqual(headers['Cache-Control'],'no-store');self.f.function.spawn.assert_not_called()
        dispatch=self.f.submit();calls=self.f.function.spawn.call_count
        code,result,_=self.call('GET',route);self.assertEqual(code,200);self.assertEqual(result['items'][0]['kind'],'room')
        self.assertTrue(result['items'][0]['eligible_for_import']);self.assertFalse(result['provider_invoked']);self.assertNotIn('image_png',json.dumps(result))
        path=f"/api/spatial/room-dispatch/{dispatch['job_id']}/import"
        code,result,_=self.call('POST',path,self.body(dispatch));self.assertEqual(code,201)
        self.assertFalse(result['import']['provider_invoked']);self.assertFalse(result['import']['duplicate'])
        scene=result['scene']['scene'];self.assertEqual(scene['origin'],'room_reconstruction')
        self.assertEqual(len(scene['reconstruction']['cameras']),2);self.assertFalse(scene['reconstruction']['metric_scale_verified'])
        code,current,_=self.call('GET','/api/spatial/scenes/'+scene['scene_id']);self.assertEqual(code,200)
        self.assertIn('signature=',current['asset_urls']['room-surface']);self.assertEqual(current['scene'],scene)
        views=current['source_views'];self.assertEqual(views['scope'],'capture_frames_not_photo_registration')
        self.assertEqual([frame['id'] for frame in views['frames']],scene['source_frame_ids'])
        self.assertEqual([frame['at_seconds'] for frame in views['frames']],[.5,1.5])
        for frame in views['frames']:
            self.assertEqual(set(frame),{'id','at_seconds','sha256','width','height','url'})
            self.assertEqual((frame['width'],frame['height']),(8,6));self.assertIn('signature=',frame['url'])
            code,raw,_=self.call('GET',frame['url']);self.assertEqual(code,200);self.assertEqual(hashlib.sha256(raw).hexdigest(),frame['sha256'])
            self.assertEqual(self.call('GET',frame['url'].split('?')[0])[0],403)
        self.assertEqual(self.call('POST',path,self.body(dispatch))[1]['import']['duplicate'],True)
        self.assertEqual(self.call('GET',route)[1]['items'][0]['imported'],True)
        self.assertEqual(self.f.function.spawn.call_count,calls)

    def test_foreign_origin_wrong_content_type_and_missing_hash_cannot_publish(self):
        dispatch=self.f.submit();path=f"/api/spatial/room-dispatch/{dispatch['job_id']}/import";body=self.body(dispatch)
        self.assertEqual(self.call('POST',path,body,{'Origin':'https://untrusted.invalid'})[0],403)
        self.assertEqual(self.call('POST',path,body,{'Content-Type':'text/plain'})[0],415)
        body.pop('expected_surface_sha256');self.assertEqual(self.call('POST',path,body)[0],422)
        with self.f.spatial._connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM scenes').fetchone()[0],0)
        self.f.function.spawn.assert_called_once()

    def test_corrupted_saved_output_is_visible_as_ineligible_and_import_rejected(self):
        dispatch=self.f.submit();path=self.f.root/dispatch['surface_manifest']['relative_path'];path.write_text('{}')
        code,result,_=self.call('GET',f'/api/spatial/captures/{self.f.capture}/room-results')
        self.assertEqual(code,200);self.assertFalse(result['items'][0]['eligible_for_import']);self.assertTrue(result['items'][0]['error_code'])
        code,error,_=self.call('POST',f"/api/spatial/room-dispatch/{dispatch['job_id']}/import",self.body(dispatch))
        self.assertEqual(code,409);self.assertNotIn('Traceback',json.dumps(error));self.f.function.spawn.assert_called_once()

    def test_source_frame_manifest_and_actual_bytes_must_still_match_completed_receipt(self):
        dispatch=self.f.submit();code,result,_=self.call('POST',f"/api/spatial/room-dispatch/{dispatch['job_id']}/import",self.body(dispatch));self.assertEqual(code,201)
        scene_path='/api/spatial/scenes/'+result['scene']['scene']['scene_id'];manifest_path=self.f.root/'captures'/self.f.capture/'capture.json'
        original=manifest_path.read_bytes();manifest=json.loads(original);manifest['frames'][0]['sha256']='b'*64;manifest_path.write_text(json.dumps(manifest))
        code,error,_=self.call('GET',scene_path);self.assertEqual(code,409);self.assertEqual(error['error']['code'],'room_source_changed')
        manifest_path.write_bytes(original);frame_path=self.f.root/'captures'/self.f.capture/'frames/frame-0000.jpg';frame_path.write_bytes(b'changed')
        code,error,_=self.call('GET',scene_path);self.assertEqual(code,409);self.assertEqual(error['error']['code'],'room_source_changed')
        self.f.function.spawn.assert_called_once()


if __name__=='__main__':unittest.main()
