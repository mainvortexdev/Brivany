"""Deploy only the reviewed /transfer routes; provision secrets via pipes/DPAPI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from urllib.request import Request,build_opener
from packages.providers.live_voice import NoRedirect,cloudflare_token
from services.private_store import PrivateStore

ROOT=Path(__file__).resolve().parents[1]
ACCOUNT='62a87427406c2ed15f92d4da29116214'
ZONE='6df9d222150b08f8b6d0603cec47b8c9'
NAME='brivany-file-transfer'
ORIGIN='https://brivany.vetsa.es'
PATTERNS={'brivany.vetsa.es/transfer','brivany.vetsa.es/transfer/*'}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if not args.apply:parser.error('--apply publica únicamente el servicio de archivos revisado.')
    os.environ['BRIVANY_CLOUDFLARE_USE_WRANGLER']='true';admin=cloudflare_token(refresh=True)
    opener=build_opener(NoRedirect())
    def public(path):
        with opener.open(Request(ORIGIN+path,headers={'User-Agent':'BrivanyDesktop/0.1.0'}),timeout=25) as response:
            if response.url!=ORIGIN+path:raise ValueError('El dominio cambió de destino.')
            return response.read()
    def api(path):
        with opener.open(Request('https://api.cloudflare.com/client/v4/'+path,headers={'Authorization':'Bearer '+admin,'User-Agent':'BrivanyDesktop/0.1.0'}),timeout=25) as response:
            value=json.load(response)
        if not value.get('success'):raise ValueError('Cloudflare no confirmó la consulta de configuración.')
        return value['result']
    before=hashlib.sha256(public('/')).hexdigest()
    old_routes={(r['pattern'],r['script']) for r in api('zones/'+ZONE+'/workers/routes')}
    if any(pattern in PATTERNS and script!=NAME for pattern,script in old_routes):raise ValueError('Una ruta de transferencia pertenece a otro servicio. No se reemplazó.')
    vault=PrivateStore(Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data/.local/phone/official.dpapi');value=vault.read()
    listed=api('accounts/'+ACCOUNT+'/workers/scripts')
    if any(row.get('id')==NAME for row in listed) and not value.get('relay_prepared'):raise ValueError('El servicio ya existe y no pertenece a esta preparación local.')
    cli=Path(os.environ['APPDATA'])/'npm/node_modules/wrangler/bin/wrangler.js';config=ROOT/'workers/file-transfer/wrangler.jsonc'
    def run(arguments,private_input=None,config_file=True):
        env={**os.environ,'CLOUDFLARE_API_TOKEN':admin,'WRANGLER_SEND_METRICS':'false'}
        result=subprocess.run(['node',*arguments,*(['--config',str(config)] if config_file else [])],cwd=ROOT,env=env,input=private_input,text=True,encoding='utf-8',errors='replace',capture_output=True,timeout=180,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode:
            # Wrangler output is never persisted: secret input and OAuth data stay private.
            raise ValueError('No se completó el paso '+('Wrangler '+arguments[1] if str(cli)==arguments[0] else 'de compilación')+'. No se imprimen datos privados.')
    run(['workers/file-transfer/build.mjs'],config_file=False)
    run([str(cli),'deploy','--dry-run','--outdir',str(ROOT/'tmp/official-transfer-dry')])
    value.setdefault('issuer_token',secrets.token_urlsafe(48));value['relay_prepared']=True;vault.write(value)
    run([str(cli),'deploy'])
    run([str(cli),'secret','bulk'],json.dumps({'ISSUER_TOKEN':value['issuer_token']}))
    # Secrets and route updates propagate independently. Verify the exact public
    # client as well as readiness rather than accepting a previous deployment.
    assets={'/transfer/':'index.html','/transfer/phone.js':'phone.js','/transfer/phone.css':'phone.css','/transfer/drop/':'drop.html','/transfer/drop/phone.js':'drop.js','/transfer/drop/phone.css':'drop.css','/transfer/drop/locales.js':'drop-locales.js','/transfer/drop/storage-worker.js':'drop-storage-worker.js'}
    for attempt in range(8):
        health=json.loads(public('/transfer/health'))
        drop_health=json.loads(public('/transfer/drop/health'))
        exact=all(public(route)==(ROOT/'workers/file-transfer/client'/name).read_bytes() for route,name in assets.items())
        exact=exact and public('/transfer/drop/peer.js')==(ROOT/'desktop/experience/drop-peer.js').read_bytes()
        if health.get('ready') and health.get('protocol')==1 and drop_health.get('ready') and drop_health.get('protocol')==2 and drop_health.get('max_file_bytes')==1073741824 and exact:break
        if attempt==7:raise ValueError('La configuración aún no se ha propagado. La clave cifrada se conserva para reintentar.')
        time.sleep(3)
    new_routes={(r['pattern'],r['script']) for r in api('zones/'+ZONE+'/workers/routes')}
    if not old_routes.issubset(new_routes) or new_routes-old_routes-{(p,NAME) for p in PATTERNS}:raise ValueError('La revisión de rutas requiere atención; no se modificaron otros servicios intencionadamente.')
    if not {(p,NAME) for p in PATTERNS}.issubset(new_routes):raise ValueError('Falta una ruta oficial de transferencia.')
    unchanged=before==hashlib.sha256(public('/')).hexdigest()
    if not unchanged:raise ValueError('La huella de la página principal cambió; revisar antes de activar el cliente.')
    value.update(origin=ORIGIN,protocol=2,ready=True);vault.write(value)
    report={'ready':True,'origin':ORIGIN,'worker':NAME,'routes':sorted(PATTERNS),'homepage_unchanged':unchanged,'other_routes_preserved':True,'public_assets_match_source':exact,'key_storage':'Windows DPAPI and Cloudflare Workers secret','protocol':2,'bidirectional':True,'invite_seconds':600,'session_seconds':21600,'max_file_bytes':1073741824,'legacy_v1_preserved':True,'billing_plan_changed':False}
    destination=ROOT/'tmp/official-transfer-deployment.json';destination.parent.mkdir(exist_ok=True);destination.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))

if __name__=='__main__':main()
