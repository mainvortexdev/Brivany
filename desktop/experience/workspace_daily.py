"""Explicit public weather requests and browser handoff, never background polling."""
import json
import math
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import webbrowser

WEATHER_ORIGINS = {'api.open-meteo.com', 'geocoding-api.open-meteo.com'}
MAX_RESPONSE = 256 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def weather_json(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in WEATHER_ORIGINS or parsed.username or parsed.password:
        raise ValueError('Fuente de clima no admitida.')
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'Brivany/1.0'})
    try:
        with build_opener(NoRedirect(), ProxyHandler({})).open(request, timeout=8) as response:
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise ValueError('La respuesta del clima supera el límite.')
            result = json.loads(data)
            if not isinstance(result, dict):
                raise ValueError('La respuesta del clima no es válida.')
            return result
    except (HTTPError, URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError('No se pudo consultar el clima. Revisa la conexión y vuelve a intentarlo.') from None


def number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('Las coordenadas o las medidas del clima no son válidas.')
    return value


def browser_url(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 2048 or any(ord(c) < 33 for c in value):
        raise ValueError('Escribe una dirección web completa, sin espacios.')
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        parsed.port
        parsed.hostname.encode('idna')
    except (ValueError, UnicodeError):
        raise ValueError('Usa una dirección http o https sin credenciales.') from None
    return value


class WeatherClient:
    def __init__(self, transport=weather_json, clock=time.monotonic):
        self.transport, self.clock = transport, clock
        self.cache = {}
        self.lock = threading.Lock()

    def _request(self, url, ttl):
        # A small session cache also prevents duplicate requests from two views.
        with self.lock:
            found = self.cache.get(url)
            if found and self.clock() - found[0] < ttl:
                return found[1], True
            value = self.transport(url)
            self.cache[url] = (self.clock(), value)
            while len(self.cache) > 16:
                self.cache.pop(next(iter(self.cache)))
            return value, False

    def search(self, city):
        if not isinstance(city, str) or not 2 <= len(city.strip()) <= 100 or any(ord(c) < 32 for c in city):
            raise ValueError('Escribe una ciudad de entre 2 y 100 caracteres.')
        url = 'https://geocoding-api.open-meteo.com/v1/search?' + urlencode({'name': city.strip(), 'count': 5, 'language': 'es', 'format': 'json'})
        result, cached = self._request(url, 3600)
        rows = result.get('results', [])
        if not isinstance(rows, list):
            raise ValueError('La búsqueda de ciudades no devolvió una lista válida.')
        locations = []
        for row in rows[:5]:
            if not isinstance(row, dict) or not isinstance(row.get('name'), str):
                continue
            try:
                latitude = number(row.get('latitude'), -90, 90)
                longitude = number(row.get('longitude'), -180, 180)
            except ValueError:
                continue
            label = ', '.join(str(row[key])[:100] for key in ('name', 'admin1', 'country') if row.get(key))[:240]
            locations.append({'label': label, 'latitude': latitude, 'longitude': longitude})
        return {'locations': locations, 'cached': cached, 'source': 'Open-Meteo / GeoNames'}

    def current(self, latitude, longitude):
        latitude, longitude = number(latitude, -90, 90), number(longitude, -180, 180)
        url = 'https://api.open-meteo.com/v1/forecast?' + urlencode({'latitude': latitude, 'longitude': longitude,
            'current': 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
            'daily': 'temperature_2m_max,temperature_2m_min', 'timezone': 'auto', 'forecast_days': 1})
        result, cached = self._request(url, 600)
        current, daily = result.get('current'), result.get('daily', {})
        if not isinstance(current, dict) or not isinstance(current.get('time'), str) or not isinstance(daily, dict):
            raise ValueError('Faltan las condiciones actuales del clima.')
        value = {'temperature': number(current.get('temperature_2m'), -100, 70),
            'apparent': number(current.get('apparent_temperature'), -130, 90),
            'humidity': number(current.get('relative_humidity_2m'), 0, 100),
            'wind_kmh': number(current.get('wind_speed_10m'), 0, 500),
            'code': number(current.get('weather_code'), 0, 99), 'local_time': current['time'][:32],
            'timezone': str(result.get('timezone', ''))[:100], 'cached': cached,
            'source': 'Open-Meteo', 'source_url': 'https://open-meteo.com/'}
        for field, key in [('high', 'temperature_2m_max'), ('low', 'temperature_2m_min')]:
            rows = daily.get(key)
            value[field] = number(rows[0], -100, 70) if isinstance(rows, list) and rows and rows[0] is not None else None
        return value


class WorkspaceDailyBridge:
    _daily_lock = threading.Lock()

    def _weather(self):
        with self._daily_lock:
            if not getattr(self, '_workspace_weather', None):
                self._workspace_weather = WeatherClient()
            return self._workspace_weather

    def workspace_weather_search(self, city):
        self._trusted()
        return self._weather().search(city)

    def workspace_weather_current(self, latitude, longitude):
        self._trusted()
        return self._weather().current(latitude, longitude)

    def workspace_link_open(self, url):
        self._trusted()
        return {'opened': bool(webbrowser.open(browser_url(url)))}
