"""Isolated playback host and short-lived-token boundaries; all data synthetic."""
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from services.spotify import SpotifyService,SpotifyError,SCOPES,PLAYBACK_SCOPES
from desktop.experience.spotify_player import SpotifyPlayerBridge,start_player
from tests.test_spotify import Protector


class PlayerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.service=SpotifyService(self.temp.name,protector=Protector(),clock=lambda:1000,http=lambda *a:(200,{}, {'devices':[]}))
        self.service.configure('a'*32)
    def tearDown(self):self.service.close();self.temp.cleanup()
    def grant(self,scope=SCOPES):self.service._set_tokens({'access_token':'fixture-access','refresh_token':'fixture-refresh','token_type':'Bearer','scope':scope,'expires_in':3600})
    def test_sdk_requires_new_grant_and_tokens_only_reach_exact_native_host(self):
        self.grant(PLAYBACK_SCOPES)
        with self.assertRaises(SpotifyError):self.service.sdk_token()
        self.grant();bridge=SpotifyPlayerBridge(self.service,'http://127.0.0.1:12345')
        for url in ['http://127.0.0.1:12345/work-widget','http://127.0.0.1:12346/spotify-player','https://untrusted.example/spotify-player']:
            bridge._window=SimpleNamespace(get_current_url=lambda:url)
            with self.assertRaises(ValueError):bridge.token()
        bridge._window=SimpleNamespace(get_current_url=lambda:'http://127.0.0.1:12345/spotify-player')
        self.assertEqual(bridge.token(),{'access_token':'fixture-access'});self.assertNotIn('fixture-access',str(self.service.status()));self.assertNotIn('fixture-refresh',str(bridge.token()))
    def test_sdk_ready_is_distinct_from_api_observed_device(self):
        self.grant();self.service.sdk_event('ready','a'*40)
        self.assertEqual(self.service.status()['local_player']['state'],'ready')
        with self.assertRaises(SpotifyError):self.service.command('transfer','a'*40)
        for kind,identifier in [('unknown',''),('ready','http://bad'),('ready','')]:
            with self.assertRaises(SpotifyError):self.service.sdk_event(kind,identifier)
        self.service.sdk_event('account_error');self.assertIn('Premium',self.service.status()['local_player']['message'])
        self.service.disconnect();self.assertEqual(self.service.status()['local_player']['state'],'idle')
        with self.assertRaises(SpotifyError):self.service.sdk_token()
    def test_local_snapshots_are_immediate_without_web_api_and_have_revisions(self):
        self.grant();identifier='a'*40;self.service.sdk_event('ready',identifier);self.service.devices=[{'id':identifier,'name':'Brivany','is_restricted':False}]
        value={'paused':False,'position':1200,'duration':180000,'volume':.6,'track':{'id':'b'*22,'name':'Synthetic song','artists':[{'name':'Synthetic artist'}],'album':{'images':[]}}}
        first=self.service.sdk_playback(value);self.assertTrue(first['playback']['playing']);self.assertEqual(first['state_source'],'sdk')
        def no_http(*args):self.fail('A local snapshot must not wait for a Web API read')
        self.service.http=no_http;self.assertEqual(self.service.playback()['playback']['volume'],60)
        second=self.service.sdk_playback({**value,'paused':True});self.assertGreater(second['playback_revision'],first['playback_revision']);self.assertFalse(second['playback']['playing'])
        fractional=self.service.sdk_playback({**value,'position':180000.7,'duration':180000.1});self.assertEqual(fractional['playback']['progress_ms'],180000)
        for position in (True,float('nan'),float('inf'),-2000,190000):
            with self.assertRaises(SpotifyError):self.service.sdk_playback({**value,'position':position})
        self.service.sdk_playback(None);self.assertIsNone(self.service.sdk_current())
    def test_local_command_acknowledges_without_blocking_for_polling(self):
        import re
        self.grant();bridge=SpotifyPlayerBridge(self.service,'http://127.0.0.1:12345')
        def evaluate(code):
            identifier=re.search(r'command\("([a-f0-9]+)"',code).group(1);bridge.result(identifier,True)
        bridge._window=SimpleNamespace(get_current_url=lambda:'http://127.0.0.1:12345/spotify-player',evaluate_js=evaluate)
        self.assertTrue(bridge.command('play')['accepted']);self.assertFalse(bridge._pending)
        for action,value in [('invalid',None),('volume',200),('seek',-1)]:
            with self.assertRaises(SpotifyError):bridge.command(action,value)
    def test_one_hidden_host_lives_independently_of_workspace_and_can_close(self):
        self.grant();calls=[]
        class Event:
            def __iadd__(self,callback):return self
        class Window:
            events=SimpleNamespace(loaded=Event())
            def evaluate_js(self,code):calls.append('dispose')
            def destroy(self):calls.append('destroy')
        owner=SimpleNamespace(_music=lambda:self.service,_base='http://127.0.0.1:12345')
        with patch('webview.create_window',return_value=Window()) as create:
            start_player(owner);start_player(owner);self.assertEqual(create.call_count,1);self.assertTrue(create.call_args.kwargs['hidden']);self.assertFalse(create.call_args.kwargs['focus'])
            owner._spotify_player_host.close();self.assertEqual(calls,['dispose','destroy']);self.assertEqual(self.service.status()['local_player']['state'],'idle')


if __name__=='__main__':unittest.main()
