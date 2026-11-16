"""Local-only: caption-scheduled dubbing on a simulated video clock."""
import threading
import time
import unittest

from packages.providers import caption_dubbing as cd


class Clock:
    def __init__(self):self.now = 100.
    def __call__(self):return self.now


class Output:
    def __init__(self, clock):
        self.clock = clock; self.pushes = []; self.flushed = 0
    def push_translation_paced(self, raw, *, stopped, timeout):
        self.pushes.append((self.clock(), len(raw))); return True
    def flush_translation(self):self.flushed += 1


class Translator:
    calls = []
    def stream_for_duration(self, text, target, history, *, duration_ms):
        Translator.calls.append((text, target, duration_ms)); yield 'TR:' + text
    def close(self):pass


def wait(predicate, timeout=2):
    deadline = time.monotonic() + timeout
    while not predicate() and time.monotonic() < deadline:
        time.sleep(.005)
    return predicate()


class CaptionDubbingTests(unittest.TestCase):
    def make(self, cues, *, voice='clone-voice'):
        Translator.calls = []
        self.clock = Clock(); self.output = Output(self.clock); self.synth = []
        self.timeline = {'source':'youtube:abcdefghijk', 'position':10., 'position_at':self.clock.now, 'paused':False, 'cues':cues, 'revision':1}
        def synthesizer(text, *, voice, language, speed):
            self.synth.append((text, voice, language, speed)); return b'\x01\x00' * 24000  # 1 s
        dubbing = cd.CaptionDubbing(lambda:self.timeline, target='es', translator_factory=Translator, synthesizer=synthesizer,
                                    output_getter=lambda:self.output, voice_hint=lambda:voice, clock=self.clock)
        self.addCleanup(dubbing.close); dubbing.player.start()  # ticks are driven by the test
        return dubbing

    def advance(self, dubbing, seconds, step=.05):
        """Move the video clock forward while ticking like the real loop."""
        for _ in range(round(seconds / step)):
            # The extension reports the position several times per second.
            video = self.timeline['position'] + (self.clock.now - self.timeline['position_at'])
            self.clock.now += step
            self.timeline['position'] = video + step; self.timeline['position_at'] = self.clock.now
            dubbing._tick(); time.sleep(.002)

    def test_caption_is_translated_ahead_and_starts_on_its_first_word(self):
        cue = {'start':12., 'end':14.5, 'text':'We make chocolate.', 'speaker':None, 'words':[[12.3, 'We'], [12.6, 'make'], [13.1, 'chocolate.']]}
        dubbing = self.make([cue])
        dubbing._tick()
        self.assertTrue(wait(lambda: Translator.calls), 'Translated as soon as it is within the lookahead')
        self.assertEqual(Translator.calls[0][:2], ('We make chocolate.', 'es'))
        self.advance(dubbing, 1.5)   # video at 11.5 s: still before the cue
        self.assertEqual(self.output.pushes, [])
        self.assertTrue(wait(lambda: dubbing.status()['synthesized'] == 1))
        self.assertEqual(self.synth[0][:3], ('TR:We make chocolate.', 'clone-voice', 'es'))
        self.advance(dubbing, .6)    # 12.1 s: mixer lead reached for the 12.3 s word
        self.assertTrue(wait(lambda: self.output.pushes), 'Audio handed to the mixer on time')
        video_time = 10. + (self.output.pushes[0][0] - 100.)
        self.assertAlmostEqual(video_time, 12.3 - cd.OUTPUT_LEAD, delta=.06)
        self.assertTrue(dubbing.active())

    def test_late_caption_is_skipped_to_keep_sync(self):
        dubbing = self.make([{'start':10.2, 'end':12., 'text':'Late line.', 'speaker':None}])
        def slow(text, *, voice, language, speed):
            time.sleep(.05); return b'\x01\x00' * 4800
        dubbing.synthesizer = slow
        dubbing._tick(); self.assertTrue(wait(lambda: dubbing.status()['translated'] == 1))
        self.advance(dubbing, .05)
        self.clock.now += 1.2  # the clock jumps ahead while synthesis was slow
        self.timeline['position'] = 11.4; self.timeline['position_at'] = self.clock.now
        self.assertTrue(wait(lambda: dubbing.status()['synthesized'] == 1))
        dubbing._tick()
        self.assertEqual(self.output.pushes, [])
        self.assertEqual(dubbing.status()['skipped_late'], 1)

    def test_pause_and_stale_clock_deactivate_without_playing(self):
        dubbing = self.make([{'start':10.5, 'end':12., 'text':'Hello.', 'speaker':None}])
        self.timeline['paused'] = True; dubbing._tick()
        self.assertFalse(dubbing.active())
        self.timeline['paused'] = False; self.clock.now += cd.STALE_AFTER + .5; dubbing._tick()
        self.assertFalse(dubbing.active(), 'No clock update for too long')

    def test_seek_flushes_queued_voice_and_keeps_translations(self):
        dubbing = self.make([{'start':10.5, 'end':12., 'text':'Hello.', 'speaker':None}])
        dubbing._tick(); wait(lambda: Translator.calls)
        self.timeline['position'] = 60.; self.timeline['position_at'] = self.clock.now; dubbing._tick()
        self.assertEqual(self.output.flushed, 1)
        self.timeline['position'] = 10.; self.timeline['position_at'] = self.clock.now; dubbing._tick()
        self.assertEqual(len(Translator.calls), 1, 'A seek never translates the same caption again')

    def test_long_translation_is_compressed_to_its_slot_keeping_pitch(self):
        import numpy as np
        rate = 24000; t = np.arange(rate * 4) / rate
        speech = (np.sin(2 * np.pi * 200 * t) * 9000).astype('<i2').tobytes()
        short = cd.time_compress(speech, 1.4)
        self.assertAlmostEqual(len(speech) / len(short), 1.4, delta=.05)
        y = np.frombuffer(short, '<i2').astype(float)
        peak = np.fft.rfftfreq(len(y), 1 / rate)[np.abs(np.fft.rfft(y)).argmax()]
        self.assertAlmostEqual(peak, 200, delta=8, msg='Pitch is preserved')
        self.assertEqual(cd.time_compress(speech, 1.0), speech)

    def test_two_ready_captions_never_play_at_the_same_time(self):
        dubbing = self.make([{'start':10.3, 'end':10.6, 'text':'One.', 'speaker':None}, {'start':10.6, 'end':12., 'text':'Two.', 'speaker':None}])
        active = []; overlaps = []
        class Slow(Output):
            def push_translation_paced(inner, raw, *, stopped, timeout):
                active.append(1); overlaps.append(len(active) > 1); time.sleep(.03); active.pop(); return True
        dubbing.output_getter = lambda: Slow(self.clock)
        dubbing._tick(); self.assertTrue(wait(lambda: dubbing.status()['translated'] == 2))
        self.advance(dubbing, .2); self.assertTrue(wait(lambda: dubbing.status()['synthesized'] == 2))
        self.advance(dubbing, .6)
        self.assertTrue(wait(lambda: dubbing.status()['played'] == 2))
        self.assertFalse(any(overlaps), 'One producer at a time')

    def test_speed_fits_dense_translations_but_never_slows(self):
        self.assertEqual(cd.delivery_speed('uno dos', 3.), 1.)
        self.assertGreater(cd.delivery_speed('uno dos tres cuatro cinco seis siete ocho nueve diez', 2.5), 1.)
        self.assertEqual(cd.delivery_speed(' '.join(['palabra'] * 40), 2.), cd.MAX_SPEED)


