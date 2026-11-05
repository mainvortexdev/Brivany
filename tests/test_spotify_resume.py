"""Restart, stale SDK and mobile precedence with a synthetic Spotify transport."""
import json
from tests.test_spotify import SpotifyTests,Protector
from services.spotify import SpotifyService


class ResumeTests(SpotifyTests):
    def reopen(self):
        other=SpotifyService(self.temp.name,protector=Protector(),clock=lambda:self.now,http=self.service.http,start_polling=False)
        self.addCleanup(other.close);return other

    def test_restart_retains_exact_track_position_and_queue_in_protected_checkpoint(self):
        self.connect();local='b'*40;self.device['id']=local;self.service.sdk_event('ready',local);self.service.playback()
        self.now+=3
        self.service.sdk_playback({'paused':False,'position':54321,'duration':180000,'volume':.7,'track':self.item,'next_uris':['spotify:track:'+'c'*22]})
        self.assertNotIn(b'Synthetic song',self.service.resume.path.read_bytes())
        other=self.reopen();self.assertEqual(other.resume.value['playback']['progress_ms'],54321)
        other.http=lambda *a:(204,{},{});other.sdk_event('ready','d'*40)
        # A stale initial SDK song must not replace the checkpoint.
        other.devices=[{'id':'d'*40,'name':'Brivany'}]
        other.sdk_playback({'paused':True,'position':0,'duration':180000,'track':{**self.item,'id':'e'*22}})
        state=other.playback();self.assertTrue(state['recovery_available']);self.assertEqual(state['playback']['id'],self.item['id']);self.assertEqual(state['playback']['progress_ms'],54321)
        calls=[];other.http=lambda *args:(calls.append(args) or (204,{},{}))
        other.restore_playback();data=json.loads(calls[-1][3]);self.assertEqual(data,{'position_ms':54321,'uris':['spotify:track:'+'a'*22,'spotify:track:'+'c'*22]})

    def test_active_mobile_session_wins_over_checkpoint_without_changing_device(self):
        self.connect();self.service.playback();self.now+=3
        self.item={**self.item,'id':'f'*22,'name':'New phone track'}
        other=self.reopen();state=other.playback()
        self.assertEqual(state['playback']['id'],'f'*22);self.assertFalse(state['recovery_available']);self.assertIsNone(other.restore_playback())
        self.assertFalse(any(method!='GET' and '/me/player' in url for method,url,*_ in self.calls))

    def test_no_checkpoint_never_substitutes_a_random_recently_played_song(self):
        self.connect();self.service.http=lambda *a:(204,{},{})
        self.assertIsNone(self.service.playback()['playback']);self.assertIsNone(self.service.resume.value)

    def test_context_resume_and_disconnect_remove_saved_playback(self):
        self.connect();self.service.playback();p=self.service.resume.value['playback']
        self.now+=3;self.service.resume.remember(self.service.client_id,p,context='spotify:playlist:'+'x'*22)
        request=self.service.resume.request();self.assertEqual(request['offset'],{'uri':'spotify:track:'+'a'*22});self.assertNotIn('uris',request)
        self.service.disconnect();self.assertFalse(self.service.resume.path.exists());self.assertIsNone(self.service.resume.value)
    def test_restart_during_rate_limit_shows_saved_song_without_fabricating_playback(self):
        self.connect();self.service.playback();other=self.reopen();other.http=lambda *a:(429,{'Retry-After':'90'},{})
        state=other.playback();self.assertEqual(state['playback']['id'],self.item['id']);self.assertFalse(state['playback']['playing']);self.assertTrue(state['recovery_available']);self.assertTrue(state['playback_stale']);self.assertEqual(state['retry_after'],90)
