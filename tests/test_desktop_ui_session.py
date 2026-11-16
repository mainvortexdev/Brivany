"""Native-only renderer boundary with an actual local HTTP server, no accounts."""
from http.client import HTTPConnection
from html.parser import HTMLParser
import json
from pathlib import Path
import tempfile
from urllib.parse import urlsplit,urlencode
import unittest
from desktop.experience.ui_session import DesktopUISession
from desktop.experience.launcher import experience_handler,NATIVE_PAGES
from desktop.experience.workspace_preferences import WorkspacePreferences
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler


class NativeUISessionTests(unittest.TestCase):
    def setUp(self):
        self.server=LocalDesktopServer(handler=experience_handler(Handler)).start();self.addCleanup(self.server.close)
        self.ui=DesktopUISession(NATIVE_PAGES|{'/connections','/app'})
        self.server.http.desktop_ui_session=self.ui
        self.port=urlsplit(self.server.base_url).port

    def get(self,path,headers=None):
        return self.request('GET', path, headers=headers)

    def request(self, method, path, headers=None, body=None):
        c=HTTPConnection('127.0.0.1',self.port,timeout=4)
        try:
            c.request(method,path,body=body,headers=headers or {});r=c.getresponse();return r.status,dict(r.getheaders()),r.read()
        finally:c.close()

    def test_preferences_require_local_desktop_and_persist_across_store_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'preferences.json'
            self.server.http.workspace_preferences=WorkspacePreferences(path)
            endpoint='/api/desktop/workspace-preferences'
            headers={self.ui.HEADER:self.ui.secret, 'Origin':self.server.base_url,
                     'Content-Type':'application/json'}
            payload=json.dumps({'patch':{'recording':{'fps':30},'general':{'quiet':True,'rate':1},
                                         'interface':{'locale':'en'}},
                                'initial':{'appearance':{'accent':'mint','motion':'invalid'}}})
            self.assertEqual(self.get(endpoint)[0],403)
            self.assertEqual(self.request('POST',endpoint,headers={'Origin':self.server.base_url},body=payload)[0],403)
            self.assertEqual(self.request('POST',endpoint,headers={**headers,'Origin':'https://foreign.example'},body=payload)[0],403)
            self.assertFalse(path.exists())
            self.assertEqual(self.request('POST',endpoint,headers=headers,body=payload)[0],200)
            self.server.http.workspace_preferences=WorkspacePreferences(path)
            snapshot=json.loads(self.get(endpoint,headers)[2])
            self.assertEqual(snapshot['recording']['fps'],30)
            self.assertEqual(snapshot['appearance']['accent'],'mint')
            self.assertTrue(snapshot['appearance']['motion'])
            self.assertTrue(snapshot['general']['quiet'])
            self.assertEqual(snapshot['general']['rate'],1)
            self.assertEqual(snapshot['general']['language'],'es-ES')
            self.assertEqual(snapshot['interface']['locale'],'en')
            self.assertEqual(snapshot['revision'],1)
            invalid=json.dumps({'patch':{'general':{'rate':True}}})
            self.assertEqual(self.request('POST',endpoint,headers=headers,body=invalid)[0],422)
            invalid_locale=json.dumps({'patch':{'interface':{'locale':'unknown'}}})
            self.assertEqual(self.request('POST',endpoint,headers=headers,body=invalid_locale)[0],422)
            self.assertEqual(json.loads(self.get(endpoint,headers)[2]),snapshot)
            status,_,body=self.get('/work-widget',headers)
            self.assertEqual(status,200)
            self.assertIn(b'brivany-workspace-preferences',body)
            self.assertIn(b'&quot;accent&quot;: &quot;mint&quot;',body)
            self.assertNotIn(self.ui.secret.encode(),body)

    def test_saved_locale_embeds_its_catalog_and_serves_matching_messages(self):
        class CatalogMeta(HTMLParser):
            def __init__(self):
                super().__init__()
                self.catalogs = []
            def handle_starttag(self, tag, attrs):
                fields = dict(attrs)
                if tag == 'meta' and fields.get('name') == 'brivany-workspace-catalog':
                    self.catalogs.append(fields)
        from re import findall
        from desktop.experience.workspace_preferences import WORKSPACE_LOCALES

        with tempfile.TemporaryDirectory() as directory:
            store=WorkspacePreferences(Path(directory)/'preferences.json')
            self.server.http.workspace_preferences=store
            headers={self.ui.HEADER:self.ui.secret}
            baseline=json.loads(self.get('/desktop-shell/workspace-locales/en.json',headers)[2])
            for locale in WORKSPACE_LOCALES:
                with self.subTest(locale=locale):
                    store.update({'interface':{'locale':locale}})
                    page=CatalogMeta()
                    status,_,html=self.get('/work-widget',headers)
                    self.assertEqual(status,200)
                    page.feed(html.decode('utf-8'))
                    if locale=='es':
                        self.assertEqual(page.catalogs,[])
                        continue
                    meta,=page.catalogs
                    self.assertEqual(meta['data-locale'],locale)
                    status,_,catalog=self.get('/desktop-shell/workspace-locales/'+locale+'.json',headers)
                    self.assertEqual(status,200)
                    messages=json.loads(catalog)
                    self.assertEqual(json.loads(meta['content']),messages)
                    self.assertEqual(messages.keys(),baseline.keys())
                    for source,value in messages.items():
                        self.assertTrue(isinstance(value,str) and value)
                        self.assertEqual(sorted(findall(r'\{\w+\}',source)),sorted(findall(r'\{\w+\}',value)))
            status,_,html=self.get('/brivany-shell',headers)
            self.assertEqual(status,200)
            self.assertNotIn(b'brivany-workspace-catalog',html)

    def test_browser_has_no_web_edition_but_native_cookie_loads_the_renderer(self):
        for path in ('/','/index.html','/brivany-shell','/connections','/app','/work-widget?surface=bar','/work-voice','/spotify-player'):
            with self.subTest(path=path):self.assertEqual(self.get(path)[0],410)
        entry=self.ui.entry('', '/brivany-shell')
        status,headers,_=self.get(entry);self.assertEqual(status,303);self.assertEqual(headers['Location'],'/brivany-shell')
        cookie=headers['Set-Cookie'];self.assertIn('HttpOnly',cookie);self.assertIn('SameSite=Strict',cookie);self.assertEqual(headers['Cache-Control'],'no-store')
        headers={'Cookie':cookie.split(';')[0]}
        status,_,body=self.get('/brivany-shell',headers);self.assertEqual(status,200);self.assertIn(b'module-frame',body)
        self.assertEqual(self.get('/connections',headers)[0],200)
        self.assertEqual(self.get('/',headers)[0],303)
        self.assertEqual(self.get('/connections',{'Cookie':'brivany_desktop_ui=wrong'})[0],410)

    def test_entry_does_not_allow_foreign_redirects_unknown_targets_or_duplicate_parameters(self):
        for target in ('https://untrusted.example/','//untrusted.example/app','/api/integrations/status','/app\r\nX-Test: value','//[invalid'):
            with self.subTest(target=target):
                self.assertFalse(self.ui.target(target))
                self.assertEqual(self.get(self.ui.PREFIX+self.ui.secret+'?'+urlencode({'target':target}))[0],404)
        path=self.ui.entry('', '/app')+'&target=/connections';self.assertEqual(self.get(path)[0],404)
        self.assertEqual(self.get(self.ui.PREFIX+'wrong?target=/app')[0],404)
        self.assertEqual(self.get(self.ui.entry('', '/app'),{'Host':'untrusted.example'})[0],403)

    def test_runtime_api_is_read_only_and_oauth_callback_is_not_a_native_page(self):
        status,_,body=self.get('/api/desktop/runtime');self.assertEqual(status,200);self.assertIn(b'desktop-only',body)
        self.assertFalse(self.ui.target('/api/integrations/google/callback'))
        self.assertFalse(self.ui.target('/api/desktop/runtime'))
        self.assertTrue(self.ui.target('/work-widget?surface=panel'))
    def test_native_header_survives_deleted_cookies_without_opening_browser_access(self):
        self.assertEqual(self.get('/work-widget?surface=panel')[0],410)
        status,_,body=self.get('/work-widget?surface=panel',{self.ui.HEADER:self.ui.secret})
        self.assertEqual(status,200);self.assertIn(b'workspace-chat-form',body)
        self.assertEqual(self.get('/work-widget',{self.ui.HEADER:'wrong'})[0],410)
    def test_header_only_goes_to_its_exact_loopback_origin(self):
        from types import SimpleNamespace
        from webview.models import Request
        window=SimpleNamespace(events=SimpleNamespace());self.ui.bind_window(window,self.server.base_url)
        own=Request(self.server.base_url+'/app','GET',{});window.events.request_sent.set(own)
        self.assertEqual(own.headers[self.ui.HEADER],self.ui.secret)
        for url in ['https://api.spotify.com/v1/me/player','https://untrusted.example/',self.server.base_url.replace('127.0.0.1','localhost')+'/app','http://127.0.0.1:1/app']:
            request=Request(url,'GET',{self.ui.HEADER:self.ui.secret});window.events.request_sent.set(request)
            self.assertNotIn(self.ui.HEADER,request.headers)
