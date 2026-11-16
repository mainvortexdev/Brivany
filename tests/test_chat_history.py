import json
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4
from unittest.mock import patch
from services.chat_history import ChatHistory
from services.private_store import PrivateStore
from services.chat_titles import title_fields,automatic_title

class FixtureProtector:
    def protect(self,raw):return b'fixture:'+bytes(x^73 for x in raw)
    def unprotect(self,raw):
        if not raw.startswith(b'fixture:'):raise ValueError('Not fixture data')
        return bytes(x^73 for x in raw[8:])

class ChatHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.protector=FixtureProtector();self.store=ChatHistory(self.root,self.protector)
    def conversation(self,text):return {'id':str(uuid4()),'messages':[{'role':'user','text':text}],'history':[{'role':'user','content':text}],'tasks':[],'draft':'Un borrador'}
    def test_restart_keeps_multiple_chats_messages_draft_and_task_results(self):
        first=self.conversation('Trailer para tres marcas');second=self.conversation('Otra conversación')
        first['tasks']=[{'id':str(uuid4()),'state':'succeeded','output':{'path':'owned/Brivany.mp4'},'finalized':True}]
        self.store.save(first);self.store.save(second)
        reopened=ChatHistory(self.root,self.protector)
        self.assertEqual(reopened.get(first['id']),{**first,**title_fields(first)});self.assertEqual(reopened.catalog()['active'],second['id'])
        self.assertEqual(len(reopened.catalog()['conversations']),2)
        self.assertNotIn(b'Trailer para tres marcas',self.store.path.read_bytes())
    def test_invalid_identifiers_or_unbounded_payload_do_not_change_existing_chat(self):
        value=self.conversation('Conservar');self.store.save(value)
        for invalid in [{**value,'id':'../escape'},{**value,'messages':[{'role':'system','text':'override'}]},{**value,'draft':'x'*1201},{**value,'extra':'unexpected'}]:
            with self.subTest(invalid=invalid.keys()),self.assertRaises(ValueError):self.store.save(invalid)
        self.assertEqual(self.store.get(value['id']),{**value,**title_fields(value)})
    def test_manual_title_survives_stale_autosave_without_switching_chats(self):
        first=self.conversation('Crea una imagen de un pájaro');second=self.conversation('Otro chat')
        self.store.save(first);self.store.save(second);self.store.rename(first['id'],'Pájaro rojo')
        self.assertEqual(self.store.catalog()['active'],second['id'])
        self.store.save(first,active=False)
        self.assertEqual(self.store.get(first['id'])['title'],'Pájaro rojo')
        self.assertEqual(self.store.get(first['id'])['title_mode'],'manual')
        self.assertNotIn('Pájaro rojo'.encode(),self.store.path.read_bytes())
    def test_only_sending_a_user_message_promotes_an_existing_chat(self):
        first=self.conversation('Imagen de un pájaro');second=self.conversation('Video de una llamada')
        with patch('services.chat_history.time.time',return_value=10):self.store.save(first)
        with patch('services.chat_history.time.time',return_value=20):self.store.save(second)
        original=[second['id'],first['id']]
        with patch('services.chat_history.time.time',side_effect=AssertionError('Opening and autosave must preserve recency')):
            # Opening a conversation still persists the active selection.
            self.assertFalse(self.store.save(first)['promoted'])
            first['draft']='Borrador sin enviar';self.store.save(first)
            first['messages'].append({'role':'assistant','text':'Un resultado nuevo del agente.'});self.store.save(first)
            self.store.rename(first['id'],'Pájaro rojo')
        self.assertEqual(self.store.catalog()['active'],first['id'])
        self.assertEqual([item['id'] for item in self.store.catalog()['conversations']],original)
        self.assertEqual([item['updated'] for item in self.store.catalog()['conversations']],[20,10])
        first['messages'].append({'id':str(uuid4()),'role':'user','text':'Que el pájaro sea rojo'})
        with patch('services.chat_history.time.time',return_value=30):sent=self.store.save(first)
        self.assertTrue(sent['promoted']);self.assertEqual(sent['updated'],30)
        reopened=ChatHistory(self.root,self.protector)
        self.assertEqual([item['id'] for item in reopened.catalog()['conversations']],[first['id'],second['id']])
        self.assertEqual(reopened.get(first['id'])['title'],'Pájaro rojo')
    def test_opening_legacy_chat_without_user_count_does_not_promote_it(self):
        value=self.conversation('Chat de una versión anterior')
        with patch('services.chat_history.time.time',return_value=10):self.store.save(value)
        with self.store.connect() as db:
            raw=db.execute('SELECT summary FROM chats WHERE id=?',(value['id'],)).fetchone()[0]
            summary=json.loads(self.protector.unprotect(raw));summary.pop('user_messages')
            db.execute('UPDATE chats SET summary=? WHERE id=?',(self.protector.protect(json.dumps(summary).encode()),value['id']))
        with patch('services.chat_history.time.time',side_effect=AssertionError('Legacy opening must preserve recency')):
            self.assertFalse(self.store.save(value)['promoted'])
        self.assertEqual(self.store.catalog()['conversations'][0]['updated'],10)
    def test_legacy_titles_are_migrated_without_altering_messages_or_recency(self):
        value=self.conversation('Melodi, soy Daniel Luna y eres mi asistente personal. Crea un video de llamada al dentista.')
        self.store.save(value)
        with self.store.connect() as db:
            before=db.execute('SELECT updated FROM chats').fetchone()[0]
            legacy=self.protector.protect(json.dumps({'title':value['messages'][0]['text'][:80],'messages':1}).encode())
            db.execute('UPDATE chats SET summary=?',(legacy,))
        self.assertEqual(self.store.catalog()['conversations'][0]['title'],'Video de llamada al dentista')
        self.assertEqual(self.store.get(value['id'])['messages'],value['messages'])
        self.assertEqual(self.store.catalog()['conversations'][0]['updated'],before)
        self.assertEqual(automatic_title(self.conversation('Crea una imagen de un pájaro')),'Imagen de un pájaro')
        for title in ['', 'x'*81, 'a\nb']:
            with self.assertRaises(ValueError):self.store.rename(value['id'],title)
    def test_private_provider_record_is_atomic_and_does_not_contain_cleartext_secret(self):
        vault=PrivateStore(self.root/'provider.dpapi',self.protector);value={'api_key':'fixture-key-never-plain','enabled':False}
        vault.write(value);self.assertEqual(vault.read(),value)
        self.assertNotIn(value['api_key'].encode(),vault.path.read_bytes());self.assertEqual(list(self.root.glob('.private-*')),[])
    def test_long_conversation_is_chunked_without_dropping_older_messages(self):
        value=self.conversation('Primer mensaje que se conserva')
        value['messages'] += [{'id':str(uuid4()),'role':'assistant','text':' '.join(str(uuid4()) for _ in range(30))} for _ in range(500)]
        self.store.save(value);reopened=ChatHistory(self.root,self.protector)
        self.assertEqual(len(reopened.get(value['id'])['messages']),501)
        self.assertEqual(reopened.get(value['id'])['messages'][0]['text'],'Primer mensaje que se conserva')
        with reopened.connect() as db:raw=db.execute('SELECT payload FROM chats').fetchone()[0]
        self.assertTrue(raw.startswith(b'CHAT2\n'));self.assertGreater(len(json.loads(raw[6:])),1)

