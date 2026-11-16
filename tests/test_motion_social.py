"""Social videos (edition 4): contract, honesty rules, timing, captions, routing
and the local audio. No model or voice API calls; the voice is a fixture."""
from copy import deepcopy
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock
from uuid import uuid4

import numpy as np

from services.computer.planner import creative_motion_request, explicit_image_request
from services.motion import social_audio as audio
from services.motion.social_contract import validate_social, claims_feedback
from services.motion.social_service import SocialService, chapters, detect_destination, group_captions, is_social_request, shot_timing, srt
from tests.social_fixtures import fake_voice, story_plan


class ContractTests(unittest.TestCase):
    def test_valid_story_plan_is_detached_copy(self):
        plan = story_plan()
        result = validate_social(plan, destination='instagram_story')
        result['shots'][0]['headline'] = 'otra'
        self.assertNotEqual(plan['shots'][0]['headline'], 'otra')

    def test_destination_must_match_request(self):
        with self.assertRaisesRegex(ValueError, 'reel'):
            validate_social(story_plan(), destination='reel')

    def test_rejects_unknown_kits_code_and_extra_fields(self):
        for mutate in (lambda p: p['shots'][1].update(kit='<script>'),
                       lambda p: p['shots'][1].update(html='<b>x</b>'),
                       lambda p: p.update(code='alert(1)')):
            plan = story_plan()
            mutate(plan)
            with self.assertRaises(ValueError):
                validate_social(plan)

    def test_honesty_rules_block_overpromising(self):
        for text in ('Traducción instantánea', 'Entiende cada palabra al instante','Clono tu voz al instante', 'Latencia de 200 ms', 'Funciona perfecto', 'millones de usuarios'):
            self.assertIsNotNone(claims_feedback(text), text)
            plan = story_plan()
            plan['shots'][1]['narration'] = text
            with self.assertRaises(ValueError):
                validate_social(plan)
        self.assertIsNone(claims_feedback('Con una voz nueva, la clonación tarda unos segundos.'))

    def test_no_emails_or_links_on_screen(self):
        plan = story_plan()
        plan['shots'][0]['body'] = 'Escribe a ana@example.com'
        with self.assertRaisesRegex(ValueError, 'correo'):
            validate_social(plan)
        plan = story_plan()
        plan['shots'][0]['body'] = 'www.ejemplo.com'
        with self.assertRaisesRegex(ValueError, 'enlaces'):
            validate_social(plan)

    def test_accent_must_be_literal_and_end_card_last(self):
        plan = story_plan()
        plan['shots'][1]['accent'] = 'nada'
        with self.assertRaisesRegex(ValueError, 'accent'):
            validate_social(plan)
        plan = story_plan()
        plan['shots'][0], plan['shots'][2] = plan['shots'][2], plan['shots'][0]
        with self.assertRaises(ValueError):
            validate_social(plan)

    def test_optional_fields_default_but_kit_layout_needs_an_illustration(self):
        plan = story_plan()
        for key in ('kicker', 'accent', 'body', 'transition'):
            del plan['shots'][0][key]
        result = validate_social(plan)
        self.assertEqual((result['shots'][0]['kicker'], result['shots'][0]['transition']), ('', 'cut'))
        plan = story_plan()
        del plan['shots'][0]['kit']
        with self.assertRaisesRegex(ValueError, 'ilustración'):  # vertical shots and the hook need a big illustration
            validate_social(plan)
        plan = story_plan()
        del plan['shots'][1]['kit']
        with self.assertRaisesRegex(ValueError, 'kit'):
            validate_social(plan)
        plan = story_plan()
        plan['shots'][2]['kit'] = 'chat'
        with self.assertRaisesRegex(ValueError, 'logo'):
            validate_social(plan)

    def test_post_text_does_not_promise_a_duration(self):
        plan = story_plan()
        plan['publish']['caption'] = 'Te enseño en 2 minutos todo lo que hago en Brivany.'
        with self.assertRaisesRegex(ValueError, 'duración'):
            validate_social(plan)

    def test_headline_is_short_and_not_the_narration(self):
        plan = story_plan()
        plan['shots'][1]['headline'] = 'Escribo el guion, animo las ilustraciones y pongo voz'
        with self.assertRaisesRegex(ValueError, '8 palabras'):
            validate_social(plan)
        plan = story_plan()
        plan['shots'][1]['headline'] = plan['shots'][1]['narration']
        plan['shots'][1]['accent'] = ''
        with self.assertRaises(ValueError):
            validate_social(plan)

    def test_estimated_length_must_fit_destination(self):
        plan = story_plan()
        plan['shots'][1]['narration'] = ' '.join(['voz'] * 75)
        with self.assertRaisesRegex(ValueError, 'admite'):
            validate_social(plan)


