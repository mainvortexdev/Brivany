"""Copy rules for Melodi's social videos: checked before render so Melodi can
fix them, and reported by the reviewer. Pure functions, no I/O."""
from __future__ import annotations

import re
import unicodedata

_STOP = set("""a al algo ante con contigo cada como cómo de del el ella en entre era es esa ese eso esta este esto ha hay
la las le lo los me mi mis muy más no nos o para pero por que qué se si sí sin su sus te ti tu tus un una uno y ya yo""".split())
FILLER_KICKERS = {'check this out', 'look', 'hey', 'hello', 'hi', 'new', 'wow', 'did you know', 'mira esto', 'hola soy yo', 'empieza ahora', 'atencion', 'nuevo', 'novedad', 'ojo', 'escucha', 'mira', 'hola'}
_LANG_WORDS = {
    'es': 'el la los las de que y en un una es por para con no se lo tu mi su al del me te necesitamos hoy podemos esta este gracias hola',
    'en': 'the a an is are to of and you we i it this that for on with need do our today can be your love idea welcome back turn follow me',
    'de': 'der die das und ist nicht wir ich sie zu den mit ein eine müssen heute können termin',
    'fr': "le la les et est que nous vous je un une des pas pour on peut c'est aujourd'hui merci bonjour",
    'pt': 'o a os as e é que não um uma você nós para com do da hoje precisamos obrigado',
    'it': 'il la le e è che non un una per con noi siamo oggi dobbiamo grazie',
}
HASHTAG_ACCENTS = [(r'cion(?=[A-Z0-9]|$)', 'ción'), (r'Espanol', 'Español'), (r'Tecnologia', 'Tecnología'), (r'Musica', 'Música'),
                   (r'Linea', 'Línea'), (r'Analisis', 'Análisis'), (r'Rapid[ao]', 'Rápido/a'), (r'Publico', 'Público')]
CTA_DESTINATIONS = ('vetsa.es',)
SPOKEN_DESTINATIONS = {'portrait': ('vetsa punto es', 'enlace en la bio', 'enlace de la bio'),
                       'landscape': ('vetsa punto es', 'en la descripción', 'enlace de la descripción')}


def plain(text):
    text = text.lower().replace('ñ', '~')
    text = ''.join(c for c in unicodedata.normalize('NFD', text) if unicodedata.category(c) != 'Mn')
    return text.replace('~', 'ñ')


def content_words(text):
    return [w for w in re.findall(r'[a-zñ]+', plain(text)) if len(w) >= 3 and w not in _STOP]


def detect_language(text):
    """Small stop-word vote; enough to label who speaks in an illustrated example."""
    low = text.lower()
    if re.search(r'[ñ¿¡]', low):
        return 'es'
    words = re.findall(r"[a-zà-ÿ']+", low)
    scores = {lang: sum(w in vocab.split() for w in words) for lang, vocab in _LANG_WORDS.items()}
    if re.search(r'[äöüß]', low):
        scores['de'] += 2
    if re.search(r'[çãõ]', low):
        scores['pt'] += 1
        scores['fr'] += 1
    best = max(scores, key=scores.get)
    return best if scores[best] else None


def _shared_root(a, b, n=5):
    return any(a[i:i + n] in b for i in range(len(a) - n + 1))


def copy_issues(shot):
    """Messages for one shot's copy; empty when the copy is clean."""
    issues = []
    kicker, headline = shot['kicker'], shot['headline']
    if kicker and plain(kicker).strip(' .!¡') in FILLER_KICKERS:
        issues.append(f'antetítulo de relleno («{kicker}»): usa un dato que añada información o déjalo vacío')
    kw, hw = content_words(kicker), content_words(headline)
    if kicker and (any(_shared_root(a, b) or _shared_root(b, a) or a == b for a in kw for b in hw) or plain(kicker) in plain(headline)):
        issues.append(f'el antetítulo «{kicker}» repite el titular «{headline}»')
    for field in ('kicker', 'headline', 'body'):
        words = content_words(shot.get(field, ''))
        for i, a in enumerate(words):
            for b in words[i + 1:]:
                if a != b and (_shared_root(a, b) or _shared_root(b, a)):
                    issues.append(f'pleonasmo en {field}: «{a}» y «{b}» repiten la misma raíz')
    if shot['kit'] in {'meeting', 'dubbing'} and len(shot['labels']) >= 2:
        original, translated = detect_language(shot['labels'][0]), detect_language(shot['labels'][1])
        if original in (None, 'es'):
            issues.append(f'kit {shot["kit"]}: labels[0] debe ser la frase original en otro idioma (detectado: {original or "desconocido"})')
        if translated != 'es':
            issues.append(f'kit {shot["kit"]}: labels[1] debe ser la traducción al español')
    return issues


