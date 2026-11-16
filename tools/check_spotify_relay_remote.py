"""Opt-in HTTPS relay smoke test. Spotify itself and tokens are substituted.

Only synthetic, acknowledged short-lived flows are created in the deployed relay.
No user account, browser profile, microphone or real playback is accessed.
"""
import argparse
import base64
from datetime import datetime,timezone
import hashlib
from http.cookiejar import CookieJar
import json
from pathlib import Path
import tempfile
from urllib.error import HTTPError
from urllib.parse import parse_qs,urlsplit,urlencode
from urllib.request import build_opener,HTTPCookieProcessor,Request

from services.spotify import SpotifyService,SCOPES
from services.spotify_relay import SpotifyRelay,SpotifyRelayError,BASE,REDIRECT,NoRedirect


class MemoryOnly:
    available=False


class Immediate:
    def wait(self,seconds):return False
    def is_set(self):return False


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true',required=True);parser.parse_args()
    report={'status':'failed','relay_https':'real','spotify_api':'substituted','user_account_accessed':False,'spotify_requests':0,'tokens_persisted':False}
    expected=json.loads((Path(__file__).resolve().parents[1]/'official-site/wrangler.jsonc').read_text(encoding='utf-8'))['vars']['SPOTIFY_CLIENT_ID']
    class CheckedRelay(SpotifyRelay):
        def __init__(self):self.http_calls=0
        def request(self,*args,**kwargs):self.http_calls+=1;return super().request(*args,**kwargs)
        def config(self):
            value=super().config()
            assert value['client_id']==expected
            report['matches_configured_application']=True
            report['declared_access_mode']=value['access_mode']
            return value
    relay=CheckedRelay();calls=[];browser_calls=0
    def spotify_http(method,url,headers,body):
        if url=='https://api.spotify.com/v1/me' and method=='GET':
            calls.append('synthetic profile verification');return 200,{}, {'id':'brivany-synthetic-profile','display_name':'Cuenta sintética'}
        assert url=='https://accounts.spotify.com/api/token' and method=='POST'
        params=parse_qs(body.decode());assert params['redirect_uri']==[REDIRECT]
        assert params['code']==['brivany-synthetic-not-a-real-authorization-code']
        assert len(params['code_verifier'][0])>=43
        calls.append('synthetic token exchange')
        return 200,{},dict(access_token='synthetic-not-a-real-access-token',refresh_token='synthetic-not-a-real-refresh-token',token_type='Bearer',scope=SCOPES,expires_in=3600)
    try:
        with tempfile.TemporaryDirectory(prefix='brivany-https-handoff-fixture-') as folder:
            music=SpotifyService(folder,relay=relay,http=spotify_http,protector=MemoryOnly(),start_polling=False)
            try:
                browser=build_opener(HTTPCookieProcessor(CookieJar()),NoRedirect())
                browser.addheaders=[('User-Agent','BrivanyDesktop/0.1 (+'+BASE+')')]
                launch_url=music.begin();assert urlsplit(launch_url).netloc==urlsplit(BASE).netloc;flow=music.flow
                try:response=browser.open(Request(launch_url),timeout=15)
                except HTTPError as error:response=error
                browser_calls+=1
                with response:
                    assert response.code==303
                    location=response.headers.get('Location');query=parse_qs(urlsplit(location).query)
                    assert urlsplit(location).hostname=='accounts.spotify.com'
                    assert query['redirect_uri']==[REDIRECT] and query['code_challenge_method']==['S256']
                    assert query['code_challenge']==[base64.urlsafe_b64encode(hashlib.sha256(flow['verifier'].encode()).digest()).rstrip(b'=').decode()]
                    assert response.headers.get('Cache-Control')=='no-store, private'
                callback=BASE+'/spotify/callback?'+urlencode({'state':flow['state'],'code':'brivany-synthetic-not-a-real-authorization-code'})
                with browser.open(Request(callback),timeout=15) as result:
                    browser_calls+=1
                    assert result.code==200 and result.headers.get('Referrer-Policy')=='no-referrer'
                    assert 'brivany-synthetic-not-a-real-authorization-code' not in result.read().decode()
                music._poll_link(flow,Immediate())
                assert music.status()['connected'] and len(calls)==2 and music.flow is None
                try:relay.poll(flow['state'],flow['reader'])
                except SpotifyRelayError as error:assert error.expired
                else:raise AssertionError('El puente no retiró la autorización sintética.')
                report.update(status='passed',checks=['normal TLS and domain callback','secure redirect to Spotify inspected without following it','browser cookie bound to the synthetic flow','authorization returned via HTTPS relay to isolated native service','token exchange substituted; local state updated','acknowledgement removed synthetic authorization; later poll rejected'],redirect_uri=REDIRECT)
            finally:music.close()
    except Exception as error:
        report['error_type']=type(error).__name__
    report['relay_http_calls']=relay.http_calls+browser_calls
    path=Path('tmp/spotify-https-relay/remote-report-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json');path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
