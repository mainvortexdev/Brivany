"""Private stdio fixture for browser tests. Never expose its envelopes as evidence."""
import json
from pathlib import Path
import sys
import tempfile
import threading

from desktop.experience.workspace_phone import PhoneTransfer, tls_identity
from tests.test_workspace_phone import FixtureProtector


PAYLOAD = ('Contenido propio para verificar transferencia local.\n' * 40).encode('utf-8')


def main():
    lock = threading.Lock()
    def send(value):
        with lock:
            print(json.dumps(value, ensure_ascii=True), flush=True)
    with tempfile.TemporaryDirectory(prefix='brivany-phone-fixture-') as directory:
        protector = FixtureProtector()
        if '--control' in sys.argv:
            run_control(send, directory, protector)
            return
        if '--official' in sys.argv:
            from desktop.experience.official_transfer import OfficialTransfer
            transfer=OfficialTransfer(publish=lambda value:send({'event':value}))
        else:
            transfer = PhoneTransfer(Path(directory), addresses=lambda: ['127.0.0.1'],
                identity=lambda address, folder: tls_identity(address, folder, protector),
                publish=lambda value: send({'event': value}))
        send({'ready': True})
        try:
            for line in sys.stdin:
                command = json.loads(line)
                action = command.get('action')
                if action == 'share':
                    value = transfer.share('Documento propio.txt', PAYLOAD, locale=command.get('locale','es'))
                elif action == 'large' and '--official' in sys.argv:
                    value=transfer.share('Prueba de límite.bin',bytes(range(256))*32768)
                elif action == 'stop':
                    value = transfer.stop()
                elif action == 'settings':
                    address = command.get('address')
                    value = transfer.configure(address) if address else transfer.configuration()
                else:
                    value = transfer.snapshot()
                send({'id': command['id'], 'value': value})
        finally:
            transfer.close()


def run_control(send, directory, protector):
    from desktop.experience.phone_control import PhoneControl
    from tests.test_phone_control import Driver, own_frame

    driver = Driver()
    count = 0
    def capture():
        nonlocal count
        count += 1
        return own_frame()

    control = PhoneControl(Path(directory), addresses=lambda:['127.0.0.1'],
        identity=lambda address, folder:tls_identity(address, folder, protector), driver=lambda:driver,
        capture=capture, publish=lambda value:send({'event':value}))
    send({'ready':True})
    try:
        for line in sys.stdin:
            command = json.loads(line)
            action = command.get('action')
            try:
                if action == 'start':
                    value = control.start('127.0.0.1')
                elif action == 'link':
                    value = control.origin + '/#' + control.invite
                elif action == 'approve':
                    value = control.approve(*command['args'])
                elif action == 'power':
                    value = control.decide_power(*command['args'])
                elif action == 'stop':
                    value = control.stop()
                elif action == 'observed':
                    value = {'events':driver.events, 'power':driver.power_events, 'frames':count,
                             'listening':control.server is not None}
                else:
                    value = control.snapshot()
                send({'id':command['id'],'value':value})
            except ValueError as error:
                send({'id':command['id'],'error':str(error)})
    finally:
        control.close()


if __name__ == '__main__':
    main()
