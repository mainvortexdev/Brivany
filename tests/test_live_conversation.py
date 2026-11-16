"""Vetsa behavior adapted locally; planners, providers and native input substituted."""
from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from desktop.launcher import LocalDesktopServer
from desktop.experience.launcher import experience_handler
from packages.providers.conversation import ConversationRequest, stream_reply
from services.h1.server import Handler, acquire_voice_slot, release_voice_slot
from services.computer.service import ComputerService, ComputerRequestError, ordinary_live_conversation
from services.voice_cues import cue_path, read_cue
from tests.test_computer_control import Runtime, Planner


class LiveConversationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.runtime=Runtime();self.planner=Planner()
        self.service=ComputerService('http://127.0.0.1:1',lambda:None,root=Path(self.temp.name),runtime=self.runtime,planner=self.planner,native=True)
        self.addCleanup(self.service.close)

    def test_conversational_voice_has_no_intent_model_round_trip(self):
        self.planner.route=Mock(side_effect=AssertionError('A conversation must not call the router'))
        self.service.chat=Mock(return_value=iter([{'type':'delta','text':'Respuesta sintética.'}]))
        value=ConversationRequest(text='Explícame por qué el cielo cambia de color.',source='voice',consent=True)
        self.assertEqual(list(self.service.chat_turn(value,None))[0]['type'],'delta')
        self.planner.route.assert_not_called();self.service.chat.assert_called_once();self.assertEqual(self.runtime.calls,[])
    def test_written_conversation_skips_classifier_without_bypassing_action_routing(self):
        self.planner.route=Mock(side_effect=AssertionError('No classifier for ordinary written dialogue'))
        self.service.chat=Mock(return_value=iter([{'type':'done'}]))
        list(self.service.chat_turn(ConversationRequest(text='Dices que eres humana, pero eres una IA.',consent=True),None))
        self.planner.route.assert_not_called();self.assertFalse(ordinary_live_conversation(ConversationRequest(text='Abre Paint',consent=True)))
    def test_ordinary_written_context_avoids_the_full_capability_catalog(self):
        self.service.catalog=Mock(side_effect=AssertionError('No full catalog for small talk'))
        with patch('packages.providers.conversation.stream_reply',return_value=iter([{'type':'done'}])) as reply:
            list(self.service.chat(ConversationRequest(text='¿Qué piensas de la creatividad?',consent=True),None))
        self.assertLess(len(json.dumps(reply.call_args.kwargs['context'])),6000)
    def test_personal_assistant_profile_reaches_the_written_chat_context(self):
        profile={'assistant_name':'Melodi','owner_name':'Titular de prueba','role':'personal_assistant','scope':'local_owner'}
        with patch('services.assistant_identity.local_context',return_value=profile),patch('packages.providers.conversation.stream_reply',return_value=iter([])) as reply:
            list(self.service.chat(ConversationRequest(text='¿De quién eres asistente?',consent=True),None))
        self.assertEqual(reply.call_args.kwargs['context']['assistant_identity'],profile)
        self.assertIn('asistente personal',reply.call_args.kwargs['instructions'])

    def test_actions_still_use_the_router_and_do_not_execute_during_routing(self):
        text='Melodi, reproduce música instrumental en YouTube.'
        self.planner.route=Mock(return_value={'kind':'desktop','goal':text})
        value=ConversationRequest(text=text,source='voice',consent=True)
        events=list(self.service.chat_turn(value,None));self.planner.route.assert_called_once()
        self.assertEqual(events[0]['type'],'reference_action');self.assertEqual(self.runtime.calls,[])
        self.runtime.availability=lambda:{'available':False}
        token=self.service.arm()['token']
        with self.assertRaises(ComputerRequestError) as caught:self.service.execute_prepared(events[0]['ticket'],token)
        self.assertEqual(caught.exception.code,'computer_backend_unavailable');self.assertEqual(self.service.jobs,{})

    def test_task_like_requests_never_take_the_conversation_shortcut(self):
        for text in ['Necesito que edites mi borrador','¿Puedes abrir Paint?','Pon música en YouTube','¿Cuántos correos tengo?','Quiero organizar archivos','Busca el clima actual','Cambia el volumen','Enciende Bluetooth','Reproducir música','Mostrar ficheros']:
            self.assertFalse(ordinary_live_conversation(ConversationRequest(text=text,source='voice',consent=True)),text)

    def test_live_context_keeps_active_human_skill_without_loading_full_catalog(self):
        self.service.catalog=Mock(side_effect=AssertionError('Full catalog is not needed for a voice reply'))
        self.service.skills.context=Mock(return_value={'context':{'skill_id':'fixture-skill'},'instructions':'Instrucción propia de práctica.'})
        with patch('packages.providers.conversation.stream_reply',return_value=iter([])) as reply:
            list(self.service.chat(ConversationRequest(text='Ayúdame a ensayar.',source='voice',consent=True),None))
        options=reply.call_args.kwargs
        self.assertEqual(options['context']['active_human_skill'],{'skill_id':'fixture-skill'})
        self.assertIn('Instrucción propia',options['instructions']);self.service.catalog.assert_not_called()

    def test_backend_failure_has_a_specific_http_message_and_never_retries(self):
        with LocalDesktopServer(handler=experience_handler(Handler)) as server:
            server.http.computer=self.service
            import threading
            server.http.computer_lock=threading.RLock()
            token=self.service.arm()['token'];self.runtime.availability=lambda:{'available':False}
            value=ConversationRequest(text='Pon música en YouTube.',source='voice',consent=True)
            ticket=list(self.service.chat_turn(value,token))[0]['ticket']
            connection=HTTPConnection('127.0.0.1',server.http.server_port,timeout=3)
            try:
                connection.request('POST','/api/computer/execute-prepared',json.dumps({'ticket':ticket}),{'Content-Type':'application/json','X-Brivany-Control':token,'Origin':server.base_url})
                response=connection.getresponse();body=json.loads(response.read())
                self.assertEqual(response.status,503);self.assertEqual(body['error']['code'],'computer_backend_unavailable')
                self.assertIn('versión verificada',body['error']['message']);self.assertEqual(self.runtime.calls,[])
            finally:connection.close()


