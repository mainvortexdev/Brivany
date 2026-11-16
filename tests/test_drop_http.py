"""Real desktop session auth and binary block HTTP; synthetic local files only."""
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from desktop.experience.launcher import experience_handler
from desktop.experience.ui_session import DesktopUISession
from desktop.experience.drop_transfer import OfficialDrop
from desktop.experience.workspace_files import FileShelf,BLOCK_BYTES
from services.h1.server import Handler

class Vault:
 def read(self):return {'issuer_token':'fixture-issuer'}

class BinaryHTTPTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);root=Path(self.temp.name);self.shelf=FileShelf();self.addCleanup(self.shelf.close);source=root/'test.bin';source.write_bytes(b'Owned binary bytes');file=self.shelf.get(self.shelf.add_path(source))
  self.drop=OfficialDrop(root/'private',vault=Vault(),receive_folder=root/'received',request=lambda method,*a,**k:{'protocol':2} if method=='POST' else {'state':'cancelled'});self.addCleanup(self.drop.close);self.state=self.drop.share_path(file);self.session=self.state['session'];self.ui=DesktopUISession(set())
  self.server=ThreadingHTTPServer(('127.0.0.1',0),experience_handler(Handler));self.server.daemon_threads=True;self.server.desktop_ui_session=self.ui;self.server.desktop_bridge=SimpleNamespace(_workspace_file_transfer=self.drop,_workspace_file_shelf=self.shelf);threading.Thread(target=self.server.serve_forever,daemon=True).start();self.addCleanup(self.server.server_close);self.addCleanup(self.server.shutdown)
 def request(self,method,path,body=None,headers=None):
  connection=HTTPConnection('127.0.0.1',self.server.server_port,timeout=3);self.addCleanup(connection.close);connection.request(method,path,body=body,headers=headers or {});response=connection.getresponse();return response.status,response.read()
 def headers(self,**more):return {self.ui.HEADER:self.ui.secret,'Authorization':'Bearer '+self.session['owner'],**more}
 def source(self):return self.session['local_url']+'/source/'+self.session['source']['id']+'?offset=0&length=18'
 def test_requires_both_native_ui_session_and_scoped_pair_capability(self):
  self.assertEqual(self.request('GET',self.source())[0],403);self.assertEqual(self.request('GET',self.source(),headers={self.ui.HEADER:self.ui.secret})[0],403);self.assertEqual(self.request('GET',self.source(),headers=self.headers(Origin='https://other.invalid'))[0],403)
  status,data=self.request('GET',self.source(),headers=self.headers());self.assertEqual(status,200);self.assertEqual(data,b'Owned binary bytes')
 def test_cannot_read_arbitrary_source_or_exceed_block_boundaries(self):
  url=self.session['local_url']+'/source/'+'a'*32+'?offset=0&length=18';self.assertEqual(self.request('GET',url,headers=self.headers())[0],422)
  url=self.session['local_url']+'/source/'+self.session['source']['id']+'?offset=0&length='+str(BLOCK_BYTES+1);self.assertEqual(self.request('GET',url,headers=self.headers())[0],422)
 def test_incoming_binary_is_written_only_after_explicit_native_acceptance(self):
  file={'id':'a'*32,'name':'Incoming.bin','size':3};url=self.session['local_url']+'/incoming/'+file['id']+'?offset=0';headers=self.headers(**{'Content-Type':'application/octet-stream','X-Brivany-Block-SHA256':hashlib.sha256(b'abc').hexdigest()})
  self.assertEqual(self.request('POST',url,b'abc',headers)[0],422);self.drop.begin_receive(self.session['id'],file);self.assertEqual(self.request('POST',url,b'abc',headers)[0],200);value=self.drop.finish_receive(self.session['id'],file['id']);self.assertEqual(Path(value['path']).read_bytes(),b'abc')
 def test_drag_import_uses_binary_blocks_and_does_not_require_a_phone_pair(self):
  slot=self.shelf.begin_upload('Import.bin',3);url=slot['local_url']+'?offset=0'
  self.assertEqual(self.request('POST',url,b'abc',{'Content-Type':'application/octet-stream'})[0],403);self.assertEqual(self.request('POST',url,b'abc',{self.ui.HEADER:self.ui.secret,'Content-Type':'application/octet-stream'})[0],200);identifier=self.shelf.commit_upload(slot['token']);self.assertEqual(self.shelf.get(identifier)['path'].read_bytes(),b'abc')

if __name__=='__main__':unittest.main()
