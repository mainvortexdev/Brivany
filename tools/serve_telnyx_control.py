"""Dedicated Telnyx listener. --share reuses the verified temporary connector.

Without --share, run ngrok http 8791 and setup_telnyx_control separately.
No command in this module places a call.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import threading
import time

from aiohttp import web
from packages.runtime_paths import APP_ROOT, DATA_ROOT
from services.h1.server import load_local_config
from services.telephony.call_control import CallControl, ControlConfig, load_environment
from services.telephony.call_control_http import create_app
from services.telephony.common import TelephonyError
from services.telephony.telnyx import TelnyxAPI
from tools.setup_telnyx_control import provision_control,reconnect_control


def main():
    parser = argparse.ArgumentParser(description='Servicio local de Telnyx Call Control y voz de Melodi.')
    parser.add_argument('--share', action='store_true', help='Túnel temporal Cloudflare ya instalado; actualiza el webhook de Melodi.')
    parser.add_argument('--from-number', help='Emisor verificado; necesario al configurar por primera vez con --share.')
    parser.add_argument('--port', type=int, default=8791)
    args = parser.parse_args()
    load_local_config()
    load_environment()
    connector = None
    directory = DATA_ROOT / '.local/telephony'
    directory.mkdir(parents=True, exist_ok=True)
    try:
        if args.share:
            executable = DATA_ROOT / '.local/tools/cloudflared-2026.10.7-windows-amd64.exe'
            if hashlib.sha256(executable.read_bytes()).hexdigest() != '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343':
                raise TelephonyError('El conector temporal no coincide con la versión verificada.')
            connector = subprocess.Popen([str(executable), 'tunnel', '--no-autoupdate', '--protocol', 'http2',
                                          '--url', f'http://127.0.0.1:{args.port}'],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding='utf-8', errors='replace', creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            ready, origin = threading.Event(), []
            def read_connector():
                for line in connector.stdout:
                    match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
                    if match and not origin:
                        origin.append(match[0])
                    if origin and 'Registered tunnel connection' in line:
                        ready.set()
            reader = threading.Thread(target=read_connector, daemon=True)
            reader.start()
            if not ready.wait(45):
                raise TelephonyError('El túnel temporal no confirmó la conexión; no se configuró ni se llamó.')
            config = reconnect_control(origin[0],port=args.port) if os.getenv('TELNYX_CONNECTION_ID','').strip() else provision_control(origin[0], args.from_number or os.getenv('TELNYX_FROM_NUMBER', ''), port=args.port)
        else:
            config = ControlConfig.environment()
            if config.port != args.port:
                raise TelephonyError('El puerto debe coincidir con BRIVANY_TELNYX_CONTROL_PORT.')
        calls = CallControl(directory / 'call-control.sqlite3', config, TelnyxAPI.from_environment())
        runtime = {'pid': os.getpid(), 'port': config.port, 'origin': config.origin,
                   'application_id': config.connection_id, 'started_utc': datetime.now(timezone.utc).isoformat(), 'calls_placed_on_startup': 0}
        (directory / 'call-control-runtime.json').write_text(json.dumps(runtime, indent=2), encoding='utf-8')
        print(json.dumps({'ready': True, **runtime}, ensure_ascii=False), flush=True)
        logging.getLogger('aiohttp.access').disabled = True
        web.run_app(create_app(calls), host='127.0.0.1', port=config.port, access_log=None, print=None)
    except (TelephonyError, OSError) as error:
        print(json.dumps({'ready': False, 'error': str(error)}, ensure_ascii=False), flush=True)
        return 1
    finally:
        if connector:
            if connector.poll() is None:
                connector.terminate()
            try:
                connector.wait(5)
            except subprocess.TimeoutExpired:
                connector.kill()
                connector.wait(3)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
