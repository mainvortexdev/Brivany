"""User-scoped encrypted stream configuration and public Twitch device OAuth."""
import re
import threading
import time
from urllib.parse import urlencode, urlsplit

from services.brivany_account import SecureAccountFile
from .stream_sources import ProviderHTTP, StreamError, TWITCH_AUTH, TWITCH_LOGIN, api_json, youtube_video


SCOPE = 'user:read:chat'


class StreamCredentials:
    def __init__(self, path, *, store=None, http=api_json, clock=time.time):
        self.store = store or SecureAccountFile(path)
        self.http, self.clock = http, clock
        self.lock = threading.RLock()
        self.refresh_lock = threading.Lock()
        self.cancel = threading.Event()
        self.worker = None
        self.device = None
        self.error = ''
        self.closed = False
        self.epoch = 0
        self.value = {'client_id': '', 'channel': '', 'video': '', 'key': '', 'grant': None}
        try:
            saved = self.store.load()
            if isinstance(saved, dict):
                for name in self.value:
                    if name in saved:
                        self.value[name] = saved[name]
        except Exception:
            self.error = 'Vuelve a conectar las cuentas del chat.'

    def snapshot(self):
        with self.lock:
            return {'twitch_client_id': self.value['client_id'], 'twitch_channel': self.value['channel'],
                    'youtube_video': self.value['video'], 'youtube_configured': bool(self.value['key']),
                    'twitch_connected': bool(self.value['grant']), 'device': self.device, 'message': self.error}

    def save(self, value):
        if not isinstance(value, dict) or set(value) != {'twitch_client_id', 'twitch_channel', 'youtube_video', 'youtube_key'}:
            raise StreamError('Revisa los ajustes del chat.')
        if any(not isinstance(item, str) or len(item) > 512 for item in value.values()):
            raise StreamError('Revisa los ajustes del chat.')
        client, channel, video, key = (value[name].strip() for name in (
            'twitch_client_id', 'twitch_channel', 'youtube_video', 'youtube_key'))
        channel = channel.lstrip('@').lower()
        if client and not re.fullmatch(r'[A-Za-z0-9]{10,64}', client):
            raise StreamError('Revisa el Client ID público de Twitch.')
        if channel and not TWITCH_LOGIN.fullmatch(channel):
            raise StreamError('Introduce el nombre del canal de Twitch.')
        if key and not re.fullmatch(r'[A-Za-z0-9_-]{20,160}', key):
            raise StreamError('Revisa la clave de YouTube Data API.')
        video = youtube_video(video) if video else ''
        with self.lock:
            if self.closed or self.worker:
                raise StreamError('Termina la autorización pendiente antes de guardar.')
            updated = {**self.value, 'client_id': client, 'channel': channel, 'video': video,
                       'key': key or self.value['key']}
            if client != self.value['client_id']:
                updated['grant'] = None
            self.store.save(updated)
            self.value, self.error = updated, ''
        return self.snapshot()

    def sources(self):
        with self.lock:
            result = {}
            if self.value['client_id'] and self.value['channel'] and self.value['grant']:
                result['twitch'] = {key: self.value[key] for key in ('client_id', 'channel')}
            if self.value['key'] and self.value['video']:
                result['youtube'] = {key: self.value[key] for key in ('key', 'video')}
            return result

    def _validate(self, client, token):
        checked = self.http(TWITCH_AUTH + 'validate', headers={'Authorization': 'Bearer ' + token})
        user = checked.get('user_id')
        if (checked.get('client_id') != client or SCOPE not in checked.get('scopes', [])
                or not isinstance(user, str) or not user.isdecimal()):
            raise StreamError('Autoriza la lectura del chat con el Client ID configurado.')
        return user

    def _grant(self, client, response):
        access, refresh = response.get('access_token'), response.get('refresh_token')
        if any(not isinstance(item, str) or not 10 <= len(item) <= 2048 or not item.isascii()
               or any(character.isspace() for character in item) for item in (access, refresh)):
            raise StreamError('Twitch no devolvió la autorización completa.')
        return {'access': access, 'refresh': refresh, 'user': self._validate(client, access)}

    def begin(self):
        with self.lock:
            client = self.value['client_id']
            if self.closed or self.worker or not client:
                raise StreamError('Guarda el Client ID público de Twitch antes de conectar.')
            self.worker = threading.current_thread()  # Reserve during the device request.
            epoch = self.epoch
        try:
            result = self.http(TWITCH_AUTH + 'device', form={'client_id': client, 'scopes': SCOPE})
            code, uri, device = result.get('user_code'), result.get('verification_uri'), result.get('device_code')
            expiry, interval = result.get('expires_in'), result.get('interval')
            parsed = urlsplit(uri or '')
            if (not isinstance(code, str) or not re.fullmatch(r'[A-Z0-9-]{4,20}', code)
                    or parsed.scheme != 'https' or parsed.hostname != 'www.twitch.tv' or parsed.path != '/activate'
                    or parsed.port or parsed.username or parsed.password or parsed.fragment
                    or not isinstance(device, str) or not 8 <= len(device) <= 2048
                    or type(expiry) is not int or not 1 <= expiry <= 1800
                    or type(interval) is not int or not 1 <= interval <= 60):
                raise StreamError('Twitch no devolvió un código de conexión válido.')
            with self.lock:
                if self.closed or epoch != self.epoch:
                    raise StreamError('Los ajustes se están cerrando.')
                self.cancel.clear()
                # Construct the only browser destination from validated data.
                self.device = {'code': code, 'url': 'https://www.twitch.tv/activate?' + urlencode({'public': 'true', 'device-code': code})}
                self.error = ''
                self.worker = threading.Thread(target=self._poll, args=(client, device, expiry, interval, epoch),
                                               daemon=True, name='brivany-twitch-authorize')
                self.worker.start()
        except Exception:
            with self.lock:
                self.worker = None
            raise
        return self.snapshot()

    def _poll(self, client, device, expiry, interval, epoch):
        deadline = self.clock() + expiry
        try:
            while self.clock() < deadline and not self.cancel.wait(interval):
                try:
                    result = self.http(TWITCH_AUTH + 'token', form={'client_id': client, 'scopes': SCOPE,
                        'device_code': device, 'grant_type': 'urn:ietf:params:oauth:grant-type:device_code'})
                except ProviderHTTP as error:
                    if error.code in {'authorization_pending', 'authorization_pending.'}:
                        continue
                    if error.code == 'slow_down' or error.status == 429:
                        interval = min(60, interval + 5)
                        continue
                    raise StreamError('Twitch no completó la autorización. Vuelve a conectar.') from None
                grant = self._grant(client, result)
                with self.lock:
                    if self.closed or self.cancel.is_set() or epoch != self.epoch or client != self.value['client_id']:
                        return
                    updated = {**self.value, 'grant': grant}
                    self.store.save(updated)
                    self.value = updated
                return
            if not self.cancel.is_set():
                raise StreamError('El código de Twitch caducó. Vuelve a conectar.')
        except Exception as error:
            with self.lock:
                self.error = str(error) if isinstance(error, StreamError) else 'No se pudo guardar la autorización.'
        finally:
            with self.lock:
                self.device, self.worker = None, None

    def authorize(self, settings):
        with self.refresh_lock:
            with self.lock:
                client = self.value['client_id']
                grant = self.value['grant']
                if self.closed or client != settings['client_id'] or not grant:
                    raise StreamError('Conecta Twitch en Ajustes.')
            try:
                self._validate(client, grant['access'])
                return dict(grant)
            except ProviderHTTP as error:
                if error.status != 401:
                    raise
            response = self.http(TWITCH_AUTH + 'token', form={'client_id': client,
                                'grant_type': 'refresh_token', 'refresh_token': grant['refresh']})
            updated_grant = self._grant(client, response)
            with self.lock:
                if self.closed or self.value['client_id'] != client or self.value['grant'] is not grant:
                    raise StreamError('La autorización de Twitch cambió.')
                updated = {**self.value, 'grant': updated_grant}
                self.store.save(updated)
                self.value = updated
            return dict(updated_grant)

    def disconnect(self, provider):
        if provider not in ('twitch', 'youtube'):
            raise StreamError('Proveedor de chat no válido.')
        self.cancel.set()
        with self.lock:
            self.epoch += 1
            updated = {**self.value, **({'grant': None} if provider == 'twitch' else {'key': '', 'video': ''})}
            self.store.save(updated)
            self.value = updated
            self.device = None
        return self.snapshot()

    def close(self):
        with self.lock:
            self.closed = True
            self.epoch += 1
        self.cancel.set()
