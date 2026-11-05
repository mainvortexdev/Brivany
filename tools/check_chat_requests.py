"""Signed synthetic own-chat commands through actual local request review UI.

No Meta inference, account APIs or WhatsApp message is sent. Gateway and OAuth
boundaries use explicit substitutes; HMAC/PKCE/DPAPI/SQLite/HTTP/browser are real.
"""
from datetime import datetime,timedelta,timezone
import hashlib
import hmac
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
from unittest.mock import patch
from urllib.parse import urlsplit

from services.h1.server import Handler,ROOT
from services.connections import ConnectionsService
from services.chat_requests import parse_command
from services.google_oauth import GoogleOAuthService,TOKEN_URL,PREFIX
from services.integrations import IntegrationError,IntegrationResult
from services.personal_notes import PersonalNotesService
from services.sous import SousService
from services.whatsapp_gateway import WhatsAppGateway


def main():
    counts={'model':0,'oauth':0,'drive':0,'outbound_stub':0,'browser_stub':0}
    def oauth_http(url,fields):
        if url!=TOKEN_URL or fields.get('grant_type')!='authorization_code':raise AssertionError('Unexpected OAuth operation')
        counts['oauth']+=1
        return {'access_token':'synthetic-access-token','refresh_token':'synthetic-refresh-token','token_type':'Bearer','expires_in':3600,'scope':PREFIX+'drive.metadata.readonly'}
    oauth_http.simulation=True
    def api_http(method,url,token,payload=None):
        if method!='GET' or not url.startswith('https://www.googleapis.com/drive/v3/files?'):raise AssertionError('Unexpected provider boundary')
        counts['drive']+=1;return {'files':[{'id':'fixture-drive-1','name':'Resultado Drive sintético','mimeType':'application/pdf'}]}
    api_http.simulation=True
    class Outbound:
        simulation=True
        def execute(self,operation,parameters,idempotency_key):
            if operation!='whatsapp.send' or parameters['recipient']!='59170000001':raise AssertionError('Unexpected outbound operation')
            counts['outbound_stub']+=1
            return IntegrationResult('succeeded','wamid.synthetic-'+str(counts['outbound_stub']),{'accepted':True,'delivered':False})
    def no_model(*args,**kwargs):counts['model']+=1;raise AssertionError('Slash commands cannot invoke a model')
    no_model.simulation=True
    def browser(url,**kwargs):
        if urlsplit(url).hostname!='accounts.google.com':raise AssertionError('Unexpected browser launch')
        counts['browser_stub']+=1;return True
    artifacts=ROOT/'tmp/chat-requests';artifacts.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brivany-chat-requests-') as temporary:
        folder=Path(temporary);server=ThreadingHTTPServer(('127.0.0.1',0),Handler);base='http://127.0.0.1:'+str(server.server_port)
        env={'BRIVANY_GOOGLE_CLIENT_ID':'synthetic-installed-client.apps.googleusercontent.com',
            'BRIVANY_META_APP_SECRET':'synthetic-hmac-secret','BRIVANY_WHATSAPP_ACCESS_TOKEN':'synthetic-token'}
        oauth=GoogleOAuthService(folder/'oauth',base_url=base,env=env,transport=oauth_http)
        connections=ConnectionsService(folder/'connections',base_url=base,oauth=oauth,env=env,http=api_http)
        own='59170000001';phone='1234567890'
        connections.save_settings({'execution_enabled':True,'chat_requests_enabled':True,'webhook_enabled':True,
            'self_recipient':own,'allowed_senders':[own],'opted_in_recipients':[own],'phone_number_id':phone})
        personal=PersonalNotesService(folder/'personal');server.connections=connections;server.personal_notes=personal;server.sous=SousService(folder/'sous')
        clock=[time.time()];gateway=WhatsAppGateway(folder/'gateway',connections.integration,allow_replies=True,start_worker=False,
            reply=no_model,outbound=Outbound(),now=lambda:clock[0],requests=connections.chat_requests,
            config_provider=lambda:connections.refresh_settings().config)
        future=(datetime.now(timezone(timedelta(hours=-4)))+timedelta(days=2)).replace(microsecond=0).isoformat()
        samples={'note':'/nota Visita sintética | Preguntar por las ventanas',
            'reminder':'/recordatorio '+future+' | Revisar el plano sintético',
            'drive':'/drive Plano sintético','dismiss':'/nota Descartar sintética | No crear esta nota',
            'stale':'/nota Conflicto sintético | No sobrescribir otra revisión'}
        ids={};invalid_signature_rejected=False;duplicate_rejected=False
        for index,(key,text) in enumerate(samples.items()):
            clock[0]+=1
            payload={'object':'whatsapp_business_account','entry':[{'changes':[{'field':'messages','value':{'metadata':{'phone_number_id':phone},
                'messages':[{'id':'wamid.fixture-'+str(index),'from':own,'timestamp':str(int(clock[0])),'type':'text','text':{'body':text}}]}}]}]}
            raw=json.dumps(payload,separators=(',',':')).encode();signature='sha256='+hmac.new(env['BRIVANY_META_APP_SECRET'].encode(),raw,hashlib.sha256).hexdigest()
            if index==0:
                try:gateway.receive(raw,'sha256='+'0'*64)
                except IntegrationError as exc:invalid_signature_rejected=exc.code=='webhook_signature'
                if connections.chat_requests.list()['items']:raise AssertionError('Unauthenticated request persisted')
            accepted=gateway.receive(raw,signature)
            if accepted['queued_for_reply']!=1:raise AssertionError('Expected one authenticated fixture')
            processed=gateway.process_next()
            if processed['state']!='accepted_test_stub' or processed['model_attempted']!=0:raise AssertionError('Command crossed a model boundary')
            if index==0:
                duplicate=gateway.receive(raw,signature);duplicate_rejected=duplicate['duplicate_events']==1 and duplicate['queued_for_reply']==0
            expected='note.create' if key in {'note','dismiss','stale'} else 'reminder.create' if key=='reminder' else 'drive.search'
            item=next(item for item in connections.chat_requests.list()['items'] if item['action']['operation']==expected and item['action']['parameters']==parse_command(text,connections.integration.config)['parameters'])
            ids[key]=item['id']
        if not invalid_signature_rejected or not duplicate_rejected:raise AssertionError('Authentication/deduplication fixture failed')
        if personal.list_notes()['items'] or personal.list_reminders()['items']:raise AssertionError('Remote command executed before local review')
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connect=socket.create_connection
        def local_only(address,*args,**kwargs):
            if address[0] not in ('127.0.0.1','localhost','::1'):raise AssertionError('External request forbidden')
            return connect(address,*args,**kwargs)
        try:
            with patch('socket.create_connection',side_effect=local_only),patch('services.connections_http.webbrowser.open',side_effect=browser):
                result=subprocess.run(['node','tools/check_chat_requests.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':base,'BRIVANY_CHAT_IDS':json.dumps(ids)},capture_output=True,timeout=110,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:raise RuntimeError((result.stdout+result.stderr).decode('utf-8',errors='replace'))
            expected_counts={'model':0,'oauth':1,'drive':1,'outbound_stub':5,'browser_stub':1}
            if counts!=expected_counts:raise AssertionError('Unexpected substituted operation count: '+str(counts))
            states={key:connections.chat_requests.get(value)['state'] for key,value in ids.items()}
            if states!={'note':'completed','reminder':'completed','drive':'completed_test_stub','dismiss':'dismissed','stale':'dismissed'}:raise AssertionError('Unexpected final request states')
            report=json.loads((artifacts/'report.json').read_text(encoding='utf-8'))
            report.update(checked_at=datetime.now(timezone.utc).isoformat(),provider_stub_calls=counts,
                signed_fixture_count=5,invalid_signature_rejected=True,duplicate_event_rejected=True,request_states=states,
                external_calls=0,real_messages_sent=0,real_account_access=False,model_executed=False,
                limitations=['HMAC, deduplication, command parser, typed SQLite storage, local approvals, PKCE/DPAPI and browser are real; original messages are synthetic.',
                    'Gateway acknowledgements, OAuth exchange and Drive API use substitutes. No real WhatsApp delivery, Google account access or scheduled background alarm verified.'])
            (artifacts/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(report,ensure_ascii=False,indent=2))
        finally:gateway.close();server.shutdown();server.server_close();thread.join(3);personal.close()


if __name__=='__main__':main()
