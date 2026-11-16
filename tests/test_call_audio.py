"""Bounded real FFmpeg mix of synthetic speech-like tones, no providers."""
from array import array
import math
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave
from services.motion.call_audio import write_ringback,reference_voices,finish_call_duration
from services.motion.story_service import StoryService
from tests.test_call_visuals import call_plan

BIN=Path(os.environ.get('LOCALAPPDATA',''))/'Programs/Brivany/releases/0.1.0/app/runtime-bin'


@unittest.skipUnless((BIN/'ffmpeg.exe').is_file(),'Local FFmpeg required')
class CallAudioTests(unittest.TestCase):
    def test_two_distinct_turns_without_music_produce_a_finite_call_mix(self):
        with tempfile.TemporaryDirectory() as temporary,patch.dict(os.environ,{'PATH':str(BIN)+os.pathsep+os.environ.get('PATH','')}):
            root=Path(temporary);folder=root/'project';(folder/'assets').mkdir(parents=True);segments=[]
            for index,hz in enumerate([220,360]):
                path=folder/('voice-'+str(index)+'.wav');data=array('h',(round(math.sin(n*2*math.pi*hz/24000)*3500) for n in range(24000)))
                with wave.open(str(path),'wb') as output:output.setparams((1,2,24000,0,'NONE','not compressed'));output.writeframes(data.tobytes())
                segments.append({'path':str(path),'start':index*3+.08,'duration':1})
            service=StoryService(root)
            try:result=service._audio(call_plan(),folder,(),segments,threading.Event(),lambda:None)
            finally:service.close()
            with wave.open(result['path'],'rb') as audio:
                self.assertAlmostEqual(audio.getnframes()/audio.getframerate(),8,places=3);self.assertEqual(audio.getnchannels(),2)
            self.assertLess(Path(result['path']).stat().st_size,2000000)

    def test_reference_cues_keep_silent_pauses_and_use_only_the_selected_male_voice(self):
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory() as temporary,patch.dict(os.environ,{'PATH':str(BIN)+os.pathsep+os.environ.get('PATH','')}):
            root=Path(temporary);(root/'assets').mkdir();p=call_plan();p.update(duration=5.542948,credits_duration=0,timing='reference',ringing_duration=.05)
            p['participants'][1]['gender']='male'
            for s,d in zip(p['scenes'],[2.75,2.792948]):s.update(duration=d,speech_offset=.1,speech_duration=2.6,speech_cues=[{'start':0,'duration':1,'text':'Turno'},{'start':1.6,'duration':1,'text':'sintético.'}])
            raw=array('h',(round(math.sin(n*2*math.pi*220/24000)*3500) for n in range(24000))).tobytes()
            def stream(*args,**kwargs):
                obj=MagicMock();obj.__enter__.return_value=obj;obj.read1.side_effect=[raw,b''];return obj
            service=StoryService(root)
            try:
                with patch('packages.providers.cartesia_melodi.open_character_speech',side_effect=stream) as synth:
                    segments=reference_voices(p,root,command=service.command,cancelled=threading.Event(),require=lambda:None,progress=lambda _:None)
                    self.assertEqual(synth.call_count,4);self.assertEqual(synth.call_args.kwargs['gender'],'male')
                    self.assertEqual(p['timing'],'dialogue')
                    # Recovery reuses raw voices; no second paid request.
                    again=reference_voices(p,root,command=service.command,cancelled=threading.Event(),require=lambda:None,progress=lambda _:None)
                    self.assertEqual(synth.call_count,4);self.assertTrue(all(s['reused'] for s in again))
                with wave.open(segments[0]['path'],'rb') as wav:
                    pcm=array('h',wav.readframes(wav.getnframes()))
                    self.assertEqual(len(pcm),53280);self.assertTrue(all(n==0 for n in pcm[24000:29280]));self.assertEqual(pcm[:24000].tobytes(),raw)
                    self.assertEqual(segments[0]['tempo_ratios'],[1,1]);self.assertFalse(segments[0]['voice_time_stretched'])
                from services.motion.call_visuals import fit_timing
                fit_timing(p,segments)
                # A short script cannot fill a longer film by stretching words.
                from copy import deepcopy
                too_long=deepcopy(p);too_long['duration']=8.142948
                with self.assertRaisesRegex(ValueError,'no se estiran'):fit_timing(too_long,segments)
                result=service._audio(p,root,(),segments,threading.Event(),lambda:None)
                with wave.open(result['path'],'rb') as wav:
                    self.assertEqual(wav.getnframes(),round(p['duration']*48000))
            finally:service.close()

    def test_ringback_is_a_bounded_local_effect_with_no_voice_or_network_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=write_ringback(Path(tmp)/'ring.wav',2.65)
            with wave.open(str(path),'rb') as wav:pcm=array('h',wav.readframes(wav.getnframes()))
            self.assertEqual(len(pcm),63600);self.assertGreater(max(pcm[:24000]),4000);self.assertTrue(all(n==0 for n in pcm[49000:]))

    def test_soft_laughter_finishes_in_a_quiet_valley_without_rate_changes(self):
        from services.motion.call_audio import soften_laughter
        voiced=array('h',(round(10000*math.sin(n*.1)) for n in range(24000)))
        raw=(voiced+array('h',[0]*24000)+voiced).tobytes();soft=array('h',soften_laughter(raw))
        self.assertGreater(len(soft),24000);self.assertLessEqual(len(soft),38400)
        self.assertTrue(all(v==0 for v in soft[24000:]));self.assertEqual(soft[2000],round(voiced[2000]*.4))

    def test_fractional_mp4_length_matches_audio_samples_instead_of_ceiling_video_frame(self):
        with tempfile.TemporaryDirectory() as temporary,patch.dict(os.environ,{'PATH':str(BIN)+os.pathsep+os.environ.get('PATH','')}):
            root=Path(temporary);(root/'assets').mkdir();service=StoryService(root);cancel=threading.Event();duration=5.142948
            try:
                write_ringback(root/'assets/mix.wav',duration)
                service.command('fixture','ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=64x64:r=60','-t','5.15','-c:v','libx264','-pix_fmt','yuv420p',root/'Brivany.mp4'],root,cancel)
                finish_call_duration(root,duration,60,command=service.command,cancelled=cancel)
                receipt=service.command('fixture_probe','ffprobe',['-v','error','-show_format','-show_streams','-of','json',root/'Brivany.mp4'],root,cancel)
                probe=json.loads(receipt['output']);self.assertAlmostEqual(float(probe['format']['duration']),duration,places=6)
                self.assertEqual({s['codec_type'] for s in probe['streams']},{'video','audio'})
            finally:service.close()
