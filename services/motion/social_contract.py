"""Declarative social-video plans (edition 4). Melodi writes data, never code.

A plan describes shots: layout, theme, short copy, one trusted animated
illustration kit and the narration. Trusted code derives timing from the real
voice, builds the composition, the score, the effects and the delivery package.
Text is literal data and is always inserted with textContent by the runtime.
"""
from __future__ import annotations

import math
import re

from .social_copy import CTA_DESTINATIONS, SPOKEN_DESTINATIONS, copy_issues, detect_language, hashtag_issues

DESTINATIONS = {
    # seconds are the accepted range of the final, voice-timed cut.
    'instagram_story': {'label': 'Historia de Instagram', 'format': 'portrait', 'size': (1080, 1920),
                        'seconds': (8, 20), 'shots': (3, 5), 'loudness': -14.0,
                        'safe': {'top': 250, 'bottom': 340, 'left': 90, 'right': 90}},
    'reel': {'label': 'Reel de Instagram / TikTok', 'format': 'portrait', 'size': (1080, 1920),
             'seconds': (20, 50), 'shots': (5, 10), 'loudness': -14.0,
             'safe': {'top': 220, 'bottom': 470, 'left': 90, 'right': 160}},  # union of Reels and TikTok overlays
    'short': {'label': 'Video corto vertical (Reels, TikTok, Shorts)', 'format': 'portrait', 'size': (1080, 1920),
              'seconds': (12, 22), 'shots': (4, 8), 'loudness': -14.0,
              'safe': {'top': 220, 'bottom': 470, 'left': 90, 'right': 160}},
    'youtube': {'label': 'Video horizontal de YouTube', 'format': 'landscape', 'size': (1920, 1080),
                'seconds': (75, 240), 'shots': (9, 28), 'loudness': -14.0,
                'safe': {'top': 90, 'bottom': 90, 'left': 130, 'right': 130}},
}

KITS = {
    'melodi': 'Melodi protagonista: flota, parpadea y emite anillos. labels[0] opcional: bocadillo breve.',
    'languages': 'Saludos en varios idiomas que se convierten en labels[0] (p. ej. «Hola»).',
    'counter': 'Número de rodillos. labels[0]=cifra con puntos (p. ej. «7.000»), labels[1]=palabra bajo la cifra.',
    'dubbing': 'Video con hablante y subtítulo sincronizado: labels[0]=frase original, labels[1]=traducción, labels[2]=etiqueta (p. ej. «YouTube · Brave»).',
    'voice_clone': 'Dos ondas: voz original y la misma voz en otro idioma. labels[0]=idioma original, labels[1]=idioma destino, labels[2]=estado (p. ej. «Clonando tu voz… unos segundos»).',
    'speakers': 'Tres hablantes con colores propios, cada uno con su frase traducida: labels[0..2].',
    'meeting': 'Reunión con cuatro participantes y traducción en vivo: labels[0]=frase original de un participante, labels[1]=su traducción.',
    'chat': 'Chat con Melodi: labels alternan usuario/Melodi empezando por el usuario (2..4 mensajes).',
    'live_voice': 'Melodi escuchando y hablando en voz live: orbe, anillos y ecualizador. labels[0]=frase dicha.',
    'agents': 'Melodi coordina hasta cuatro agentes; labels=tareas breves que se completan.',
    'summary': 'Hoja de resumen: labels[0]=título, labels[1..3]=puntos que se marcan.',
    'workspace': 'WorkSpace de escritorio que se ensambla por paneles: labels=nombres de paneles.',
    'checklist': 'Lista que se marca punto a punto: labels=puntos (2..4).',
    'video_maker': 'Melodi montando un video: guion, ilustración, voz, música en una línea de tiempo. labels=pistas.',
    'logo': 'Cierre con Melodi y el wordmark de brivany (sólo videos de Brivany). labels[0]=lema bajo el logo.',
    'villa': 'Villa tropical ilustrada en una colina con selva, mar, piscinas y palmeras en movimiento. labels[0]=insignia breve (lema).',
    'web_button': 'Web en el navegador: labels[0]=dominio que se escribe en la barra, labels[1]=texto del botón que se pulsa, labels[2]=titular de la portada (opcional).',
    'date_picker': 'Calendario: se marca una estancia (entrada→salida) y se añaden huéspedes. labels[0]=título del paso, labels[1]=huéspedes, labels[2]=botón.',
    'stay_picker': 'Elegir alojamiento: labels[0..2]=opciones (nombre y capacidad), labels[3]=botón. Se selecciona la primera.',
    'details_form': 'Formulario: labels[0]=título del paso, labels[1..2]=nombres de campos, labels[3]=nota importante, labels[4]=botón que se pulsa.',
    'confirmation': 'Confirmación: labels[0]=título (solicitud recibida), labels[1]=documento que se firma, labels[2..3]=opciones de pago.',
    'brand_logo': 'Cierre con el logo del cliente: labels[0]=lema, labels[1]=web (sólo videos de un cliente).',
    'none': 'Sin ilustración: tipografía protagonista.',
}
LAYOUTS = {'statement', 'kit', 'end'}
THEMES = {'paper', 'night', 'blue', 'soft'}
TRANSITIONS = {'wipe', 'push', 'cut'}
MOODS = {'pulse', 'bright', 'calm', 'cinematic'}