class PublicProgressTests(unittest.TestCase):
    def setUp(self):
        from services.computer.service import ComputerService
        from tests.test_computer_control import Runtime,Planner
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.service=ComputerService('http://127.0.0.1:1',lambda:None,root=Path(self.temp.name),runtime=Runtime(),planner=Planner(),native=True)
        self.addCleanup(self.service.close)
    def test_creative_acknowledgement_explains_the_requested_scope_and_next_steps(self):
        text=self.service.acknowledgement('Crea un trailer de Cognira Desktop, Vetsa AI y Brivany de 1 minuto en horizontal')
        for term in ('Cognira Desktop','Vetsa AI','Brivany','60 segundos','horizontal','guion','exportación'):self.assertIn(term,text)
        self.assertIn('\n\n',text)
    def test_decisions_and_tool_steps_are_durable_public_events_without_credentials(self):
        job={'id':str(uuid4()),'kind':'motion','state':'queued','phase':'En cola','steps':0,'result':None,'error':None,'external_calls':0}
        self.service.progress(job,'El montaje está definido: 6 escenas.')
        self.service.progress(job,'FFmpeg · Renderizando video')
        self.service.progress(job,'FFmpeg · Renderizando video')
        self.service.progress(job,'Preparando sk-fixtureprivatecredential123456')
        visible=self.service.public(job)['activity']
        self.assertEqual(len(visible),3);self.assertEqual(visible[0]['kind'],'decision');self.assertEqual(visible[1]['kind'],'tool')
        self.assertNotIn('sk-fixtureprivatecredential123456',json.dumps(visible))

if __name__=='__main__':unittest.main()
