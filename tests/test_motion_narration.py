from array import array
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock
import wave
from services.motion.narration import make_narration
from services.motion.service import validate,voice_requested
from tests.test_motion import PLAN

class NarrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name);(self.folder/'assets').mkdir();self.stop=threading.Event()
    def tearDown(self):self.temp.cleanup()
    def stream(self,text,language,speed):
        class Voice:
            def __enter__(self):self.sent=False;return self
            def __exit__(self,*args):pass
            def read1(self,n):
                if self.sent:return b''
                self.sent=True;return array('h',[8000,-8000]*1200).tobytes()
        return Voice()
    def test_explicit_voice_and_silence_requests(self):
        self.assertTrue(voice_requested('Un video con la voz de Melodi'))
        for text in ['Video sin música ni locución','Video sin voz','No quiero voz','Un video promocional','Una petición por voz que crea un video']:
            self.assertFalse(voice_requested(text))
    def test_four_phrases_are_placed_without_truncation_and_supply_actual_amplitude(self):
        opener=Mock(side_effect=self.stream);report=make_narration(self.folder,['Uno','Dos','Tres','Cuatro'],30,self.stop,opener=opener)
        self.assertEqual(opener.call_count,4);self.assertEqual(report['external_calls'],4);self.assertEqual(len(report['levels']),1200)
        with wave.open(str(self.folder/'assets/melodi.wav'),'rb') as file:
            self.assertEqual(file.getnframes(),30*24000);self.assertEqual(file.getframerate(),24000)
            pcm=array('h');pcm.frombytes(file.readframes(file.getnframes()))
        self.assertEqual(max(map(abs,pcm[:10000])),0);self.assertGreater(max(map(abs,pcm[12500:14000])),0)
        self.assertGreater(max(report['levels']),0)
    def test_cancelled_or_invalid_narration_never_calls_provider(self):
        opener=Mock();self.stop.set()
        with self.assertRaises(ValueError):make_narration(self.folder,['Uno']*4,30,self.stop,opener=opener)
        with self.assertRaises(ValueError):make_narration(self.folder,['Uno'],30,self.stop,opener=opener)
        opener.assert_not_called()
    def test_overlong_phrase_is_rejected_not_clipped_or_retried(self):
        class Long:
            def __enter__(self):self.sent=False;return self
            def __exit__(self,*args):pass
            def read1(self,n):
                if self.sent:return b''
                self.sent=True;return array('h',[1000])*24000*9
        # Real provider returns bytes; use a bounded single fake chunk.
        Long.read1=lambda s,n:b'' if s.sent else (setattr(s,'sent',True) or (array('h',[1000])*24000*9).tobytes())
        opener=Mock(return_value=Long())
        with self.assertRaises(ValueError):make_narration(self.folder,['Uno']*4,30,self.stop,opener=opener)
        self.assertEqual(opener.call_count,1);self.assertFalse((self.folder/'assets/melodi.wav').exists())
    def test_plan_rejects_unbounded_or_control_character_narration(self):
        for texts in [['x']*3,['x'*181]*4,['x\n']*4]:
            with self.assertRaises(ValueError):validate({**PLAN,'narration':texts})
        self.assertEqual(validate({**PLAN,'narration':['Una frase.']*4})['narration'],['Una frase.']*4)
