"""One read-only Meta account catalog request; never prints credentials."""
import json,os,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import Request,build_opener
from urllib.error import HTTPError,URLError
from services.h1.server import load_local_config
from packages.providers.live_voice import NoRedirect

def main():
    load_local_config();key=os.environ.get('BRIVANY_META_API_KEY','').strip()
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'provider':'Meta','method':'GET /v1/models','catalog_requests':0,'inference_requests':0,'actual_billed_usd':None,'status':'unverified'}
    if not key:report['status']='not_configured'
    else:
        request=Request('https://api.meta.ai/v1/models',headers={'Authorization':'Bearer '+key,'Accept':'application/json'})
        try:
            report['catalog_requests']=1
            with build_opener(NoRedirect()).open(request,timeout=10) as response:raw=response.read(262145)
            if len(raw)>262144:raise ValueError()
            value=json.loads(raw);models=value.get('data')
            if not isinstance(models,list):raise ValueError()
            ids=sorted({item.get('id') for item in models if isinstance(item,dict) and isinstance(item.get('id'),str) and re.fullmatch(r'[A-Za-z0-9._:/-]{1,160}',item['id'])})
            report.update(status='catalog_received',model_ids=ids,muse_transcribe_available='muse-voice-transcribe-1.0' in ids,seamless_models=[item for item in ids if 'seamless' in item.lower()])
        except HTTPError as error:report.update(status='http_rejected',http_status=error.code);error.close()
        except (URLError,OSError,ValueError,TypeError):report['status']='catalog_unavailable'
    directory=Path('tmp/meta-catalog-real');directory.mkdir(parents=True,exist_ok=True)
    (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['status']=='catalog_received' else 1
if __name__=='__main__':raise SystemExit(main())
