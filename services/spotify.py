"""Spotify Connect controller. PKCE and tokens stay in the native process.

No private Spotify endpoints, embedded login, audio streaming or lyric scraping.
The user chooses an existing Spotify playback device. All HTTP is bounded and
mutations are sent once (never automatically retried).
"""
import base64
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlencode, urlsplit, parse_qs
from urllib.request import Request, build_opener, HTTPRedirectHandler,HTTPSHandler
from urllib.error import HTTPError, URLError
from services.spotify_relay import SpotifyRelay,SpotifyRelayError,BASE as RELAY_BASE,REDIRECT
from services.spotify_tls import verified_context
from services.lyrics import LyricsService
from services.spotify_artwork import ArtworkService,artwork_url
from services.spotify_resume import SpotifyResume

PLAYBACK_SCOPES='user-read-playback-state user-read-currently-playing user-modify-playback-state'
LIBRARY_SCOPES='playlist-read-private playlist-read-collaborative user-library-read'
HISTORY_SCOPE='user-read-recently-played'
STREAMING_SCOPES='streaming user-read-private user-read-email'
SCOPES=PLAYBACK_SCOPES+' '+LIBRARY_SCOPES+' '+HISTORY_SCOPE+' '+STREAMING_SCOPES
REGISTER_REDIRECT=REDIRECT


class SpotifyError(ValueError):
    def __init__(self,message,retry_after=0):super().__init__(message);self.retry_after=retry_after


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def transport(method,url,headers,body):
    parsed=urlsplit(url)
    if parsed.scheme!='https' or parsed.hostname not in {'accounts.spotify.com','api.spotify.com'} or parsed.port or parsed.username or parsed.password:
        raise SpotifyError('Destino Spotify inválido.')
    try:
        response=build_opener(NoRedirect(),HTTPSHandler(context=verified_context())).open(Request(url,data=body,headers=headers,method=method),timeout=12)
    except HTTPError as error:response=error
    except (URLError,OSError):raise SpotifyError('No se pudo conectar con Spotify. Comprueba tu conexión.') from None
    with response:
        raw=response.read(1048577)
        if len(raw)>1048576:raise SpotifyError('Respuesta Spotify demasiado grande.')
        try:data=json.loads(raw) if raw else {}
        except (ValueError,UnicodeError):data={}
        return response.code,dict(response.headers),data




