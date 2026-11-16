"""Desktop reviews a call locally, then Telnyx places it from this computer."""
from packages.runtime_paths import DATA_ROOT
import threading
import time
from uuid import UUID, uuid4

from services.telephony.common import ProviderError, TelephonyError, clean_text, number


def call_id(value):
    try:
        if str(UUID(value)) == value:
            return value
    except (ValueError, TypeError, AttributeError):
        pass
    raise TelephonyError('Llamada no válida.')


class TelephoneBridge:
    _call_review_lock = threading.Lock()

    def _client_call_settings(self):
        if not hasattr(self, '_whatsapp_call_settings'):
            from pathlib import Path
            from services.telephony.whatsapp_client_settings import ClientSettings
            self._whatsapp_call_settings = ClientSettings(
                DATA_ROOT / '.local/telephony/whatsapp-client.json')
        return self._whatsapp_call_settings

    def _gateway_for_channel(self, channel):
        if channel == 'telephone':
            return self._require_telephone_gateway()
        if channel != 'whatsapp_client':
            raise TelephonyError('Canal de llamada no válido.')
        if getattr(self, '_exit_requested', False):
            raise TelephonyError('Brivany se está cerrando.')
        if not hasattr(self, '_whatsapp_call_client'):
            from services.telephony.whatsapp_client import WhatsAppClientGateway
            settings = self._client_call_settings()
            settings.path.parent.mkdir(parents=True, exist_ok=True)
            self._whatsapp_call_client = WhatsAppClientGateway(settings.path.parent / 'whatsapp-client.sqlite3', settings)
        return self._whatsapp_call_client

    def workspace_telephone_channels(self):
        self._trusted()
        settings = self._client_call_settings().read()
        return {'selected': settings['selected_channel'], 'whatsapp_mode': settings['mode'], 'receipts': settings['receipts']}

    def workspace_telephone_forget_receipt(self, channel='telephone'):
        self._trusted()
        if channel not in ('telephone', 'whatsapp_client'):
            raise TelephonyError('Canal de llamada no válido.')
        active = getattr(self, '_telephone_active_route', None)
        if active and active[1] == channel and self._gateway_for_channel(channel).request('/v1/calls/' + active[0])['state'] not in {
                'completed', 'busy', 'no-answer', 'failed', 'canceled', 'interrupted', 'not-found'}:
            raise TelephonyError('Espera a que termine la llamada antes de cerrar su recibo.')
        settings = self._client_call_settings()
        settings.set_receipt(channel, None)
        return {'forgotten': True}

    def workspace_telephone_select_channel(self, channel):
        self._trusted()
        if channel not in ('telephone', 'whatsapp_client'):
            raise TelephonyError('Canal de llamada no válido.')
        with self._call_review_lock:
            pending = getattr(self, '_telephone_review', None)
            active = getattr(self, '_telephone_active_route', None)
            if pending or active and self._gateway_for_channel(active[1]).request('/v1/calls/' + active[0])['state'] not in {
                    'completed', 'busy', 'no-answer', 'failed', 'canceled', 'interrupted', 'not-found'}:
                raise TelephonyError('Termina o descarta la llamada antes de cambiar de canal.')
            self._client_call_settings().update({'selected_channel': channel})
        return self.workspace_telephone_channels()

    def _telephone_gateway(self):
        """Telnyx profile saved by `python -m tools.setup_telnyx provision`."""
        from services.telephony.call_control import load_environment
        import os
        load_environment()
        if os.getenv('TELNYX_CONNECTION_ID', '').strip():
            if not hasattr(self,'_call_control_host'):
                from services.telephony.control_host import ControlHost
                self._call_control_host=ControlHost()
            self._call_control_host.start()
            if not hasattr(self, '_telephone_client'):
                from services.telephony.call_control_client import ControlClient
                self._telephone_client = ControlClient()
            return self._telephone_client
        location = DATA_ROOT / '.local/telephony'
        if not (location / 'telnyx.dpapi').is_file():
            return None
        if not hasattr(self, '_telephone_client'):
            from services.telephony.telnyx import TelnyxGateway, load_profile
            account = load_profile(location / 'telnyx.dpapi')
            self._telephone_client = TelnyxGateway(location / 'telnyx.sqlite3', account)
        return self._telephone_client

    def _close_telephone(self):
        host=getattr(self,'_call_control_host',None)
        if host:host.close()
        gateway = getattr(self, '_telephone_client', None)
        close = getattr(gateway, 'close', None)
        if close:
            close()
        client = getattr(self, '_whatsapp_call_client', None)
        if client:
            client.close()

    def _require_telephone_gateway(self):
        if getattr(self, '_exit_requested', False):
            raise TelephonyError('Brivany se está cerrando.')
        gateway = self._telephone_gateway()
        if not gateway:
            raise TelephonyError('Conecta Telnyx para que Melodi pueda llamar.')
        return gateway

    def workspace_telephone_info(self, channel='telephone'):
        self._trusted()
        if channel == 'whatsapp_client':
            return self._gateway_for_channel(channel).request('/v1/info')
        if channel != 'telephone':
            raise TelephonyError('Canal de llamada no válido.')
        gateway = self._telephone_gateway()
        if not gateway:
            return {'configured': False, 'outbound': False, 'voicemail': False}
        return gateway.request('/v1/info')

    def workspace_telephone_prepare(self, destination, objective, channel='telephone'):
        self._trusted()
        gateway = self._gateway_for_channel(channel)
        draft = {'id': str(uuid4()), 'destination': number(destination), 'objective': clean_text(objective, 600)}
        if channel == 'whatsapp_client':
            info = gateway.request('/v1/info')
            if not info['outbound']:
                raise TelephonyError(info['reason'])
            draft.update(channel=channel, mode=info['mode'], simulation=info['simulation'])
        with self._call_review_lock:
            self._telephone_review = (draft, time.monotonic() + 120)
        return dict(draft)

    def workspace_telephone_discard(self, identifier):
        self._trusted()
        identifier = call_id(identifier)
        with self._call_review_lock:
            pending = getattr(self, '_telephone_review', None)
            if pending and pending[0]['id'] == identifier:
                self._telephone_review = None
        return {'discarded': True}

    def workspace_telephone_confirm(self, identifier):
        self._trusted()
        identifier = call_id(identifier)
        with self._call_review_lock:
            pending = getattr(self, '_telephone_review', None)
            if not pending or pending[0]['id'] != identifier or pending[1] < time.monotonic():
                raise TelephonyError('Revisa el encargo antes de llamar.')
            channel = pending[0].get('channel', 'telephone')
            gateway = self._gateway_for_channel(channel)
            active = getattr(self, '_telephone_active_route', None)
            if active and self._gateway_for_channel(active[1]).request('/v1/calls/' + active[0])['state'] not in {
                    'completed', 'busy', 'no-answer', 'failed', 'canceled', 'interrupted', 'not-found'}:
                raise TelephonyError('Espera a que termine la llamada anterior.')
            self._telephone_review = None
            self._telephone_active_route = identifier, channel
            settings = self._client_call_settings()
            settings.set_receipt(channel, identifier)
        try:
            payload = {key: value for key, value in pending[0].items() if key != 'simulation'}
            return gateway.request('/v1/calls', payload)
        except ProviderError as error:
            if error.uncertain:
                return {'id': identifier, 'destination': pending[0]['destination'], 'state': 'uncertain',
                        'result': 'No se pudo confirmar el envío. Consulta el estado antes de volver a llamar.'}
            raise

    def workspace_telephone_status(self, identifier, channel='telephone'):
        self._trusted()
        return self._gateway_for_channel(channel).request('/v1/calls/' + call_id(identifier))

    def workspace_telephone_cancel(self, identifier, channel='telephone'):
        self._trusted()
        return self._gateway_for_channel(channel).request('/v1/calls/' + call_id(identifier) + '/cancel', {})

    def workspace_telephone_mailbox(self, channel='telephone'):
        self._trusted()
        return self._gateway_for_channel(channel).request('/v1/voicemails')

    def workspace_telephone_recording(self, identifier):
        self._trusted()
        raise TelephonyError('El buzón de Melodi no está disponible: las llamadas entrantes siguen en tu móvil.')
