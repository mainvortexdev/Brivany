"""Trusted editable HyperFrames renderer for a finite, model-authored story.

Only validated data selects layout, copy and bounded animation primitives.
The model never supplies executable HTML/JS, remote runtime resources or SVG.
"""
from html import escape
import json
import math
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit, urlunsplit

from .story_contract import canvas_size, validate_story
from services.brand import font_css,copy_fonts


ASSETS = Path(__file__).resolve().parent / 'assets'
_MOVIES = {'.mp4', '.webm', '.mov', '.mkv', '.m4v'}
_IMAGES = {'.png', '.jpg', '.jpeg', '.webp', '.avif'}
_AUDIO = {'.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac'}
_EMAIL = re.compile(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)*", re.I)


def _literal(value, limit=700):
    if not isinstance(value, str):
        return ''
    return _EMAIL.sub('[correo oculto]', value.replace('\x00', ''))[:limit]


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).replace(
        '<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')


def _path(value, *, directory=False):
    if not isinstance(value, (str, Path)):
        raise ValueError('El medio necesita un archivo local comprobado.')
    result = Path(value).absolute()
    for item in (result, *result.parents):
        if item.is_symlink() or getattr(item, 'is_junction', lambda: False)():
            raise ValueError('Los recursos de video no admiten enlaces o junctions.')
    if result.resolve() != result or not (result.is_dir() if directory else result.is_file()):
        raise ValueError('El recurso debe usar una ruta canónica existente.')
    if not directory and result.stat().st_size > 1024 ** 3:
        raise ValueError('Un recurso resuelto supera el límite de 1 GiB.')
    return result


def _source(entry, kind):
    if not isinstance(entry, dict):
        raise ValueError('Falta un recurso del plan de video.')
    source = _path(entry.get('path'))
    allowed = _MOVIES if kind == 'film' else _IMAGES if kind == 'image' else _AUDIO
    if source.suffix.lower() not in allowed:
        raise ValueError('El formato del recurso no coincide con el elemento.')
    return source


def _time(value, *, minimum=0):
    if type(value) not in (int, float) or not math.isfinite(value) or value < minimum:
        raise ValueError('Tiempo del recurso no válido.')
    return float(value)


def _web(value):
    if not isinstance(value, str):
        return ''
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.username or parsed.password:
            return ''
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', ''))[:1000]
    except ValueError:
        return ''


def _credit(entry):
    # Public attribution only: never file paths, account names or query tokens.
    title = _literal(entry.get('title') or entry.get('name'), 160)
    attribution = _literal(entry.get('attribution') or entry.get('credit') or entry.get('copyright'), 350)
    license_name = _literal(entry.get('license'), 100)
    if not (title or attribution or license_name):
        return None
    return {'title': title, 'attribution': attribution, 'license': license_name,
            'source_url': _web(entry.get('source_url') or entry.get('source_page')), 'license_url': _web(entry.get('license_url')),
            'changes': _literal(entry.get('changes') if isinstance(entry.get('changes'), str)
                                else ', '.join(str(v) for v in (entry.get('changes') or [])[:8]), 300)}


def _svg(name, prefix):
    if name == 'wave':
        bars = ''.join(f'<rect class="wave-bar" x="{18 + i * 12}" y="{100 - height / 2:g}" width="6" height="{height:g}" rx="3" fill="#0071e3"/>'
                       for i in range(60) for height in [14 + 122 * math.sin(math.pi * (i + .5) / 60) ** 1.2
                                                        * (.25 + .75 * abs(math.sin(i * 1.87)))])
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 756 200" role="img" aria-label="Onda de audio ilustrada">' + bars + '</svg>'
    source = (ASSETS / (name + '.svg')).read_text(encoding='utf-8')
    identifiers = re.findall(r'\bid="([^"\s]+)"', source)
    for old in sorted(identifiers, key=len, reverse=True):
        new = prefix + '-' + old
        source = source.replace('id="' + old + '"', 'id="' + new + '"').replace(
            'url(#' + old + ')', 'url(#' + new + ')').replace('href="#' + old + '"', 'href="#' + new + '"')
    return source


