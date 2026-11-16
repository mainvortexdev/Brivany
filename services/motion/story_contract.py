"""Finite declarative video stories. Text is data and must be escaped by renderers.

No executable code, URLs or paths can enter media or SVG fields. A validated
story is a detached copy: editing a revision cannot mutate an earlier plan.
"""
from __future__ import annotations

import math
import re


_ROOT = {'version', 'title', 'format', 'fps', 'duration', 'voice', 'music',
         'credits_duration', 'scenes'}
_SCENE = {'id', 'duration', 'background', 'transition', 'narration', 'elements'}
_COMMON = {'type', 'x', 'y', 'w', 'h'}
_OPTIONAL = {'start', 'end', 'enter', 'exit'}
_FIELDS = {
    'text': {'text', 'font_size', 'weight', 'color', 'align'},
    'film': {'asset_id', 'source_start', 'position', 'fit'},
    'illustration': {'name'},
    'shape': {'shape', 'fill', 'stroke', 'stroke_width'},
    'image': {'asset_id', 'fit'},
}
_HEX = re.compile(r'#[0-9A-Fa-f]{6}\Z')
_ID = re.compile(r'[a-z][a-z0-9_-]{0,30}\Z')
_ASSET = re.compile(r'(?:[a-z][a-z0-9-]{0,50}|selected:[0-7])\Z')
_SELECTED = re.compile(r'selected:[0-7]\Z')
_PATH_CHARS = re.compile(r'[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]*\Z')
_PATH_NUMBER = re.compile(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?')
# Also catches local/intranet addresses; @handles alone have no local part.
_EMAIL = re.compile(r"(?<![\w.+-])[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)*", re.I)


def _object(value, required, optional=()):
    if type(value) is not dict or set(value) - set(required) - set(optional) or set(required) - set(value):
        raise ValueError('Campos del plan de video no válidos.')


def _number(value, minimum=0, maximum=math.inf, *, integer=False):
    if type(value) not in ((int,) if integer else (int, float)):
        raise ValueError('El plan necesita un número válido.')
    try:
        finite = math.isfinite(value)
    except (ValueError, OverflowError):
        finite = False
    if not finite or not minimum <= value <= maximum:
        raise ValueError('Número fuera de los límites del video.')
    return value


def _text(value, maximum, *, minimum=0):
    if not isinstance(value, str) or not minimum <= len(value) <= maximum or '\x00' in value:
        raise ValueError('Texto del video fuera del contrato.')
    if minimum and not value.strip():
        raise ValueError('El video necesita un título.')
    if _EMAIL.search(value):
        raise ValueError('No se admiten direcciones de correo en el video.')
    return value


def _choice(value, choices):
    if not isinstance(value, str) or value not in choices:
        raise ValueError('Opción del video no admitida.')
    return value


def _color(value, *, none=False):
    if not isinstance(value, str) or not (_HEX.fullmatch(value) or none and value == 'none'):
        raise ValueError('Color del video no válido.')
    return value


def _asset(value, maximum, *, selected_only=False):
    pattern = _SELECTED if selected_only else _ASSET
    if not isinstance(value, str) or len(value) > maximum or not pattern.fullmatch(value):
        raise ValueError('Referencia de medio no válida.')
    return value


def _path(value):
    if not isinstance(value, str) or len(value) > 6000 or not _PATH_CHARS.fullmatch(value):
        raise ValueError('Trazado SVG no válido.')
    if value.strip() and value.lstrip()[0] not in 'Mm':
        raise ValueError('El trazado SVG debe comenzar con un movimiento.')
    if any(not math.isfinite(float(number)) for number in _PATH_NUMBER.findall(value)):
        raise ValueError('Coordenada SVG no finita.')
    return value


def canvas_size(format):
    """Return the authored pixel canvas, without accepting arbitrary dimensions."""
    _choice(format, {'portrait', 'landscape', 'square'})
    return {'portrait': (1080, 1920), 'landscape': (1920, 1080),
            'square': (1080, 1080)}[format]


def _element(value, duration, max_media_id_length):
    if type(value) is not dict or not isinstance(value.get('type'), str) or value['type'] not in _FIELDS:
        raise ValueError('Elemento de video no admitido.')
    kind = value['type']
    optional = _OPTIONAL | ({'d'} if kind == 'shape' else set())
    _object(value, _COMMON | _FIELDS[kind], optional)
    result = dict(value)
    for key in ('x', 'y', 'w', 'h'):
        _number(value[key], 0, 100)
    if value['w'] <= 0 or value['h'] <= 0 or value['x'] + value['w'] > 100 or value['y'] + value['h'] > 100:
        raise ValueError('El elemento sale del lienzo del video.')
    start = _number(value.get('start', 0), 0, duration)
    end = _number(value.get('end', duration), 0, duration)
    if start >= end:
        raise ValueError('El intervalo del elemento está vacío o fuera de su escena.')
    if 'enter' in value:
        _choice(value['enter'], {'none', 'rise', 'left', 'right', 'scale', 'wipe'})
    if 'exit' in value:
        _choice(value['exit'], {'none', 'fade', 'rise'})
    if kind == 'text':
        _text(value['text'], 240)
        _number(value['font_size'], 18, 180, integer=True)
        if type(value['weight']) is not int or value['weight'] not in {400, 600, 700}:
            raise ValueError('Peso tipográfico no admitido.')
        _color(value['color'])
        _choice(value['align'], {'left', 'center', 'right'})
    elif kind == 'film':
        _asset(value['asset_id'], max_media_id_length)
        _number(value['source_start'], 0, 21600)
        _number(value['position'], 0, 100)
        _choice(value['fit'], {'cover', 'contain'})
    elif kind == 'image':
        _asset(value['asset_id'], max_media_id_length, selected_only=True)
        _choice(value['fit'], {'cover', 'contain'})
    elif kind == 'illustration':
        _choice(value['name'], {'melodi', 'headphones', 'connections', 'wave', 'document', 'translation'})
    elif kind == 'shape':
        _choice(value['shape'], {'rect', 'ellipse', 'line', 'path'})
        _color(value['fill'], none=True)
        _color(value['stroke'], none=True)
        _number(value['stroke_width'], 0, 20)
        if 'd' in value:
            _path(value['d'])
    return result


def validate_story(plan, *, requested_duration=None, max_media_id_length=80):
    """Validate the finite story and return detached scene/element dictionaries.

    Optional element timing and motion fields stay optional in the returned plan.
    Literal text may contain punctuation such as '<' and '&'; it is never code.
    """
    _number(max_media_id_length, 1, integer=True)
    _object(plan, _ROOT, {'presentation','participants','disclosure','ringing_duration','timing'})
    presentation=plan.get('presentation','story')
    _choice(presentation,{'story','call'})
    if presentation=='call':
        participants=plan.get('participants')
        if not isinstance(participants,list) or len(participants)!=2:raise ValueError('La llamada necesita dos participantes.')
        for person in participants:
            _object(person,{'id','name'},{'gender'});_choice(person['id'],{'melodi','counterpart'});_text(person['name'],24,minimum=1)
            if 'gender' in person:
                _choice(person['gender'],{'female','male'})
                if person['id']=='melodi' and person['gender']=='male':raise ValueError('Conserva la voz seleccionada de Melodi.')
        if {p['id'] for p in participants}!={'melodi','counterpart'}:raise ValueError('Los participantes necesitan voces distintas.')
    elif any(key in plan for key in ('disclosure','ringing_duration','timing')):
        raise ValueError('La temporización de llamada sólo se admite en presentation call.')
    if 'disclosure' in plan:_choice(plan['disclosure'],{'none','demonstration'})
    if 'ringing_duration' in plan:_number(plan['ringing_duration'],0,12)
    if 'timing' in plan:_choice(plan['timing'],{'natural','reference','dialogue'})
    if type(plan['version']) is not int or plan['version'] != 1:
        raise ValueError('Versión del plan de video no admitida.')
    _text(plan['title'], 100, minimum=1)
    canvas_size(plan['format'])
    if type(plan['fps']) is not int or plan['fps'] not in {30, 60}:
        raise ValueError('Cadencia del video no admitida.')
    _number(plan['duration'], 5, 180, integer=presentation!='call')
    if requested_duration is not None:
        _number(requested_duration, 5, 180)
        if plan['duration'] != requested_duration:
            raise ValueError('El plan cambió la duración solicitada.')
    if type(plan['voice']) is not bool:
        raise ValueError('La opción de voz necesita un booleano.')
    _number(plan['credits_duration'], 0 if presentation=='call' else 2, 8)
    result = dict(plan)
    if presentation=='call':result['participants']=[dict(p) for p in plan['participants']]
    if plan['music'] is not None:
        _object(plan['music'], {'asset_id', 'start'})
        _asset(plan['music']['asset_id'], max_media_id_length)
        _number(plan['music']['start'])
        result['music'] = dict(plan['music'])
    if type(plan['scenes']) is not list or not 1 <= len(plan['scenes']) <= 24:
        raise ValueError('El video necesita entre una y veinticuatro escenas.')
    scenes = []
    ids = set()
    for value in plan['scenes']:
        _object(value, _SCENE, {'speaker','speech_offset','speech_duration','speech_cues','laughter'})
        if 'laughter' in value:
            if presentation!='call':raise ValueError('La risa sólo se admite en un diálogo de llamada.')
            _choice(value['laughter'],{'before','after'})
        if 'speaker' in value:_choice(value['speaker'],{'melodi','counterpart'})
        if presentation=='call' and ('speaker' not in value or value['elements']):raise ValueError('Cada turno de llamada necesita speaker y elements vacío; el visualizador dibuja las esferas.')
        if not isinstance(value['id'], str) or not _ID.fullmatch(value['id']) or value['id'] in ids:
            raise ValueError('Identificador de escena duplicado o no válido.')
        ids.add(value['id'])
        _number(value['duration'], .5, 30)
        _text(value['narration'], 450)
        if 'speech_offset' in value or 'speech_duration' in value:
            if presentation!='call' or plan.get('timing') not in {'reference','dialogue'}:raise ValueError('Los tiempos de voz necesitan una llamada con tiempos medidos.')
            offset=_number(value.get('speech_offset',0),0,value['duration'])
            length=_number(value.get('speech_duration',0),.05,value['duration'])
            if offset+length>value['duration']+1e-6:raise ValueError('El turno de voz sale de su escena.')
        if presentation=='call' and plan.get('timing')=='reference' and value['narration'].strip() and 'speech_duration' not in value:
            raise ValueError('Cada turno hablado necesita su duración medida.')
        if 'speech_cues' in value:
            cues=value['speech_cues']
            if presentation!='call' or plan.get('timing') not in {'reference','dialogue'} or not isinstance(cues,list) or not 1<=len(cues)<=16:
                raise ValueError('Los fragmentos de voz necesitan tiempos de referencia.')
            end=0
            for cue in cues:
                _object(cue,{'start','duration','text'});_number(cue['start'],end);_number(cue['duration'],.05,30);_text(cue['text'],450,minimum=1)
                end=cue['start']+cue['duration']
                if end>value['speech_duration']+1e-6:raise ValueError('El fragmento sale del turno hablado.')
            if ' '.join(c['text'].strip() for c in cues)!=value['narration'].strip():raise ValueError('Los fragmentos deben conservar el guion completo.')
        _color(value['background'])
        _choice(value['transition'], {'cut', 'fade', 'slide_up', 'mask_left', 'zoom'})
        if type(value['elements']) is not list or len(value['elements']) > 20:
            raise ValueError('Una escena admite hasta veinte elementos.')
        scene = dict(value)
        if 'speech_cues' in value:scene['speech_cues']=[dict(c) for c in value['speech_cues']]
        scene['elements'] = [_element(element, value['duration'], max_media_id_length)
                             for element in value['elements']]
        scenes.append(scene)
    total = math.fsum([scene['duration'] for scene in scenes] + [plan['credits_duration']])
    if abs(total - plan['duration']) > 1 / plan['fps'] + 1e-9:
        raise ValueError('Las escenas y los créditos no completan la duración del video.')
    result['scenes'] = scenes
    if presentation=='call' and plan.get('ringing_duration',0)>next((sum(s['duration'] for s in scenes[:i])+s.get('speech_offset',.08) for i,s in enumerate(scenes) if s['narration'].strip()),0):
        raise ValueError('El tono de llamada no debe tapar el primer turno hablado.')
    if presentation=='call' and {s['speaker'] for s in scenes if s['narration'].strip()}!={'melodi','counterpart'}:raise ValueError('La llamada debe contener turnos de ambos participantes.')
    return result
