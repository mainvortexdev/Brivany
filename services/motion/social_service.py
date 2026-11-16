"""Melodi creates social videos end to end (edition 4).

Melodi (the Meta planner) chooses the topic, writes the script, the on-screen
copy and picks trusted animated illustration kits. Trusted local code times the
shots on Melodi's real voice, synthesizes an original score and sound effects,
renders the frames, mixes, and delivers MP4, cover, subtitles and post text.
The model never supplies code, URLs or paths.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from uuid import UUID

from .social_contract import DESTINATIONS, KITS, LAYOUTS, THEMES, TRANSITIONS, MOODS, WORDS_PER_SECOND, validate_social
from . import social_audio as audio
from .social_review import review_composition, review_hook, review_layout, review_mix, review_timing

APP = Path(__file__).resolve().parents[2]
from services.brand import copy_fonts
ASSETS = Path(__file__).resolve().parent / 'assets'
RENDER = Path(__file__).resolve().parent / 'social_render.mjs'
FPS = 30
VOICE_SPEED = 1.05

SOCIAL_PROMPT = '''Eres Melodi, la asistente de Brivany, y diriges tu propio contenido para redes.
Devuelve SOLO JSON (sin markdown) con el esquema EXACTO indicado en "schema". Tu JSON
son datos: nunca HTML, código, URLs ni rutas. Sigue estas reglas:
- Si la petición no fija tema, elige uno llamativo de "capabilities" (o habla de tus
  capacidades y herramientas) y evita repetir "previous_topics". Gancho fuerte en los
  primeros dos segundos: pregunta, cifra o contraste. Cada plano deja con ganas del siguiente.
- Hablas en primera persona («puedo», «te enseño», «yo me encargo»). Nunca «Melodi hace»
  ni «ella». No digas «Brivany» pegado al final de una frase hablada.
- Honestidad: sólo afirma lo que dice "capabilities[].claim"; respeta sus "limits". Nada de
  traducción instantánea, cifras de latencia o usuarios, «perfecto» ni «100 %», ni absolutos como
  «cada palabra», «no perderte nada» o «sin esfuerzo». La clonación
  de voz tarda unos segundos con una voz nueva. Las ilustraciones son ejemplos.
- Revisa ortografía, tildes y concordancia de género y número. No asumas el género de quien ve.
- Un mensaje por plano. headline ≤ 7 palabras y potente; accent = fragmento literal del
  headline que irá en azul (o ""). kicker ≤ 4 palabras o "". body corto o "".
- narration: lo que dirás con tu voz en ese plano, natural y con ritmo, ≈2,5 palabras por
  segundo; duración del plano = la de tu voz. Respeta "destination.seconds" en total.
- Elige un kit por plano de "kits" que ILUSTRE lo que dices y rellena sus labels en
  español (textos cortos). Varía kits, layouts y themes: alterna claro/oscuro/azul para ritmo.
  layout statement = tipografía grande (kit opcional pequeño); kit = titular + ilustración grande;
  end = último plano con kit logo y cta.
- transition: wipe en cambios de bloque, push o cut dentro de un bloque.
- GANCHO (primer plano): layout kit con una ilustración grande que se mueva desde el primer
  fotograma (melodi, languages, counter, dubbing o voice_clone) y un titular con una promesa
  concreta y comprobable; nada de texto solo ni saludos («Hola soy yo») como antetítulo.
- kicker: aporta un dato nuevo (tema, paso, contexto) o va vacío; nunca repite palabras del
  titular. Sin pleonasmos («un gancho que enganche»).
- En vertical (historia y reel) TODOS los planos llevan kit: la ilustración ocupa la pantalla.
  body sólo se muestra en YouTube; en vertical déjalo vacío.
- Ejemplos de traducción (kits meeting y dubbing): labels[0] = frase original en otro idioma
  (inglés, alemán, francés, portugués o italiano) y labels[1] = su traducción al español.
- Cierre con destino real: cta incluye «vetsa.es» (p. ej. «Más en vetsa.es») y la locución del
  último plano dice «vetsa punto es» (o «enlace en la bio» en historia/reel, «en la descripción» en
  YouTube). vetsa.es es la web del ecosistema Vetsa AI: no digas que allí se descarga Brivany.
- hashtags con tildes correctas (#Traducción, #IAEnEspañol).
- IDIOMA: escribe TODO (titulares, labels, locución, cta y publicación) en "language" (es o en).
  Incluye "language" en la raíz del JSON.
- CLIENTE: si existe "client", el video promociona a ese cliente, no a Brivany. Incluye en la raíz
  "brand": client.brand_json. Usa SOLO client.facts: no inventes precios, disponibilidad, plazos ni
  servicios; usa los textos literales de botones y pasos de su web en labels. Explica de forma que
  cualquiera lo entienda: un paso por plano con su kit (web_button, date_picker, stay_picker,
  details_form, confirmation; villa para el gancho). Gancho con kit villa y una promesa concreta.
  Cierre: layout end con kit brand_logo (labels: lema, web), cta con client.site y la locución final
  dice la web hablada (una de client.spoken_site). Habla en primera persona sólo como guía
  («I'll show you how to book»). Sin #Brivany ni #Melodi en la publicación de un cliente.
- GUÍAS PASO A PASO: kicker = «Step 1», «Step 2»… (o «Paso 1» en español); headline = la acción
  con el texto literal del botón o del paso de la web (p. ej. «Tap “Book Your Stay”»); la locución
  explica el porqué con otras palabras, sin repetir el titular. Un paso por plano. Nada de «perfect».
  No olvides "version": 2 en la raíz.
- music.mood y bpm según el tono (pulse/bright energéticos 110–128, calm 84–96, cinematic 90–104).
- publish.caption: texto para publicar en la red, con gancho en la primera línea, saltos
  de línea, sin correos; hashtags 5–10; cover_shot = id del plano para la portada y
  cover_title = título de portada ≤ 6 palabras.'''

SCHEMA = {
    'version': 2, 'destination': '|'.join(DESTINATIONS), 'language': 'es|en', 'brand': {'name': 'sólo si hay client', 'site': 'client.site'}, 'title': 'string<=100', 'topic': 'string<=200',
    'music': {'mood': '|'.join(sorted(MOODS)), 'bpm': 'entero 80..132'},
    'shots': [{'id': 'a-z0-9_-', 'layout': '|'.join(sorted(LAYOUTS)), 'theme': '|'.join(sorted(THEMES)),
               'kicker': 'string<=40 o ""', 'headline': 'string<=72', 'accent': 'fragmento literal del headline o ""',
               'body': 'string<=120 o ""', 'kit': '|'.join(KITS), 'labels': ['hasta 4 textos <=64'],
               'narration': 'string<=320', 'transition': '|'.join(sorted(TRANSITIONS))}],
    'cta': 'string<=60', 'publish': {'caption': 'string<=1800', 'hashtags': ['#Etiqueta'], 'cover_shot': 'id de plano', 'cover_title': 'string<=60'}}


def detect_destination(request):
    text = request.lower()
    if re.search(r'\byoutube\b|\bvideo largo\b|\bhorizontal\b|\b16\s*:\s*9\b', text):
        return 'youtube'
    if re.search(r'\breels?\b|\btiktok\b|\bshorts?\b', text):
        return 'reel'
    if re.search(r'\b(?:historia|story|stories|historias)\b.*\binstagram\b|\binstagram\b.*\b(?:historia|story|stories)\b', text):
        return 'instagram_story'
    if re.search(r'\bv[ií]deo\b[^.]{0,60}\b(?:corto|vertical|9\s*:\s*16)\b|\b(?:short|vertical)\s+video\b', text):
        return 'short'
    return None


def detect_language(request):
    return 'en' if re.search(r'\b(?:en|in)\s+(?:ingl[eé]s|english)\b|\benglish\b', request, re.I) else 'es'


def load_brand(folder):
    """A client's brand kit: brand.json + logo(s) + fonts with their licences."""
    folder = Path(folder).resolve()
    data = json.loads((folder / 'brand.json').read_text(encoding='utf-8'))
    for key in ('name', 'site', 'logo', 'logo_light', 'fonts', 'themes', 'ui', 'colors'):
        if key not in data:
            raise ValueError(f'brand.json necesita «{key}».')
    data['folder'] = str(folder)
    return data


