"""Operate the dedicated demo account without printing provider credentials.

provision: store new operational secrets in DPAPI, upload via Wrangler stdin,
and initialize the disabled account. enable/revoke are explicit operations.
setup-code: display the short-lived, one-use provider enrollment code only.
"""
from pathlib import Path
import argparse
import base64
import json
import secrets
import subprocess
import time
from urllib.request import Request,build_opener
from urllib.error import HTTPError
from services.google_oauth import WindowsDPAPIProtector
from services.brivany_account import NoRedirect

ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'.local/demo-jon'
ORIGIN='https://demo.brivany.vetsa.es'

def operations(create=False):
    file=FOLDER/'operations.dpapi';protector=WindowsDPAPIProtector()
    if not file.exists():
        if not create:raise ValueError('No local demo operations profile exists.')
        value={'admin':secrets.token_urlsafe(32),'setup':secrets.token_urlsafe(32),'data_key':base64.b64encode(secrets.token_bytes(32)).decode(),'invitation':secrets.token_urlsafe(32),'expires_at':int((time.time()+30*86400)*1000)}
        FOLDER.mkdir(parents=True,exist_ok=True);file.write_bytes(protector.protect(json.dumps(value).encode()))
    return json.loads(protector.unprotect(file.read_bytes()))

def call(ops,path,value=None):
    request=Request(ORIGIN+path,data=None if value is None else json.dumps(value).encode(),headers={'Authorization':'Bearer '+ops['admin'],'Content-Type':'application/json','Accept':'application/json','User-Agent':'Brivany-Desktop/0.2.1'},method='GET' if value is None else 'POST')
    try:
        with build_opener(NoRedirect()).open(request,timeout=45) as response:
            raw=response.read(65537)
            if len(raw)>65536:raise ValueError('Demo response too large.')
            return json.loads(raw)
    except HTTPError as error:
        status=error.code
        try:code=json.loads(error.read(8192)).get('error','request_failed')
        except (ValueError,OSError):code='request_failed'
        finally:error.close()
        raise ValueError('Demo HTTP '+str(status)+': '+str(code)) from None

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['provision','status','enable','revoke','setup-code']);args=parser.parse_args();ops=operations(args.action=='provision')
    if args.action=='provision':
        values={'DEMO_ADMIN_TOKEN':ops['admin'],'DEMO_SETUP_TOKEN':ops['setup'],'DEMO_DATA_KEY':ops['data_key']}
        command=['node',str(ROOT/'workers/whatsapp/node_modules/wrangler/bin/wrangler.js'),'secret','bulk','--config',str(ROOT/'workers/demo/wrangler.jsonc')]
        result=subprocess.run(command,cwd=ROOT,input=json.dumps(values),text=True,capture_output=True,timeout=90,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode:
            (FOLDER/'wrangler-result.dpapi').write_bytes(WindowsDPAPIProtector().protect((result.stdout+result.stderr).encode()));raise ValueError('Secret upload failed; diagnostic encrypted locally.')
        try:state=call(ops,'/admin/status')
        except ValueError as error:
            if 'demo_not_configured' not in str(error):raise
            state=call(ops,'/admin/configure',{'name':'Equipo de Jon Hernández','invitation':ops['invitation'],'expiresAt':ops['expires_at'],'budgetMicros':5000000})
        bootstrap={'schema':1,'origin':ORIGIN,'invitation':ops['invitation'],'account_name':'Equipo de Jon Hernández'}
        (FOLDER/'bootstrap.json').write_text(json.dumps(bootstrap,ensure_ascii=False),encoding='utf-8')
        print(json.dumps({'provisioned':True,'enabled':state['enabled'],'budget_usd':state['budget_usd'],'provider_slots':state['providers'],'bootstrap_saved_privately':True}))
    elif args.action=='setup-code':
        window=call(ops,'/admin/setup-window',{});print(json.dumps({'one_use_provider_setup_code':ops['setup'],'expires_in_seconds':window['expires_in_seconds']}))
    else:print(json.dumps(call(ops,'/admin/'+args.action,None if args.action=='status' else {}),ensure_ascii=False))

if __name__=='__main__':main()