class TimingTests(unittest.TestCase):
    def test_shots_follow_voice_and_land_on_beats(self):
        plan = validate_social(story_plan())
        voices = [{'first': .1, 'last': 2.0}, {'first': .1, 'last': 3.3}, {'first': .1, 'last': 1.2}]
        timing, total = shot_timing(plan, voices)
        beat = 60 / plan['music']['bpm']
        for t in timing:
            self.assertAlmostEqual(t['duration'] / beat, round(t['duration'] / beat), places=4)
            self.assertGreater(t['voice_at'], t['start'])
        self.assertGreaterEqual(timing[1]['duration'], .32 + 3.2 + .42)
        self.assertGreaterEqual(timing[2]['duration'], 3.5)  # end card keeps the logo on screen
        self.assertAlmostEqual(total, sum(t['duration'] for t in timing), places=3)

    def test_captions_do_not_cross_shots_and_srt_is_well_formed(self):
        words = [{'w': w, 'start': i * .3, 'end': i * .3 + .25, 'shot': 0 if i < 6 else 1}
                 for i, w in enumerate('Hola. Te enseño algo que puedo hacer hoy contigo'.split())]
        cues = group_captions(words, True)
        for cue in cues:
            self.assertLessEqual(len(cue['words']), 4)
            self.assertLess(cue['start'], cue['end'])
        self.assertEqual(cues[0]['words'][-1]['w'], 'Hola.')
        self.assertTrue(all(len({words[[x['w'] for x in words].index(w['w'])]['shot'] for w in c['words']}) == 1 for c in cues))
        text = srt(cues)
        self.assertIn('00:00:00,000 --> ', text)
        self.assertEqual(text.count('-->'), len(cues))


class ChapterTests(unittest.TestCase):
    def test_youtube_chapters_start_at_zero_and_last_ten_seconds(self):
        plan = {'shots': [{'kicker': f'K{i}', 'headline': f'H{i}'} for i in range(8)]}
        timing = [{'start': i * 6.0, 'duration': 6.0} for i in range(8)]
        marks = chapters(plan, timing)
        self.assertEqual(marks[0][0], 0.0)
        self.assertGreaterEqual(len(marks), 3)
        ends = [m[0] for m in marks[1:]] + [48.0]
        self.assertTrue(all(b - a >= 10 for (a, _), b in zip(marks, ends)))
        self.assertEqual(chapters(plan, timing[:2] + [{'start': 12.0, 'duration': 1.0}]), [])


class ReviewTests(unittest.TestCase):
    def item(self, role, x, y, w=300, h=60, font=60, clipped=False):
        return {'role': role, 'text': role, 'x': x, 'y': y, 'w': w, 'h': h, 'font': font, 'clipped': clipped}

    def test_layout_blocks_unsafe_clipped_small_or_covered_text(self):
        from services.motion.social_review import review_layout
        good = [{'t': 1, 'items': [self.item('headline', 120, 400), self.item('caption', 300, 1300, font=50)]}]
        self.assertEqual(review_layout('reel', (1080, 1920), good), [])
        cases = {'outside_safe_zone': self.item('headline', 120, 1600),          # under the TikTok caption area
                 'clipped_text': self.item('body', 120, 600, font=40, clipped=True),
                 'small_text': self.item('caption', 300, 1000, font=30)}
        for kind, item in cases.items():
            findings = review_layout('reel', (1080, 1920), [{'t': 1, 'items': [item]}])
            self.assertIn(kind, {f['kind'] for f in findings if f['level'] == 'block'}, kind)
        covered = [{'t': 1, 'items': [self.item('headline', 300, 1300), self.item('caption', 300, 1300, font=50)]}]
        self.assertIn('caption_covers_text', {f['kind'] for f in review_layout('reel', (1080, 1920), covered)})

    def test_mix_threshold_timing_and_word_accuracy(self):
        from services.motion.social_review import review_mix, review_timing, speech_to_bed, word_accuracy
        self.assertTrue(review_mix({'median_db': 11.0, 'p10_db': 3.0}))
        self.assertEqual([f for f in review_mix({'median_db': 18.0, 'p10_db': 9.0}) if f['level'] == 'block'], [])
        t = np.arange(48000) / 48000
        voice, bed = .2 * np.sin(2 * np.pi * 200 * t), .01 * np.sin(2 * np.pi * 90 * t)
        self.assertGreater(speech_to_bed(voice, bed, 48000)['median_db'], 20)
        data = {'timing': [{'start': 0, 'duration': 3}], 'words': [{'w': 'Hola'}],
                'captions': [{'start': .3, 'end': 1.0, 'words': [{'w': 'Hola', 'start': .3}]}]}
        self.assertEqual(review_timing(data, [{'offset': .2, 'first': .1, 'last': 1.0}]), [])
        late = review_timing(data, [{'offset': .2, 'first': .1, 'last': 2.9}])
        self.assertIn('voice_runs_into_next_shot', {f['kind'] for f in late})
        self.assertEqual(word_accuracy('Hola, soy Melodi.', 'hola soy melodi'), 1.0)
        self.assertLess(word_accuracy('Hola soy Melodi', 'hola soy'), 1.0)


