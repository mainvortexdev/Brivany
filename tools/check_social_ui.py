"""Actual Connections/social UI with temporary drafts and substituted Graph HTTP."""
from copy import deepcopy
from datetime import datetime,timezone
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
from services.connections import ConnectionsService
from services.personal_notes import PersonalNotesService
from services.sous import SousService


def main():
    artifacts=ROOT/'tmp/social-ui';artifacts.mkdir(parents=True,exist_ok=True)
    calls=[];saved_names=[]
    def social_http(method,url,token,payload=None):
        assert token=='SYNTHETIC-TOKEN-FOR-LOCAL-TEST-ONLY'
        calls.append((method,urlsplit(url).path,deepcopy(payload)))
        path=urlsplit(url).path
        if method=='POST' and path.endswith('/123456/feed'):return {'id':'123456_987654'}
        if method=='POST' and path.endswith('/234567/media'):return {'id':'456789'}
        if method=='GET' and path.endswith('/456789'):return {'status_code':'FINISHED'}
        if method=='POST' and path.endswith('/234567/media_publish'):return {'id':'567890'}
        if method=='POST' and path.endswith('/act_345678/campaigns'):return {'id':'678901'}
        if method=='GET' and path.endswith('/me/accounts'):
            return {'data':[{'id':'123456','name':'Página sintética','access_token':'NEVER-SURFACE-THIS-TOKEN'}],
                'paging':{'next':'https://unrelated.invalid/page'}}
        raise AssertionError('Unexpected provider call')
    social_http.simulation=True
    with tempfile.TemporaryDirectory(prefix='brivany-social-ui-') as temporary:
        folder=Path(temporary);server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        base='http://127.0.0.1:'+str(server.server_port)
        server.connections=ConnectionsService(folder/'connections',base_url=base,env={},social_http=social_http)
        server.personal_notes=PersonalNotesService(folder/'personal');server.sous=SousService(folder/'sous')
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connect=socket.create_connection
        def local_only(address,*args,**kwargs):
            if address[0] not in ('127.0.0.1','localhost','::1'):raise AssertionError('External requests forbidden')
            return connect(address,*args,**kwargs)
        def save_secret(value,name):
            assert value=='SYNTHETIC-TOKEN-FOR-LOCAL-TEST-ONLY';saved_names.append(name)
        try:
            with patch('socket.create_connection',side_effect=local_only),patch('services.h1.server.save_local_secret',side_effect=save_secret):
                completed=subprocess.run(['node','tools/check_social_ui.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':base},capture_output=True,timeout=100,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if completed.returncode:raise RuntimeError((completed.stdout+completed.stderr).decode('utf-8',errors='replace'))
            assert len(saved_names)==4
            assert len(calls)==6
            assert [method for method,_,_ in calls]==['POST','POST','GET','POST','POST','GET']
            assert calls[0][2]['message']=='Texto actualizado <b>sintético</b>'
            assert calls[4][2]['status']=='PAUSED' and calls[4][2]['daily_budget']=='1234'
            assert not any('/adsets' in path or path.endswith('/ads') for _,path,_ in calls)
            reopened=ConnectionsService(folder/'connections',base_url=base,env={})
            assert len(reopened.social.list()['drafts'])==3
            report=json.loads((artifacts/'report.json').read_text(encoding='utf-8'))
            report.update(checked_at=datetime.now(timezone.utc).isoformat(),external_calls=0,provider_stub_calls=len(calls),
                private_credential_save_transport='substituted_no_real_env_write',real_publications=0,real_ads_created=0,
                ad_activation_implemented=False,persistence_reopened_in_new_service=True,
                limitations=['Actual loopback HTTP, Connections shared approval controls, versioned SQLite and browser; Graph HTTP and secret persistence use fixed substitutes.',
                    'No real account, permission, JPEG bytes/hash/reachability, publication visibility, campaign currency or ad delivery verified.'])
            (artifacts/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
        finally:server.shutdown();server.server_close();thread.join(3);server.personal_notes.close()


if __name__=='__main__':main()
