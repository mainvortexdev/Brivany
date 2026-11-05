"""Loopback HTTP commands for accounts and reviewed personal operations."""
import json
import os
import re
import sqlite3
from urllib.parse import parse_qs,urlsplit
import webbrowser

from services.connections import service
from services.google_oauth import GoogleOAuthError
from services.integrations import IntegrationError

CREDENTIALS={'google':{'BRIVANY_GOOGLE_CLIENT_ID','BRIVANY_GOOGLE_CLIENT_SECRET'},
    'whatsapp':{'BRIVANY_WHATSAPP_ACCESS_TOKEN','BRIVANY_META_APP_SECRET','BRIVANY_WHATSAPP_VERIFY_TOKEN'},
    'social':{'BRIVANY_META_SOCIAL_USER_TOKEN','BRIVANY_FACEBOOK_PAGE_TOKEN','BRIVANY_INSTAGRAM_ACCESS_TOKEN','BRIVANY_META_ADS_ACCESS_TOKEN'}}


def get(handler,route):
    try:
        current=service(handler)
        if route=='/api/integrations/status':handler.send_json(200,current.status());return
        if route=='/api/integrations/chat/requests':
            handler.send_json(200,current.chat_requests.list());return
        if route=='/api/integrations/social/drafts':
            current.refresh_settings();handler.send_json(200,current.social.list());return
        match=re.fullmatch('/api/integrations/social/runs/([0-9a-f-]{36})',route)
        if match:
            current.refresh_settings();handler.send_json(200,current.social.execution(match[1]));return
        if route=='/api/integrations/google/callback':
            current.oauth.finish(parse_qs(urlsplit(handler.path).query,keep_blank_values=True))
            handler.send_headers(200,'text/html; charset=utf-8',len(CALLBACK));handler.wfile.write(CALLBACK);return
        handler.error(404,'connection_not_found','Conexión no disponible.')
    except (GoogleOAuthError,IntegrationError) as exc:handler.error(exc.status,exc.code,str(exc))
    except (OSError,ValueError,sqlite3.Error):handler.error(503,'connection_storage','No se pudo abrir la configuración local.')


CALLBACK='<!doctype html><html lang="es"><meta charset="utf-8"><title>Brivany</title><p>Cuenta autorizada. Ya puedes cerrar esta pestaña y volver a Brivany.</p></html>'.encode('utf-8')


