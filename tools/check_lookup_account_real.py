"""Two explicit public lookups through the real account and running desktop.

No tokens, original messages, provider responses or conversations in the report.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from urllib.parse import urlsplit
from uuid import uuid4
from services.brivany_account import AccountHTTP, SecureAccountFile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-network', action='store_true')
    parser.add_argument('--case', choices=['all', 'weather', 'documentation'], default='all')
    args = parser.parse_args()
    if not args.allow_network:
        parser.error('This trial makes two real provider requests; use --allow-network.')
    token = SecureAccountFile(ROOT / '.local/mobile-accounts/preview-session.dpapi').load()['session']['token']
    http = AccountHTTP()
    report = {'passed': False, 'scope': 'real account, desktop and Meta search', 'checked_at': datetime.now(timezone.utc).isoformat(),
              'cache_used': False, 'original_conversation_saved': False, 'billing_usd': None, 'trials': []}
    device = json.loads((ROOT / '.local/account/device.json').read_text())['id']
    try:
        for name, question in [('weather', 'Puedes comprobar el clima hoy en Las Terrenas?'),
                               ('documentation', 'Busca en internet qué hace pathlib.Path en la documentación oficial de Python')]:
            if args.case not in ('all', name):
                continue
            start = time.monotonic()
            events = list(http.chat([{'role': 'user', 'content': question}], token, conversation_id=str(uuid4())))
            ack = time.monotonic() - start
            event = next(e for e in events if e['type'] in {'computer_job', 'computer_choice'})
            command = event['command']
            if command['state'] == 'needs_device':
                command = http.call('/v1/commands/select', {'id': command['id'], 'computer': device}, token)['command']
            polls = 0
            while time.monotonic() - start < 25:
                current = http.call('/v1/commands/' + command['id'], token=token)['command']
                polls += 1
                if current['state'] in {'succeeded', 'failed', 'cancelled', 'uncertain'}:
                    break
                time.sleep(.25)
            else:
                raise ValueError('The search did not finish within 25 seconds.')
            output = current.get('result', {}).get('output', {})
            row = {'case': name, 'ack_seconds': round(ack, 3), 'completion_seconds': round(time.monotonic() - start, 3),
                   'state': current['state'], 'account_polls': polls, 'host_external_requests': current.get('result', {}).get('external_calls'),
                   'actual_search_verified': output.get('web_search_verified') is True,
                   'source_domains': [urlsplit(s['url']).hostname for s in output.get('sources', [])],
                   'answer_characters': len(output.get('message', ''))}
            report['trials'].append(row)
            row['within_five_seconds'] = row['completion_seconds'] <= 5
            assert current['state'] == 'succeeded' and output.get('web_search_verified') is True and output.get('message')
            assert row['host_external_requests'] == 1
        report['passed'] = True
    except Exception as error:
        report['error'] = str(error)[:200]
    path = ROOT / ('tmp/lookup-account-fast-real-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.json')
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
