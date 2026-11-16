"""Story boundary tests; no inference, media download or renderer is launched."""
from copy import deepcopy
import unittest

from services.motion.story_contract import canvas_size, validate_story


def element(kind='text', **changed):
    value = {'type': kind, 'x': 10, 'y': 20, 'w': 80, 'h': 40}
    value.update({
        'text': {'text': 'Una historia', 'font_size': 60, 'weight': 600,
                 'color': '#0071e3', 'align': 'left'},
        'film': {'asset_id': 'sintel-rooftop', 'source_start': 180.5,
                 'position': 60, 'fit': 'cover'},
        'image': {'asset_id': 'selected:0', 'fit': 'contain'},
        'illustration': {'name': 'melodi'},
        'shape': {'shape': 'path', 'fill': 'none', 'stroke': '#0071e3',
                  'stroke_width': 4, 'd': 'M 0 0 L 90 20 Q 100 30 90 40 Z'},
    }[kind])
    value.update(changed)
    return value


def story():
    return {'version': 1, 'title': 'Qué es Brivany', 'format': 'portrait',
            'fps': 30, 'duration': 15, 'voice': True,
            'music': {'asset_id': 'origami', 'start': 8}, 'credits_duration': 3,
            'scenes': [{'id': 'scene-one', 'duration': 12, 'background': '#fbfcfd',
                        'transition': 'slide_up', 'narration': 'Una forma de entender.',
                        'elements': [element()]}]}


