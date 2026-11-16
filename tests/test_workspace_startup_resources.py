"""Loaded-event lifecycle with substituted windows, listeners and native backend."""
from contextlib import ExitStack
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from desktop.experience import launcher


class Event:
    def __init__(self):
        self.callbacks = []
    def __iadd__(self, callback):
        self.callbacks.append(callback)
        return self
    def fire(self):
        for callback in self.callbacks:
            callback()


class StartupResourceTests(unittest.TestCase):
    def test_audio_monitor_gate_uses_only_existing_local_sdk_playback(self):
        owner=SimpleNamespace()
        self.assertFalse(launcher.local_music_playing(owner))
        music=SimpleNamespace(sdk_snapshot={'playing':True},local_player={'state':'ready'})
        owner._spotify_player_host=SimpleNamespace(_window=None,_music=music)
        self.assertFalse(launcher.local_music_playing(owner))
        owner._spotify_player_host._window=object()
        self.assertTrue(launcher.local_music_playing(owner))
        music.local_player['state']='playback_error'
        self.assertFalse(launcher.local_music_playing(owner))
        music.local_player['state']='ready'
        for snapshot in (None,{}, {'playing':False},{'playing':1},{'playing':'true'}):
            music.sdk_snapshot=snapshot
            self.assertFalse(launcher.local_music_playing(owner))

    def test_loading_window_starts_small_listener_without_native_backend_or_audio_models(self):
        window = Mock(events=SimpleNamespace(loaded=Event(), closing=Event(), closed=Event(), minimized=Event()))
        runtime = Mock()
        runtime.availability.return_value = {'available': True}
        computer = Mock(runtime=runtime)
        bridge_holder = []
        server = SimpleNamespace(base_url='http://127.0.0.1:18765', session=object(),
                                 http=SimpleNamespace())
        local_server = Mock()
        local_server.__enter__ = Mock(return_value=server)
        local_server.__exit__ = Mock(return_value=False)
        relay = Mock()
        relay.start.return_value = relay
        thread_names = []
        class ImmediateThread:
            def __init__(self, target=None, name=None, **kwargs):
                self.target = target
                thread_names.append(name)
            def start(self):
                self.target()
        def create_window(*args, **kwargs):
            bridge_holder.append(kwargs['js_api'])
            return window
        def start(**kwargs):
            window.events.loaded.fire()
            self.assertEqual(window.events.minimized.callbacks,[])
            self.assertEqual([callback() for callback in window.events.closing.callbacks],[False])
            window.minimize.assert_called_once()
            window.destroy.assert_not_called()
        webview = SimpleNamespace(settings={}, screens=[], create_window=create_window,
                                  start=start, FileDialog=SimpleNamespace(FOLDER=20, SAVE=30))
        with ExitStack() as stack:
            stack.enter_context(patch.dict('sys.modules', {'webview': webview}))
            stack.enter_context(patch.object(launcher, 'dependency_status', return_value={
                'pywebview_available': True, 'edgechromium_available': True}))
            stack.enter_context(patch.object(launcher, 'LocalDesktopServer', return_value=local_server))
            stack.enter_context(patch('desktop.experience.ui_session.DesktopUISession.bind_window'))
            stack.enter_context(patch('desktop.experience.window_bounds.install'))
            stack.enter_context(patch('desktop.experience.tray.set_app_identity'))
            stack.enter_context(patch('desktop.experience.tray.SystemTray'))
            stack.enter_context(patch('desktop.experience.lifecycle.Lifecycle'))
            stack.enter_context(patch('desktop.experience.startup_recovery.StartupRecovery'))
            stack.enter_context(patch.object(launcher.ExperienceBridge,'_telephone_gateway'))
            stack.enter_context(patch.object(launcher.ExperienceBridge,'_configure_music_expansion'))
            ducker=stack.enter_context(patch('desktop.experience.music_ducking.MusicDucking'))
            stack.enter_context(patch('services.vetsa_account.VetsaAccount'))
            stack.enter_context(patch('services.whatsapp_desktop.WhatsAppDesktop'))
            constructor = stack.enter_context(patch('services.computer.service.ComputerService', return_value=computer))
            relay_constructor = stack.enter_context(patch('services.work.sync_relay.SyncRelay', return_value=relay))
            song = stack.enter_context(patch('packages.providers.audio_content.SingingFilter'))
            timbre = stack.enter_context(patch('packages.providers.robust_voice_timbre.warm_timbre'))
            stack.enter_context(patch.object(launcher.threading, 'Thread', ImmediateThread))
            launcher._launch(instance=Mock())
            constructor.assert_not_called()
            runtime.call.assert_not_called()
            song.assert_not_called()
            timbre.assert_not_called()
            ducker.return_value.start.assert_not_called()
            relay.start.assert_called_once()
            self.assertIn('brivany-browser-ready', thread_names)
            # The factory is retained for the first explicit native action.
            bridge_holder[0]._computer_factory().runtime.call('observe')
            constructor.assert_called_once()
            runtime.call.assert_called_once_with('observe')
            # Relay callbacks remain lazy and point at the ordinary existing
            # prefix preparation; simply creating the listener runs none of it.
            self.assertTrue(callable(relay_constructor.call_args.kwargs['prefix_factory']))


if __name__ == '__main__':
    unittest.main()
