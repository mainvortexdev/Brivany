"""Explicit real-account control/continuous-playback check. No media capture.

Uses saved tracks already observed via Spotify; report contains only booleans,
timings and request paths. Restores volume/shuffle/repeat and leaves music paused.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import time
from urllib.parse import urlsplit


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true',required=True);parser.add_argument('--replace-pid',type=int);args=parser.parse_args()
    os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--autoplay-policy=no-user-gesture-required'
    import webview
    from services.spotify import SpotifyService,transport
    from desktop.experience.music import MusicBridge
    from desktop.experience.spotify_player import start_player
    from desktop.experience.launcher import experience_handler
    from desktop.launcher import LocalDesktopServer
    from services.h1.server import Handler
    requests=[];report={'status':'failed','checks':{},'screen_audio_capture':False,'cost':'No paid inference; API/SDK/CDN cost not measured.'}
    def http(method,url,headers,body):
        began=time.monotonic();result=transport(method,url,headers,body);requests.append({'method':method,'path':urlsplit(url).path,'code':result[0],'ms':round((time.monotonic()-began)*1000)});return result
    music=SpotifyService(Path('.local/spotify'),http=http,start_polling=False)
    before=music.playback().get('playback') or {};saved=music.library('tracks')['items']
    assert len({x['uri'] for x in saved})>=2,'Se necesitan dos canciones guardadas distintas.'
    if args.replace_pid:
        from tools.workspace_metadata import inspect
        from desktop.experience.appbar import WindowsAppBar
        state=inspect(args.replace_pid);bars=[w for w in state['windows'] if w['title']=='Melodi WorkSpace' and w['tool_window']]
        assert len(bars)==1 and any(w['title']=='Brivany' for w in state['windows'])
        WindowsAppBar(bars[0]['native_handle'],height=40)._message(1);os.kill(args.replace_pid,signal.SIGTERM);time.sleep(.4)
    class Owner(MusicBridge):
        def _trusted(self):pass
    with LocalDesktopServer(handler=experience_handler(Handler)) as server:
        root=webview.create_window('Brivany · verificación de controles',server.base_url+'/spotify-player',width=320,height=180,hidden=True)
        owner=Owner();owner._base=server.base_url;owner._spotify_factory=lambda:music
        def playback():return (music.sdk_current() or {}).get('playback') or {}
        def wait(check,timeout=12):
            deadline=time.monotonic()+timeout
            while time.monotonic()<deadline:
                if check():return
                time.sleep(.15)
            raise RuntimeError('No se confirmó el control en el estado real.')
        def check(name,action,value,predicate):
            report['checking']=name
            blocked={'play':'resuming','pause':'pausing','next':'skipping_next','previous':'skipping_prev','seek':'seeking'}
            wait(lambda:not (playback().get('disallows') or {}).get(blocked.get(action)))
            began=time.monotonic();result=owner.spotify_command(action,value);print('CONTROL',name,'accepted',result.get('accepted'),flush=True)
            wait(predicate)
            report['checks'][name]={'passed':True,'confirmed_ms':round((time.monotonic()-began)*1000)};print('PASS',name,flush=True)
        def run():
            host=None
            try:
                start_player(owner);host=owner._spotify_player_host
                wait(lambda:music.local_player['state']=='ready',20);identifier=music.local_player['id']
                wait(lambda:any(d.get('id')==identifier for d in music._request('GET','/me/player/devices').get('devices',[])))
                music.devices=music._request('GET','/me/player/devices').get('devices',[])
                music.play_item(saved[0]['uri'],identifier);wait(lambda:playback().get('id')==saved[0]['id'] and playback().get('playing'))
                wait(lambda:host.health().get('document_audio') is True)
                report['checks']['multi_track_queue']={'passed':len(music.queue_plan['seen'])>1,'queued_distinct':len(music.queue_plan['seen'])}
                check('pause','pause',None,lambda:playback().get('playing') is False)
                check('resume','play',None,lambda:playback().get('playing') is True)
                first=playback()['id'];check('next','next',None,lambda:bool(playback().get('id')) and playback()['id']!=first)
                wait(lambda:host.health().get('document_audio') is True);owner.spotify_command('seek',500);wait(lambda:playback().get('progress_ms',999999)<2000)
                check('previous','previous',None,lambda:playback().get('id')==first)
                check('seek','seek',1200,lambda:1200<=playback().get('progress_ms',0)<3500)
                check('volume','volume',35,lambda:playback().get('volume')==35)
                check('shuffle_on','shuffle',True,lambda:playback().get('shuffle') is True)
                check('shuffle_off','shuffle',False,lambda:playback().get('shuffle') is False)
                for mode in ('context','track','off'):check('repeat_'+mode,'repeat',mode,lambda mode=mode:playback().get('repeat')==mode)
                current=playback()['id'];duration=playback()['duration_ms'];owner.spotify_command('seek',max(0,duration-1800))
                count=sum(r['path'].endswith('/next') for r in requests);wait(lambda:bool(playback().get('id')) and playback()['id']!=current,15)
                report['checks']['natural_end_continues']={'passed':True,'next_command_sent':sum(r['path'].endswith('/next') for r in requests)>count,'next_position_ms':playback().get('progress_ms')}
                wait(lambda:host.health().get('document_audio') is True)
                report['checks']['native_audio']={'passed':True,'muted':host.health().get('muted')}
                report['status']='passed'
            except Exception as error:
                report['error']=str(error)[:200];p=playback();report['failure_snapshot']={k:p.get(k) for k in ('playing','progress_ms','duration_ms','volume','shuffle','repeat')};report['failure_health']=host.health() if host else {}
            finally:
                if host:
                    for action,value in [('pause',None),('volume',before.get('volume',50)),('shuffle',before.get('shuffle',False)),('repeat',before.get('repeat','off'))]:
                        try:owner.spotify_command(action,value)
                        except Exception:pass
                    host.close()
                music.close()
                try:root.evaluate_js('window.BrivanySpotifyPlayer?.dispose()');time.sleep(.4);root.destroy()
                except Exception:pass
        webview.start(run,gui='edgechromium',private_mode=True,http_server=False)
    report['requests']=requests;report['known_native_api_calls']=len(requests);report['sdk_network_calls']='not measured'
    output=Path('tmp/spotify-audio-controls');output.mkdir(exist_ok=True);(output/'native-all-controls.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2))
    return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