class SpotifyService:
    def __init__(self,root,*,http=transport,protector=None,clock=time.time,relay=None,start_polling=True,lyrics_provider=None,artwork_provider=None):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        if protector is None:
            from services.google_oauth import WindowsDPAPIProtector
            protector=WindowsDPAPIProtector()
        self.protector=protector;self.http=http;self.clock=clock;self.lock=threading.RLock()
        self.tokens={};self.flow=None;self.generation=0;self.cache=None;self.cached_at=0;self.devices=[];self.devices_at=0;self.cooldown=0;self.selected_device=None;self.message='';self.library_cache={};self.library_items={};self.lyrics_provider=lyrics_provider or LyricsService(clock=clock)
        self.playback_revision=getattr(self,'playback_revision',0)+1;self.sdk_snapshot=None;self.sdk_seen=0;self.local_player={'state':'idle','id':None,'message':''}
        self.library_sources={};self.queue_plan=None;self.queue_generation=0;self.queue_message='';self.queue_workers=True
        self.artwork_provider=artwork_provider or ArtworkService(clock=clock);self.current_fallback_at=-999
        self.account_checked_at=-999;self.account_device=None;self.account_observed=False;self.playback_interval=8;self.player_gain=None
        self.relay=relay or SpotifyRelay();self.start_polling=start_polling;self.poll_stop=threading.Event()
        self.client_id=os.environ.get('BRIVANY_SPOTIFY_CLIENT_ID','').strip()
        config=self.root/'client.json'
        if not self.client_id and config.exists():
            try:self.client_id=json.loads(config.read_text())['client_id']
            except (OSError,ValueError,KeyError):pass
        if not re.fullmatch(r'[a-fA-F0-9]{32}',self.client_id):self.client_id=''
        token_file=self.root/'authorization.bin'
        if self.client_id and protector.available and token_file.exists():
            try:
                saved=json.loads(protector.unprotect(token_file.read_bytes()))
                if saved.get('client_id')==self.client_id:self.tokens=saved['tokens']
            except Exception:self.message='Vuelve a vincular Spotify; no se pudo leer la autorización protegida.'
        self.resume=SpotifyResume(self.root,protector,clock);self.resume.load(self.client_id);self.restoring_until=0
    def status(self):
        with self.lock:
            self._load_rate_limit()
            return {'configured':bool(self.client_id),'client_id':self.client_id,'connected':bool(self.tokens.get('refresh_token') or self.tokens.get('access_token')),
                'retry_after':max(0,math.ceil(self.cooldown-self.clock())),
                'pending':bool(self.flow and self.flow['until']>self.clock()),'message':self.message,'redirect_uri':REGISTER_REDIRECT,
                'persistent':bool(self.protector.available),'lyrics_source':'LRCLIB / SyncLRC / Lyrics.ovh','queue_message':self.queue_message,'local_player':dict(self.local_player),'streaming_access':set(STREAMING_SCOPES.split())<=set(self.tokens.get('scope','').split()),'history_access':HISTORY_SCOPE in self.tokens.get('scope','').split(),'library_access':set(LIBRARY_SCOPES.split())<=set(self.tokens.get('scope',PLAYBACK_SCOPES).split())}
    def configure(self,client_id):
        if not isinstance(client_id,str) or not re.fullmatch(r'[a-fA-F0-9]{32}',client_id.strip()):raise SpotifyError('Pega el Client ID de 32 caracteres de tu aplicación de Spotify.')
        with self.lock:
            if self.client_id!=client_id.strip():self.disconnect()
            self.client_id=client_id.strip();(self.root/'client.json').write_text(json.dumps({'client_id':self.client_id}),encoding='utf-8')
            return self.status()
    def _save(self):
        if not self.protector.available:return
        try:
            raw=json.dumps({'client_id':self.client_id,'tokens':self.tokens}).encode()
            encrypted=self.protector.protect(raw)
            path=self.root/'authorization.bin';temp=path.with_suffix('.tmp');temp.write_bytes(encrypted);temp.replace(path)
        except Exception:raise SpotifyError('No se pudo guardar la autorización en el almacén seguro del sistema.') from None
    def _load_rate_limit(self):
        try:
            value=json.loads((self.root/'rate-limit.json').read_text(encoding='utf-8'))
            until=value.get('until',0)
            if value.get('client_id')==self.client_id and type(until) in (int,float) and math.isfinite(until):self.cooldown=max(self.cooldown,until)
        except (OSError,ValueError,TypeError):pass
    def _request(self,method,path,*,form=None,data=None,authorized=True):
        self._load_rate_limit()
        if self.clock()<self.cooldown:raise SpotifyError('Spotify pidió esperar. Se reanudará al terminar el plazo.',max(1,math.ceil(self.cooldown-self.clock())))
        headers={'Accept':'application/json','User-Agent':'BrivanyDesktop/0.1 (+https://brivany.example)'};body=None
        if authorized:
            if not self.tokens:raise SpotifyError('Vincula tu cuenta de Spotify primero.')
            if self.tokens.get('expires_at',0)<self.clock()+45:self._refresh()
            headers['Authorization']='Bearer '+self.tokens['access_token']
        if form is not None:body=urlencode(form).encode();headers['Content-Type']='application/x-www-form-urlencoded'
        elif data is not None:body=json.dumps(data).encode();headers['Content-Type']='application/json'
        code,meta,result=self.http(method,('https://api.spotify.com/v1' if authorized else 'https://accounts.spotify.com')+path,headers,body)
        if code==429:
            try:delay=max(1,min(31536000,int(next((v for k,v in meta.items() if k.lower()=='retry-after'),'30'))))
            except (ValueError,TypeError):delay=30
            self.cooldown=self.clock()+delay
            try:
                temp=self.root/'rate-limit.tmp';temp.write_text(json.dumps({'client_id':self.client_id,'until':self.cooldown}),encoding='utf-8');temp.replace(self.root/'rate-limit.json')
            except OSError:pass
        if not 200<=code<300:
            messages={401:'La autorización ha caducado. Vuelve a vincular Spotify.',403:'Spotify no permite esta acción. Comprueba Premium y el acceso de tu cuenta a la app.',404:'Abre Spotify y comienza una canción en el dispositivo elegido.',429:'Spotify pidió esperar. Inténtalo de nuevo más tarde.'}
            raise SpotifyError(messages.get(code,'Spotify no pudo completar la solicitud.'),max(0,math.ceil(self.cooldown-self.clock())))
        return result
    def _set_tokens(self,value,*,refreshing=False):
        if not isinstance(value,dict) or not isinstance(value.get('access_token'),str) or value.get('token_type','').lower()!='bearer':raise SpotifyError('La autorización recibida no es válida.')
        granted=set(value.get('scope',self.tokens.get('scope',PLAYBACK_SCOPES) if refreshing else SCOPES).split())
        if not set(PLAYBACK_SCOPES.split())<=granted:raise SpotifyError('Faltan permisos de reproducción. Vuelve a vincular Spotify.')
        refresh=value.get('refresh_token') or self.tokens.get('refresh_token')
        self.tokens={'access_token':value['access_token'],'refresh_token':refresh,'expires_at':self.clock()+max(60,min(86400,int(value.get('expires_in',3600)))),'scope':' '.join(sorted(granted))}
        if not refreshing:
            self.cache=None;self.devices=[];self.devices_at=0;self.selected_device=None
            self.library_sources.clear();self.queue_plan=None;self.queue_generation+=1;self.queue_message='';self.library_cache.clear();self.library_items.clear();self.lyrics_provider.clear();self.artwork_provider.clear();self.playback_revision=getattr(self,'playback_revision',0)+1;self.sdk_snapshot=None;self.sdk_seen=0;self.local_player={'state':'idle','id':None,'message':''}
        self._save()
    def _refresh(self):
        refresh=self.tokens.get('refresh_token')
        if not refresh:raise SpotifyError('Vuelve a vincular Spotify para renovar la autorización.')
        self._set_tokens(self._request('POST','/api/token',form={'grant_type':'refresh_token','refresh_token':refresh,'client_id':self.client_id},authorized=False),refreshing=True)
    def begin(self):
        with self.lock:
            self.cancel_link()
            try:published=self.relay.config()
            except SpotifyRelayError as error:raise SpotifyError(str(error)) from None
            if self.client_id!=published['client_id']:self.configure(published['client_id'])
            verifier=secrets.token_urlsafe(64);nonce=secrets.token_urlsafe(32);reader=secrets.token_urlsafe(32);launch=secrets.token_urlsafe(32)
            challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
            try:created=self.relay.start(nonce=nonce,client_id=self.client_id,challenge=challenge,read_hash=hashlib.sha256(reader.encode()).hexdigest(),launch_hash=hashlib.sha256(launch.encode()).hexdigest())
            except SpotifyRelayError as error:raise SpotifyError(str(error)) from None
            self.generation+=1;self.poll_stop=threading.Event()
            flow={'verifier':verifier,'state':created['state'],'redirect':REGISTER_REDIRECT,'reader':reader,'until':self.clock()+created['expires_in'],'generation':self.generation}
            self.flow=flow;self.message=''
            if self.start_polling:threading.Thread(target=self._poll_link,args=(flow,self.poll_stop),daemon=True,name='spotify-https-handoff').start()
            return RELAY_BASE+'/spotify/connect?'+urlencode({'state':flow['state'],'launch':launch})
    def _poll_link(self,flow,stopped):
        while not stopped.wait(2):
            with self.lock:
                if self.flow is not flow:return
                if self.clock()>=flow['until']:
                    self.flow=None;self.message='La vinculación caducó. Vuelve a comenzar.';return
            try:result=self.relay.poll(flow['state'],flow['reader'])
            except SpotifyRelayError as error:
                with self.lock:
                    if self.flow is not flow:return
                    self.message=str(error)
                    if error.expired:self.flow=None;return
                if stopped.wait(5):return
                continue
            if stopped.is_set():return
            if result.get('status')=='pending':continue
            with self.lock:
                if self.flow is not flow:return
                try:
                    if result.get('status')!='ready':raise SpotifyError('Respuesta de vinculación inválida.')
                    self.complete(flow['state'],result.get('code') or '',result.get('error') or '')
                except SpotifyError as error:self.flow=None;self.message=str(error)
            self._acknowledge(flow);return
    def _acknowledge(self,flow):
        try:self.relay.acknowledge(flow['state'],flow['reader'])
        except SpotifyRelayError:pass # The relay's deadline still denies later retrieval.
    def cancel_link(self):
        self.poll_stop.set();flow=self.flow;self.flow=None
        if flow:threading.Thread(target=self._acknowledge,args=(flow,),daemon=True,name='spotify-handoff-cleanup').start()
    def complete(self,state,code,error=''):
        with self.lock:
            flow=self.flow
            if not flow or self.clock()>flow['until'] or not isinstance(state,str) or not hmac.compare_digest(state,flow['state']):raise SpotifyError('La autorización no coincide o ha caducado.')
            self.flow=None
            if error:
                self.message='Vinculación cancelada en Spotify.';raise SpotifyError(self.message)
            if not isinstance(code,str) or not 1<=len(code)<=4096:raise SpotifyError('Código inválido.')
            try:self._set_tokens(self._request('POST','/api/token',form={'grant_type':'authorization_code','code':code,'redirect_uri':flow['redirect'],'client_id':self.client_id,'code_verifier':flow['verifier']},authorized=False))
            except SpotifyError as exc:self.message=str(exc);raise
            self.message=''
            return self.status()
    def disconnect(self):
        with self.lock:
            self.resume.clear()
            self.cancel_link();self.generation+=1;self.tokens={};self.cache=None;self.devices=[];self.selected_device=None;self.message='';self.cooldown=0;self.library_sources.clear();self.queue_plan=None;self.queue_generation+=1;self.queue_message='';self.library_cache.clear();self.library_items.clear();self.lyrics_provider.clear();self.artwork_provider.clear();self.playback_revision=getattr(self,'playback_revision',0)+1;self.sdk_snapshot=None;self.sdk_seen=0;self.local_player={'state':'idle','id':None,'message':''}
            (self.root/'authorization.bin').unlink(missing_ok=True)
            return self.status()
    def playback(self):
        with self.lock:
            if not self.status()['connected']:return {**self.status(),'playback':None,'devices':[]}
            local=self.sdk_current()
            if local and self.clock()-self.account_checked_at<self.playback_interval:return local
            if self.cache is not None and self.clock()-self.cached_at<self.playback_interval:return {**self.cache,**self.status()}
            try:raw=self._request('GET','/me/player') or {}
            except SpotifyError as error:
                fallback=local or self.cache
                if fallback:return {**fallback,**self.status(),'playback_stale':not bool(local),'playback_warning':str(error)}
                if self.resume.value:
                    return {**self.status(),'playback_revision':self.playback_revision,'observed_at':self.clock(),'playback':self._checkpoint_playback(),'last_listened':None,'recovery_available':True,'music_ambience_until':self.resume.value.get('music_at',0)+300,'devices':[{k:d.get(k) for k in ('id','name','type','is_active','is_restricted','supports_volume')} for d in self.devices if d.get('id')],'playback_stale':True,'playback_warning':str(error)}
                return {**self.status(),'playback':None,'devices':[],'playback_warning':str(error),'playback_stale':True}
            device=raw.get('device') or {};warning='';self.account_checked_at=self.clock();self.account_observed=True;self.account_device=device.get('id')
            if not raw.get('item') and not device.get('is_private_session') and self.clock()-self.current_fallback_at>=10:
                self.current_fallback_at=self.clock()
                try:
                    current=self._request('GET','/me/player/currently-playing') or {}
                    if current.get('item'):raw={**raw,**current};device=raw.get('device') or device
                except SpotifyError as error:warning=str(error)
            item=raw.get('item') or {}
            if self.clock()-self.devices_at>=30:
                self.devices_at=self.clock()
                try:self.devices=self._request('GET','/me/player/devices').get('devices',[])
                except SpotifyError as error:warning=str(error)
            if not device:device=next((d for d in self.devices if d.get('is_active')),{} )
            self.account_device=device.get('id')
            if device.get('id'):
                self.devices=[d for d in self.devices if d.get('id')!=device['id']]+[device]
            if self.selected_device and (device.get('id')==self.selected_device or not any(d.get('id')==self.selected_device for d in self.devices)):self.selected_device=None
            track_id=item.get('id','');track_id=track_id if re.fullmatch(r'[A-Za-z0-9]{22}',track_id) else ''
            artwork=artwork_url((item.get('album') or {}).get('images',[]))
            playback={'id':track_id,'type':item.get('type'),'title':str(item.get('name',''))[:240],'artist':', '.join(str(a.get('name','')) for a in item.get('artists',[]))[:400],
                'album':str((item.get('album') or {}).get('name',''))[:240],'artwork':artwork,'url':'https://open.spotify.com/track/'+track_id if track_id and item.get('type')=='track' else '',
                'duration_ms':item.get('duration_ms',0),'progress_ms':raw.get('progress_ms',0) or 0,'playing':raw.get('is_playing') is True,'device':device.get('id'),
                'shuffle':raw.get('shuffle_state') is True,'repeat':raw.get('repeat_state','off'),'disallows':(raw.get('actions') or {}).get('disallows',{}),'volume':device.get('volume_percent',0),'supports_volume':device.get('supports_volume') is True}
            recovery=False
            if item and not device.get('is_private_session'):
                # Account state outranks both a restored SDK view and history.
                self.resume.remember(self.client_id,playback,context=(raw.get('context') or {}).get('uri',''),local=device.get('id')==self.local_player.get('id'))
            elif not device.get('is_private_session') and self.resume.value:
                recovery=True;playback=self._checkpoint_playback()
            active=any(d.get('is_active') for d in self.devices)
            reason='private_session' if device.get('is_private_session') else 'no_current_track' if active else 'no_active_device'
            self.playback_revision+=1
            self.cached_at=self.clock();self.cache={'playback_revision':self.playback_revision,'observed_at':self.clock(),**self.status(),'playback':playback if item or recovery else None,'last_listened':None,'recovery_available':recovery,'music_ambience_until':self.resume.value.get('music_at',0)+300 if self.resume.value else 0,'empty_reason':reason if not item else None,'playback_warning':warning,'devices':[{k:d.get(k) for k in ('id','name','type','is_active','is_restricted','supports_volume')} for d in self.devices if d.get('id')]}
            return self.cache
    def _checkpoint_playback(self):
        local_id=self.local_player.get('id')
        if local_id and self.local_player['state']=='ready' and not any(d.get('id')==local_id for d in self.devices):self.devices.append({'id':local_id,'name':'Brivany','type':'Computer','is_active':False,'is_restricted':False,'supports_volume':True})
        return {**self.resume.value['playback'],'playing':False,'device':local_id,'disallows':{}}
    def restore_playback(self):
        with self.lock:
            state=self.playback()
            if not state.get('recovery_available'):return None
            target=self.local_player.get('id');data=self.resume.request()
            if not data or not target or self.local_player['state']!='ready':raise SpotifyError('Pulsa Escuchar aquí para preparar Brivany.')
            self._request('PUT','/me/player/play?'+urlencode({'device_id':target}),data=data)
            self.restoring_until=self.clock()+8;self.account_observed=False;self.account_checked_at=-999;self.cache=None
            return {'accepted':True}
    def command(self,action,value=None):
        with self.lock:
            state=self.playback();p=state.get('playback') or {};disallows=p.get('disallows',{})
            if action=='transfer':
                if not isinstance(value,str) or not any(d['id']==value and not d.get('is_restricted') for d in self.devices):raise SpotifyError('Selecciona un dispositivo disponible y sin restricciones.')
                result=self._request('PUT','/me/player',data={'device_ids':[value],'play':p.get('playing',False)});self.selected_device=value;self.devices_at=0
                self.account_observed=False;self.account_checked_at=-999
            else:
                if not p.get('device') or not any(d['id']==p['device'] and not d.get('is_restricted') for d in self.devices):raise SpotifyError('Activa un dispositivo de Spotify antes de usar los controles.')
                blocked={'play':'resuming','pause':'pausing','next':'skipping_next','previous':'skipping_prev','seek':'seeking','shuffle':'toggling_shuffle','repeat':'toggling_repeat_context'}
                if action not in blocked and action!='volume':raise SpotifyError('Control de Spotify inválido.')
                if action=='repeat' and value=='track' and disallows.get('toggling_repeat_track'):raise SpotifyError('Spotify restringe la repetición de esta canción.')
                if disallows.get(blocked.get(action)):raise SpotifyError('Spotify restringe este control en la reproducción actual.')
                method='POST' if action in {'next','previous'} else 'PUT';path='/me/player/'+action;query={}
                if action in {'seek','volume'}:
                    limit=p.get('duration_ms',0) if action=='seek' else 100
                    if type(value) is not int or not 0<=value<=limit:raise SpotifyError('Valor de reproducción inválido.')
                    if action=='volume' and not p.get('supports_volume'):raise SpotifyError('Este dispositivo no admite volumen remoto.')
                    query['position_ms' if action=='seek' else 'volume_percent']=value
                if action=='shuffle':
                    if type(value) is not bool:raise SpotifyError('Estado inválido.')
                    query['state']=str(value).lower()
                if action=='repeat':
                    if value not in ('off','context','track'):raise SpotifyError('Repetición inválida.')
                    query['state']=value
                result=self._request(method,path+('?' +urlencode(query) if query else ''))
            self.cache=None
            return {'accepted':True} # An accepted command is not proof of playback.
    def library(self,kind='playlists',page=0):
        paths={'playlists':'/me/playlists','albums':'/me/albums','tracks':'/me/tracks','recent':'/me/player/recently-played'}
        if kind not in paths or type(page) is not int or not 0<=page<=5000:raise SpotifyError('Página de biblioteca inválida.')
        with self.lock:
            if not self.status()['connected']:raise SpotifyError('Vincula Spotify desde Conexiones e integraciones.')
            if not (self.status()['history_access'] if kind=='recent' else self.status()['library_access']):return {'access_required':True,'items':[],'kind':kind,'page':page,'has_next':False}
            key=(kind,page);saved=self.library_cache.get(key)
            if saved and self.clock()-saved[0]<300:return saved[1]
            if kind=='recent' and page!=0:raise SpotifyError('Las escuchas recientes muestran los últimos 20 temas.')
            try:raw=self._request('GET',paths[kind]+'?'+urlencode({'limit':20} if kind=='recent' else {'limit':20,'offset':page*20}))
            except SpotifyError as error:
                if error.retry_after or saved:return {**(saved[1] if saved else {'kind':kind,'page':page,'items':[],'has_next':False}),'retry_after':error.retry_after or 15,'stale':True,'message':str(error)}
                raise
            items=[]
            for row in (raw.get('items') or [])[:20]:
                if not isinstance(row,dict):continue
                item=row if kind=='playlists' else row.get('album' if kind=='albums' else 'track') or {}
                identifier=item.get('id','');category={'playlists':'playlist','albums':'album','tracks':'track','recent':'track'}[kind]
                if not isinstance(identifier,str) or not re.fullmatch(r'[A-Za-z0-9]{22}',identifier) or item.get('is_local'):continue
                uri='spotify:'+category+':'+identifier
                images=(item.get('album') or {}).get('images',[]) if category=='track' else item.get('images',[])
                art=artwork_url(images)
                subtitle=', '.join(str(a.get('name','')) for a in item.get('artists',[]))[:300] if category!='playlist' else 'Playlist'
                items.append({'uri':uri,'title':str(item.get('name',''))[:240],'subtitle':subtitle,'artwork':art,'type':category,'id':identifier,'artist':subtitle,'album':str((item.get('album') or {}).get('name',''))[:240],'duration_ms':item.get('duration_ms',0),'url':'https://open.spotify.com/track/'+identifier if category=='track' else ''})
                self.library_items[uri]=self.clock()
                if category=='track' and (kind=='tracks' or uri not in self.library_sources):self.library_sources[uri]=(kind,page)
            result={'kind':kind,'page':page,'items':items,'has_next':kind!='recent' and bool(raw.get('next')) and page<5000,'access_required':False}
            self.library_cache[key]=(self.clock(),result)
            while len(self.library_cache)>24:self.library_cache.pop(next(iter(self.library_cache)))
            self.library_items=dict(list((uri,seen) for uri,seen in self.library_items.items() if self.clock()-seen<1800)[-1000:])
            self.library_sources={uri:source for uri,source in self.library_sources.items() if uri in self.library_items}
            return result
    def play_item(self,uri,device_id=None):
        with self.lock:
            if not isinstance(uri,str) or not re.fullmatch(r'spotify:(?:track|album|playlist):[A-Za-z0-9]{22}',uri) or self.clock()-self.library_items.get(uri,-999999)>1800:raise SpotifyError('Elige un elemento de tu biblioteca cargada.')
            state=self.playback();p=state.get('playback') or {}
            available=[d.get('id') for d in self.devices if not d.get('is_restricted')]
            target=device_id or self.selected_device or p.get('device') or next((d.get('id') for d in self.devices if d.get('is_active') and not d.get('is_restricted')),None) or (available[0] if len(available)==1 else None)
            if not target or not any(d.get('id')==target and not d.get('is_restricted') for d in self.devices):raise SpotifyError('Abre Spotify y selecciona un dispositivo disponible antes de reproducir.')
            self.queue_generation+=1;self.queue_plan=None;self.queue_message=''
            if uri.startswith('spotify:track:'):
                uris,plan=self._track_queue(uri,target);data={'uris':uris}
            else:data={'context_uri':uri};plan=None
            self._request('PUT','/me/player/play?'+urlencode({'device_id':target}),data=data);self.cache=None;self.queue_plan=plan
            return {'accepted':True}
    def _track_queue(self,uri,target):
        # Saved songs have no Spotify context URI: start a real multi-track queue.
        kind,page=self.library_sources.get(uri,('tracks',0))
        if kind!='tracks':kind,page='tracks',0
        sequence=[uri];next_page=None
        if self.status()['library_access']:
            for _ in range(3):
                rows=self.library(kind,page);found=[x['uri'] for x in rows['items']]
                if uri in found:found=found[found.index(uri)+1:]
                for entry in found:
                    if entry not in sequence:sequence.append(entry)
                next_page=page+1 if rows.get('has_next') else None
                if len(sequence)>=20 or next_page is None:break
                page=next_page
        plan={'generation':self.queue_generation,'kind':kind,'next_page':next_page,'tail':sequence[-2:],'seen':set(sequence),'device':target,'extending':False}
        return sequence,plan
    def _maybe_extend_queue(self,identifier):
        plan=self.queue_plan
        if not plan or plan['extending'] or plan['next_page'] is None or 'spotify:track:'+identifier not in plan['tail']:return
        plan['extending']=True
        if self.queue_workers:threading.Thread(target=self._extend_queue,args=(plan,),daemon=True,name='spotify-queue-continuity').start()
    def _extend_queue(self,plan):
        # Each append is sent once; a lost acknowledgement must not duplicate it.
        try:
            with self.lock:
                if self.queue_plan is not plan or plan['generation']!=self.queue_generation:return
                rows=self.library(plan['kind'],plan['next_page']);entries=[x['uri'] for x in rows['items'] if x['uri'] not in plan['seen']]
            added=[]
            for uri in entries:
                with self.lock:
                    if self.queue_plan is not plan or plan['generation']!=self.queue_generation:return
                    if not any(d.get('id')==plan['device'] and not d.get('is_restricted') for d in self.devices):raise SpotifyError('Dispositivo no disponible para continuar.')
                    self._request('POST','/me/player/queue?'+urlencode({'uri':uri,'device_id':plan['device']}));plan['seen'].add(uri);added.append(uri)
            with self.lock:
                if self.queue_plan is plan:
                    plan['next_page']=plan['next_page']+1 if rows.get('has_next') and added else None
                    if added:plan['tail']=added[-2:]
                    plan['extending']=False
        except SpotifyError:
            with self.lock:
                if self.queue_plan is plan:
                    plan['next_page']=None;plan['extending']=False;self.queue_message='No se pudo ampliar la cola. Los temas ya cargados siguen disponibles.'
    def sdk_token(self):
        with self.lock:
            if not self.status()['streaming_access']:raise SpotifyError('Actualiza el acceso en Conexiones para reproducir desde Brivany.')
            if self.tokens.get('expires_at',0)<self.clock()+45:self._refresh()
            return {'access_token':self.tokens['access_token']}
    def sdk_event(self,kind,device_id=''):
        messages={'idle':'','starting':'Preparando el dispositivo Brivany…','ready':'','not_ready':'El reproductor Brivany perdió la conexión.','initialization_error':'El motor no admite la reproducción protegida de Spotify.','authentication_error':'Actualiza el acceso de Spotify en Conexiones.','account_error':'La reproducción dentro de Brivany requiere Spotify Premium.','playback_error':'Spotify no pudo reproducir la canción.','autoplay_failed':'Spotify bloqueó el audio. Vuelve a pulsar Escuchar aquí.','connection_error':'No se pudo conectar el reproductor Brivany con Spotify.'}
        if kind not in messages:raise SpotifyError('Estado de reproductor inválido.')
        if kind=='ready' and (not isinstance(device_id,str) or not re.fullmatch(r'[A-Za-z0-9]{16,128}',device_id)):raise SpotifyError('Dispositivo de reproductor inválido.')
        with self.lock:
            identifier=device_id if kind=='ready' else self.local_player.get('id') if kind in ('playback_error','autoplay_failed') else None
            self.local_player={'state':kind,'id':identifier,'message':messages[kind]};self.cache=None;self.devices_at=0
            if kind in ('idle','not_ready','authentication_error','account_error'):self.sdk_snapshot=None
            return dict(self.local_player)
    def sdk_playback(self,value):
        with self.lock:
            gain=value.get('gain') if isinstance(value,dict) else None
            if isinstance(gain,dict) and all(type(gain.get(k)) in (int,float) and math.isfinite(gain[k]) and 0<=gain[k]<=1 for k in ('base','gain','target','applied')):
                self.player_gain={k:round(gain[k],4) for k in ('base','gain','target','applied')}
            if value is None:
                if self.sdk_snapshot:self.cache=None;self.playback_revision+=1
                self.sdk_snapshot=None;return None
            if not isinstance(value,dict) or type(value.get('paused')) is not bool:raise SpotifyError('Estado de audio inválido.')
            item=value.get('track') or {};identifier=item.get('id','')
            if not isinstance(identifier,str) or not re.fullmatch(r'[A-Za-z0-9]{22}',identifier):return None
            duration=value.get('duration');position=value.get('position');volume=value.get('volume',.5)
            if type(duration) not in (int,float) or type(position) not in (int,float) or not math.isfinite(duration) or not math.isfinite(position) or not 0<duration<=86400000 or not -1000<=position<=duration+3000:raise SpotifyError('Tiempos de audio inválidos.')
            duration=round(duration);position=max(0,min(duration,round(position)))
            if type(volume) not in (int,float) or not 0<=volume<=1:raise SpotifyError('Volumen de audio inválido.')
            artists=item.get('artists') or [];album=item.get('album') or {}
            self.sdk_snapshot={'id':identifier,'type':'track','title':str(item.get('name',''))[:240],'artist':', '.join(str(a.get('name','')) for a in artists if isinstance(a,dict))[:400],'album':str(album.get('name',''))[:240],'artwork':artwork_url(album.get('images',[])),'url':'https://open.spotify.com/track/'+identifier,'duration_ms':duration,'progress_ms':position,'playing':not value['paused'],'device':self.local_player.get('id'),'volume':round(volume*100),'supports_volume':True,'shuffle':value.get('shuffle') is True,'repeat':{0:'off',1:'context',2:'track'}.get(value.get('repeat_mode'),'off'),'disallows':{k:v is True for k,v in (value.get('disallows') or {}).items() if k in ('pausing','resuming','skipping_next','skipping_prev','seeking')}}
            self.sdk_seen=self.clock();self.playback_revision+=1
            if self.account_observed and self.account_device==self.local_player.get('id') or self.clock()<self.restoring_until:
                self.resume.remember(self.client_id,self.sdk_snapshot,context=value.get('context_uri',''),next_tracks=value.get('next_uris'),local=True)
            if not self.account_observed and self.account_checked_at==-999:self.account_checked_at=self.clock()
            if not value['paused']:self._maybe_extend_queue(identifier)
            if self.sdk_snapshot['playing']:self.local_player.update(state='ready',message='')
            return self.sdk_current()
    def audio_diagnostics(self):
        with self.lock:
            return {'local_state':self.local_player['state'],'snapshot_age':round(max(0,self.clock()-self.sdk_seen),2) if self.sdk_seen else None,'local_playing':bool(self.sdk_snapshot and self.sdk_snapshot.get('playing')),'gain':dict(self.player_gain) if self.player_gain else None}
    def sdk_current(self):
        with self.lock:
            if not self.sdk_snapshot or self.clock()-self.sdk_seen>3 or not any(d.get('id')==self.local_player.get('id') for d in self.devices):return None
            if self.resume.value and not self.account_observed and self.clock()>=self.restoring_until:return None
            if self.account_observed and self.account_device!=self.local_player.get('id'):return None
            return {'playback_revision':self.playback_revision,'observed_at':self.clock(),**self.status(),'playback':dict(self.sdk_snapshot),'devices':[{k:d.get(k) for k in ('id','name','type','is_active','is_restricted','supports_volume')} for d in self.devices if d.get('id')],'last_listened':None,'state_source':'sdk','empty_reason':None}
    def _observed_track(self,identifier=None):
        # Display enrichment must never start a Spotify request while holding
        # its lock: SDK audio events need to publish without waiting on lyrics.
        with self.lock:
            choices=[self.sdk_snapshot,(self.cache or {}).get('playback'),(self.resume.value or {}).get('playback')]
            return next((dict(p) for p in choices if p and (identifier is None or p.get('id')==identifier)),{})
    def current_palette(self,identifier=None):
        track=self._observed_track(identifier)
        return {'track_id':track.get('id',''),**self.artwork_provider.palette(track.get('artwork',''))}
    def current_lyrics(self,identifier=None):
        track=self._observed_track(identifier)
        if not track:return {'track_id':identifier or '', 'status':'loading','synced':False,'lines':[],'retry_after':.5}
        return self.lyrics_provider.lookup_synced(track)
    def close(self):
        with self.lock:self.cancel_link()
        self.lyrics_provider.close()
