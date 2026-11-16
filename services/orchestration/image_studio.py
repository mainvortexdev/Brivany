"""Explicit image revisions, scoped to delivered artifacts; originals are immutable."""
import base64
from io import BytesIO
from pathlib import Path
from PIL import Image,ImageChops


class ImageStudio:
 def __init__(self,service):self.service=service
 def reference(self,identifier,index=0):
  path=self.service.results.image_path(identifier,index)
  return self.service.references.add(self.service.results.thumbnail(path,1500))
 def start(self,identifier,index,operation,data,token):
  self.service.require(token)
  self.service.results.image_path(identifier,index)
  if operation not in {'save','remove_background'}:raise ValueError('Herramienta de imagen no válida.')
  if operation=='save':self.decode(data)
  elif data is not None:raise ValueError('La herramienta no admite esos datos.')
  return self.service.enqueue('image','Estoy guardando la edición.' if operation=='save' else 'Estoy quitando el fondo de la imagen.',token,image_operation={'type':operation,'source_id':identifier,'index':index,'data':data})
 @staticmethod
 def decode(data):
  if not isinstance(data,str) or len(data)>33000000 or not data.startswith('data:image/png;base64,'):raise ValueError('Envía una edición PNG válida de hasta 24 MB.')
  try:
   raw=base64.b64decode(data.split(',',1)[1],validate=True)
   if len(raw)>24000000:raise ValueError()
   image=Image.open(BytesIO(raw))
   if image.format!='PNG' or min(image.size)<16 or max(image.size)>8192 or image.width*image.height>20000000:raise ValueError()
   image.load();return image.convert('RGBA')
  except (ValueError,OSError,Image.DecompressionBombError):raise ValueError('Las dimensiones o el archivo PNG no son válidos.') from None
 def process(self,job,charge):
  operation=job.pop('_image_operation');source=self.service.results.image_path(operation['source_id'],operation['index'])
  if operation['type']=='save':image=self.decode(operation['data']);method='canvas'
  else:
   self.service.progress(job,'Estoy separando el sujeto del fondo. Conservaré los píxeles de la imagen original.')
   reference=self.service.results.thumbnail(source,1600)
   # The provider supplies only a matte. RGB pixels always come from the original.
   matte=self.service.orchestrator.tools._image_one('Create a precise segmentation mask for the main foreground subject of this reference. Output ONLY a flat grayscale matte: pure white for the entire subject including fine edges, pure black for all background and cast shadows. Exact same composition, camera framing and aspect ratio. No new objects, no text, no checkerboard, no gradients inside foreground or background.',self.service.workspace/'image-masks',job['id'],job['cancelled'],charge,images=[reference])
   with Image.open(source) as original:image=original.convert('RGBA')
   with Image.open(matte['path']) as mask:alpha=mask.convert('L').resize(image.size,Image.Resampling.LANCZOS)
   histogram=alpha.histogram();pixels=image.width*image.height
   if sum(histogram[:32])<pixels*.005 or sum(histogram[224:])<pixels*.005:raise ValueError('No pude separar el fondo con suficiente claridad. Conservé la imagen original.')
   # Keep soft contour antialiasing, snap the large flat regions to true transparency.
   alpha=alpha.point(lambda value:0 if value<32 else 255 if value>223 else round((value-32)*255/191))
   image.putalpha(ImageChops.multiply(image.getchannel('A'),alpha));method='meta-matte'
  if job['cancelled'].is_set():raise ValueError('Edición cancelada.')
  directory=self.service.workspace/'images';directory.mkdir(exist_ok=True);path=directory/(job['id']+'.png')
  with path.open('xb') as output:image.save(output,'PNG')
  return {'path':str(path),'title':'Imagen editada','width':image.width,'height':image.height,'verified':True,'semantic_verification':False,'source_job':operation['source_id'],'source_index':operation['index'],'edit_method':method,'message':'He guardado la edición como una imagen nueva. Puedes revisarla aquí.'}
