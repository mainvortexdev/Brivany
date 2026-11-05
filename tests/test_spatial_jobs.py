"""Persistent local spatial lifecycle; no providers or GPU."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from contracts.spatial import SceneManifest
from services.spatial.demo import DEMO_ID,demo_assets,scene_document
from services.spatial.capture import CaptureError
from services.spatial.jobs import SpatialService,SpatialServiceError


class SpatialJobsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/"spatial";self.services=[]
    def service(self,**kwargs):
        service=SpatialService(self.root,**kwargs);self.services.append(service);self.addCleanup(service.close);return service
    def wait(self,service,job_id,timeout=6):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            result=service.get_job(job_id)
            if result['state'] in {'succeeded','failed','cancelled','interrupted'}:return result
            time.sleep(.015)
        self.fail('The bounded local job did not terminate.')

    def test_seed_has_real_glb_artifacts_and_no_invented_capture(self):
        service=self.service();library=service.library();self.assertEqual(len(library['spaces']),1)
        document=service.scene(DEMO_ID)['scene'];self.assertEqual(document['origin'],'generated_demo')
        self.assertIsNone(document['capture_id']);self.assertEqual(document['source_frame_ids'],[])
        self.assertEqual(sum(obj['editable'] for obj in document['objects']),3)
        self.assertFalse(document['objects'][0]['editable'])
        for asset in document['assets']:
            data,mime,name=service.asset(DEMO_ID,asset['id'])
            magic,version,size=struct.unpack('<4sII',data[:12]);self.assertEqual((magic,version,size),(b'glTF',2,len(data)))
            length,kind=struct.unpack('<I4s',data[12:20]);self.assertEqual(kind,b'JSON')
            gltf=json.loads(data[20:20+length]);self.assertEqual(gltf['asset']['version'],'2.0')
            self.assertTrue(gltf['nodes']);self.assertTrue(gltf['accessors'])
            self.assertNotIn('uri',gltf['buffers'][0]);self.assertEqual(mime,'model/gltf-binary')
            self.assertEqual(hashlib.sha256(data).hexdigest(),asset['sha256'])
            self.assertEqual(asset['provenance'],'generated')
        self.assertFalse(library['capabilities']['cloud_dispatch']);self.assertEqual(library['capabilities']['external_api_calls'],0)

    def test_demo_geometry_is_deterministic_and_capture_contract_cannot_be_faked(self):
        self.assertEqual(demo_assets(),demo_assets())
        document,_=scene_document();value=json.loads(document.model_dump_json())
        for change in ({'origin':'capture_reconstruction'},{'capture_id':DEMO_ID},{'source_frame_ids':['frame-0000']}):
            bad=deepcopy(value);bad.update(change)
            with self.assertRaises(ValidationError):SceneManifest.model_validate_json(json.dumps(bad))

    def test_transforms_persist_with_revision_lock_and_reset(self):
        service=self.service();current=service.scene(DEMO_ID)
        change={'expected_revision':1,'objects':[{'id':'chair','transform':{'position':[1.,0.,.5]}}]}
        result=service.update_transforms(DEMO_ID,change);self.assertEqual(result['revision'],2)
        with self.assertRaises(SpatialServiceError) as failure:service.update_transforms(DEMO_ID,change)
        self.assertEqual(failure.exception.status,409)
        service.close();reopened=self.service();self.assertEqual(reopened.scene(DEMO_ID)['scene']['objects'][1]['transform']['position'],[1.,0.,.5])
        reset=reopened.reset_scene(DEMO_ID,2);self.assertEqual(reset['revision'],3)
        self.assertEqual(reset['scene']['objects'][1]['transform']['position'],[-1.2,0.,-.45])

    def test_invalid_or_locked_mutations_leave_revision_unchanged(self):
        service=self.service()
        for objects in ([{'id':'room','transform':{'position':[1.,0.,0.]}}],
                        [{'id':'chair','transform':{'position':[float('inf'),0.,0.]}}],
                        [{'id':'chair','transform':{'position':[51.,0.,0.]}}],
                        [{'id':'chair','transform':{'scale':[0.,1.,1.]}}],
                        [{'id':'chair','transform':{}},{'id':'chair','transform':{}}],
                        [{'id':'missing','transform':{}}]):
            with self.assertRaises(SpatialServiceError):service.update_transforms(DEMO_ID,{'expected_revision':1,'objects':objects})
            self.assertEqual(service.scene(DEMO_ID)['revision'],1)

    def test_asset_integrity_and_path_traversal_rejected(self):
        service=self.service()
        for method,args in ((service.scene,('../.env',)),(service.get_job,('..',)),(service.asset,(DEMO_ID,'../../.env')),
                            (service.frame,(DEMO_ID,'../frame-0000'))):
            with self.assertRaises(SpatialServiceError):method(*args)
        path=self.root/'scenes'/DEMO_ID/'assets/chair.glb';path.write_bytes(b'changed')
        with self.assertRaises(SpatialServiceError) as failure:service.asset(DEMO_ID,'chair')
        self.assertEqual(failure.exception.code,'asset_integrity')

    def test_demo_job_queue_persists_and_cache_only_reuses_generation(self):
        service=self.service();first=service.create_demo('Primera');job=self.wait(service,first['job']['id'])
        self.assertEqual(job['state'],'succeeded');self.assertEqual(job['retry_count'],0)
        self.assertEqual(service.scene(first['space']['id'])['scene']['title'],'Primera')
        second=service.create_demo('Segunda');job2=self.wait(service,second['job']['id'])
        self.assertEqual(job2['stage'],'cache_hit');self.assertEqual(service.get_space(second['space']['id'])['object_count'],3)
        self.assertNotEqual(first['space']['id'],second['space']['id'])

    def test_queued_cancel_removes_only_owned_upload_and_never_runs(self):
        service=self.service(start_worker=False);outside=Path(self.temp.name)/'keep.txt';outside.write_text('keep')
        created=service.queue_capture('room.mp4',b'\0\0\0\x18ftypisom'+b'fake-mp4')
        self.assertEqual(len(list((self.root/'uploads').iterdir())),1)
        result=service.cancel_job(created['job']['id']);self.assertEqual(result['state'],'cancelled')
        self.assertEqual(list((self.root/'uploads').iterdir()),[]);self.assertEqual(outside.read_text(),'keep')
        self.assertEqual(service.get_space(created['space']['id'])['status'],'cancelled')

    def test_restart_marks_jobs_interrupted_without_automatic_replay(self):
        service=self.service(start_worker=False);created=service.create_demo('Pendiente')
        # Simulate a hard process stop, rather than graceful close cleanup.
        reopened=self.service();job=reopened.get_job(created['job']['id'])
        self.assertEqual(job['state'],'interrupted');self.assertEqual(job['error_code'],'process_restarted')
        self.assertEqual(reopened.get_space(created['space']['id'])['status'],'failed')

    def test_timeout_and_running_cancel_are_terminal_and_cleanup_generated_scene(self):
        from services.spatial.jobs import SpatialService as Kind
        original=Kind._write_demo
        def slow(instance,*args):time.sleep(.09);return original(instance,*args)
        service=self.service(job_timeout_seconds=.03)
        with patch.object(Kind,'_write_demo',slow):
            created=service.create_demo('Lenta');result=self.wait(service,created['job']['id'])
        self.assertEqual(result['error_code'],'job_timeout');self.assertFalse((self.root/'scenes'/created['space']['id']).exists())
        entered=threading.Event();release=threading.Event()
        def wait_then(instance,*args):entered.set();release.wait(1);return original(instance,*args)
        with patch.object(Kind,'_write_demo',wait_then):
            created=service.create_demo('Cancelada');self.assertTrue(entered.wait(1))
            result=service.cancel_job(created['job']['id']);self.assertEqual(result['state'],'cancelling');release.set()
            final=self.wait(service,created['job']['id'])
        self.assertEqual(final['state'],'cancelled');self.assertFalse((self.root/'scenes'/created['space']['id']).exists())

    def test_invalid_upload_stops_before_job_and_filename_never_controls_paths(self):
        service=self.service()
        for name,data in (('../room.mp4',b'\0'*20),('room.exe',b'\0'*20),('room.mp4',b'not-a-video'*3),('C:\\room.mp4',b'\0'*20)):
            with self.assertRaises(SpatialServiceError):service.queue_capture(name,data)
        self.assertEqual(service.library()['jobs'],[])

    def test_decode_failure_removes_original_and_never_publishes_capture_or_scene(self):
        service=self.service()
        with patch('services.spatial.jobs.probe_video',side_effect=ValueError('bad media')):
            created=service.queue_capture('bad.mp4',b'\0\0\0\x18ftypisom'+b'bad-video')
            job=self.wait(service,created['job']['id'])
        self.assertEqual(job['state'],'failed');self.assertEqual(job['retry_count'],0)
        self.assertEqual(list((self.root/'uploads').iterdir()),[])
        space=service.get_space(created['space']['id']);self.assertIsNone(space['capture_id']);self.assertIsNone(space['scene_id'])
        self.assertEqual(list((self.root/'captures').iterdir()),[])

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg required')
    def test_actual_ffmpeg_capture_is_prepared_without_scene_and_cache_reuses_package(self):
        video=Path(self.temp.name)/'fixture.mp4'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x48:rate=25','-t','2','-pix_fmt','yuv420p','-c:v','libx264','-y',str(video)],check=True,capture_output=True,timeout=15,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        service=self.service();created=service.queue_capture('fixture.mp4',video.read_bytes());job=self.wait(service,created['job']['id'],15)
        self.assertEqual(job['state'],'succeeded');space=service.get_space(created['space']['id'])
        self.assertEqual(space['status'],'capture_prepared');self.assertIsNone(space['scene_id']);self.assertEqual(len(space['frames']),6)
        self.assertEqual(space['preflight']['status'],'prepared_not_reconstructed')
        self.assertNotIn('relative_path',space['frames'][0]);self.assertEqual(list((self.root/'uploads').iterdir()),[])
        data,mime,_=service.frame(space['capture_id'],'frame-0000');self.assertEqual(data[:2],b'\xff\xd8');self.assertEqual(mime,'image/jpeg')
        second=service.queue_capture('same.mp4',video.read_bytes());cached=self.wait(service,second['job']['id'])
        self.assertEqual(cached['stage'],'cache_hit');self.assertEqual(service.get_space(second['space']['id'])['capture_id'],space['capture_id'])
        # A stale frame must not be handed out as an intact cached package.
        (self.root/'captures'/space['capture_id']/'frames/frame-0000.jpg').write_bytes(b'corrupted')
        third=service.queue_capture('again.mp4',video.read_bytes());rebuilt=self.wait(service,third['job']['id'],15)
        self.assertEqual(rebuilt['state'],'succeeded');self.assertNotEqual(rebuilt['stage'],'cache_hit')
        self.assertNotEqual(service.get_space(third['space']['id'])['capture_id'],space['capture_id'])

    def test_close_discards_queued_source_and_restart_cleans_only_unreferenced_artifacts(self):
        service=self.service(start_worker=False);created=service.queue_capture('room.mp4',b'\0\0\0\x18ftypisom'+b'fake-mp4')
        orphan='22222222-2222-4222-8222-222222222222';directory=self.root/'scenes'/orphan;directory.mkdir();(directory/'partial.glb').write_bytes(b'partial')
        service.close();self.assertEqual(service.get_job(created['job']['id'])['state'],'interrupted')
        self.assertEqual(list((self.root/'uploads').iterdir()),[])
        reopened=self.service();self.assertFalse(directory.exists());self.assertTrue((self.root/'scenes'/DEMO_ID).exists())

    def test_partial_upload_write_failure_removes_owned_bytes_before_any_job_exists(self):
        service=self.service(start_worker=False)
        original=Path.write_bytes
        def partial(path,data):
            if path.parent.parent==self.root/'uploads':
                original(path,data[:16]);raise OSError('simulated disk full after partial write')
            return original(path,data)
        with patch.object(Path,'write_bytes',partial):
            with self.assertRaises(OSError):service.queue_capture('partial.mp4',b'\0\0\0\x18ftypisom'+b'video-data')
        self.assertEqual(list((self.root/'uploads').iterdir()),[])
        self.assertEqual(service.library()['jobs'],[])

    def test_waiting_enqueue_cannot_publish_a_job_after_close(self):
        service=self.service(start_worker=False);validated=threading.Event();failures=[]
        class AnnouncedTitle(str):
            def strip(self,*args):validated.set();return super().strip(*args)
        def create():
            try:service.create_demo(AnnouncedTitle('Late job'))
            except Exception as error:failures.append(error)
        with service.lock:
            thread=threading.Thread(target=create);thread.start();self.assertTrue(validated.wait(1))
            service.close()
        thread.join(1)
        self.assertFalse(thread.is_alive());self.assertEqual(len(failures),1)
        self.assertIsInstance(failures[0],SpatialServiceError);self.assertEqual(failures[0].code,'service_closed')
        self.assertEqual(service.library()['jobs'],[])

    def test_operation_error_after_cooperative_deadline_is_reported_as_timeout(self):
        service=self.service(job_timeout_seconds=.015)
        def slow_probe(path):time.sleep(.04);raise CaptureError('decode operation ended after deadline')
        with patch('services.spatial.jobs.probe_video',slow_probe):
            created=service.queue_capture('late.mp4',b'\0\0\0\x18ftypisom'+b'video-data')
            job=self.wait(service,created['job']['id'])
        self.assertEqual(job['state'],'failed');self.assertEqual(job['error_code'],'job_timeout')
        self.assertEqual(list((self.root/'uploads').iterdir()),[])


if __name__=='__main__':unittest.main()
