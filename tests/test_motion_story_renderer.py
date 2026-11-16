"""Pure renderer: ownership, literal copy, finite timing and offline resources."""
from html.parser import HTMLParser
import json
from pathlib import Path
import tempfile
import unittest
import wave

from services.motion.story_renderer import write_story_project


def text(value='Contenido de prueba'):
    return {'type': 'text', 'x': 10, 'y': 12, 'w': 80, 'h': 22, 'text': value,
            'font_size': 76, 'weight': 700, 'color': '#1d1d1f', 'align': 'left'}


def story(elements=None, *, format='portrait', voice=False):
    return {'version': 1, 'title': 'Historia propia', 'format': format, 'fps': 30,
            'duration': 15, 'voice': voice, 'music': None, 'credits_duration': 3,
            'scenes': [{'id': 'opening', 'duration': 6, 'background': '#fbfcfd',
                        'transition': 'fade', 'narration': '', 'elements': elements or [text()]},
                       {'id': 'closing', 'duration': 6, 'background': '#d6e8fc',
                        'transition': 'slide_up', 'narration': '', 'elements': [text('Otro plano')]}]}


class Tags(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.tags = []
        self.feed(html)
    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class StoryRendererTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve(); self.folder = self.root / 'project'; self.folder.mkdir()
    def source(self, name, value=b'owned fixture'):
        file = self.root / name; file.write_bytes(value); return file
    def sound(self):
        file = self.root / 'owned.wav'
        with wave.open(str(file), 'wb') as out:
            out.setparams((1, 2, 8000, 0, 'NONE', 'not compressed')); out.writeframes(bytes(8000 * 2))
        return file

    def test_markup_and_metadata_are_literal_and_never_executable(self):
        malicious = '</script><script>window.BAD=true</script><img src=x onerror=BAD()>'
        movie = self.source('source.mp4')
        film = {'type': 'film', 'x': 10, 'y': 40, 'w': 80, 'h': 35, 'asset_id': 'catalog-film',
                'source_start': 25, 'position': 50, 'fit': 'cover'}
        plan = story([text(malicious), film]); plan['title'] = '</title><script>BAD()</script>'
        result = write_story_project(self.folder, plan, media={'catalog-film': {
            'path': str(movie), 'title': '<img src=x onerror=BAD()>',
            'attribution': 'Author owner@example.com', 'license': 'CC BY 4.0',
            'source_url': 'https://example.com/film?private_token=do-not-show'}})
        opening = (self.folder / 'compositions/scene-opening.html').read_text(encoding='utf-8')
        self.assertIn('&lt;/script&gt;', opening)
        self.assertNotIn(malicious, opening)
        credits = (self.folder / 'compositions/story-credits.html').read_text(encoding='utf-8')
        self.assertNotIn('owner@example.com', credits)
        self.assertIn('[correo oculto]', credits)
        self.assertNotIn('<img src=x', credits)
        self.assertNotIn('private_token', (self.folder / 'CREDITS.md').read_text(encoding='utf-8'))
        self.assertFalse(result['arbitrary_code_executed'])
        self.assertEqual(movie.read_bytes(), b'owned fixture')

    def test_trim_binding_by_scene_index_wins_and_source_offset_is_not_applied_twice(self):
        first = self.source('first.mp4', b'first trimmed clip')
        fallback = self.source('fallback.mp4', b'wrong full source')
        film = {'type': 'film', 'x': 5, 'y': 25, 'w': 90, 'h': 45, 'asset_id': 'catalog-film',
                'source_start': 130, 'position': 64, 'fit': 'cover', 'start': 1, 'end': 5,
                'enter': 'scale', 'exit': 'fade'}
        write_story_project(self.folder, story([film]), media={
            'catalog-film': {'path': str(fallback)}, 'opening:0': {'path': str(first)}})
        page = (self.folder / 'compositions/scene-opening.html').read_text(encoding='utf-8')
        self.assertNotIn('data-media-start', page)
        tags = Tags(page).tags
        video = next(attrs for tag, attrs in tags if tag == 'video')
        self.assertEqual(video['data-start'], '1'); self.assertEqual(video['data-duration'], '4')
        self.assertIn('object-position:64%', video['style'])
        self.assertEqual((self.folder / video['src']).read_bytes(), b'first trimmed clip')
        wrapper = next(attrs for tag, attrs in tags if attrs.get('id') == 'scene-opening-element-0')
        self.assertNotIn('data-start', wrapper, 'video must not nest below another plain timed element')

    def test_invalid_or_outside_canvas_elements_write_no_project(self):
        plan = story(); plan['scenes'][0]['elements'][0]['x'] = 99
        with self.assertRaises(ValueError): write_story_project(self.folder, plan, media={})
        self.assertEqual(list(self.folder.iterdir()), [])
        with self.assertRaises(ValueError):
            write_story_project(self.folder, story([{'type': 'illustration', 'name': 'https://evil',
                                                    'x': 0, 'y': 0, 'w': 50, 'h': 50}]), media={})
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_complete_offline_resources_and_unique_svg_ids_in_three_formats(self):
        for format, dimensions in [('portrait', (1080, 1920)), ('landscape', (1920, 1080)), ('square', (1080, 1080))]:
            with self.subTest(format=format):
                folder = self.root / format; folder.mkdir()
                elements = [text()]
                for index, name in enumerate(['melodi', 'headphones', 'connections', 'wave', 'document', 'translation']):
                    elements.append({'type': 'illustration', 'name': name, 'x': index % 3 * 30 + 5,
                                     'y': 40 + index // 3 * 23, 'w': 28, 'h': 22, 'enter': 'scale'})
                result = write_story_project(folder, story(elements, format=format), media={})
                self.assertEqual((result['width'], result['height']), dimensions)
                root = (folder / 'index.html').read_text(encoding='utf-8')
                self.assertIn('data-duration="15"', root)
                self.assertNotIn('src="http', root)
                for file in ['gsap.min.js', 'BrivanyEditorial-Light.woff2', 'BrivanyEditorial-Regular.woff2', 'BrivanyEditorial-Medium.woff2', 'LICENSE-AND-ATTRIBUTION.txt', 'wordmark.svg']:
                    self.assertTrue((folder / 'assets/brivany-runtime' / file).is_file())
                scene = (folder / 'compositions/scene-opening.html').read_text(encoding='utf-8')
                tags = Tags(scene).tags; ids = [a['id'] for _, a in tags if 'id' in a]
                self.assertEqual(len(ids), len(set(ids)))
                self.assertIn('linearGradient', scene)
                self.assertIn('feDropShadow', scene)
                self.assertIn('gsap.timeline({paused:true})', scene)
                self.assertNotIn('Math.random', scene)
                self.assertNotIn('setInterval', scene)

    def test_original_project_is_not_overwritten_and_missing_media_fails_before_writing(self):
        write_story_project(self.folder, story(), media={})
        before = (self.folder / 'index.html').read_bytes()
        with self.assertRaises(FileExistsError): write_story_project(self.folder, story(), media={})
        self.assertEqual((self.folder / 'index.html').read_bytes(), before)
        other = self.root / 'other'; other.mkdir()
        movie = {'type': 'film', 'x': 0, 'y': 0, 'w': 100, 'h': 100, 'asset_id': 'missing',
                 'source_start': 0, 'position': 50, 'fit': 'cover'}
        with self.assertRaises(ValueError): write_story_project(other, story([movie]), media={})
        self.assertEqual(list(other.iterdir()), [])

    def test_voice_times_and_already_mixed_audio_keep_voice_level(self):
        audio = self.sound()
        plan = story(voice=True)
        with self.assertRaisesRegex(ValueError, 'créditos'):
            write_story_project(self.folder, plan, media={}, voice_segments=[{'path': str(audio), 'start': 11.5, 'duration': 1}])
        self.assertEqual(list(self.folder.iterdir()), [])
        write_story_project(self.folder, plan, media={}, voice_segments=[], music={
            'path': str(audio), 'duration': 15, 'full_mix': True})
        tags = Tags((self.folder / 'index.html').read_text(encoding='utf-8')).tags
        mixed = next(a for t, a in tags if t == 'audio')
        self.assertEqual(mixed['id'], 'music-bed'); self.assertEqual(mixed['data-volume'], '1')
        self.assertNotIn('data-automation', mixed)

    def test_portable_result_view_uses_native_mp4_controls_without_autoplay_or_scene_fetch(self):
        result = write_story_project(self.folder, story(), media={})
        viewer = Path(result['standalone_path']).read_text(encoding='utf-8')
        tags = Tags(viewer).tags
        video = next(attrs for tag, attrs in tags if tag == 'video')
        self.assertEqual(video['src'], '../Brivany.mp4')
        self.assertIn('controls', video)
        self.assertNotIn('autoplay', video)
        self.assertFalse(any(tag == 'script' for tag, _ in tags))
        self.assertNotIn('data-composition-src', viewer)
        self.assertFalse(result['standalone_is_editor'])
        self.assertTrue(result['preview_requires_project_folder'])
        self.assertEqual(result['preview_kind'], 'video')
        self.assertTrue((self.folder / 'README.md').is_file())

    def test_image_preview_is_explicit_not_inferred_from_voice_and_title_stays_literal(self):
        plan = story(voice=True)
        plan['title'] = '</h1><script>BAD()</script>'
        result = write_story_project(self.folder, plan, media={}, still=True)
        page = Path(result['standalone_path']).read_text(encoding='utf-8')
        tags = Tags(page).tags
        image = next(attrs for tag, attrs in tags if tag == 'img' and attrs.get('id') == 'result')
        self.assertEqual(image['src'], '../Brivany.png')
        self.assertFalse(any(tag in {'video', 'script'} for tag, _ in tags))
        self.assertIn('&lt;script&gt;', page)
        self.assertEqual(result['preview_kind'], 'image')


if __name__ == '__main__':
    unittest.main()
