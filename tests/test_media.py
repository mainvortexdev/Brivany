"""Real local FFmpeg with owned synthetic inputs; provider plans are substituted."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
import uuid
import wave
from unittest.mock import patch
from services.media.service import MediaService
from services.media.files import destination,publish
from services.computer.planner import MetaPlanner
from packages.providers.conversation import ConversationRequest


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'Requires local FFmpeg')
class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture=tempfile.TemporaryDirectory();cls.source=Path(cls.fixture.name)/'owned.mp4'
        command=[shutil.which('ffmpeg'),'-nostdin','-v','error','-n','-f','lavfi','-i','color=c=red:s=320x180:r=15:d=2.4','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=2.4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(cls.source)]
        subprocess.run(command,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        cls.original=hashlib.sha256(cls.source.read_bytes()).hexdigest()
    @classmethod
    def tearDownClass(cls):cls.fixture.cleanup()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
        self.documents=self.root/'Documents';self.documents.mkdir();self.desktop=self.root/'Desktop';self.desktop.mkdir()
        self.service=MediaService(self.root/'media',folders={'documents':self.documents,'desktop':self.desktop});self.addCleanup(self.service.executor.close)
        self.cancelled=threading.Event()
    def run_plan(self,plan,*,goal='Extrae el audio en la carpeta Prueba de Documentos',decide=None):
        return self.service.run(goal,selected=[str(self.source)],roots=[],identifier=str(uuid.uuid4()),decide=decide or (lambda *a,**k:plan),cancelled=self.cancelled)
    def extraction(self,format='wav',area='documents'):
        return {'operation':'extract_audio','input_id':0,'format':format,'destination':{'area':area,'folder':'Prueba'}}
    def test_extract_formats_duration_and_original_unchanged(self):
        for format in ('wav','mp3','m4a'):
            with self.subTest(format=format):
                result=self.run_plan(self.extraction(format));path=Path(result['path'])
                self.assertTrue(result['verified']);self.assertEqual(path.parent,self.documents/'Prueba');self.assertEqual(path.suffix,'.'+format)
                self.assertAlmostEqual(result['duration_seconds'],2.4,delta=.25)
                self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(),self.original)
    def test_existing_output_is_preserved(self):
        first=self.run_plan(self.extraction());first_path=Path(first['path']);before=first_path.read_bytes()
        second=self.run_plan(self.extraction())
        self.assertNotEqual(first['path'],second['path']);self.assertEqual(first_path.read_bytes(),before)
    def test_missing_audio_rejected_without_output(self):
        silent=self.root/'silent.mp4'
        subprocess.run([shutil.which('ffmpeg'),'-v','error','-n','-i',str(self.source),'-an','-c:v','copy',str(silent)],check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        with self.assertRaisesRegex(ValueError,'no contiene una pista de audio'):
            self.service.run('Extrae audio en Prueba de Documentos',selected=[str(silent)],roots=[],identifier=str(uuid.uuid4()),decide=lambda *a:self.extraction(),cancelled=self.cancelled)
        self.assertFalse((self.documents/'Prueba').exists())
    def test_view_uses_four_actual_frames_and_reports_sampling(self):
        calls=[]
        def decide(prompt,data,**kwargs):
            calls.append((data,kwargs))
            return {'operation':'view','input_id':0} if not kwargs else {'message':'La muestra muestra un fondo rojo.'}
        result=self.run_plan(None,goal='Describe el video',decide=decide)
        self.assertEqual(len(calls[1][1]['images']),4);self.assertTrue(all(v.startswith('data:image/jpeg;base64,/9j/') for v in calls[1][1]['images']))
        self.assertTrue(result['sampled_visual_analysis']);self.assertFalse(result['audio_analyzed']);self.assertFalse(result['continuous_viewing_verified'])
        self.assertFalse(list((self.root/'media').rglob('*.jpg')))
    def test_translation_never_cuts_longer_voice_and_cleans_sources(self):
        def translate(source,target,language,cancelled,progress):
            with wave.open(str(target),'wb') as output:
                output.setnchannels(1);output.setsampwidth(2);output.setframerate(24000);output.writeframes(bytes(5*24000*2))
            return {'complete_input_processed':True,'semantic_completeness_verified':False}
        self.service.translator=translate
        plan={'operation':'translate','input_id':0,'target':'es','output':'video','destination':{'area':'documents','folder':'Prueba'}}
        result=self.run_plan(plan,goal='Traduce el video al español y guárdalo en Prueba de Documentos')
        self.assertTrue(result['verified']);self.assertGreaterEqual(result['duration_seconds'],5);self.assertFalse(result['lip_sync_verified'])
        self.assertFalse(list((self.root/'media').rglob('*.wav')))
    def test_partial_translation_not_published(self):
        self.service.translator=lambda *a,**k:{'complete_input_processed':False}
        plan={'operation':'translate','input_id':0,'target':'es','output':'audio','destination':{'area':'documents','folder':'Prueba'}}
        with self.assertRaisesRegex(ValueError,'incompleta'):self.run_plan(plan,goal='Traduce en Prueba de Documentos')
        self.assertEqual(list((self.documents/'Prueba').iterdir()),[])
    def test_native_router_accepts_media(self):
        planner=MetaPlanner()
        with patch.object(planner,'generate',return_value={'kind':'media','goal':'Extrae el audio en Documentos'}):
            self.assertEqual(planner.route(ConversationRequest(text='Extrae el audio',consent=True))['kind'],'media')


class DestinationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
        self.folders={'documents':self.root,'desktop':self.root}
    def test_no_inferred_folder_or_escape(self):
        for folder,goal in [('../outside','Guarda en ../outside de Documentos'),('C:\\Windows','C:\\Windows de Documentos'),('A','Guarda en Escritorio'),('NUL','NUL de Documentos'),('secret','Guarda en Documentos')]:
            with self.subTest(folder=folder),self.assertRaises(ValueError):destination({'area':'documents','folder':folder},goal,folders=self.folders)
    def test_literal_nested_folder_and_no_overwrite(self):
        folder=destination({'area':'desktop','folder':'Audio/Clases'},'Guarda en Audio/Clases del escritorio',folders=self.folders)
        old=folder/'a.wav';old.write_bytes(b'keep');stage=folder/'.stage.wav';stage.write_bytes(b'new')
        result=publish(stage,folder,'a','.wav');self.assertEqual(result.name,'a (2).wav');self.assertEqual(old.read_bytes(),b'keep');self.assertEqual(result.read_bytes(),b'new')


if __name__=='__main__':unittest.main()
