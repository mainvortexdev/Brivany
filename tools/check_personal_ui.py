"""Actual private reminder/note UI and persistence, with temporary authored data.

No account transport, notification permission, provider, or scheduler is started.
"""
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

from services.h1.server import Handler, ROOT
from services.connections import ConnectionsService
from services.personal_notes import PersonalNotesService
from services.sous import SousService


def main():
    artifacts=ROOT/'tmp/personal-ui';artifacts.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='brivany-personal-ui-') as temporary:
        folder=Path(temporary);server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        base='http://127.0.0.1:'+str(server.server_port)
        server.connections=ConnectionsService(folder/'connections',base_url=base,env={})
        server.personal_notes=PersonalNotesService(folder/'personal')
        server.sous=SousService(folder/'sous')
        server.sous.save_shopping_list({'expected_revision':1,'items':[
            {'label':'Quinua sintética','quantity':150,'unit':'g','checked':False},
            {'label':'Aceite ya comprado','quantity':20,'unit':'ml','checked':True}]})
        assert server.personal_notes.thread is None
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        connect=socket.create_connection
        def local_only(address,*args,**kwargs):
            if address[0] not in ('127.0.0.1','localhost','::1'):raise AssertionError('External requests forbidden')
            return connect(address,*args,**kwargs)
        try:
            with patch('socket.create_connection',side_effect=local_only):
                completed=subprocess.run(['node','tools/check_personal_ui.cjs'],cwd=ROOT,
                    env={**os.environ,'BRIVANY_TEST_URL':base},capture_output=True,timeout=90,
                    creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if completed.returncode:raise RuntimeError((completed.stdout+completed.stderr).decode('utf-8',errors='replace'))
            reopened=PersonalNotesService(folder/'personal')
            try:
                reminders=reopened.list_reminders(include_finished=True)['items']
                assert len(reminders)==3
                assert sorted(item['state'] for item in reminders)==['cancelled','completed','scheduled']
                notes=reopened.list_notes(include_archived=True)['items']
                assert len(notes)==2 and sum(item['archived'] for item in notes)==1
                assert any(item['kind']=='sous_shopping' and item['source_revision']==2 for item in notes)
                assert server.personal_notes.thread is None and not reopened.status()['scheduler_running']
                assert reopened.status()['attempts_today_utc']==0
            finally:reopened.close()
            report=json.loads((artifacts/'report.json').read_text(encoding='utf-8'))
            report.update(checked_at=datetime.now(timezone.utc).isoformat(),external_calls=0,real_messages_sent=0,
                os_background_alarm_verified=False,notification_permission_requested=False,
                persistence_reopened_in_new_service=True,delivery_attempts=0,
                limitations=['Loopback HTTP, browser controls, SQLite and Sous shopping snapshots are real; all data are authored synthetic fixtures.',
                    'No scheduler, operating-system background alarm, account grant, notification or WhatsApp delivery tested.'])
            (artifacts/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(report,ensure_ascii=False,indent=2))
        finally:
            server.shutdown();server.server_close();thread.join(3);server.personal_notes.close()


if __name__=='__main__':main()
