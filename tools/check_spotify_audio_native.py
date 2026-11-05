"""Opt-in real-account audio diagnosis. No song names, images, audio or tokens saved."""
import argparse
import json
import os
from pathlib import Path
import signal
import time
from urllib.parse import urlsplit,urlencode


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true',required=True);parser.add_argument('--replace-pid',type=int);args=parser.parse_args()
    os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--autoplay-policy=no-user-gesture-required'
    import webview
    from services.spotify import SpotifyService,transport
    from desktop.launcher import LocalDesktopServer
    from desktop.experience.launcher import experience_handler
    from desktop.experience.spotify_player import start_player
    from services.h1.server import Handler
    from types import SimpleNamespace
    requests=[]
    def http(method,url,headers,body):
        began=time.monotonic();result=transport(method,url,headers,body)
        requests.append({'method':method,'path':urlsplit(url).path,'code':result[0],'ms':round((time.monotonic()-began)*1000)});return result
    music=SpotifyService(Path('.local/spotify'),http=http,start_polling=False)
    before=music._request('GET','/me/player') or {};item=before.get('item') or {};uri=item.get('uri');
    if not uri:item=next(iter(music._request('GET','/me/player/recently-played?limit=1').get('items',[])),{}).get('track') or {};uri=item.get('uri')
    position=before.get('progress_ms') or 0
    if not uri or not uri.startswith('spotify:track:'):raise RuntimeError('La prueba necesita una canción actual observada; no elegirá otra.')
    report={'track_source':'current' if before.get('item') else 'recent history','purpose':'Reproduce missing native audio with the current observed track, then pause/restore position. No capture.','initial_playing':before.get('is_playing'),'samples':[],'events':[],'screen_audio_capture':False,'cost':'No model inference; API/SDK/CDN monetary consumption not measured.'}
    if args.replace_pid:
        from tools.workspace_metadata import inspect
        from desktop.experience.appbar import WindowsAppBar
        owned=inspect(args.replace_pid);bars=[w for w in owned['windows'] if w['title']=='Melodi WorkSpace' and w['tool_window']]
        assert len(bars)==1 and any(w['title']=='Brivany' for w in owned['windows'])
        WindowsAppBar(bars[0]['native_handle'],height=40)._message(1);os.kill(args.replace_pid,signal.SIGTERM);time.sleep(.4)
    with LocalDesktopServer(handler=experience_handler(Handler)) as server:
        root=webview.create_window('Brivany · prueba de audio',server.base_url+'/spotify-player',width=320,height=180,hidden=True)
        owner=SimpleNamespace(_music=lambda:music,_base=server.base_url)
        def wait(check,seconds=20):
            deadline=time.monotonic()+seconds
            while time.monotonic()<deadline:
                if check():return
                time.sleep(.2)
            raise RuntimeError('La prueba no confirmó su estado a tiempo.')
        def run():
            host=None
            try:
                start_player(owner);host=owner._spotify_player_host
                wait(lambda:music.status()['local_player']['state']!='starting')
                report['registered']=music.status()['local_player']['state'];print('SDK state:',report['registered'],flush=True)
                if report['registered']!='ready':raise RuntimeError(music.status()['local_player']['message'])
                identifier=music.local_player['id']
                wait(lambda:any(d.get('id')==identifier for d in music._request('GET','/me/player/devices').get('devices',[])),8)
                music.devices=music._request('GET','/me/player/devices').get('devices',[])
                music._request('PUT','/me/player/play?'+urlencode({'device_id':identifier}),data={'uris':[uri],'position_ms':position})
                for stage in ('api_play','sdk_resume'):
                    if stage=='sdk_resume':
                        began=time.monotonic();result=host.command('play');report['direct_command_ms']=round((time.monotonic()-began)*1000);report['direct_command_accepted']=result['accepted']
                    if stage=='visible_offscreen':host._window.move(-10000,-10000);host._window.show()
                    if stage=='visible_onscreen':host._window.move(920,760);host._window.show()
                    for index in range(3):
                        time.sleep(1)
                        p=(music.sdk_current() or {}).get('playback') or {}
                        sample={'stage':stage,'second':index+1,'sdk_state':music.local_player['state'],'playing':p.get('playing'),'position_ms':p.get('progress_ms'),'volume':p.get('volume'),**host.health()};report['samples'].append(sample);print(json.dumps(sample),flush=True)
                report['status']='completed'
            except Exception as error:report.update(status='failed',error=str(error)[:180])
            finally:
                if host:
                    try:host.command('pause');host.command('seek',position)
                    except Exception:pass
                    host.close()
                music.close()
                try:root.evaluate_js('window.BrivanySpotifyPlayer?.dispose()');time.sleep(.4);root.destroy()
                except Exception:pass
        webview.start(run,gui='edgechromium',private_mode=True,debug=False,http_server=False)
    report['requests']=requests;report['known_native_api_requests']=len(requests);report['sdk_network_requests']='not measured'
    output=Path('tmp/spotify-audio-controls');output.mkdir(exist_ok=True);(output/'native-audio-fixed.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='samples'},indent=2))


if __name__=='__main__':main()
