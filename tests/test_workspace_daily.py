"""Weather protocol and explicit URL handoff with local fixtures only."""
import json
import unittest
from unittest.mock import patch, MagicMock
from urllib.parse import urlsplit, parse_qs
from desktop.experience.workspace_daily import WeatherClient, WorkspaceDailyBridge, weather_json, browser_url, MAX_RESPONSE


class DailyTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.now = 1
        self.response = {'current': {'temperature_2m': 20.4, 'apparent_temperature': 19.2,
            'relative_humidity_2m': 70, 'weather_code': 3, 'wind_speed_10m': 12,
            'time': '2026-11-07T13:00'}, 'timezone': 'America/La_Paz',
            'daily': {'temperature_2m_max': [22], 'temperature_2m_min': [10]}}
        def transport(url):
            self.calls.append(url)
            if 'geocoding-' in url:
                return {'results': [{'name': 'Ciudad de prueba', 'latitude': -16.5, 'longitude': -68.1, 'country': 'Bolivia'}]}
            return self.response
        self.client = WeatherClient(transport, lambda: self.now)

    def test_no_request_at_construction_and_search_is_encoded_and_bounded(self):
        self.assertEqual(self.calls, [])
        result = self.client.search('La Paz, Bolivia')
        self.assertEqual(result['locations'][0]['latitude'], -16.5)
        query = parse_qs(urlsplit(self.calls[0]).query)
        self.assertEqual(query['name'], ['La Paz, Bolivia'])
        self.assertEqual(query['count'], ['5'])
        self.assertTrue(self.client.search('La Paz, Bolivia')['cached'])
        self.assertEqual(len(self.calls), 1)
        for value in (None, True, 'x', 'x' * 101, 'bad\ncity'):
            with self.assertRaises(ValueError): self.client.search(value)

    def test_coordinates_validated_cache_expires_and_local_provider_date_is_preserved(self):
        first = self.client.current(-16.5, -68.1)
        self.assertEqual(first['temperature'], 20.4)
        self.assertEqual(first['local_time'], '2026-11-07T13:00')
        self.assertEqual(first['timezone'], 'America/La_Paz')
        self.assertEqual(first['high'], 22)
        self.assertTrue(self.client.current(-16.5, -68.1)['cached'])
        self.now += 601
        self.assertFalse(self.client.current(-16.5, -68.1)['cached'])
        self.assertEqual(len(self.calls), 2)
        for lat, lon in ((91, 0), (True, 0), (float('nan'), 0), (0, -181)):
            with self.assertRaises(ValueError): self.client.current(lat, lon)

    def test_incomplete_measurement_does_not_invent_conditions(self):
        self.response['current'].pop('temperature_2m')
        with self.assertRaises(ValueError): self.client.current(0, 0)
        self.response['current']['temperature_2m'] = float('inf')
        with self.assertRaises(ValueError): self.client.current(1, 0)

    def test_weather_http_fixed_hosts_size_timeout_and_redirects(self):
        with patch('desktop.experience.workspace_daily.build_opener') as opener:
            response = MagicMock()
            response.read.return_value = json.dumps(self.response).encode()
            opener.return_value.open.return_value.__enter__.return_value = response
            self.assertIn('current', weather_json('https://api.open-meteo.com/v1/forecast?latitude=0'))
            self.assertEqual(opener.return_value.open.call_args.kwargs['timeout'], 8)
            response.read.assert_called_with(MAX_RESPONSE + 1)
            response.read.return_value = b' ' * (MAX_RESPONSE + 1)
            with self.assertRaises(ValueError): weather_json('https://api.open-meteo.com/v1/forecast')
            for url in ('http://api.open-meteo.com/', 'https://evil.test/', 'https://user:pass@api.open-meteo.com/'):
                with self.assertRaises(ValueError): weather_json(url)

    def test_browser_handoff_is_explicit_and_rejects_other_protocols(self):
        bridge = WorkspaceDailyBridge(); bridge._trusted = MagicMock()
        with patch('desktop.experience.workspace_daily.webbrowser.open', return_value=True) as opened:
            self.assertTrue(bridge.workspace_link_open('https://example.test/')['opened'])
            opened.assert_called_once_with('https://example.test/')
            bridge._trusted.assert_called_once()
        for value in ('javascript:alert(1)', 'file:///C:/secret', 'https://x:y@example.test', 'https://example.test/a b', [], 'https://example.test:\\'):
            with self.assertRaises(ValueError): browser_url(value)
        bridge._trusted.side_effect = ValueError('untrusted')
        with self.assertRaises(ValueError): bridge.workspace_weather_search('London')
        self.assertFalse(hasattr(bridge, '_workspace_weather'))

    def test_weather_cache_has_a_fixed_session_bound(self):
        for n in range(25): self.client.current(n, 0)
        self.assertEqual(len(self.client.cache), 16)


if __name__ == '__main__': unittest.main()
