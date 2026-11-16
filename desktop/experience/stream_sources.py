"""Official read-only Twitch EventSub and YouTube StreamList transports."""
from contextlib import contextmanager
import json
import re
import threading
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


TWITCH_LOGIN = re.compile(r'[a-z0-9_]{1,25}')
YOUTUBE_ID = re.compile(r'[A-Za-z0-9_-]{11}')
TWITCH_AUTH = 'https://id.twitch.tv/oauth2/'
TWITCH_API = 'https://api.twitch.tv/helix/'
TWITCH_EVENTS = ('channel.chat.message', 'channel.chat.message_delete', 'channel.chat.clear',
                 'channel.chat.clear_user_messages')
TWITCH_WS = 'wss://eventsub.wss.twitch.tv/ws'


class StreamError(ValueError):
    pass


class ProviderHTTP(StreamError):
    def __init__(self, status, code=''):
        super().__init__('El servicio rechazó la conexión.')
        self.status, self.code = status, code


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def api_json(url, *, headers=None, form=None, data=None):
    headers = {'Accept': 'application/json', **(headers or {})}
    body = None
    if form is not None:
        body = urlencode(form).encode('ascii')
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    elif data is not None:
        body = json.dumps(data).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    try:
        with build_opener(NoRedirect()).open(Request(url, body, headers), timeout=6) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) <= 1024 * 1024 and isinstance(result := json.loads(raw), dict):
            return result
    except HTTPError as error:
        with error:
            try:
                payload = json.loads(error.read(2048))
                detail = payload.get('message') or payload.get('error')
                code = detail.lower().replace(' ', '_') if isinstance(detail, str) else ''
            except (ValueError, OSError, AttributeError):
                code = ''
            raise ProviderHTTP(error.code, code) from None
    except (OSError, ValueError):
        raise StreamError('No se pudo conectar con el servicio.') from None
    raise StreamError('El servicio devolvió una respuesta incompleta.')


def youtube_video(value):
    value = value.strip() if isinstance(value, str) else ''
    if YOUTUBE_ID.fullmatch(value):
        return value
    try:
        url = urlsplit(value)
        if url.scheme == 'https' and not (url.username or url.password or url.port or url.fragment):
            if url.hostname == 'youtu.be':
                video = url.path.removeprefix('/')
            elif url.hostname in {'youtube.com', 'www.youtube.com', 'm.youtube.com'}:
                video = parse_qs(url.query).get('v', [''])[0] if url.path == '/watch' else url.path.removeprefix('/live/')
            else:
                video = ''
            if YOUTUBE_ID.fullmatch(video):
                return video
    except ValueError:
        pass
    raise StreamError('Introduce el enlace o el ID de un directo de YouTube.')


class StreamCancel:
    def __init__(self):
        self.event = threading.Event()
        self.lock = threading.Lock()
        self.interrupt = None

    def stop(self):
        with self.lock:
            self.event.set()
            closer, self.interrupt = self.interrupt, None
        if closer:
            closer()

    @contextmanager
    def watching(self, closer):
        with self.lock:
            stopped = self.event.is_set()
            if not stopped:
                self.interrupt = closer
        if stopped:
            closer()
        try:
            yield not stopped
        finally:
            with self.lock:
                if self.interrupt is closer:
                    self.interrupt = None


def websocket_connection(url):
    from websockets.sync.client import connect
    return connect(url, open_timeout=6, close_timeout=.25, max_size=262144, max_queue=8, compression=None, proxy=None)


def twitch_reconnect(url):
    if not isinstance(url, str) or len(url) > 2048:
        raise StreamError('Twitch no entregó una ruta de reconexión válida.')
    try:
        target = urlsplit(url)
        if (target.scheme == 'wss' and target.hostname == 'eventsub.wss.twitch.tv'
                and target.port in (None, 443) and not (target.username or target.password or target.fragment)
                and target.path == '/ws'):
            return url
    except ValueError:
        pass
    raise StreamError('Twitch no entregó una ruta de reconexión válida.')


