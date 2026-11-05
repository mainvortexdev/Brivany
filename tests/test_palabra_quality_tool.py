"""Local evaluation logic only. No key, provider, speech or output device."""
import math
import struct
import unittest

from tools.check_palabra_quality_real import CASES, MAX_SECONDS, collect_caption, concept_screen, pcm_summary


class PalabraQualityToolTests(unittest.TestCase):
    def test_fixed_cases_cover_three_destinations_without_claiming_french_input(self):
        self.assertEqual({target for _, target in CASES.values()}, {'en', 'es', 'fr'})
        self.assertNotIn('fr', {source for source, _ in CASES.values()})
        self.assertEqual(MAX_SECONDS, 20)

    def test_concept_screen_handles_accents_paraphrases_and_numbers_without_verifying_quality(self):
        translations = {
            'en': 'The meeting begins at 3, not at five. Please do not open the door. If it rains, we will remain indoors.',
            'es': 'La reunión comienza a las tres, no a las 5. Por favor, no abras la puerta. Si llueve, nos quedaremos dentro.',
            'fr': "La réunion commence à trois heures, pas à cinq. N’ouvrez pas la porte. S’il pleut, nous resterons à l’intérieur.",
        }
        for language, text in translations.items():
            with self.subTest(language=language):
                result = concept_screen(text, language)
                self.assertTrue(result['all_concepts_observed'])
                self.assertFalse(result['translation_quality_verified'])
                self.assertEqual(len(result['checks']), 5)

    def test_wrong_number_and_negation_do_not_pass_known_concept_screen(self):
        result = concept_screen('The meeting starts at five. Please open the door. It is sunny and we will leave.', 'en')
        self.assertFalse(result['all_concepts_observed'])
        self.assertFalse(result['checks']['time_three'])
        self.assertFalse(result['checks']['not_five'])
        self.assertFalse(result['checks']['door_negation'])
        # Lexical checks intentionally do not distinguish every ambiguity.
        # Nothing in this screen may be promoted into semantic proof.
        self.assertFalse(result['translation_quality_verified'])

    def test_silent_pcm_cannot_be_reported_as_voice_or_physical_stutter_measurement(self):
        result = pcm_summary(b'\0\0' * 24000)
        self.assertFalse(result['has_signal'])
        self.assertEqual(result['rms'], 0)
        self.assertEqual(result['duration_seconds'], 1)
        self.assertEqual(result['longest_low_energy_run_ms'], 1000)
        self.assertTrue(result['low_energy_runs_are_not_proof_of_stutter'])

    def test_confirmed_parts_without_segment_ids_append_while_corrections_replace(self):
        captions = {}
        collect_caption(captions, {'turn_id': 'turn-one', 'text': 'At three, '})
        collect_caption(captions, {'turn_id': 'turn-one', 'text': 'not at five.'})
        self.assertEqual(' '.join(captions.values()), 'At three, not at five.')
        collect_caption(captions, {'turn_id': 'turn-two', 'segment_id': 'one', 'operation': 'replace', 'text': 'Open the door.'})
        collect_caption(captions, {'turn_id': 'turn-two', 'segment_id': 'one', 'operation': 'replace', 'text': 'Do not open the door.'})
        self.assertEqual(len(captions), 2)
        self.assertTrue(' '.join(captions.values()).endswith('Do not open the door.'))

    def test_decoded_pcm_energy_duration_and_clipping_remain_separate(self):
        raw = struct.pack('<4h', 32767, -32768, 0, 0)
        result = pcm_summary(raw)
        self.assertTrue(result['has_signal'])
        self.assertEqual(result['samples'], 4)
        self.assertEqual(result['peak'], 1)
        self.assertEqual(result['clipped_fraction'], .5)
        self.assertAlmostEqual(result['rms'], math.sqrt((32767 / 32768) ** 2 / 4 + .25), places=6)
        self.assertEqual(pcm_summary(b'')['samples'], 0)


if __name__ == '__main__':
    unittest.main()