class CopyAndCompositionTests(unittest.TestCase):
    def shot(self, kicker, headline, body='', kit='chat', labels=()):
        return {'kicker': kicker, 'headline': headline, 'body': body, 'kit': kit, 'labels': list(labels)}

    def test_redundant_kicker_filler_and_pleonasm(self):
        from services.motion.social_copy import copy_issues
        self.assertTrue(copy_issues(self.shot('Mira esto', 'Mira cómo lo creo')))
        self.assertTrue(copy_issues(self.shot('Hola soy yo', 'Soy Melodi')))
        self.assertTrue(copy_issues(self.shot('Paso uno', 'Elijo tema', 'Busco un gancho que enganche.')))
        self.assertEqual(copy_issues(self.shot('Videos y reuniones', 'Entiende otro idioma')), [])

    def test_example_languages_must_match(self):
        from services.motion.social_copy import copy_issues, detect_language
        self.assertEqual([detect_language(t) for t in ('We need a decision today', 'Necesitamos decidir hoy', 'Wir müssen heute los')], ['en', 'es', 'de'])
        self.assertTrue(copy_issues(self.shot('', 'Tu reunión', kit='meeting', labels=['Necesitamos decidir hoy', 'We need a decision today'])))
        self.assertEqual(copy_issues(self.shot('', 'Tu reunión', kit='meeting', labels=['We need a decision today', 'Necesitamos decidir hoy'])), [])

    def test_hashtag_accents_and_cta_destination(self):
        from services.motion.social_copy import hashtag_issues
        self.assertTrue(hashtag_issues(['#TraduccionEnVivo']))
        self.assertEqual(hashtag_issues(['#Traducción', '#IAEnEspañol']), [])
        plan = story_plan()
        plan['cta'] = 'Prueba Brivany'
        with self.assertRaisesRegex(ValueError, 'vetsa.es'):
            validate_social(plan)
        plan = story_plan()
        plan['shots'][2]['narration'] = 'Pídemelo cuando quieras.'
        with self.assertRaisesRegex(ValueError, 'adónde'):
            validate_social(plan)
        plan = story_plan()
        plan['publish']['hashtags'] = ['#Melodi', '#Traduccion', '#IA']
        with self.assertRaisesRegex(ValueError, 'tilde'):
            validate_social(plan)

    def test_composition_blocks_empty_bands_and_small_illustrations(self):
        from services.motion.social_review import review_composition
        item = lambda role, y, h, w=900: {'role': role, 'text': role, 'x': 90, 'y': y, 'w': w, 'h': h, 'font': 60, 'clipped': False}
        full = [{'t': 2.0, 'items': [item('headline', 300, 250), item('visual', 560, 760), item('caption', 1330, 100)]}]
        self.assertEqual(review_composition('instagram_story', (1080, 1920), full, {2.0}), [])
        empty = [{'t': 2.0, 'items': [item('headline', 300, 250), item('visual', 560, 300), item('caption', 1430, 100)]}]
        self.assertIn('empty_band', {f['kind'] for f in review_composition('instagram_story', (1080, 1920), empty, {2.0})})
        narrow = [{'t': 2.0, 'items': [item('headline', 300, 250), item('visual', 560, 760, w=420), item('caption', 1330, 100)]}]
        self.assertIn('small_illustration', {f['kind'] for f in review_composition('instagram_story', (1080, 1920), narrow, {2.0})})

    def test_subtitles_use_written_forms_and_spoken_forms_are_blocked(self):
        from services.motion.social_copy import spoken_form_issues, written_words
        mk = lambda s: [{'w': w, 'start': i * .3, 'end': i * .3 + .25, 'shot': 0} for i, w in enumerate(s.split())]
        out = written_words(mk('Más en vetsa punto es, enlace en la bio.'))
        self.assertEqual(' '.join(w['w'] for w in out), 'Más en vetsa.es, enlace en la bio.')
        self.assertEqual((out[2]['start'], out[2]['end']), (.6, 1.45))  # spans the three spoken words
        self.assertEqual(' '.join(w['w'] for w in written_words(mk('Creció un 14 por ciento'))), 'Creció un 14 %')
        self.assertEqual(' '.join(w['w'] for w in written_words(mk('El punto es que funciona.'))), 'El punto es que funciona.')
        self.assertTrue(spoken_form_issues('Más en vetsa punto es'))
        self.assertTrue(spoken_form_issues('hola arroba vetsa'))
        self.assertEqual(spoken_form_issues('El punto es que funciona. Más en vetsa.es'), [])

    def test_empty_band_is_checked_at_the_start_of_each_shot_too(self):
        from services.motion.social_review import review_composition
        item = lambda role, y, h: {'role': role, 'text': role, 'x': 90, 'y': y, 'w': 900, 'h': h, 'font': 60, 'clipped': False}
        early = [{'t': 1.0, 'items': [item('headline', 300, 250), item('visual', 560, 380), item('caption', 1440, 100)]}]
        self.assertIn('empty_band', {f['kind'] for f in review_composition('instagram_story', (1080, 1920), early, {2.0})})

    def test_static_hook_is_blocked(self):
        from PIL import Image
        from services.motion.social_review import review_hook
        with tempfile.TemporaryDirectory() as temp:
            a, b, c = (Path(temp) / n for n in ('a.png', 'b.png', 'c.png'))
            Image.new('RGB', (1080, 1920), '#080b11').save(a)
            Image.new('RGB', (1080, 1920), '#080b11').save(b)
            Image.new('RGB', (1080, 1920), '#fbfcfd').save(c)
            self.assertIn('static_hook', {f['kind'] for f in review_hook(a, b, .9)[0]})
            self.assertEqual(review_hook(a, c, .9)[0], [])
            self.assertIn('weak_hook_image', {f['kind'] for f in review_hook(a, c, .3)[0]})


