"""Fixed REST payloads with substituted transport; no accounts or messages used."""
import base64
from email import message_from_bytes
import json
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from urllib.parse import parse_qs,urlsplit
from uuid import uuid4

from packages.providers.personal import GoogleTransport,WhatsAppTransport,request_json,SCOPES
from services.integrations import IntegrationService,IntegrationError


class PersonalProviderTests(unittest.TestCase):
    def setUp(self):
        self.oauth=SimpleNamespace(access_token=Mock(return_value='synthetic-access-token'),status=Mock(return_value={'connectors':[{'connector':'drive','authorized':True,'authorized_operations':['drive.search']}]}))
        self.http=Mock(return_value={});self.http.simulation=True;self.key=str(uuid4())

    def test_readiness_and_constructor_do_not_contact_provider_or_request_token(self):
        GoogleTransport(self.oauth,'drive',http=self.http).readiness()
        self.http.assert_not_called();self.oauth.access_token.assert_not_called()

    def test_calendar_create_is_rejected_before_token_access_or_provider_call(self):
        transport=GoogleTransport(self.oauth,'calendar',http=self.http)
        with self.assertRaises(IntegrationError):transport.execute('calendar.create',{'title':'Synthetic'},self.key)
        self.assertEqual(transport.available_operations,{'calendar.list'})
        self.oauth.access_token.assert_not_called();self.http.assert_not_called()

    def test_calendar_list_bounds_fields_and_results(self):
        self.http.return_value={'items':[{'id':'x','summary':'Test','start':{},'end':{},'unknown':'omit'}],'nextPageToken':'never-auto-fetch'}
        result=GoogleTransport(self.oauth,'calendar',http=self.http).execute('calendar.list',{'start':'2026-11-01T10:00:00Z','end':'2026-11-02T10:00:00Z'},self.key)
        query=parse_qs(urlsplit(self.http.call_args.args[1]).query);self.assertEqual(query['maxResults'],['20']);self.assertTrue(result.payload['more_available'])
        self.assertNotIn('unknown',result.payload['items'][0]);self.http.assert_called_once()

    def test_gmail_draft_is_mime_encoded_and_never_sent(self):
        self.http.return_value={'id':'draft-1'}
        result=GoogleTransport(self.oauth,'gmail',http=self.http).execute('gmail.draft',{'to':'fixture@example.invalid','subject':'Prueba española','body':'Primera línea\nSegunda línea'},self.key)
        method,url,_,payload=self.http.call_args.args;encoded=payload['message']['raw']
        message=message_from_bytes(base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4)))
        self.assertEqual(message['To'],'fixture@example.invalid');self.assertIn('drafts',url);self.assertNotIn('/send',url);self.assertFalse(result.payload['sent'])

    def test_gmail_search_never_fetches_mail_bodies(self):
        self.http.return_value={'messages':[{'id':'a123','threadId':'b456'}]}
        result=GoogleTransport(self.oauth,'gmail',http=self.http).execute('gmail.search',{'query':'subject:fixture'},self.key)
        self.http.assert_called_once();self.assertFalse(result.payload['bodies_fetched'])

    def test_drive_query_is_escaped_and_only_metadata_is_requested(self):
        self.http.return_value={'files':[{'id':'one','name':'Fixture','mimeType':'text/plain','secret_extra':'omit'}]}
        result=GoogleTransport(self.oauth,'drive',http=self.http).execute('drive.search',{'query':"x' or name contains 'y"},self.key)
        query=parse_qs(urlsplit(self.http.call_args.args[1]).query)
        self.assertIn("x\\' or name contains \\'y",query['q'][0]);self.assertNotIn('secret_extra',result.payload['files'][0]);self.assertFalse(result.payload['contents_fetched'])

    def test_whatsapp_acceptance_is_never_claimed_delivery(self):
        self.http.return_value={'messages':[{'id':'wamid.aBCD+/=='}]}
        config={'self_recipient':'59170000001','opted_in_recipients':['59170000001'],'phone_number_id':'1234567890'}
        result=WhatsAppTransport({'BRIVANY_WHATSAPP_ACCESS_TOKEN':'synthetic-key'},config,http=self.http).execute('whatsapp.send',{'recipient':'59170000001','text':'Solo fixture'},self.key)
        method,url,_,payload=self.http.call_args.args;self.assertTrue(result.payload['accepted']);self.assertFalse(result.payload['delivered'])
        self.assertFalse(payload['text']['preview_url']);self.assertIn('/1234567890/messages',url)
        with self.assertRaises(IntegrationError):WhatsAppTransport({},config,http=self.http).execute('whatsapp.send',{'recipient':'59170000002','text':'blocked'},self.key)
        self.http.assert_called_once()

    def test_arbitrary_endpoints_and_cross_connector_operations_are_rejected_before_http(self):
        for url in ('http://www.googleapis.com/test','https://evil.invalid','https://user@www.googleapis.com/test','https://www.googleapis.com:444/test'):
            with patch('packages.providers.personal.request.build_opener') as opener:
                with self.assertRaises(IntegrationError):request_json('POST',url,'synthetic-key')
                opener.assert_not_called()
        with self.assertRaises(IntegrationError):GoogleTransport(self.oauth,'drive',http=self.http).execute('gmail.draft',{},self.key)
        self.http.assert_not_called()

    def test_real_class_with_substituted_http_stays_simulated_and_result_is_not_persisted(self):
        self.http.return_value={'files':[{'id':'one','name':'PRIVATE-FIXTURE','mimeType':'text/plain'}]}
        with tempfile.TemporaryDirectory() as folder:
            service=IntegrationService(folder,config={'execution_enabled':True},env={},transports={'drive':GoogleTransport(self.oauth,'drive',http=self.http)})
            proposal=service.propose('drive.search',{'query':'fixture'});approval=service.approve(proposal['id'],proposal['action_sha256'])
            result=service.execute(proposal['id'],proposal['parameters'],approval['approval_id'],execute=True)
            self.assertEqual(result['state'],'succeeded_test_stub');self.assertEqual(result['external_calls'],0);self.assertFalse(result['result_persisted'])
            self.assertIn('PRIVATE-FIXTURE',json.dumps(result['result']));self.assertNotIn(b'PRIVATE-FIXTURE',Path(folder,'integrations.sqlite3').read_bytes())
            service.execute(proposal['id'],proposal['parameters'],approval['approval_id'],execute=True);self.http.assert_called_once()


if __name__=='__main__':unittest.main()
