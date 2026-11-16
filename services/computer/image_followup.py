"""Bind explicit visual revisions to a verified artifact in the current chat."""
import re
import base64
from io import BytesIO
import secrets
import time
from PIL import Image,ImageOps
from .references import Reference


def edit_request(text):
    text=text.strip().casefold()
    text=re.sub(r'^(?:oye[, ]+)?(?:melodi|brivany)[, ]+','',text)
    polite=re.match(r'^¿?(?:puedes|podr[ií]as)\s+(hacer|cambiar|modificar|editar|poner|añadir|agregar|quitar|eliminar)\b\s*(.*)',text)
    if polite:
        verb={'hacer':'haz','cambiar':'cambia','modificar':'modifica','editar':'edita','poner':'ponle','añadir':'añade','agregar':'agrega','quitar':'quita','eliminar':'elimina'}[polite[1]]
        text=verb+' '+polite[2]
    text=re.sub(r'^quiero\s+(?=que\b)','',text)
    if text.startswith(('¿','no ','si ','cómo ','como ','por qué ','por que ')):return False
    if re.search(r'\b(?:otra|nueva|nuevo)\s+(?:imagen|foto|ilustraci[oó]n|diseño)\b',text):return False
    if re.search(r'\b(?:ordenador|pantalla|calendario|correo|archivo|carpeta|video|vídeo|música|volumen|ventana|spotify|youtube)\b',text):return False
    if re.match(r'^(?:que\s+(?:.+?\s+)?(?:sea|sean|tenga|tengan|lleve|lleven|aparezca|aparezcan)\b|(?:hazlo|hazla|hazlos|hazlas|ponlo|ponla|cámbialo|cambialo|cámbiala|cambiala)\b|(?:cambia|modifica|edita|ponle|añade|agrega|quita|elimina|conserva|mantén|manten)\b)',text):return True
    visual=r'\b(?:rojo|roja|azul|verde|blanco|blanca|negro|negra|color|fondo|grande|pequeño|pequeña|oscuro|oscura|claro|clara|realista|acuarela|ilustraci[oó]n)\b'
    return bool(re.match(r'^(?:haz\b|ahora\b|m[aá]s\b|menos\b|con\b|sin\b)',text) and re.search(visual,text))


def bound_image(service,value):
    if not value.conversation_id or not value.retry_job_id:return None
    job=service.jobs.get(value.retry_job_id)
    if not job or job['kind']!='image':return None
    if job.get('_conversation_id')==value.conversation_id:return job
    # After a restart the encrypted chat is the authority, never model-supplied
    # conversation text or the most recent image in another conversation.
    from services.chat_history import ChatHistory
    try:
        history=ChatHistory(service.root.parent/'chat').get(value.conversation_id)
        if any(m.get('role')=='assistant' and m.get('taskId')==job['id'] for m in history.get('messages',[])):return job
    except (ValueError,OSError):pass
    return None


def prepare(service,value,cancelled=None):
    """Return None for other requests; prepare only, without invoking a provider."""
    if value.media_ids or not edit_request(value.text):return None
    job=bound_image(service,value)
    if not job:return None
    if cancelled is not None and cancelled.is_set():return []
    if job['state'] in {'queued','planning','running','reviewing','awaiting_approval'}:
        message='La imagen de este chat sigue en preparación. Espera a que termine para aplicar ese cambio.'
    else:
        try:
            path=service.results.image_path(job['id'])
            with Image.open(path) as source:
                image=ImageOps.exif_transpose(source);image.thumbnail((1600,1600))
                image=image.convert('RGBA' if 'A' in image.getbands() or 'transparency' in image.info else 'RGB')
                buffer=BytesIO();image.save(buffer,'PNG');width,height=image.size
            data='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
            reference=Reference(secrets.token_urlsafe(24),data,width,height,time.monotonic()+90)
        except (ValueError,OSError):
            message='No pude recuperar la imagen de este chat para editarla. Vuelve a adjuntarla y aplicaré ese cambio.'
        else:
            goal=('Edita la imagen de referencia creada en esta conversación. Conserva su estilo, composición, iluminación y los elementos que no se pidan cambiar. Aplica esta modificación: '+value.text)[:2000]
            with service.lock:
                service.prepared={key:item for key,item in service.prepared.items() if item['expires']>time.monotonic()}
                if len(service.prepared)>=8:raise ValueError('Hay demasiadas peticiones pendientes.')
                ticket=secrets.token_urlsafe(24)
                service.prepared[ticket]={'expires':time.monotonic()+90,'kind':'image','goal':goal,'user_request':value.text,
                    'references':[reference],'active_reference_id':None,'representation':'3d','selected_media':[],
                    'authorized_roots':tuple(service.roots),'conversation_context':[m.model_dump() for m in (value.conversation_context or value.history)],
                    'context_truncated':value.context_truncated,'conversation_id':value.conversation_id,
                    'acknowledgement':'Voy a aplicar ese cambio a la imagen de este chat, conservando su estilo y composición.'}
            return [{'type':'reference_action','ticket':ticket,'kind':'image'}]
    return [{'type':'delta','text':message},{'type':'sentence','text':message},{'type':'done','text':message,'await_user':True}]
