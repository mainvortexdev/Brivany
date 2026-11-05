"""Explicit metadata-only check, never generates text/audio or retries."""
import argparse
from datetime import datetime, timezone
import json
import hashlib
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener
from packages.providers.live_voice import NoRedirect
from services.h1.server import load_local_config
from packages.providers.river_translation import ACCESS_PATH
from packages.providers.meta_translation import meta_translation_status


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check-access',action='store_true')
    parser.add_argument('--provider',choices=['meta','cartesia','all'],default='all');args=parser.parse_args()
    if not args.check_access: parser.error('Explicit --check-access required for external metadata requests.')
    load_local_config();result={}
    entries=[('meta','https://api.meta.ai/v1/models',{'Authorization':'Bearer '+os.environ['BRIVANY_META_API_KEY']}),
        ('cartesia','https://api.cartesia.ai/voices?limit=1',{'X-API-Key':os.environ['BRIVANY_CARTESIA_API_KEY'],'Cartesia-Version':'2026-08-14'})]
    for name,url,headers in entries:
        if args.provider not in {'all',name}:continue
        headers['User-Agent']='Brivany/1.0'
        try:
            with build_opener(NoRedirect()).open(Request(url,headers=headers),timeout=8) as response:
                body=json.loads(response.read(1048576));result[name]={'http_status':response.status,'access':True}
                if name=='meta':
                    models=[m.get('id','') for m in body.get('data',[]) if isinstance(m,dict)]
                    model=meta_translation_status()['model']
                    result[name]['checked_model']=model
                    result[name]['model_available']=model in models
        except HTTPError as error:
            result[name]={'http_status':error.code,'access':False};error.close()
        except Exception:result[name]={'access':False,'network_error':True}
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'type':'real_access_check',
        'purpose':'Bounded metadata GET requests, no inference, ASR or synthesis sessions.',
        'external_calls':len(result),'monetary_cost':None,'results':result}
    path=Path('tmp/translation-access.json')
    if path.exists():path=Path('tmp')/('translation-access-'+args.provider+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json')
    path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(report,indent=2))
    try:local=json.loads(ACCESS_PATH.read_text(encoding='utf-8'))
    except (OSError,ValueError):local={}
    local.update({name:{**result[name],'checked_at':report['checked_at'],'credential_hash':hashlib.sha256(os.environ[variable].encode()).hexdigest()}
        for name,variable in [('meta','BRIVANY_META_API_KEY'),('cartesia','BRIVANY_CARTESIA_API_KEY')] if name in result})
    ACCESS_PATH.parent.mkdir(parents=True,exist_ok=True);ACCESS_PATH.write_text(json.dumps(local),encoding='utf-8')
    print(json.dumps(report,indent=2))
    print('Informe: '+str(path))


if __name__=='__main__':main()
