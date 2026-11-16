"""Private video retry context, separate from operational receipts and grants."""
import hashlib
from pathlib import Path
import re
from uuid import UUID
from services.private_store import PrivateStore


def retry_request(text):
    return bool(re.fullmatch(r'\s*[¿¡]?\s*(?:por favor[, ]+)?(?:vuelve a intentarlo|int[eé]ntalo de nuevo|reint[eé]ntalo|reintenta(?: el (?:video|v[ií]deo|pedido))?|try again)(?:[, ]+por favor)?[.!?\s]*',text,re.I))


class RetryContexts:
    def __init__(self,root,*,protector=None,history=None):
        self.root=Path(root);self.protector=protector;self.history=history

    def store(self,identifier):
        if str(UUID(identifier))!=identifier:raise ValueError('Tarea de origen no válida.')
        return PrivateStore(self.root/(identifier+'.dpapi'),protector=self.protector)

    def save(self,job,conversation):
        if not conversation or job['kind']!='motion' or job.get('parent_id'):return
        selected=[]
        for item in job['selected_media']:
            path=Path(item);stat=path.stat();selected.append({'path':str(path),'size':stat.st_size,'mtime_ns':stat.st_mtime_ns})
        self.store(job['id']).write({'conversation_id':conversation,'kind':'motion','goal':job['goal'],
            'request':job['user_request'],'selected':selected,'roots':list(job['authorized_roots'])})

    def read(self,identifier,conversation,service):
        value=self.store(identifier).read()
        if not value:value=self.legacy(identifier,conversation,service)
        if not value or value.get('conversation_id')!=conversation or value.get('kind')!='motion':
            raise ValueError('No pude recuperar el encargo de video de esta conversación. Vuelve a adjuntar la referencia y el pedido completo.')
        selected=[]
        for item in value.get('selected',[]):
            path=Path(item['path'])
            if path.is_symlink() or path.resolve()!=path.absolute() or not path.is_file():raise ValueError('La referencia ya no está disponible; vuelve a adjuntarla.')
            stat=path.stat()
            if (stat.st_size,stat.st_mtime_ns)!=(item['size'],item['mtime_ns']):raise ValueError('La referencia cambió; vuelve a adjuntarla antes de reintentar.')
            selected.append(str(path))
        return {**value,'selected_media':tuple(selected),'authorized_roots':tuple(root for root in value['roots'] if root in service.roots)}

    def legacy(self,identifier,conversation,service):
        """Read the user's encrypted chat, never infer an order from an artifact."""
        if not conversation:return {}
        if self.history:chat=self.history(conversation)
        else:
            from services.chat_history import ChatHistory
            chat=ChatHistory(service.root.parent/'chat').get(conversation)
        messages=chat.get('messages',[])
        anchors=[i for i,m in enumerate(messages) if m.get('taskId')==identifier and m.get('role')=='assistant']
        if not anchors:return {}
        # Earlier releases saved a bare retry as a new task. Walk back through
        # those retry turns to the actual user request, in this chat only.
        cursor=anchors[-1]
        for _ in range(12):
            user=next((i for i in range(cursor-1,-1,-1) if messages[i].get('role')=='user'),None)
            if user is None:return {}
            request=messages[user]['text']
            if not retry_request(request):break
            cursor=next((i for i in range(user-1,-1,-1) if messages[i].get('role')=='assistant' and messages[i].get('taskId')),None)
            if cursor is None:return {}
        else:return {}
        source=messages[cursor].get('taskId');job=service.jobs.get(source)
        if not job or job['kind']!='motion' or not 0<len(request)<=2000:return {}
        # Recover only a byte-identical cached upload when the old release did
        # not persist the attachment ID. The profile supplies no instructions.
        import json
        profile=service.workspace/'motion'/source/'reference-profile.json';selected=[]
        if profile.is_file():
            if profile.is_symlink() or profile.stat().st_size>200000:raise ValueError('Perfil de referencia no válido.')
            ref=json.loads(profile.read_text(encoding='utf-8'));digest=ref.get('source_sha256','');name=ref.get('source_name','')
            if not re.fullmatch(r'[a-f0-9]{64}',digest) or Path(name).name!=name or not name:raise ValueError('Vuelve a adjuntar el video de referencia original.')
            for path in (service.root/'chat-inputs').glob('*/*'):
                if path.name!=name:continue
                if path.resolve()!=path.absolute() or path.is_symlink() or not path.is_file():continue
                sha=hashlib.sha256()
                with path.open('rb') as stream:
                    while chunk:=stream.read(1024*1024):sha.update(chunk)
                if sha.hexdigest()==digest:
                    stat=path.stat();selected=[{'path':str(path),'size':stat.st_size,'mtime_ns':stat.st_mtime_ns}];break
            if not selected:raise ValueError('No encontré el video original en los adjuntos privados; vuelve a adjuntarlo.')
        elif re.search(r'\b(?:adjunt|referencia)\w*\b',request,re.I):
            raise ValueError('Vuelve a adjuntar la referencia para retomar exactamente ese video.')
        return {'conversation_id':conversation,'kind':'motion','goal':request,'request':request,'selected':selected,'roots':list(service.roots)}
