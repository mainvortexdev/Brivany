"""Persistent client routing and audio calibration; contains no account secrets."""
from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile
import threading
from uuid import UUID

from .common import TelephonyError

LOCK = threading.RLock()
DEFAULTS = {'version': 1, 'selected_channel': 'telephone', 'mode': 'simulation',
            'real_enabled': False, 'receive_device': '', 'transmit_device': '',
            'controls': {'recipient': '', 'call': '', 'hangup': '', 'state': ''},
            'receipts': {'telephone': None, 'whatsapp_client': None}}


def validate(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise TelephonyError('La configuración del cliente WhatsApp no es válida.')
    if type(value['version']) is not int or value['version'] != 1 or value['selected_channel'] not in ('telephone', 'whatsapp_client'):
        raise TelephonyError('Canal de llamada no válido.')
    if value['mode'] not in ('simulation', 'live') or type(value['real_enabled']) is not bool:
        raise TelephonyError('Modo de WhatsApp no válido.')
    for key in ('receive_device', 'transmit_device'):
        item = value[key]
        if not isinstance(item, str) or len(item) > 512 or any(ord(c) < 32 for c in item):
            raise TelephonyError('Dispositivo de audio no válido.')
    controls = value['controls']
    if not isinstance(controls, dict) or set(controls) != set(DEFAULTS['controls']):
        raise TelephonyError('La calibración del cliente no es válida.')
    for item in controls.values():
        if not isinstance(item, str) or len(item) > 160 or any(ord(c) < 32 for c in item):
            raise TelephonyError('La calibración del cliente no es válida.')
    populated = [item for item in controls.values() if item]
    if len(populated) != len(set(populated)):
        raise TelephonyError('Los controles del cliente deben tener identidades diferentes.')
    receipts = value['receipts']
    if not isinstance(receipts, dict) or set(receipts) != {'telephone', 'whatsapp_client'}:
        raise TelephonyError('Recibo de llamada no válido.')
    for item in receipts.values():
        if item is not None:
            try:
                if not isinstance(item, str) or str(UUID(item)) != item:
                    raise ValueError()
            except (ValueError, TypeError, AttributeError):
                raise TelephonyError('Recibo de llamada no válido.') from None
    return deepcopy(value)


class ClientSettings:
    def __init__(self, path):
        self.path = Path(path).absolute()

    def read(self):
        with LOCK:
            if self.path.resolve() != self.path:
                raise TelephonyError('La configuración no puede redirigirse.')
            if not self.path.exists():
                return deepcopy(DEFAULTS)
            try:
                if self.path.stat().st_size > 8192:
                    raise ValueError()
                return validate(json.loads(self.path.read_text(encoding='utf-8')))
            except (OSError, ValueError, TypeError):
                raise TelephonyError('No se pudo leer la configuración de WhatsApp.') from None

    def update(self, patch):
        if not isinstance(patch, dict) or set(patch) - (set(DEFAULTS) - {'version'}):
            raise TelephonyError('Ajuste de WhatsApp no válido.')
        with LOCK:
            value = validate({**self.read(), **patch})
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if self.path.resolve() != self.path:
                raise TelephonyError('La configuración no puede redirigirse.')
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.path.parent,
                                                 prefix='.whatsapp-', delete=False) as output:
                    temporary = Path(output.name)
                    json.dump(value, output, ensure_ascii=False)
                    output.flush(); os.fsync(output.fileno())
                os.replace(temporary, self.path)
            finally:
                if temporary:
                    temporary.unlink(missing_ok=True)
            return value

    def set_receipt(self, channel, identifier):
        if channel not in ('telephone', 'whatsapp_client'):
            raise TelephonyError('Canal de llamada no válido.')
        with LOCK:
            receipts = self.read()['receipts']
            receipts[channel] = identifier
            return self.update({'receipts': receipts})
