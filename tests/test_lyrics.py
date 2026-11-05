"""Synthetic provider and hostile-data regressions. No real lyrics or accounts."""
import unittest
import threading
import time
from services.lyrics import LyricsService, LyricsError, parse_lyrics


class LyricsTests(unittest.TestCase):
    def setUp(self):
        self.now=1000;self.calls=[]
        self.track={'id':'a'*22,'type':'track','title':'Synthetic Song','artist':'Fixture Artist','album':'Fixture Album','duration_ms':180000}
        self.response=(200,{},dict(trackName='Synthetic Song',artistName='Fixture Artist',duration=180,syncedLyrics='[00:00.00]Primera línea sintética\n[00:38.00]<img src=x onerror=alert(1)>\n[01:00.00]Tercera línea sintética'))
        def http(query):self.calls.append(query);return self.response
        self.service=LyricsService(http=http,clock=lambda:self.now)
    def test_signature_only_cache_and_synchronized_untrusted_text(self):
        result=self.service.lookup(self.track);self.assertEqual(result['status'],'ready');self.assertTrue(result['synced']);self.assertEqual(result['lines'][1]['ms'],38000)
        self.assertIn('<img',result['lines'][1]['text']);self.service.lookup(self.track);self.assertEqual(len(self.calls),1)
        self.assertEqual(set(self.calls[0]),{'track_name','artist_name','album_name','duration'});self.assertEqual(result['provider'],'LRCLIB')
        self.service.clear();self.now+=1;self.service.lookup(self.track);self.assertEqual(len(self.calls),2)
    def test_wrong_record_duration_not_found_and_plain_instrumental_states(self):
        for change in ({'duration':190},{'trackName':'Another song'},{'artistName':'Another artist'}):
            self.service.clear();self.now+=1;self.response=(200,{}, {**dict(trackName='Synthetic Song',artistName='Fixture Artist',duration=180,plainLyrics='Texto sintético'),**change})
            self.assertEqual(self.service.lookup(self.track)['status'],'unavailable')
        self.now+=1;self.service.clear();self.response=(404,{},{});self.assertEqual(self.service.lookup(self.track)['status'],'unavailable')
        self.now+=1;self.service.clear();self.response=(200,{},dict(trackName='Synthetic Song',artistName='Fixture Artist',duration=180,plainLyrics='Texto sintético'))
        self.assertFalse(self.service.lookup(self.track)['synced'])
        self.now+=1;self.service.clear();self.response[2]['instrumental']=True;self.response[2]['plainLyrics']=None;self.assertEqual(self.service.lookup(self.track)['status'],'instrumental')
    def test_rate_limit_honors_retry_after_and_no_automatic_retry(self):
        self.response=(429,{'Retry-After':'90'},{});self.service.lookup(self.track);self.assertEqual(len(self.calls),1)
        other={**self.track,'title':'Another fixture'};self.now+=89;self.assertEqual(self.service.lookup(other)['status'],'retry');self.assertEqual(len(self.calls),1)
        self.now+=40;self.service.lookup(other);self.assertEqual(len(self.calls),2)
    def test_invalid_content_never_calls_provider_and_bounds_are_enforced(self):
        self.assertEqual(self.service.lookup({**self.track,'type':'episode'})['status'],'unavailable');self.assertFalse(self.calls)
        for value in ('x'*65537,'é'*40000,'\n'.join('[00:01]x' for _ in range(801))):
            with self.assertRaises(LyricsError):parse_lyrics(value)
        self.assertEqual(parse_lyrics('[offset:100]\n[00:01.20]Texto')['lines'][0]['ms'],1300)
    def test_transport_failure_is_cached_and_cache_has_a_bound(self):
        def fail(query):raise LyricsError('Fallo sintético')
        self.service.http=fail;self.assertEqual(self.service.lookup(self.track)['status'],'error')
        for index in range(40):self.now+=1;self.service.lookup({**self.track,'title':'Fixture '+str(index)})
        self.assertEqual(len(self.service.cache),32)
    def test_fallback_during_primary_outage_is_plain_attributed_and_cached(self):
        calls=[]
        def fallback(query):calls.append(query);return 200,{}, {'lyrics':'Texto sintético alternativo\nOtra línea sintética'}
        self.service.fallback_http=fallback;self.response=(502,{'Retry-After':'60'},{})
        result=self.service.lookup(self.track)
        self.assertEqual(result['provider'],'Lyrics.ovh');self.assertEqual(result['status'],'ready');self.assertFalse(result['synced']);self.assertFalse(result['version_verified'])
        self.service.lookup(self.track);self.assertEqual(len(calls),1);self.assertEqual(len(self.calls),1)
        self.now+=1;self.service.lookup({**self.track,'title':'Otra canción sintética'});self.assertEqual(len(self.calls),1);self.assertEqual(len(calls),2)
    def test_fallback_failure_and_throttling_never_fabricate_lyrics(self):
        calls=[]
        def fallback(query):calls.append(query);return 429,{'Retry-After':'90'},{}
        self.service.fallback_http=fallback;self.response=(404,{},{})
        self.assertFalse(self.service.lookup(self.track)['lines']);self.now+=1
        self.service.lookup({**self.track,'title':'Otro título'});self.assertEqual(len(calls),1)
    def test_timed_provider_precedes_plain_fallback_and_accepts_featured_artist_separator(self):
        calls=[];self.track['artist']='Fixture Artist, Guest Singer';self.response=(502,{},{})
        def timed(query):calls.append(query);return 200,{},dict(trackName='Synthetic Song',artistName='Fixture Artist feat. Guest Singer',duration=180,syncedLyrics='[00:01.00]<00:01.00>Primera línea sintética\n[00:03.00]Segunda línea sintética')
        self.service.timed_http=timed
        def no_plain(query):self.fail('Timed lyrics should be preferred to plain lyrics')
        self.service.fallback_http=no_plain
        result=self.service.lookup(self.track);self.assertTrue(result['synced']);self.assertEqual(result['provider'],'SyncLRC');self.assertEqual(result['lines'][0]['text'],'Primera línea sintética');self.assertEqual(len(calls),1)
    def test_timed_provider_rejects_other_version_and_respects_backoff(self):
        calls=[];self.response=(404,{},{})
        def timed(query):calls.append(query);return 200,{},dict(trackName='Synthetic Song',artistName='Another Artist',duration=180,syncedLyrics='[00:01]Texto sintético')
        self.service.timed_http=timed;self.assertFalse(self.service.lookup(self.track)['synced'])
        self.service.clear();self.now+=3
        self.service.timed_http=lambda q:(429,{'Retry-After':'120'},{})
        self.service.lookup(self.track);deadline=self.service.timed_after
        self.now+=1;self.service.timed_http=lambda q:self.fail('Retry-After must be respected');self.service.lookup({**self.track,'title':'Another fixture'})
        self.assertEqual(self.service.timed_after,deadline)
    def test_plain_result_is_retried_and_upgraded_when_timing_becomes_available(self):
        self.response=(404,{},{})
        self.service.fallback_http=lambda q:(200,{},dict(lyrics='Texto sintético'))
        self.service.timed_http=lambda q:(404,{},{})
        first=self.service.lookup(self.track);self.assertFalse(first['synced']);self.assertLessEqual(first['retry_after'],121)
        self.now+=122;self.service.timed_http=lambda q:(200,{},dict(trackName='Synthetic Song',artistName='Fixture Artist',duration=180,syncedLyrics='[00:01]Texto sintético'))
        self.assertTrue(self.service.lookup(self.track)['synced'])
    def test_new_track_does_not_wait_for_old_network_and_cache_is_immediate(self):
        gate=threading.Event();entered=threading.Event();calls=[]
        def http(query):
            calls.append(query['track_name'])
            if query['track_name']=='Synthetic Song':entered.set();gate.wait(2)
            return 200,{},dict(trackName=query['track_name'],artistName='Fixture Artist',duration=180,syncedLyrics='[00:01]Contenido de prueba')
        self.service.http=http;self.addCleanup(self.service.close);self.addCleanup(gate.set)
        start=time.monotonic();self.assertEqual(self.service.lookup_synced(self.track)['status'],'loading');self.assertLess(time.monotonic()-start,.1);self.assertTrue(entered.wait(1))
        self.now+=1;new={**self.track,'id':'b'*22,'title':'Another fixture'};self.service.lookup_synced(new)
        until=time.monotonic()+1
        while self.service.lookup_synced(new)['status']=='loading' and time.monotonic()<until:time.sleep(.01)
        self.assertTrue(self.service.lookup_synced(new)['synced']);self.assertFalse(gate.is_set());self.assertEqual(calls.count('Another fixture'),1)
        gate.set()
    def test_synchronized_lookup_never_displays_plain_or_wrong_version(self):
        self.service.http=lambda query:(200,{},dict(trackName='Other song',artistName='Fixture Artist',duration=180,syncedLyrics='[00:01]Incorrecto',plainLyrics='No usar'))
        self.addCleanup(self.service.close);self.service.lookup_synced(self.track);until=time.monotonic()+1
        while self.service.sync_pending and time.monotonic()<until:time.sleep(.01)
        result=self.service.lookup_synced(self.track);self.assertEqual(result['status'],'unavailable');self.assertFalse(result['lines'])


if __name__=='__main__':unittest.main()
