"""Fixed Cartesia clone endpoint for explicitly authorized speech, in memory."""
from http.client import HTTPSConnection
import io
import json
import os
import wave
from uuid import UUID,uuid4


class CartesiaVoiceCloner:
    def __init__(self,*,connection_factory=HTTPSConnection,journal=None):
        self.key=os.environ.get('BRIVANY_CARTESIA_API_KEY','').strip();self.factory=connection_factory
        if not self.key:raise ValueError('Configura Cartesia antes de clonar voces.')
        if journal is None:
            from services.work.voice_cleanup import VoiceCleanupJournal
            journal=VoiceCleanupJournal(self.key)
        self.journal=journal

    def _request(self,method,path,body=None,content_type='application/json'):
        connection=self.factory('api.cartesia.ai',443,timeout=20)
        try:
            connection.request(method,path,body=body,headers={'Authorization':'Bearer '+self.key,'Cartesia-Version':'2026-08-14','Content-Type':content_type,'Accept':'application/json'})
            reply=connection.getresponse();raw=reply.read(65537)
            if method=='DELETE' and reply.status==404:return {}
            if len(raw)>65536 or not 200<=reply.status<300:raise ValueError('Cartesia no pudo completar la operación de voz. No se reintentó.')
            return json.loads(raw) if raw.strip() else {}
        finally:connection.close()

    def clone(self,pcm,*,language,name,authorized):
        if authorized is not True:raise ValueError('La clonación requiere permiso del hablante.')
        if language not in ('es','en','fr') or not isinstance(name,str) or not 1<=len(name)<=64 or any(ord(c)<32 for c in name):raise ValueError('Datos de voz no válidos.')
        if not isinstance(pcm,bytes) or len(pcm)%2 or not 480000<=len(pcm)<=2880000:raise ValueError('Se necesitan entre 10 y 60 segundos de voz limpia.')
        buffer=io.BytesIO()
        with wave.open(buffer,'wb') as output:output.setnchannels(1);output.setsampwidth(2);output.setframerate(24000);output.writeframes(pcm)
        boundary='Brivany'+uuid4().hex;parts=[]
        for key,value in [('name',name),('language',language),('access','private')]:
            parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n').encode('utf-8'))
        parts.extend([(f'--{boundary}\r\nContent-Disposition: form-data; name="clip"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode(),buffer.getvalue(),f'\r\n--{boundary}--\r\n'.encode()])
        result=self._request('POST','/voices/clone',b''.join(parts),'multipart/form-data; boundary='+boundary)
        identifier=result.get('id')
        try:identifier=str(UUID(identifier))
        except (ValueError,TypeError,AttributeError):raise ValueError('Cartesia no confirmó una voz válida.') from None
        if result.get('access')!='private' or result.get('language')!=language:
            self.delete(identifier);raise ValueError('La voz creada no corresponde a la configuración solicitada.')
        try:self.journal.remember(identifier)
        except Exception:
            # Do not return an untracked remote voice if local storage failed.
            self._request('DELETE','/voices/'+identifier)
            raise ValueError('No se pudo registrar la limpieza de la voz temporal.') from None
        return {'id':identifier,'language':language,'access':'private'}

    def keep_alive(self,identifiers):
        # Local lease only: no upload, inference or API request.
        for identifier in identifiers:self.journal.remember(identifier)

    def persist(self,identifier):
        # Kept by the user: leave the temporary cleanup journal. No request.
        self.journal.forget(str(UUID(identifier)))

    def delete(self,identifier):
        identifier=str(UUID(identifier))
        self._request('DELETE','/voices/'+identifier)
        self.journal.forget(identifier)

    def cleanup_expired(self):
        for identifier in self.journal.expired():
            try:self.delete(identifier)
            except Exception:pass
