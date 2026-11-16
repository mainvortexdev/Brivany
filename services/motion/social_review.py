"""Automatic review of a rendered social video before delivery.

Checks what a person would check frame by frame: text inside the platform's
safe zones, legible sizes, nothing clipped, captions not covering other text,
voice inside its shot and in sync with captions, the voice clearly above the
music. Returns findings; blocking ones stop delivery so Melodi's capability is
fixed instead of shipping a flawed cut.
"""
from __future__ import annotations

import math

import numpy as np

# Minimum rendered font size (px on the delivered frame) per role.
MIN_FONT = {
    'portrait': {'headline': 56, 'caption': 44, 'body': 34, 'kicker': 30, 'cta': 34, 'kit': 26, 'brand': 0, 'other': 26},
    'landscape': {'headline': 56, 'caption': 36, 'body': 28, 'kicker': 24, 'cta': 28, 'kit': 22, 'brand': 0, 'other': 22},
}
# Platform overlays: reels/TikTok and stories cover the edges with interface.
PLATFORM_SAFE = {
    'instagram_story': {'top': 250, 'bottom': 340, 'left': 90, 'right': 90},
    'reel': {'top': 220, 'bottom': 470, 'left': 90, 'right': 160},   # union of Instagram Reels and TikTok overlays
    'short': {'top': 220, 'bottom': 470, 'left': 90, 'right': 160},   # Reels, TikTok and YouTube Shorts
    'youtube': {'top': 54, 'bottom': 70, 'left': 64, 'right': 64},     # title-safe 5 % and progress bar
}


def _overlap(a, b):
    return max(0, min(a['x'] + a['w'], b['x'] + b['w']) - max(a['x'], b['x'])) * max(0, min(a['y'] + a['h'], b['y'] + b['h']) - max(a['y'], b['y']))


def review_composition(destination, size, audit, settled):
    """Full-height composition: no big empty bands and a wide protagonist illustration.

    `settled` are the audit times where a shot is fully built (85 % of the shot).
    """
    width, height = size
    safe = PLATFORM_SAFE[destination]
    portrait = height > width
    # the caption band above the platform's bottom overlay is reserved even between phrases
    top, bottom = safe['top'], height - safe['bottom'] - (140 if portrait else 110)
    usable = width - safe['left'] - safe['right']
    findings = []
    for frame in audit:
        built = round(frame['t'], 2) in settled
        items = [i for i in frame['items'] if i['role'] != 'brand']
        spans = sorted((max(top, i['y']), min(bottom, i['y'] + i['h'])) for i in items if i['y'] + i['h'] > top and i['y'] < bottom)
        gap, cursor = 0, top
        for a, b in spans:
            gap = max(gap, a - cursor)
            cursor = max(cursor, b)
        gap = max(gap, bottom - cursor)
        if gap > (.16 if portrait else .24) * (bottom - top):
            findings.append({'level': 'block', 'kind': 'empty_band', 'where': f"{frame['t']:.2f} s",
                             'detail': f'franja vacía de {gap} px ({gap / (bottom - top):.0%} del alto útil)'})
        visuals = [i for i in items if i['role'] == 'visual']
        if visuals and built:
            widest = max(v['w'] for v in visuals)
            share = widest / width if portrait else widest / (width * .5)
            if share < .70 and not (portrait and widest / usable >= .85):
                findings.append({'level': 'block', 'kind': 'small_illustration', 'where': f"{frame['t']:.2f} s",
                                 'detail': f'ilustración de {widest} px ({widest / width:.0%} del ancho)'})
    return findings


def review_hook(first, later, visual_share):
    """The first second must move and show a big image (scroll-stopping)."""
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(first).convert('L').resize((270, 480)), dtype=float)
    b = np.asarray(Image.open(later).convert('L').resize((270, 480)), dtype=float)
    changed = float((np.abs(a - b) > 14).mean())
    findings = []
    if changed < .12:
        findings.append({'level': 'block', 'kind': 'static_hook', 'detail': f'solo cambia el {changed:.0%} de la imagen en el primer segundo'})
    if visual_share is not None and visual_share < .6:
        findings.append({'level': 'block', 'kind': 'weak_hook_image', 'detail': f'la ilustración del gancho ocupa {visual_share:.0%} del ancho'})
    return findings, round(changed, 3)