class TwitchChat:
    def __init__(self, settings, *, authorize, http=api_json, connect=websocket_connection):
        self.settings, self.authorize, self.http, self.connect = settings, authorize, http, connect

    def _subscribe(self, headers, broadcaster, viewer, session):
        for event in TWITCH_EVENTS:
            self.http(TWITCH_API + 'eventsub/subscriptions', headers=headers, data={
                'type': event, 'version': '1',
                'condition': {'broadcaster_user_id': broadcaster, 'user_id': viewer},
                'transport': {'method': 'websocket', 'session_id': session},
            })

    def run(self, stop, status, event):
        from websockets.exceptions import WebSocketException

        for attempt in range(4):
            if stop.event.is_set():
                return
            try:
                self._session(stop, status, event)
                return
            except ProviderHTTP as error:
                if error.status in (401, 403):
                    raise StreamError('Vuelve a autorizar Twitch en Ajustes.') from None
                if error.status == 429:
                    raise StreamError('Twitch ha limitado las conexiones. Inténtalo más tarde.') from None
                raise
            except (OSError, WebSocketException):
                if attempt == 3:
                    raise StreamError('Se interrumpió el chat de Twitch.') from None
                status('reconnecting')
                if stop.event.wait(2 ** attempt):
                    return

    def _session(self, stop, status, event):
        credential = self.authorize(self.settings)
        headers = {'Client-Id': self.settings['client_id'], 'Authorization': 'Bearer ' + credential['access']}
        if stop.event.is_set():
            return
        users = self.http(TWITCH_API + 'users?' + urlencode({'login': self.settings['channel']}), headers=headers).get('data', [])
        if not users:
            raise StreamError('No se encontró el canal de Twitch.')
        broadcaster = users[0].get('id')
        if not isinstance(broadcaster, str) or not broadcaster.isdecimal():
            raise StreamError('Twitch no devolvió un canal válido.')
        socket = None
        try:
            socket = self.connect(TWITCH_WS)
            migrated = False
            while not stop.event.is_set():
                with stop.watching(socket.close) as listening:
                    if not listening:
                        return
                    welcome = json.loads(socket.recv(timeout=7))
                    if welcome.get('metadata', {}).get('message_type') != 'session_welcome':
                        raise StreamError('Twitch no confirmó la conexión.')
                    session = welcome.get('payload', {}).get('session', {})
                    identifier = session.get('id')
                    keepalive = session.get('keepalive_timeout_seconds') or 30
                    if not isinstance(identifier, str) or not isinstance(keepalive, int) or not 10 <= keepalive <= 600:
                        raise StreamError('Twitch no confirmó la conexión.')
                    if not migrated:
                        self._subscribe(headers, broadcaster, credential['user'], identifier)
                    status('live')
                    validated = time.monotonic()
                    while not stop.event.is_set():
                        packet = json.loads(socket.recv(timeout=keepalive + 5))
                        kind = packet.get('metadata', {}).get('message_type')
                        payload = packet.get('payload', {})
                        if time.monotonic() - validated >= 3500:
                            self.authorize(self.settings)
                            validated = time.monotonic()
                        if kind == 'session_reconnect':
                            url = twitch_reconnect(payload.get('session', {}).get('reconnect_url'))
                            break
                        if kind == 'revocation':
                            raise StreamError('Twitch retiró el acceso al chat. Revisa la autorización.')
                        if kind == 'notification':
                            self._event(payload, broadcaster, event)
                    else:
                        return
                if stop.event.is_set():
                    return
                # Twitch migrates the subscriptions when the new socket is welcomed.
                status('reconnecting')
                new_socket = self.connect(url)
                try:
                    welcome_frame = new_socket.recv(timeout=7)
                    welcome = json.loads(welcome_frame)
                    if welcome.get('metadata', {}).get('message_type') != 'session_welcome':
                        raise StreamError('Twitch no confirmó la reconexión.')
                except BaseException:
                    new_socket.close()
                    raise
                socket.close()
                socket = _WelcomedSocket(new_socket, welcome_frame)
                migrated = True
        finally:
            if socket:
                socket.close()

    @staticmethod
    def _event(payload, broadcaster, emit):
        kind = payload.get('subscription', {}).get('type')
        value = payload.get('event', {})
        if value.get('broadcaster_user_id') != broadcaster:
            return
        if kind == 'channel.chat.message':
            emit('message', value.get('message_id'), value.get('chatter_user_id'),
                 value.get('chatter_user_name'), value.get('message', {}).get('text'))
        elif kind == 'channel.chat.message_delete':
            emit('delete', value.get('message_id'))
        elif kind == 'channel.chat.clear_user_messages':
            emit('remove_user', value.get('target_user_id'))
        elif kind == 'channel.chat.clear':
            emit('clear')


