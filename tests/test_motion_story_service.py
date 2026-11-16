"""Service boundaries with owned fixtures; no model, audio API or CLI render calls."""
from copy import deepcopy
from array import array
import base64
from io import BytesIO
import json
import math
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4
import wave

from PIL import Image
from packages.providers.conversation import ConversationRequest
from services.computer.planner import MetaPlanner, PlanningResponseError
from services.computer.references import ImageTurnRequest
from services.computer.service import ComputerService
from services.motion.story_service import StoryService
from tests.test_computer_control import Runtime, Planner


def plan(*, still=False):
    seconds=5 if still else 15
    return {'version':1,'title':'Historia de prueba','format':'portrait','fps':30,
            'duration':seconds,'voice':False,'music':None,'credits_duration':2 if still else 3,
            'scenes':[{'id':'intro','duration':3 if still else 12,'background':'#fbfcfd',
                       'transition':'cut','narration':'','elements':[{
                           'type':'text','x':10,'y':20,'w':75,'h':20,'text':'Una idea.',
                           'font_size':72,'weight':700,'color':'#0071e3','align':'left'}]}]}


class StoryServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.root=self.base/'motion';self.root.mkdir()
        self.available=patch.object(StoryService,'availability',return_value={'available':True}).start()
        self.addCleanup(patch.stopall)
        self.service=StoryService(self.root);self.addCleanup(self.service.close)
        self.service.library=Mock();self.service.library.catalog.return_value={'videos':[],'music':[]}
        self.commands=[];self.service.command=Mock(side_effect=self.command)
        self.analyzer=patch('services.motion.story_service.ReferenceAnalyzer').start()
        self.analyzer.return_value.analyze.return_value={
            'style':{'summary':'Cortes y tipografía observados.'},'duration_seconds':15,
            'sample_times_seconds':[1,5,10],'audio':{'analyzed':False}}
    def command(self,name,tool,args,folder,cancelled,*other,**kwargs):
        self.commands.append(name)
        if cancelled.is_set():raise ValueError('Fixture cancelled')
        if name=='selected_excerpt':Path(args[-1]).write_bytes(b'owned selected excerpt')
        if name=='snapshot':
            target=Path(args[args.index('--output')+1]);target.mkdir(exist_ok=True)
            Image.new('RGB',(1080,1920),'#fbfcfd').save(target/'frame.png')
        return {'id':'owned-cli-fixture','output':json.dumps({'ok':True})}
    def run_story(self,value,request='Crea un video educativo de 15 segundos',*,identifier=None,selected=()):
        decide=Mock(side_effect=lambda *_a,**_k:deepcopy(value))
        identifier=identifier or str(uuid4())
        result=self.service.run(request,identifier=identifier,decide=decide,cancelled=threading.Event(),
                                selected=selected,roots=[str(self.base)],render=False)
        return identifier,result,decide
    def test_exact_new_reference_duration_overrides_default_and_preserves_measured_dialogue(self):
        from tests.test_call_visuals import call_plan
        value=call_plan();value.update(duration=8.142948,credits_duration=0,timing='reference',disclosure='none')
        for s,d in zip(value['scenes'],[4,4.142948]):s.update(duration=d,speech_offset=.3,speech_duration=2.6)
        selected=self.base/'reference.mp4';selected.write_bytes(b'owned fixture: analyzer is mocked')
        self.analyzer.return_value.analyze.return_value.update(duration_seconds=8.142948)
        self.service._voice=Mock(return_value=[{'scene_id':s['id'],'duration':2.6,'speaker':s['speaker']} for s in value['scenes']])
        self.service._audio=Mock(return_value=None)
        identifier,result,decide=self.run_story(value,'Que dure exactamente lo que dura la nueva referencia y conserve el guion.',selected=[str(selected)])
        self.assertEqual(decide.call_args.args[1]['required_duration'],8.142948)
        saved=json.loads((self.root/identifier/'story.json').read_text(encoding='utf-8'))
        self.assertEqual(saved,value);self.assertFalse((self.root/identifier/'compositions/story-credits.html').exists())
    def computer(self,*,planner=None):
        planner=planner or Planner()
        if hasattr(planner,'route_kind'):planner.route_kind='motion'
        computer=ComputerService('http://127.0.0.1:1',lambda:None,root=self.base/'computer',
                                 planner=planner,runtime=Runtime(),native=True)
        self.addCleanup(computer.close)
        calls=[]
        class MotionFixture:
            def __init__(self,*args):pass
            def run(self,goal,**kwargs):
                calls.append(kwargs)
                kwargs['decide']('Owned creative context',{},images=['data:image/png;base64,owned'])
                return {'verified':True,'title':'Owned fixture','message':'Fixture completed'}
            def close(self):pass
        computer.motion_factory=MotionFixture
        planner.generate=Mock(return_value={'fixture':'planned'})
        return computer,planner,calls
    def test_prepared_chat_freezes_selected_files_and_roots_and_accepts_image_callback(self):
        computer,planner,calls=self.computer()
        first=self.base/'first.mp4';second=self.base/'second.mp4';first.write_bytes(b'first');second.write_bytes(b'second')
        computer.select_edits_inputs([str(first)]);token=computer.arm()['token'];original_roots=tuple(computer.roots)
        events=list(computer.chat_turn(ConversationRequest(text='Crea un video con la referencia',consent=True),token))
        computer.select_edits_inputs([str(second)]);new_folder=self.base/'later';new_folder.mkdir();computer.roots.append(str(new_folder))
        job=computer.execute_prepared(events[0]['ticket'],token);self.assertTrue(computer.jobs[job['id']]['finished'].wait(3))
        self.assertEqual(computer.jobs[job['id']]['state'],'succeeded')
        self.assertEqual(calls[0]['selected'],(str(first),));self.assertEqual(tuple(calls[0]['roots']),original_roots)
        self.assertEqual(planner.generate.call_args.kwargs['images'],['data:image/png;base64,owned'])
    def test_prepared_image_turn_also_freezes_its_media_selection(self):
        computer,_,calls=self.computer();first=self.base/'first.mp4';second=self.base/'second.mp4'
        first.write_bytes(b'first');second.write_bytes(b'second');computer.select_edits_inputs([str(first)])
        raw=BytesIO();Image.new('RGB',(64,64),'blue').save(raw,'PNG')
        ref=computer.references.add('data:image/png;base64,'+base64.b64encode(raw.getvalue()).decode())
        token=computer.arm()['token'];original_roots=tuple(computer.roots)
        request=ImageTurnRequest(text='Crea una ilustración estilo Brivany',consent=True,reference_ids=[ref['id']])
        prepared=list(computer.image_turn(request,token))[0]
        computer.select_edits_inputs([str(second)]);computer.roots.append(str(self.base))
        job=computer.execute_prepared(prepared['ticket'],token);self.assertTrue(computer.jobs[job['id']]['finished'].wait(3))
        self.assertEqual(calls[0]['selected'],(str(first),));self.assertEqual(tuple(calls[0]['roots']),original_roots)
    def test_quoted_creation_question_does_not_enqueue_or_execute_a_story(self):
        planner=MetaPlanner();computer=ComputerService('http://127.0.0.1:1',lambda:None,root=self.base/'quoted',
                                                    planner=planner,runtime=Runtime(),native=True)
        self.addCleanup(computer.close)
        text='¿Qué significa la frase «Crea una ilustración para Instagram»? Sólo explícala.'
        planner.generate=Mock(return_value={'kind':'chat','goal':text})
        computer.chat=Mock(return_value=iter([{'type':'done','text':'Es un ejemplo citado.'}]))
        events=list(computer.chat_turn(ConversationRequest(text=text,consent=True),'unused'))
        self.assertEqual(events[-1]['type'],'done');self.assertEqual(computer.jobs,{})
        self.assertEqual(computer.prepared,{});self.service.command.assert_not_called()
    def test_new_project_is_editable_and_reusing_its_id_cannot_overwrite_it(self):
        identifier,result,decide=self.run_story(plan())
        folder=self.root/identifier;before=(folder/'story.json').read_bytes()
        self.assertEqual(json.loads(before),plan());self.assertTrue(Path(result['project_path']).is_file())
        self.assertFalse(result['verified']);self.assertFalse((folder/'Brivany.mp4').exists())
        with self.assertRaises(FileExistsError):
            self.service.run('Crea otro video de 15 segundos',identifier=identifier,decide=decide,cancelled=threading.Event(),render=False)
        self.assertEqual((folder/'story.json').read_bytes(),before);self.assertEqual(decide.call_count,1)
    def test_revision_supplies_previous_plan_and_keeps_original_files_intact(self):
        old_id,_,_=self.run_story(plan());old=self.root/old_id
        original={name:(old/name).read_bytes() for name in ('story.json','index.html','authorship.json')}
        revised=plan();revised['scenes'][0]['elements'][0]['text']='Una idea revisada.'
        new_id,_,decide=self.run_story(revised,'Modifica el texto del video anterior')
        self.assertEqual(decide.call_args.args[1]['previous_story'],plan())
        self.assertNotEqual(old_id,new_id)
        self.assertEqual(json.loads((self.root/new_id/'authorship.json').read_text())['parent_project'],old_id)
        for name,raw in original.items():self.assertEqual((old/name).read_bytes(),raw)
    def test_revision_reuses_owned_selected_clip_without_requiring_it_again(self):
        source=self.base/'owned-reference.mp4';source.write_bytes(b'owned original file')
        first=plan();first['scenes'][0]['elements'].insert(0,{
            'type':'film','x':10,'y':45,'w':75,'h':35,'asset_id':'selected:0',
            'source_start':2,'position':50,'fit':'cover'})
        old_id,_,_=self.run_story(first,selected=(str(source),))
        old_clip=(self.root/old_id/'assets/intro-0.mp4').read_bytes()
        revised=deepcopy(first);revised['scenes'][0]['elements'][1]['text']='Sólo cambia este título.'
        new_id,_,_=self.run_story(revised,'Modifica el título del video anterior')
        self.assertEqual((self.root/new_id/'assets/intro-0.mp4').read_bytes(),old_clip)
        self.assertEqual(self.commands.count('selected_excerpt'),1)
        self.assertEqual(self.analyzer.return_value.analyze.call_count,1)
        self.assertEqual(source.read_bytes(),b'owned original file')
    def test_revision_preserves_measured_reference_through_parent_chain_without_reanalysis(self):
        first_id,_,_=self.run_story(plan());first=self.root/first_id
        measured={'duration_seconds':15,'sample_times_seconds':[1,5,10],
                  'style':{'summary':'Diseño editorial observado.'}}
        reference=first/'reference-owned';reference.mkdir()
        (reference/'reference-report.json').write_text(json.dumps(measured),encoding='utf-8')
        second=self.root/str(uuid4());second.mkdir()
        (second/'authorship.json').write_text(json.dumps({'parent_project':first_id}),encoding='utf-8')
        self.assertEqual(self.service._inherited_reference(second),measured)
        new_id,_,decide=self.run_story(plan(),'Modifica el título del video anterior')
        self.assertEqual(decide.call_args.args[1]['reference']['style'],measured['style'])
        self.assertEqual(json.loads((self.root/new_id/'reference-profile.json').read_text(encoding='utf-8')),measured)
        self.analyzer.return_value.analyze.assert_not_called()
    def test_story_availability_does_not_require_legacy_templates(self):
        from services.motion.service import MotionService
        with patch('services.motion.service.source_status',return_value={'installed':False}),patch.object(StoryService,'availability',return_value={'available':True,'edition':3}):
            status=MotionService.availability()
        self.assertTrue(status['available']);self.assertEqual(status['edition'],3)
        self.assertFalse(status['legacy_available']);self.assertIn('story',status['scene_families'])
    def test_one_minute_horizontal_is_sixty_seconds_and_has_product_context(self):
        value=plan();value.update(duration=60,format='landscape');value['scenes'][0]['duration']=30
        second=deepcopy(value['scenes'][0]);second.update(id='second',duration=27);value['scenes'].append(second)
        _,_,decide=self.run_story(value,'Crea un trailer de Cognira Desktop, Vetsa AI y Brivany de 1 minuto en horizontal')
        context=decide.call_args.args[1]
        self.assertEqual(context['required_duration'],60);self.assertEqual(context['required_format'],'landscape')
        self.assertIn('Cognira Desktop',context['known_products']);self.assertIn('Vetsa AI',context['known_products'])
    def test_wrong_format_is_rejected_before_rendering_instead_of_silent_delivery(self):
        with self.assertRaises(ValueError):self.run_story(plan(),'Crea un video de 15 segundos horizontal')
        self.service.command.assert_not_called()
    def test_invalid_model_json_is_corrected_within_the_existing_three_draft_budget(self):
        decide=Mock(side_effect=[PlanningResponseError('Plan incompleto.',truncated=True),deepcopy(plan())])
        progress=[]
        result=self.service.run('Crea un video de 15 segundos',identifier=str(uuid4()),decide=decide,cancelled=threading.Event(),progress=progress.append,render=False)
        self.assertFalse(result['verified']);self.assertEqual(decide.call_count,2)
        self.assertIn('validation_feedback',decide.call_args.args[1]);self.assertTrue(any('corrigiendo' in p for p in progress))
        self.assertNotIn('render',self.commands)
    def test_persistent_bad_json_stops_before_voice_and_render_with_a_readable_error(self):
        decide=Mock(side_effect=PlanningResponseError('El formato generado es inválido.'))
        with patch('packages.providers.cartesia_melodi.open_cartesia_speech') as voice:
            with self.assertRaisesRegex(ValueError,'tres intentos'):
                self.service.run('Crea un video de 15 segundos',identifier=str(uuid4()),decide=decide,cancelled=threading.Event(),render=False)
            voice.assert_not_called()
        self.assertEqual(decide.call_count,3);self.service.command.assert_not_called()
    def test_planner_rejects_truncation_and_invalid_json_without_exposing_parser_text(self):
        class Opener:
            def __init__(self,choice):self.choice=choice
            def open(self,*args,**kwargs):return BytesIO(json.dumps({'choices':[self.choice]}).encode())
        with patch.dict('os.environ',{'BRIVANY_META_API_KEY':'synthetic','BRIVANY_META_MODEL':'synthetic'}):
            for finish,text in [('length','{"scenes":['),('stop','{"private":"example" "oops":1}')]:
                planner=MetaPlanner(Opener({'finish_reason':finish,'message':{'content':text}}))
                with self.assertRaises(PlanningResponseError) as raised:planner.generate('Synthetic draft',{})
                self.assertEqual(raised.exception.truncated,finish=='length');self.assertNotIn('Expecting',str(raised.exception));self.assertNotIn('private',str(raised.exception))
    def test_noncanonical_reference_outside_scope_is_denied_before_analysis(self):
        allowed=self.base/'allowed';allowed.mkdir();outside=self.base/'outside.mp4';outside.write_bytes(b'private fixture')
        noncanonical=str(allowed/'..'/'outside.mp4');folder=self.root/str(uuid4());folder.mkdir()
        with self.assertRaises(ValueError):
            self.service._references((noncanonical,),[str(allowed)],folder,Mock(),threading.Event(),lambda:None,lambda _s:None)
        self.analyzer.assert_not_called();self.service.command.assert_not_called()
    def test_excessive_narration_gets_bounded_feedback_before_any_voice_request(self):
        value=plan();value['voice']=True;value['scenes'][0]['narration']='palabra '*60
        decide=Mock(side_effect=lambda *_a,**_k:deepcopy(value))
        with patch('packages.providers.cartesia_melodi.open_cartesia_speech') as voice:
            with self.assertRaises(ValueError):
                self.service.run('Crea un video de 15 segundos con voz de Melodi',identifier=str(uuid4()),
                                 decide=decide,cancelled=threading.Event(),render=False)
            voice.assert_not_called()
        self.assertEqual(decide.call_count,3);self.assertIn('validation_feedback',decide.call_args.args[1])
        self.service.command.assert_not_called()
        # A silent candidate also contradicts an explicit voice request. This
        # case is safe without mocking TTS: voice=False has no provider path.
        silent=plan();silent_decide=Mock(side_effect=lambda *_a,**_k:deepcopy(silent))
        with self.assertRaises(ValueError):
            self.service.run('Crea un video de 15 segundos con voz de Melodi',identifier=str(uuid4()),
                             decide=silent_decide,cancelled=threading.Event(),render=False)
        self.assertEqual(silent_decide.call_count,3);self.service.command.assert_not_called()
    def test_cancellation_before_start_does_not_plan_or_inspect_selected_media(self):
        cancel=threading.Event();cancel.set();decide=Mock();require=Mock();identifier=str(uuid4())
        with self.assertRaises(ValueError):
            self.service.run('Crea un video de 15 segundos',identifier=identifier,decide=decide,
                             cancelled=cancel,require=require,selected=(str(self.base/'missing.mp4'),))
        decide.assert_not_called();require.assert_not_called();self.analyzer.assert_not_called()
        self.service.command.assert_not_called();self.assertFalse((self.root/identifier).exists())
    def test_static_story_delivers_a_png_and_an_existing_review_project(self):
        identifier,result,_=self.run_story(plan(still=True),'Crea una ilustración para historia de Instagram')
        self.assertEqual(Path(result['path']),self.root/identifier/'Brivany.png')
        self.assertTrue(result['verified']);self.assertFalse(result['audio'])
        self.assertTrue(Path(result['project_path']).is_file())
        self.assertTrue(Path(result['standalone_path']).is_file())
    @unittest.skipUnless(shutil.which('ffmpeg'),'FFmpeg is required for the local audio regression')
    def test_real_ffmpeg_mixes_selected_music_and_voice_with_valid_fade_durations(self):
        # Regression for the real FFmpeg 9 failure: afade requires 0.03/0.65,
        # not .03/.65. Only synthetic local tones are processed here.
        rate=24000
        def tone(path,seconds,frequency):
            samples=array('h',(round(2400*math.sin(2*math.pi*frequency*i/rate))
                               for i in range(round(seconds*rate))))
            with wave.open(str(path),'wb') as target:
                target.setparams((1,2,rate,0,'NONE','not compressed'));target.writeframes(samples.tobytes())
        music=self.base/'synthetic-music.wav';voice=self.base/'synthetic-voice.wav'
        tone(music,5,220);tone(voice,.5,660)
        value=plan(still=True);value.update(voice=True,music={'asset_id':'selected:0','start':0})
        folder=self.root/str(uuid4());folder.mkdir();(folder/'assets').mkdir()
        segments=[{'path':str(voice),'start':.5,'duration':.5,'text':'Synthetic fixture','scene_id':'intro'}]
        actual_command=StoryService.command.__get__(self.service,StoryService)
        with patch.object(self.service,'command',actual_command):
            result=self.service._audio(value,folder,(str(music),),segments,threading.Event(),lambda:None)
        self.assertTrue(result['full_mix'])
        with wave.open(result['path'],'rb') as mixed:
            self.assertEqual(mixed.getnchannels(),2);self.assertEqual(mixed.getframerate(),48000)
            self.assertAlmostEqual(mixed.getnframes()/mixed.getframerate(),5,delta=.01)
            samples=array('h');samples.frombytes(mixed.readframes(mixed.getnframes()))
        self.assertGreater(max(map(abs,samples)),100)
        self.service.library.fetch_music.assert_not_called()


if __name__=='__main__':unittest.main()
