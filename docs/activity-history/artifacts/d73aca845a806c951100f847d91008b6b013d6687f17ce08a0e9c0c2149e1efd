"""Use a disposable loopback relay and an isolated Brave profile for one inline trial."""
import argparse
from http.client import HTTPSConnection
import json
import math
import os
from pathlib import Path
import re
import subprocess
import threading

from packages.providers.meta_prosody import MetaProsodySession, verified_audio_models
from packages.providers.caption_prefetch import CaptionPrefetch
from packages.providers.river_translation import RiverBridge, river_status
from packages.providers.robust_voice_timbre import warm_timbre
from services.h1.server import ROOT, load_local_config
from services.work.extension_identity import BRIVANY_EXTENSION_ORIGIN
from services.work.selected_video import SelectedVideoError, SelectedVideoHub
from services.work.sync_relay import SyncRelay
from websockets.sync.client import connect

REPORTS = ROOT / 'tmp/selected-video'


def trial_minimum_source_end(value=None, *, long_trial=False, extended=False):
    observation=150 if extended else 60 if long_trial else 28
    selected=(120 if extended else 31 if long_trial else 0) if value is None else value
    if type(selected) not in (int,float) or not math.isfinite(selected) or not 0<=selected<=120 or selected>observation-8:
        raise ValueError('La cobertura debe estar entre 0 y 120 segundos y dejar ocho segundos de margen en la observación.')
    return selected


