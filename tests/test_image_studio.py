import base64
from io import BytesIO
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from uuid import uuid4
from unittest.mock import patch
from PIL import Image
from services.orchestration.meta import MetaTools,image_requested_count
from services.orchestration.results import ResultViewer
from services.orchestration.image_studio import ImageStudio
from services.computer.references import ReferenceStore


def png(image):
 buffer=BytesIO();image.save(buffer,'PNG');return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()


class ImageStudioTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.id=str(uuid4())
  self.paths=[self.root/'one.png',self.root/'two.png'];Image.new('RGBA',(128,128),(30,60,90,128)).save(self.paths[0]);Image.new('RGB',(128,128),'blue').save(self.paths[1])
  self.service=SimpleNamespace(workspace=self.root,references=ReferenceStore(),jobs={self.id:{'id':self.id,'state':'succeeded','kind':'image','result':{'verified':True,'path':str(self.paths[0]),'images':[{'path':str(p)} for p in self.paths]}}})
  self.service.results=ResultViewer(self.service);self.studio=ImageStudio(self.service)
 def test_gallery_has_independent_scoped_tickets_and_rejects_traversal(self):
  result=self.service.results.describe(self.id);self.assertEqual(result['type'],'gallery');self.assertEqual(len(result['items']),2)
  selected=self.service.results.describe(self.id,1);self.assertNotIn('src',selected);self.assertEqual(self.service.results.media(self.id,selected['media_ticket'])[0],self.paths[1])
  with self.assertRaises(ValueError):self.service.results.media(self.id,selected['media_ticket'])
  for index in (-1,2,True,'1'):
   with self.assertRaises(ValueError):self.service.results.describe(self.id,index)
  with tempfile.TemporaryDirectory() as outside:
   p=Path(outside)/'private.png';Image.new('RGB',(128,128)).save(p);self.service.jobs[self.id]['result']['images'][1]['path']=str(p)
   with self.assertRaises(ValueError):self.service.results.describe(self.id,1)
 def test_reference_is_fresh_and_local_edits_preserve_alpha_and_original(self):
  ref=self.studio.reference(self.id,0);self.assertEqual(len(self.service.references.get_many([ref['id']])),1)
  before=self.paths[0].read_bytes();job={'id':str(uuid4()),'cancelled':threading.Event(),'_image_operation':{'type':'save','source_id':self.id,'index':0,'data':png(Image.new('RGBA',(256,144),(22,45,67,0)))}}
  result=self.studio.process(job,lambda:None)
  with Image.open(result['path']) as image:self.assertEqual(image.size,(256,144));self.assertEqual(image.mode,'RGBA');self.assertEqual(image.getpixel((0,0)),(22,45,67,0))
  self.assertEqual(self.paths[0].read_bytes(),before);self.assertNotEqual(result['path'],str(self.paths[0]))
 def test_invalid_canvas_and_unsupported_operation_do_not_enqueue(self):
  for data in ('data:image/svg+xml;base64,AAAA','data:image/png;base64,!!!!',png(Image.new('RGB',(10,10)))):
   with self.assertRaises(ValueError):self.studio.decode(data)
  self.service.require=lambda token:None
  with self.assertRaises(ValueError):self.studio.start(self.id,0,'shell',None,'token')
 def test_background_matte_uses_original_pixels_and_rejects_empty_mask(self):
  mask=self.root/'mask.png';image=Image.new('L',(128,128),0);image.paste(255,(32,32,96,96));image.save(mask)
  self.service.orchestrator=SimpleNamespace(tools=SimpleNamespace(_image_one=lambda *args,**kw:{'path':str(mask)}));self.service.progress=lambda *args:None
  job={'id':str(uuid4()),'cancelled':threading.Event(),'_image_operation':{'type':'remove_background','source_id':self.id,'index':0}}
  result=self.studio.process(job,lambda:None)
  with Image.open(result['path']) as image:self.assertEqual(image.getpixel((0,0)),(30,60,90,0));self.assertEqual(image.getpixel((64,64)),(30,60,90,128))
  Image.new('L',(128,128),255).save(mask);job={'id':str(uuid4()),'cancelled':threading.Event(),'_image_operation':{'type':'remove_background','source_id':self.id,'index':0}}
  with self.assertRaises(ValueError):self.studio.process(job,lambda:None)
 def test_requested_count_and_split_prompts_never_reintroduce_the_collection(self):
  self.assertEqual(image_requested_count('Crea tres ilustraciones'),3);self.assertEqual(image_requested_count('varias imágenes'),3)
  with self.assertRaises(ValueError):image_requested_count('Crea 12 imágenes')
  tools=MetaTools();captured=[]
  tools.post=lambda *a,**k:{'choices':[{'message':{'content':json.dumps({'prompts':['Auriculares en estilo Brivany','Micrófono en estilo Brivany']})}}]}
  def one(prompt,directory,identifier,*args):captured.append((prompt,identifier));return {'path':str(self.paths[0]),'verified':True}
  tools._image_one=one
  result=tools.image('Crea dos ilustraciones: auriculares y micrófono, estilo Brivany, 1024x1024',self.root,self.id,threading.Event(),lambda:None)
  self.assertEqual(result['image_count'],2);self.assertEqual(len(set(x[1] for x in captured)),2);self.assertNotIn('Crea dos',captured[0][0]);self.assertNotIn('Micrófono',captured[0][0]);self.assertIn('1024x1024',captured[0][0])
  def partial(prompt,*args):
   if prompt.startswith('Micrófono'):raise ValueError('Provider unavailable')
   return {'path':str(self.paths[0]),'verified':True}
  tools._image_one=partial;result=tools.image('Crea dos imágenes',self.root,self.id,threading.Event(),lambda:None)
  self.assertTrue(result['partial']);self.assertEqual(result['image_count'],1);self.assertEqual(result['requested_count'],2)
