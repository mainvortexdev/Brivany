"""Desktop's reviewed-call interface to the dedicated local Call Control service."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from .call_control import ControlConfig, request_id
from .common import ProviderError, TelephonyError
from .telnyx import NoRedirect


class ControlClient:
    def __init__(self, config=None):
        self.config = config or ControlConfig.environment()

    def request(self, path, value=None):
        method = 'GET' if value is None else 'POST'
        if path == '/v1/info':
            route = '/api/calls/info'
        elif path == '/v1/voicemails':
            return {'messages': []}
        elif path == '/v1/calls' and isinstance(value, dict):
            route = '/api/calls/outbound'
            value = {'id': value['id'], 'to': value['destination'], 'objective': value['objective'],
                     'mode': 'conversation', 'confirmed': True}
        elif path.startswith('/v1/calls/'):
            identifier = request_id(path.split('/')[3])
            route = '/api/calls/' + identifier
            if path.endswith('/cancel'):
                route += '/hangup'
            elif path != '/v1/calls/' + identifier:
                raise TelephonyError('Ruta de llamada no válida.')
        else:
            raise TelephonyError('Ruta de llamada no válida.')
        raw = None if value is None else json.dumps(value).encode('utf-8')
        request = Request(f'http://127.0.0.1:{self.config.port}' + route, raw,
                          {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.config.token}, method=method)
        try:
            with build_opener(NoRedirect()).open(request, timeout=25) as response:
                body = response.read(65537)
                if len(body) > 65536:
                    raise ValueError()
                return json.loads(body)
        except HTTPError as error:
            try:
                result = json.loads(error.read(8192))
            except ValueError:
                result = {}
            finally:
                error.close()
            raise ProviderError(result.get('error', 'El servicio local rechazó la operación.'),
                                uncertain=bool(result.get('uncertain')), http_status=error.code,
                                provider_code=result.get('provider_code')) from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise ProviderError('Inicia el servicio Call Control de Melodi en este equipo.', uncertain=method == 'POST') from None

    def close(self):
        pass  # The dedicated process owns the live call, not a panel's lifetime.
