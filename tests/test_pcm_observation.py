"""Deterministic PCM observations only; no audio service or API requests."""
import json
import math
import struct
import unittest

from tools.pcm_observation import PCMObservation


def pcm(value, frames, channels=1):
    return struct.pack("<h", value)*(frames*channels)


class PCMObservationTests(unittest.TestCase):
    def test_no_pcm_and_digital_silence_do_not_claim_energy(self):
        empty = PCMObservation().flush()
        self.assertIsNone(empty["first_above_threshold_ms"])
        self.assertEqual(empty["total_pcm_seconds"], 0)
        observation = PCMObservation()
        observation.feed(pcm(0, 960), 24000, 1, 120)
        result = observation.flush()
        self.assertEqual(result["analyzed_window_count"], 2)
        self.assertEqual(result["total_pcm_seconds"], .04)
        self.assertEqual(result["above_threshold_seconds"], 0)
        self.assertIsNone(result["first_above_threshold_ms"])
        self.assertEqual(result["maximum_window_rms"], 0)

    def test_first_energy_is_arrival_of_completed_window_not_first_pcm_or_acoustic_position(self):
        observation = PCMObservation()
        observation.feed(pcm(0, 480), 24000, 1, 100)
        observation.feed(pcm(1000, 240), 24000, 1, 135)
        self.assertIsNone(observation.summary()["first_above_threshold_ms"])
        observation.feed(pcm(1000, 720), 24000, 1, 180)
        result = observation.summary()
        self.assertEqual(result["first_above_threshold_ms"], 180)
        self.assertEqual(result["analyzed_window_count"], 3)
        self.assertEqual(result["above_threshold_seconds"], .04)
        self.assertEqual(result["total_pcm_seconds"], .06)

    def test_odd_packet_boundary_and_stereo_frames_are_reassembled(self):
        observation = PCMObservation()
        stereo = struct.pack("<hh", 0, -32768)*160
        observation.feed(stereo[:1], 8000, 2, 11)
        self.assertEqual(observation.summary()["pending_bytes"], 1)
        observation.feed(stereo[1:-1], 8000, 2, 20)
        self.assertEqual(observation.summary()["analyzed_window_count"], 0)
        observation.feed(stereo[-1:], 8000, 2, 29)
        result = observation.flush()
        self.assertEqual(result["first_above_threshold_ms"], 29)
        self.assertAlmostEqual(result["maximum_window_rms"], math.sqrt(.5))
        self.assertEqual(result["total_pcm_seconds"], .02)
        self.assertEqual(result["pending_bytes"], 0)

    def test_strict_threshold_and_little_endian_samples(self):
        # 625 frames at 31,250 Hz is 20 ms. One 4096 sample and 624 zero samples
        # have RMS exactly .005; equality must not count as above the threshold.
        observation = PCMObservation()
        observation.feed(struct.pack("<h", 4096)+pcm(0, 624), 31250, 1, 1)
        self.assertEqual(observation.summary()["maximum_window_rms"], .005)
        self.assertEqual(observation.summary()["above_threshold_seconds"], 0)
        observation.feed(pcm(164, 625), 31250, 1, 2)
        self.assertEqual(observation.summary()["first_above_threshold_ms"], 2)
        self.assertEqual(observation.summary()["above_threshold_seconds"], .02)

    def test_flush_short_window_uses_latest_arrival_and_seals_state(self):
        observation = PCMObservation()
        observation.feed(pcm(1000, 120), 24000, 1, 50)
        self.assertEqual(observation.summary()["analyzed_window_count"], 0)
        result = observation.flush()
        self.assertEqual(result["first_above_threshold_ms"], 50)
        self.assertEqual(result["above_threshold_seconds"], .005)
        self.assertEqual(result["analyzed_window_count"], 1)
        self.assertEqual(observation.flush(), result)
        with self.assertRaises(ValueError): observation.flush(at_ms=float("nan"))
        with self.assertRaises(ValueError): observation.feed(b"", 24000, 1, 60)

    def test_explicit_flush_arrival_and_incomplete_frame_rejection(self):
        observation = PCMObservation()
        observation.feed(b"\xE8", 24000, 1, 10)
        with self.assertRaises(ValueError): observation.flush()
        self.assertFalse(observation.summary()["closed"])
        observation.feed(b"\x03", 24000, 1, 15)
        self.assertEqual(observation.flush(at_ms=21)["first_above_threshold_ms"], 21)

    def test_invalid_format_timestamps_and_changes_leave_state_unchanged(self):
        observation = PCMObservation()
        invalid = [(b"", 7999, 1, 0), (b"", 96001, 1, 0), (b"", True, 1, 0),
            (b"", 24000, 3, 0), (b"", 24000, True, 0), ([], 24000, 1, 0),
            (b"", 24000, 1, float("nan")), (b"", 24000, 1, float("inf")),
            (b"", 24000, 1, -1), (b"", 24000, 1, True), (b"", 24000, 1, 10**1000)]
        initial = observation.summary()
        for args in invalid:
            with self.assertRaises(ValueError): observation.feed(*args)
            self.assertEqual(observation.summary(), initial)
        observation.feed(pcm(0, 1), 24000, 1, 10)
        current = observation.summary()
        for args in ((b"", 8000, 1, 10), (b"", 24000, 2, 10), (b"", 24000, 1, 9)):
            with self.assertRaises(ValueError): observation.feed(*args)
            self.assertEqual(observation.summary(), current)
        for arrival in (float("nan"), -1, 9):
            with self.assertRaises(ValueError): observation.flush(at_ms=arrival)
            self.assertEqual(observation.summary(), current)

    def test_ninety_second_bound_and_buffer_stays_smaller_than_one_window(self):
        observation = PCMObservation()
        observation.feed(pcm(0, 8000*90), 8000, 1, 500)
        result = observation.summary()
        self.assertEqual(result["total_pcm_seconds"], 90)
        self.assertEqual(result["analyzed_window_count"], 4500)
        self.assertLess(result["pending_bytes"], 160*2)
        with self.assertRaises(ValueError): observation.feed(b"\0", 8000, 1, 500)
        self.assertEqual(observation.summary(), result)

    def test_summary_is_json_scalars_with_explicit_energy_metadata_only(self):
        observation = PCMObservation()
        observation.feed(pcm(500, 10), 96000, 2, 0)
        result = observation.summary()
        self.assertTrue(all(value is None or type(value) in {str, int, float, bool} for value in result.values()))
        self.assertEqual(json.loads(json.dumps(result)), result)
        self.assertEqual(result["threshold_rms"], .005)
        self.assertEqual(result["threshold_comparison"], ">")
        self.assertEqual(result["time_reference"], "chunk_arrival_relative_to_first_input")
        self.assertFalse(any(word in key for key in result for word in ("speech", "inference", "naturalness")))


if __name__ == "__main__": unittest.main()