class SilentTimelineHubTests(unittest.TestCase):
    def video(self, **extra):
        from services.work.selected_video import SelectedVideo
        class Socket:
            def send(self, raw):pass
        return SelectedVideo(Socket(), {'type':'select', 'selection':'silent-tab-1', 'source':'youtube:abcdefghijk',
                                        'has_captions':True, 'timeline_only':True, **extra})

    def test_timeline_only_accepts_word_onsets_and_reports_a_clock(self):
        video = self.video()
        video.captions({'type':'captions', 'done':True, 'cues':[{'start':1., 'end':3., 'text':'Hi there', 'speaker':None, 'words':[[1.2, 'Hi'], [1.6, 'there']]}]})
        self.assertIsNone(video.timeline(), 'No clock yet')
        video.set_position(1.5)
        timeline = video.timeline()
        self.assertEqual((timeline['position'], timeline['cues'][0]['words'][0]), (1.5, [1.2, 'Hi']))

    def test_timeline_only_never_takes_audio_nor_the_directa_route(self):
        from services.work.selected_video import SelectedVideoError, SelectedVideoHub
        video = self.video()
        with self.assertRaises(SelectedVideoError):video.accept(bytes(3840))
        hub = SelectedVideoHub(); hub.current = video
        with self.assertRaises(ValueError):hub.route()

    def test_timeline_only_requires_captions_and_no_translation_request(self):
        from services.work.selected_video import SelectedVideoError
        with self.assertRaises(SelectedVideoError):self.video(has_captions=False)
        with self.assertRaises(SelectedVideoError):self.video(translate=True)


if __name__ == '__main__':
    unittest.main()
