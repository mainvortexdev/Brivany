"""Activity metadata policy; no capture, playback or provider calls."""
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from desktop.experience.music_ducking import MusicDucking,excluded_game
from desktop.experience.audio_sessions import WindowsSessionMeter


class DuckingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.time=10;self.calls=[]
        with patch('desktop.experience.music_ducking.game_paths',return_value=set()):
            self.policy=MusicDucking(Path(self.tmp.name)/'settings.json',self.calls.append,clock=lambda:self.time,supported=True)
        self.addCleanup(self.policy.close)
    def sound(self,**overrides):return {'pid':777,'family':[r'C:\Apps\Browser\browser.exe'],'peak':.2,'volume':.5,'muted':False,**overrides}
    def test_non_game_sound_ducks_once_and_silence_has_a_hold_before_restore(self):
        self.policy.observe([self.sound()]);self.policy.observe([self.sound()]);self.assertEqual(self.calls,[True])
        self.time+=1;self.policy.observe([]);self.assertTrue(self.policy.ducked)
        self.time+=.6;self.policy.observe([]);self.assertEqual(self.calls,[True,False])
    def test_games_silent_muted_own_and_zero_volume_do_not_trigger(self):
        for sample in [self.sound(family=[r'D:\SteamLibrary\steamapps\common\Example\game.exe']),self.sound(family=[r'C:\XboxGames\Example\game.exe']),self.sound(owned=True),self.sound(muted=True),self.sound(peak=.001),self.sound(volume=0)]:
            self.policy.observe([sample]);self.assertFalse(self.policy.ducked)
        self.assertEqual(self.calls,[])
    def test_a_video_still_ducks_when_a_game_is_playing_at_the_same_time(self):
        self.policy.observe([self.sound(family=[r'C:\Games\game.exe']),self.sound()]);self.assertTrue(self.policy.ducked)
    def test_fxsound_mix_cannot_retrigger_our_music_but_browser_still_ducks(self):
        mixed=self.sound(family=[r'C:\Program Files\FxSound\FxSound.exe'])
        self.policy.observe([mixed]);self.assertFalse(self.policy.ducked)
        self.policy.observe([mixed,self.sound(family=[r'C:\Apps\Brave\brave.exe'])]);self.assertTrue(self.policy.ducked)
        self.time+=2;self.policy.observe([mixed]);self.assertFalse(self.policy.ducked)
    def test_registered_games_and_custom_exclusions_cover_nonstandard_folders(self):
        self.assertTrue(excluded_game([r'C:\Custom\Example.exe'],registered=[r'c:\custom\example.exe']))
        self.policy.configure(exclude=r'C:\Custom\Example.exe');self.policy.observe([self.sound(family=[r'C:\Custom\Example.exe'])]);self.assertFalse(self.policy.ducked)
        self.assertEqual(self.policy.status()['excluded'],['Example.exe'])
        self.policy.configure(remove=0);self.policy.observe([self.sound(family=[r'C:\Custom\Example.exe'])]);self.assertTrue(self.policy.ducked)
    def test_disable_restores_and_preference_survives_a_new_instance(self):
        self.policy.observe([self.sound()]);self.policy.configure(enabled=False);self.assertEqual(self.calls,[True,False]);self.policy.observe([self.sound()]);self.assertFalse(self.policy.ducked)
        replacement=MusicDucking(self.policy.path,lambda value:None,supported=True);self.addCleanup(replacement.close);self.assertFalse(replacement.enabled)
    def test_internal_media_and_voice_are_independent_and_unregister(self):
        self.policy.set_internal('media',True);self.policy.set_internal('voice',True);self.policy.observe([]);self.assertTrue(self.policy.ducked)
        self.policy.set_internal('media',False);self.time+=3;self.policy.observe([]);self.assertTrue(self.policy.ducked)
        self.policy.set_internal('voice',False);self.time+=2;self.policy.observe([]);self.assertFalse(self.policy.ducked)
    def test_invalid_preferences_rejected_and_unsupported_platform_never_ducks(self):
        for options in ({'enabled':'true'},{'exclude':'image.png'},{'exclude':'bad\n.exe'},{'remove':True}):
            with self.assertRaises(ValueError):self.policy.configure(**options)
        self.policy.supported=False;self.policy.observe([self.sound()]);self.assertFalse(self.policy.ducked)
    def test_foreign_programs_opened_by_melodi_are_not_excluded_with_its_webviews(self):
        meter=object.__new__(WindowsSessionMeter);meter.owner_pid=100
        meter.processes={100:{'parent':0,'full_path':'brivany.exe'},200:{'parent':100,'full_path':r'C:\Runtime\msedgewebview2.exe'},300:{'parent':100,'full_path':r'C:\Apps\Browser\browser.exe'},400:{'parent':100,'full_path':r'C:\Office\word.exe'}}
        self.assertTrue(meter._identity(100)[0]);self.assertTrue(meter._identity(200)[0])
        self.assertFalse(meter._identity(300)[0]);self.assertFalse(meter._identity(400)[0])