class StoryContractTests(unittest.TestCase):
    def test_fifteen_second_story_is_detached_and_keeps_optional_fields(self):
        plan = story()
        plan['scenes'][0]['elements'] = [element(k, start=.1, end=11.5, enter='wipe', exit='fade')
                                         for k in ('text', 'film', 'image', 'illustration', 'shape')]
        result = validate_story(plan, requested_duration=15)
        self.assertEqual(result, plan)
        self.assertIsNot(result, plan)
        result['music']['start'] = 9
        result['scenes'][0]['elements'][0]['text'] = 'Revisión'
        self.assertEqual(plan['music']['start'], 8)
        self.assertEqual(plan['scenes'][0]['elements'][0]['text'], 'Una historia')
        self.assertEqual(validate_story(result)['scenes'][0]['elements'][0]['text'], 'Revisión')

    def test_canvas_formats_are_fixed(self):
        for format, expected in [('portrait', (1080, 1920)), ('landscape', (1920, 1080)), ('square', (1080, 1080))]:
            self.assertEqual(canvas_size(format), expected)
        for bad in ('vertical', '../portrait', None, [], True):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                canvas_size(bad)

    def test_exact_outer_contract_rejects_missing_extra_and_executable_fields(self):
        for mutate in (lambda p: p.pop('music'), lambda p: p.update(script='alert(1)'),
                       lambda p: p['scenes'][0].update(html='<script/>'),
                       lambda p: p['scenes'][0]['elements'][0].update(onload='alert(1)')):
            plan = story(); mutate(plan)
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                validate_story(plan)

    def test_assets_cannot_be_urls_paths_or_outside_the_selected_set(self):
        for bad in ('https://example.com/video.mp4', 'file:///video.mp4', '../video',
                    r'C:\secret.mp4', 'selected:8', 'selected:00', 'Sintel', 'film_id', 'x' * 52):
            for kind in ('film', 'image'):
                plan = story(); plan['scenes'][0]['elements'] = [element(kind, asset_id=bad)]
                with self.subTest(bad=bad, kind=kind), self.assertRaises(ValueError):
                    validate_story(plan)
            plan = story(); plan['music']['asset_id'] = bad
            with self.subTest(bad=bad, kind='music'), self.assertRaises(ValueError):
                validate_story(plan)
        plan = story(); plan['scenes'][0]['elements'] = [element('film', asset_id='selected:7')]
        self.assertEqual(validate_story(plan)['scenes'][0]['elements'][0]['asset_id'], 'selected:7')
        with self.assertRaises(ValueError):
            validate_story(plan, max_media_id_length=5)

    def test_elements_cannot_render_outside_canvas(self):
        for changed in ({'x': -.01}, {'y': 100}, {'w': 0}, {'h': 0},
                        {'x': 20.000001}, {'y': 60.000001}, {'w': 101},
                        {'h': float('inf')}, {'x': float('nan')}):
            plan = story(); plan['scenes'][0]['elements'] = [element(**changed)]
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_story(plan)
        plan = story(); plan['scenes'][0]['elements'] = [element(x=0, y=0, w=100, h=100)]
        validate_story(plan)

    def test_element_time_window_is_scene_local_and_nonempty(self):
        for changed in ({'start': -1}, {'end': 12.1}, {'start': 12},
                        {'start': 4, 'end': 4}, {'start': 5, 'end': 3},
                        {'end': 0}, {'start': float('nan')}):
            plan = story(); plan['scenes'][0]['elements'] = [element(**changed)]
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_story(plan)
        plan = story(); plan['scenes'][0]['elements'] = [element(start=0, end=12)]
        self.assertEqual(validate_story(plan), plan)

    def test_boolean_and_nonfinite_values_do_not_masquerade_as_numbers(self):
        for key, value in [('version', True), ('fps', True), ('fps', 30.0),
                           ('duration', 15.0), ('duration', True), ('voice', 1),
                           ('credits_duration', float('inf'))]:
            plan = story(); plan[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                validate_story(plan)
        for changed in ({'x': True}, {'font_size': True}, {'font_size': 60.0},
                        {'weight': 600.0}):
            plan = story(); plan['scenes'][0]['elements'] = [element(**changed)]
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_story(plan)
        for bad in (True, float('nan'), float('inf'), 10**400):
            plan = story(); plan['music']['start'] = bad
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_story(plan)

    def test_svg_paths_are_literal_bounded_geometry(self):
        for bad in ('<path onload="alert(1)"/>', 'javascript:alert(1)',
                    'M 0 0; window.open(1)', 'M 0 0 L NaN 10', 'M1e999 0',
                    'L 0 0', 'M' + '0' * 6000):
            plan = story(); plan['scenes'][0]['elements'] = [element('shape', d=bad)]
            with self.subTest(bad=bad[:35]), self.assertRaises(ValueError):
                validate_story(plan)
        plan = story(); plan['scenes'][0]['elements'] = [element('shape', d='m.1 -.5 c1e2,0 0,2 3,4z')]
        validate_story(plan)

    def test_emails_are_rejected_but_text_punctuation_is_preserved_as_data(self):
        for email in ('private@example.com', 'nombre.apellido+tag@sub.example.org', 'persona@intranet'):
            for location in ('title', 'narration', 'text'):
                plan = story()
                if location == 'title': plan['title'] = email
                elif location == 'narration': plan['scenes'][0]['narration'] = 'Contacto: ' + email
                else: plan['scenes'][0]['elements'][0]['text'] = email
                with self.subTest(location=location), self.assertRaises(ValueError):
                    validate_story(plan)
        plan = story(); plan['scenes'][0]['elements'][0]['text'] = '2 < 3 & 5 > 4; "hola"'
        self.assertEqual(validate_story(plan), plan)

    def test_story_duration_includes_readable_credits_and_respects_explicit_request(self):
        with self.assertRaises(ValueError): validate_story(story(), requested_duration=16)
        for credits in (1.99, 8.01, True):
            plan = story(); plan['credits_duration'] = credits
            with self.subTest(credits=credits), self.assertRaises(ValueError): validate_story(plan)
        plan = story(); plan['scenes'][0]['duration'] = 11.97
        validate_story(plan)
        plan['scenes'][0]['duration'] = 11.96
        with self.assertRaises(ValueError): validate_story(plan)
        plan = story(); plan['scenes'][0]['duration'] = 11.98; plan['fps'] = 60
        with self.assertRaises(ValueError): validate_story(plan)

    def test_finite_scene_and_element_counts_and_identifiers(self):
        for count in (0, 25):
            plan = story(); plan['scenes'] = [deepcopy(plan['scenes'][0]) for _ in range(count)]
            with self.subTest(count=count), self.assertRaises(ValueError): validate_story(plan)
        plan = story(); plan['scenes'][0]['duration'] = 6
        plan['scenes'].append(deepcopy(plan['scenes'][0]))
        with self.assertRaises(ValueError): validate_story(plan)
        plan['scenes'][1]['id'] = 'scene-two'; validate_story(plan)
        for bad in ('../scene', '9scene', 'scene.one', 'x' * 32):
            plan = story(); plan['scenes'][0]['id'] = bad
            with self.subTest(bad=bad), self.assertRaises(ValueError): validate_story(plan)
        plan = story(); plan['scenes'][0]['elements'] = [element() for _ in range(21)]
        with self.assertRaises(ValueError): validate_story(plan)

    def test_each_element_accepts_only_its_own_fields_and_supported_variants(self):
        for bad in (element('illustration', name='download-model'), element('image', asset_id='public-image'),
                    element('film', source_start=21601), element('shape', stroke_width=21),
                    element('shape', fill='url(https://example.com)'), element(color='#fff'),
                    element(align='justify'), element(enter='execute'), element(exit='hide'),
                    element('illustration', text='unrelated')):
            plan = story(); plan['scenes'][0]['elements'] = [bad]
            with self.subTest(bad=bad), self.assertRaises(ValueError): validate_story(plan)


if __name__ == '__main__': unittest.main()
