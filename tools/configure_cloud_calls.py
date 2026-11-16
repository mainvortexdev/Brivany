"""Copy only the existing phone/voice configuration to the private cloud service.

Never prints values or writes an unencrypted credential file. No purchase,
number provisioning, provider-profile change or telephone dial is performed.
"""
from __future__ import annotations
import base64
import json
import os
from pathlib import Path
import secrets
import tomllib
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from services.brivany_account import SecureAccountFile

ROOT=Path(__file__).resolve().parents[1]
ACCOUNT='62a87427406c2ed15f92d4da29116214'
SCRIPT='brivany-calls'
NAMES=('TELNYX_API_KEY','TELNYX_CONNECTION_ID','TELNYX_FROM_NUMBER','TELNYX_PUBLIC_KEY',
       'BRIVANY_META_API_KEY','BRIVANY_META_MODEL','BRIVANY_MUSE_API_KEY','BRIVANY_CARTESIA_API_KEY')

def main():
    values={}
    for path in (ROOT/'.env',Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data/.env'):
        if path.is_file():
            for line in path.read_text(encoding='utf-8-sig').splitlines():
                if '=' not in line or line.lstrip().startswith('#'):continue
                name,value=(part.strip() for part in line.split('=',1))
                if name in NAMES or name=='BRIVANY_TELNYX_API_KEY':values[name]=value.strip('\"\'')
    values['TELNYX_API_KEY']=values.get('TELNYX_API_KEY') or values.get('BRIVANY_TELNYX_API_KEY','')
    missing=[name for name in NAMES if name!='BRIVANY_MUSE_API_KEY' and not values.get(name)]
    if missing:raise SystemExit('Falta configuración existente: '+', '.join(missing))
    config=tomllib.loads((Path(os.environ['APPDATA'])/'xdg.config/.wrangler/config/default.toml').read_text(encoding='utf-8'))
    token=config.get('oauth_token')
    def api(path,body=None):
        request=Request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='PUT' if body is not None else 'GET')
        try:
            with urlopen(request,timeout=25) as response:result=json.load(response)
        except HTTPError as error:raise SystemExit('Cloudflare HTTP '+str(error.code)) from None
        if not result.get('success'):raise SystemExit('Cloudflare no aceptó la configuración.')
        return result['result']
    settings=api('/workers/scripts/'+SCRIPT+'/settings')
    path=Path(os.environ['LOCALAPPDATA'])/'Brivany/migration-backups/20261114-whatsapp-desktop/calls-encryption.dpapi'
    secure=SecureAccountFile(path)
    if path.is_file():protected=secure.load()
    else:
        if any(b.get('name')=='CALLS_ENCRYPTION_KEY' for b in settings.get('bindings',[])):raise SystemExit('La clave cloud existente se conserva; falta su respaldo local.')
        protected={'key':base64.b64encode(secrets.token_bytes(32)).decode()};path.parent.mkdir(parents=True,exist_ok=True);secure.save(protected)
    values['CALLS_ENCRYPTION_KEY']=protected['key'];updated=[]
    for name in (*NAMES,'CALLS_ENCRYPTION_KEY'):
        if values.get(name):api('/workers/scripts/'+SCRIPT+'/secrets',{'name':name,'type':'secret_text','text':values[name]});updated.append(name)
    print(json.dumps({'worker':SCRIPT,'secretNamesConfigured':updated,'encryptionBackup':'DPAPI','dialed':False}))

if __name__=='__main__':main()
