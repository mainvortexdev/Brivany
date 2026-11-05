"""Synthetic images and local specialist coordination, no paid model or native input."""
import base64
from io import BytesIO
import json
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import Mock,patch
from types import SimpleNamespace
from PIL import Image
from tests import test_computer_control as fixtures
from services.computer.references import ReferenceStore,ImageTurnRequest
from services.computer.agents import publish_document,personal_plan
from packages.providers.conversation import ConversationRequest
from desktop.launcher import LocalDesktopServer
from desktop.experience.launcher import experience_handler
from services.h1.server import Handler
from urllib.request import Request,urlopen
from urllib.error import HTTPError


def image_url(color='#36a18a'):
    output=BytesIO();Image.new('RGB',(64,48),color).save(output,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(output.getvalue()).decode()


class ReferencesTests(unittest.TestCase):
    def test_real_decode_normalization_expiry_and_removal(self):
        clock=[0];store=ReferenceStore(now=lambda:clock[0],ttl=30);item=store.add(image_url())
        value=store.get_many([item['id']])[0]
        self.assertEqual((value.width,value.height),(64,48));self.assertTrue(value.data_url.startswith('data:image/png;'))
        with Image.open(BytesIO(base64.b64decode(value.data_url.split(',')[1]))) as decoded:
            self.assertEqual(decoded.getpixel((30,20)),(54,161,138))
        self.assertNotIn('data_url',item);clock[0]=31
        with self.assertRaises(ValueError):store.get_many([item['id']])
        self.assertEqual(store.values,{})
        item=store.add(image_url());store.remove(item['id']);self.assertEqual(store.values,{})
    def test_invalid_images_and_request_cannot_be_actions(self):
        store=ReferenceStore()
        for value in ['<svg onload="bad">','data:image/png;base64,aW52YWxpZA==',image_url()+'!','x'*2200001]:
            with self.subTest(value=value[:30]),self.assertRaises(ValueError):store.add(value)
        key=store.add(image_url())['id']
        for data in [{'reference_ids':[key,key]},{'reference_ids':[key],'active_reference_id':'x'*32},{'reference_ids':['../../x']}]:
            with self.assertRaises(ValueError):ImageTurnRequest(text='fixture',consent=True,**data)


class ImagesAndAgentsTests(fixtures.ComputerTests):
    # Reuse the same isolated native/planner/spatial fixtures, without inheriting tests.
    def wait(self,job):
        value=super().wait(job)
        self.assertTrue(value['finished'].wait(4));return value
    def reference(self):return self.service.references.add(image_url())['id']
    def turn(self,key):return ImageTurnRequest(text='referencia fixture',consent=True,reference_ids=[key],active_reference_id=key)
    def test_vision_reads_pixels_without_activating_computer(self):
        self.planner.route_kind='chat';seen=[]
        self.planner.generate=lambda prompt,data,**kw:seen.append(kw) or {'message':'Descripción sintética de la imagen.'}
        events=list(self.service.image_turn(self.turn(self.reference()),None))
        self.assertIn('Descripción sintética',events[-1]['text']);self.assertTrue(seen[0]['images'][0].startswith('data:image/png;'))
        self.assertFalse(self.service.grant);self.assertEqual(self.runtime.calls,[])
    def test_reference_ticket_requires_grant_and_is_one_use(self):
        self.planner.route_kind='model';key=self.reference();events=list(self.service.image_turn(self.turn(key),None));ticket=events[0]['ticket']
        self.assertEqual(self.service.jobs,{})
        with self.assertRaises(PermissionError):self.service.execute_prepared(ticket,'bad')
        token=self.service.arm()['token'];self.service.publisher=lambda *args:{'scene_id':'fixture','conceptual':True}
        job=self.service.execute_prepared(ticket,token);self.assertEqual(self.wait(job)['state'],'succeeded')
        with self.assertRaises(ValueError):self.service.execute_prepared(ticket,token)
        raw=(self.service.receipts/(job['id']+'.json')).read_text(encoding='utf-8');self.assertNotIn('data:image',raw);self.assertNotIn(key,raw)
    def test_model_receives_reference_and_representation(self):
        key=self.reference();seen=[];original=self.planner.generate
        self.planner.generate=lambda prompt,data,**kw:seen.append((prompt,data,kw)) or original(prompt,data,**kw)
        self.service.publisher=lambda *args:{'scene_id':'fixture','conceptual':True};token=self.service.arm()['token']
        job=self.service.enqueue('model','Plano sintético',token,references=self.service.references.get_many([key]),representation='plan')
        result=self.wait(job);self.assertEqual(result['result']['representation'],'plan');self.assertEqual(result['result']['references_used'],1)
        self.assertTrue(seen[0][2]['images'][0].startswith('data:image/png;'));self.assertIn('referencias visuales',seen[0][0])
    def test_paint_gets_private_reference_outside_planner_params(self):
        key=self.reference();token=self.service.arm()['token']
        self.planner.generate=lambda prompt,data,**kw:({'done':True} if data.get('completed_steps') else {'done':False,'step':{'action':'draw_paint','params':{'instruction':'Fixture'}}})
        job=self.service.enqueue('desktop','Fixture dibujo',token,references=self.service.references.get_many([key]),active_reference_id=key)
        self.assertEqual(self.wait(job)['state'],'succeeded');call=next(args for method,args in self.runtime.calls if method=='execute')
        self.assertTrue(call['reference_image'].startswith('data:image/png;'));self.assertNotIn('reference_image',call['step']['params'])
        self.assertNotIn('data:image',(self.service.receipts/(job['id']+'.json')).read_text())
    def test_document_finishes_while_model_is_busy_and_review_survives(self):
        token=self.service.arm()['token'];entered=threading.Event();release=threading.Event();original=self.planner.generate
        def generate(prompt,data,**kw):
            if 'agente de redacción' in prompt:return {'title':'Documento sintético','body':'Texto literal <script>alert(1)</script>.'}
            return original(prompt,data,**kw)
        self.planner.generate=generate
        def publish(*args):entered.set();release.wait(4);return {'scene_id':'fixture','conceptual':True}
        self.service.publisher=publish
        try:
            model=self.service.enqueue('model','Fixture modelo',token);self.assertTrue(entered.wait(2))
            document=self.service.enqueue('document','Fixture documento',token);result=self.wait(document)
            self.assertEqual(result['state'],'succeeded');self.assertIn(self.service.jobs[model['id']]['state'],{'planning','running'})
            page=(self.service.workspace/'documents'/(document['id']+'.html')).read_text(encoding='utf-8');self.assertNotIn('<script>',page);self.assertIn('&lt;script&gt;',page)
            self.assertTrue(self.service.review(document['id'])['reviewed'])
        finally:release.set()
        self.wait(model)
    def test_desktop_queue_and_cancelled_waiter_do_not_interrupt_owner(self):
        token=self.service.arm()['token'];entered=threading.Event();release=threading.Event();original=self.runtime.call
        def call(method,**kw):
            if method=='observe':entered.set();release.wait(4)
            return original(method,**kw)
        self.runtime.call=call
        try:
            first=self.service.enqueue('desktop','Fixture A',token);self.assertTrue(entered.wait(2))
            second=self.service.enqueue('desktop','Fixture B',token);self.assertEqual(self.service.jobs[second['id']]['state'],'queued')
            self.service.cancel(second['id']);self.assertEqual(self.runtime.cancelled,0)
        finally:release.set()
        self.wait(first);self.assertEqual(self.wait(second)['state'],'cancelled')
        time.sleep(.03);self.assertEqual(sum(method=='begin_task' for method,args in self.runtime.calls),1)
    def test_personal_agent_never_prepares_account_writes(self):
        with self.assertRaises(ValueError):personal_plan({'operation':'gmail.send','parameters':{}},None,'fixture')
        value=personal_plan({'needs_user':'Mover archivos de Drive todavía no está implementado.'},None,'fixture')
        self.assertTrue(value['requires_user']);self.assertIn('todavía',value['message'])
    def test_reviewed_personal_read_uses_existing_adapter_once_without_persisting_payload(self):
        from services.integrations import IntegrationService
        from packages.providers.personal import GoogleTransport
        oauth=SimpleNamespace(access_token=Mock(return_value='fixture-token'),status=Mock(return_value={'connectors':[{'connector':'drive','authorized':True,'authorized_operations':['drive.search']}]}))
        http=Mock(return_value={'files':[{'id':'fixture-id','name':'PRIVATE-FIXTURE-FILE','mimeType':'text/plain'}]});http.simulation=True
        integration=IntegrationService(Path(self.temp.name)/'connections',config={'execution_enabled':True},env={},transports={'drive':GoogleTransport(oauth,'drive',http=http)})
        self.service.connections_factory=lambda:SimpleNamespace(refresh_settings=lambda:integration)
        self.planner.generate=lambda *a,**k:{'operation':'drive.search','parameters':{'query':'PRIVATE-FIXTURE-QUERY'}}
        token=self.service.arm()['token'];job=self.service.enqueue('personal','Consulta sintética',token);value=self.wait(job)
        self.assertEqual(value['state'],'awaiting_user');http.assert_not_called()
        receipt=self.service.receipts/(job['id']+'.json');self.assertNotIn('PRIVATE-FIXTURE',receipt.read_text(encoding='utf-8'))
        response=self.service.execute_personal(job['id'],token);http.assert_called_once();self.assertTrue(response['job']['result']['simulated']);self.assertIn('PRIVATE-FIXTURE-FILE',json.dumps(response['data']))
        self.assertNotIn('PRIVATE-FIXTURE',receipt.read_text(encoding='utf-8'))
        with self.assertRaises(ValueError):self.service.execute_personal(job['id'],token)
    def test_armed_image_turn_still_cannot_execute_before_client_accepts_ticket(self):
        token=self.service.arm()['token'];events=list(self.service.image_turn(self.turn(self.reference()),token))
        self.assertEqual(events[0]['type'],'reference_action');self.assertEqual(self.service.jobs,{})
    def test_removing_reference_invalidates_prepared_image_and_late_classification(self):
        key=self.reference();ticket=list(self.service.image_turn(self.turn(key),None))[0]['ticket'];self.service.remove_reference(key)
        with self.assertRaises(ValueError):self.service.execute_prepared(ticket,self.service.arm()['token'])
        self.assertEqual(self.service.prepared,{})
        key=self.reference()
        def late(value,cancelled):self.service.remove_reference(key);return {'kind':'model','goal':'Fixture'}
        self.planner.route=late
        with self.assertRaises(ValueError):list(self.service.image_turn(self.turn(key),None))
        self.assertEqual(self.service.prepared,{})
    def test_http_images_require_native_same_origin_and_documents_require_grant(self):
        with LocalDesktopServer(handler=experience_handler(Handler)) as server:
            server.http.computer_lock=threading.RLock();server.http.computer=self.service
            def post(path,body,origin):
                headers={'Content-Type':'application/json'}
                if origin:headers['Origin']=origin
                return urlopen(Request(server.base_url+path,data=json.dumps(body).encode(),headers=headers),timeout=4)
            for origin in [None,'https://foreign.invalid']:
                with self.assertRaises(HTTPError) as error:post('/api/computer/references',{'data_url':image_url()},origin)
                self.assertEqual(error.exception.code,403)
            self.service.native=False
            with self.assertRaises(HTTPError) as error:post('/api/computer/references',{'data_url':image_url()},server.base_url)
            self.assertEqual(error.exception.code,403);self.service.native=True
            with post('/api/computer/references',{'data_url':image_url()},server.base_url) as response:
                item=json.load(response);self.assertEqual(response.status,201);self.assertNotIn('data_url',item)
            self.planner.generate=lambda *a,**k:{'title':'Fixture','body':'Texto literal.'}
            token=self.service.arm()['token'];job=self.service.enqueue('document','Documento fixture',token);self.wait(job)
            with self.assertRaises(HTTPError) as error:urlopen(server.base_url+'/api/computer/document/'+job['id'])
            self.assertEqual(error.exception.code,403)
            with urlopen(Request(server.base_url+'/api/computer/document/'+job['id'],headers={'X-Brivany-Control':token})) as response:
                self.assertIn('Texto literal.',response.read().decode())
    def test_unarmed_chat_routes_action_to_ticket_without_native_input(self):
        events=list(self.service.chat_turn(ConversationRequest(text='Crear nota sintética',consent=True),None))
        self.assertEqual(events[0]['type'],'reference_action');self.assertEqual(self.runtime.calls,[]);self.assertEqual(self.service.jobs,{})
    def test_credential_settings_are_native_only_and_never_echo_the_secret(self):
        with LocalDesktopServer(handler=experience_handler(Handler)) as server,patch('services.h1.server.save_local_secret') as save:
            server.http.computer_lock=threading.RLock();server.http.computer=self.service
            secret='synthetic-key-for-local-test-only'
            def post(provider,origin):return urlopen(Request(server.base_url+'/api/desktop/credentials',data=json.dumps({'provider':provider,'key':secret}).encode(),headers={'Content-Type':'application/json',**({'Origin':origin} if origin else {})}),timeout=4)
            for provider,origin in [('cartesia',None),('unknown',server.base_url),('cartesia','https://foreign.invalid')]:
                with self.assertRaises(HTTPError):post(provider,origin)
            save.assert_not_called()
            with post('cartesia',server.base_url) as response:self.assertEqual(json.load(response),{'saved':True})
            save.assert_called_once_with(secret,'BRIVANY_CARTESIA_API_KEY')


# Only run the new cases here; the original suite remains registered separately.
for name in list(fixtures.ComputerTests.__dict__):
    if name.startswith('test_') and name not in ImagesAndAgentsTests.__dict__:setattr(ImagesAndAgentsTests,name,None)

if __name__=='__main__':unittest.main()
