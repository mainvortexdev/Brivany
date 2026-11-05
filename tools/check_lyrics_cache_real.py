"""Read-only public LRC lookup using checkpoint metadata; never records lyrics."""
import argparse
import json
from pathlib import Path
import time
from services.spotify import SpotifyService
from services.lyrics import LyricsService,transport,timed_transport

ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-network',required=True,action='store_true');parser.add_argument('--reference-track',action='store_true');args=parser.parse_args()
    calls=[]
    def wrap(name,http):
        def call(query):
            start=time.monotonic();row={'provider':name};calls.append(row)
            try:
                result=http(query);row['http_status']=result[0];return result
            finally:row['elapsed_seconds']=round(time.monotonic()-start,3)
        return call
    music=SpotifyService(ROOT/'.local/spotify',start_polling=False);lyrics=LyricsService(http=wrap('LRCLIB',transport),timed_http=wrap('SyncLRC',timed_transport));report={'scope':'actual_public_lyric_endpoints_current_checkpoint_metadata_only','lyrics_content_recorded':False,'spotify_mutations':0,'inference_requests':0,'passed':False}
    try:
        track={'id':'a'*22,'type':'track','title':'Thunderstruck','artist':'AC/DC','album':'The Razors Edge','duration_ms':292000} if args.reference_track else (music.resume.value or {}).get('playback')
        if not track:raise ValueError('No checkpoint available')
        began=time.monotonic();initial=lyrics.lookup_synced(track);report['initial_return_ms']=round((time.monotonic()-began)*1000,2)
        deadline=time.monotonic()+7;result=initial
        while result['status']=='loading' and time.monotonic()<deadline:time.sleep(.1);result=lyrics.lookup_synced(track)
        report.update(status=result['status'],provider=result.get('provider'),synced=result.get('synced',False),line_count=len(result.get('lines',[])),elapsed_seconds=round(time.monotonic()-began,3))
        began=time.monotonic();again=lyrics.lookup_synced(track);report['cached_return_ms']=round((time.monotonic()-began)*1000,2);report['passed']=result['status']=='ready' and result.get('synced') is True and again.get('synced') is True
    except Exception as error:report['error_type']=type(error).__name__
    finally:
        lyrics.close();music.close();report['public_requests']=calls;folder=ROOT/'tmp/lyrics-performance';folder.mkdir(exist_ok=True);(folder/('reference-report.json' if args.reference_track else 'real-report.json')).write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
    return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