def post(handler,route):
    if not handler.headers.get('Origin'):
        handler.reject_before_body(403,'local_form_required','Usa Conexiones desde Brivany local.');return
    try:length=int(handler.headers.get('Content-Length','0'))
    except ValueError:length=0
    if not 0<length<=40000 or handler.headers.get('Transfer-Encoding'):
        handler.reject_before_body(413,'connection_body','La solicitud supera el límite.');return
    if handler.headers.get_content_type()!='application/json':handler.reject_before_body(415,'json_required','Usa el formulario JSON local.');return
    try:
        raw=handler.rfile.read(length)
        if len(raw)!=length:raise ValueError()
        value=json.loads(raw)
        if not isinstance(value,dict):raise ValueError()
        current=service(handler);integration=current.refresh_settings()
        match=re.fullmatch('/api/integrations/chat/requests/([0-9a-f-]{36})/(propose|execute-local|dismiss|settle)',route)
        if match:
            request_id,action=match.groups()
            if action in {'dismiss','settle'}:
                if set(value)!={'expected_revision'}:raise ValueError()
                result=current.chat_requests.dismiss(request_id,value['expected_revision']) if action=='dismiss' else current.chat_requests.settle(request_id,value['expected_revision'],integration)
            else:
                required={'expected_revision','action_sha256'} | ({'execute'} if action=='execute-local' else set())
                if set(value)!=required:raise ValueError()
                if action=='propose':result=current.chat_requests.propose(request_id,value['expected_revision'],value['action_sha256'],integration)
                else:
                    from services.personal_http import service as personal_service
                    result=current.chat_requests.execute_local(request_id,value['expected_revision'],value['action_sha256'],personal_service(handler),execute=value['execute'])
            handler.send_json(200,result);return
        if route=='/api/integrations/google/begin':
            if set(value)-{'connector','operations','open_browser'}:raise ValueError()
            if 'open_browser' in value and type(value['open_browser']) is not bool:raise ValueError()
            result=current.oauth.begin(value['connector'],value.get('operations'))
            if value.get('open_browser') is True:result['browser_open_requested']=bool(webbrowser.open(result['authorization_url'],new=2))
            handler.send_json(200,result);return
        if route=='/api/integrations/google/disconnect':
            if set(value)-{'connector','revoke'} or type(value.get('revoke',True)) is not bool:raise ValueError()
            handler.send_json(200,current.oauth.disconnect(value['connector'],revoke=value.get('revoke',True)));return
        if route=='/api/integrations/settings':handler.send_json(200,current.save_settings(value));return
        if route=='/api/integrations/credentials':
            if set(value)!={'provider','values'} or value['provider'] not in CREDENTIALS or not isinstance(value['values'],dict):raise ValueError()
            supplied=value['values']
            if not supplied or set(supplied)-CREDENTIALS[value['provider']]:raise ValueError()
            if any(not isinstance(entry,str) or not re.fullmatch(r'[A-Za-z0-9._~+/=|:\-]{20,2048}',entry) for entry in supplied.values()):raise ValueError()
            client=supplied.get('BRIVANY_GOOGLE_CLIENT_ID')
            if client is not None and not re.fullmatch(r'[A-Za-z0-9_-]{5,250}\.apps\.googleusercontent\.com',client):raise ValueError()
            from services.h1.server import save_local_secret
            for name,entry in supplied.items():save_local_secret(entry,name)
            current.update_credentials(supplied)
            handler.send_json(200,{'saved':True,'status':current.status()});return
        if route=='/api/integrations/social/drafts':
            if set(value)-{'draft','draft_id','expected_revision'} or 'draft' not in value:raise ValueError()
            handler.send_json(200,current.social.save(value['draft'],draft_id=value.get('draft_id'),expected_revision=value.get('expected_revision',0)));return
        if route=='/api/integrations/social/proposals':
            if set(value)-{'draft_id','expected_revision','container_id','request_id'} or not {'draft_id','expected_revision'}<=set(value):raise ValueError()
            handler.send_json(201,current.propose_social(value['draft_id'],value['expected_revision'],container_id=value.get('container_id'),request_id=value.get('request_id')));return
        if route=='/api/integrations/social/read':
            if set(value)!={'operation','parameters'}:raise ValueError()
            handler.send_json(200,current.social_transport.read(value['operation'],value['parameters']));return
        if route=='/api/integrations/proposals':
            if set(value)-{'operation','parameters','request_id'}:raise ValueError()
            handler.send_json(201,integration.propose(value['operation'],value['parameters'],request_id=value.get('request_id')));return
        if route=='/api/integrations/approve':
            if set(value)!={'proposal_id','action_sha256'}:raise ValueError()
            handler.send_json(200,integration.approve(value['proposal_id'],value['action_sha256']));return
        if route=='/api/integrations/execute':
            if set(value)!={'proposal_id','parameters','approval_id','execute'}:raise ValueError()
            handler.send_json(200,integration.execute(value['proposal_id'],value['parameters'],value['approval_id'],execute=value['execute']));return
        handler.error(404,'connection_not_found','Acción no disponible.')
    except (GoogleOAuthError,IntegrationError) as exc:handler.error(exc.status,exc.code,str(exc))
    except (KeyError,ValueError,TypeError):handler.error(422,'connection_request','Revisa los campos de la conexión.')
    except (OSError,sqlite3.Error):handler.error(503,'connection_storage','No se pudo guardar el estado local.')
