"""Actual OAuth state/DPAPI/HTTP/UI pipeline with synthetic provider transports."""
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
from unittest.mock import patch
from urllib.parse import urlsplit

from services.h1.server import Handler,ROOT
from services.google_oauth import GoogleOAuthService
from services.connections import ConnectionsService
from services.personal_notes import PersonalNotesService
from services.sous import SousService


def main():
    calls={'oauth':0,'api':0,'browser_launch_requests':0}
    def oauth_http(url,fields):
        calls['oauth']+=1
        if url!='https://oauth2.googleapis.com/token' or fields.get('grant_type')!='authorization_code':raise AssertionError('Unexpected token exchange')
        return {'access_token':'synthetic-access-token','refresh_token':'synthetic-refresh-token','token_type':'Bearer','expires_in':3600,'scope':'https://www.googleapis.com/auth/drive.metadata.readonly'}
    oauth_http.simulation=True
    def api_http(method,url,token,payload=None):
        calls['api']+=1
        if method!='GET' or not url.startswith('https://www.googleapis.com/drive/v3/files?'):raise AssertionError('Unexpected provider operation')
        return {'files':[{'id':'fixture-drive-1','name':'Plano sintético','mimeType':'application/pdf'}]}
    api_http.simulation=True
    def browser(url,**_):
        if urlsplit(url).hostname!='accounts.google.com':raise AssertionError('Unexpected browser destination')
        calls['browser_launch_requests']+=1;return True
    artifacts=ROOT/'tmp/connections';artifacts.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brivany-connections-') as temporary:
        folder=Path(temporary);server=ThreadingHTTPServer(('127.0.0.1',0),Handler);base='http://127.0.0.1:'+str(server.server_port)
        env={'BRIVANY_GOOGLE_CLIENT_ID':'synthetic-installed-client.apps.googleusercontent.com'}
        oauth=GoogleOAuthService(folder/'oauth',base_url=base,env=env,transport=oauth_http)
        server.connections=ConnectionsService(folder/'connections',base_url=base,env=env,oauth=oauth,http=api_http)
        server.personal_notes=PersonalNotesService(folder/'personal');server.sous=SousService(folder/'sous')
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connect=socket.create_connection
        def local_only(address,*args,**kwargs):
            if address[0] not in ('127.0.0.1','localhost','::1'):raise AssertionError('External requests forbidden')
            return connect(address,*args,**kwargs)
        try:
            with patch('socket.create_connection',side_effect=local_only),patch('services.connections_http.webbrowser.open',side_effect=browser):
                completed=subprocess.run(['node','tools/check_connections.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':base},capture_output=True,timeout=80,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if completed.returncode:raise RuntimeError((completed.stdout+completed.stderr).decode('utf-8',errors='replace'))
            if calls!={'oauth':1,'api':2,'browser_launch_requests':1}:raise AssertionError('Unexpected substituted operation counts: '+str(calls))
            report=json.loads((artifacts/'report.json').read_text(encoding='utf-8'))
            report.update(checked_at=datetime.now(timezone.utc).isoformat(),provider_stub_calls=calls,external_calls=0,real_account_access=False,real_messages_sent=0,
                limitations=['OAuth state, PKCE, DPAPI persistence, HTTP, reviewed operations and browser UI are real; Google/API/browser launch transports are substituted.',
                    'No actual Google grant, access permission, WhatsApp delivery or public webhook verified.'])
            (artifacts/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
        finally:server.shutdown();server.server_close();thread.join(3)


if __name__=='__main__':main()
