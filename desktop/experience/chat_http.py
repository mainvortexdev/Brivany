"""Same-session desktop history and provider settings, never public routes."""
import json
from urllib.parse import urlsplit
from packages.runtime_paths import DATA_ROOT
from services.chat_history import ChatHistory

def handle(handler,method):
    route=urlsplit(handler.path).path
    if not (route=='/api/desktop/chats' or route.startswith('/api/desktop/chats/') or route=='/api/desktop/chat-provider'):return False
    if not handler.workspace_preferences_access():return True
    try:
        if route=='/api/desktop/chat-provider':
            from packages.providers.general_chat import status
            if method!='GET':raise ValueError('Método no admitido.')
            handler.send_json(200,status());return True
        if not hasattr(handler.server,'chat_history'):handler.server.chat_history=ChatHistory(DATA_ROOT/'.local/chat')
        history=handler.server.chat_history
        if route.endswith('/title') and method=='POST':
            size=int(handler.headers.get('Content-Length','0'))
            if not 1<=size<=1024 or handler.headers.get_content_type()!='application/json' or handler.headers.get('Transfer-Encoding'):raise ValueError('Nombre no válido.')
            body=json.loads(handler.rfile.read(size))
            if not isinstance(body,dict) or set(body)!={'title'}:raise ValueError('Nombre no válido.')
            handler.send_json(200,history.rename(route.split('/')[-2],body['title']));return True
        if method=='GET':
            value=history.catalog() if route=='/api/desktop/chats' else history.get(route.rsplit('/',1)[1])
            handler.send_json(200,value);return True
        if method!='POST' or route!='/api/desktop/chats':raise ValueError('Método no admitido.')
        length=int(handler.headers.get('Content-Length','0'))
        if not 1<=length<=8000000 or handler.headers.get_content_type()!='application/json' or handler.headers.get('Transfer-Encoding'):raise ValueError('Historial demasiado grande.')
        value=json.loads(handler.rfile.read(length));result=history.save(value)
        handler.send_json(200,result)
    except (ValueError,OSError,TypeError,KeyError):handler.error(422,'chat_storage','No se pudo guardar o abrir el historial privado.')
    return True
