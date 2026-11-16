"""One explicitly authorized Call Control call, monitored until hangup. No redial."""
import argparse
from datetime import datetime, timezone
import json
import time
from uuid import uuid4

from packages.runtime_paths import DATA_ROOT
from services.telephony.call_control import OBJECTIVE, TERMINAL, rd_number
from services.telephony.call_control_client import ControlClient
from services.telephony.common import TelephonyError


def main():
    parser = argparse.ArgumentParser(description='Una llamada real de Melodi por Call Control v2.')
    parser.add_argument('--destination', required=True)
    parser.add_argument('--confirm-call', action='store_true')
    args = parser.parse_args()
    if not args.confirm_call:
        parser.error('Confirma la llamada real con coste mediante --confirm-call.')
    destination = rd_number(args.destination)
    client = ControlClient()
    directory = DATA_ROOT / '.local/telephony'
    directory.mkdir(parents=True, exist_ok=True)
    stop = directory / 'live-call-stop'
    stop.unlink(missing_ok=True)
    path = directory / 'call-control-live-status.json'
    identifier = str(uuid4())
    report = {'id': identifier, 'mode': 'real_telnyx_call_control_v2',
              'started_utc': datetime.now(timezone.utc).isoformat(), 'calls_attempted': 1,
              'audio_saved': False, 'transcript_saved': False}
    state, cancel_sent = None, False
    try:
        status = client.request('/v1/calls', {'id': identifier, 'destination': destination, 'objective': OBJECTIVE})
        while True:
            report.update(status)
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            temporary.replace(path)
            if state != status.get('state'):
                state = status.get('state')
                print(json.dumps(status, ensure_ascii=False), flush=True)
            if state in TERMINAL or state == 'uncertain':
                break
            if stop.is_file() and not cancel_sent:
                client.request('/v1/calls/' + identifier + '/cancel', {})
                cancel_sent = True
            time.sleep(2)
            status = client.request('/v1/calls/' + identifier)
        report['finished_utc'] = datetime.now(timezone.utc).isoformat()
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print('Informe: ' + str(path), flush=True)
        return 0 if state == 'completed' else 1
    except KeyboardInterrupt:
        client.request('/v1/calls/' + identifier + '/cancel', {})
        return 1
    except TelephonyError as error:
        print(json.dumps({'state': 'error', 'error': str(error), 'id': identifier}, ensure_ascii=False), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