class _WelcomedSocket:
    def __init__(self, socket, frame):
        self.socket, self.frame = socket, frame

    def recv(self, *, timeout):
        if self.frame is not None:
            frame, self.frame = self.frame, None
            return frame
        return self.socket.recv(timeout=timeout)

    def close(self):
        self.socket.close()


class YouTubeChat:
    def __init__(self, settings, *, http=api_json, channel=None):
        self.settings, self.http, self.channel = settings, http, channel

    def run(self, stop, status, event):
        from .youtube_live_wire import RPC, stream_types
        try:
            import grpc
            request_type, response_type = stream_types()
        except ImportError:
            raise StreamError('Actualiza las dependencias de Brivany Desktop para leer YouTube.') from None
        key = self.settings['key']
        query = urlencode({'part': 'liveStreamingDetails', 'id': self.settings['video']})
        headers = {'x-goog-api-key': key}
        try:
            response = self.http('https://www.googleapis.com/youtube/v3/videos?' + query, headers=headers)
        except ProviderHTTP as error:
            if error.status in (400, 403, 429):
                raise StreamError('Revisa la clave y la cuota de YouTube Data API.') from None
            raise
        videos = response.get('items', [])
        chat_id = videos[0].get('liveStreamingDetails', {}).get('activeLiveChatId') if videos else None
        if not isinstance(chat_id, str) or not 1 <= len(chat_id) <= 512:
            raise StreamError('Este video no tiene un chat en directo activo.')
        if stop.event.is_set():
            return
        channel = self.channel or (lambda: grpc.secure_channel('dns:///youtube.googleapis.com:443',
                                  grpc.ssl_channel_credentials(), options=(('grpc.max_receive_message_length', 2 * 1024 * 1024),)))
        resume = ''
        with channel() as connection:
            rpc = connection.unary_stream(RPC, request_serializer=request_type.SerializeToString,
                                          response_deserializer=response_type.FromString)
            failures = 0
            while not stop.event.is_set():
                request = request_type(live_chat_id=chat_id, part=['id', 'snippet', 'authorDetails'], hl='es')
                if resume:
                    request.page_token = resume
                stream = rpc(request, metadata=tuple(headers.items()), timeout=3300)
                with stop.watching(stream.cancel) as listening:
                    if not listening:
                        return
                    try:
                        for batch in stream:
                            if stop.event.is_set():
                                return
                            failures = 0
                            status('live')
                            if batch.next_page_token:
                                resume = batch.next_page_token
                            for item in batch.items:
                                if self._event(item, event):
                                    return
                            if batch.offline_at:
                                return
                        if not resume:
                            return
                    except grpc.RpcError as error:
                        if stop.event.is_set():
                            return
                        if error.code() in {grpc.StatusCode.PERMISSION_DENIED, grpc.StatusCode.RESOURCE_EXHAUSTED,
                                            grpc.StatusCode.UNAUTHENTICATED}:
                            raise StreamError('Revisa la clave y la cuota de YouTube Data API.') from None
                        if error.code() in {grpc.StatusCode.NOT_FOUND, grpc.StatusCode.FAILED_PRECONDITION}:
                            raise StreamError('El chat de YouTube dejó de estar disponible.') from None
                        if error.code() not in {grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.DEADLINE_EXCEEDED,
                                               grpc.StatusCode.CANCELLED}:
                            raise StreamError('YouTube no pudo continuar el chat.') from None
                    finally:
                        stream.cancel()
                failures += 1
                if failures > 3:
                    raise StreamError('Se interrumpió el chat de YouTube.')
                status('reconnecting')
                stop.event.wait(2 ** failures)

    @staticmethod
    def _event(item, emit):
        snippet = item.snippet
        if snippet.type == 4:
            return True
        if snippet.type == 2:
            emit('delete', item.id)
        elif snippet.type == 10:
            emit('remove_user', snippet.user_banned_details.banned_user_details.channel_id)
        else:
            author = item.author_details
            emit('message', item.id, author.channel_id or snippet.author_channel_id, author.display_name,
                 snippet.display_message or snippet.text_message_details.message_text)
        return False
