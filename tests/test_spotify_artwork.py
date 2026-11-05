"""Synthetic album art only. No real covers, accounts or network."""
from io import BytesIO
import unittest
from PIL import Image
from services.spotify_artwork import ArtworkService,artwork_url,valid_url,extract


class ArtworkTests(unittest.TestCase):
    def fixture(self,color=(210,60,35)):
        im=Image.new('RGB',(80,80),color);im.paste((35,70,190),(55,0,80,80));out=BytesIO();im.save(out,format='PNG');return out.getvalue()
    def test_both_observed_spotify_cdns_and_host_boundary(self):
        for url in ('https://i.scdn.co/image/abc123','https://mosaic.scdn.co/640/abc123'):
            self.assertEqual(valid_url(url),url);self.assertEqual(artwork_url([{'url':url}]),url)
        for url in ('http://i.scdn.co/image/abc','https://i.scdn.co.evil.example/image/abc','https://user@i.scdn.co/image/abc','https://mosaic.scdn.co:8443/640/abc','https://127.0.0.1/image/abc','https://i.scdn.co/image/abc?target=local'):
            self.assertFalse(valid_url(url))
    def test_palette_comes_from_pixels_and_cache_is_bounded(self):
        calls=[];now=[1000]
        def http(url):calls.append(url);return self.fixture()
        service=ArtworkService(http=http,clock=lambda:now[0]);result=service.palette('https://mosaic.scdn.co/640/abc123')
        self.assertTrue(result['available']);self.assertEqual(result['primary'],'#d23c23');self.assertEqual(result['secondary'],'#2346be')
        service.palette('https://mosaic.scdn.co/640/abc123');self.assertEqual(len(calls),1)
        for i in range(40):service.palette('https://i.scdn.co/image/fixture'+str(i))
        self.assertEqual(len(service.cache),32);service.clear();self.assertFalse(service.cache)
    def test_invalid_images_and_network_failure_use_neutral_palette(self):
        with self.assertRaises((ValueError,OSError)):extract(b'not an image')
        with self.assertRaises(ValueError):extract(b'x'*1048577)
        calls=[]
        def http(url):calls.append(url);raise OSError('synthetic offline')
        service=ArtworkService(http=http);self.assertFalse(service.palette('https://i.scdn.co/image/fixture')['available']);service.palette('https://i.scdn.co/image/fixture');self.assertEqual(len(calls),1)
        self.assertFalse(service.palette('https://untrusted.example/image')['available']);self.assertEqual(len(calls),1)


if __name__=='__main__':unittest.main()
