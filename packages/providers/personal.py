"""Fixed REST operations for Google and WhatsApp; no arbitrary endpoints/tools.

No network during construction/readiness. Google grants come from the local
OAuth service; message sending remains an explicit reviewed operation.
"""
import base64
from email.message import EmailMessage
import json
import re
from urllib import request,error,parse

from services.integrations import IntegrationError,IntegrationResult,GRAPH_API_VERSION

MAX_RESPONSE=1024*1024
SCOPES={
    'calendar.list':'https://www.googleapis.com/auth/calendar.events.readonly',
    'calendar.create':'https://www.googleapis.com/auth/calendar.events',
    'gmail.search':'https://www.googleapis.com/auth/gmail.readonly',
    'gmail.draft':'https://www.googleapis.com/auth/gmail.compose',
    'drive.search':'https://www.googleapis.com/auth/drive.metadata.readonly'}


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def request_json(method,url,token,payload=None):
    allowed={'www.googleapis.com','gmail.googleapis.com','graph.facebook.com'}
    destination=parse.urlsplit(url)
    if destination.scheme!='https' or destination.hostname not in allowed or destination.username or destination.password or destination.port not in (None,443):
        raise IntegrationError('provider_endpoint','El conector no admite esa dirección.',422)
    if not isinstance(token,str) or not token or len(token)>8192 or any(ord(char)<33 or ord(char)>126 for char in token):
        raise IntegrationError('provider_credentials','Falta una autorización válida.',503)
    headers={'Authorization':'Bearer '+token,'Accept':'application/json','User-Agent':'Brivany/0.1'}
    raw=None if payload is None else json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
    if raw is not None:headers['Content-Type']='application/json'
    try:
        req=request.Request(url,data=raw,method=method,headers=headers)
        with request.build_opener(_NoRedirect()).open(req,timeout=20) as response:body=response.read(MAX_RESPONSE+1)
        if len(body)>MAX_RESPONSE:raise ValueError()
        value=json.loads(body)
        if not isinstance(value,dict) or value.get('error'):raise ValueError()
        return value
    except error.HTTPError as exc:
        status=exc.code;exc.close()
        raise IntegrationError('provider_access' if status in (401,403) else 'provider_rejected','El proveedor rechazó la operación. No se repitió.',502) from None
    except (OSError,ValueError,error.URLError):
        raise IntegrationError('provider_outcome_unknown','No se pudo confirmar el resultado. No se repitió la operación.',502) from None


def _identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,180}',value):raise IntegrationError('provider_response','La respuesta no contiene un identificador válido.',502)
    return value


