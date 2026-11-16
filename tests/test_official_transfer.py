import base64
import hashlib
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.parse import urlsplit
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from desktop.experience.official_transfer import OfficialTransfer,seal

class Vault:
 def read(self):return {'issuer_token':'fixture-issuer'}

class OfficialTransferTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.calls=[];self.state='waiting';self.events=[]
  def request(method,identifier,action='',**values):
   self.calls.append((method,identifier,action,values))
   if method=='POST':return {'ttl_seconds':300}
   if method=='DELETE':return {'state':'cancelled'}
   return {'state':self.state}
  self.request=request;self.transfer=OfficialTransfer(Path(self.temp.name),vault=Vault(),request=request,publish=self.events.append,poll_interval=.02);self.addCleanup(self.transfer.close)
 def test_file_and_name_are_encrypted_before_transport_and_only_key_fragment_contains_key(self):
  source=b'Owned content, never plaintext in relay';value=self.transfer.share('Prueba café.txt',source)
  self.assertEqual(urlsplit(value['link']).netloc,'brivany.vetsa.es');self.assertEqual(urlsplit(value['link']).scheme,'https');self.assertFalse(value['local_https']);self.assertTrue(value['official_https'])
  identifier,claim,key=urlsplit(value['link']).fragment.split('.');box=next(c[3]['data'] for c in self.calls if c[0]=='PUT');self.assertNotIn(source,box);self.assertNotIn('café'.encode(),box)
  clear=AESGCM(base64.urlsafe_b64decode(key+'=')).decrypt(box[:12],box[12:],('Brivany-transfer-v1:'+identifier).encode());size=int.from_bytes(clear[:2],'big');self.assertEqual(clear[2:2+size].decode(),'Prueba café.txt');self.assertEqual(clear[2+size:],source)
  metadata=next(c[3]['data'] for c in self.calls if c[0]=='POST');self.assertEqual(metadata['claim_hash'],hashlib.sha256(claim.encode()).hexdigest());self.assertNotIn(key,str(self.calls));self.assertNotIn(source,str(metadata).encode())
 def test_tampered_ciphertext_fails_authentication(self):
  key,box=seal('A'*22,'owned.txt',b'original');changed=bytearray(box);changed[-1]^=1
  with self.assertRaises(Exception):AESGCM(key).decrypt(box[:12],bytes(changed[12:]),('Brivany-transfer-v1:'+'A'*22).encode())
 def test_claim_and_send_events_remove_qr_and_stop_polling(self):
  self.transfer.share('owned.txt',b'fixture');self.state='connected';end=time.monotonic()+1
  while self.transfer.snapshot()['state']!='connected' and time.monotonic()<end:time.sleep(.01)
  self.assertIsNone(self.transfer.snapshot()['qr']);self.assertIsNone(self.transfer.snapshot()['link']);self.state='sent'
  while self.transfer.snapshot()['state']!='sent' and time.monotonic()<end:time.sleep(.01)
  self.assertEqual(self.transfer.snapshot()['state'],'sent');count=len(self.calls);time.sleep(.08);self.assertEqual(len(self.calls),count)
 def test_cancel_during_upload_never_publishes_late_qr(self):
  entered,release=threading.Event(),threading.Event();original=self.request
  def request(method,*args,**values):
   if method=='PUT':entered.set();release.wait(2)
   return original(method,*args,**values)
  self.transfer.transport=request;worker=threading.Thread(target=lambda:self.transfer.share('owned.txt',b'fixture'));worker.start();self.assertTrue(entered.wait(1));self.transfer.stop();release.set();worker.join(2);self.assertFalse(self.transfer.snapshot()['active']);self.assertFalse(any(v.get('qr') for v in self.events))
 def test_failed_revocation_is_visible_and_does_not_claim_success(self):
  self.transfer.share('owned.txt',b'fixture');original=self.request
  def request(method,*args,**values):
   if method=='DELETE':raise ValueError('network offline')
   return original(method,*args,**values)
  self.transfer.transport=request;value=self.transfer.stop();self.assertEqual(value['state'],'cancel_pending');self.assertTrue(value['active']);self.assertIsNone(value['link']);self.transfer.transport=original;self.assertFalse(self.transfer.stop()['active'])
 def test_expiry_and_shutdown_revoke_without_local_listener(self):
  self.transfer.ttl=.06;self.transfer.share('owned.txt',b'fixture');end=time.monotonic()+1
  while self.transfer.snapshot()['active'] and time.monotonic()<end:time.sleep(.02)
  self.assertEqual(self.transfer.snapshot()['state'],'expired');self.assertTrue(any(c[0]=='DELETE' for c in self.calls));self.assertFalse(hasattr(self.transfer,'server'));self.transfer.close()
  with self.assertRaises(ValueError):self.transfer.share('owned.txt',b'fixture')
