"""Owned fixtures for the social-video pipeline: no model or voice API calls."""
import json
import math
import wave
from pathlib import Path

import numpy as np


def fake_voice(text, speed, cache_dir, cancelled=None, language='es'):
    """Deterministic stand-in for Melodi's voice: one soft tone per word."""
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    words = text.split()
    sr, per = 24000, .34
    t = np.arange(int(sr * (len(words) * per + .3))) / sr
    sig = np.zeros(len(t))
    out = []
    for i, w in enumerate(words):
        a, b = .1 + i * per, .1 + i * per + per * .8
        m = (t >= a) & (t < b)
        sig[m] += .25 * np.sin(2 * math.pi * (180 + 20 * (i % 5)) * t[m]) * np.sin(math.pi * (t[m] - a) / (b - a))
        out.append({'word': w, 'start': round(a, 3), 'end': round(b, 3)})
    path = cache / (str(abs(hash(text))) + '.wav')
    with wave.open(str(path), 'wb') as f:
        f.setparams((1, 2, sr, 0, 'NONE', 'not compressed'))
        f.writeframes((sig * 32767).astype('<i2').tobytes())
    return path, out, True


def story_plan():
    return {'version': 2, 'destination': 'instagram_story', 'title': 'Prueba de historia', 'topic': 'Melodi crea videos',
            'music': {'mood': 'bright', 'bpm': 120},
            'shots': [
                {'id': 'gancho', 'layout': 'kit', 'theme': 'night', 'kicker': 'Para redes', 'headline': '¿Y si tu video se hiciera solo?',
                 'accent': 'se hiciera solo?', 'body': '', 'kit': 'melodi', 'labels': ['Te lo preparo'], 'narration': '¿Y si tu próximo video lo hiciera yo?', 'transition': 'cut'},
                {'id': 'monto', 'layout': 'kit', 'theme': 'paper', 'kicker': 'Guion, voz y música', 'headline': 'Yo lo monto todo.', 'accent': 'todo.',
                 'body': '', 'kit': 'video_maker', 'labels': ['Guion', 'Ilustración', 'Voz', 'Música'],
                 'narration': 'Escribo el guion, animo las ilustraciones y pongo mi voz.', 'transition': 'wipe'},
                {'id': 'fin', 'layout': 'end', 'theme': 'soft', 'kicker': '', 'headline': 'Pídemelo en Brivany.', 'accent': 'Brivany.',
                 'body': '', 'kit': 'logo', 'labels': ['Tu asistente Melodi'], 'narration': 'Pídemelo. Tienes más en vetsa punto es.', 'transition': 'wipe'}],
            'cta': 'Más en vetsa.es',
            'publish': {'caption': 'Melodi ya crea videos para redes: guion, ilustraciones, voz y música.', 'hashtags': ['#Brivany', '#Melodi', '#IA'],
                        'cover_shot': 'monto', 'cover_title': 'Melodi crea tus videos'}}
