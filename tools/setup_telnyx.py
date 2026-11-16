"""Connect Melodi to Telnyx from this computer. Run each step explicitly.

The API key is read from `.env` (BRIVANY_TELNYX_API_KEY) and never printed.
Only `provision`, `verify-caller`, `verify-code` and `buy` change the Telnyx
account; `buy` also needs --confirm-purchase. Nothing here dials a phone.

  python -m tools.setup_telnyx status
  python -m tools.setup_telnyx numbers --country US
  python -m tools.setup_telnyx buy --number +1XXXXXXXXXX --confirm-purchase
  python -m tools.setup_telnyx verify-caller --number +1809XXXXXXX --method sms
  python -m tools.setup_telnyx verify-code --number +1809XXXXXXX --code 123456
  python -m tools.setup_telnyx provision --caller +1XXXXXXXXXX --countries DO,US
  python -m tools.setup_telnyx check-sip
"""
import argparse
import json
import sys
from uuid import uuid4

from packages.runtime_paths import DATA_ROOT
from services.h1.server import load_local_config
from services.telephony.common import TelephonyError, masked, number
from services.telephony.telnyx import (NAME, SERVERS, TelnyxAPI, load_profile,
                                       provision, save_profile)

PROFILE = DATA_ROOT / '.local/telephony/telnyx.dpapi'


def saved():
    return load_profile(PROFILE) if PROFILE.is_file() else None


def status(api):
    balance = api.balance()
    owned = api.phone_numbers()
    verified = api.verified_numbers()
    account = saved()
    connections = [item for item in api.items('/credential_connections') if item.get('connection_name') == NAME]
    profiles = [item for item in api.items('/outbound_voice_profiles') if item.get('name') == NAME]
    result = {
        'api_key': 'aceptada',
        'balance': {key: balance.get(key) for key in ('balance', 'available_credit', 'currency')},
        'owned_numbers': [{'number': masked(item.get('phone_number')), 'type': item.get('phone_number_type')} for item in owned],
        'verified_numbers': [masked(item.get('phone_number')) for item in verified],
        'brivany_connection_in_telnyx': bool(connections),
        'brivany_outbound_profile_in_telnyx': bool(profiles),
        'allowed_countries': profiles[0].get('whitelisted_destinations') if profiles else [],
        'saved_on_this_computer': account.public() if account else None,
    }
    steps = []
    if not owned and not verified:
        steps.append('Elige un número emisor: compra uno (numbers + buy) o verifica el tuyo (verify-caller).')
    if not account:
        steps.append('Ejecuta provision --caller <número> para crear la conexión de Brivany.')
    elif not account.caller_id:
        steps.append('Vuelve a ejecutar provision con --caller para fijar el número emisor.')
    result['next_steps'] = steps or ['Listo: ejecuta check-sip y después la primera llamada.']
    return result


def check_sip(account):
    """Register only: no INVITE and no phone number is sent."""
    from services.telephony.sip import NativeSIP
    events = []
    native = NativeSIP(account.engine(), str(uuid4()), events.append)
    try:
        native.connect()
        return {'sip_registration': 'activa', 'sip_status': native.registration_status,
                'server': account.server, 'calls_placed': 0}
    except TelephonyError:
        return {'sip_registration': 'fallida', 'sip_status': native.registration_status,
                'server': account.server, 'calls_placed': 0,
                'hint': 'Revisa que PJSUA2 esté instalado y que el firewall permita UDP 5060 saliente.'}
    finally:
        native.shutdown()


