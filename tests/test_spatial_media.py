"""Temporal local file grants: exact route and expiry, no external services."""
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs,urlsplit
from services.spatial.media_access import MediaAccess


class MediaAccessTests(unittest.TestCase):
    def test_link_only_valid_for_exact_route_process_and_lifetime(self):
        media=MediaAccess(ttl_seconds=10);route='/api/spatial/assets/scene/chair'
        with patch('services.spatial.media_access.time.time',return_value=1000):
            url=media.issue(route);query=parse_qs(urlsplit(url).query)
            self.assertTrue(media.verify(route,query))
            self.assertFalse(media.verify(route+'/other',query))
            self.assertFalse(MediaAccess(ttl_seconds=10).verify(route,query))
            self.assertFalse(media.verify(route,{**query,'extra':['value']}))
            self.assertFalse(media.verify(route,{**query,'expires':['1010','1010']}))
        with patch('services.spatial.media_access.time.time',return_value=1011):self.assertFalse(media.verify(route,query))
        with patch('services.spatial.media_access.time.time',return_value=999):self.assertFalse(media.verify(route,query))

    def test_malformed_grants_and_non_media_routes_rejected(self):
        media=MediaAccess()
        for route in ('/api/status','https://remote.invalid/a','/api/spatial/assets/../.env'):
            with self.assertRaises(ValueError):media.issue(route)
        for query in ({},{'expires':['NaN'],'signature':['a'*64]}, {'expires':['1'],'signature':['a'*65]},
                      {'expires':[],'signature':['a'*64]}):self.assertFalse(media.verify('/route',query))


if __name__=='__main__':unittest.main()
