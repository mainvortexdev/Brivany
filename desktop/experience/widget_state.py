"""Shared local widget state. No GUI import, polling, provider or note telemetry."""
import json
import math
import os
from pathlib import Path
import tempfile
import threading
import time

MAX_DURATION = 10800000
MAX_NOTE_UNITS = 4000
SOURCES = {'workspace-bar', 'workspace-panel', 'native-notes'}
KINDS = {'timer', 'clock', 'notes'}


def text(value):
    if not isinstance(value, str):
        raise ValueError('La nota debe ser texto.')
    try:
        if len(value.encode('utf-16-le')) // 2 > MAX_NOTE_UNITS:
            raise ValueError('La nota admite hasta 4.000 caracteres.')
    except UnicodeError:
        raise ValueError('Revisa los caracteres de la nota.') from None
    return value


def source(value):
    if not isinstance(value, str) or value not in SOURCES:
        raise ValueError('Editor de notas no disponible.')
    return value


def default_timer():
    return {'state': 'idle', 'duration': 300000, 'remaining': 300000, 'deadline': 0}


def timer(value, now):
    if not isinstance(value, dict):
        return default_timer()
    duration = value.get('duration', 300000)
    remaining = value.get('remaining', duration)
    deadline = value.get('deadline', 0)
    state = value.get('state', 'idle')
    if (state not in {'idle', 'running', 'paused', 'finished'} or type(duration) is not int
            or not 1000 <= duration <= MAX_DURATION or type(remaining) is not int
            or not 0 <= remaining <= duration or type(deadline) not in (int, float)
            or not math.isfinite(deadline) or not 0 <= deadline <= now + MAX_DURATION + 60000):
        raise ValueError('El temporizador guardado no es válido.')
    if state == 'running' and deadline <= now:
        return {'state': 'finished', 'duration': duration, 'remaining': 0, 'deadline': 0}
    return {'state': state, 'duration': duration, 'remaining': remaining,
            'deadline': int(deadline) if state == 'running' else 0}