def is_social_request(request):
    return detect_destination(request) is not None and bool(re.search(r'\b(?:crea|crear|genera|haz|hazme|produce|prepara|monta)\b', request, re.I))


def shot_timing(plan, voices):
    """voices: per shot None or {'path','words','first','last'} (seconds in the wav)."""
    beat = 60 / plan['music']['bpm']
    timing, clock = [], 0.0
    for i, shot in enumerate(plan['shots']):
        lead = .25 if i == 0 else .32
        spoken = voices[i]['last'] - voices[i]['first'] if voices[i] else 0
        need = lead + spoken + .42
        if shot['layout'] == 'end':
            need += 1.0 if plan['destination'] in {'short', 'instagram_story'} else 1.8  # logo hold
        need = max(need, shot.get('min_duration', 0), 2.0 if shot['layout'] != 'end' else 3.5)
        duration = math.ceil(need / beat - 1e-6) * beat
        timing.append({'start': round(clock, 4), 'duration': round(duration, 4), 'voice_at': round(clock + lead, 4)})
        clock += duration
    return timing, round(clock, 4)


def group_captions(words, portrait, *, max_words=None, max_chars=None):
    max_words = max_words or (4 if portrait else 7)
    max_chars = max_chars or (24 if portrait else 42)
    cues, current = [], []
    for w in words:
        text = ' '.join(x['w'] for x in current + [w])
        if current and (len(current) >= max_words or len(text) > max_chars or current[-1]['shot'] != w['shot']):
            cues.append(current)
            current = []
        current.append(w)
        if re.search(r'[.!?…:;]$', w['w']):
            cues.append(current)
            current = []
    if current:
        cues.append(current)
    out = []
    for i, cue in enumerate(cues):
        end = cue[-1]['end'] + .3
        if i + 1 < len(cues):
            end = min(end, cues[i + 1][0]['start'] - .02)
        out.append({'start': round(cue[0]['start'], 3), 'end': round(max(end, cue[-1]['end']), 3),
                    'words': [{'w': x['w'], 'start': round(x['start'], 3)} for x in cue]})
    return out


