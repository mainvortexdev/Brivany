"""Original score, sound effects, Melodi's timed voice and the final mix.

Everything except the voice is synthesized locally with numpy/scipy: no samples,
catalogs or third-party recordings, so no licence or attribution is needed.
The voice is Melodi's configured Cartesia voice with provider word timestamps.
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import subprocess
import time
import wave
from pathlib import Path
from uuid import uuid4

import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
NOTES = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
# Chord progressions as (root, quality) per bar; one bar = four beats.
PROGRESSIONS = {
    'pulse': [('A', 'm'), ('F', 'M'), ('C', 'M'), ('G', 'M')],
    'bright': [('C', 'M'), ('G', 'M'), ('A', 'm'), ('F', 'M')],
    'calm': [('F', 'M7'), ('C', 'M'), ('D', 'm7'), ('C', 'M')],
    'cinematic': [('A', 'm'), ('F', 'M'), ('D', 'm'), ('E', 'M')],
}
QUALITIES = {'M': (0, 4, 7), 'm': (0, 3, 7), 'M7': (0, 4, 7, 11), 'm7': (0, 3, 7, 10)}


def freq(name, octave):
    return 440.0 * 2 ** ((NOTES[name] + 12 * (octave + 1) - 69) / 12)


class Track:
    def __init__(self, seconds, seed):
        self.n = int(math.ceil(seconds * SR))
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)
        self.rng = np.random.default_rng(seed)

    def put(self, sig, at, gain=1.0, pan=0.0):
        start = int(round(at * SR))
        if start >= self.n or start + len(sig) <= 0:
            return
        if start < 0:
            sig, start = sig[-start:], 0
        sig = sig[: self.n - start] * gain
        self.L[start:start + len(sig)] += sig * math.sqrt(.5 * (1 - pan))
        self.R[start:start + len(sig)] += sig * math.sqrt(.5 * (1 + pan))

    def noise(self, dur, low, high, order=2):
        sig = self.rng.standard_normal(int(dur * SR))
        return sosfilt(butter(order, [low, min(high, SR / 2 - 100)], btype='band', fs=SR, output='sos'), sig)

    def stereo(self):
        return np.stack([self.L, self.R], axis=1)


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def tone(f, dur, decay, harmonics=(1.0,), attack=.004):
    t = np.arange(int(dur * SR)) / SR
    sig = sum(a * np.sin(2 * np.pi * f * (k + 1) * t) for k, a in enumerate(harmonics))
    return sig * env(len(t), attack, decay)


def bell(f, dur=.8, decay=.25):
    t = np.arange(int(dur * SR)) / SR
    sig = np.sin(2 * np.pi * f * t) + .4 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t / .08) + .18 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / .05)
    return sig * env(len(t), .002, decay)


def kick(strength=1.0):
    t = np.arange(int(.34 * SR)) / SR
    f = 46 + 92 * np.exp(-t / .035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .13) * strength


def saw(f, dur, cutoff, decay=.25, attack=.005):
    t = np.arange(int(dur * SR)) / SR
    sig = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 12) if f * k < cutoff * 2)
    return sig * env(len(t), attack, decay)


def pad(freqs, dur, cutoff=1400, attack=.35):
    t = np.arange(int(dur * SR)) / SR
    sig = np.zeros(len(t))
    for f in freqs:
        for det in (-.006, 0, .006):
            for k in range(1, 7):
                if f * k < cutoff:
                    sig += np.sin(2 * np.pi * f * (1 + det) * k * t + k) / (k * 1.4)
    shape = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / .4)
    return sig * np.clip(shape, 0, 1) / max(1, len(freqs) * 3)


def score(seconds, bpm, mood, cuts, end_start, seed=20261111):
    """Original score on a beat grid; cuts and the end card fall on beats."""
    tr = Track(seconds + .5, seed)
    beat = 60 / bpm
    prog = PROGRESSIONS[mood]
    bars = int(math.ceil(seconds / (beat * 4))) + 1
    for bar in range(bars):
        root, quality = prog[bar % len(prog)]
        at = bar * beat * 4
        if at >= seconds:
            break
        chord = [freq(root, 3) * 2 ** (i / 12) for i in QUALITIES[quality]]
        outro = at >= end_start - 1e-6
        intro = bar == 0
        tr.put(pad(chord, beat * 4 + .3, 1500 if mood != 'cinematic' else 1100), at, .55 if mood in {'calm', 'cinematic'} else .32)
        bass_f = freq(root, 1 if mood == 'cinematic' else 2)
        for b in range(4):
            t = at + b * beat
            if t >= seconds:
                break
            if mood == 'pulse':
                if not outro:
                    tr.put(kick(1.0), t, .9)
                    if b in (1, 3) and not intro:
                        tr.put(tr.noise(.16, 900, 5200) * env(int(.16 * SR), .001, .045), t, .32)
                    for h in (0, .5):
                        tr.put(tr.noise(.08, 6500, 14000) * env(int(.08 * SR), .0005, .02), t + h * beat, .12 if h else .07, .25)
                    for h in (0, .5):
                        tr.put(saw(bass_f, beat * .45, 900, .12), t + h * beat, .22)
                for s in range(4):
                    note = chord[(b * 4 + s) % len(chord)] * 2
                    tr.put(tone(note, .25, .09, (1, .35, .1)), t + s * beat / 4, .07 if not outro else .05, .4 * (-1) ** s)
            elif mood == 'bright':
                if not outro:
                    if b in (0, 2) or (b == 3 and bar % 2):
                        tr.put(kick(.85), t + (beat * .5 if b == 3 else 0), .8)
                    if b in (1, 3) and not intro:
                        tr.put(tr.noise(.14, 1200, 6000) * env(int(.14 * SR), .001, .04), t, .26)
                    for s in range(4):
                        tr.put(tr.noise(.05, 7000, 15000) * env(int(.05 * SR), .0005, .012), t + s * beat / 4, .06 + .04 * (s % 2), -.3)
                    tr.put(tone(bass_f, beat * .8, .18, (1, .3)), t, .3)
                for s in (0, 2):
                    note = chord[(b + s) % len(chord)] * 4
                    tr.put(bell(note, .6, .2), t + s * beat / 4, .06, .5 * (-1) ** b)
            elif mood == 'calm':
                if b == 0 and not outro:
                    tr.put(kick(.55), t, .55)
                if b == 2 and not outro and not intro:
                    tr.put(tr.noise(.06, 2500, 8000) * env(int(.06 * SR), .0005, .015), t, .12)
                for s in (0, 1):
                    note = chord[(b * 2 + s) % len(chord)] * 2
                    tr.put(bell(note, 1.2, .5), t + s * beat / 2, .08, .3 * (-1) ** s)
                if b == 0:
                    tr.put(tone(bass_f / 2, beat * 3.8, 1.2, (1, .2)), t, .32)
            else:  # cinematic
                for s in range(2):
                    if not outro:
                        tr.put(saw(bass_f, beat * .4, 700, .1), t + s * beat / 2, .2)
                if b == 0 and not outro:
                    tr.put(kick(1.1), t, .7)
                if b == 2 and not outro and not intro:
                    tr.put(tone(90, .5, .18, (1, .5, .2)), t, .4)
                    tr.put(tr.noise(.5, 200, 1800) * env(int(.5 * SR), .002, .1), t, .12)
                if b in (0, 2):
                    tr.put(bell(chord[-1] * 2, 1.4, .6), t, .045, .2)
    for c in cuts:  # accent on every cut
        tr.put(tr.noise(1.4, 3000, 14000) * env(int(1.4 * SR), .002, .45), c, .07)
        tr.put(kick(.8), c, .35)
    # final resolution: low chord and bell on the end card
    root = prog[0][0]
    tr.put(pad([freq(root, 3) * 2 ** (i / 12) for i in QUALITIES[prog[0][1]]], max(1.0, seconds - end_start), 1200, .05), end_start, .5)
    tr.put(bell(freq(root, 5), 2.5, .9), end_start + .02, .14)
    out = tr.stereo()[: int(seconds * SR)]
    fade = int(min(1.2, seconds * .1) * SR)
    out[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    out[: int(.02 * SR)] *= np.linspace(0, 1, int(.02 * SR))[:, None]
    return out


def effects(seconds, cues, seed=7):
    """Soft sound design at the times the runtime reported (user feedback 14 Nov: effects were annoying).

    Only gentle sounds: an airy low-passed whoosh on cuts, a muted wooden blip
    for appearances and a soft bell on key moments. Typing clicks and bright
    ticks are gone, and cues closer than 0.45 s to the previous one are skipped.
    """
    tr = Track(seconds + 2, seed)
    last = -9.0
    lowpass = butter(2, 2600, btype='low', fs=SR, output='sos')
    for c in sorted(cues, key=lambda c: c['t']):
        t, kind, gain = c['t'], c['type'], float(c.get('gain', 1))
        if kind == 'type':
            continue
        if kind != 'whoosh' and t - last < .45:
            continue
        last = t
        if kind == 'whoosh':
            dur = .6
            raw = tr.rng.standard_normal(int(dur * SR))
            out = np.zeros(len(raw))
            block = 480
            for i in range(0, len(raw), block):
                x = i / len(raw)
                centre = 250 * (6 ** x)
                seg = sosfilt(butter(2, [centre * .6, min(centre * 1.6, 9000)], btype='band', fs=SR, output='sos'), raw[max(0, i - 2400): i + block])
                out[i:i + block] = seg[-min(block, len(raw) - i):]
            out = sosfilt(lowpass, out) * np.sin(np.pi * np.arange(len(out)) / len(out)) ** 3
            tr.put(out / (np.abs(out).max() + 1e-9), t - .15, .16 * gain, .2)
        elif kind in {'pop', 'tick'}:
            blip = tone(440 if kind == 'pop' else 660, .14, .045, (1, .25), attack=.006)
            tr.put(sosfilt(lowpass, blip), t, (.09 if kind == 'pop' else .05) * gain)
        elif kind == 'chime':
            for i, f in enumerate((880, 1318.5)):
                tr.put(bell(f, 1.2, .4), t + i * .08, .045 * gain, (-.2, .2)[i])
        elif kind == 'swell':
            n = int(1.0 * SR)
            sig = sosfilt(lowpass, tr.noise(1.0, 300, 4000)) * (np.arange(n) / n) ** 2
            tr.put(sig / (np.abs(sig).max() + 1e-9), t - .7, .1 * gain)
    return tr.stereo()[: int(seconds * SR)]


# ---------------------------------------------------------------- voice
def melodi_voice(text, speed, cache_dir, *, cancelled=None, language='es'):
    """Melodi's Cartesia voice with word timestamps; cached by content hash."""
    from packages.providers.cartesia_melodi import MODEL, URL, VOICES, SAMPLE_RATE
    voice = VOICES[language]  # Melodi's own Spanish or English voice
    key = hashlib.sha256(json.dumps([MODEL, voice, text, speed], ensure_ascii=False).encode()).hexdigest()[:24]
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    wav, words_file = cache_dir / (key + '.wav'), cache_dir / (key + '.words.json')
    if wav.is_file() and words_file.is_file():
        return wav, json.loads(words_file.read_text(encoding='utf-8')), False
    from websockets.sync.client import connect
    api_key = os.environ.get('BRIVANY_CARTESIA_API_KEY', '').strip()
    if not api_key:
        raise ValueError('Configura la clave de Cartesia para la voz de Melodi.')
    pcm, words, context, deadline = bytearray(), [], uuid4().hex, time.monotonic() + 90
    with connect(URL, additional_headers={'X-API-Key': api_key}, open_timeout=10, close_timeout=2, max_size=524288, compression=None, proxy=None) as socket:
        socket.send(json.dumps({'model_id': MODEL, 'transcript': text, 'voice': voice, 'language': language, 'context_id': context,
                                'continue': False, 'add_timestamps': True, 'generation_config': {'speed': speed},
                                'output_format': {'container': 'raw', 'encoding': 'pcm_s16le', 'sample_rate': SAMPLE_RATE}}))
        while True:
            if time.monotonic() > deadline or (cancelled is not None and cancelled.is_set()):
                raise ValueError('La locución se detuvo sin terminar.')
            event = json.loads(socket.recv(timeout=20))
            if event.get('context_id') != context:
                raise ValueError('Cartesia devolvió otro contexto de voz.')
            if event['type'] == 'error':
                raise ValueError('Cartesia rechazó la locución; revisa acceso y saldo.')
            if event['type'] == 'chunk':
                pcm.extend(base64.b64decode(event['data'], validate=True))
            elif event['type'] == 'timestamps':
                value = event['word_timestamps']
                words.extend({'word': w, 'start': s, 'end': e} for w, s, e in zip(value['words'], value['start'], value['end']))
            elif event['type'] == 'done':
                break
    if not pcm or len(pcm) % 2 or not words:
        raise ValueError('Falta audio o marcas de palabra en la locución.')
    with wave.open(str(wav), 'wb') as out:
        out.setparams((1, 2, SAMPLE_RATE, 0, 'NONE', 'not compressed'))
        out.writeframes(bytes(pcm))
    words_file.write_text(json.dumps(words, ensure_ascii=False), encoding='utf-8')
    return wav, words, True