_ROOT = {'version', 'destination', 'title', 'topic', 'music', 'shots', 'cta', 'publish'}
_ROOT_OPTIONAL = {'language', 'brand'}
LANGUAGES = {'es': 2.9, 'en': 2.6}  # measured words per second of Melodi's voices at speed 1.05
_SHOT = {'id', 'layout', 'theme', 'kicker', 'headline', 'accent', 'body', 'kit', 'labels', 'narration', 'transition'}
_SHOT_OPTIONAL = {'min_duration'}
_PUBLISH = {'caption', 'hashtags', 'cover_shot', 'cover_title'}
_ID = re.compile(r'[a-z][a-z0-9_-]{0,30}\Z')
_HASHTAG = re.compile(r'#[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ_]{2,40}\Z')
_EMAIL = re.compile(r"(?<![\w.+-])[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)*", re.I)
_URL = re.compile(r'\b(?:https?://|www\.)', re.I)
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
# Claims Melodi must not make in social copy without evidence.
_FORBIDDEN = [
    (re.compile(r'\b(?:instant[aá]ne[oa]s?|al\s+instante|en\s+un\s+instante|sin\s+(?:ning[uú]n\s+)?retraso|cero\s+latencia|latencia\s+cero)\b', re.I), 'No prometas traducción instantánea ni sin retraso.'),
    (re.compile(r'\b\d+(?:[.,]\d+)?\s*(?:ms|milisegundos)\b', re.I), 'No cites latencias medidas en el guion.'),
    (re.compile(r'\b(?:millones|miles)\s+de\s+usuarios\b', re.I), 'No inventes cifras de usuarios.'),
    (re.compile(r'\b(?:cualquier|todos\s+los)\s+idiomas?\s+del\s+mundo\b', re.I), 'No prometas todos los idiomas del mundo.'),
    (re.compile(r'\bclon\w*[^.]{0,30}\b(?:al\s+instante|instant\w*|inmediat\w*)|\b(?:instant\w*|inmediat\w*)\s+clon\w*', re.I), 'La clonación tarda unos segundos; no la presentes como instantánea.'),
    (re.compile(r'\b(?:100\s*%|perfect[ao]s?)\b', re.I), 'No prometas resultados perfectos o del 100 %.'),
    (re.compile(r'\b(?:instant(?:ly)?\s+(?:book|confirm)\w*|book\w*\s+instantly|guaranteed|best\s+price|lowest\s+price|free\s+cancell?ation|no\s+deposit|perfect|flawless|always\s+available)\b', re.I),
     'Do not overpromise: no instant booking/confirmation, guarantees, best price, free cancellation or perfect results unless the facts say so.'),
    (re.compile(r'\b(?:\w+mos\s+juntas|nosotras|bienvenida|lista\s+para\s+empezar)\b', re.I), 'No asumas el género de quien ve (usa formas neutras: «lo hacemos», «te doy la bienvenida»).'),
    (re.compile(r'\bdescarg\w*[^.]{0,40}vetsa|vetsa[^.]{0,40}\bdescarg', re.I), 'vetsa.es no ofrece la descarga de Brivany: di «más en vetsa.es».'),
    (re.compile(r'\b(?:cada\s+palabra|todo\s+lo\s+que\s+(?:dicen|oyes|escuchas)|(?:te\s+)?pierd\w*\s+nada|perderte\s+nada|sin\s+esfuerzo|(?:anotar|apuntar)\s+nada|nunca\s+(?:falla|se\s+equivoca))\b', re.I),
     'Evita absolutos que prometen de más (cada palabra, no perderte nada, sin esfuerzo, no anotar nada).'),
]
WORDS_PER_SECOND = 2.9  # measured: Melodi speaks ~3.0 words/s at speed 1.05 (Cartesia word timestamps)


