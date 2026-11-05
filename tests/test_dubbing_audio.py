from array import array
import sys
import unittest

from packages.providers.dubbing_audio import trim_synthesis_padding


def pcm(samples):
    values = array('h', samples)
    if sys.byteorder != 'little':
        values.byteswap()
    return values.tobytes()


class DubbingPaddingTests(unittest.TestCase):
    def test_only_quiet_exterior_is_trimmed_with_thirty_ms_guards(self):
        speech = pcm([1000, -900] * 1000 + [0] * 2400 + [500, -700] * 1000)
        source = pcm([0] * 2400) + speech + pcm([3, -4] * 1200)
        result, head, tail = trim_synthesis_padding(source)
        self.assertEqual((head, tail), (70, 70))
        self.assertEqual(result, pcm([0] * 720) + speech + pcm([3, -4] * 360))

    def test_soft_waveform_above_quiet_threshold_and_short_edges_survive(self):
        source = pcm([0] * 480 + [5, -6] * 2000 + [0] * 480)
        self.assertEqual(trim_synthesis_padding(source), (source, 0, 0))

    def test_long_edges_and_silence_without_visible_transition_are_preserved(self):
        for samples in ([0] * 24000, [0] * 4800 + [80] * 2400 + [0] * 4800, [], [4] * 200):
            source = pcm(samples)
            self.assertEqual(trim_synthesis_padding(source), (source, 0, 0))

    def test_one_edge_does_not_require_trimming_the_other(self):
        body = pcm([50, -50] * 2000)
        source = pcm([0] * 1200) + body
        result, head, tail = trim_synthesis_padding(source)
        self.assertEqual((head, tail), (20, 0))
        self.assertEqual(result, pcm([0] * 720) + body)
        self.assertEqual(trim_synthesis_padding(result), (result, 0, 0))

    def test_invalid_pcm_is_rejected_before_editing(self):
        for invalid in (None, 'audio', b'1', bytearray(4)):
            with self.assertRaises(ValueError):
                trim_synthesis_padding(invalid)