def read_wav(path):
    with wave.open(str(path)) as w:
        rate, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        data = np.frombuffer(w.readframes(n), dtype='<i2').astype(np.float64) / 32768
    if ch == 2:
        data = data.reshape(-1, 2).mean(axis=1)
    if rate != SR:
        x = np.arange(int(len(data) * SR / rate)) * rate / SR
        data = np.interp(x, np.arange(len(data)), data)
    return data


def speech_bounds(path):
    """Seconds of audible speech: (first, last) above -45 dBFS."""
    data = read_wav(path)
    hop = int(.01 * SR)
    frames = np.sqrt(np.convolve(data ** 2, np.ones(hop) / hop, mode='same'))
    idx = np.nonzero(frames > 10 ** (-45 / 20))[0]
    return (idx[0] / SR, idx[-1] / SR) if len(idx) else (0.0, len(data) / SR)


def write_wav(path, stereo):
    pcm = (np.clip(stereo, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as out:
        out.setparams((2, 2, SR, 0, 'NONE', 'not compressed'))
        out.writeframes(pcm.tobytes())


def mix(seconds, music, fx, voices, output, *, loudness=-14.0, ffmpeg='ffmpeg'):
    """voices: [(wav path, start seconds)]. Music ducks under the voice."""
    n = int(round(seconds * SR))
    voice = np.zeros(n)
    for path, start in voices:
        data = read_wav(path)
        a = int(round(start * SR))
        data = data[: max(0, n - a)]
        voice[a:a + len(data)] += data
    rms = lambda x: math.sqrt(float(np.mean(x ** 2))) + 1e-12
    active = voice[np.abs(voice) > 1e-3]
    vref = rms(active) if len(active) else .1
    voice *= .16 / vref
    hop = int(.01 * SR)
    level = np.sqrt(np.convolve(voice ** 2, np.ones(hop * 4) / (hop * 4), mode='same'))
    gate = (level > .02).astype(float)
    lead = int(.3 * SR)  # start lowering the music 0.3 s before Melodi speaks
    gate = np.maximum(gate, np.concatenate([gate[lead:], np.zeros(lead)]))
    # attack 40 ms, release 350 ms one-pole smoothing of the duck control
    smooth = np.zeros(n)
    a_att, a_rel = math.exp(-1 / (.22 * SR)), math.exp(-1 / (.6 * SR))  # slow, smooth duck instead of a sudden drop
    acc = 0.0
    for i in range(0, n, hop):  # block-wise for speed
        target = gate[i]
        coef = a_att if target > acc else a_rel
        acc = target + (acc - target) * coef ** hop
        smooth[i:i + hop] = acc
    duck = 1 - .72 * smooth          # about −11 dB under the voice
    m = music[:n] if len(music) >= n else np.pad(music, ((0, n - len(music)), (0, 0)))
    f = fx[:n] if len(fx) >= n else np.pad(fx, ((0, n - len(fx)), (0, 0)))
    # carve the voice band out of the music while Melodi speaks (−6 dB at 1–4 kHz)
    band = sosfilt(butter(2, [1000, 4000], btype='band', fs=SR, output='sos'), m, axis=0)
    m = m - band * (.5 * smooth)[:, None]
    m = m * (.075 / rms(m))
    f = f * (.9 if np.abs(f).max() < 1e-9 else .3 / (np.abs(f).max() + 1e-9))
    f = f * (1 - .5 * smooth)[:, None]  # effects step back under the voice too
    intro = np.ones(n)
    ramp = min(n, int(1.6 * SR))
    intro[:ramp] = np.sin(np.linspace(0, np.pi / 2, ramp)) ** 2  # the music fades in instead of starting loud
    bed = m * (duck * intro)[:, None] + f
    out = bed + voice[:, None] * np.array([1, 1])
    from .social_review import speech_to_bed
    ratio = speech_to_bed(voice, bed.mean(axis=1), SR)
    pre = Path(output).with_suffix('.pre.wav')
    write_wav(pre, out / max(1, np.abs(out).max() / .95))
    # two-pass EBU R128 normalization with a true-peak ceiling
    probe = subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-i', str(pre), '-af', f'loudnorm=I={loudness}:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
                           capture_output=True, text=True, check=True).stderr
    stats = json.loads(probe[probe.rindex('{'): probe.rindex('}') + 1])
    subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(pre), '-af',
                    f"loudnorm=I={loudness}:TP=-1.5:LRA=11:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true,aresample=48000",
                    '-ac', '2', '-c:a', 'pcm_s16le', str(output)], check=True)
    pre.unlink()
    return {'input_lufs': float(stats['input_i']), 'target_lufs': loudness, 'speech_to_bed': ratio}


def measure(path, ffmpeg='ffmpeg'):
    out = subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                         capture_output=True, text=True, check=True).stderr
    summary = out[out.rindex('Summary:'):]
    def grab(label):
        line = next(l for l in summary.splitlines() if l.strip().startswith(label))
        return float(line.split(':')[1].split()[0])
    return {'integrated_lufs': grab('I:'), 'lra': grab('LRA:'), 'true_peak_dbfs': grab('Peak:')}
