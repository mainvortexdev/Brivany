import unittest
from packages.providers.dubbing_timing import delivery_speed,DeliveryPace,MAX_DELIVERY_SPEED


class DubbingTimingTests(unittest.TestCase):
    def test_conversational_delivery_and_silence_keep_natural_speed(self):
        self.assertEqual(delivery_speed('No cambies los doce kilos.', 1000, 4000), 1.)
        self.assertEqual(delivery_speed('', 0, 3000), 1.)

    def test_fast_source_is_guided_without_rewriting_or_unbounded_speed(self):
        text='No añadas agua y no cambies los doce kilos.'
        self.assertGreater(delivery_speed(text, 1000, 3400), 1.)
        self.assertEqual(delivery_speed(text*4, 1000, 1400), MAX_DELIVERY_SPEED)

    def test_missing_invalid_or_tiny_intervals_never_slow_or_accelerate(self):
        for start,end in [(None,3000),(0,float('nan')),(-1,2000),(4000,3000),(0,100),(True,2000)]:
            self.assertEqual(delivery_speed('Uno dos tres cuatro cinco.',start,end), 1.)
        self.assertEqual(delivery_speed('Sí, claro.', 1000, 1500), 1.)

    def test_completed_slow_voice_guides_its_next_dense_phrase_without_affecting_another_voice(self):
        pace=DeliveryPace();text='One two three four five six seven.'
        self.assertEqual(pace.speed('slow',text,0,2360),1.)
        self.assertTrue(pace.observe('slow',text,3440,1.))
        self.assertGreater(pace.speed('slow',text,0,2360),1.4)
        self.assertEqual(pace.speed('another',text,0,2360),1.)
        self.assertEqual(pace.speed('slow',text,0,7000),1.)

    def test_guidance_is_normalized_and_remains_bounded_for_measured_overruns(self):
        pace=DeliveryPace()
        self.assertTrue(pace.observe('voice','One two three four five six seven eight nine ten.',4320,1.28))
        self.assertEqual(pace.speed('voice','One two three four five six seven eight nine ten.',0,2480),1.5)
        self.assertEqual(pace.speed('voice','One two three four.',0,2000),1.106)
        self.assertEqual(pace.speed('voice','One two.',0,400),1.)

    def test_invalid_or_unfinished_measurements_cannot_train_duration_guidance(self):
        pace=DeliveryPace()
        for audio_ms,speed in [(0,1.),(float('nan'),1.),(30001,1.),(1000,.9),(1000,1.6),(True,1.)]:
            self.assertFalse(pace.observe('voice','One two three four.',audio_ms,speed))
        self.assertFalse(pace.observe('voice','One.',1500,1.))
        self.assertEqual(pace.speed('voice','One two three four five six.',0,2000),1.)
        self.assertEqual(pace._voices,{})

    def test_history_is_numeric_bounded_and_robust_to_one_duration_outlier(self):
        pace=DeliveryPace();text='One two three four five six.'
        for duration in (2000,2000,12000,2000):self.assertTrue(pace.observe('voice',text,duration,1.))
        self.assertEqual(pace.speed('voice',text,0,2000),1.)
        for _ in range(10):pace.observe('voice',text,2000,1.)
        self.assertEqual(len(pace._voices['voice']),4)
        self.assertTrue(all(isinstance(value,float) for value in pace._voices['voice']))
        for i in range(20):pace.observe(str(i),text,2000,1.)
        self.assertLessEqual(len(pace._voices),16)
