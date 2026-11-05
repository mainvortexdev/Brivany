"""Loopback HTTP façade for local commands and opt-in spatial conversation."""
import json
import sqlite3
import threading
from pydantic import ValidationError
from packages.providers.live_voice import VoiceError
from services.spatial.assistant import SpatialAssistantService,SpatialCommandRequest,SpatialConversationRequest
from services.spatial.jobs import SpatialServiceError

SERVICE_LOCK=threading.Lock()
MAX_BODY=32*1024


def service(handler):
    with SERVICE_LOCK:
        if not hasattr(handler.server,'spatial_assistant'):
            handler.server.spatial_assistant=SpatialAssistantService(handler.spatial_service())
        return handler.server.spatial_assistant


def get(handler,route):
    if route!='/api/spatial/assistant/status':handler.error(404,'assistant_not_found','Función de Melodi no disponible.');return
    try:handler.send_json(200,service(handler).readiness())
    except (OSError,sqlite3.Error,ValueError):handler.error(503,'assistant_storage','No se pudo consultar el espacio local.')


def post(handler,route,chat_lock):
    origin=handler.headers.get('Origin')
    if origin not in {f'http://127.0.0.1:{handler.server.server_port}',f'http://localhost:{handler.server.server_port}'}:
        handler.reject_before_body(403,'local_form_required','Usa Melodi desde Brivany local.');return
    if handler.headers.get_content_type()!='application/json' or handler.headers.get('Transfer-Encoding'):
        handler.reject_before_body(415,'assistant_json_required','Usa una solicitud JSON local.');return
    try:length=int(handler.headers.get('Content-Length','0'))
    except ValueError:length=0
    if not 0<length<=MAX_BODY:handler.reject_before_body(413,'assistant_body_limit','El mensaje supera el límite local.');return
    try:
        raw=handler.rfile.read(length)
        if len(raw)!=length:raise ValueError()
        value=json.loads(raw)
        if not isinstance(value,dict):raise ValueError()
        current=service(handler)
        if route=='/api/spatial/assistant/command':handler.send_json(200,current.command(SpatialCommandRequest.model_validate(value)));return
        if route=='/api/spatial/assistant/execute':handler.send_json(200,current.execute(value));return
        if route!='/api/spatial/assistant/turn':handler.error(404,'assistant_not_found','Función de Melodi no disponible.');return
        value=SpatialConversationRequest.model_validate(value)
    except SpatialServiceError as exc:handler.error(exc.status,exc.code,str(exc));return
    except (ValidationError,ValueError,TypeError,KeyError):handler.error(422,'assistant_request','Revisa el mensaje, la escena, revisión y consentimiento.');return
    except (OSError,sqlite3.Error):handler.error(503,'assistant_storage','No se pudo consultar el espacio local.');return
    if not chat_lock.acquire(blocking=False):handler.error(409,'chat_busy','Melodi está preparando otra respuesta. Espera un momento.');return
    handler.close_connection=True;sent=False
    def emit(value):
        handler.wfile.write((json.dumps(value,ensure_ascii=False)+'\n').encode());handler.wfile.flush()
    try:
        for event in current.stream(value):
            if not sent:handler.send_headers(200,'application/x-ndjson; charset=utf-8');sent=True
            emit(event)
    except (VoiceError,SpatialServiceError) as exc:
        if sent:
            try:emit({'type':'error','code':exc.code,'message':str(exc)})
            except OSError:pass
        else:handler.error(getattr(exc,'status',503 if exc.code=='chat_not_configured' else 502),exc.code,str(exc))
    except (OSError,sqlite3.Error,ValueError,TypeError):
        if sent:
            try:emit({'type':'error','code':'assistant_connection','message':'La conversación se interrumpió. No se repitió la consulta.'})
            except OSError:pass
        else:handler.error(503,'assistant_storage','No se pudo consultar el espacio local.')
    finally:chat_lock.release()
