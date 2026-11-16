"""Authenticated meeting commands through the existing private Vetsa session."""
import re
from urllib.parse import urlencode
from services.brivany_account import AccountFailure
from services.whatsapp_cloud import MeetingsHTTP

class MeetingService:
    def __init__(self,account,*,http=None):self.account=account;self.http=http or MeetingsHTTP()
    def call(self,action,body=None,*,query=None):
        routes={'list':'/meetings','calendar':'/meetings/calendar','detail':'/meetings/detail','launch':'/meetings','schedule':'/meetings/schedule','cancel':'/meetings/cancel'}
        if action not in routes:raise AccountFailure('Acción de reuniones no permitida.')
        if self.account is None:raise AccountFailure('Inicia sesión en Cuenta Vetsa desde Brivany.')
        path=routes[action]
        if action=='detail':
            value=query or {};identifier=value.get('id','');part=str(value.get('part','0'))
            if not re.fullmatch(r'[0-9a-f-]{36}',identifier) or not re.fullmatch(r'\d{1,3}',part):raise AccountFailure('Reunión no válida.')
            path+='?'+urlencode({'id':identifier,'part':part})
        if (action in {'launch','schedule','cancel'})!=(body is not None):raise AccountFailure('Solicitud de reuniones no válida.')
        return self.account.call_whatsapp(path,body,http=self.http)

def service(handler):return MeetingService(getattr(handler.server,'brivany_account',None))
