"""Synthetic pixels/PCM; no screen, microphone, system capture or cloud inference."""
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import wave
from unittest.mock import patch
from PIL import Image
from services.work.audio import AudioTape,RATE,PACKET_FRAMES
from services.work.session import WorkSession
from services.work.translation import translate_recording


class TapeTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory()
    def tearDown(self):self.temp.cleanup()
    def test_pre_roll_and_future_audio_are_conserved_byte_for_byte(self):
        tape=AudioTape(self.temp.name);packets=[bytes([index,0])*PACKET_FRAMES for index in range(8)]
        for i in range(4):tape.append(i,packets[i])
        tape.accept(0)
        for i in range(4,8):tape.append(i,packets[i])
        path=tape.finish()
        with wave.open(str(path),'rb') as source:self.assertEqual(source.getnframes(),8*PACKET_FRAMES);self.assertEqual(source.readframes(source.getnframes()),b''.join(packets))
        self.assertEqual(tape.status()['coverage'],'no_gaps_detected');self.assertFalse(tape.status()['hardware_continuity_verified']);tape.close()
    def test_evicted_prefix_and_driver_discontinuity_are_explicit(self):
        tape=AudioTape(self.temp.name,seconds=1)
        for index in range(30):tape.append(index,bytes(PACKET_FRAMES*2),discontinuity=index==1)
        tape.accept(0);value=tape.status();self.assertLessEqual(value['buffer_seconds'],1);self.assertTrue(value['prefix_truncated']);self.assertEqual(value['coverage'],'gaps_detected');tape.close()
    def test_missing_and_duplicate_packets_do_not_become_complete(self):
        tape=AudioTape(self.temp.name);tape.append(0,bytes(20));tape.append(2,bytes(20));self.assertEqual(tape.status()['packet_gaps'],1)
        with self.assertRaises(ValueError):tape.append(2,bytes(20))
        self.assertEqual(tape.frames,20);tape.close()
    def test_original_is_not_created_before_explicit_acceptance(self):
        tape=AudioTape(self.temp.name);tape.append(0,bytes(20));self.assertFalse((Path(self.temp.name)/'original.wav').exists());tape.close()


class SessionTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.calls=[];self.work=WorkSession(self.temp.name,capture=lambda *a,**k:self.calls.append('capture'))
    def tearDown(self):self.work.close();self.temp.cleanup()
    def test_work_and_screen_selection_never_start_audio(self):
        self.work.start();self.assertEqual(self.calls,[])
        self.work.screen_snapshot(grab=lambda:Image.new('RGB',(300,200),'#26a65b'));value=self.work.select_region(.1,.1,.5,.5)
        self.assertTrue(value.startswith('data:image/jpeg'));self.assertIsNone(self.work.image);self.assertEqual(self.calls,[]);self.assertEqual(list(Path(self.temp.name).glob('*.png')),[])
    def test_audio_requires_separate_explicit_consent(self):
        self.work.start()
        with self.assertRaises(ValueError):self.work.enable_audio(consent_to_asr=False)
        self.assertEqual(self.calls,[])
    def test_invalid_region_and_cancel_release_original_pixels(self):
        self.work.start();self.work.screen_snapshot(grab=lambda:Image.new('RGB',(100,100)))
        with self.assertRaises(ValueError):self.work.select_region(-.1,0,.5,.5)
        self.work.cancel_snapshot();self.assertIsNone(self.work.image)
    def test_asr_end_timestamp_does_not_cut_the_recording_beginning(self):
        self.work.start()
        with patch('services.work.session.LanguageMonitor') as monitor:
            monitor.return_value.run=lambda:None
            self.work._start_detector(origin=0);self.work.monitor_thread.join(1)
            monitor.call_args.kwargs['offer']('en',RATE*15)
        self.assertEqual(self.work.offer['start_frame'],0)
    def test_accepted_recording_processes_full_input_and_cleans_original(self):
        entered=threading.Event()
        def capture(accept,stop,**kw):
            for i in range(4):accept(i,bytes([i,0])*PACKET_FRAMES)
            entered.set();stop.wait(3)
        seen=[]
        def translate(source,destination,target,cancelled):
            with wave.open(str(source),'rb') as file:seen.append(file.getnframes())
            with wave.open(str(destination),'wb') as file:file.setnchannels(1);file.setsampwidth(2);file.setframerate(RATE);file.writeframes(bytes(100))
            return {'complete_input_processed':True,'semantic_completeness_verified':False}
        self.work.capture=capture;self.work.translator=translate;self.work._start_detector=lambda **kw:None
        self.work.enable_audio(consent_to_asr=True);self.assertTrue(entered.wait(2));directory=Path(self.work.temporary.name)
        self.work.offer={'id':'synthetic','language':'en','start_frame':0,'question':'¿Traducir?'};self.work.accept_translation('synthetic');self.work.finish_translation();self.work.translation_thread.join(3)
        self.assertEqual(seen,[4*PACKET_FRAMES]);self.assertEqual(self.work.status()['translation_state'],'ready');self.assertFalse((directory/'original.wav').exists())
        self.assertTrue(self.work.translation_file(self.work.media_key).is_file())
        with self.assertRaises(PermissionError):self.work.translation_file('wrong-key')
        self.work.close();self.assertFalse(directory.exists())


class ReplayTests(unittest.TestCase):
    def test_last_partial_packet_is_padded_not_dropped_and_counted(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'original.wav';destination=Path(folder)/'translated.wav';frames=PACKET_FRAMES+123
            with wave.open(str(source),'wb') as file:file.setnchannels(1);file.setsampwidth(2);file.setframerate(RATE);file.writeframes(bytes(frames*2))
            class Bridge:
                def __init__(self,port,mixer_factory):self.output=mixer_factory()
                def handle(self,peer):
                    peer.recv();peer.send(json.dumps({'type':'ready'}));sent=0
                    while True:
                        chunk=peer.recv()
                        if isinstance(chunk,str):break
                        sent+=len(chunk)
                    self.output.push_translation_paced(bytes(200));self.output.finish();peer.send(json.dumps({'type':'done','input_bytes':sent,'segments':1}))
                def close(self):pass
            result=translate_recording(source,destination,'es',threading.Event(),bridge_factory=Bridge)
            self.assertTrue(result['complete_input_processed']);self.assertEqual(result['submitted_frames'],frames);self.assertEqual(result['padding_frames'],PACKET_FRAMES-123);self.assertFalse(result['semantic_completeness_verified'])

if __name__=='__main__':unittest.main()
