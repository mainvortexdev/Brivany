"""Two metadata GETs to verify synthetic catalog voices; no synthesis or retries."""
import argparse
from datetime import datetime,timezone
import json
import os
from pathlib import Path
from urllib.request import Request,build_opener
from urllib.error import HTTPError
from services.h1.server import load_local_config
from packages.providers.live_voice import NoRedirect


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check-access',action='store_true');args=parser.parse_args()
    if not args.check_access:parser.error('Explicit --check-access required for metadata requests.')
    load_local_config();results=[]
    for identifier in ('47c38ca4-5f35-497b-b1a3-415245fb35e1','db6b0ed5-d5d3-463d-ae85-518a07d3c2b4'):
        result={'id':identifier}
        try:
            headers={'X-API-Key':os.environ['BRIVANY_CARTESIA_API_KEY'],'Cartesia-Version':'2026-08-14','User-Agent':'Brivany/1.0'}
            with build_opener(NoRedirect()).open(Request('https://api.cartesia.ai/voices/'+identifier,headers=headers),timeout=6) as response:
                body=json.loads(response.read(131072));result.update({key:body.get(key) for key in ('id','name','gender','status','language')});result['http_status']=response.status
        except HTTPError as error:result['http_status']=error.code;error.close()
        except Exception:result['network_error']=True
        results.append(result)
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'purpose':'Verify two catalog voice identities without speech synthesis.',
        'external_calls':2,'inference_calls':0,'monetary_cost':None,'results':results}
    path=Path('tmp')/('river-voices-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json')
    path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2));print('Informe: '+str(path))


if __name__=='__main__':main()
