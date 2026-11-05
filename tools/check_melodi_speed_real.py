"""Single paid synthesis to check Melodi's requested Cartesia pace, no retry."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import struct
import time
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-paid', action='store_true')
    parser.add_argument('--case',choices=('pace','laugh'),default='pace')
    args=parser.parse_args()
    if not args.allow_paid:
        parser.error('Explicit --allow-paid required; no request opened.')
    report = {'started_at': datetime.now(timezone.utc).isoformat(),
              'purpose': 'Verify a single fixed synthetic phrase accepts native Cartesia speed 1.05 through the main HTTP endpoint.',
              'source_synthetic': True, 'requested_speed': 1.05,
              'maximum_syntheses': 1, 'automatic_retries': 0,
              'maximum_audio_bytes': 480000, 'maximum_read_seconds': 15,
              'new_audio_persisted': False, 'conversation_persisted': False,
              'physical_playback_verified': False, 'actual_billed_usd': None, 'status': 'failed'}
    if args.case=='laugh':report['purpose']='Verify one Spanish synthetic reaction with native Cartesia [laughter], keeping the requested voice and pace.'
    report['case']=args.case
    text='[laughter] ¡Eh, ya te lo sabías!' if args.case=='laugh' else 'Hola. Soy Melodi y estoy aquí.'
    body = json.dumps({'text': text, 'language': 'es', 'speed': 1.05, 'consent': True}).encode()
    started = time.monotonic()
    try:
        request = Request('http://127.0.0.1:8765/api/voice/speech', body, {'Content-Type': 'application/json'})
        with urlopen(request, timeout=12) as response:
            report['http_status'] = response.status
            assert response.headers.get('Content-Type', '').startswith('audio/pcm')
            count, energy = 0, False
            while block := response.read1(4096):
                report.setdefault('first_pcm_ms', round((time.monotonic()-started)*1000))
                count += len(block)
                assert count <= report['maximum_audio_bytes'] and time.monotonic()-started <= 15
                energy = energy or any(abs(value[0]) > 96 for value in struct.iter_unpack('<h', block))
            assert count > 0 and energy
            report.update(output_bytes=count, audio_seconds=count/48000, pcm_has_voice_energy=energy, status='passed_real_http_and_synthesis_not_subjective_voice_quality')
    except Exception as error:
        report['failure_type'] = type(error).__name__
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    report['elapsed_ms'] = round((time.monotonic()-started)*1000)
    output = Path('tmp/melodi-speed-real-'+report['started_at'].replace(':', '').replace('-', '').replace('.', '')+'.json')
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    print('Report: '+str(output))
    return 0 if report['status'].startswith('passed_') else 1


if __name__ == '__main__':
    raise SystemExit(main())
