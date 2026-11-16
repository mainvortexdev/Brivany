"""General Melodi text inference through an explicitly configured AI Gateway."""
import os
import re
from packages.runtime_paths import DATA_ROOT
from services.private_store import PrivateStore

def store():return PrivateStore(DATA_ROOT/'.local/chat/provider.dpapi')
def status():
    value=store().read()
    return {'provider':'siliconflow' if value.get('enabled') else 'meta','configured':bool(value.get('api_key')),
            'model':value.get('model','deepseek-ai/DeepSeek-V4-Flash'),'via_cloudflare':bool(value.get('gateway_id') or value.get('relay_url')),
            'enabled':value.get('enabled',False),'encrypted':True}
def configuration():
    from packages.providers.provider_access import enabled
    if enabled():return None
    value=store().read()
    if not value.get('enabled'):return None
    relay=value.get('relay_url','')
    if relay:
        if not re.fullmatch(r'https://brivany-melodi-chat\.[a-z0-9-]+\.workers\.dev',relay) or not re.fullmatch(r'[A-Za-z0-9_-]{40,128}',value.get('client_token','')):raise ValueError('Conexión privada de Cloudflare no válida.')
        return {'key':value['client_token'],'model':value.get('model','deepseek-ai/DeepSeek-V4-Flash'),'endpoint':relay+'/v1/chat/completions','name':'DeepSeek · SiliconFlow · Cloudflare'}
    account=value.get('account_id','');gateway=value.get('gateway_id','');slug=value.get('provider_slug','siliconflow')
    if not re.fullmatch(r'[a-f0-9]{32}',account) or not re.fullmatch(r'[a-z0-9-]{1,64}',gateway) or not re.fullmatch(r'[a-z0-9-]{1,64}',slug):raise ValueError('Configura la conexión de Cloudflare para Melodi.')
    model=value.get('model','')
    if not re.fullmatch(r'deepseek-ai/DeepSeek-V4(?:\.1)?-Flash(?:-[A-Za-z0-9-]+)?',model):raise ValueError('Modelo de conversación no válido.')
    return {'key':value['api_key'],'model':model,'endpoint':f'https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-{slug}/v1/chat/completions','name':'DeepSeek · SiliconFlow · Cloudflare'}
