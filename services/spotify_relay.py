"""Bounded HTTPS handoff. No Spotify tokens or PKCE verifiers reach this service."""
import json
import re
from urllib.error import HTTPError,URLError
from urllib.request import Request,build_opener,HTTPRedirectHandler,HTTPSHandler
from services.spotify_tls import verified_context

BASE='https://brivany.vetsa.es'
REDIRECT=BASE+'/spotify/callback'


class SpotifyRelayError(ValueError):
    def __init__(self,message,*,expired=False):super().__init__(message);self.expired=expired


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


class SpotifyRelay:
    def request(self,path,*,data=None,secret=None):
        if path not in {'/api/spotify/config','/api/spotify/oauth/start','/api/spotify/oauth/poll','/api/spotify/oauth/ack'}:raise SpotifyRelayError('Ruta de vinculación inválida.')
        headers={'Accept':'application/json','User-Agent':'BrivanyDesktop/0.1 (+'+BASE+')'};body=None
        if data is not None:body=json.dumps(data).encode();headers['Content-Type']='application/json'
        if secret:headers['Authorization']='Bearer '+secret
        try:
            try:response=build_opener(NoRedirect(),HTTPSHandler(context=verified_context())).open(Request(BASE+path,data=body,headers=headers,method='POST' if body is not None else 'GET'),timeout=12)
            except HTTPError as error:response=error
            with response:
                raw=response.read(8193)
                if response.code==410:raise SpotifyRelayError('La vinculación caducó. Vuelve a comenzar.',expired=True)
                if response.code==429:raise SpotifyRelayError('Hay demasiados intentos de vinculación. Espera un minuto antes de continuar.')
                if not 200<=response.code<300:raise SpotifyRelayError('No se pudo completar la vinculación segura. Vuelve a intentarlo desde Melodi.')
                if len(raw)>8192 or not response.headers.get('Content-Type','').startswith('application/json'):raise SpotifyRelayError('Respuesta de vinculación inválida.')
                result=json.loads(raw)
                if not isinstance(result,dict):raise SpotifyRelayError('Respuesta de vinculación inválida.')
                return result
        except (URLError,OSError):raise SpotifyRelayError('No se pudo conectar con la vinculación segura de Brivany. Comprueba tu conexión.') from None
        except (UnicodeError,json.JSONDecodeError):raise SpotifyRelayError('Respuesta de vinculación inválida.') from None
    def config(self):
        value=self.request('/api/spotify/config')
        if not re.fullmatch(r'[a-fA-F0-9]{32}',value.get('client_id','')) or value.get('redirect_uri')!=REDIRECT:raise SpotifyRelayError('La configuración publicada de Spotify no es válida.')
        mode=value.get('access_mode','unknown')
        if not isinstance(mode,str) or mode not in {'unknown','development','extended'}:raise SpotifyRelayError('El modo de acceso de Spotify publicado no es válido.')
        return {**value,'access_mode':mode}
    def start(self,**data):
        value=self.request('/api/spotify/oauth/start',data=data)
        if (not re.fullmatch(r'[A-Za-z0-9_-]{43}\.\d{10}\.[A-Za-z0-9_-]{43}',value.get('state',''))
                or value.get('client_id')!=data['client_id'] or value.get('redirect_uri')!=REDIRECT
                or type(value.get('expires_in')) is not int or not 1<=value['expires_in']<=300):raise SpotifyRelayError('La vinculación recibida no es válida.')
        return value
    def poll(self,state,secret):return self.request('/api/spotify/oauth/poll',data={'state':state},secret=secret)
    def acknowledge(self,state,secret):return self.request('/api/spotify/oauth/ack',data={'state':state},secret=secret)
