"""Meeting UI uses the existing native account, never Recall credentials."""
import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from services.meetings import MeetingService
from services.whatsapp_cloud import MeetingsHTTP
from services.brivany_account import AccountFailure

class MeetingsTests(unittest.TestCase):
    def test_transport_is_typed_and_rejects_arbitrary_destinations(self):
        transport=MeetingsHTTP()
        for path in ['/meetings','/meetings/calendar','/meetings/detail?id=00000000-0000-4000-8000-000000000001&part=0']:
            self.assertTrue(transport.allowed(path))
        for path in ['https://evil.test/meetings','//evil.test/meetings','/meetings?owner=other','/meetings/detail?id=x','/meetings/detail?id=00000000-0000-4000-8000-000000000001&url=evil','/google/drive']:
            self.assertFalse(transport.allowed(path))
    def test_existing_account_transport_injects_token_only_on_server_request(self):
        calls=[]
        class Account:
            def call_whatsapp(self,path,body=None,*,http):calls.append((path,body,http));return {'meetings':[]}
        service=MeetingService(Account());self.assertEqual(service.call('list'),{'meetings':[]});self.assertIsInstance(calls[0][2],MeetingsHTTP)
        self.assertEqual(calls[0][0],'/meetings')
        with self.assertRaises(AccountFailure):service.call('launch')
        with self.assertRaises(AccountFailure):MeetingService(None).call('list')
    def test_backend_error_remains_actionable_without_exposing_response_content(self):
        class Opener:
            def open(self,*args,**kwargs):raise HTTPError('https://ia.vetsa.es',409,'Conflict',{},io.BytesIO(json.dumps({'error':'Conecta Google Calendar desde Ajustes.'}).encode()))
        with patch('services.whatsapp_cloud.request.build_opener',return_value=Opener()):
            with self.assertRaisesRegex(AccountFailure,'Conecta Google Calendar'):MeetingsHTTP().call('/meetings/calendar',token='synthetic-token')
    def test_no_recall_key_is_needed_in_native_service(self):
        with patch.dict('os.environ',{},clear=True):self.assertEqual(MeetingsHTTP.origin,'https://ia.vetsa.es')

if __name__=='__main__':unittest.main()