def main(argv=None):
    parser = argparse.ArgumentParser(description='Conecta Melodi con Telnyx.')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('status', help='Saldo, números y estado de la conexión. Solo lectura.')
    search = commands.add_parser('numbers', help='Busca números disponibles y su precio. Solo lectura.')
    search.add_argument('--country', default='US')
    search.add_argument('--type', default='local', choices=['local', 'toll_free', 'mobile', 'national'])
    buy = commands.add_parser('buy', help='Compra un número (cobra en tu cuenta).')
    buy.add_argument('--number', required=True)
    buy.add_argument('--confirm-purchase', action='store_true')
    verify = commands.add_parser('verify-caller', help='Pide a Telnyx un código para usar tu número como emisor.')
    verify.add_argument('--number', required=True)
    verify.add_argument('--method', default='sms', choices=['sms', 'call'])
    code = commands.add_parser('verify-code', help='Envía el código recibido.')
    code.add_argument('--number', required=True)
    code.add_argument('--code', required=True)
    setup = commands.add_parser('provision', help='Crea o actualiza la conexión SIP de Brivany y la guarda cifrada.')
    setup.add_argument('--caller', default='', help='Número emisor tuyo en Telnyx o verificado, en formato +1…')
    setup.add_argument('--countries', default='DO,US', help='Países permitidos, separados por comas.')
    setup.add_argument('--daily-limit', type=float, default=5.0, help='Gasto máximo diario en USD.')
    setup.add_argument('--max-rate', type=float, default=0.30, help='Tarifa máxima por minuto en USD.')
    setup.add_argument('--region', default='us', choices=sorted(SERVERS))
    setup.add_argument('--transport', default='udp', choices=['udp', 'tcp', 'tls'])
    commands.add_parser('check-sip', help='Comprueba el registro SIP sin llamar.')
    args = parser.parse_args(argv)

    load_local_config()
    try:
        if args.command == 'check-sip':
            account = saved()
            if not account:
                raise TelephonyError('Primero ejecuta provision.')
            result = check_sip(account)
        else:
            api = TelnyxAPI.from_environment()
            if args.command == 'status':
                result = status(api)
            elif args.command == 'numbers':
                found = api.available_numbers(args.country.upper(), args.type)
                result = {'country': args.country.upper(), 'numbers': [
                    {'number': item.get('phone_number'),
                     'monthly_usd': (item.get('cost_information') or {}).get('monthly_cost'),
                     'upfront_usd': (item.get('cost_information') or {}).get('upfront_cost'),
                     'features': [f.get('name') for f in item.get('features', []) if isinstance(f, dict)]}
                    for item in found]}
            elif args.command == 'buy':
                if not args.confirm_purchase:
                    raise TelephonyError('La compra cobra en tu cuenta. Repite con --confirm-purchase.')
                account = saved()
                order = api.order_number(args.number, account.connection_id if account else '')
                result = {'order_status': order.get('status'), 'number': masked(number(args.number)),
                          'next_step': 'Cuando el pedido esté en success, ejecuta provision --caller con ese número.'}
            elif args.command == 'verify-caller':
                api.request_verification(args.number, args.method)
                result = {'requested': True, 'number': masked(number(args.number)), 'method': args.method,
                          'next_step': 'Cuando recibas el código, ejecuta verify-code.'}
            elif args.command == 'verify-code':
                api.submit_verification(args.number, args.code)
                result = {'verified': True, 'number': masked(number(args.number))}
            else:
                from services.google_oauth import WindowsDPAPIProtector
                if not WindowsDPAPIProtector().available:
                    raise TelephonyError('Ejecuta provision en el Windows donde usas Brivany: la conexión se guarda cifrada con tu usuario.')
                account = provision(api, caller_id=args.caller,
                                    countries=args.countries.split(','), daily_limit=args.daily_limit,
                                    max_rate=args.max_rate, region=args.region, transport=args.transport)
                save_profile(PROFILE, account)
                result = {'saved': True, 'connection': account.public(), 'calls_placed': 0,
                          'next_step': 'python -m tools.setup_telnyx check-sip'}
    except TelephonyError as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False, indent=2))
        return 1
    ok = args.command != 'check-sip' or result.get('sip_registration') == 'activa'
    print(json.dumps({'ok': ok, **result}, ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