def _entrance(visual, mode, start, duration, index):
    length = min(.32, duration / 3)
    origin = {'opacity': 0}
    target = {'opacity': 1, 'duration': length, 'ease': ['power3.out', 'circ.out', 'expo.out'][index % 3]}
    if mode == 'none':
        if start == 0:
            return ''
        target['duration'] = 0
    elif mode == 'rise':
        origin['y'] = 28
        target['y'] = 0
    elif mode in {'left', 'right'}:
        origin['x'] = -38 if mode == 'left' else 38
        target['x'] = 0
    elif mode == 'scale':
        origin['scale'] = .94
        target['scale'] = 1
    elif mode == 'wipe':
        origin['clipPath'] = 'inset(0% 100% 0% 0%)'
        target['clipPath'] = 'inset(0% 0% 0% 0%)'
    return f'tl.fromTo({_json("#" + visual)},{_json(origin)},{_json(target)},{start:g});'


def _transition(stage, mode, duration):
    if mode == 'cut':
        return ''
    end = min(.34, duration / 3)
    origin = {'opacity': 0}
    target = {'opacity': 1, 'duration': end, 'ease': 'power3.out'}
    if mode == 'slide_up':
        origin['y'] = 50
        target['y'] = 0
    elif mode == 'mask_left':
        origin['clipPath'] = 'inset(0% 100% 0% 0%)'
        target['clipPath'] = 'inset(0% 0% 0% 0%)'
    elif mode == 'zoom':
        origin['scale'] = 1.035
        target['scale'] = 1
    return f'tl.fromTo({_json("#" + stage)},{_json(origin)},{_json(target)},0);'


def _write_portable_preview(folder, plan, *, still):
    """A local result viewer, not a second runtime or an HTML-only editor.

    Native controls own audio playback. Relative file paths work when the whole
    project folder is moved, with no fetch of sub-composition templates.
    """
    exports = folder / 'exports'
    exports.mkdir(exist_ok=True)
    title = escape(plan['title'], quote=True)
    if still:
        media = f'<img id="result" src="../Brivany.png" alt="{title}">'
        kind = 'Ilustración exportada'
    else:
        media = '<video id="result" src="../Brivany.mp4" controls playsinline preload="metadata">Tu navegador necesita soporte MP4.</video>'
        kind = 'Video exportado'
    page = '''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>''' + title + '''</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#fbfcfd;color:#1d1d1f;font:14px/1.4 "Brivany Editorial",sans-serif}header{display:flex;align-items:center;gap:20px;max-width:1280px;margin:auto;padding:22px 28px}header img{width:126px;height:auto}h1{font-size:16px;line-height:1.3;font-weight:600;margin:0;flex:1}a{color:#0071e3;text-decoration:none}a:hover{text-decoration:underline}main{display:flex;justify-content:center;align-items:center;min-height:60vh;padding:0 20px}#result{display:block;max-width:100%;max-height:80vh;border-radius:16px;background:#080b11;box-shadow:0 12px 35px #23395014}footer{max-width:1280px;margin:auto;padding:18px 28px;color:#526579;font-size:12px}@media(max-width:520px){header{padding:18px;gap:12px;flex-wrap:wrap}header img{width:110px}header a{margin-left:auto}main{padding:0 12px}}</style></head><body><header><img src="../assets/brivany-runtime/wordmark.svg" alt="brivany."><h1>''' + title + '''</h1><a href="../README.md">Proyecto editable</a></header><main>''' + media + '''</main><footer>''' + kind + '''. Conserva la carpeta completa para abrir esta vista. La composición editable de HyperFrames está en index.html.</footer></body></html>'''
    page=page.replace('<style>','<style>'+font_css('../assets/brivany-runtime/'))
    destination = exports / 'Brivany-animation.html'
    with destination.open('x', encoding='utf-8') as output:
        output.write(page)
    instructions = '''# Proyecto de video de Melodi

La vista `exports/Brivany-animation.html` reproduce el archivo exportado mediante
los controles nativos del navegador. No inicia audio automáticamente ni carga
escenas por `fetch`. Conserva toda la carpeta: la vista referencia `Brivany.mp4`
o `Brivany.png` y el wordmark local mediante rutas relativas.

La vista no es un editor HTML autocontenido. El proyecto editable está formado
por `index.html`, `story.json`, `compositions/`, `story.css` y `assets/`. Se abre
en HyperFrames desde esta carpeta:

```powershell
npx hyperframes preview --background
```

Los textos, capas, posiciones y tiempos están en `story.json` y las composiciones.
La creación de una revisión desde Melodi conserva el proyecto anterior.
`CREDITS.md` contiene las atribuciones completas de los recursos utilizados.
'''
    with (folder / 'README.md').open('x', encoding='utf-8') as output:
        output.write(instructions)
    return destination


