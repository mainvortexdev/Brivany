"""Catalog policy, bounded acquisition and one actual local excerpt; no paid APIs."""
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from services.motion.media_library import (MediaLibrary, MUSIC, VIDEOS,
    _OfficialMusicRedirect, _official)
from services.terminal.executor import TerminalExecutor


class Response(io.BytesIO):
    def __init__(self, data, *, url=None, length=None, mime='audio/mpeg'):
        super().__init__(data)
        self.url = url or MUSIC['electric-dreams']['source']
        self.headers = {'Content-Type': mime}
        if length is not None:
            self.headers['Content-Length'] = str(length)
    def geturl(self):
        return self.url


class Opener:
    def __init__(self, response):
        self.response = response
        self.requests = []
    def open(self, request, **kwargs):
        self.requests.append(request)
        return self.response


class Executor:
    def __init__(self, stop=None):
        self.calls = []
        self.stop = stop
        self.duration = 2.0
    def binary(self, name):
        return name
    def run(self, operation, binary, args, **options):
        self.calls.append((operation, binary, args, options))
        if operation == 'motion.media_excerpt':
            Path(args[-1]).write_bytes(b'owned fake video')
            self.duration = float(args[args.index('-t')+1])
            if self.stop:
                self.stop.set()
        audio = args[-1].endswith('.mp3')
        output = {'format': {'duration': self.duration},
                  'streams': [{'codec_type': 'audio'}] if audio else
                  [{'codec_type': 'video', 'width': 1920, 'height': 1080}]}
        return {'exit_code': 0, 'output': json.dumps(output)}
    def require_success(self, receipt):
        assert receipt['exit_code'] == 0


class MediaLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.stop = threading.Event()
    def tearDown(self):
        self.temp.cleanup()

    def test_catalog_has_attribution_and_distinguishes_curated_search_and_new_music(self):
        library = MediaLibrary(self.root)
        catalog = library.catalog(exclude_music=('origami', 'neon'))
        self.assertEqual(catalog['search_scope'], 'curated_official_catalog')
        self.assertFalse(catalog['global_web_search'])
        self.assertEqual([r['id'] for r in catalog['music']], ['electric-dreams'])
        self.assertGreaterEqual(len(catalog['videos']), 6)
        self.assertNotIn('source', catalog['videos'][0])
        self.assertTrue(all(r['license_url'].startswith('https://creativecommons.org/') and r['credit'] for r in catalog['videos']+catalog['music']))
        self.assertEqual([r['id'] for r in library.search('fantasía', 'video')['videos']], ['sintel', 'cosmos-laundromat'])
        self.assertEqual(library.search('sintel', 'music')['videos'], [])
        catalog['videos'][0]['tags'].append('mutated')
        self.assertNotIn('mutated', library.catalog()['videos'][0]['tags'])

    def test_source_urls_cannot_be_replaced_by_model_or_local_network_urls(self):
        for source in ['http://video.blender.org/object-storage/web_videos/x.mp4',
                       'https://127.0.0.1/x.mp4', 'https://video.blender.org@localhost/x.mp4',
                       'https://video.blender.org/object-storage/web_videos/../x.mp4',
                       'https://video.blender.org/object-storage/web_videos/x.mp4?secret=1']:
            with self.subTest(source=source), self.assertRaises(ValueError):
                _official(source, 'video')
        library = MediaLibrary(self.root)
        with self.assertRaises(ValueError):
            library.fetch_video('https://evil.example/video.mp4', 1, 2, self.root/'v.mp4', executor=Executor(), cancelled=self.stop)
        self.assertTrue(_official(VIDEOS['sintel']['source'], 'video'))

    def test_bounds_scope_and_originals_are_validated_before_any_process(self):
        library = MediaLibrary(self.root)
        executor = Executor()
        for start, seconds in [(False, 1), (-1, 2), (1, float('nan')), (1, 31), (887, 4)]:
            with self.subTest(start=start, seconds=seconds), self.assertRaises(ValueError):
                library.fetch_video('sintel', start, seconds, self.root/'v.mp4', executor=executor, cancelled=self.stop)
        for dest in [self.root.parent/'outside.mp4', self.root/'..'/'outside.mp4', self.root/'CON.mp4']:
            with self.subTest(dest=dest), self.assertRaises(ValueError):
                library.fetch_video('sintel', 15, 2, dest, executor=executor, cancelled=self.stop)
        existing = self.root/'original.mp4';existing.write_bytes(b'unchanged')
        with self.assertRaises(FileExistsError):
            library.fetch_video('sintel', 15, 2, existing, executor=executor, cancelled=self.stop)
        self.assertEqual(existing.read_bytes(), b'unchanged')
        self.assertEqual(executor.calls, [])

    def test_remote_excerpt_is_silent_scoped_bounded_and_uses_only_fixed_source(self):
        library = MediaLibrary(self.root);executor = Executor()
        with patch('services.motion.media_library.VIDEO_CACHES', {}):
            result = library.fetch_video('charge', 20, 2, self.root/'assets'/'clip.mp4', executor=executor, cancelled=self.stop)
        call = executor.calls[0];args = call[2]
        self.assertEqual(call[0], 'motion.media_excerpt')
        self.assertEqual(args[args.index('-i')+1], VIDEOS['charge']['source'])
        self.assertEqual(args[args.index('-protocol_whitelist')+1], 'https,tls,tcp')
        self.assertIn('-an', args);self.assertIn('-fs', args)
        self.assertFalse(result['original_audio']);self.assertFalse(result['reused'])
        self.assertTrue(Path(result['path']).is_file())
        self.assertEqual(result['license'], 'CC BY 4.0')

    def test_cancellation_after_extract_removes_only_own_partial(self):
        library = MediaLibrary(self.root);executor = Executor(self.stop)
        with patch('services.motion.media_library.VIDEO_CACHES', {}), self.assertRaises(ValueError):
            library.fetch_video('sintel', 20, 2, self.root/'new.mp4', executor=executor, cancelled=self.stop)
        self.assertFalse((self.root/'new.mp4').exists())
        self.assertEqual(list(self.root.glob('.media-*.mp4')), [])

    def test_official_music_download_and_usage_survive_new_library_instance(self):
        opener = Opener(Response(b'ID3'+b'a'*2000))
        library = MediaLibrary(self.root, opener=opener)
        result = library.fetch_music('electric-dreams', self.root/'job'/'music.mp3', executor=Executor(), cancelled=self.stop)
        self.assertFalse(result['reused']);self.assertIn('Scott Buckley', result['credit'])
        self.assertEqual(len(opener.requests), 1)
        self.assertNotIn('Authorization', opener.requests[0].headers)
        result2 = MediaLibrary(self.root).fetch_music('electric-dreams', self.root/'job2'/'music.mp3', executor=Executor(), cancelled=self.stop)
        self.assertTrue(result2['reused']);self.assertEqual(result2['provenance'], 'media_cache')
        row = next(v for v in MediaLibrary(self.root).catalog()['music'] if v['id'] == 'electric-dreams')
        self.assertTrue(row['used_in_prior_brivany'])
        Path(result['path']).write_bytes(b'user changed an output')
        self.assertEqual((self.root/'.media-cache/electric-dreams.mp3').read_bytes(), b'ID3'+b'a'*2000)

    def test_music_size_type_and_cross_domain_redirect_fail_without_publication(self):
        cases = [Response(b'a'*500, length=10**10), Response(b'a'*500, mime='text/html'),
                 Response(b'a'*500, url='https://localhost/song.mp3')]
        for i, response in enumerate(cases):
            library = MediaLibrary(self.root/str(i), opener=Opener(response))
            with self.subTest(i=i), self.assertRaises(ValueError):
                library.fetch_music('electric-dreams', library.root/'song.mp3', executor=Executor(), cancelled=self.stop)
            self.assertFalse((library.root/'song.mp3').exists())
        with self.assertRaises(ValueError):
            _OfficialMusicRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example/song.mp3')
        library = MediaLibrary(self.root/'oversize', opener=Opener(Response(b'a'*500)))
        with patch('services.motion.media_library.MAX_MUSIC_BYTES', 300), self.assertRaises(ValueError):
            library.fetch_music('electric-dreams', library.root/'song.mp3', executor=Executor(), cancelled=self.stop)
        self.assertEqual(list(library.root.glob('.media-*.mp3')), [])

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'local FFmpeg tools unavailable')
    def test_real_local_cache_excerpt_has_exact_duration_no_audio_and_preserves_original(self):
        source = self.root/'original.mp4'
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-n',
                        '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30',
                        '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=24000',
                        '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(source)], check=True)
        original = source.read_bytes();executor = TerminalExecutor(self.root)
        try:
            with patch('services.motion.media_library.VIDEO_CACHES', {'sintel': [(10, 2, source)]}):
                result = MediaLibrary(self.root).fetch_video('sintel', 10.5, 1, self.root/'job'/'clip.mp4', executor=executor, cancelled=self.stop)
            self.assertTrue(result['reused']);self.assertAlmostEqual(result['duration'], 1, places=2)
            info = json.loads(subprocess.check_output([shutil.which('ffprobe'), '-v', 'error', '-show_streams', '-of', 'json', result['path']]))
            self.assertEqual([s['codec_type'] for s in info['streams']], ['video'])
            self.assertEqual(source.read_bytes(), original)
        finally:
            executor.close()


if __name__ == '__main__':
    unittest.main()