class ClientBrandTests(unittest.TestCase):
    BRAND = {'name': 'Casa Ejemplo', 'site': 'casaejemplo.com', 'spoken_site': ['casa ejemplo dot com']}

    def client_plan(self):
        plan = story_plan()
        plan.update(language='en', brand={'name': 'Casa Ejemplo', 'site': 'casaejemplo.com'}, cta='Book at casaejemplo.com')
        plan['shots'][0].update(kit='villa', kicker='Samaná', headline='Your jungle villa', accent='', labels=['Where Jungle Meets Sea'],
                                narration='Want jungle and sea in one stay?')
        plan['shots'][1].update(kit='web_button', kicker='Step 1', headline='Tap “Book Your Stay”', accent='', narration='Start right on the website.',
                                labels=['casaejemplo.com', 'Book Your Stay'])
        plan['shots'][2].update(kit='brand_logo', headline='Your escape awaits', accent='', labels=['Where Jungle Meets Sea', 'casaejemplo.com'],
                                narration='Visit casa ejemplo dot com.')
        plan['publish']['hashtags'] = ['#CasaEjemplo', '#Villa', '#HowToBook']
        return plan

    def test_client_promo_validates_brand_language_and_destination(self):
        result = validate_social(self.client_plan(), brand=self.BRAND, language='en')
        self.assertEqual((result['language'], result['brand']['site']), ('en', 'casaejemplo.com'))
        bad = self.client_plan()
        bad['cta'] = 'Book now'
        with self.assertRaisesRegex(ValueError, 'casaejemplo.com'):
            validate_social(bad, brand=self.BRAND, language='en')
        bad = self.client_plan()
        bad['shots'][2]['narration'] = 'See you soon.'
        with self.assertRaisesRegex(ValueError, 'adónde'):
            validate_social(bad, brand=self.BRAND, language='en')
        with self.assertRaises(ValueError):  # a client plan is not a Brivany video
            validate_social(self.client_plan())
        bad = self.client_plan()
        bad['shots'][1]['narration'] = 'Book instantly with guaranteed best price.'
        with self.assertRaisesRegex(ValueError, 'overpromise'):
            validate_social(bad, brand=self.BRAND, language='en')

    def test_spoken_site_becomes_written_and_requests_are_detected(self):
        from services.motion.social_copy import written_sites, written_words
        from services.motion.social_service import detect_destination, detect_language
        mk = lambda s: [{'w': w, 'start': i * .3, 'end': i * .3 + .25, 'shot': 0} for i, w in enumerate(s.split())]
        out = written_words(written_sites(mk('Visit casa ejemplo dot com.'), {'casaejemplo.com': ['casa ejemplo dot com']}))
        self.assertEqual(' '.join(w['w'] for w in out), 'Visit casaejemplo.com.')
        request = 'Crea un video corto vertical 9:16 de 15 segundos de cómo reservar, con la voz de Melodi en inglés.'
        self.assertEqual((detect_destination(request), detect_language(request)), ('short', 'en'))
        self.assertIsNone(detect_destination('Crea una ilustración vertical de la villa'))


