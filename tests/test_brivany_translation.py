"""Production routes and loopback listeners; never open a provider session."""
from contextlib import ExitStack
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import os
import threading
import unittest
from unittest.mock import patch
from services.h1.server import Handler,start_application_bridges


class BrivanyTranslationTests(unittest.TestCase):
    def setUp(self):
        self.stack=ExitStack();self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ,{'BRIVANY_MUSE_API_KEY':'synthetic-main','BRIVANY_META_API_KEY':'synthetic-main',
            'BRIVANY_META_MODEL':'muse-spark-1.3','BRIVANY_CARTESIA_API_KEY':'synthetic-main'}))
        self.retired=[self.stack.enter_context(patch('services.h1.server.'+name)) for name in
            ('TranslationBridge','ElevenBridge','ModularBridge','GeminiBridge','OpenAITranslationBridge')]
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.bridges=start_application_bridges(self.server)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown();self.thread.join(2)
        for bridge in reversed(self.bridges):bridge.close()
        self.server.server_close()

    def get(self,path):
        connection=HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        try:
            connection.request('GET',path);response=connection.getresponse()
            return response.status,dict(response.getheaders()),response.read()
        finally:connection.close()

    def test_default_api_and_alias_use_the_one_production_relay(self):
        results=[]
        for route in ('/api/dubbing/status','/api/dubbing/status?provider=river','/api/translation/status'):
            code,_,raw=self.get(route);self.assertEqual(code,200);status=json.loads(raw)
            self.assertEqual(status['provider'],'Muse · Meta Spark · Cartesia')
            self.assertEqual(status['websocket_url'],f'ws://127.0.0.1:{self.server.river_bridge.port}/dub')
            self.assertTrue(status['continuous']);self.assertIsNone(status['daily_sessions'])
            results.append(status['websocket_url'])
        self.assertEqual(len(set(results)),1)
        for factory in self.retired:factory.assert_not_called()
        self.assertEqual(len(self.bridges),2)

    def test_canonical_page_and_old_links_serve_the_new_interface(self):
        for route in ('/dubbing','/dubbing/','/translate','/translate/','/dubbing?provider=palabra&source=youtube'):
            code,headers,raw=self.get(route);self.assertEqual(code,200)
            text=raw.decode('utf-8');self.assertIn('/translate.js',text);self.assertIn('/video-file-source.js',text)
            self.assertIn('Masculina · Daniel',text);self.assertNotIn('dubbing-provider',text)
            self.assertIn(f'ws://127.0.0.1:{self.server.river_bridge.port}',headers['Content-Security-Policy'])
            self.assertIn('frame-src https://www.youtube.com',headers['Content-Security-Policy'])

    def test_busy_relay_is_unavailable_until_previous_session_releases(self):
        self.server.river_bridge.lock.acquire()
        try:
            code,_,raw=self.get('/api/dubbing/status');status=json.loads(raw)
            self.assertEqual(code,200);self.assertTrue(status['busy']);self.assertFalse(status['available'])
        finally:self.server.river_bridge.lock.release()
        _,_,raw=self.get('/api/dubbing/status');self.assertFalse(json.loads(raw)['busy'])

    def test_main_navigation_and_cached_shell_use_canonical_translation(self):
        for route in ('/','/app','/spaces'):
            code,_,raw=self.get(route);self.assertEqual(code,200)
            self.assertIn('href="/dubbing"',raw.decode('utf-8'))
        _,_,raw=self.get('/sw.js');shell=raw.decode('utf-8')
        self.assertIn('"/translate.js"',shell);self.assertIn('"/video-file-source.js"',shell)
        self.assertNotIn('"/dubbing.js"',shell)

    def test_startup_failure_closes_already_created_local_bridge(self):
        with patch('services.h1.server.MuseBridge') as voice,patch('services.h1.server.RiverBridge') as translation:
            translation.return_value.start.side_effect=OSError('synthetic-startup-failure')
            with self.assertRaises(OSError):start_application_bridges(self.server)
            voice.return_value.start.return_value.close.assert_called_once()


if __name__=='__main__':unittest.main()