class SpeechPipelineTests(unittest.TestCase):
    def test_final_token_can_also_carry_the_stream_completion(self):
        import io
        frame={'choices':[{'delta':{'content':'Una respuesta completa.'},'finish_reason':'stop'}]}
        with patch.dict('os.environ',{'BRIVANY_META_API_KEY':'fixture','BRIVANY_META_MODEL':'fixture'}),patch('packages.providers.conversation.build_opener') as opener:
            opener.return_value.open.return_value=io.BytesIO(b'data: '+json.dumps(frame).encode()+b'\n\n')
            events=list(stream_reply(ConversationRequest(text='Explica algo.',source='voice',consent=True),instructions='Instrucción propia',context={}))
            self.assertEqual(events[-1]['type'],'done')

    def test_live_synthesis_allows_three_segments_of_one_turn_and_excludes_other_owners(self):
        group='00000000-0000-4000-8000-000000000112';held=0
        try:
            for _ in range(3):self.assertTrue(acquire_voice_slot(group));held+=1
            self.assertFalse(acquire_voice_slot(group));self.assertFalse(acquire_voice_slot('other'));self.assertFalse(acquire_voice_slot())
        finally:
            for _ in range(held):release_voice_slot()
        self.assertTrue(acquire_voice_slot());release_voice_slot()

    def test_live_emits_its_first_short_phrase_before_waiting_for_the_model_end(self):
        class Wire:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def __iter__(self):
                for text in ['Una idea útil. ','La segunda es clara. ','El resto sigue.']:
                    yield b'data: '+json.dumps({'choices':[{'delta':{'content':text}}]}).encode()+b'\n\n'
                yield b'data: '+json.dumps({'choices':[{'delta':{},'finish_reason':'stop'}]}).encode()+b'\n\n'
        with patch.dict('os.environ',{'BRIVANY_META_API_KEY':'fixture','BRIVANY_META_MODEL':'fixture'}),patch('packages.providers.conversation.build_opener') as opener:
            opener.return_value.open.return_value=Wire()
            stream=stream_reply(ConversationRequest(text='Explica algo sencillo.',source='voice',consent=True),instructions='Instrucción de prueba',context={})
            self.assertEqual(next(stream)['type'],'delta');self.assertEqual(next(stream),{'type':'sentence','text':'Una idea útil.'})
            rest=list(stream);self.assertEqual(len([event for event in rest if event['type']=='sentence']),2)
            self.assertEqual(json.loads(opener.return_value.open.call_args.args[0].data)['max_completion_tokens'],256)

    def test_fixed_cue_reader_never_synthesizes_and_rejects_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            path=cue_path('es','aja',temp);path.write_bytes(b'\x01\x00'*100)
            self.assertEqual(read_cue('es','aja',temp),b'\x01\x00'*100)
            for key in ('../secret','anything','/aja'):
                with self.assertRaises(ValueError):read_cue('es',key,temp)

    def test_cue_http_serves_only_prepared_pcm_without_provider_calls(self):
        from unittest.mock import patch
        from services.voice_cues import CUES
        self.assertEqual(len(CUES['es']),16)
        with tempfile.TemporaryDirectory() as temp,patch('services.voice_cues.ROOT',Path(temp)),patch('services.h1.server.open_melodi') as synthesize,LocalDesktopServer(handler=experience_handler(Handler)) as server:
            raw=b'\x01\x00'*100;cue_path('es','te_sigo',temp).write_bytes(raw)
            connection=HTTPConnection('127.0.0.1',server.http.server_port,timeout=3)
            try:
                connection.request('GET','/api/voice/cue/es/te_sigo');response=connection.getresponse();self.assertEqual(response.status,200);self.assertEqual(response.read(),raw)
                self.assertTrue(response.getheader('Content-Type').startswith('audio/pcm'))
                connection.request('GET','/api/voice/cue/es/aja');response=connection.getresponse();self.assertEqual(response.status,404);response.read();synthesize.assert_not_called()
            finally:connection.close()


if __name__=='__main__':unittest.main()
