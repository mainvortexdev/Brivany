"""Synthetic dialogue, PCM and geometry; no inference or voice synthesis."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
import wave
from services.motion.call_visuals import fit_timing,measure_layout,pcm_energy,scene_visuals,_orb_pose
from services.motion.story_contract import validate_story
from services.motion.story_renderer import write_story_project


def call_plan():
    return {'version':1,'presentation':'call','participants':[{'id':'melodi','name':'Melodi'},{'id':'counterpart','name':'Recepción'}],
            'title':'Synthetic dialogue','format':'portrait','fps':30,'duration':8,'voice':True,'music':None,'credits_duration':2,
            'scenes':[{'id':str(i),'duration':3,'background':'#000000','transition':'cut','speaker':speaker,'narration':'Turno sintético.','elements':[]} for i,speaker in [('a','melodi'),('b','counterpart')]]}


class CallVisualTests(unittest.TestCase):
    def test_contract_requires_two_speakers_short_names_and_no_extra_visual_elements(self):
        value=call_plan();self.assertEqual(validate_story(value),value)
        for mutate in [lambda p:p['participants'][0].update(name='Asistente personal de una persona'),lambda p:p['scenes'][1].update(speaker='melodi'),lambda p:p['scenes'][0].pop('speaker')]:
            bad=deepcopy(value);mutate(bad)
            with self.assertRaises(ValueError):validate_story(bad)
    def test_actual_pcm_controls_turn_timing_without_truncation_or_long_gaps(self):
        plan=call_plan();segments=[{'duration':2.6},{'duration':2.6}]
        self.assertAlmostEqual(fit_timing(plan,segments),.4);self.assertEqual(segments[0]['start'],.08);self.assertAlmostEqual(segments[1]['start'],3.08)
        self.assertAlmostEqual(sum(s['duration'] for s in plan['scenes'])+plan['credits_duration'],8)
        with self.assertRaises(ValueError):fit_timing(call_plan(),[{'duration':.5},{'duration':.5}])
    def test_fractional_reference_duration_zero_credit_and_measured_pauses_survive(self):
        plan=call_plan();plan.update(duration=8.142948,credits_duration=0,timing='reference',disclosure='none',ringing_duration=.4)
        plan['participants'][1]['gender']='male'
        for s,duration,offset in zip(plan['scenes'],[4,4.142948],[.5,.2]):
            s.update(duration=duration,speech_offset=offset,speech_duration=2.6,speech_cues=[{'start':0,'duration':1,'text':'Turno'},{'start':1.6,'duration':1,'text':'sintético.'}])
        checked=validate_story(plan);checked['scenes'][0]['speech_cues'][0]['text']='Different'
        self.assertEqual(plan['scenes'][0]['speech_cues'][0]['text'],'Turno')
        segments=[{'scene_id':s['id'],'duration':2.6} for s in plan['scenes']]
        self.assertIsNone(fit_timing(plan,segments));self.assertEqual([s['start'] for s in segments],[.5,4.2])
        with tempfile.TemporaryDirectory() as tmp:
            write_story_project(Path(tmp),plan,media={})
            self.assertNotIn('slot-story-credits',(Path(tmp)/'index.html').read_text())
            self.assertFalse((Path(tmp)/'compositions/story-credits.html').exists())
        for mutate in [lambda p:p['scenes'][0]['speech_cues'][1].update(start=.9),lambda p:p['scenes'][0]['speech_cues'][0].update(text='Missing'),lambda p:p.update(ringing_duration=1)]:
            bad=deepcopy(plan);mutate(bad)
            with self.assertRaises(ValueError):validate_story(bad)
    def test_idle_and_speech_rotation_are_continuous_across_scene_boundaries(self):
        segments=[{'start':2,'duration':2,'speaker':'melodi','energy':{'step':.1,'values':[.6]*20}}]
        a=_orb_pose(3-1e-7,'melodi',segments);b=_orb_pose(3,'melodi',segments)
        self.assertAlmostEqual(a[3],b[3],places=6)
        self.assertNotEqual(_orb_pose(0,'melodi',[])[0],_orb_pose(1,'melodi',[])[0])
        self.assertGreater(_orb_pose(3,'melodi',segments)[2],_orb_pose(3,'counterpart',segments)[2])
        markup,motion=scene_visuals('test',call_plan(),call_plan()['scenes'][0],1080,1920,timeline_start=3,voice_activity=segments)
        self.assertIn('-filaments',markup);self.assertIn('rotation:',motion);self.assertNotIn('Demostración',markup)
        p=call_plan();p['disclosure']='demonstration'
        self.assertIn('Demostración',scene_visuals('test',p,p['scenes'][0],1080,1920)[0])
    def test_black_hollow_orbs_measured_activity_names_only_and_no_white_credit_screen(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);plan=call_plan()
            write_story_project(folder,plan,media={},voice_activity=[{'scene_id':'a','duration':2.6,'energy':{'step':.1,'values':[0,.6,.1]}}])
            scene=(folder/'compositions/scene-a.html').read_text(encoding='utf-8');credits=(folder/'compositions/story-credits.html').read_text(encoding='utf-8')
            self.assertIn('radialGradient',scene);self.assertIn('melodi-wave',scene);self.assertIn('attr:{d:',scene);self.assertIn('Recepción',scene)
            for value in [scene,credits]:
                self.assertIn('background:#000',value);self.assertNotIn('Asistente personal',value);self.assertNotIn('Créditos</h2>',value);self.assertNotIn('Turno sintético',value)
    def test_local_color_bounds_measure_circle_geometry_and_pcm_energy(self):
        from PIL import Image,ImageDraw
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);image=Image.new('RGB',(360,640),'black');draw=ImageDraw.Draw(image)
            draw.ellipse((32,182,156,306),outline='#fa5ec2',width=2);draw.ellipse((204,182,328,306),outline='#5996ff',width=2);image.save(folder/'frame.png')
            layout=measure_layout([{'path':str(folder/'frame.png')}]);self.assertAlmostEqual(layout['center_y'],244/640,places=3);self.assertAlmostEqual(layout['diameter'],124/360,places=3)
            with wave.open(str(folder/'voice.wav'),'wb') as output:output.setparams((1,2,24000,0,'NONE','not compressed'));output.writeframes(b'\x00\x10'*2400+b'\0\0'*2400)
            energy=pcm_energy(folder/'voice.wav');self.assertGreater(energy['values'][0],energy['values'][1]);self.assertEqual(len(energy['values']),2)
