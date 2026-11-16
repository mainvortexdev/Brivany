"""Deploy the reviewed private relay; pipe secrets to Wrangler, never argv/files."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
from urllib.request import Request,build_opener
from packages.providers.live_voice import NoRedirect,cloudflare_token
from services.private_store import PrivateStore

ROOT=Path(__file__).resolve().parents[1]
ACCOUNT='62a87427406c2ed15f92d4da29116214'
NAME='brivany-melodi-chat'
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if not args.apply:parser.error('--apply publica el relay revisado y configura sus secretos privados.')
    vault=PrivateStore(Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data/.local/chat/provider.dpapi');value=vault.read()
    if not value.get('api_key'):raise ValueError('Falta la clave cifrada de SiliconFlow.')
    os.environ['BRIVANY_CLOUDFLARE_USE_WRANGLER']='true';admin=cloudflare_token(refresh=True)
    opener=build_opener(NoRedirect())
    listed=json.load(opener.open(Request(f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts',headers={'Authorization':'Bearer '+admin}),timeout=20))
    if any(row.get('id')==NAME for row in listed.get('result',[])) and not value.get('relay_prepared'):raise ValueError('El relay ya existe; revisar antes de reemplazarlo.')
    value.setdefault('client_token',secrets.token_urlsafe(48));value['relay_prepared']=True;vault.write(value)
    cli=Path(os.environ['APPDATA'])/'npm/node_modules/wrangler/bin/wrangler.js'
    config=ROOT/'workers/melodi-chat/wrangler.jsonc'
    def command(args,input=None):
        completed=subprocess.run(['node',str(cli),*args,'--config',str(config)],cwd=ROOT,input=input,text=True,encoding='utf-8',errors='replace',capture_output=True,timeout=180,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if completed.returncode:raise ValueError('Wrangler no completó '+args[0]+'. Se conservaron las claves cifradas; no se imprimen detalles privados.')
        return completed.stdout
    output=command(['deploy']);match=re.search(r'https://brivany-melodi-chat\.[a-z0-9-]+\.workers\.dev',output)
    if not match:raise ValueError('No se pudo confirmar la URL del relay.')
    value.update(relay_url=match[0],model='deepseek-ai/DeepSeek-V4-Flash',enabled=False);vault.write(value)
    command(['secret','bulk'],input=json.dumps({'SILICONFLOW_API_KEY':value['api_key'],'CLIENT_TOKEN':value['client_token']}))
    health=json.load(opener.open(Request(value['relay_url']+'/health',headers={'User-Agent':'BrivanyDesktop/0.1.0'}),timeout=20))
    if not health.get('ready'):raise ValueError('El relay todavía no está preparado.')
    print(json.dumps({'ready':True,'url':value['relay_url'],'key_storage':'Windows DPAPI and Cloudflare Workers secrets','enabled':False}))
if __name__=='__main__':main()