def chapters(plan, timing, minimum=10.0):
    """YouTube chapters: first at 0:00, each at least ten seconds long."""
    marks = []
    for shot, t in zip(plan['shots'], timing):
        label = shot['kicker'] or shot['headline']
        if not marks or t['start'] - marks[-1][0] >= minimum:
            marks.append([t['start'], label])
    total = timing[-1]['start'] + timing[-1]['duration']
    while len(marks) > 1 and total - marks[-1][0] < minimum:
        marks.pop()
    return [(0.0 if i == 0 else start, label) for i, (start, label) in enumerate(marks)] if len(marks) >= 3 else []


def srt(cues):
    def stamp(t):
        ms = int(round(t * 1000))
        return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'
    return '\n'.join(f'{i}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{" ".join(w["w"] for w in c["words"])}\n'
                     for i, c in enumerate(cues, 1))


class SocialService:
    def __init__(self, root, *, voice_cache=None, ffmpeg=None, node=None):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.voice_cache = Path(voice_cache) if voice_cache else self.root / '.voice-cache'
        self.ffmpeg = ffmpeg or shutil.which('ffmpeg') or 'ffmpeg'
        self.ffprobe = shutil.which('ffprobe') or 'ffprobe'
        self.node = node or shutil.which('node') or 'node'
        self.voice = audio.melodi_voice  # replaceable in tests

    @staticmethod
    def availability():
        core = APP / 'motion-studio/node_modules/playwright-core/package.json'
        return {'available': core.is_file() and all(shutil.which(x) for x in ('node', 'ffmpeg', 'ffprobe')),
                'edition': 4, 'destinations': {k: {'label': v['label'], 'size': v['size'], 'seconds': v['seconds']} for k, v in DESTINATIONS.items()},
                'kits': sorted(KITS), 'voice': 'Melodi · Cartesia con marcas de palabra', 'music': 'original sintetizada localmente',
                'sound_effects': 'sintetizados en los eventos visuales', 'captions': True, 'cover': True, 'post_text': True,
                'arbitrary_code': False, 'publishes_automatically': False}

    def _run(self, args, timeout, cancelled=None):
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, encoding='utf-8', errors='replace')
        if proc.returncode:
            raise ValueError(f'{Path(args[0]).name} falló: {(proc.stderr or proc.stdout)[-800:]}')
        return proc.stdout

    def _previous_topics(self):
        topics = []
        for file in sorted(self.root.glob('*/social-plan.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:12]:
            try:
                plan = json.loads(file.read_text(encoding='utf-8'))
                topics.append(f"{plan['destination']}: {plan['topic']}")
            except (OSError, ValueError, KeyError):
                continue
        return topics

    def plan(self, request, decide, *, destination, cancelled=None, progress=lambda t: None, attempts=4, previous=None, revision=None,
             brand=None, facts=None, language=None):
        guide = ASSETS / 'STYLE.md'
        spec = DESTINATIONS[destination]
        context = {
            'request': request, 'schema': SCHEMA,
            'destination': {'id': destination, 'label': spec['label'], 'seconds': list(spec['seconds']), 'shots': list(spec['shots']),
                            'words_per_second': WORDS_PER_SECOND, 'aspect': '9:16' if spec['format'] == 'portrait' else '16:9'},
            'kits': KITS, 'capabilities': json.loads((ASSETS / 'CAPABILITIES.json').read_text(encoding='utf-8')),
            'brand_guide': guide.read_text(encoding='utf-8')[:3500] if guide.is_file() else '',
            'previous_topics': self._previous_topics(),
        }
        language = language or detect_language(request)
        context['language'] = language
        from .social_contract import LANGUAGES
        wps = LANGUAGES[language]
        context['destination']['words_per_second'] = wps
        asked = re.search(r'(\d{1,3})\s*(?:segundos?|seconds?|s)', request, re.I)
        if asked:  # the requested length becomes a word budget for the whole narration
            target = int(asked[1])
            context['destination']['target_seconds'] = target
            shots = max(spec['shots'][0], min(spec['shots'][1], round(target / 3)))
            context['destination']['recommended_shots'] = shots  # each shot needs ~3 s to read and hear
            context['destination']['narration_word_budget'] = int(max(4, target - .9 * shots) * wps)
        if brand:
            # a client's promotion: their facts replace Brivany's capabilities
            context.pop('capabilities')
            context.pop('previous_topics')
            context['client'] = {'name': brand['name'], 'site': brand['site'], 'tagline': brand.get('tagline'),
                                 'spoken_site': brand.get('spoken_site', []), 'facts': facts or '',
                                 'brand_json': {'name': brand['name'], 'site': brand['site']}}
        if previous is not None:
            context['previous_plan'] = previous
            context['revision_request'] = revision or 'Mejora el plan.'
        feedback, calls = None, 0
        for attempt in range(attempts):
            if cancelled is not None and cancelled.is_set():
                raise ValueError('Creación cancelada.')
            progress('Estoy eligiendo el tema y escribiendo el guion' if not attempt else 'Ajusto el guion: ' + feedback)
            calls += 1
            candidate = decide(SOCIAL_PROMPT, {**context, **({'validation_feedback': feedback} if feedback else {})})
            try:
                return validate_social(candidate, destination=destination, brand=brand, language=language), calls, candidate
            except ValueError as error:
                feedback = str(error)
                if attempt == attempts - 1:
                    failure = ValueError('El plan no superó la validación: ' + feedback)
                    failure.calls = calls
                    raise failure from None

    def run(self, goal, *, identifier, decide, cancelled, progress=lambda t: None, require=lambda: None,
            render=True, user_request=None, export_to=None, replace_export=False, plan=None, planned_by=None, planning_calls=0, workers=3,
            brand=None, facts=None, **_ignored):
        request = user_request or goal
        destination = detect_destination(request)
        if not destination:
            raise ValueError('Indica el destino: historia de Instagram, reel/TikTok o YouTube.')
        if str(UUID(identifier)) != identifier:
            raise ValueError('Proyecto de video no válido.')
        if not self.availability()['available']:
            raise ValueError('Falta el motor local (Node, FFmpeg, Playwright) para crear videos.')
        began = time.monotonic()
        folder = self.root / identifier
        folder.mkdir(exist_ok=False)
        report = {'creator': 'Melodi', 'request': request, 'destination': destination, 'planner': 'Meta',
                  'planning_calls': 0, 'voice_requests': 0, 'voice_reused': 0, 'billed_amount': None,
                  'created_utc': datetime.now(timezone.utc).isoformat()}
        require()
        if brand is None:  # a brand kit saved in the workspace whose site the request names
            for file in sorted((self.root / 'brands').glob('*/brand.json')):
                try:
                    site = json.loads(file.read_text(encoding='utf-8')).get('site', '')
                except (OSError, ValueError):
                    continue
                if site and site.lower() in request.lower():
                    brand = file.parent
                    break
        brand = load_brand(brand) if isinstance(brand, (str, Path)) else brand
        language = detect_language(request)
        if plan is None:
            plan, calls, raw = self.plan(request, decide, destination=destination, cancelled=cancelled, progress=progress,
                                         brand=brand, facts=facts, language=language)
            report['planning_calls'] = calls
            report['handwritten_plan'] = False
        else:
            plan, raw = validate_social(plan, destination=destination, brand=brand, language=plan.get('language', language)), plan
            report['handwritten_plan'] = planned_by is None
            report['planned_by'] = planned_by or 'manual'
            report['planning_calls'] = planning_calls
        (folder / 'model-plan.json').write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding='utf-8')
        (folder / 'social-plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding='utf-8')
        spec = DESTINATIONS[destination]
        progress(f"Guion listo: «{plan['title']}», {len(plan['shots'])} planos. Grabo mi voz.")

        # ---- voice, then timing on the voice
        voices = []
        for shot in plan['shots']:
            require()
            if cancelled.is_set():
                raise ValueError('Creación cancelada.')
            if not shot['narration']:
                voices.append(None)
                continue
            wav, words, fresh = self.voice(shot['narration'], VOICE_SPEED, self.voice_cache, cancelled=cancelled, language=plan['language'])
            report['voice_requests' if fresh else 'voice_reused'] += 1
            first, last = audio.speech_bounds(wav)
            last = max(last, max(w['end'] for w in words))
            voices.append({'path': str(wav), 'words': words, 'first': min(first, words[0]['start']), 'last': last})
        timing, total = shot_timing(plan, voices)
        low, high = spec['seconds']
        if not low <= total <= high + 2:
            raise ValueError(f'Con la voz real el video dura {total:.1f} s y {spec["label"]} admite {low}–{high} s.')
        words = []
        for i, v in enumerate(voices):
            if not v:
                continue
            offset = timing[i]['voice_at'] - v['first']
            v['offset'] = offset
            words += [{'w': w['word'], 'start': w['start'] + offset, 'end': w['end'] + offset, 'shot': i} for w in v['words']]
        portrait = spec['format'] == 'portrait'
        from .social_copy import written_sites, written_words
        sites = {brand['site']: brand.get('spoken_site', [])} if brand else {}
        shown = written_words(written_sites(words, sites))  # subtitles show «vetsa.es», the voice says «vetsa punto es»
        captions = group_captions(shown, portrait)
        data = {'plan': plan, 'timing': timing, 'total': total, 'fps': FPS, 'size': list(spec['size']), 'safe': spec['safe'],
                'words': [{'start': round(w['start'], 3), 'end': round(w['end'], 3), 'shot': w['shot']} for w in words],
                'captions': captions, 'cover': False}
        if brand:
            data['brand'] = self._stage_brand(folder, brand)
        self._write_project(folder, data)
        progress('Compongo las ilustraciones y el ritmo de cada plano')

        # ---- effects from the runtime, original score, mix
        cues_file = folder / 'sfx-cues.json'
        self._run([self.node, str(RENDER), str(folder), 'cues', str(cues_file)], 180)
        cues = json.loads(cues_file.read_text(encoding='utf-8'))['sfx']
        cuts = [t['start'] for t in timing[1:]]
        end_start = timing[-1]['start']
        progress('Compongo la música y los efectos')
        music = audio.score(total, plan['music']['bpm'], plan['music']['mood'], cuts, end_start,
                            seed=int(hashlib.sha256(identifier.encode()).hexdigest()[:8], 16))
        fx = audio.effects(total, cues)
        audio.write_wav(folder / 'assets/music.wav', music)
        audio.write_wav(folder / 'assets/sfx.wav', fx)
        mixed = folder / 'assets/mix.wav'
        voice_tracks = [(v['path'], v['offset']) for v in voices if v]
        mix_stats = audio.mix(total, music, fx, voice_tracks, mixed, loudness=spec['loudness'], ffmpeg=self.ffmpeg)

        result = {'title': plan['title'], 'destination': destination, 'project_path': str(folder / 'index.html'),
                  'evidence_folder': str(folder), 'duration': total, 'width': spec['size'][0], 'height': spec['size'][1], 'fps': FPS,
                  'shots': len(plan['shots']), 'sfx_cues': len(cues), 'verified': False, 'review_required': True,
                  'visual_quality_certified': False, 'arbitrary_code_executed': False, 'publishes_automatically': False}
        if not render:
            report.update(result)
            (folder / 'delivery.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            return {**result, 'message': 'Proyecto, voz y mezcla listos; falta exportar el MP4.'}

        # ---- render, mux, stills, cover
        progress('Renderizo el video fotograma a fotograma')
        silent = folder / 'video-silent.mp4'
        stats = json.loads(self._run([self.node, str(RENDER), str(folder), 'video', str(silent), '--workers', str(workers)], 7200).strip().splitlines()[-1])
        output = folder / 'Brivany.mp4'
        self._run([self.ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', str(silent), '-i', str(mixed),
                   '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
                   '-shortest', '-movflags', '+faststart', str(output)], 600)
        silent.unlink()
        mids = [round(t['start'] + t['duration'] * .62, 2) for t in timing]
        self._run([self.node, str(RENDER), str(folder), 'stills', str(folder / 'review'), ','.join(map(str, mids))], 600)
        cover_index = next(i for i, s in enumerate(plan['shots']) if s['id'] == plan['publish']['cover_shot'])
        ct = timing[cover_index]
        cover_t = round(ct['start'] + min(ct['duration'] - .1, max(1.6, ct['duration'] * .7)), 2)
        self._run([self.node, str(RENDER), str(folder), 'stills', str(folder / 'cover'), str(cover_t), '--cover'], 300)
        cover_src = next((folder / 'cover').glob('*.jpg'))
        shutil.copyfile(cover_src, folder / 'Portada.jpg')
        if destination == 'youtube':  # YouTube thumbnail size
            self._run([self.ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(folder / 'Portada.jpg'), '-vf', 'scale=1280:720:flags=lanczos',
                       '-q:v', '2', str(folder / 'Miniatura-YouTube.jpg')], 60)

        # ---- automatic review: layout at every shot and caption, sync, voice over music
        progress('Reviso el video: zonas seguras, legibilidad, sincronía y voz sobre la música')
        times = sorted({round(t['start'] + t['duration'] * f, 2) for t in timing for f in (.35, .85)}
                       | {round((c['start'] + c['end']) / 2, 2) for c in captions})
        self._run([self.node, str(RENDER), str(folder), 'audit', str(folder / 'audit.json'), ','.join(map(str, times))], 900)
        audit = json.loads((folder / 'audit.json').read_text(encoding='utf-8'))
        settled = {round(t['start'] + t['duration'] * .85, 2) for t in timing}
        hook_frames = json.loads(self._run([self.node, str(RENDER), str(folder), 'stills', str(folder / 'hook'), '0.05,0.9'], 300).strip().splitlines()[-1])
        hook_audit = next((f for f in audit if f['t'] >= timing[0]['start'] + timing[0]['duration'] * .35 - .01), None)
        hook_visual = max((i['w'] for i in (hook_audit or {}).get('items', []) if i['role'] == 'visual'), default=0)
        hook_findings, hook_motion = review_hook(hook_frames[0], hook_frames[1], hook_visual / (spec['size'][0] if portrait else spec['size'][0] * .5))
        srt_text = srt(group_captions(shown, False, max_words=8, max_chars=42))
        from .social_copy import spoken_form_issues
        spoken = [{'level': 'block', 'kind': 'spoken_form_on_screen', 'where': f"{frame['t']:.2f} s · {item['role']}", 'detail': form}
                  for frame in audit for item in frame['items'] for form in spoken_form_issues(item['text'])]
        spoken += [{'level': 'block', 'kind': 'spoken_form_in_srt', 'detail': form} for form in spoken_form_issues(srt_text)]
        findings = spoken + (review_layout(destination, spec['size'], audit) + review_composition(destination, spec['size'], audit, settled)
                    + hook_findings + review_timing({**data, 'words': shown}, voices) + review_mix(mix_stats.get('speech_to_bed')))
        review = {'checked_times': len(times), 'speech_to_bed': mix_stats.get('speech_to_bed'), 'hook_motion': hook_motion,
                  'hook_visual_px': hook_visual, 'findings': findings,
                  'blocking': sum(f['level'] == 'block' for f in findings)}
        (folder / 'review.json').write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding='utf-8')
        if review['blocking']:
            first = next(f for f in findings if f['level'] == 'block')
            raise ValueError(f"La revisión automática encontró {review['blocking']} problemas (p. ej. {first['kind']} en {first.get('where', '')}); "
                             'no se entrega. Detalle en review.json.')

        # ---- verification
        probe = json.loads(self._run([self.ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)], 60))
        video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
        has_audio = any(s['codec_type'] == 'audio' for s in probe['streams'])
        a, b = map(int, video['r_frame_rate'].split('/'))
        avg_a, avg_b = map(int, video['avg_frame_rate'].split('/'))
        duration = float(probe['format']['duration'])
        if (video['width'], video['height']) != tuple(spec['size']) or a / b != FPS or abs(avg_a / avg_b - FPS) > .02 or abs(duration - total) > .12 or not has_audio:
            raise ValueError('El MP4 no coincide con el proyecto (tamaño, cadencia, duración o audio).')
        self._run([self.ffmpeg, '-nostdin', '-v', 'error', '-i', str(output), '-f', 'null', '-'], 900)
        loud = audio.measure(output, self.ffmpeg)

        (folder / 'Subtitulos.srt').write_text(srt_text, encoding='utf-8')
        (folder / 'Texto-para-publicar.md').write_text(self._post_text(plan, timing, voices, brand), encoding='utf-8')
        result.update({'path': str(output), 'cover_path': str(folder / 'Portada.jpg'), 'srt_path': str(folder / 'Subtitulos.srt'),
                       'post_text_path': str(folder / 'Texto-para-publicar.md'), 'review_frames': sorted(str(p) for p in (folder / 'review').glob('*.jpg')),
                       'bytes': output.stat().st_size, 'measured_duration': round(duration, 3), 'loudness': loud,
                       'render': stats, 'review': {k: review[k] for k in ('checked_times', 'speech_to_bed', 'blocking')},
                       'warnings': [f for f in findings if f['level'] == 'warn'][:20], 'verified': True, 'elapsed_seconds': round(time.monotonic() - began, 1),
                       'message': 'He creado el video; revisa la imagen, el sonido y el texto antes de publicarlo.'})
        report.update(result)
        (folder / 'delivery.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if export_to:
            result['export_folder'] = str(self.export(folder, Path(export_to), replace=replace_export))
        return {**result, 'report': report}

    def _write_project(self, folder, data):
        runtime = folder / 'assets/brivany-runtime'
        runtime.mkdir(parents=True)
        for name in ('gsap.min.js', 'social-runtime.js', 'NOTICE.md'):
            shutil.copyfile(ASSETS / name, runtime / name)
        copy_fonts(runtime)
        (folder / 'social.json').write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
        payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
        w, h = data['size']
        title = data['plan']['title'].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        html = f'''<!doctype html>
<html lang="es" data-resolution="{'portrait' if h > w else 'landscape'}">
<head><meta charset="utf-8"><meta name="viewport" content="width={w},height={h}"><title>{title}</title>
<script src="assets/brivany-runtime/gsap.min.js"></script><script src="assets/brivany-runtime/social-runtime.js"></script></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="{data['total']}" data-width="{w}" data-height="{h}" data-fps="{data['fps']}">
<audio id="mix" src="assets/mix.wav" data-start="0" data-duration="{data['total']}" data-track-index="9" data-volume="1"></audio></div>
<script>window.SOCIAL={payload};if(location.hash==='#cover')window.SOCIAL.cover=true;
window.__loadSocial().then(()=>window.__buildSocial());</script>
</body></html>'''
        (folder / 'index.html').write_text(html, encoding='utf-8')

    def _stage_brand(self, folder, brand):
        """Copy the client's logo and fonts (with licences) into the project; return runtime data."""
        src, dst = Path(brand['folder']), folder / 'assets/brand'
        dst.mkdir(parents=True)
        files = {brand['logo'], brand['logo_light']}
        for role in ('head', 'body'):
            files |= set(brand['fonts'][role]['files'].values())
            files.add(brand['fonts'][role]['license'])
        for name in files:
            shutil.copyfile(src / name, dst / name)
        url = lambda name: 'assets/brand/' + name
        fonts = {'head': {'normal': url(brand['fonts']['head']['files']['normal']), 'italic': url(brand['fonts']['head']['files'].get('italic', brand['fonts']['head']['files']['normal']))},
                 'body': {'normal': url(brand['fonts']['body']['files']['normal'])}}
        return {'name': brand['name'], 'site': brand['site'], 'logo': url(brand['logo']), 'logo_light': url(brand['logo_light']),
                'fonts': fonts, 'themes': brand['themes'], 'ui': brand['ui'], 'colors': brand['colors']}

    def _post_text(self, plan, timing, voices, brand=None):
        spec = DESTINATIONS[plan['destination']]
        es = lambda x: f'{x:.1f}'.replace('.', ',')
        lines = [f"# {plan['title']}", '', f"{spec['label']} · {spec['size'][0]}×{spec['size'][1]} · {es(timing[-1]['start'] + timing[-1]['duration'])} s · creado por Melodi", '',
                 '## Texto para publicar', '', plan['publish']['caption'], '', ' '.join(plan['publish']['hashtags']), '',
                 f"Título de portada: **{plan['publish']['cover_title']}**", '',
                 *((['## Capítulos (pegar en la descripción de YouTube)', ''] + [f"{int(a // 60)}:{int(a % 60):02d} {label}" for a, label in chapters(plan, timing)] + [''])
                   if plan['destination'] == 'youtube' and chapters(plan, timing) else []), '## Guion de Melodi', '', '| Inicio | Plano | Locución |', '| --- | --- | --- |']
        for shot, t in zip(plan['shots'], timing):
            lines.append(f"| {es(t['start'])} s | {shot['headline']} | {shot['narration'] or '—'} |")
        lines += ['', '## Notas', '',
                  '- Voz: Melodi (Cartesia, voz española configurada). Música y efectos: pista original sintetizada localmente para esta pieza; sin muestras ni licencias de terceros.',
                  '- Las escenas son ilustraciones de las funciones, no capturas. Los nombres y frases de ejemplo son inventados.',
                  *([f"- Promoción de {brand['name']} ({brand['site']}) con su logo, tipografías ({brand['fonts']['head']['family']} y {brand['fonts']['body']['family']}, licencia OFL) y colores; datos tomados de su web."]
                    if brand else ['- Brivany forma parte del ecosistema Vetsa AI (https://vetsa.es).']),
                  '- Tipografía base: Brivany Editorial, derivada de Lato; SIL OFL 1.1 en assets/brivany-runtime/LICENSE-AND-ATTRIBUTION.txt.',
                  '- No se ha publicado nada: revisar antes de subir.']
        return '\n'.join(lines) + '\n'

    def export(self, folder, destination, replace=False):
        """Copy the delivery. replace=True only refreshes an earlier export of Melodi's own files."""
        destination.mkdir(parents=True, exist_ok=replace)
        for name in ('Brivany.mp4', 'Portada.jpg', 'Miniatura-YouTube.jpg', 'Subtitulos.srt', 'Texto-para-publicar.md'):
            if (folder / name).is_file():
                shutil.copyfile(folder / name, destination / name)
        return destination

    def close(self):
        pass
