"""Temporary desktop bridge for the browser rehearsal test; no real adapters."""
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
from unittest.mock import patch

from desktop.experience.telephony import TelephoneBridge
from services.telephony.whatsapp_client import WhatsAppClientGateway, rehearsal
from services.telephony.whatsapp_client_settings import ClientSettings

METHODS = {'workspace_telephone_channels', 'workspace_telephone_select_channel', 'workspace_telephone_info',
           'workspace_telephone_prepare', 'workspace_telephone_discard', 'workspace_telephone_confirm',
           'workspace_telephone_status', 'workspace_telephone_cancel', 'workspace_telephone_forget_receipt'}


def main():
    with tempfile.TemporaryDirectory(prefix='brivany-whatsapp-client-') as temporary:
        folder = Path(temporary)
        settings = ClientSettings(folder/'client.json')
        hold = threading.Event()
        def driver(session, client, providers, canceled):
            while hold.is_set() and not canceled.wait(.01):
                pass
            if not canceled.is_set():
                rehearsal(session, client, providers, canceled)
        gateway = WhatsAppClientGateway(folder/'calls.sqlite3', settings, rehearsal_runner=driver)
        bridge = TelephoneBridge(); bridge._trusted = lambda: None
        bridge._telephone_gateway = lambda: None
        bridge._whatsapp_call_settings, bridge._whatsapp_call_client = settings, gateway
        print(json.dumps({'ready':True}), flush=True)
        try:
            with patch('socket.create_connection', side_effect=AssertionError('External network forbidden')), \
                 patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('External HTTP forbidden')):
                for raw in sys.stdin:
                    message = json.loads(raw)
                    try:
                        method, args = message['method'], message.get('args', [])
                        if method == 'close':
                            break
                        if method == 'hold':
                            hold.set() if args[0] else hold.clear()
                            value = {'ok':True}
                        elif method == 'stats':
                            with gateway.lock:
                                count = gateway.db.execute('SELECT count(*) FROM whatsapp_client_calls').fetchone()[0]
                            value = {'receipts':count, 'public_calls':0, 'paid_provider_calls':0}
                        elif method in METHODS:
                            value = getattr(bridge, method)(*args)
                        else:
                            raise ValueError('Unsupported fixture method')
                        reply = {'id':message['id'], 'value':value}
                    except Exception as error:
                        reply = {'id':message['id'], 'error':str(error)}
                    print(json.dumps(reply, ensure_ascii=False), flush=True)
        finally:
            gateway.close()


if __name__ == '__main__':
    main()
