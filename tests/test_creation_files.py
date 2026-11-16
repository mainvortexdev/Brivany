from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from uuid import uuid4
from PIL import Image
from services.orchestration.deliveries import CreationFiles


class CreationFileTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);private=self.root/'computer';private.mkdir();workspace=private/'workspace';workspace.mkdir()
  self.service=SimpleNamespace(root=private,workspace=workspace,jobs={});self.destination=self.root/'Documentos/Creaciones de Melodi';self.files=CreationFiles(self.service,self.destination)
 def job(self,kind,suffix,title='Prueba'):
  identifier=str(uuid4());folder=self.service.workspace/('motion/'+identifier if kind=='motion' else kind);folder.mkdir(parents=True,exist_ok=True);path=folder/('Brivany'+suffix if kind=='motion' else identifier+suffix)
  if suffix=='.png':Image.new('RGB',(128,128),'blue').save(path)
  else:path.write_bytes(b'original-fixture')
  job={'id':identifier,'kind':kind,'state':'succeeded','result':{'path':str(path),'title':title,'verified':True}};self.service.jobs[identifier]=job;return job,path
 def test_only_final_files_are_sorted_and_sources_remain_unchanged(self):
  expected=[]
  for kind,suffix,category in [('image','.png','Imágenes'),('motion','.mp4','Videos'),('document','.txt','Documentos')]:
   job,path=self.job(kind,suffix);before=path.read_bytes();(path.parent/'technical.json').write_text('{}');(path.parent/'assets').mkdir(exist_ok=True)
   output=self.files.export(job['id'])[0];self.assertEqual(output.parent,self.destination/category);self.assertEqual(output.read_bytes(),before);self.assertEqual(path.read_bytes(),before);expected.append(output)
  self.assertEqual(set(self.destination.iterdir()),{self.destination/name for name in ('Documentos','Imágenes','Videos')});self.assertEqual(set(p for p in self.destination.rglob('*') if p.is_file()),set(expected))
 def test_collection_index_and_restarts_reuse_the_same_deliveries(self):
  job,path=self.job('image','.png');second=path.with_name('second.png');Image.new('RGB',(128,128),'red').save(second);job['result']['images']=[{'path':str(path)},{'path':str(second)}]
  outputs=self.files.export(job['id']);self.assertEqual(len(outputs),2);self.assertNotEqual(outputs[0],outputs[1]);self.assertEqual(self.files.export(job['id'],1),[outputs[1]])
  self.assertEqual(CreationFiles(self.service,self.destination).export(job['id']),outputs)
 def test_user_edits_and_name_collisions_are_never_overwritten(self):
  job,path=self.job('document','.txt');first=self.files.export(job['id'])[0];first.write_bytes(b'user edit');second=self.files.export(job['id'])[0]
  self.assertNotEqual(first,second);self.assertEqual(first.read_bytes(),b'user edit');self.assertEqual(second.read_bytes(),path.read_bytes())
 def test_in_progress_results_and_non_final_metadata_are_rejected(self):
  job,path=self.job('document','.json')
  with self.assertRaises(ValueError):self.files.export(job['id'])
  job['state']='running'
  with self.assertRaises(ValueError):self.files.export(job['id'])
  self.assertFalse(self.destination.exists())
 def test_scoped_sources_and_indices_cannot_read_other_files(self):
  job,path=self.job('image','.png');private=self.root/'private.png';Image.new('RGB',(128,128)).save(private);job['result']['path']=str(private)
  with self.assertRaises(ValueError):self.files.export(job['id'])
  job['result']['path']=str(path)
  for index in (-1,1,True,'0'):
   with self.assertRaises(ValueError):self.files.export(job['id'],index)
 def test_unsafe_title_is_a_filename_not_a_destination(self):
  job,path=self.job('document','.txt','../../afuera/<bad>:prueba');output=self.files.export(job['id'])[0];self.assertEqual(output.parent,self.destination/'Documentos');self.assertTrue(output.is_file());self.assertNotIn('..',output.name)
 def test_catalog_failure_preserves_original_and_does_not_copy_metadata(self):
  job,path=self.job('image','.png');before=path.read_bytes();self.files.database.write_bytes(b'not a database')
  with self.assertRaises(OSError):self.files.export(job['id'])
  self.assertEqual(path.read_bytes(),before);self.assertFalse(any(self.destination.rglob('*.sqlite3')))