def _text(value, maximum, *, minimum=0, field='texto'):
    if not isinstance(value, str) or _CONTROL.search(value) or not minimum <= len(value.strip()) or len(value) > maximum:
        raise ValueError(f'El campo {field} no cumple el contrato (máximo {maximum} caracteres).')
    if _EMAIL.search(value):
        raise ValueError('No se admiten direcciones de correo en el video ni en la publicación.')
    if _URL.search(value) and field not in {'caption'}:
        raise ValueError(f'El campo {field} no admite enlaces.')
    return value.strip()


def claims_feedback(text):
    """Return the first honesty rule a script breaks, or None."""
    for pattern, message in _FORBIDDEN:
        if pattern.search(text):
            return message
    return None


def words(text):
    return len(re.findall(r'[\wÁÉÍÓÚÜÑáéíóúüñ\'’-]+', text))


def estimate_seconds(shot, wps=WORDS_PER_SECOND):
    narration = shot['narration']
    spoken = words(narration) / wps + (.7 if narration else 0)
    return max(shot.get('min_duration', 0), spoken, 2.0 if shot['layout'] != 'end' else 3.0)


def validate_social(plan, *, destination=None, brand=None, language=None):
    """Validate a social plan and return a detached normalized copy.

    brand: the client's brand kit when the video promotes a client (site, name,
    spoken forms of the site); None for Brivany's own videos.
    """
    if type(plan) is not dict or set(plan) - _ROOT - _ROOT_OPTIONAL or _ROOT - set(plan):
        missing = sorted(_ROOT - set(plan)) if type(plan) is dict else []
        extra = sorted(set(plan) - _ROOT - _ROOT_OPTIONAL) if type(plan) is dict else []
        raise ValueError(f'Campos raíz no válidos. Faltan {missing}; sobran {extra}.')
    if plan['version'] != 2 or type(plan['version']) is not int:
        raise ValueError('El plan social usa version 2.')
    if plan['destination'] not in DESTINATIONS:
        raise ValueError('Destino no admitido: instagram_story, reel o youtube.')
    if destination and plan['destination'] != destination:
        raise ValueError(f'El destino debe ser {destination}, como se pidió.')
    spec = DESTINATIONS[plan['destination']]
    result = {'version': 2, 'destination': plan['destination'],
              'title': _text(plan['title'], 100, minimum=1, field='title'),
              'topic': _text(plan['topic'], 200, minimum=1, field='topic'),
              'cta': _text(plan['cta'], 60, field='cta')}
    lang = plan.get('language', 'es')
    if lang not in LANGUAGES or (language and lang != language):
        raise ValueError(f'language debe ser «{language or "es"}» (idioma de la voz y de todos los textos).')
    result['language'] = lang
    if brand:
        given = plan.get('brand')
        if type(given) is not dict or given.get('site') != brand['site']:
            raise ValueError(f'brand debe ser {{"name": "{brand["name"]}", "site": "{brand["site"]}"}}: el video promociona a ese cliente.')
        result['brand'] = {'name': brand['name'], 'site': brand['site']}
    elif plan.get('brand'):
        raise ValueError('brand sólo se usa cuando la petición promociona a un cliente con su web.')
    music = plan['music']
    if type(music) is not dict or set(music) != {'mood', 'bpm'} or music['mood'] not in MOODS:
        raise ValueError('music necesita {mood: pulse|bright|calm|cinematic, bpm}.')
    if type(music['bpm']) is not int or not 80 <= music['bpm'] <= 132:
        raise ValueError('bpm debe ser un entero entre 80 y 132.')
    result['music'] = dict(music)
    shots = plan['shots']
    low, high = spec['shots']
    if type(shots) is not list or not low <= len(shots) <= high:
        raise ValueError(f'{spec["label"]} necesita entre {low} y {high} planos.')
    seen = set()
    result['shots'] = []
    errors = []  # every shot is checked so Melodi can fix all problems in one retry
    for index, shot in enumerate(shots):
        try:
            if type(shot) is dict:  # optional copy and decoration default to empty
                shot = {**{'kicker': '', 'accent': '', 'body': '', 'labels': [], 'kit': 'none', 'transition': 'push' if index else 'cut'}, **shot}
            shot.pop('label_langs', None)  # derived field of a validated plan; recomputed below
            if type(shot) is not dict or set(shot) - _SHOT - _SHOT_OPTIONAL or _SHOT - set(shot):
                got = set(shot) if type(shot) is dict else set()
                raise ValueError(f'Plano {index + 1}: campos no válidos. Faltan {sorted(_SHOT - got)}; sobran {sorted(got - _SHOT - _SHOT_OPTIONAL)}. '
                                 f'Usa exactamente {sorted(_SHOT)} (vacíos como "" o []).')
            if not isinstance(shot['id'], str) or not _ID.fullmatch(shot['id']) or shot['id'] in seen:
                raise ValueError(f'Plano {index + 1}: id duplicado o no válido.')
            seen.add(shot['id'])
            if shot['layout'] not in LAYOUTS or shot['theme'] not in THEMES or shot['transition'] not in TRANSITIONS:
                raise ValueError(f'Plano {shot["id"]}: layout, theme o transition no admitidos.')
            if shot['kit'] not in KITS:
                raise ValueError(f'Plano {shot["id"]}: kit no admitido. Usa uno de {sorted(KITS)}.')
            item = {key: shot[key] for key in ('id', 'layout', 'theme', 'kit', 'transition')}
            item['kicker'] = _text(shot['kicker'], 40, field='kicker')
            item['headline'] = _text(shot['headline'], 72, minimum=1, field='headline')
            if words(item['headline']) > 8:
                raise ValueError(f'Plano {shot["id"]}: el titular tiene más de 8 palabras; resúmelo en una idea potente.')
            item['accent'] = _text(shot['accent'], 40, field='accent')
            if item['accent'] and item['accent'] not in item['headline']:
                raise ValueError(f'Plano {shot["id"]}: accent debe ser un fragmento literal de headline.')
            item['body'] = _text(shot['body'], 120, field='body')
            if type(shot['labels']) is not list or len(shot['labels']) > 5:
                raise ValueError(f'Plano {shot["id"]}: labels admite hasta cinco textos.')
            if brand and shot['kit'] == 'logo' or not brand and shot['kit'] == 'brand_logo':
                raise ValueError(f'Plano {shot["id"]}: usa brand_logo para el cierre de un cliente y logo para Brivany.')
            item['labels'] = [_text(label, 64, minimum=1, field='labels') for label in shot['labels']]
            item['narration'] = _text(shot['narration'], 320, field='narration')
            if item['narration'] and item['headline'].lower().strip(' .¡!¿?') in item['narration'].lower():
                raise ValueError(f'Plano {shot["id"]}: el titular «{item["headline"]}» aparece literalmente dentro de la locución; los subtítulos ya la muestran. Resume la idea con otras palabras.')
            if 'min_duration' in shot:
                value = shot['min_duration']
                if type(value) not in (int, float) or not math.isfinite(value) or not 1.5 <= value <= 20:
                    raise ValueError(f'Plano {shot["id"]}: min_duration entre 1,5 y 20 s.')
                item['min_duration'] = float(value)
            if item['layout'] == 'kit' and item['kit'] == 'none':
                raise ValueError(f'Plano {shot["id"]}: layout kit necesita un kit de ilustración (campo "kit"), no "none".')
            closing = {'brand_logo', 'villa', 'web_button'} if brand else {'logo', 'melodi'}
            if item['layout'] == 'end' and item['kit'] not in closing:
                raise ValueError(f'Plano {shot["id"]}: el cierre usa kit ' + ' o '.join(sorted(closing)) + '.')
            portrait = DESTINATIONS[plan['destination']]['format'] == 'portrait'
            if portrait and item['kit'] == 'none':
                raise ValueError(f'Plano {shot["id"]}: en vertical cada plano necesita una ilustración (kit) que ocupe la pantalla.')
            if index == 0 and (item['layout'] != 'kit' or item['kit'] in {'none', 'logo', 'brand_logo'}):
                raise ValueError('Gancho: el primer plano usa layout kit con una ilustración grande y en movimiento '
                                 '(no texto solo) y un titular con una promesa concreta.')
            issues = copy_issues(item)
            if issues:
                raise ValueError(f'Plano {shot["id"]}: ' + '; '.join(issues[:3]) + '.')
            item['label_langs'] = [detect_language(label) for label in item['labels']]
            if item['layout'] == 'end' and index != len(shots) - 1:
                raise ValueError('El layout end sólo puede ser el último plano.')
            for text in (item['headline'], item['body'], item['narration'], *item['labels']):
                problem = claims_feedback(text)
                if problem:
                    raise ValueError(f'Plano {shot["id"]}: {problem}')
            result['shots'].append(item)
        except ValueError as error:
            errors.append(str(error))
    if errors:
        raise ValueError(' | '.join(errors[:10]))
    if not any(s['narration'] for s in result['shots']):
        raise ValueError('El video necesita la voz de Melodi en al menos un plano.')
    if result['shots'][-1]['layout'] != 'end':
        raise ValueError('El último plano debe usar layout end (cierre con logo y destino).')
    publish = plan['publish']
    if type(publish) is not dict or set(publish) != _PUBLISH:
        raise ValueError('publish necesita caption, hashtags, cover_shot y cover_title.')
    tags = publish['hashtags']
    if type(tags) is not list or not 3 <= len(tags) <= 12 or any(not isinstance(t, str) or not _HASHTAG.fullmatch(t) for t in tags):
        raise ValueError('hashtags: entre 3 y 12 etiquetas del tipo #Palabra.')
    accents = hashtag_issues(tags)
    if accents:
        raise ValueError('hashtags con tildes: ' + '; '.join(accents[:4]) + '.')
    sites = (brand['site'],) if brand else CTA_DESTINATIONS
    if not any(d in result['cta'].lower() for d in sites):
        raise ValueError(f'cta necesita un destino real en pantalla: incluye «{sites[0]}».')
    spoken = SPOKEN_DESTINATIONS['portrait' if spec['format'] == 'portrait' else 'landscape']
    if brand:
        spoken = tuple(brand.get('spoken_site', ())) + (('link in bio', 'link in our bio') if lang == 'en' else ('enlace en la bio',))
    if not any(d in result['shots'][-1]['narration'].lower() for d in spoken):
        raise ValueError('La locución del cierre debe decir adónde ir: ' + ' o '.join(f'«{d}»' for d in spoken) + '.')
    if publish['cover_shot'] not in seen:
        raise ValueError('cover_shot debe ser el id de un plano.')
    caption = _text(publish['caption'], 1800, minimum=20, field='caption')
    problem = claims_feedback(caption)
    if re.search(r'\b(?:\d+|un|una|dos|tres|medio|one|two|three|a)\s+(?:minutos?|segundos?|minutes?|seconds?)\b', caption, re.I):
        problem = 'No cites la duración en el texto de publicación: la fija la voz real y aún no se conoce.'
    if problem:
        raise ValueError('Texto de publicación: ' + problem)
    result['publish'] = {'caption': caption, 'hashtags': list(dict.fromkeys(tags)), 'cover_shot': publish['cover_shot'],
                         'cover_title': _text(publish['cover_title'], 60, minimum=1, field='cover_title')}
    estimate = sum(estimate_seconds(s, LANGUAGES[lang]) + .35 for s in result['shots'])
    first, last = spec['seconds']
    if not first * .85 <= estimate <= last * 1.08:  # the real voice-timed length is checked again after recording
        raise ValueError(f'La narración estimada dura {estimate:.0f} s y {spec["label"]} admite {first}–{last} s. '
                         f'Ajusta el guion (≈{LANGUAGES[lang]} palabras por segundo, {int(last * LANGUAGES[lang] * .8)} palabras como máximo en total).')
    return result
