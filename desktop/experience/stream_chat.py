"""Bounded in-memory stream chat, active only while its viewer is visible."""
from collections import OrderedDict
import threading

from .stream_sources import StreamCancel, StreamError, TwitchChat, YouTubeChat


def text(value, limit):
    if not isinstance(value, str):
        return ''
    return ''.join(character for character in value[:limit] if ord(character) >= 32 and not 0xD800 <= ord(character) <= 0xDFFF)


class StreamChat:
    def __init__(self, credentials, *, factories=None, changed=None):
        self.credentials = credentials
        self.factories = factories or {
            'twitch': lambda settings: TwitchChat(settings, authorize=credentials.authorize), 'youtube': YouTubeChat}
        self.changed = changed or (lambda: None)
        self.lock = threading.RLock()
        self.rows = OrderedDict()
        self.seen = OrderedDict()
        self.states = {}
        self.workers = []
        self.epoch = self.revision = 0
        self.visible = self.closed = False

    def snapshot(self):
        with self.lock:
            return {'revision': self.revision, 'visible': self.visible,
                    'sources': {name: dict(value) for name, value in self.states.items()},
                    'messages': [{key: row[key] for key in ('id', 'provider', 'name', 'text')} for row in self.rows.values()]}

    def _notify(self):
        try:
            self.changed()
        except Exception:
            pass

    def _state(self, epoch, provider, state, message=''):
        with self.lock:
            if epoch != self.epoch or not self.visible:
                return
            value = {'state': state, 'message': message}
            if self.states.get(provider) == value:
                return
            self.states[provider] = value
            self.revision += 1
        self._notify()

    def _event(self, epoch, provider, kind, identifier=None, author=None, name=None, message=None):
        with self.lock:
            if epoch != self.epoch or not self.visible:
                return
            identity = text(identifier, 512)
            key = provider, identity
            if kind == 'message':
                body = text(message, 2000)
                if not identity or not body or (key in self.seen and key not in self.rows):
                    return
                row = {'provider': provider, 'id': identity, 'author': text(author, 256),
                       'name': text(name, 100) or provider.title(), 'text': body}
                if self.rows.get(key) == row:
                    return
                self.rows[key] = row
                self.seen[key] = None
                while len(self.rows) > 200:
                    self.rows.popitem(last=False)
            elif kind == 'delete' and identity:
                self.rows.pop(key, None)
                self.seen[key] = None
            elif kind in ('clear', 'remove_user'):
                for key, row in list(self.rows.items()):
                    if row['provider'] == provider and (kind == 'clear' or row['author'] == identity):
                        del self.rows[key]
            else:
                return
            while len(self.seen) > 2000:
                self.seen.popitem(last=False)
            self.revision += 1
        self._notify()

    def _run(self, epoch, provider, settings, stop):
        try:
            source = self.factories[provider](settings)
            source.run(stop, lambda state: self._state(epoch, provider, state),
                       lambda *args: self._event(epoch, provider, *args))
            self._state(epoch, provider, 'ended')
        except Exception as error:
            message = str(error) if isinstance(error, StreamError) else 'No se pudo continuar la conexión de chat.'
            self._state(epoch, provider, 'error', message)

    def start(self):
        with self.lock:
            if self.closed:
                raise StreamError('El chat de stream se está cerrando.')
            if self.visible:
                return self.snapshot()
            if any(worker.is_alive() for worker, _ in self.workers):
                raise StreamError('Espera a que termine la conexión anterior y vuelve a abrir el chat.')
            configured = self.credentials.sources()
            self.workers = []
            self.states = {provider: {'state': 'connecting', 'message': ''} for provider in configured}
            self.visible = True
            self.epoch += 1
            self.revision += 1
            for provider, settings in configured.items():
                stop = StreamCancel()
                worker = threading.Thread(target=self._run, args=(self.epoch, provider, settings, stop),
                                          daemon=True, name='brivany-stream-' + provider)
                self.workers.append((worker, stop))
                worker.start()
        self._notify()
        return self.snapshot()

    def stop(self):
        with self.lock:
            self.visible = False
            self.epoch += 1
            self.revision += 1
            self.rows.clear()
            self.seen.clear()
            self.states.clear()
            workers = list(self.workers)
        for _, stop in workers:
            stop.stop()
        self._notify()

    def close(self):
        with self.lock:
            self.closed = True
        self.stop()
        for worker, _ in self.workers:
            if worker is not threading.current_thread():
                worker.join(7)
        self.credentials.close()
