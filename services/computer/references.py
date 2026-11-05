"""Ephemeral, decoded image references. No original files, paths or image ledger."""
import base64
from dataclasses import dataclass
from io import BytesIO
import re
import secrets
import threading
import time
import warnings
from PIL import Image,ImageOps
from pydantic import Field,model_validator
from packages.providers.conversation import ConversationRequest


class ImageTurnRequest(ConversationRequest):
    reference_ids:list[str]=Field(min_length=1,max_length=4)
    active_reference_id:str|None=None
    @model_validator(mode='after')
    def validate_references(self):
        if len(set(self.reference_ids))!=len(self.reference_ids) or any(not re.fullmatch(r'[A-Za-z0-9_-]{32}',key) for key in self.reference_ids):raise ValueError('Referencia inválida.')
        if self.active_reference_id is not None and self.active_reference_id not in self.reference_ids:raise ValueError('Referencia activa inválida.')
        if self.document is not None:raise ValueError('Envía imágenes o un documento en este turno, no ambos.')
        return self


@dataclass(frozen=True)
class Reference:
    id:str
    data_url:str
    width:int
    height:int
    expires:float


class ReferenceStore:
    def __init__(self,*,now=time.monotonic,ttl=1800):self.now=now;self.ttl=ttl;self.values={};self.lock=threading.RLock()
    def purge(self):
        with self.lock:
            for key in [key for key,value in self.values.items() if value.expires<=self.now()]:self.values.pop(key,None)
    def add(self,data):
        if not isinstance(data,str) or len(data)>2200000:raise ValueError('La imagen supera el límite local.')
        match=re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)',data)
        if not match:raise ValueError('Usa una imagen PNG, JPEG o WebP.')
        try:raw=base64.b64decode(match[2],validate=True)
        except ValueError:raise ValueError('Imagen inválida.') from None
        if len(raw)>1600000:raise ValueError('La imagen supera el límite local.')
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            try:original=Image.open(BytesIO(raw))
            except (OSError,Image.DecompressionBombError,Image.DecompressionBombWarning):raise ValueError('Imagen inválida.') from None
            with original:
                if original.format not in {'PNG','JPEG','WEBP'} or original.width*original.height>16000000 or min(original.size)<16:raise ValueError('Dimensiones o formato de imagen no admitidos.')
                try:original.load();image=ImageOps.exif_transpose(original).convert('RGBA');image.thumbnail((1600,1600))
                except OSError:raise ValueError('Imagen inválida.') from None
                background=Image.new('RGB',image.size,'white');background.paste(image,mask=image.getchannel('A'))
                output=BytesIO();format='PNG' if original.format=='PNG' else 'JPEG'
                background.save(output,format=format,**({'optimize':True} if format=='PNG' else {'quality':90,'optimize':True}))
                if output.tell()>1550000 and format=='PNG':
                    output=BytesIO();format='JPEG';background.save(output,format='JPEG',quality=85,optimize=True)
                encoded=base64.b64encode(output.getvalue()).decode()
        if len(encoded)>2100000:raise ValueError('La imagen optimizada todavía es demasiado grande.')
        key=secrets.token_urlsafe(24);value=Reference(key,'data:image/'+format.lower()+';base64,'+encoded,*background.size,self.now()+self.ttl)
        with self.lock:
            self.purge()
            if len(self.values)>=12:raise ValueError('Quita imágenes anteriores antes de adjuntar más.')
            self.values[key]=value
        return {'id':key,'width':value.width,'height':value.height,'expires_in':self.ttl}
    def get_many(self,keys):
        with self.lock:
            self.purge()
            if not 1<=len(keys)<=4 or any(key not in self.values for key in keys):raise ValueError('La referencia expiró o se quitó. Adjunta la imagen otra vez.')
            return [self.values[key] for key in keys]
    def remove(self,key):
        with self.lock:self.values.pop(key,None)
    def clear(self):
        with self.lock:self.values.clear()
