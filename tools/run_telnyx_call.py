"""One explicit, authorized phone call from Melodi through Telnyx.

  python -m tools.run_telnyx_call --destination +1809XXXXXXX --confirm-call

Melodi greets, then converses with the Live pipeline (Muse → Meta → Cartesia).
Say «adiós» or press 0 to end; creating `.local/telephony/live-call-stop` also
hangs up. No recordings or transcripts. The status file holds only operational
metadata: states, SIP codes, turn timings and the balance difference.
No automatic redial, purchases or credential output.
"""
import argparse
import ctypes
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import os
import threading
import time
from uuid import uuid4

from packages.runtime_paths import DATA_ROOT
from services.h1.server import load_local_config
from services.telephony.common import TelephonyError, masked, number
from services.telephony.realtime import LivePhoneSession, LiveProviders
from services.telephony.sip import NativeSIP
from services.telephony.telnyx import TelnyxAPI, explain, load_profile

OBJECTIVE = ('Primera llamada de prueba de Brivany por Telnyx con el usuario. Conversa con naturalidad '
             'en español, con continuidad y sin limitar los turnos. No ejecutes acciones externas.')


def balance(api):
    try:
        value = api.balance() if api else {}
        return Decimal(str(value.get('balance'))), value.get('currency')
    except (TelephonyError, InvalidOperation, TypeError):
        return None, None


def main():
    parser = argparse.ArgumentParser(description='Primera llamada real de Melodi por Telnyx.')
    parser.add_argument('--destination', required=True)
    parser.add_argument('--objective', default=OBJECTIVE)
    parser.add_argument('--confirm-call', action='store_true',
                        help='Confirma que autorizas una llamada real con coste.')
    args = parser.parse_args()
    if not args.confirm_call:
        parser.error('Es una llamada real con coste: repite con --confirm-call.')
    destination = number(args.destination)
    load_local_config()
    directory = DATA_ROOT / '.local/telephony'
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / 'live-call-status.json'
    stop_path = directory / 'live-call-stop'
    stop_path.unlink(missing_ok=True)
    started = time.monotonic()
    lock = threading.RLock()
    finished = threading.Event()
    native = session = None
    status = {'id': str(uuid4()), 'mode': 'real_telnyx_pstn', 'destination': masked(destination),
              'started_utc': datetime.now(timezone.utc).isoformat(), 'state': 'preparing',
              'audio_saved': False, 'transcript_saved': False, 'events': [], 'sip_responses': []}

    def write(**values):
        with lock:
            status.update(values)
            status['elapsed_seconds'] = round(time.monotonic() - started, 2)
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(status, indent=2, ensure_ascii=False), encoding='utf-8')
            temporary.replace(path)

    def notify(event):
        at = round(time.monotonic() - started, 2)
        if event.get('type') == 'sip_response':
            with lock:
                item = {key: event[key] for key in ('sip_status', 'method', 'reason_protocol', 'reason_cause', 'warning_code') if key in event}
                status['sip_responses'] = (status['sip_responses'] + [{**item, 'at': at}])[-20:]
            write()
            print(f'[{at:6.2f}s] SIP {event.get("sip_status")} {event.get("method")}', flush=True)
            return
        state = event.get('state')
        with lock:
            status['events'] = (status['events'] + [{'at': at, 'state': state, 'sip_status': event.get('sip_status')}])[-30:]
        write(state=state)
        print(f'[{at:6.2f}s] {state}', flush=True)

    def monitor():
        while not finished.wait(2):
            if session:
                write(conversation=dict(session.metrics))
            if stop_path.exists() and native:
                native.close()
                return

    api = None
    try:
        api = TelnyxAPI.from_environment()
    except TelephonyError:
        pass  # The call itself only needs the saved SIP profile.
    before, currency = balance(api)
    try:
        account = load_profile(directory / 'telnyx.dpapi')
        if not account.caller_id:
            raise TelephonyError('Falta el número emisor. Ejecuta: python -m tools.setup_telnyx provision --caller +1…')
        if not LiveProviders.configured():
            raise TelephonyError('Faltan las claves de Meta o Cartesia en .env.')
        configuration = account.engine()
        configuration['allow'] = [destination]
        native = NativeSIP(configuration, status['id'], notify)
        if os.name == 'nt':
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
        threading.Thread(target=monitor, daemon=True).start()
        write(state='connecting', caller_id=masked(account.caller_id), server=account.server)
        print(f'Llamando a {masked(destination)} desde {masked(account.caller_id)}…', flush=True)
        native.start(destination)
        write(state='in-progress')
        print('Contestada. Melodi está hablando. Di «adiós» o pulsa 0 para colgar.', flush=True)
        session = LivePhoneSession(native, native.stream_id, args.objective, native.closed, LiveProviders(),
                                   max_turns=None, audio_format='pcm_24000')
        session.run()
        write(state='failed' if session.metrics['failed'] else 'completed', conversation=dict(session.metrics))
    except Exception as error:
        codes = [item['sip_status'] for item in status['sip_responses'] if item.get('method') == 'INVITE' and item.get('sip_status', 0) >= 300]
        message = explain(codes[-1]) if codes else str(error) if isinstance(error, TelephonyError) else type(error).__name__
        write(state='failed', error=message,
              sip_registration=native.registration_status if native else 0)
        print('No se completó: ' + message, flush=True)
    finally:
        finished.set()
        if native:
            native.shutdown()
        if os.name == 'nt':
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
        time.sleep(3)  # Telnyx settles the charge shortly after hangup.
        after, _ = balance(api)
        if before is not None and after is not None:
            write(balance_difference=str(before - after), currency=currency)
        write(finished_utc=datetime.now(timezone.utc).isoformat())
        print(json.dumps({key: status.get(key) for key in ('state', 'error', 'elapsed_seconds', 'conversation',
                                                           'balance_difference', 'currency')}, ensure_ascii=False), flush=True)
        print('Informe: ' + str(path), flush=True)


if __name__ == '__main__':
    main()
