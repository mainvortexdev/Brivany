"""Bounded, read-only account diagnostic. Never records tokens or track/file names."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
from urllib.parse import urlsplit
from services.h1.server import load_local_config
from services.spotify import SpotifyService,SpotifyError,transport

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');parser.add_argument('--collections-only',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('--run hace como máximo dos consultas de datos (y renovación OAuth si caducó).')
    load_local_config();root=Path(__file__).resolve().parents[1];calls=[]
    def observed(method,url,headers,body):
        code,meta,value=transport(method,url,headers,body);calls.append({'method':method,'path':urlsplit(url).path,'status':code});return code,meta,value
    service=SpotifyService(root/'.local/spotify',http=observed,start_polling=False)
    report={'type':'real_read_only_linked_account_diagnostic','recorded_utc':datetime.now(timezone.utc).isoformat(),'purpose':'Comprobar reproducción Connect y acceso a biblioteca sin reproducir, pausar ni transferir nada.','playback_verified':False,'library_verified':False,'billing_amount':None,'calls':calls}
    try:
        status=service.status();report.update(connected=status['connected'],library_access=status['library_access'],retry_after=status['retry_after'])
        if not status['connected']:report['message']='Cuenta no vinculada.'
        elif status['retry_after']:report['message']='Spotify mantiene un Retry-After activo; no se envía ninguna consulta.'
        else:
            try:
                if args.collections_only:
                    report['collections']={}
                    for kind,path in [('playlists','/me/playlists?limit=1'),('tracks','/me/tracks?limit=1')]:
                        sample=service._request('GET',path);report['collections'][kind]={'sample_count':len(sample.get('items') or []),'total':sample.get('total')}
                    report['library_verified']=True
                else:
                    raw=service._request('GET','/me/player') or {};report.update(playback_verified=True,active_track_present=bool(raw.get('item')),playing=raw.get('is_playing') is True,device_type=(raw.get('device') or {}).get('type'))
                if status['library_access'] and not args.collections_only:
                    albums=service._request('GET','/me/albums?limit=1');report.update(library_verified=True,library_sample_count=len(albums.get('items') or []))
            except SpotifyError as error:report.update(message=str(error),retry_after=service.status()['retry_after'])
    finally:service.close()
    report['request_count']=len(calls);folder=root/'tmp/workspace-spotify';folder.mkdir(exist_ok=True);file=folder/('account-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json');file.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));print('Informe: '+str(file))

if __name__=='__main__':main()