def review_layout(destination, size, audit):
    width, height = size
    orientation = 'portrait' if height > width else 'landscape'
    safe = PLATFORM_SAFE[destination]
    findings = []
    for frame in audit:
        items = frame['items']
        for item in items:
            where = f"{frame['t']:.2f} s · {item['role']} «{item['text'][:40]}»"
            if item['role'] in {'brand', 'visual'}:
                continue
            if item['clipped']:
                findings.append({'level': 'block', 'kind': 'clipped_text', 'where': where})
            minimum = MIN_FONT[orientation].get(item['role'], 24)
            if item['font'] is not None and item['font'] < minimum - .5:  # SVG text (wordmark) has no CSS box
                findings.append({'level': 'block' if item['role'] != 'kit' else 'warn', 'kind': 'small_text',
                                 'where': where, 'detail': f"{item['font']} px < {minimum} px"})
            outside = (item['y'] < safe['top'] - 2 or item['y'] + item['h'] > height - safe['bottom'] + 2
                       or item['x'] < safe['left'] - 2 or item['x'] + item['w'] > width - safe['right'] + 2)
            if outside:
                findings.append({'level': 'block', 'kind': 'outside_safe_zone', 'where': where,
                                 'detail': f"caja {item['x']},{item['y']} {item['w']}×{item['h']}"})
        captions = [i for i in items if i['role'] == 'caption']
        for cap in captions:
            for other in items:
                if other['role'] in {'caption', 'brand', 'visual'}:
                    continue
                area = _overlap(cap, other)
                if area > .15 * min(cap['w'] * cap['h'], other['w'] * other['h']):
                    findings.append({'level': 'block' if other['role'] != 'kit' else 'warn', 'kind': 'caption_covers_text',
                                     'where': f"{frame['t']:.2f} s · «{other['text'][:40]}»"})
    return findings


def review_timing(data, voices):
    """Voice inside its shot with margins; captions follow the spoken words."""
    findings = []
    for i, (t, v) in enumerate(zip(data['timing'], voices)):
        if not v:
            continue
        start = v['offset'] + v['first']
        end = v['offset'] + v['last']
        if start < t['start'] + .15:
            findings.append({'level': 'block', 'kind': 'voice_before_cut', 'where': f'plano {i + 1}'})
        if end > t['start'] + t['duration'] - .3:
            findings.append({'level': 'block', 'kind': 'voice_runs_into_next_shot', 'where': f'plano {i + 1}',
                             'detail': f'acaba {end:.2f} s, corte {t["start"] + t["duration"]:.2f} s'})
    words = data['words']
    for cue in data['captions']:
        if cue['end'] - cue['start'] < .5:
            findings.append({'level': 'warn', 'kind': 'caption_too_brief', 'where': f"{cue['start']:.2f} s"})
        chars = sum(len(w['w']) + 1 for w in cue['words'])
        if chars / max(.1, cue['end'] - cue['start']) > 25:
            findings.append({'level': 'warn', 'kind': 'caption_reading_speed', 'where': f"{cue['start']:.2f} s"})
    spoken = sum(1 for _ in words)
    shown = sum(len(c['words']) for c in data['captions'])
    if spoken != shown:
        findings.append({'level': 'block', 'kind': 'captions_missing_words', 'detail': f'{shown}/{spoken}'})
    return findings


def speech_to_bed(voice, bed, sr, hop=.05):
    """Median dB of voice over music+effects in windows where Melodi speaks."""
    n = int(hop * sr)
    frames = min(len(voice), len(bed)) // n
    v = np.sqrt(np.mean(voice[: frames * n].reshape(frames, n) ** 2, axis=1) + 1e-12)
    b = np.sqrt(np.mean(bed[: frames * n].reshape(frames, -1) ** 2, axis=1) + 1e-12)
    active = v > (v.max() * .1)
    if not active.any():
        return None
    ratio = 20 * np.log10(v[active] / b[active])
    return {'median_db': round(float(np.median(ratio)), 1), 'p10_db': round(float(np.percentile(ratio, 10)), 1)}


def review_mix(stats):
    findings = []
    if stats and stats['median_db'] < 15:
        findings.append({'level': 'block', 'kind': 'music_masks_voice', 'detail': f"voz sobre música {stats['median_db']} dB (mediana)"})
    if stats and stats['p10_db'] < 6:
        findings.append({'level': 'warn', 'kind': 'music_close_to_voice', 'detail': f"percentil 10: {stats['p10_db']} dB"})
    return findings


def word_accuracy(expected, heard):
    """1 − WER between the script and an independent transcript of the final mix."""
    import re
    import unicodedata
    def plain(text):
        text = text.lower().replace(chr(241), '~')
        text = ''.join(c for c in unicodedata.normalize('NFD', text) if unicodedata.category(c) != 'Mn')
        return text.replace('~', chr(241))
    norm = lambda text: re.findall('[a-z' + chr(241) + '0-9]+', plain(text))
    a, b = norm(expected), norm(heard)
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return round(1 - d[len(b)] / max(1, len(a)), 3)
