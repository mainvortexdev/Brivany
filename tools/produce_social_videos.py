"""Melodi produces social videos with the real planner and her real voice.

Two stages so a weak script can be revised before spending a render:

  plan    real Meta planning (Melodi) for a request; optional revision of a
          previous plan with written direction. Saves the plan and its calls.
  render  voice (Cartesia, cached), score, effects, frames, mix, cover, SRT,
          post text and export of an approved Melodi plan, after the automatic
          review (safe zones, legibility, sync, voice over music).
  listen  independent intelligibility check: Deepgram transcribes the final
          mix (voice + music + effects) and it is compared with the script.

Both stages use external services and have unknown cost: never run them as a
routine test. Usage:
  python -m tools.produce_social_videos plan "<petición>" [--revise plan.json --direction "..."]
  python -m tools.produce_social_videos render plan.json --export Exports/<carpeta>
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import threading
import time
from uuid import uuid4

from services.computer.planner import MetaPlanner, creative_motion_request
from services.h1.server import load_local_config
from services.motion.social_service import SocialService, detect_destination

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.local/melodi-social'
REPORTS = ROOT / 'tmp/motion-social'


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='stage', required=True)
    p = sub.add_parser('plan')
    p.add_argument('request')
    p.add_argument('--revise')
    p.add_argument('--direction')
    p.add_argument('--brand', help='Carpeta de un kit de marca de cliente (brand.json, logo, fuentes)')
    p.add_argument('--facts', help='Archivo con los datos del cliente tomados de su web')
    r = sub.add_parser('render')
    r.add_argument('plan')
    r.add_argument('--export', required=True)
    r.add_argument('--workers', type=int, default=3)
    r.add_argument('--replace', action='store_true', help='Actualiza una exportación anterior de esta misma pieza')
    lp = sub.add_parser('listen')
    lp.add_argument('project')
    args = parser.parse_args()
    load_local_config()
    WORK.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    service = SocialService(WORK / 'projects', voice_cache=WORK / 'voice-cache')
    if args.stage == 'listen':
        return listen(Path(args.project))
    if args.stage == 'plan':
        if not creative_motion_request(args.request):
            raise SystemExit('El router de Melodi no enviaría esta petición al creador de video.')
        destination = detect_destination(args.request)
        previous = None
        if args.revise:
            previous = json.loads(Path(args.revise).read_text(encoding='utf-8'))['plan']
        planner = MetaPlanner()
        began = time.monotonic()
        from services.motion.social_service import load_brand
        brand = load_brand(args.brand) if args.brand else None
        facts = Path(args.facts).read_text(encoding='utf-8') if args.facts else None
        try:
            plan, calls, _raw = service.plan(args.request, lambda prompt, data: planner.generate(prompt, data, max_tokens=9000),
                                             destination=destination, progress=lambda t: print(t, flush=True),
                                             previous=previous, revision=args.direction, brand=brand, facts=facts)
        except ValueError as error:  # keep the consumption of failed attempts on record
            failed = REPORTS / f'failed-plan-{destination}-{stamp}.json'
            failed.write_text(json.dumps({'request': args.request, 'direction': args.direction, 'planning_calls': getattr(error, 'calls', None),
                                          'error': str(error), 'billed_amount': None}, ensure_ascii=False, indent=2), encoding='utf-8')
            raise
        out = WORK / 'plans' / f'{destination}-{stamp}.json'
        out.parent.mkdir(exist_ok=True)
        record = {'request': args.request, 'destination': destination, 'planner': 'Meta (Melodi)', 'planning_calls': calls,
                  'seconds': round(time.monotonic() - began, 2), 'revision_of': args.revise, 'direction': args.direction,
                  'brand': args.brand, 'facts': args.facts,
                  'billed_amount': None, 'plan': plan}
        out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'plan': str(out), 'calls': calls, 'title': plan['title'], 'shots': len(plan['shots'])}, ensure_ascii=False))
    else:
        record = json.loads(Path(args.plan).read_text(encoding='utf-8'))
        calls = record['planning_calls']
        source = record
        while source.get('revision_of'):  # count the whole revision chain
            source = json.loads(Path(source['revision_of']).read_text(encoding='utf-8'))
            calls += source['planning_calls']
        result = service.run(record['request'], identifier=str(uuid4()), decide=None, cancelled=threading.Event(),
                             plan=record['plan'], planned_by='Melodi (Meta)', planning_calls=calls, brand=record.get('brand'),
                             export_to=ROOT / args.export, replace_export=args.replace, workers=args.workers, progress=lambda t: print(t, flush=True))
        report = result.pop('report')
        report['plan_file'] = str(Path(args.plan))
        (REPORTS / f"{record['destination']}-{stamp}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({k: result[k] for k in ('path', 'duration', 'loudness', 'export_folder', 'elapsed_seconds')}, ensure_ascii=False))


def _deepgram_key():
    import os
    key = os.environ.get('BRIVANY_DEEPGRAM_API_KEY', '').strip()
    if not key and (ROOT / '.env').is_file():  # same variable the desktop launcher uses; value never printed
        for line in (ROOT / '.env').read_text(encoding='utf-8-sig').splitlines():
            if line.startswith('BRIVANY_DEEPGRAM_API_KEY='):
                key = line.split('=', 1)[1].strip().strip('"').strip("'")
    if not key:
        raise SystemExit('Falta BRIVANY_DEEPGRAM_API_KEY.')
    return key


def listen(project):
    """Transcribe the delivered mix with Deepgram nova-3 (es) and score it against the script."""
    import subprocess
    from urllib.request import Request, urlopen
    from services.motion.social_review import word_accuracy
    data = json.loads((project / 'social.json').read_text(encoding='utf-8'))
    audio = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(project / 'Brivany.mp4'), '-vn', '-ac', '1', '-ar', '16000',
                            '-f', 'wav', '-'], capture_output=True, check=True).stdout
    lang = data['plan'].get('language', 'es')
    request = Request(f'https://api.deepgram.com/v1/listen?model=nova-3&language={lang}&punctuate=true', data=audio,
                      headers={'Authorization': 'Token ' + _deepgram_key(), 'Content-Type': 'audio/wav'}, method='POST')
    with urlopen(request, timeout=120) as response:
        result = json.loads(response.read())
    heard = result['results']['channels'][0]['alternatives'][0]['transcript']
    expected = ' '.join(s['narration'] for s in data['plan']['shots'] if s['narration'])
    score = word_accuracy(expected, heard)
    # sync: heard word start vs caption word start, matched in order by normalized text
    import re as _re
    norm = lambda w: ''.join(_re.findall(r'[a-záéíóúüñ0-9]+', w.lower()))
    heard_words = [(norm(w['word']), w['start']) for w in result['results']['channels'][0]['alternatives'][0]['words']]
    shown = [(norm(w['w']), w['start']) for c in data['captions'] for w in c['words']]
    offsets, j = [], 0
    for text, start in shown:
        for k in range(j, min(j + 6, len(heard_words))):
            if heard_words[k][0] == text and text:
                offsets.append(start - heard_words[k][1]); j = k + 1; break
    offsets.sort()
    sync = {'matched_words': len(offsets), 'caption_words': len(shown),
            'median_ms': round(1000 * offsets[len(offsets) // 2]) if offsets else None,
            'p95_abs_ms': round(1000 * sorted(abs(o) for o in offsets)[int(.95 * (len(offsets) - 1))]) if offsets else None}
    report = {'provider': f'Deepgram nova-3 ({lang}), prerecorded', 'audio_seconds': data['total'], 'requests': 1, 'billed_amount': None,
              'expected': expected, 'heard': heard, 'word_accuracy': score, 'caption_sync': sync,
              'passed': score >= .9 and (sync['p95_abs_ms'] or 0) <= 250}
    (project / 'review-asr.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'project': str(project), 'word_accuracy': score, 'caption_sync': sync, 'passed': report['passed']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
