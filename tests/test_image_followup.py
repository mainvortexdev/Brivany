"""Owned synthetic image; no network, inference or native input."""
from pathlib import Path
import tempfile
import unittest
import threading
from unittest.mock import Mock,patch
from uuid import uuid4
from PIL import Image
from packages.providers.conversation import ConversationRequest
from services.computer.service import ComputerService
from services.computer.image_followup import edit_request
from tests.test_computer_control import Runtime,Planner

class ImageFollowupTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.service=ComputerService('http://127.0.0.1:1',lambda:None,root=Path(self.temp.name)/'computer',runtime=Runtime(),planner=Planner(),native=True)
        self.addCleanup(self.service.close);self.chat=str(uuid4());self.id=str(uuid4())
        self.path=self.service.workspace/'bird.png';Image.new('RGB',(64,96),'blue').save(self.path)
        self.original=self.path.read_bytes()
        self.service.jobs[self.id]={'id':self.id,'kind':'image','state':'succeeded','phase':'Imagen lista','steps':0,'error':None,'external_calls':0,'cancelled':threading.Event(),'result':{'path':str(self.path),'verified':True},'_conversation_id':self.chat}
        self.service.planner.route=Mock(side_effect=AssertionError('No intent model for a bound explicit edit'))
        self.service.chat=Mock(side_effect=AssertionError('An edit must not turn into a discussion'))
    def value(self,text='Que el pájaro sea rojo',**changes):
        return ConversationRequest(**{'text':text,'consent':True,'conversation_id':self.chat,'retry_job_id':self.id,**changes})
    def test_edit_prepares_before_remote_or_chat_and_requires_grant(self):
        self.service.remote_account=Mock();self.service.remote_account.chat_turn.side_effect=AssertionError('Keep the local artifact')
        events=list(self.service.chat_turn(self.value(),None));self.assertEqual(events[0]['type'],'reference_action')
        ticket=events[0]['ticket'];item=self.service.prepared[ticket]
        self.assertIn('rojo',item['goal']);self.assertIn('Conserva su estilo',item['goal']);self.assertEqual(len(item['references']),1)
        with self.assertRaises(PermissionError):self.service.execute_prepared(ticket,None)
        self.service.enqueue=Mock(return_value={'id':'synthetic-edit'})
        result=self.service.execute_prepared(ticket,self.service.arm()['token'])
        self.assertIn('conservando su estilo',result['acknowledgement'])
        self.assertEqual(self.service.enqueue.call_args.kwargs['conversation_id'],self.chat)
        self.assertTrue(self.service.enqueue.call_args.kwargs['references'][0].data_url.startswith('data:image/'))
        self.assertEqual(self.path.read_bytes(),self.original)
    def test_execution_supplies_reference_to_image_edit_and_keeps_source(self):
        def image(goal,folder,identifier,cancelled,charge,images=None):
            self.assertIn('rojo',goal);self.assertEqual(len(images),1)
            target=self.service.workspace/'red-bird.png';Image.new('RGB',(64,96),'red').save(target)
            return {'path':str(target),'verified':True,'message':'Imagen editada.'}
        self.service.orchestrator.tools.image=Mock(side_effect=image)
        completed=[];self.service.completion_callback=completed.append
        event=list(self.service.chat_turn(self.value(),None))[0]
        created=self.service.execute_prepared(event['ticket'],self.service.arm()['token'])
        job=self.service.jobs[created['id']];self.assertTrue(job['finished'].wait(5));self.assertEqual(job['state'],'succeeded')
        self.assertEqual(job['_conversation_id'],self.chat);self.assertEqual(self.path.read_bytes(),self.original)
        self.service.save_receipt(job);self.assertEqual(len(completed),1);self.assertEqual(completed[0]['conversation_id'],self.chat);self.assertNotIn('goal',completed[0])
        job['parent_id']='synthetic-parent';job.pop('_completion_reported',None);self.service.save_receipt(job);self.assertEqual(len(completed),1)
        self.assertEqual(Image.open(job['result']['path']).getpixel((0,0)),(255,0,0))
    def test_armed_turn_uses_same_preparation_instead_of_direct_execution(self):
        self.service.enqueue=Mock(side_effect=AssertionError('Do not enqueue while routing'))
        self.assertEqual(list(self.service.turn(self.value(),self.service.arm()['token']))[0]['type'],'reference_action')
    def test_restart_recovers_binding_only_from_encrypted_chat_record(self):
        self.service.jobs[self.id].pop('_conversation_id')
        record={'messages':[{'role':'assistant','taskId':self.id,'text':''}]}
        with patch('services.chat_history.ChatHistory') as history:
            history.return_value.get.return_value=record
            self.assertEqual(list(self.service.chat_turn(self.value(),None))[0]['type'],'reference_action')
            history.return_value.get.assert_called_once_with(self.chat)
    def test_other_chat_or_untrusted_text_history_cannot_bind_the_image(self):
        from services.computer.image_followup import prepare
        with patch('services.chat_history.ChatHistory') as history:
            history.return_value.get.return_value={'messages':[]}
            value=self.value(conversation_id=str(uuid4()),history=[{'role':'assistant','content':'Ya generé la imagen.'}])
            self.assertIsNone(prepare(self.service,value))
        self.assertEqual(self.service.prepared,{})
    def test_missing_or_unverified_artifact_never_claims_an_edit_or_asks_style(self):
        self.path.unlink()
        events=list(self.service.chat_turn(self.value(),None))
        self.assertIn('Vuelve a adjuntarla',events[-1]['text']);self.assertEqual(self.service.prepared,{})
    def test_pending_image_does_not_start_a_second_task(self):
        self.service.jobs[self.id]['state']='running'
        self.assertIn('sigue en preparación',list(self.service.chat_turn(self.value(),None))[-1]['text'])
        self.assertEqual(self.service.prepared,{})
    def test_reference_keeps_transparency_and_aspect_instead_of_flattening_background(self):
        import base64
        from io import BytesIO
        for palette in [False,True]:
            image=Image.new('RGBA',(64,96),(120,0,0,0))
            if palette:image=image.convert('P')
            image.save(self.path,'PNG')
            event=list(self.service.chat_turn(self.value(),None))[0]
            data=self.service.prepared[event['ticket']]['references'][0].data_url
            with Image.open(BytesIO(base64.b64decode(data.split(',')[1]))) as reference:
                self.assertEqual(reference.size,(64,96));self.assertEqual(reference.convert('RGBA').getpixel((0,0))[3],0)
    def test_visual_commands_and_questions_are_distinguished(self):
        for text in ['Que el pájaro sea rojo','Hazlo más pequeño','Cambia el fondo a blanco','Melodi, añade una nube','Haz el pájaro rojo','Que sea rojo','Ahora con fondo blanco','Ponlo verde','¿Puedes hacer el pájaro rojo?','Quiero que sea rojo']:
            self.assertTrue(edit_request(text),text)
        for text in ['¿Por qué el pájaro es rojo?','No cambies el fondo','Si fuera rojo, ¿cómo se vería?','Cambia el volumen','Que la ventana sea roja','Cómo cambiar el fondo','Haz una nueva imagen de un pájaro rojo']:
            self.assertFalse(edit_request(text),text)

if __name__=='__main__':unittest.main()
