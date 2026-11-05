"""Synthetic protocol tests: no account, network, real tokens or music playback."""
import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import ssl
from urllib.parse import urlsplit,parse_qs
from services.spotify import HISTORY_SCOPE,SpotifyService,SpotifyError,SCOPES,PLAYBACK_SCOPES,REGISTER_REDIRECT
from services.spotify_relay import SpotifyRelayError,BASE


class Protector:
    available=True
    def protect(self,b):return b'fixture-protected:'+base64.b64encode(b)
    def unprotect(self,b):return base64.b64decode(b.removeprefix(b'fixture-protected:'))


class Relay:
    def __init__(self):self.created=[];self.acknowledged=[];self.result={'status':'pending'}
    def config(self):return {'client_id':'a'*32,'redirect_uri':REGISTER_REDIRECT}
    def start(self,**data):
        self.created.append(data);return {'state':data['nonce']+'.0000001300.'+'s'*43,'client_id':data['client_id'],'redirect_uri':REGISTER_REDIRECT,'expires_in':300}
    def poll(self,state,secret):return self.result
    def acknowledge(self,state,secret):self.acknowledged.append(state);return {'ok':True}


class ImmediateEvent:
    def wait(self,seconds):return False
    def is_set(self):return False


class SpotifyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.now=1000;self.calls=[];self.fail=None
        self.item={'id':'a'*22,'type':'track','name':'Synthetic song','artists':[{'name':'Fixture artist'}],'duration_ms':180000,'album':{'images':[{'url':'https://i.scdn.co/image/abc123'}]}}
        self.device={'id':'fixture-device','is_restricted':False,'is_active':True,'name':'Fixture speaker','supports_volume':True,'volume_percent':50}
        def http(method,url,headers,body):
            self.calls.append((method,url,headers,body))
            if self.fail:return self.fail
            path=urlsplit(url).path
            if path=='/api/token':return 200,{},dict(access_token='synthetic-access',refresh_token='synthetic-refresh',token_type='Bearer',scope=SCOPES,expires_in=3600)
            if path.endswith('/devices'):return 200,{}, {'devices':[self.device,{'id':'restricted','is_restricted':True,'name':'Restricted'}]}
            if method=='GET':return 200,{},dict(item=self.item,device=self.device,is_playing=True,progress_ms=1000,actions={'disallows':{}})
            return 204,{},{}
        self.service=SpotifyService(self.temp.name,http=http,protector=Protector(),clock=lambda:self.now,relay=Relay(),start_polling=False)
        self.service.configure('a'*32)
    def tearDown(self):self.service.close();self.temp.cleanup()
    def connect(self):
        query=parse_qs(urlsplit(self.service.begin()).query)
        self.service.complete(query['state'][0],'fixture-code');return query
    def test_pkce_https_state_single_use_and_protected_persistence(self):
        query=parse_qs(urlsplit(self.service.begin()).query);verifier=self.service.flow['verifier']
        self.assertEqual(self.service.relay.created[-1]['challenge'],base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode())
        self.assertEqual(self.service.flow['redirect'],REGISTER_REDIRECT);self.assertTrue(REGISTER_REDIRECT.startswith('https://brivany.example/'))
        self.assertFalse(hasattr(self.service,'listener'))
        self.assertNotIn(self.service.flow['reader'],json.dumps(self.service.status()))
        with self.assertRaises(SpotifyError):self.service.complete('wrong','code')
        self.assertEqual(self.calls,[])
        self.service.complete(query['state'][0],'fixture-code')
        with self.assertRaises(SpotifyError):self.service.complete(query['state'][0],'fixture-code')
        self.assertEqual(len(self.calls),1);self.assertTrue(self.service.status()['connected']);self.assertEqual(parse_qs(self.calls[0][3].decode())['redirect_uri'],[REGISTER_REDIRECT])
        raw=(Path(self.temp.name)/'authorization.bin').read_bytes();self.assertNotIn(b'synthetic-access',raw);self.assertNotIn('synthetic-access',json.dumps(self.service.status()))
        other=SpotifyService(self.temp.name,http=self.service.http,protector=Protector(),clock=lambda:self.now);self.assertTrue(other.status()['connected']);other.close()
    def test_expired_replaced_cancelled_and_disconnected_flows_cannot_link(self):
        first=parse_qs(urlsplit(self.service.begin()).query);second=parse_qs(urlsplit(self.service.begin()).query)
        with self.assertRaises(SpotifyError):self.service.complete(first['state'][0],'x')
        self.now+=301
        with self.assertRaises(SpotifyError):self.service.complete(second['state'][0],'x')
        third=parse_qs(urlsplit(self.service.begin()).query)
        with self.assertRaises(SpotifyError):self.service.complete(third['state'][0],'',error='access_denied')
        self.assertFalse(self.service.status()['connected']);self.assertEqual(self.calls,[])
        fourth=parse_qs(urlsplit(self.service.begin()).query);self.service.disconnect()
        with self.assertRaises(SpotifyError):self.service.complete(fourth['state'][0],'x')
    def test_cache_refresh_tokens_devices_and_control_allowlist(self):
        self.connect();state=self.service.playback();count=len(self.calls);self.assertEqual(state['playback']['title'],'Synthetic song');self.service.playback();self.assertEqual(len(self.calls),count)
        self.service.command('pause');self.assertEqual(self.calls[-1][0],'PUT');self.assertTrue(self.calls[-1][1].endswith('/pause'))
        self.service.command('transfer','fixture-device');self.assertEqual(json.loads(self.calls[-1][3]),{'device_ids':['fixture-device'],'play':True})
        for action,value in [('transfer','restricted'),('transfer','unknown'),('volume',101),('seek',-1),('seek',True),('repeat','invalid'),('unknown',None),('shuffle','true')]:
            with self.assertRaises(SpotifyError):self.service.command(action,value)
        self.now+=4000;self.service.playback();self.assertTrue(any(b'grant_type=refresh_token' in (c[3] or b'') for c in self.calls))
    def test_restricted_playback_and_disallows_block_controls(self):
        self.connect();self.device['is_restricted']=True
        with self.assertRaises(SpotifyError):self.service.command('next')
        self.device['is_restricted']=False;self.now+=11;self.service.cache=None;self.service.playback();self.service.cache['playback']['disallows']={'skipping_next':True}
        with self.assertRaises(SpotifyError):self.service.command('next')
    def test_rate_limit_cooldown_and_no_mutation_retry(self):
        self.connect();self.service.playback();self.fail=(429,{'Retry-After':'45'},{});count=len(self.calls)
        with self.assertRaises(SpotifyError):self.service.command('next')
        self.assertEqual(len(self.calls),count+1)
        with self.assertRaises(SpotifyError):self.service.command('next')
        self.assertEqual(len(self.calls),count+1)
        self.now+=46;self.fail=None;self.service.command('next');self.assertTrue(self.calls[-1][1].endswith('/next'))
    def test_scope_migration_preserves_legacy_playback_and_requires_library_upgrade(self):
        self.connect();self.service.tokens.pop('scope');self.assertFalse(self.service.status()['library_access'])
        self.assertTrue(self.service.library()['access_required']);self.assertFalse(any('/me/playlists' in c[1] for c in self.calls))
        self.service._set_tokens({'access_token':'renewed-fixture','token_type':'Bearer','scope':PLAYBACK_SCOPES},refreshing=True)
        self.assertFalse(self.service.status()['library_access']);self.service.command('pause')
        self.service.disconnect();self.assertFalse((Path(self.temp.name)/'authorization.bin').exists());self.assertFalse(self.service.status()['connected'])
    def test_library_pagination_cache_observed_uri_and_context_playback(self):
        self.connect();base=self.service.http
        def http(method,url,headers,body):
            path=urlsplit(url).path
            if path in ('/v1/me/playlists','/v1/me/albums','/v1/me/tracks'):
                self.calls.append((method,url,headers,body));item={'id':'b'*22,'name':'Synthetic collection','artists':[{'name':'Synthetic artist'}],'images':[]}
                return 200,{}, {'items':[item if path.endswith('playlists') else {'album' if path.endswith('albums') else 'track':item}],'next':'https://api.spotify.com/v1/me/playlists?offset=20'}
            return base(method,url,headers,body)
        self.service.http=http
        playlist=self.service.library()['items'][0];count=len(self.calls);self.service.library();self.assertEqual(len(self.calls),count)
        self.service.library('albums',1);self.assertIn('offset=20',self.calls[-1][1]);self.service.play_item(playlist['uri'],'fixture-device');self.assertEqual(json.loads(self.calls[-1][3]),{'context_uri':playlist['uri']})
        track=self.service.library('tracks')['items'][0];self.service.play_item(track['uri']);self.assertEqual(json.loads(self.calls[-1][3]),{'uris':[track['uri']]})
        for uri in ('spotify:track:'+'c'*22,'https://untrusted.example/','spotify:track:../x'):
            with self.assertRaises(SpotifyError):self.service.play_item(uri)
        with self.assertRaises(SpotifyError):self.service.play_item(track['uri'],'unknown')
        for kind,page in [('invalid',0),('tracks',-1),('tracks',True)]:
            with self.assertRaises(SpotifyError):self.service.library(kind,page)
        self.service.disconnect();self.assertFalse(self.service.library_items)
    def test_library_can_start_without_a_current_track_on_selected_device(self):
        self.connect();base=self.service.http
        def http(method,url,headers,body):
            if method=='GET' and urlsplit(url).path in ('/v1/me/player','/v1/me/player/currently-playing'):return 204,{},{}
            return base(method,url,headers,body)
        self.service.http=http;uri='spotify:track:'+'b'*22;self.service.library_items[uri]=self.now
        self.service.command('transfer','fixture-device');self.service.play_item(uri)
        self.assertIn('device_id=fixture-device',self.calls[-1][1]);self.assertEqual(json.loads(self.calls[-1][3]),{'uris':[uri]})
    def test_saved_tracks_start_full_queue_and_extend_once_near_tail(self):
        self.connect();base=self.service.http;self.service.queue_workers=False
        def http(method,url,headers,body):
            if method=='GET' and urlsplit(url).path=='/v1/me/tracks':
                self.calls.append((method,url,headers,body));page=int(parse_qs(urlsplit(url).query).get('offset',['0'])[0])//20
                ids=['b','c'] if page==0 else ['d','e'] if page==1 else ['f','g']
                return 200,{}, {'items':[{'track':{**self.item,'id':letter*22}} for letter in ids],'next':'next-page' if page<2 else None}
            return base(method,url,headers,body)
        self.service.http=http;rows=self.service.library('tracks')['items'];self.service.play_item(rows[0]['uri'],'fixture-device')
        submitted=json.loads(self.calls[-1][3]);self.assertEqual(len(submitted['uris']),6);self.assertEqual(submitted['uris'][0],rows[0]['uri']);self.assertEqual(len(set(submitted['uris'])),6)
        plan=self.service.queue_plan;plan['next_page']=2;plan['seen']={uri for uri in submitted['uris'][:4]};plan['tail']=submitted['uris'][2:4]
        self.service._maybe_extend_queue('d'*22);self.assertTrue(plan['extending']);self.service._extend_queue(plan)
        appends=[c for c in self.calls if c[0]=='POST' and '/me/player/queue?' in c[1]];self.assertEqual(len(appends),2)
        self.service._extend_queue(plan);self.assertEqual(len([c for c in self.calls if c[0]=='POST' and '/me/player/queue?' in c[1]]),2)
        self.service.disconnect();self.assertIsNone(self.service.queue_plan)
    def test_empty_playback_does_not_replace_session_with_recent_history(self):
        self.connect();base=self.service.http
        def http(method,url,headers,body):
            path=urlsplit(url).path
            if method=='GET' and path in ('/v1/me/player','/v1/me/player/currently-playing'):return 204,{},{}
            if path=='/v1/me/player/recently-played':
                self.calls.append((method,url,headers,body));return 200,{}, {'items':[{'track':self.item}],'next':'unused'}
            return base(method,url,headers,body)
        self.service.http=http
        state=self.service.playback();self.assertIsNone(state['playback']);self.assertIsNone(state['last_listened']);self.assertFalse(any('/recently-played' in c[1] for c in self.calls))
        self.assertFalse(self.service.library('recent')['has_next']);self.service.tokens['scope']=' '.join(x for x in SCOPES.split() if x!=HISTORY_SCOPE);self.service.cache=None
        self.assertTrue(self.service.library('recent')['access_required']);self.assertIsNone(self.service.playback()['last_listened'])
    def test_current_track_fallback_merges_observed_active_phone(self):
        self.connect();base=self.service.http;phone={**self.device,'type':'Smartphone'}
        def http(method,url,headers,body):
            path=urlsplit(url).path
            if path=='/v1/me/player':return 204,{},{}
            if path=='/v1/me/player/currently-playing':return 200,{}, {'item':self.item,'is_playing':True,'progress_ms':1200}
            if path.endswith('/devices'):return 200,{}, {'devices':[phone]}
            return base(method,url,headers,body)
        self.service.http=http;self.assertEqual(self.service.playback()['playback']['device'],phone['id']);self.service.command('pause');self.assertTrue(self.calls[-1][1].endswith('/pause'))
    def test_mosaic_covers_are_kept_for_playlists_and_current_track(self):
        self.connect();self.item['album']['images']=[{'url':'https://mosaic.scdn.co/640/abc123'}]
        self.assertEqual(self.service.playback()['playback']['artwork'],'https://mosaic.scdn.co/640/abc123')
    def test_no_secure_storage_means_memory_only_and_no_plaintext_fallback(self):
        self.service.protector.available=False;self.connect();self.assertFalse((Path(self.temp.name)/'authorization.bin').exists());self.assertFalse(self.service.status()['persistent'])
    def test_malformed_client_and_tokens_rejected_without_http(self):
        for value in ('','http://example.com',True):
            with self.assertRaises(SpotifyError):self.service.configure(value)
        with self.assertRaises(SpotifyError):self.service._set_tokens({'access_token':'x','token_type':'Other'})
        self.assertEqual(self.calls,[])
    def test_desktop_tls_keeps_certificate_and_hostname_verification(self):
        from services.spotify_tls import verified_context
        context=verified_context()
        self.assertEqual(context.verify_mode,ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        self.assertGreaterEqual(context.minimum_version,ssl.TLSVersion.TLSv1_2)
        self.assertGreater(context.cert_store_stats()['x509_ca'],0)

    def test_https_handoff_finishes_in_native_process_and_acknowledges(self):
        url=self.service.begin();self.assertTrue(url.startswith(BASE+'/spotify/connect?'))
        flow=self.service.flow;self.service.relay.result={'status':'ready','code':'fixture-code','error':None}
        self.service._poll_link(flow,ImmediateEvent());self.assertTrue(self.service.status()['connected']);self.assertIsNone(self.service.flow)
        self.assertEqual(self.service.relay.acknowledged,[flow['state']]);self.assertEqual(len(self.calls),1)
        self.service._poll_link(flow,ImmediateEvent());self.assertEqual(len(self.calls),1)
    def test_published_config_bootstraps_the_single_button_without_user_client_id(self):
        self.service.client_id='';url=self.service.begin();self.assertEqual(self.service.client_id,'a'*32)
        self.assertTrue(url.startswith('https://brivany.example/spotify/connect?'));self.assertTrue(self.service.status()['pending'])
        self.service.cancel_link();self.assertFalse(self.service.status()['pending'])
    def test_https_error_cancellation_and_deadline_do_not_exchange_tokens(self):
        self.service.begin();flow=self.service.flow;self.service.relay.result={'status':'ready','code':None,'error':'access_denied'}
        self.service._poll_link(flow,ImmediateEvent());self.assertFalse(self.service.status()['connected']);self.assertIn('cancelada',self.service.status()['message']);self.assertEqual(self.calls,[])
        self.service.begin();flow=self.service.flow;self.now+=301;self.service._poll_link(flow,ImmediateEvent())
        self.assertIsNone(self.service.flow);self.assertEqual(self.calls,[])


if __name__=='__main__':unittest.main()
