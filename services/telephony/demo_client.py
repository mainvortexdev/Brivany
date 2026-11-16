"""Reviewed desktop calls through the demo account; caller-owned Telnyx only."""
from .common import ProviderError,TelephonyError
from services.demo_account import DemoError

class DemoCallClient:
    def __init__(self,account):self.account=account
    def request(self,path,value=None):
        if path=='/v1/info':route='/v1/telnyx/status'
        elif path=='/v1/voicemails':return {'messages':[]}
        elif path=='/v1/calls' and isinstance(value,dict):
            route=path;value={'id':value['id'],'to':value['destination'],'objective':value['objective'],'confirmed':True}
        elif path.startswith('/v1/calls/'):
            from uuid import UUID
            parts=path.split('/');identifier=parts[3]
            try:valid=str(UUID(identifier))==identifier
            except (ValueError,TypeError):valid=False
            if not valid or len(parts)>5 or len(parts)==5 and parts[4]!='cancel':raise TelephonyError('Ruta de llamada no válida.')
            route=path
        else:raise TelephonyError('Ruta de llamada no válida.')
        try:
            result=self.account.call(route,value)
            if path.startswith('/v1/calls') and isinstance(result,dict) and 'state' in result:
                result={**result,'state':{'scheduled':'queued','active':'in-progress','cancelled':'canceled','expired':'failed','interrupted':'failed'}.get(result['state'],result['state']),'transport':'cloud','channel':'telephone'}
            return result
        except DemoError as error:raise ProviderError(str(error),uncertain=value is not None and getattr(error,'http_status',503)>=500,http_status=getattr(error,'http_status',503)) from None
    def close(self):pass
