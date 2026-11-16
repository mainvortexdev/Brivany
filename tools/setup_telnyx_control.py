"""Explicit Call Control provisioning; never dials, buys or rotates SIP credentials."""
import argparse
import json
import os
from pathlib import Path
import secrets
import sys

from packages.runtime_paths import CONFIG_PATH
from services.h1.server import load_local_config
from services.telephony.call_control import APP_NAME, ControlConfig, load_environment, public_key, public_origin, rd_number
from services.telephony.common import TelephonyError, masked
from services.telephony.telnyx import NAME, TelnyxAPI, caller_allowed


def save_environment(values, path=CONFIG_PATH):
    """Merge only these keys, preserving other chats' unrelated configuration."""
    path = Path(path)
    for _ in range(3):
        original = path.read_bytes() if path.is_file() else b''
        text = original.decode('utf-8-sig')
        newline = '\r\n' if '\r\n' in text else '\n'
        seen, lines = set(), []
        for line in text.splitlines():
            key = line.split('=', 1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else ''
            if key in values:
                if key not in seen:
                    lines.append(key + '=' + values[key])
                    seen.add(key)
            else:
                lines.append(line)
        lines += [key + '=' + value for key, value in values.items() if key not in seen]
        temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
        try:
            temporary.write_bytes((newline.join(lines) + newline).encode('utf-8'))
            if (path.read_bytes() if path.is_file() else b'') != original:
                continue
            temporary.replace(path)
            return
        finally:
            temporary.unlink(missing_ok=True)
    raise TelephonyError('La configuración cambió durante el guardado; no se sobrescribió.')


def provision_control(origin, caller, *, api=None, path=CONFIG_PATH, port=8791):
    load_local_config()
    load_environment(path)
    origin, caller = public_origin(origin), rd_number(caller)
    api = api or TelnyxAPI.from_environment()
    if not caller_allowed(api, caller):
        raise TelephonyError('El emisor solicitado no está verificado en esta cuenta Telnyx.')
    verification = api.request('GET', '/public_key').get('data') or {}
    key = verification.get('public') or verification.get('public_key') or ''
    public_key(key)
    profiles = [item for item in api.items('/outbound_voice_profiles') if item.get('name') == NAME]
    if len(profiles) > 1:
        raise TelephonyError('Hay varios perfiles Brivany Melodi; selecciona uno antes de configurar.')
    body = {'name': NAME, 'traffic_type': 'conversational', 'service_plan': 'global',
            'whitelisted_destinations': ['DO', 'US'], 'concurrent_call_limit': 1,
            'daily_spend_limit': '5.00', 'daily_spend_limit_enabled': True,
            'max_destination_rate': .30, 'enabled': True}
    profile = api.request('PATCH', '/outbound_voice_profiles/' + str(profiles[0]['id']), body)['data'] if profiles else api.request('POST', '/outbound_voice_profiles', body)['data']
    applications = [item for item in api.items('/call_control_applications') if item.get('application_name') == APP_NAME]
    if len(applications) > 1:
        raise TelephonyError('Hay varias aplicaciones de Melodi con el mismo nombre.')
    body = {'application_name': APP_NAME, 'active': True, 'webhook_event_url': origin + '/webhooks/telnyx',
            'webhook_api_version': '2', 'webhook_timeout_secs': 10, 'dtmf_type': 'RFC 2833',
            'first_command_timeout': True, 'first_command_timeout_secs': 30,
            'call_cost_in_webhooks': True, 'redact_dtmf_debug_logging': True,
            'outbound': {'channel_limit': 1, 'outbound_voice_profile_id': str(profile['id'])}}
    application = api.request('PATCH', '/call_control_applications/' + str(applications[0]['id']), body)['data'] if applications else api.request('POST', '/call_control_applications', body)['data']
    token = os.getenv('BRIVANY_TELNYX_CONTROL_TOKEN', '') or secrets.token_urlsafe(32)
    config = ControlConfig(str(application['id']), caller, origin, key, token, port)
    # Read the saved application, not only the create/patch response.
    saved = api.request('GET', '/call_control_applications/' + config.connection_id)['data']
    if (saved.get('active') is not True or saved.get('webhook_event_url') != config.webhook
            or str(saved.get('webhook_api_version')) != '2'
            or str((saved.get('outbound') or {}).get('outbound_voice_profile_id')) != str(profile['id'])):
        raise TelephonyError('La aplicación guardada no coincide con la configuración solicitada.')
    values = {'TELNYX_API_KEY': api._key, 'TELNYX_CONNECTION_ID': config.connection_id,
              'TELNYX_FROM_NUMBER': caller, 'WEBHOOK_BASE_URL': origin,
              'TELNYX_PUBLIC_KEY': key, 'BRIVANY_TELNYX_CONTROL_TOKEN': token,
              'BRIVANY_TELNYX_CONTROL_PORT': str(port)}
    save_environment(values, path)
    for name, value in values.items():
        os.environ[name] = value
    return config


def reconnect_control(origin, *, api=None, path=CONFIG_PATH, port=8791):
    """Rebind the existing application without changing caller, rates or limits."""
    load_local_config();load_environment(path)
    origin=public_origin(origin);existing=ControlConfig.environment();api=api or TelnyxAPI.from_environment()
    endpoint='/call_control_applications/'+existing.connection_id
    saved=api.request('GET',endpoint)['data']
    if saved.get('application_name')!=APP_NAME or saved.get('active') is not True:
        raise TelephonyError('La aplicación de Telnyx no corresponde al servicio activo de Melodi.')
    api.request('PATCH',endpoint,{'webhook_event_url':origin+'/webhooks/telnyx'})
    confirmed=api.request('GET',endpoint)['data']
    if confirmed.get('webhook_event_url')!=origin+'/webhooks/telnyx':raise TelephonyError('Telnyx no confirmó el nuevo webhook.')
    values={'WEBHOOK_BASE_URL':origin,'BRIVANY_TELNYX_CONTROL_PORT':str(port)}
    save_environment(values,path)
    for key,value in values.items():os.environ[key]=value
    return ControlConfig(existing.connection_id,existing.from_number,origin,existing.verification_key,existing.token,port)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Configura Telnyx Call Control v2 sin llamar.')
    parser.add_argument('--webhook-base', required=True)
    parser.add_argument('--from-number', required=True)
    parser.add_argument('--port', type=int, default=8791)
    args = parser.parse_args(argv)
    try:
        config = provision_control(args.webhook_base, args.from_number, port=args.port)
        print(json.dumps({'configured': True, 'application': APP_NAME, 'connection_id': config.connection_id,
                          'caller_id': masked(config.from_number), 'webhook': config.webhook, 'calls_placed': 0}, ensure_ascii=False))
        return 0
    except TelephonyError as error:
        print(json.dumps({'configured': False, 'error': str(error)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
