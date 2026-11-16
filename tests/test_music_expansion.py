"""Synthetic clocks, sources, PCM and sockets. Never opens UI or audio devices."""
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from desktop.experience.music_expansion import IdleMusicController,MusicSpectrum,spectrum_bins,ExpansionAPI
from desktop.experience.workspace_preferences import WorkspacePreferences
from services.work.music_presence import YouTubeMusicPresence,normalize_music


def youtube(**patch):
 return {'type':'music','video':'abcdefghijk','title':'Artista - Un lugar (Official Video)','artist':'','playing':True,'muted':False,'music':True,'position':10,'duration':180,**patch}


class IdleMusicTests(unittest.TestCase):
 def setUp(self):
  self.elapsed=0;self.song={'id':'own','playing':True};self.source=Mock(side_effect=lambda:self.song);self.show=Mock();self.hide=Mock();self.blocked=False
  self.controller=IdleMusicController(self.source,self.show,self.hide,idle=lambda:self.elapsed,suppressed=lambda:self.blocked);self.addCleanup(self.controller.close)
 def test_disabled_has_no_thread_no_source_and_no_window(self):
  self.elapsed=100;self.controller.tick();self.source.assert_not_called();self.show.assert_not_called();self.assertIsNone(self.controller.thread)
 def test_exactly_one_minute_and_only_while_music_is_playing(self):
  self.controller.enabled=True;self.elapsed=59.99;self.controller.tick();self.source.assert_not_called()
  self.elapsed=60;self.song['playing']=False;self.controller.tick();self.show.assert_not_called()
  self.song['playing']=True;self.controller.tick();self.show.assert_called_once_with(self.song)
  self.elapsed=80;self.controller.tick();self.assertEqual(self.show.call_count,1)
 def test_input_dismisses_and_next_minute_can_enter_again(self):
  self.controller.enabled=True;self.elapsed=61;self.controller.tick();self.elapsed=.2;self.controller.tick();self.hide.assert_called_once();self.assertFalse(self.controller.visible)
  self.elapsed=60;self.controller.tick();self.assertEqual(self.show.call_count,2)
 def test_pause_source_loss_and_suppression_close_scene(self):
  self.controller.enabled=True;self.elapsed=90;self.controller.tick();self.song=None;self.controller.tick();self.assertFalse(self.controller.visible)
  self.song={'id':'next','playing':True};self.blocked=True;self.controller.tick();self.assertEqual(self.show.call_count,1)
 def test_escape_blocks_reopening_until_input_then_a_full_idle_minute(self):
  self.controller.enabled=True;self.elapsed=90;self.controller.tick();self.controller.dismiss();self.elapsed=100;self.controller.tick();self.assertEqual(self.show.call_count,1)
  self.elapsed=.4;self.controller.tick();self.elapsed=60.4;self.controller.tick();self.assertEqual(self.show.call_count,2)
 def test_activity_or_setting_change_during_source_query_prevents_show(self):
  self.controller.enabled=True;self.elapsed=90
  def interrupt():self.elapsed=.1;return self.song
  self.controller.source=interrupt;self.controller.tick();self.show.assert_not_called()
 def test_unchecking_stops_scene_without_starting_any_capture(self):
  self.controller.enabled=True;self.elapsed=61;self.controller.tick();self.controller.configure(False);self.assertFalse(self.controller.visible);self.hide.assert_called_once();self.assertFalse(self.controller.activity.is_set())
 def test_preview_requires_enabled_option_and_current_playback(self):
  with self.assertRaises(ValueError):self.controller.preview()
  self.controller.enabled=True;self.song=None
  with self.assertRaises(ValueError):self.controller.preview()
  self.song={'id':'own','playing':True};self.assertTrue(self.controller.preview()['preview']);self.assertTrue(self.controller.visible)
 def test_preview_ends_on_pause_and_cannot_reopen_during_user_activity(self):
  self.controller.enabled=True;self.controller.preview();self.song=None;self.controller.tick();self.assertFalse(self.controller.previewing)
  self.song={'id':'next','playing':True};self.elapsed=2;self.controller.tick();self.assertEqual(self.show.call_count,1)
 def test_preview_clears_a_previous_dismissal_and_keeps_song_clock_fresh(self):
  self.controller.enabled=True;self.elapsed=90;self.controller.tick();self.controller.dismiss();self.controller.preview();self.song={'id':'next','playing':True};self.controller.tick();self.assertEqual(self.controller.song['id'],'next')
 def test_preference_is_off_by_default_and_persists_explicit_opt_in(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'settings.json';prefs=WorkspacePreferences(path);self.assertEqual(prefs.snapshot()['music'],{'expansion':False,'style':'orbital'});prefs.update({'music':{'expansion':True,'style':'amber'}});self.assertEqual(WorkspacePreferences(path).snapshot()['music'],{'expansion':True,'style':'amber'})
   with self.assertRaises(ValueError):prefs.update({'music':{'expansion':'true'}})
   with self.assertRaises(ValueError):prefs.update({'music':{'style':'unknown'}})
 def test_legacy_music_checkbox_gets_orbital_style_without_losing_the_opt_in(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'settings.json';path.write_text(json.dumps({'schema':1,'revision':3,'values':{'music':{'expansion':True}}}),encoding='utf-8')
   self.assertEqual(WorkspacePreferences(path).snapshot()['music'],{'expansion':True,'style':'orbital'})


class YouTubeMusicTests(unittest.TestCase):
 def setUp(self):self.now=0;self.enabled=True;self.hub=YouTubeMusicPresence(enabled=lambda:self.enabled,clock=lambda:self.now)
 def test_canonical_thumbnail_and_song_identity(self):
  value=normalize_music(youtube());self.assertEqual(value['title'],'Un lugar');self.assertEqual(value['artist'],'Artista');self.assertEqual(value['artwork'],'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');self.assertEqual(value['source'],'youtube')
 def test_spanish_official_video_suffix_is_removed_before_lyrics_lookup(self):
  value=normalize_music(youtube(title='Artista - Un lugar (Video Oficial)'));self.assertEqual(value['title'],'Un lugar');self.assertEqual(value['artist'],'Artista')
 def test_album_after_a_pipe_does_not_become_part_of_the_song_name(self):
  value=normalize_music(youtube(title='Artista - Un lugar (Visualizer) | Álbum'));self.assertEqual(value['title'],'Un lugar');self.assertEqual(value['album'],'Álbum')
 def test_muted_paused_and_non_music_video_cannot_trigger_scene(self):
  for patch in [{'muted':True},{'playing':False},{'music':False}]:
   self.hub.observe('channel',youtube(**patch));self.assertIsNone(self.hub.current())
 def test_closed_or_stale_tab_expires_and_clock_is_extrapolated(self):
  self.hub.observe('channel',youtube());self.now=2;self.assertEqual(self.hub.current()['progress_ms'],12000);self.now=9;self.assertIsNone(self.hub.current())
 def test_disabled_discards_metadata_and_never_selects_youtube(self):
  self.enabled=False;self.hub.observe('channel',youtube());self.assertIsNone(self.hub.current());self.assertFalse(self.hub.entries)
 def test_untrusted_url_payloads_and_times_are_rejected(self):
  for patch in [{'video':'../../private'},{'position':math.nan},{'duration':-1},{'muted':'false'},{'title':'x\0y'}]:
   with self.subTest(patch=patch),self.assertRaises(ValueError):normalize_music(youtube(**patch))
 def test_socket_disconnect_removes_metadata_without_recording_it(self):
  socket=Mock();socket.recv.side_effect=[json.dumps(youtube()),TimeoutError()];self.hub.handle(socket);self.assertEqual(self.hub.entries,{})


class SpectrumTests(unittest.TestCase):
 def test_synthetic_tone_and_silence_without_any_device(self):
  import numpy as np
  silence=spectrum_bins(bytes(4096));self.assertEqual(silence,[0.0]*64)
  tone=(np.sin(2*np.pi*440*np.arange(2048)/24000)*18000).astype('<i2').tobytes();bins=spectrum_bins(tone)
  self.assertEqual(len(bins),64);self.assertGreater(max(bins),.5);self.assertTrue(all(0<=value<=1 for value in bins));self.assertEqual(max(range(64),key=bins.__getitem__),27)
 def test_constructor_does_not_start_capture_and_stop_clears_frames(self):
  capture=Mock();spectrum=MusicSpectrum(capture);self.assertIsNone(spectrum.thread);capture.assert_not_called();self.assertEqual(spectrum.snapshot()['state'],'off');spectrum.stop();self.assertEqual(spectrum.snapshot()['bins'],[0.0]*64)
 def test_window_api_is_limited_to_its_native_origin_and_route(self):
  host=Mock();host.closed=False;window=Mock();host.window=window;window.get_current_url.return_value='https://outside.invalid/workspace-music-expansion';host.base='http://127.0.0.1:4321';api=ExpansionAPI(host);api._window=window
  with self.assertRaises(ValueError):api.state()
  window.get_current_url.return_value='http://127.0.0.1:4321/workspace-music-expansion';host.controller.song=None;host.spectrum.snapshot.return_value={'state':'off','bins':[0]*64};self.assertIsNone(api.state()['track'])


if __name__=='__main__':unittest.main()
