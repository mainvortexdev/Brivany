"""Owned PNG/MP4 result rendering and artifact-scoped transport; no providers."""
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import time
import unittest
from uuid import uuid4

from PIL import Image
from services.computer import http
from services.orchestration.results import ResultViewer
from services.orchestration.team import evidence


class MotionResultTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.workspace=Path(self.temp.name)/'workspace';self.workspace.mkdir()
        self.service=SimpleNamespace(workspace=self.workspace,jobs={})
        self.service.require=self.require
        self.viewer=ResultViewer(self.service);self.service.results=self.viewer
    def tearDown(self):self.temp.cleanup()
    @staticmethod
    def require(token):
        if token!='owned-token':raise PermissionError('fixture denial')
    def job(self,suffix='.png',*,verified=True):
        identifier=str(uuid4());folder=self.workspace/'motion'/identifier;folder.mkdir(parents=True)
        path=folder/('Brivany'+suffix)
        if suffix=='.png':Image.new('RGBA',(256,512),(0,113,227,128)).save(path)
        else:path.write_bytes(b'owned-video-fixture')
        self.service.jobs[identifier]={'id':identifier,'kind':'motion','state':'succeeded',
            'result':{'title':'Historia de Melodi','path':str(path),'verified':verified}}
        return identifier,path
    def handler(self,route,headers):
        responses=[]
        return SimpleNamespace(path=route,headers=headers,local_request=lambda:True,
            server=SimpleNamespace(computer_lock=threading.RLock(),computer=self.service),
            send_bytes=lambda *args:responses.append(('bytes',*args)),
            send_json=lambda *args:responses.append(('json',*args)),
            error=lambda *args:responses.append(('error',*args))),responses
    def test_png_is_an_image_ticket_and_preserves_original_png_alpha(self):
        identifier,path=self.job();value=self.viewer.describe(identifier)
        self.assertEqual(value['type'],'image');self.assertNotIn('src',value);self.assertNotIn('path',value)
        self.assertNotIn(str(self.workspace),repr(value));self.assertNotIn('token',value)
        returned,mime=self.viewer.media(identifier,value['media_ticket'])
        self.assertEqual(returned,path);self.assertEqual(mime,'image/png')
        with Image.open(returned) as image:self.assertEqual(image.mode,'RGBA')
        with self.assertRaises(ValueError):self.viewer.media(identifier,value['media_ticket'])
    def test_mp4_keeps_video_type_and_is_not_mislabeled_as_an_image(self):
        identifier,path=self.job('.mp4');value=self.viewer.describe(identifier)
        self.assertEqual(value['type'],'video');self.assertNotIn('src',value)
        self.assertEqual(self.viewer.media(identifier,value['media_ticket']),(path,'video/mp4'))
    def test_ticket_is_scoped_expiring_and_cannot_grant_desktop_control(self):
        identifier,_=self.job();value=self.viewer.describe(identifier)
        with self.assertRaises(ValueError):self.viewer.media(str(uuid4()),value['media_ticket'])
        value=self.viewer.describe(identifier);self.viewer.tickets[value['media_ticket']]['expires']=time.monotonic()-1
        with self.assertRaises(ValueError):self.viewer.media(identifier,value['media_ticket'])
        with self.assertRaises(PermissionError):self.require(value['media_ticket'])
        with self.assertRaises(ValueError):self.viewer.media(identifier,'ticket-no-ascii-\u2603')
    def test_motion_cannot_read_another_job_or_any_other_workspace_file(self):
        identifier,_=self.job();other_id,other=self.job()
        self.service.jobs[identifier]['result']['path']=str(other)
        with self.assertRaises(ValueError):self.viewer.describe(identifier)
        outside=self.workspace/'private.png';Image.new('RGB',(256,256)).save(outside)
        self.service.jobs[identifier]['result']['path']=str(outside)
        with self.assertRaises(ValueError):self.viewer.describe(identifier)
        self.assertNotEqual(identifier,other_id)
    def test_unverified_or_corrupt_png_is_not_presented_as_a_finished_illustration(self):
        identifier,path=self.job(verified=False)
        with self.assertRaises(ValueError):self.viewer.describe(identifier)
        self.service.jobs[identifier]['result']['verified']=True;path.write_text('<script>not a png</script>')
        with self.assertRaises((ValueError,OSError)):self.viewer.describe(identifier)
    def test_media_ticket_http_has_png_mime_and_needs_no_system_control_grant(self):
        identifier,path=self.job();value=self.viewer.describe(identifier)
        handler,replies=self.handler(value['media_url'],{'X-Brivany-Result':value['media_ticket']});http.get(handler)
        self.assertEqual(replies,[('bytes',200,path.read_bytes(),'image/png')])
        http.get(handler);self.assertEqual(replies[-1][0],'error')
    def test_legacy_motion_endpoint_returns_png_and_denies_wrong_control(self):
        identifier,path=self.job()
        handler,replies=self.handler('/api/computer/motion/'+identifier,{'X-Brivany-Control':'owned-token'});http.get(handler)
        self.assertEqual(replies,[('bytes',200,path.read_bytes(),'image/png')])
        handler.headers={'X-Brivany-Control':'not-authorized'};http.get(handler)
        self.assertEqual(replies[-1][0],'error')
    def test_review_looks_at_the_still_itself_without_demanding_video_frames(self):
        identifier,_=self.job();valid,result,images=evidence(self.service,self.service.jobs[identifier])
        self.assertTrue(valid);self.assertEqual(result['artifact_type'],'image');self.assertEqual(result['dimensions'],(256,512))
        self.assertEqual(len(images),1);self.assertTrue(images[0].startswith('data:image/jpeg;base64,'))
        self.assertNotIn('visual_review_unavailable',result)


if __name__=='__main__':unittest.main()
