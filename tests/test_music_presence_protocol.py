"""Actual loopback WebSockets with synthetic songs and no provider/audio/UI."""
import json
import time
import unittest
from websockets.sync.client import connect
from websockets.exceptions import InvalidStatus
from services.work.sync_relay import SyncRelay
from services.work.music_presence import YouTubeMusicPresence

ORIGIN='chrome-extension://'+'a'*32
OTHER='chrome-extension://'+'b'*32


class MusicProtocolTests(unittest.TestCase):
 def setUp(self):
  self.enabled=True;self.presence=YouTubeMusicPresence(enabled=lambda:self.enabled)
  self.relay=SyncRelay(port=0,automatic_origin=ORIGIN).start();self.relay.music_presence=self.presence;self.addCleanup(self.relay.close)
  self.grant=self.relay.connect_extension(ORIGIN)
 def test_music_channel_requires_the_known_extension_and_a_bound_token(self):
  url=f'ws://127.0.0.1:{self.relay.port}/music'
  for origin in [OTHER,'https://www.youtube.com',None]:
   with self.subTest(origin=origin),self.assertRaises(InvalidStatus):connect(url,origin=origin,proxy=None)
  with connect(url,origin=ORIGIN,proxy=None) as socket:
   socket.send(json.dumps({'type':'authenticate','token':'wrong'}));self.assertEqual(json.loads(socket.recv(timeout=2))['type'],'error')
  self.assertIsNone(self.presence.current())
 def test_real_authenticated_music_metadata_and_disconnect_expiry(self):
  with connect(f'ws://127.0.0.1:{self.relay.port}/music',origin=ORIGIN,proxy=None) as socket:
   socket.send(json.dumps({'type':'authenticate','token':self.grant['token']}));self.assertEqual(json.loads(socket.recv(timeout=2)),{'type':'authenticated','enabled':True})
   socket.send(json.dumps({'type':'music','video':'abcdefghijk','title':'Artista - Canción (Video Oficial)','artist':'','position':20,'duration':180,'playing':True,'muted':False,'music':True}))
   end=time.monotonic()+2
   while self.presence.current() is None and time.monotonic()<end:time.sleep(.01)
   self.assertEqual(self.presence.current()['title'],'Canción')
   self.enabled=False;socket.send(json.dumps({'type':'ping'}));self.assertEqual(json.loads(socket.recv(timeout=2)),{'type':'music-ready','enabled':False});self.assertIsNone(self.presence.current())
  end=time.monotonic()+2
  while self.presence.entries and time.monotonic()<end:time.sleep(.01)
  self.assertFalse(self.presence.entries)


if __name__=='__main__':unittest.main()
