"""Private reminder/note endpoints; opening never starts a delivery worker."""
import json
import re
import sqlite3
import threading

from services.personal_notes import PersonalNotesService,PersonalNotesError
from services.sous import SousError

LOCK=threading.RLock()


def service(handler):
    with LOCK:
        if not hasattr(handler.server,'personal_notes'):
            from services.h1.server import ROOT
            from services.connections import service as connections
            def config():
                current=connections(handler);current.refresh_settings();return current.integration.config
            handler.server.personal_notes=PersonalNotesService(ROOT/'.local'/'personal',config_provider=config)
        return handler.server.personal_notes


def get(handler,route):
    try:
        current=service(handler)
        if route=='/api/personal/reminders':handler.send_json(200,current.list_reminders());return
        if route=='/api/personal/notes':handler.send_json(200,current.list_notes());return
        handler.error(404,'personal_not_found','Registro personal no disponible.')
    except (PersonalNotesError,SousError) as exc:handler.error(exc.status,exc.code,str(exc))
    except (OSError,ValueError,sqlite3.Error):handler.error(503,'personal_storage','No se pudo leer el registro personal.')


def post(handler,route):
    if not handler.headers.get('Origin'):handler.reject_before_body(403,'local_form_required','Usa los controles personales de Brivany.');return
    try:length=int(handler.headers.get('Content-Length','0'))
    except ValueError:length=0
    if not 0<length<=32000 or handler.headers.get('Transfer-Encoding'):handler.reject_before_body(413,'personal_body','La solicitud supera el límite.');return
    if handler.headers.get_content_type()!='application/json':handler.reject_before_body(415,'json_required','Usa JSON en el formulario.');return
    try:
        raw=handler.rfile.read(length)
        if len(raw)!=length:raise ValueError()
        value=json.loads(raw)
        if not isinstance(value,dict):raise ValueError()
        current=service(handler)
        if route=='/api/personal/reminders':handler.send_json(201,current.create_reminder(value));return
        if route=='/api/personal/check-due':
            if value:raise ValueError()
            handler.send_json(200,current.run_due(limit=10));return
        if route=='/api/personal/notes':handler.send_json(200,current.save_note(value));return
        if route=='/api/personal/notes/from-sous':
            if set(value)-{'kind','explicit','session_id'} or value.get('explicit') is not True or value.get('kind') not in {'shopping','activity'}:raise ValueError()
            if value['kind']=='activity' and 'session_id' not in value:raise ValueError()
            sous=handler.sous_service();snapshot=sous.shopping_list() if value['kind']=='shopping' else sous.get_session(value['session_id'])
            handler.send_json(201,current.capture_sous_note(snapshot,kind=value['kind'],explicit=True));return
        match=re.fullmatch('/api/personal/reminders/([0-9a-f-]{36})/(update|complete|cancel|snooze)',route)
        if match:
            identifier,action=match.groups()
            if action in {'complete','cancel'}:
                if set(value)!={'expected_revision'}:raise ValueError()
                result=getattr(current,action+'_reminder')(identifier,value['expected_revision'])
            else:result=getattr(current,action+'_reminder')(identifier,value)
            handler.send_json(200,result);return
        match=re.fullmatch('/api/personal/notes/([0-9a-f-]{36})/archive',route)
        if match:
            if set(value)!={'expected_revision'}:raise ValueError()
            handler.send_json(200,current.archive_note(match[1],value['expected_revision']));return
        handler.error(404,'personal_not_found','Acción personal no disponible.')
    except (PersonalNotesError,SousError) as exc:handler.error(exc.status,exc.code,str(exc))
    except (KeyError,ValueError,TypeError):handler.error(422,'personal_request','Revisa los datos del registro personal.')
    except (OSError,sqlite3.Error):handler.error(503,'personal_storage','No se pudo guardar el registro personal.')
