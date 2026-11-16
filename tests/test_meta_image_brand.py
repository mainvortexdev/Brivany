"""Saved brand rules are opt-in, and image provenance never contains references."""
import base64
import json
from io import BytesIO
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from PIL import Image
from services.orchestration.meta import MetaTools,image_design_context,image_requested_size


class MetaImageBrandTests(unittest.TestCase):
 def test_illustration_language_is_preserved_for_people_and_reference_captures(self):
  request='Crea una ilustración como esta para una historia de Instagram.'
  prompt,brand=image_design_context(request)
  self.assertTrue(prompt.startswith(request))
  self.assertIn('ilustración estática, no una fotografía',prompt)
  self.assertIn('retratos y avatares',prompt)
  self.assertIn('ni inventes datos',prompt)
  self.assertEqual(brand,{})
  photo='Crea una foto de esta persona, sin ilustraciones.'
  self.assertEqual(image_design_context(photo),(photo,{}))
 def test_brand_rules_apply_only_when_the_user_requests_the_style(self):
  original='Una fotografía del producto Brivany sobre una mesa.'
  self.assertEqual(image_design_context(original),(original,{}))
  styled,context=image_design_context('Crea una imagen con el estilo de Brivany.')
  self.assertIn('#0071e3',styled)
  self.assertIn('Brivany Editorial',styled)
  self.assertIn('Privacidad:',styled)
  self.assertNotIn('No sustituirlas por imágenes generadas',styled)
  self.assertNotIn('Música distinta para cada video',styled)
  self.assertEqual(context['brand'],'Brivany')
  self.assertEqual(len(context['sha256']),64)

 def test_next_job_reads_the_saved_guide_again_without_global_image_style(self):
  with tempfile.TemporaryDirectory() as temp:
   guide=Path(temp)/'STYLE.md'
   with patch('services.orchestration.meta.BRAND_GUIDE',guide):
    guide.write_text('- Paneles blancos #abcdef\n',encoding='utf-8')
    first=image_design_context('Imagen, estilo Brivany')
    guide.write_text('- Paneles blancos #123456\n',encoding='utf-8')
    second=image_design_context('Imagen, estilo Brivany')
    self.assertIn('#123456',second[0])
    self.assertNotEqual(first[1]['sha256'],second[1]['sha256'])
    self.assertEqual(image_design_context('Una foto de una flor'),('Una foto de una flor',{}))

 def test_documented_size_and_references_reach_meta_with_separate_provenance(self):
  buffer=BytesIO();Image.new('RGB',(256,448),'blue').save(buffer,'PNG')
  response={'data':[{'b64_json':base64.b64encode(buffer.getvalue()).decode()}]}
  captured=[]
  class Opener:
   def open(self,request,timeout):
    captured.append((request.full_url,json.loads(request.data)))
    return BytesIO(json.dumps(response).encode())
  reference='data:image/png;base64,reference-fixture-not-an-original'
  with tempfile.TemporaryDirectory() as temp,patch.dict('os.environ',{'BRIVANY_META_API_KEY':'fixture-no-network'}):
   result=MetaTools(Opener()).image('Imagen estilo Brivany, 1080×1920.',temp,'owned',threading.Event(),lambda:None,images=[reference])
   self.assertTrue(captured[0][0].endswith('/images/edits'))
   self.assertEqual(captured[0][1]['size'],'1080x1920')
   self.assertEqual(captured[0][1]['images'],[{'image_url':reference}])
   self.assertEqual((result['width'],result['height']),(256,448))
   metadata=json.loads(Path(result['provenance_path']).read_text(encoding='utf-8'))
   self.assertEqual(metadata['creator'],'Melodi')
   self.assertEqual(metadata['reference_count'],1)
   self.assertEqual(metadata['requested_size'],'1080x1920')
   self.assertEqual(metadata['actual_size'],[256,448])
   self.assertNotIn(reference,json.dumps(metadata))
   self.assertIsNone(metadata['billing_amount'])
   self.assertFalse(metadata['semantic_verification'])

 def test_malformed_dimensions_are_rejected_without_inventing_other_api_flags(self):
  self.assertEqual(image_requested_size('Una story, 1080 x 1920'),'1080x1920')
  self.assertIsNone(image_requested_size('Una foto cuadrada'))
  with self.assertRaises(ValueError):image_requested_size('Imagen 9999x1000')
  with self.assertRaises(ValueError):image_requested_size('Imagen 8192x128')


if __name__=='__main__':unittest.main()
