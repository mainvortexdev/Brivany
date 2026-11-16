"""Small persistent WorkSpace settings, independent from WebView's private profile."""
import copy
import json
import os
from pathlib import Path
import tempfile
import threading

WORKSPACE_LOCALES = ('es', 'en', 'fr', 'pt-BR')

DEFAULTS = {
    'general': {'theme':'light', 'chatSize':'normal', 'language':'es-ES', 'rate':1.05,
                'quiet':False, 'autoReply':True, 'voiceNotices':True, 'threshold':.025},
    'appearance': {'theme':'dark', 'accent':'blue', 'size':'normal', 'economy':True, 'motion':True},
    'interface': {'locale':'es'},
    'recording': {'fps':15, 'cursor':True},
    'auditory': {'target':'en', 'voice':'auto', 'mode':'direct', 'cloningLanguage':'es'},
    'weather': {'location':None},
    'music': {'expansion':False, 'style':'orbital'},
}
CHOICES = {
    'general': {'theme':('light','dark','system'), 'chatSize':('normal','large'), 'language':('es-ES','en-US')},
    'appearance': {'theme':('dark','soft'), 'accent':('blue','mint','amber','rose'), 'size':('compact','normal','large')},
    'interface': {'locale':WORKSPACE_LOCALES},
    'recording': {'fps':(15,30)},
    'auditory': {'target':('en','es','fr'), 'voice':('auto','masculine','feminine'),
                 'mode':('direct','preproduction','synchronized'), 'cloningLanguage':('es','en','fr')},
    'weather': {},
    'music': {'style':('orbital','amber')},
}
RANGES = {'rate':(.75,1.15), 'threshold':(.01,.08)}


def validate(value):
    if not isinstance(value, dict) or not value or set(value)-set(DEFAULTS):
        raise ValueError('Ajustes de WorkSpace no válidos.')
    for group, fields in value.items():
        if not isinstance(fields, dict) or set(fields)-set(DEFAULTS[group]):
            raise ValueError('Ajustes de WorkSpace no válidos.')
        for key, item in fields.items():
            if group=='weather':
                if item is None:
                    continue
                if (not isinstance(item,dict) or set(item)!={'label','latitude','longitude'}
                        or not isinstance(item['label'],str) or not 0<len(item['label'].strip())<=240
                        or any(ord(char)<32 or ord(char)==127 for char in item['label'])):
                    raise ValueError('Ciudad no válida.')
                for axis, limit in (('latitude',90),('longitude',180)):
                    coordinate=item[axis]
                    if type(coordinate) not in (int,float) or not -limit<=coordinate<=limit:
                        raise ValueError('Coordenadas no válidas.')
                continue
            expected = type(DEFAULTS[group][key])
            if group == 'general' and key in RANGES:
                minimum, maximum = RANGES[key]
                if type(item) in (int, float) and minimum <= item <= maximum:
                    continue
                raise ValueError('Ajuste de voz no válido.')
            choices = CHOICES[group].get(key)
            if type(item) is not expected or choices and item not in choices:
                raise ValueError('Ajuste de WorkSpace no válido.')
    return copy.deepcopy(value)


def legacy_values(value):
    if not isinstance(value, dict):
        return {}
    result = {}
    for group, fields in value.items():
        if group not in DEFAULTS or not isinstance(fields, dict):
            continue
        result[group] = {}
        for key, field in fields.items():
            try:
                validate({group:{key:field}})
            except ValueError:
                continue
            result[group][key] = field
    return result


class WorkspacePreferences:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.values = copy.deepcopy(DEFAULTS)
        self.revision = 0
        self.initialized = False
        self.error = ''
        try:
            with self.path.open('r', encoding='utf-8') as source:
                raw = source.read(8193)
            if len(raw)>8192:
                raise ValueError('size')
            saved = json.loads(raw)
            if (not isinstance(saved, dict) or set(saved)!={'schema','revision','values'}
                    or type(saved['schema']) is not int or saved['schema'] != 1
                    or type(saved['revision']) is not int or not 0<=saved['revision']<2**53-1):
                raise ValueError('schema')
            fields = validate(saved['values'])
            for group in fields:
                self.values[group].update(fields[group])
            self.revision = saved['revision']
            self.initialized = True
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError, KeyError, UnicodeError):
            self.error = 'No se pudieron abrir los ajustes. El archivo original se conserva.'

    def snapshot(self):
        with self.lock:
            return {**copy.deepcopy(self.values), 'revision':self.revision,
                    'initialized':self.initialized, 'error':self.error}

    def update(self, patch, initial=None):
        patch = validate(patch)
        initial = legacy_values(initial)
        with self.lock:
            if self.error:
                raise ValueError(self.error)
            values = copy.deepcopy(self.values)
            if not self.initialized:
                for group in initial:
                    values[group].update(initial[group])
            for group in patch:
                values[group].update(patch[group])
            if self.initialized and values == self.values:
                return self.snapshot()
            revision = self.revision + 1
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.path.parent,
                                                  prefix='.workspace-preferences-', suffix='.tmp', delete=False) as output:
                    temporary = Path(output.name)
                    json.dump({'schema':1, 'revision':revision, 'values':values}, output, ensure_ascii=False)
                os.replace(temporary, self.path)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            self.values, self.revision, self.initialized = values, revision, True
            return self.snapshot()