class RoutingTests(unittest.TestCase):
    def test_social_requests_reach_the_video_creator(self):
        cases = {'Crea una historia de Instagram en video promocionándote, con tu voz': 'instagram_story',
                 'Crea un reel para Instagram y TikTok sobre tus capacidades': 'reel',
                 'Crea un video largo horizontal para YouTube': 'youtube'}
        for text, destination in cases.items():
            self.assertTrue(creative_motion_request(text), text)
            self.assertFalse(explicit_image_request(text), text)
            self.assertTrue(is_social_request(text))
            self.assertEqual(detect_destination(text), destination)

    def test_static_story_image_stays_an_image(self):
        self.assertTrue(explicit_image_request('Crea una historia de Instagram con esta imagen'))
        self.assertFalse(is_social_request('¿Qué es un reel?'))


class AudioTests(unittest.TestCase):
    def test_score_is_original_bounded_and_on_length(self):
        for mood in ('pulse', 'bright', 'calm', 'cinematic'):
            music = audio.score(6.0, 120, mood, [2.0, 4.0], 4.0)
            self.assertEqual(music.shape, (int(6.0 * audio.SR), 2))
            self.assertTrue(np.isfinite(music).all())
            self.assertGreater(np.abs(music).max(), .01)

    def test_effects_follow_runtime_cues(self):
        fx = audio.effects(3.0, [{'t': 1.0, 'type': 'pop'}, {'t': 2.0, 'type': 'whoosh'}, {'t': 2.5, 'type': 'chime'}])
        energy = lambda a, b: float(np.abs(fx[int(a * audio.SR):int(b * audio.SR)]).sum())
        self.assertLess(energy(0, .8), 1e-6)
        self.assertGreater(energy(1.0, 1.2), 1)


class ServiceTests(unittest.TestCase):
    def test_planning_retries_with_feedback_then_validates(self):
        with tempfile.TemporaryDirectory() as temp:
            service = SocialService(temp)
            bad = story_plan()
            bad['shots'][1]['kit'] = 'unknown'
            decide = Mock(side_effect=[bad, story_plan()])
            plan, calls, _ = service.plan('Crea una historia de Instagram en video', decide, destination='instagram_story')
            self.assertEqual(calls, 2)
            self.assertIn('validation_feedback', decide.call_args_list[1][0][1])
            context = decide.call_args_list[0][0][1]
            self.assertIn('capabilities', context)
            self.assertIn('voice_clone', context['kits'])

    def test_project_without_render_has_voice_timed_mix_and_effects(self):
        if not SocialService.availability()['available']:
            self.skipTest('Motor local no disponible')
        with tempfile.TemporaryDirectory() as temp:
            service = SocialService(temp)
            service.voice = fake_voice
            identifier = str(uuid4())
            result = service.run('Crea una historia de Instagram en video', identifier=identifier, decide=None,
                                 cancelled=threading.Event(), plan=story_plan(), render=False)
            folder = Path(temp) / identifier
            data = json.loads((folder / 'social.json').read_text(encoding='utf-8'))
            self.assertTrue((folder / 'assets/mix.wav').is_file())
            self.assertGreater(result['sfx_cues'], 3)
            self.assertTrue(data['captions'])
            self.assertTrue(8 <= data['total'] <= 22)
            html = (folder / 'index.html').read_text(encoding='utf-8')
            self.assertNotIn('<script>alert', html)
            report = json.loads((folder / 'delivery.json').read_text(encoding='utf-8'))
            self.assertTrue(report['handwritten_plan'])
            self.assertEqual(report['voice_requests'], 3)


if __name__ == '__main__':
    unittest.main()
