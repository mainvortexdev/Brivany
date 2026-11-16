"""Native large-file boundaries, snapshots, resumable blocks and safe reception."""
import base64
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from desktop.experience.workspace_files import FileShelf,MAX_FILE_BYTES,BLOCK_BYTES
from desktop.experience.drop_transfer import OfficialDrop,FileSource,FileReceiver

class Vault:
 def read(self):return {'issuer_token':'synthetic-issuer'}

class DropTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.calls=[]
  def network(method,identifier,**kwargs):self.calls.append((method,identifier,kwargs));return {'protocol':2} if method=='POST' else {'state':'cancelled'}
  self.drop=OfficialDrop(self.root/'private',vault=Vault(),request=network,receive_folder=self.root/'received');self.addCleanup(self.drop.close)
 def source(self,size=MAX_FILE_BYTES):
  path=self.root/'Archivo 1 GB.bin'
  with path.open('wb') as stream:stream.truncate(size);stream.seek(max(0,size-4));stream.write(b'END!')
  shelf=FileShelf();self.addCleanup(shelf.close);identifier=shelf.add_path(path);return shelf,shelf.get(identifier)
 def test_accepts_real_one_gib_sparse_file_without_reading_it_into_ram(self):
  shelf,item=self.source();value=self.drop.share_path(item);self.assertEqual(value['size'],1024**3);self.assertEqual(value['transport'],'drop-v2');self.assertIn('https://brivany.vetsa.es/transfer/drop/',value['link']);self.assertNotIn('path',value['session']['source']);self.assertEqual(set(self.calls[0][2]['data']),{'owner_hash','claim_hash'});self.assertNotIn(item['name'],str(self.calls))
  block=self.drop.read(value['session']['id'],value['session']['source']['id'],MAX_FILE_BYTES-4,4);self.assertEqual(base64.b64decode(block['data']),b'END!')
  with self.assertRaises(ValueError):shelf.share_payload(item['id'])
  with self.assertRaises(ValueError):self.drop.read(value['session']['id'],value['session']['source']['id'],0,BLOCK_BYTES+1)
 def test_source_mutation_is_rejected_and_original_is_preserved_on_stop(self):
  _,item=self.source(1024);value=self.drop.share_path(item);item['path'].write_bytes(b'changed')
  with self.assertRaises(ValueError):self.drop.read(value['session']['id'],value['session']['source']['id'],0,10)
  self.drop.stop();self.assertEqual(item['path'].read_bytes(),b'changed')
 def test_native_receive_requires_acceptance_exact_offset_digest_and_complete_length(self):
  value=self.drop.share_path();identifier=value['session']['id'];meta={'id':'a'*32,'name':'Prueba.txt','size':6};self.drop.update(identifier,{'state':'connected'})
  with self.assertRaises(ValueError):self.drop.write_receive(identifier,meta['id'],0,'YWJj',hashlib.sha256(b'abc').hexdigest())
  self.drop.begin_receive(identifier,meta)
  with self.assertRaises(ValueError):self.drop.write_receive(identifier,meta['id'],1,'YWJj',hashlib.sha256(b'abc').hexdigest())
  with self.assertRaises(ValueError):self.drop.write_receive(identifier,meta['id'],0,'YWJj','0'*64)
  self.drop.write_receive(identifier,meta['id'],0,'YWJj',hashlib.sha256(b'abc').hexdigest());self.assertEqual(self.drop.begin_receive(identifier,meta)['offset'],3)
  with self.assertRaises(ValueError):self.drop.finish_receive(identifier,meta['id'])
  self.drop.write_receive(identifier,meta['id'],3,'ZGVm',hashlib.sha256(b'def').hexdigest());result=self.drop.finish_receive(identifier,meta['id']);self.assertEqual(Path(result['path']).read_bytes(),b'abcdef')
 def test_cancel_deletes_partial_and_never_overwrites_existing_download(self):
  folder=self.root/'received';folder.mkdir();(folder/'Prueba.txt').write_bytes(b'original');meta={'id':'b'*32,'name':'Prueba.txt','size':1};receiver=FileReceiver(meta,folder);self.addCleanup(receiver.close);receiver.write(0,'eA==',hashlib.sha256(b'x').hexdigest());result=receiver.commit();self.assertEqual(Path(result['path']).name,'Prueba (1).txt');self.assertEqual((folder/'Prueba.txt').read_bytes(),b'original')
  receiver=FileReceiver({**meta,'id':'c'*32},folder);partial=receiver.part;receiver.close();self.assertFalse(partial.exists())
 def test_invalid_names_and_over_limit_are_rejected_before_any_write(self):
  for name in ['../escape.bin','CON.bin','.env','path\\file.bin','bad?.bin']:
   with self.subTest(name=name),self.assertRaises(ValueError):FileReceiver({'id':'a'*32,'name':name,'size':10},self.root/'received')
  with self.assertRaises(ValueError):FileReceiver({'id':'a'*32,'name':'test.bin','size':MAX_FILE_BYTES+1},self.root/'received')
  self.assertFalse((self.root/'received').exists())
 def test_chunked_drag_import_is_bounded_and_commits_only_complete_file(self):
  shelf=FileShelf();self.addCleanup(shelf.close);started=shelf.begin_upload('Importado.bin',BLOCK_BYTES+3);token=started['token'];data=b'a'*BLOCK_BYTES;shelf.write_upload(token,0,base64.b64encode(data).decode())
  with self.assertRaises(ValueError):shelf.commit_upload(token)
  with self.assertRaises(ValueError):shelf.write_upload(token,0,'YWJj')
  shelf.write_upload(token,BLOCK_BYTES,'ZW5k');identifier=shelf.commit_upload(token);self.assertEqual(shelf.get(identifier)['size'],BLOCK_BYTES+3);self.assertEqual(shelf.get(identifier)['path'].read_bytes(),data+b'end')
 def test_connected_pair_can_send_another_file_without_changing_qr_or_session(self):
  _,item=self.source(1024);first=self.drop.share_path(item);identifier=first['session']['id'];self.drop.update(identifier,{'state':'connected'})
  with self.assertRaises(ValueError):self.drop.share_path(item)
  self.drop.next_source(identifier,first['session']['source']['id']);second=self.drop.share_path(item);self.assertEqual(identifier,second['session']['id']);self.assertIsNone(second['qr']);self.assertNotEqual(first['session']['source']['id'],second['session']['source']['id']);self.assertEqual(len([c for c in self.calls if c[0]=='POST']),1)
 def test_batch_reuses_pair_advances_once_and_releases_every_source(self):
  shelf,item=self.source(1024);value=self.drop.share_path();session=value['session']['id'];self.drop.update(session,{'state':'connected'})
  second=self.root/'Segundo.txt';second.write_text('segundo',encoding='utf-8');other=shelf.get(shelf.add_path(second))
  value=self.drop.enqueue(session,[item,other]);first=value['session']['source']['id'];handle=self.drop.source
  self.assertEqual(value['queued'],2)
  with self.assertRaises(ValueError):self.drop.enqueue(session,[other])
  with self.assertRaises(ValueError):self.drop.share_path(other)
  value=self.drop.next_source(session,first);self.assertTrue(handle.stream.closed);self.assertEqual(value['queued'],1);self.assertEqual(value['session']['source']['name'],'Segundo.txt')
  self.assertEqual(self.drop.next_source(session,first)['queued'],1)
  handle=self.drop.source;value=self.drop.next_source(session,value['session']['source']['id']);self.assertTrue(handle.stream.closed);self.assertEqual(value['queued'],0);self.assertIsNone(value['session']['source']);self.assertEqual(value['state'],'sent');self.assertEqual(len([c for c in self.calls if c[0]=='POST']),1)
 def test_invalid_batch_is_atomic_and_cancel_closes_pending_descriptors(self):
  _,item=self.source(1024);session=self.drop.share_path()['session']['id'];self.drop.update(session,{'state':'connected'})
  with self.assertRaises(ValueError):self.drop.enqueue(session,[item]*9)
  with self.assertRaises(ValueError):self.drop.enqueue('stale',[item])
  with self.assertRaises(ValueError):self.drop.enqueue(session,[item,{**item,'name':'../bad.bin'}])
  self.assertIsNone(self.drop.source);self.assertEqual(self.drop.outbox,[])
  self.drop.enqueue(session,[item,item]);sources=[self.drop.source,*self.drop.outbox];self.drop.clear_outbox(session)
  self.assertTrue(all(source.stream.closed for source in sources));self.assertEqual(self.drop.snapshot()['queued'],0);self.assertTrue(item['path'].exists())
  self.drop.enqueue(session,[item,item]);sources=[self.drop.source,*self.drop.outbox];self.drop.stop();self.assertTrue(all(source.stream.closed for source in sources))
 def test_incoming_offer_reserves_edge_until_accepted_or_declined(self):
  _,item=self.source(1024);session=self.drop.share_path()['session']['id'];self.drop.update(session,{'state':'connected','offer_pending':True})
  self.assertTrue(self.drop.snapshot()['offer_pending'])
  with self.assertRaises(ValueError):self.drop.enqueue(session,[item])
  self.drop.update(session,{'state':'declined'});self.assertFalse(self.drop.snapshot()['offer_pending']);self.drop.enqueue(session,[item])
 def test_receiving_error_survives_native_snapshots_without_arbitrary_remote_text(self):
  identifier=self.drop.share_path()['session']['id'];self.drop.update(identifier,{'state':'failed','failure':'storage_full'});self.assertEqual(self.drop.snapshot()['failure'],'storage_full')
  self.drop.update(identifier,{'state':'failed','failure':'private arbitrary error'});self.assertIsNone(self.drop.snapshot()['failure'])
  self.drop.update(identifier,{'state':'failed','failure':{}});self.assertIsNone(self.drop.snapshot()['failure'])
  self.drop.update(identifier,{'state':'connected','failure':'storage_full'});self.assertIsNone(self.drop.snapshot()['failure'])

if __name__=='__main__':unittest.main()
