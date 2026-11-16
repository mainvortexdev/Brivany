"""Melodi's hosted WhatsApp channel. Account tokens never reach the renderer."""
from __future__ import annotations
import json
import re
import time
from urllib import error,parse,request
import webbrowser
from services.brivany_account import AccountFailure,NoRedirect

ORIGIN='https://brivany.vetsa.es'
PREFIX='/api/brivany/whatsapp'
PATHS={'/number','/status','/link','/unlink','/google/calendar','/google/drive','/google/gmail','/desktop/register'}
MEETING_PATHS={'/meetings','/meetings/calendar','/meetings/detail','/meetings/schedule','/meetings/cancel'}

class WhatsAppCloudHTTP:
    origin=ORIGIN
    response_limit=32768
    def allowed(self,path):return path in PATHS
    def call(self,path,body=None,token=None):
        if not self.allowed(path):raise AccountFailure('Acción de WhatsApp no permitida.')
        if path!='/number' and not token:raise AccountFailure('Inicia sesión en tu cuenta Vetsa de Brivany.')
        headers={'Accept':'application/json','Cache-Control':'no-store','User-Agent':'Brivany-Desktop/0.1'}
        if token:headers['Authorization']='Bearer '+token
        if body is not None:headers['Content-Type']='application/json'
        req=request.Request(self.origin+PREFIX+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method='GET' if body is None else 'POST')
        try:
            with request.build_opener(NoRedirect()).open(req,timeout=15) as response:
                raw=response.read(self.response_limit+1)
                if len(raw)>self.response_limit:raise ValueError()
                result=json.loads(raw)
                if not isinstance(result,dict):raise ValueError()
                return result
        except error.HTTPError as exc:
            status=exc.code
            if parse.urlsplit(path).path in MEETING_PATHS:
                try:
                    detail=json.loads(exc.read(16385));message=detail.get('error') if isinstance(detail,dict) else None
                    if isinstance(message,str) and 0<len(message)<=300:raise AccountFailure(message)
                except AccountFailure:raise
                except (ValueError,OSError):pass
                finally:exc.close()
            exc.close()
            message='Inicia sesión en tu cuenta Vetsa de Brivany.' if status==401 else 'Primero vincula tu número desde Brivany.' if status==403 else 'Espera un minuto antes de pedir otro enlace.' if status==429 else 'El servicio de Melodi en WhatsApp no está disponible en este momento.'
            raise AccountFailure(message) from None
        except (OSError,ValueError,error.URLError):raise AccountFailure('No se pudo conectar con Melodi en WhatsApp.') from None

class MeetingsHTTP(WhatsAppCloudHTTP):
    """Same Vetsa transport; the Recall key remains in the hosted Worker."""
    origin='https://ia.vetsa.es'
    response_limit=131072
    def allowed(self,path):
        parsed=parse.urlsplit(path)
        if parsed.scheme or parsed.netloc or parsed.fragment or parsed.path not in MEETING_PATHS:return False
        if parsed.path!='/meetings/detail':return not parsed.query
        values=parse.parse_qs(parsed.query,strict_parsing=True)
        return not set(values)-{'id','part'} and len(values.get('id',[]))==1 and bool(re.fullmatch(r'[0-9a-f-]{36}',values['id'][0])) and (not values.get('part') or len(values['part'])==1 and bool(re.fullmatch(r'\d{1,3}',values['part'][0])))

class WhatsAppCloudService:
    def __init__(self,account=None,*,http=None,open_browser=None,now=None):
        self.account=account;self.http=http or WhatsAppCloudHTTP();self.open_browser=open_browser or (lambda url:webbrowser.open(url,new=2));self.now=now or time.time
        self.number_cache=None
    def number(self):
        if self.number_cache:return dict(self.number_cache)
        result=self.http.call('/number');number=result.get('number')
        if not isinstance(number,str) or not re.fullmatch(r'\d{8,15}',number) or result.get('url')!='https://wa.me/'+number:raise AccountFailure('El número de Melodi no pudo verificarse.')
        self.number_cache={'number':number,'name':'Melodi','url':result['url']}
        return dict(self.number_cache)
    def _call(self,path,body=None):
        if self.account is None:raise AccountFailure('Inicia sesión en Cuenta Vetsa desde Brivany.')
        return self.account.call_whatsapp(path,body,http=self.http)
    def status(self):
        public=self.number()
        desktop=getattr(self,'desktop',None);host={'desktop':desktop.status()} if desktop else {}
        if self.account is None or not self.account.status().get('signed_in'):return{**public,**host,'linked':False,'account_required':True}
        result=self._call('/status')
        if type(result.get('linked')) is not bool or result.get('number')!=public['number']:raise AccountFailure('El estado de WhatsApp no es válido.')
        masked=result.get('phone')
        if masked is not None and (not isinstance(masked,str) or not re.fullmatch(r'••••\d{4}',masked)):raise AccountFailure('El estado de WhatsApp no es válido.')
        return{**public,**host,'linked':result['linked'],'phone':masked,'account_required':False}
    def begin(self,*,time_zone='UTC',open_browser=False):
        if type(open_browser) is not bool or not isinstance(time_zone,str) or not time_zone or len(time_zone)>100:raise AccountFailure('Solicitud de vinculación no válida.')
        result=self._call('/link',{'timeZone':time_zone});public=self.number()
        url=result.get('url');target=parse.urlsplit(url if isinstance(url,str) else '')
        text=parse.parse_qs(target.query).get('text',[''])[0]
        if target.scheme!='https' or target.netloc!='wa.me' or target.path!='/'+public['number'] or target.fragment or not re.fullmatch(r'Brivany vincular [A-Z2-9]{16}',text):raise AccountFailure('El enlace de WhatsApp no pudo verificarse.')
        expires=result.get('expiresAt')
        if type(expires) not in (int,float) or not self.now()*1000<expires<=(self.now()+900)*1000:raise AccountFailure('El enlace de WhatsApp caducó.')
        output={**public,'url':url,'expires_at':expires,'linked':False}
        if open_browser:output['browser_open_requested']=bool(self.open_browser(url))
        return output
    def disconnect(self):
        result=self._call('/unlink',{})
        if result.get('linked') is not False:raise AccountFailure('No pude confirmar la desvinculación.')
        return{**self.number(),'linked':False,'account_required':False}
    def google(self,connector,*,open_browser=False):
        if connector not in {'calendar','drive','gmail'} or type(open_browser) is not bool:raise AccountFailure('Conexión no válida.')
        result=self._call('/google/'+connector,{})
        url=result.get('url');target=parse.urlsplit(url if isinstance(url,str) else '');expected='/oauth/'+('google' if connector=='calendar' else connector)+'/start'
        link=parse.parse_qs(target.query).get('link',[''])[0]
        if result.get('configured') is not True or target.scheme!='https' or target.netloc!='ia.vetsa.es' or target.path!=expected or target.fragment or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}',link):raise AccountFailure('No pude preparar el enlace de Google para WhatsApp.')
        output={'connector':connector,'url':target.geturl()}
        if open_browser:output['browser_open_requested']=bool(self.open_browser(output['url']))
        return output

def service(handler):
    account=getattr(handler.server,'brivany_account',None)
    current=getattr(handler.server,'whatsapp_cloud',None)
    if current is None or current.account is not account:
        current=WhatsAppCloudService(account);handler.server.whatsapp_cloud=current
    current.desktop=getattr(handler.server,'whatsapp_desktop',None)
    return current