def write_story_project(folder, plan, *, media, voice_segments=(), music=None, reference=None, still=False,voice_activity=()):
    """Write one new project; each resolved movie already starts at its trim.

    media['scene-id:element-index'] takes precedence over media[asset_id].
    Voice times are root-timeline times. Music is already source-trimmed; optional
    timeline_start/duration place it without applying plan.music.start twice.
    """
    plan = validate_story(plan)
    if type(still) is not bool:
        raise ValueError('La vista de ilustración necesita un booleano explícito.')
    folder = _path(folder, directory=True)
    if not isinstance(media, dict):
        raise ValueError('El catálogo resuelto no es válido.')
    if any((folder / name).exists() for name in ('index.html', 'story.json', 'CREDITS.md', 'story.css', 'README.md', 'exports/Brivany-animation.html')):
        raise FileExistsError('El proyecto ya existe; crea una revisión en otra carpeta.')
    width, height = canvas_size(plan['format'])
    call=plan.get('presentation')=='call'
    narrative_end = sum(scene['duration'] for scene in plan['scenes'])
    bindings = {}
    credits = []
    for scene in plan['scenes']:
        for index, element in enumerate(scene['elements']):
            if element['type'] in {'film', 'image'}:
                key = scene['id'] + ':' + str(index)
                entry = media[key] if key in media else media.get(element['asset_id'])
                bindings[key] = (_source(entry, element['type']), entry)
                row = _credit(entry)
                if row and row not in credits:
                    credits.append(row)
    voices = []
    for index, entry in enumerate(voice_segments):
        source = _source(entry, 'audio')
        start = _time(entry.get('start'))
        duration = _time(entry.get('duration'), minimum=.001)
        if start + duration > narrative_end + .035:
            raise ValueError('La locución invade los créditos o sale del video.')
        voices.append((source, start, duration))
    if voices and not plan['voice']:
        raise ValueError('El plan no solicita voz, pero recibió una locución.')
    music_binding = None
    if music is not None:
        source = _source(music, 'audio')
        start = _time(music.get('timeline_start', 0))
        duration = _time(music.get('duration', plan['duration'] - start), minimum=.001)
        if start + duration > plan['duration'] + .035:
            raise ValueError('La música sale de la duración del video.')
        music_binding = (source, start, duration)
        row = _credit(music)
        if row and row not in credits:
            credits.append(row)
    if len(credits) > 8:
        raise ValueError('La placa necesita menos fuentes distintas o una entrega de créditos más amplia.')

    assets = folder / 'assets'
    assets.mkdir(exist_ok=True)
    runtime = assets / 'brivany-runtime'
    runtime.mkdir(exist_ok=False)
    for name in ('gsap.min.js', 'wordmark.svg', 'NOTICE.md'):
        shutil.copyfile(ASSETS / name, runtime / name)
    copy_fonts(runtime)
    compositions = folder / 'compositions'
    compositions.mkdir(exist_ok=True)
    copied = {}
    resources = []

    def stage(source):
        source = Path(source)
        if source in copied:
            return copied[source]
        name = 'story-media-' + str(len(copied)).zfill(3) + source.suffix.lower()
        target = assets / name
        with source.open('rb') as original, target.open('xb') as dest:
            shutil.copyfileobj(original, dest)
        relative = 'assets/' + name
        copied[source] = relative
        resources.append({'file': relative, 'bytes': target.stat().st_size})
        return relative

    styles = font_css('assets/brivany-runtime/',family='Brivany',display='block') + '''*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fbfcfd}#story-main{width:100%;height:100%;position:relative;overflow:hidden;font-family:Brivany,sans-serif;color:#1d1d1f}.story-slot{position:absolute;inset:0;width:100%;height:100%}.story-element{position:absolute;overflow:hidden}.story-visual,.story-art-motion{width:100%;height:100%;position:relative;transform-origin:center}.story-visual>svg{display:block;width:100%;height:100%}.story-art-motion>svg{display:block;width:100%;height:100%}.story-text{margin:0;white-space:pre-line;overflow-wrap:anywhere;max-width:100%;width:100%;font-family:inherit}.story-media{display:block;width:100%;height:100%}.story-credit-row p{margin:0}.story-credit-row{min-width:0}.story-credit-notes{color:#526579}'''
    (folder / 'story.css').write_text(styles, encoding='utf-8')
    hosts = []
    start = 0
    for scene_index, scene in enumerate(plan['scenes']):
        identifier = 'scene-' + scene['id']
        stage_id = identifier + '-stage'
        markup = []
        animations = ['' if call else _transition(stage_id, scene['transition'], scene['duration'])]
        if call:
            from .call_visuals import scene_visuals
            visual,motion=scene_visuals(identifier,plan,scene,width,height,next((s for s in voice_activity if s['scene_id']==scene['id']),None),(reference or {}).get('call_layout'),timeline_start=start,voice_activity=voice_activity)
            markup.append(visual);animations.append(motion)
        for index, element in enumerate(scene['elements']):
            eid = identifier + '-element-' + str(index)
            visual = eid + '-visual'
            begins = element.get('start', 0)
            ends = element.get('end', scene['duration'])
            life = ends - begins
            kind = element['type']
            bounds = ';'.join(key + ':' + str(element[field]) + '%' for key, field in
                              [('left', 'x'), ('top', 'y'), ('width', 'w'), ('height', 'h')])
            timed = '' if kind == 'film' else f' data-start="{begins:g}" data-duration="{life:g}" data-track-index="{index}" data-track-kind="graphics"'
            classes = 'story-element' if kind == 'film' else 'story-element clip'
            if kind == 'text':
                font = element['font_size'] * width / 1080
                line_height = 1.08 if element['font_size'] >= 54 else 1.22
                content = f'<p class="story-text" style="font-size:{font:g}px;line-height:{line_height:g};font-weight:{element["weight"]};color:{element["color"]};text-align:{element["align"]};letter-spacing:-.025em">{escape(element["text"])}</p>'
            elif kind in {'film', 'image'}:
                source, entry = bindings[scene['id'] + ':' + str(index)]
                url = stage(source)
                radius = 0 if element['w'] >= 95 and element['h'] >= 95 else min(32, width * .026)
                if kind == 'film':
                    content = f'<video id="{eid}-movie" class="story-media clip" src="{url}" muted playsinline preload="metadata" data-start="{begins:g}" data-hf-media-start-basis="local" data-duration="{life:g}" data-track-index="{index}" style="object-fit:{element["fit"]};object-position:{element["position"]}% center;border-radius:{radius:g}px"></video>'
                else:
                    content = f'<img class="story-media" src="{url}" alt="" style="object-fit:{element["fit"]};border-radius:{radius:g}px">'
            elif kind == 'illustration':
                content = f'<div id="{eid}-art" class="story-art-motion">{_svg(element["name"], eid)}</div>'
                if element['name'] == 'wave':
                    cycles = max(0, math.floor(max(0, life - .4) / .4) - 1)
                    animations.append(f'tl.fromTo({_json("#" + eid + "-art .wave-bar")},{{scaleY:.38,transformOrigin:"center"}},{{scaleY:1,duration:.4,repeat:{cycles},yoyo:true,stagger:{{each:.005,from:"center"}},ease:"sine.inOut"}},{begins + .18:g});')
                elif life >= 2.5:
                    cycles = max(0, math.floor(life - .4) - 1)
                    animations.append(f'tl.fromTo({_json("#" + eid + "-art")},{{y:3}},{{y:-3,duration:1,repeat:{cycles},yoyo:true,ease:"sine.inOut"}},{begins + .35:g});')
            else:
                fill, stroke, stroke_width = element['fill'], element['stroke'], element['stroke_width']
                shape = element['shape']
                geometry = '<rect x="1" y="1" width="98" height="98" rx="5"/>' if shape == 'rect' else '<ellipse cx="50" cy="50" rx="49" ry="49"/>' if shape == 'ellipse' else '<path d="M1 50H99"/>' if shape == 'line' else '<path d="' + escape(element.get('d', ''), quote=True) + '"/>'
                content = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" fill="{fill}" stroke="{stroke}" stroke-width="{stroke_width:g}">{geometry}</svg>'
            markup.append(f'<div id="{eid}" class="{classes}"{timed} style="{bounds}"><div id="{visual}" class="story-visual">{content}</div></div>')
            mode = element.get('enter', 'none' if kind in {'film', 'shape'} else 'rise')
            animations.append(_entrance(visual, mode, begins, life, index))
            exit_mode = element.get('exit', 'none')
            if exit_mode != 'none':
                exit_duration = min(.2, life / 3)
                target = {'opacity': 0, 'duration': exit_duration, 'ease': 'power2.in'}
                if exit_mode == 'rise':
                    target['y'] = -22
                animations.append(f'tl.to({_json("#" + visual)},{_json(target)},{ends - exit_duration:g});')
        background='#000000' if call else scene['background']
        body = f'<!doctype html><html lang="es"><body><template><style>#{identifier}{{position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:{background}}}#{stage_id}{{position:absolute;inset:0;width:100%;height:100%}}</style><div id="{identifier}" data-composition-id="{identifier}" data-width="{width}" data-height="{height}" data-duration="{scene["duration"]:g}"><div id="{stage_id}">{"".join(markup)}</div></div><script>{{const tl=gsap.timeline({{paused:true}});{"".join(animations)}window.__timelines[{_json(identifier)}]=tl;}}</script></template></body></html>'
        (compositions / (identifier + '.html')).write_text(body, encoding='utf-8')
        hosts.append(f'<div id="slot-{identifier}" class="story-slot clip" data-composition-id="{identifier}" data-composition-src="compositions/{identifier}.html" data-width="{width}" data-height="{height}" data-start="{start:g}" data-duration="{scene["duration"]:g}" data-track-index="{scene_index + 1}" data-track-kind="graphics"></div>')
        start += scene['duration']

    # Credit copy is derived from actually used resolved media, never hardcoded ads.
    credit_font = min(36, width / 1080 * 30, max(20, height * .55 / max(1, len(credits)) / 3.2))
    credit_rows = ''.join('<section class="story-credit-row"><p style="font-weight:600">' + escape(row['title'])
                          + '</p><p>' + escape(row['attribution']) + '</p><p class="story-credit-notes">'
                          + escape(row['license']) + '</p></section>' for row in credits)
    if not credit_rows:
        credit_rows = '<p>' + escape(plan['title']) + '</p>'
    credit_html = f'<!doctype html><html lang="es"><body><template><style>#story-credits{{position:absolute;inset:0;width:100%;height:100%;background:#fbfcfd;color:#1d1d1f;overflow:hidden}}#credit-content{{position:absolute;left:10%;right:10%;top:13%;bottom:13%;display:flex;flex-direction:column;justify-content:center;gap:{height * .028:g}px;font-size:{credit_font:g}px;line-height:1.32}}#credit-logo{{width:22%;height:auto;max-height:12%;object-fit:contain;margin-bottom:{height * .022:g}px}}#credit-heading{{font-size:{min(64, width * .06):g}px;font-weight:700;letter-spacing:-.03em;margin:0 0 {height * .01:g}px}}</style><div id="story-credits" data-composition-id="story-credits" data-width="{width}" data-height="{height}" data-duration="{plan["credits_duration"]:g}"><div id="credit-content"><img id="credit-logo" src="assets/brivany-runtime/wordmark.svg" alt="brivany."><h2 id="credit-heading">Créditos</h2>{credit_rows}</div></div><script>{{const tl=gsap.timeline({{paused:true}});tl.fromTo("#credit-content",{{opacity:0,y:16}},{{opacity:1,y:0,duration:.25,ease:"power2.out"}},0);window.__timelines["story-credits"]=tl;}}</script></template></body></html>'
    if call:
        from .call_visuals import scene_visuals
        visual,motion=scene_visuals('story-credits',plan,{},width,height,layout=(reference or {}).get('call_layout'),credits=True,timeline_start=start,voice_activity=voice_activity)
        attribution=''.join('<p>'+escape(row['attribution'])+'</p>' for row in credits)
        credit_html=f'<!doctype html><html lang="es"><body><template><div id="story-credits" data-composition-id="story-credits" data-width="{width}" data-height="{height}" data-duration="{plan["credits_duration"]:g}" style="position:absolute;inset:0;background:#000;overflow:hidden">{visual}<div style="position:absolute;bottom:2%;left:10%;width:80%;text-align:center;color:#777;font-size:{width*.014:g}px">{attribution}</div></div><script>{{const tl=gsap.timeline({{paused:true}});{motion}window.__timelines["story-credits"]=tl;}}</script></template></body></html>'
    if plan['credits_duration']:
        (compositions / 'story-credits.html').write_text(credit_html, encoding='utf-8')
        hosts.append(f'<div id="slot-story-credits" class="story-slot clip" data-composition-id="story-credits" data-composition-src="compositions/story-credits.html" data-width="{width}" data-height="{height}" data-start="{start:g}" data-duration="{plan["credits_duration"]:g}" data-track-index="{len(hosts) + 1}" data-track-kind="graphics"></div>')
    for index, (source, begins, duration) in enumerate(voices):
        hosts.append(f'<audio id="voice-{index}" src="{stage(source)}" data-start="{begins:g}" data-duration="{duration:g}" data-track-index="{len(plan["scenes"]) + 3}" data-volume="1"></audio>')
    if music_binding:
        source, begins, duration = music_binding
        full_mix = music.get('full_mix') is True
        automation = {'version': 1, 'lanes': [{'target': 'volume', 'points': [
            {'t': 0, 'v': 0}, {'t': min(.08, duration / 4), 'v': 1},
            {'t': max(duration / 2, duration - .8), 'v': 1}, {'t': duration, 'v': 0}]}]}
        envelope = '' if full_mix else ' data-automation="' + escape(_json(automation), quote=True) + '"'
        hosts.append(f'<audio id="music-bed" src="{stage(source)}" data-start="{begins:g}" data-duration="{duration:g}" data-track-index="{len(plan["scenes"]) + 4}" data-volume="{1 if full_mix else .22}"{envelope}></audio>')
    root = f'<!doctype html><html lang="es" data-resolution="{plan["format"]}"><head><meta charset="utf-8"><meta name="viewport" content="width={width},height={height}"><title>{escape(plan["title"])}</title><link rel="stylesheet" href="story.css"><script src="assets/brivany-runtime/gsap.min.js"></script></head><body><div id="story-main" data-composition-id="main" data-start="0" data-duration="{plan["duration"]}" data-width="{width}" data-height="{height}" data-fps="{plan["fps"]}">{"".join(hosts)}</div><script>{{const tl=gsap.timeline({{paused:true}});window.__timelines["main"]=tl;}}</script></body></html>'
    credits_md = '# Créditos de medios\n\n' + '\n\n'.join('\n'.join(
        row[key] for key in ('title', 'attribution', 'license', 'source_url', 'license_url', 'changes') if row[key]) for row in credits)
    with (folder / 'CREDITS.md').open('x', encoding='utf-8') as output:
        output.write(credits_md + '\n\nTipografía: Brivany Editorial, derivada de Lato por Łukasz Dziedzic. SIL OFL 1.1; licencia en assets/brivany-runtime/LICENSE-AND-ATTRIBUTION.txt.\n')
    with (folder / 'story.json').open('x', encoding='utf-8') as output:
        output.write(json.dumps(plan, ensure_ascii=False, indent=2))
    (folder / 'media-manifest.json').write_text(json.dumps({'resources': resources, 'credits': credits,
        'reference_analysis_used': bool(reference), 'runtime_network_required': False}, ensure_ascii=False, indent=2), encoding='utf-8')
    (folder / 'hyperframes.json').write_text(json.dumps({'paths': {'blocks': 'compositions', 'components': 'compositions/components', 'assets': 'assets'},
                                                       'media': {'autoProxy': True}}, indent=2), encoding='utf-8')
    with (folder / 'index.html').open('x', encoding='utf-8') as output:
        output.write(root)
    standalone = _write_portable_preview(folder, plan, still=still)
    return {'project_path': str(folder / 'index.html'), 'plan_path': str(folder / 'story.json'),
            'standalone_path': str(standalone), 'standalone_is_editor': False,
            'preview_requires_project_folder': True, 'preview_kind': 'image' if still else 'video',
            'credits_path': str(folder / 'CREDITS.md'), 'evidence_folder': str(folder),
            'width': width, 'height': height, 'fps': plan['fps'], 'duration': plan['duration'],
            'scene_count': len(plan['scenes']), 'resources': resources, 'credits': credits,
            'runtime_network_required': False, 'arbitrary_code_executed': False, 'originals_modified': False}