class GoogleTransport:
    kind='google'

    def __init__(self,oauth,connector,*,http=request_json):
        if connector not in {'calendar','gmail','drive'}:raise ValueError('Unsupported connector')
        self.oauth=oauth;self.connector=connector;self.http=http
        self.simulation=bool(getattr(http,'simulation',False))

    def readiness(self):return self.oauth.status(self.connector)

    def preflight(self,operation):
        status=self.readiness();grant=next((item for item in status.get('connectors',[]) if item['connector']==self.connector),None)
        if not grant or not grant.get('authorized') or operation not in grant.get('authorized_operations',[]):
            raise IntegrationError('google_authorization_pending','Conecta Google y autoriza primero esta operación.',403)

    def execute(self,operation,parameters,idempotency_key):
        if operation not in SCOPES or operation.split('.')[0]!=self.connector:raise IntegrationError('integration_operation','Operación ajena al conector.',422)
        token=self.oauth.access_token(self.connector,required_scopes=[SCOPES[operation]])
        if operation=='calendar.list':
            url='https://www.googleapis.com/calendar/v3/calendars/primary/events?'+parse.urlencode({'timeMin':parameters['start'],'timeMax':parameters['end'],'singleEvents':'true','orderBy':'startTime','maxResults':20,'fields':'items(id,summary,start,end,htmlLink),nextPageToken'})
            value=self.http('GET',url,token)
            items=value.get('items',[])
            if not isinstance(items,list):raise IntegrationError('provider_response','La lista de agenda no es válida.',502)
            payload={'items':[{key:item[key] for key in ('id','summary','start','end') if key in item} for item in items[:20]],'more_available':bool(value.get('nextPageToken'))}
            receipt='calendar-list'
        elif operation=='calendar.create':
            # A client-defined Calendar ID prevents an automatic retry from
            # creating another event; it never authorizes attendees or email.
            event_id='b'+idempotency_key.replace('-','')
            value=self.http('POST','https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none',token,
                {'id':event_id,'summary':parameters['title'],'start':{'dateTime':parameters['start']},'end':{'dateTime':parameters['end']}})
            receipt=_identifier(value.get('id'));payload={'id':receipt,'title':value.get('summary',parameters['title']),'attendees_notified':False}
        elif operation=='gmail.search':
            value=self.http('GET','https://gmail.googleapis.com/gmail/v1/users/me/messages?'+parse.urlencode({'q':parameters['query'],'maxResults':20}),token)
            messages=value.get('messages',[])
            if not isinstance(messages,list):raise IntegrationError('provider_response','La lista de Gmail no es válida.',502)
            payload={'messages':[{'id':_identifier(item['id']),'threadId':_identifier(item['threadId'])} for item in messages[:20]],'more_available':bool(value.get('nextPageToken')),'bodies_fetched':False}
            receipt='gmail-search'
        elif operation=='gmail.draft':
            message=EmailMessage();message['To']=parameters['to'];message['Subject']=parameters['subject'];message.set_content(parameters['body'])
            value=self.http('POST','https://gmail.googleapis.com/gmail/v1/users/me/drafts',token,{'message':{'raw':base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip('=')}})
            receipt=_identifier(value.get('id'));payload={'draft_id':receipt,'sent':False}
        else:
            phrase=parameters['query'].replace('\\','\\\\').replace("'","\\'")
            value=self.http('GET','https://www.googleapis.com/drive/v3/files?'+parse.urlencode({'q':"trashed = false and name contains '"+phrase+"'",'pageSize':20,'fields':'files(id,name,mimeType),nextPageToken'}),token)
            files=value.get('files',[])
            if not isinstance(files,list):raise IntegrationError('provider_response','La lista de Drive no es válida.',502)
            payload={'files':[{key:item[key] for key in ('id','name','mimeType') if key in item} for item in files[:20]],'more_available':bool(value.get('nextPageToken')),'contents_fetched':False}
            receipt='drive-search'
        return IntegrationResult('succeeded',receipt,payload)


class WhatsAppTransport:
    kind='whatsapp'
    def __init__(self,env,config,*,http=request_json):
        self.env=env;self.config=config;self.http=http;self.simulation=bool(getattr(http,'simulation',False))

    def preflight(self,operation):
        if operation!='whatsapp.send' or not self.env.get('BRIVANY_WHATSAPP_ACCESS_TOKEN') or not self.config.get('phone_number_id'):
            raise IntegrationError('whatsapp_configuration_pending','Configura el número y la autorización WhatsApp antes de enviar.',503)

    def execute(self,operation,parameters,idempotency_key):
        if operation!='whatsapp.send':raise IntegrationError('integration_operation','El conector solo envía el mensaje revisado.',422)
        recipient=parameters['recipient'];number=self.config.get('phone_number_id')
        if recipient!=self.config.get('self_recipient') or recipient not in self.config.get('opted_in_recipients',[]):
            raise IntegrationError('integration_opt_in','Falta el consentimiento del chat propio.',403)
        if not isinstance(number,str) or not re.fullmatch('[0-9]{5,30}',number):raise IntegrationError('whatsapp_phone_pending','Configura el identificador del número de empresa.',503)
        value=self.http('POST','https://graph.facebook.com/'+GRAPH_API_VERSION+'/'+number+'/messages',self.env.get('BRIVANY_WHATSAPP_ACCESS_TOKEN',''),
            {'messaging_product':'whatsapp','recipient_type':'individual','to':recipient,'type':'text','text':{'preview_url':False,'body':parameters['text']}})
        messages=value.get('messages',[])
        if len(messages)!=1:raise IntegrationError('provider_response','WhatsApp no devolvió una aceptación única.',502)
        receipt=messages[0].get('id')
        if not isinstance(receipt,str) or not re.fullmatch(r'wamid\.[A-Za-z0-9+/=_-]{1,180}',receipt):raise IntegrationError('provider_response','WhatsApp no devolvió un identificador válido.',502)
        return IntegrationResult('succeeded',receipt,{'accepted':True,'delivered':False,'message_id':receipt,'delivery_status_pending':True})