class WidgetState:
    def __init__(self, path, *, publish=None, clock=None, alarm_factory=threading.Timer):
        self.path = Path(path)
        self.publish = publish or (lambda value: None)
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.alarm_factory = alarm_factory
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.write_lock = threading.Lock()
        self.closed = False
        self.alarm = self.writer = None
        self.alarm_epoch = 0
        self.revision = self.note_revision = 0
        self.persisted = 0
        self.initialized = False
        self.note = ''; self.note_source = 'workspace-panel'; self.drafts = {}
        self.timer = default_timer(); self.topmost = False; self.positions = {}
        self.error = ''; self.write_error = ''; self.notice = ''; self.needs_normalization = False
        self._load()

    def _load(self):
        try:
            with self.path.open('r', encoding='utf-8') as stream:
                raw = stream.read(131073)
            if len(raw) > 131072:
                raise ValueError('state too large')
            value = json.loads(raw)
            if not isinstance(value, dict) or value.get('schema') != 1:
                raise ValueError('unknown schema')
            self.note = text(value.get('note', ''))
            self.timer = timer(value.get('timer'), self.clock())
            for key in ('revision', 'note_revision'):
                number = value.get(key, 0)
                if type(number) is not int or not 0 <= number < 2 ** 53:
                    raise ValueError('invalid revision')
                setattr(self, key, number)
            self.note_source = source(value.get('note_source', 'workspace-panel'))
            self.topmost = value.get('topmost') is True
            self.initialized = value.get('initialized') is True
            self.needs_normalization = self.initialized and value.get('timer', {}).get('state') == 'running' and self.timer['state'] == 'finished'
            for key, draft in value.get('drafts', {}).items():
                source(key)
                self.drafts[key] = {'text': text(draft['text'])}
            for key, position in value.get('positions', {}).items():
                if key in KINDS and self._position(position):
                    self.positions[key] = dict(position)
            self.persisted = self.revision
        except FileNotFoundError:
            return
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            self.error = 'No se pudo abrir el estado de los widgets. El archivo original se conserva.'

    @staticmethod
    def _position(value):
        return (isinstance(value, dict) and set(value) == {'x', 'y'}
                and all(type(value[k]) is int and -100000 <= value[k] <= 100000 for k in ('x', 'y')))

    def _ensure(self):
        if self.closed:
            raise ValueError('Los widgets se están cerrando.')
        if self.error:
            raise ValueError(self.error)

    def snapshot(self):
        with self.lock:
            return {'revision': self.revision, 'initialized': self.initialized,
                    'timer': dict(self.timer), 'note': self.note, 'note_revision': self.note_revision,
                    'note_source': self.note_source, 'drafts': {k: dict(v) for k, v in self.drafts.items()},
                    'topmost': self.topmost, 'positions': {k: dict(v) for k, v in self.positions.items()},
                    'error': self.error or self.write_error, 'notice': self.notice}

    def _changed(self):
        self.revision += 1
        if self.writer is None:
            self.writer = threading.Thread(target=self._save_worker, name='brivany-widget-save', daemon=True)
            self.writer.start()
        self.condition.notify_all()

    def _emit(self):
        try:
            self.publish(self.snapshot())
        except Exception:
            pass

    def connect(self, legacy=None):
        with self.lock:
            self._ensure()
            if not self.initialized:
                legacy = legacy if isinstance(legacy, dict) else {}
                note = text(legacy.get('note', ''))
                try:
                    current = timer(legacy.get('timer'), self.clock())
                except ValueError:
                    current = default_timer()
                    self.notice = 'Se recuperó la nota. Revisa la duración del temporizador.'
                self.note = note; self.timer = current; self.initialized = True
                self.note_revision += 1
                self._changed()
            if self.needs_normalization:
                self.needs_normalization = False; self._changed()
            if self.timer['state'] == 'running' and self.alarm is None:
                self._schedule_alarm()
        self._emit(); return self.snapshot()

    def timer_action(self, action, duration=None):
        if not isinstance(action, str) or action not in {'start', 'pause', 'resume', 'reset', 'finish', 'toggle'}:
            raise ValueError('Acción del temporizador no disponible.')
        with self.lock:
            self._ensure(); current = self.timer; now = self.clock()
            if action == 'toggle':
                action = 'pause' if current['state'] == 'running' else 'resume' if current['state'] == 'paused' else 'start'
            next_value = dict(current)
            if action == 'start':
                duration = current['duration'] if duration is None else duration
                if type(duration) is not int or not 1000 <= duration <= MAX_DURATION:
                    raise ValueError('Elige entre 1 segundo y 180 minutos.')
                next_value = {'state': 'running', 'duration': duration, 'remaining': duration, 'deadline': now + duration}
            elif action == 'pause' and current['state'] == 'running':
                remaining = max(0, current['deadline'] - now)
                next_value.update(state='paused' if remaining else 'finished', remaining=remaining, deadline=0)
            elif action == 'resume' and current['state'] == 'paused' and current['remaining']:
                next_value.update(state='running', deadline=now + current['remaining'])
            elif action == 'reset':
                next_value.update(state='idle', remaining=current['duration'], deadline=0)
            elif action == 'finish' and current['state'] == 'running' and current['deadline'] <= now:
                next_value.update(state='finished', remaining=0, deadline=0)
            if next_value != current:
                self.timer = next_value; self._changed(); self._schedule_alarm()
        self._emit(); return self.snapshot()

    def _schedule_alarm(self):
        self.alarm_epoch += 1; epoch = self.alarm_epoch
        if self.alarm:
            self.alarm.cancel(); self.alarm = None
        if self.timer['state'] != 'running' or self.closed:
            return
        deadline = self.timer['deadline']
        def finish():
            with self.lock:
                if self.closed or epoch != self.alarm_epoch:
                    return
                # Re-arm if the system wall clock moved backwards.
                if self.clock() < deadline:
                    self._schedule_alarm(); return
            try:
                self.timer_action('finish')
            except ValueError:
                # Shutdown can win after the epoch check and before the action.
                with self.lock:
                    if not self.closed:raise
        self.alarm = self.alarm_factory(max(0, (deadline - self.clock()) / 1000), finish)
        self.alarm.daemon = True; self.alarm.start()

    def update_note(self, value, expected, editor, force=False):
        value = text(value); source(editor)
        if type(expected) is not int or expected < 0 or type(force) is not bool:
            raise ValueError('Edición de nota no válida.')
        with self.lock:
            self._ensure()
            conflict = value != self.note and not force and (expected != self.note_revision or editor in self.drafts)
            if conflict:
                if self.drafts.get(editor, {}).get('text') != value:
                    self.drafts[editor] = {'text': value}; self._changed()
            else:
                had_draft = self.drafts.pop(editor, None) is not None
                if value != self.note:
                    self.note = value; self.note_source = editor; self.note_revision += 1; self._changed()
                elif had_draft:
                    self._changed()
        self._emit(); return {'conflict': conflict, 'state': self.snapshot()}

    def discard_draft(self, editor):
        source(editor)
        with self.lock:
            self._ensure()
            if self.drafts.pop(editor, None) is not None:
                self._changed()
        self._emit(); return self.snapshot()

    def settings(self, topmost=None):
        if topmost is not None and type(topmost) is not bool:
            raise ValueError('Elige si los widgets se mantienen encima.')
        with self.lock:
            self._ensure()
            if topmost is not None and topmost != self.topmost:
                self.topmost = topmost; self._changed()
        self._emit(); return self.snapshot()

    def position(self, kind, value):
        if kind not in KINDS or not self._position(value):
            raise ValueError('Posición de widget no válida.')
        with self.lock:
            self._ensure()
            if self.positions.get(kind) != value:
                self.positions[kind] = dict(value); self._changed()

    def _write(self, value):
        # A delayed older writer cannot overwrite a newer shutdown flush.
        with self.write_lock:
            if value['revision'] <= self.persisted:
                return
            self.path.parent.mkdir(parents=True, exist_ok=True)
            raw = json.dumps({'schema': 1, **value}, ensure_ascii=True)
            descriptor, name = tempfile.mkstemp(prefix='widget-state-', suffix='.tmp', dir=self.path.parent)
            try:
                with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
                    stream.write(raw); stream.flush(); os.fsync(stream.fileno())
                os.replace(name, self.path)
                self.persisted = value['revision']; self.write_error = ''
            finally:
                Path(name).unlink(missing_ok=True)

    def _save_worker(self):
        try:
            while True:
                with self.condition:
                    if self.closed:
                        return
                    if self.revision <= self.persisted:
                        notified = self.condition.wait(timeout=1)
                        if not notified and self.revision <= self.persisted:
                            self.writer = None; return
                        continue
                    # Batch nearby edits without restarting an OS thread per key.
                    due = time.monotonic() + .25
                    while not self.closed and time.monotonic() < due:
                        self.condition.wait(timeout=max(0, due - time.monotonic()))
                    if self.closed:
                        return
                    value = self.snapshot()
                try:
                    recovering = bool(self.write_error)
                    self._write(value)
                    if recovering:self._emit()
                except OSError:
                    self.write_error = 'No se pudo guardar la nota. Revisa el espacio disponible.'
                    self._emit()
                    return
        finally:
            with self.lock:
                if self.writer is threading.current_thread():
                    self.writer = None

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True; self.alarm_epoch += 1
            if self.alarm:
                self.alarm.cancel(); self.alarm = None
            value = self.snapshot(); writer = self.writer
            self.condition.notify_all()
        if not self.error:
            try:
                self._write(value)
            except OSError:
                self.write_error = 'No se pudo guardar el último cambio de los widgets.'
        if writer and writer is not threading.current_thread():
            writer.join(timeout=2)
