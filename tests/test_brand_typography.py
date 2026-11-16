"""Local font integrity, offline video packaging and real GDI+ face loading."""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import os
import tempfile
import unittest
import zipfile
from services.brand import FONT_ROOT,FONT_FAMILY,font_css

ROOT=Path(__file__).resolve().parents[1]

class BrandTypographyTests(unittest.TestCase):
    def test_supplied_faces_and_spanish_glyphs_survive_woff2(self):
        from fontTools.ttLib import TTFont
        manifest=json.loads((FONT_ROOT/'manifest.json').read_text(encoding='utf-8'))
        with zipfile.ZipFile(ROOT/'Brivany_Editorial_Fuentes.zip') as archive:
            for entry in manifest['weights']:
                stem='BrivanyEditorial-'+entry['style']
                original=archive.read(stem+'.ttf');self.assertEqual(original,(FONT_ROOT/(stem+'.ttf')).read_bytes())
                ttf=TTFont(BytesIO(original));woff=TTFont(FONT_ROOT/(stem+'.woff2'))
                self.assertEqual(ttf.getBestCmap(),woff.getBestCmap());self.assertEqual(ttf['hmtx'].metrics,woff['hmtx'].metrics)
                self.assertEqual(woff['name'].getDebugName(1),FONT_FAMILY);self.assertEqual(woff['OS/2'].usWeightClass,entry['weight'])
                self.assertTrue(all(ord(c) in woff.getBestCmap() for c in 'ÁÉÍÓÚÑÜáéíóúñü¿¡'))
                self.assertEqual(hashlib.sha256((FONT_ROOT/(stem+'.woff2')).read_bytes()).hexdigest(),entry['woff2_sha256'])

    def test_new_story_is_portable_and_carries_font_license(self):
        from services.motion.story_renderer import write_story_project
        from tests.test_motion_story_renderer import story
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp).resolve();write_story_project(folder,story(),media={})
            css=(folder/'story.css').read_text(encoding='utf-8');self.assertNotIn('segoe',css.lower())
            for style in ('Light','Regular','Medium'):self.assertTrue((folder/('assets/brivany-runtime/BrivanyEditorial-'+style+'.woff2')).is_file())
            self.assertIn('SIL', (folder/'assets/brivany-runtime/LICENSE-AND-ATTRIBUTION.txt').read_text(encoding='utf-8'))
            self.assertIn('Brivany Editorial',(folder/'CREDITS.md').read_text(encoding='utf-8'))
            self.assertIn('../assets/brivany-runtime/BrivanyEditorial-Regular.woff2',(folder/'exports/Brivany-animation.html').read_text(encoding='utf-8'))

    def test_css_and_routes_use_real_local_faces(self):
        from services.h1.server import STATIC
        self.assertIn('font-weight:500 900',font_css())
        for style in ('Light','Regular','Medium'):
            route='/fonts/BrivanyEditorial-'+style+'.woff2';self.assertEqual(STATIC[route][1],'font/woff2')
        self.assertIn('Brivany Editorial',(ROOT/'web/typography.css').read_text(encoding='utf-8'))
        wordmark=(ROOT/'web/brand-wordmark.svg').read_text(encoding='utf-8')
        self.assertNotIn('<text',wordmark)
        # Existing light/dark renderers replace one ink token: every letter
        # must inherit it together, while the blue point remains independent.
        self.assertEqual(wordmark.count('fill="#1d1d1f"'),1)

    @unittest.skipUnless(os.name=='nt','GDI+ is Windows-only')
    def test_native_font_loads_without_global_installation_or_window(self):
        from desktop.experience.typography import brand_font
        for weight in (300,400,500):
            font=brand_font(13,weight)
            try:self.assertEqual(font.FontFamily.Name,FONT_FAMILY)
            finally:font.Dispose()

if __name__=='__main__':unittest.main()