def hashtag_issues(tags):
    return [f'{tag}: falta la tilde ({fix})' for tag in tags for pattern, fix in HASHTAG_ACCENTS if re.search(pattern, tag)]


# ------------------------------------------------------------- spoken → written
TLDS = {'es', 'com', 'ai', 'org', 'net', 'io', 'app', 'dev', 'eu'}
_ARTICLES = {'el', 'la', 'los', 'las', 'un', 'una', 'este', 'ese', 'esta', 'esa', 'lo', 'al', 'del', 'de', 'otro', 'mi', 'tu', 'su'}
# «vetsa punto es» on screen is a spoken form; «el punto es que…» is ordinary prose
SPOKEN_ON_SCREEN = re.compile(r'(?:\b(?!(?:el|la|un|una|este|ese|lo|al|del)\s)\w+\s+punto\s+(?:es|com|ai|org|net|io|app|dev|eu)\b(?!\s+(?:que|decir)\b)'
                              r'|\b\w+\s+dot\s+(?:com|es|net|org|ai|io|app|dev|eu)\b|\bat\s+sign\b'
                              r'|\barroba\b|\bpor\s+ciento\b|\bbarra\s+barra\b|\bguion\s+bajo\b)', re.I)


def _core(token):
    m = re.match(r'^([¿¡"«(]*)(.*?)([.,;:!?…"»)]*)$', token)
    return m.group(1), m.group(2), m.group(3)


def written_words(words):
    """Merge spoken forms into their written form for subtitles; timing spans the merged words.

    «vetsa punto es» → «vetsa.es», «x arroba y punto com» → «x@y.com», «14 por ciento» → «14 %».
    words: [{'w', 'start', 'end', ...}] (other keys of the first word are kept).
    """
    out, i = [], 0
    while i < len(words):
        w = dict(words[i])
        lead, core, tail = _core(w['w'])
        j = i
        while j + 2 < len(words) + 0 and j + 2 <= len(words) - 1:
            nxt = _core(words[j + 1]['w'])
            after = _core(words[j + 2]['w'])
            joiner = {'punto': '.', 'arroba': '@'}.get(nxt[1].lower())
            follow = _core(words[j + 3]['w'])[1].lower() if j + 3 < len(words) else ''
            prose = core.lower() in _ARTICLES or follow in {'que', 'decir'}  # «el punto es que…» is prose, not an address
            if joiner and not prose and not nxt[0] and not nxt[2] and after[1] and (joiner == '@' or after[1].lower() in TLDS or j > i):
                core += joiner + after[1]
                tail = after[2]
                j += 2
                if joiner == '.' and after[1].lower() in TLDS:
                    break
            else:
                break
        if j == i and i + 2 < len(words) + 1 and i + 2 <= len(words) and False:
            pass
        if j == i and i + 2 <= len(words) - 1 and _core(words[i + 1]['w'])[1].lower() == 'por' and _core(words[i + 2]['w'])[1].lower() == 'ciento' and re.fullmatch(r'\d+(?:[.,]\d+)?', core):
            core += ' %'
            tail = _core(words[i + 2]['w'])[2]
            j = i + 2
        w['w'] = lead + core + tail
        w['end'] = words[j]['end']
        out.append(w)
        i = j + 1
    return out


def spoken_form_issues(text):
    return [m.group(0) for m in SPOKEN_ON_SCREEN.finditer(text)]



def written_sites(words, sites):
    """Replace a spoken site («casa selva azul dot com») with its written form («casaselvaazul.com»).

    sites: {written: [spoken variants]}. Runs before written_words; timing spans the spoken words.
    """
    variants = sorted(((written, spoken.split()) for written, forms in sites.items() for spoken in forms), key=lambda x: -len(x[1]))
    out, i = [], 0
    while i < len(words):
        for written, tokens in variants:
            chunk = words[i:i + len(tokens)]
            if len(chunk) == len(tokens) and all(plain(_core(w['w'])[1]) == plain(t) for w, t in zip(chunk, tokens)):
                lead, tail = _core(chunk[0]['w'])[0], _core(chunk[-1]['w'])[2]
                out.append({**chunk[0], 'w': lead + written + tail, 'end': chunk[-1]['end']})
                i += len(tokens)
                break
        else:
            out.append(words[i])
            i += 1
    return out
