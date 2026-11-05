"""Regressions for remote-device precedence and 429 recovery; synthetic transport."""
import json
from pathlib import Path
from urllib.parse import urlsplit
from tests.test_spotify import SpotifyTests,Protector
from services.spotify import SpotifyService,SpotifyError

class SyncTests(SpotifyTests):
    def test_frequent_local_snapshots_cannot_hide_a_phone_transfer(self):
        self.connect();local='b'*40;self.service.sdk_event('ready',local)
        self.service.devices=[{'id':local,'name':'Brivany'}]
        snapshot={'paused':False,'position':1200,'duration':180000,'volume':.5,'track':self.item}
        self.service.sdk_playback(snapshot);self.assertEqual(self.service.playback()['state_source'],'sdk')
        self.now+=9;self.service.sdk_playback(snapshot)
        remote=self.service.playback();self.assertEqual(remote['playback']['device'],self.device['id'])
        self.assertIsNone(self.service.sdk_playback({**snapshot,'paused':True}))
        self.assertEqual(self.service.playback()['playback']['device'],self.device['id'])
        self.assertTrue(any(c[1].endswith('/me/player') for c in self.calls))
    def test_device_lookup_failure_keeps_observed_current_track(self):
        self.connect();original=self.service.http
        self.service.http=lambda method,url,*args:(429,{'Retry-After':'90'},{}) if urlsplit(url).path.endswith('/devices') else original(method,url,*args)
        value=self.service.playback();self.assertEqual(value['playback']['id'],self.item['id']);self.assertEqual(value['retry_after'],90)
    def test_retry_after_survives_restart_and_is_never_shortened_to_one_hour(self):
        self.connect();self.fail=(429,{'Retry-After':'7200'},{})
        with self.assertRaises(SpotifyError):self.service._request('GET','/me/albums')
        calls=[];second=SpotifyService(self.temp.name,protector=Protector(),clock=lambda:self.now,http=lambda *a:calls.append(a),start_polling=False)
        try:
            self.assertEqual(second.status()['retry_after'],7200)
            with self.assertRaises(SpotifyError):second._request('GET','/me/player')
            self.assertEqual(calls,[])
        finally:second.close()
    def test_empty_devices_are_cached_and_library_retains_data_during_cooldown(self):
        self.connect();base=self.service.http
        def http(method,url,*args):
            if urlsplit(url).path.endswith('/devices'):self.calls.append((method,url,{},None));return 200,{}, {'devices':[]}
            return base(method,url,*args)
        self.service.http=http;self.service.playback();self.now+=9;self.service.playback()
        self.assertEqual(sum(c[1].endswith('/devices') for c in self.calls),1)
        self.service.library_cache[('albums',0)]=(self.now-301,{'kind':'albums','page':0,'items':[{'title':'Caché sintética'}],'has_next':False})
        self.fail=(429,{'Retry-After':'60'},{})
        result=self.service.library('albums');self.assertEqual(result['items'][0]['title'],'Caché sintética');self.assertTrue(result['stale']);self.assertEqual(result['retry_after'],60)