def run_trial(*, position=0, target='en', owned=False, prefix=False, long_trial=False, extended=False, minimum_source_end=None, allow_paid=False,
              cue_sink=None, cue_token=None, log=print):
    required_source_end=trial_minimum_source_end(minimum_source_end,long_trial=long_trial,extended=extended)
    load_local_config()
    warm_timbre()
    providers = river_status()
    if allow_paid and (not providers['configured'] or providers['access_blocked']):
        raise RuntimeError('No están disponibles los tres servicios de traducción.')

    # Like the desktop launcher, opt into audio inference only for the checked
    # model and credential. Skip background catalog refresh in this trial.
    catalog = ROOT / '.local/translation/meta-audio-access.json'
    verified_models = verified_audio_models(catalog)
    counts = {'relay_sessions_started': 0, 'prefix_preparations_started': 0, 'prefix_muse_batch_attempts': 0,
              'prefix_meta_prosody_attempts': 0, 'live_meta_prosody_attempts': 0}
    caption_translators = []
    lock = threading.Lock()

    def counted_connection(counter):
        class CountedConnection(HTTPSConnection):
            def request(self, *args, **kwargs):
                with lock:
                    counts[counter] += 1
                return super().request(*args, **kwargs)
        return CountedConnection

    muse_connection = counted_connection('prefix_muse_batch_attempts')
    prefix_prosody_connection = counted_connection('prefix_meta_prosody_attempts')
    live_prosody_connection = counted_connection('live_meta_prosody_attempts')

    def caption_prefetch(target, *, translator_factory, epoch):
        def translator():
            created = translator_factory()
            with lock:
                caption_translators.append(created)
            return created
        return CaptionPrefetch(target, translator_factory=translator, epoch=epoch)

    def build():
        with lock:
            if not allow_paid or counts['relay_sessions_started']:
                raise ValueError('The isolated trial allows one inline session.')
            counts['relay_sessions_started'] += 1
        return RiverBridge(0, allow_synchronized=True, caption_prefetch_factory=caption_prefetch,
                           prosody_factory=lambda: MetaProsodySession(verified_models=verified_models,
                                                                      _connection_factory=live_prosody_connection))

    def prepare(raw, *, cancelled):
        from packages.providers.prefix_translation import _transcribe, prepare_prefix
        with lock:
            if not allow_paid or counts['prefix_preparations_started']:
                raise ValueError('The isolated trial allows one seven-second preparation.')
            counts['prefix_preparations_started'] += 1
        return prepare_prefix(raw, cancelled=cancelled,
                              transcriber=lambda pcm, *, cancelled: _transcribe(pcm, cancelled=cancelled, connection_factory=muse_connection),
                              prosody_factory=lambda: MetaProsodySession(verified_models=verified_models,
                                                                         _connection_factory=prefix_prosody_connection))

    def count_snapshot():
        with lock:
            return {**counts, 'meta_caption_prefetch_attempts': sum(translator.total_attempts for translator in caption_translators)}

    def reject_legacy(_selected):
        raise SelectedVideoError('El ensayo aislado requiere la reproducción en la pestaña.')

    relay = SyncRelay(port=0, automatic_origin=BRIVANY_EXTENSION_ORIGIN,
                      video_hub=SelectedVideoHub(on_translate=reject_legacy), bridge_factory=build,
                      inline_settings=lambda: {'target': target, 'voice': 'auto'},
                      **({'prefix_factory': prepare} if prefix else {})).start()
    try:
        log(json.dumps({'isolated_relay_port': relay.port, 'target': target,
                        'prosody_model_verified': bool(verified_models), 'paid_trial': allow_paid,
                        'prefix_enabled': prefix}))
        if not allow_paid:
            with connect(f'ws://127.0.0.1:{relay.port}/connect', origin=BRIVANY_EXTENSION_ORIGIN, proxy=None) as socket:
                socket.send(json.dumps({'type': 'connect', 'protocol': 1}))
                result = json.loads(socket.recv(timeout=3))
            ready = (result.get('type') == 'connected' and result.get('inline_video_sync', {}).get('target') == target and
                     (not prefix or result.get('prefix_url') == f'ws://127.0.0.1:{relay.port}/prefix'))
            log(json.dumps({'startup_ready': ready, 'provider_sessions_started': counts['relay_sessions_started']}))
            return (0 if ready else 1), None, count_snapshot()

        # Keep server-side credentials out of the browser's process environment.
        environment = {name: value for name, value in os.environ.items() if not name.startswith('BRIVANY_')}
        probe = ['node', 'browser-extension/tests/run-inline-sync-probe.mjs', '--allow-paid', f'--relay-port={relay.port}']
        probe += ['--encoded', '--short'] if owned else ['--youtube', f'--position={position}']
        if prefix:
            probe.append('--prefix')
        if long_trial or extended:
            probe.append('--long')
        if extended:
            probe.append('--observation-seconds=150')
        probe.append(f'--minimum-source-end={required_source_end}')
        if cue_sink and cue_token:
            probe.append(f'--cue-sink={cue_sink}')
            environment['BRIVANY_LAB_CUE_TOKEN'] = cue_token
        timeout = 215 if extended else 125 if long_trial else 95 if prefix else 75
        result = subprocess.run(probe, cwd=ROOT, env=environment, timeout=timeout, check=False,
                                capture_output=True, encoding='utf-8', errors='replace')
        observed = count_snapshot()
        log(result.stdout)
        log(json.dumps({**observed, 'billing_amount': None}))
        lines = result.stdout.strip().splitlines()
        report_path = Path(lines[-1]).resolve() if lines else None
        if (not report_path or report_path.parent != REPORTS.resolve() or
                not re.fullmatch(r'inline-sync-\d+\.json', report_path.name) or not report_path.is_file()):
            return 1, None, observed
        return result.returncode, report_path, observed
    finally:
        relay.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check-listen', action='store_true')
    mode.add_argument('--allow-paid', action='store_true')
    parser.add_argument('--position', type=int, default=0, metavar='SECONDS')
    parser.add_argument('--target', choices=('en', 'es', 'fr'), default='en')
    parser.add_argument('--owned', action='store_true', help='Use the existing synthetic MP4 inputs instead of YouTube.')
    parser.add_argument('--prefix', action='store_true', help='Verify the automatic prefix before activating translation.')
    parser.add_argument('--long', action='store_true', help='Require four completed dubbed cues after the prepared prefix.')
    parser.add_argument('--extended', action='store_true', help='Verify two source minutes with at most 150 seconds of observation.')
    parser.add_argument('--minimum-source-end', type=float, default=None, help='Require completed dubbed source coverage without extending the observation budget.')
    args = parser.parse_args()
    if not 0 <= args.position <= 3600:
        parser.error('--position must be between 0 and 3600 seconds')
    if args.prefix and (args.owned or args.position != 0):
        parser.error('--prefix requires the public video from the beginning')
    if (args.long or args.extended) and not args.prefix:
        parser.error('--long and --extended require --prefix')
    try:trial_minimum_source_end(args.minimum_source_end,long_trial=args.long,extended=args.extended)
    except ValueError as error:parser.error(str(error))
    result, _, _ = run_trial(position=args.position, target=args.target, owned=args.owned, prefix=args.prefix,
                             long_trial=args.long, extended=args.extended, minimum_source_end=args.minimum_source_end,
                             allow_paid=args.allow_paid, log=lambda text: print(text, flush=True))
    return result


if __name__ == '__main__':
    raise SystemExit(main())
