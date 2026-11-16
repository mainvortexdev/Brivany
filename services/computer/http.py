"""Loopback-only routes. Native grants are issued by the window bridge."""
import json
import threading
import select
import socket
from urllib.parse import urlsplit
from packages.providers.conversation import ConversationRequest
from .service import ComputerService, ComputerRequestError
from .references import ImageTurnRequest


def service(handler):
    lock=getattr(handler.server,'computer_lock',None)
    if lock is None:
        # The native launcher installs this before serving; fixture handlers can
        # install their own service without importing GUI dependencies.
        raise PermissionError('El servidor no habilitó el adaptador de escritorio.')
    with lock:
        if not hasattr(handler.server,'computer'):
            from services.connections import service as connections
            handler.server.computer=ComputerService('http://127.0.0.1:'+str(handler.server.server_port),
                handler.spatial_service,native=bool(getattr(handler.server,'computer_native',False)),connections_factory=lambda:connections(handler),
                human_factory=handler.human_skill_service,sous_factory=handler.sous_service)
        current=handler.server.computer
        if getattr(handler.server,'brivany_account',None):current.remote_account=handler.server.brivany_account
        return current


def get(handler):
    if not handler.local_request():return
    try:
        current=service(handler);route=urlsplit(handler.path).path
        if route=='/api/computer/status':
            authorized=current.authorized(handler.headers.get('X-Brivany-Control'))
            if not authorized:
                status=current.status();status.update(jobs=[],roots=[],schedules=[])
            else:status=current.status()
            status['request_authorized']=authorized;handler.send_json(200,status);return
        if route=='/api/computer/capabilities':
            if not current.native:raise PermissionError()
            handler.send_json(200,current.catalog());return
        if route.startswith('/api/computer/result-media/'):
            path,mime=current.results.media(route.rsplit('/',1)[1],handler.headers.get('X-Brivany-Result'))
            handler.send_bytes(200,path.read_bytes(),mime);return
        if route.startswith('/api/computer/image/') or route.startswith('/api/computer/research/'):
            from uuid import UUID
            from services.orchestration.team import artifact
            current.require(handler.headers.get('X-Brivany-Control'));identifier=route.rsplit('/',1)[1]
            if str(UUID(identifier))!=identifier:raise ValueError()
            job=current.jobs.get(identifier);kind='image' if '/image/' in route else 'research'
            if not job or job['kind']!=kind or job['state'] not in {'succeeded','awaiting_user'}:raise ValueError()
            path=artifact(current.workspace/('images' if kind=='image' else 'research')/(identifier+('.png' if kind=='image' else '.md')),current.workspace,24000000 if kind=='image' else 100000)
            if kind=='image':handler.send_bytes(200,path.read_bytes(),'image/png')
            else:handler.send_json(200,{'text':path.read_text(encoding='utf-8'),'sources':(job.get('result') or {}).get('sources',[])})
            return
        if route.startswith('/api/computer/event/'):
            current.require(handler.headers.get('X-Brivany-Control'));value=current.events.store.get(route.removeprefix('/api/computer/event/'))
            if not value or value['state']=='invalid':raise ValueError()
            handler.send_json(200,{'event':{key:value[key] for key in ('id','state','when','actions','phase')}});return
        if route.startswith('/api/computer/document/'):
            from uuid import UUID
            current.require(handler.headers.get('X-Brivany-Control'))
            identifier=route.removeprefix('/api/computer/document/')
            if str(UUID(identifier))!=identifier:raise ValueError()
            job=current.jobs.get(identifier)
            if not job or job['kind']!='document' or job['state'] not in {'succeeded','awaiting_user'}:raise ValueError()
            handler.send_bytes(200,(current.workspace/'documents'/(identifier+'.html')).read_bytes(),'text/html; charset=utf-8');return
        if route.startswith('/api/computer/motion/'):
            from uuid import UUID
            current.require(handler.headers.get('X-Brivany-Control'));identifier=route.removeprefix('/api/computer/motion/')
            if str(UUID(identifier))!=identifier:raise ValueError()
            job=current.jobs.get(identifier)
            if not job or job['kind']!='motion' or job['state'] not in {'succeeded','awaiting_user'} or not (job.get('result') or {}).get('verified'):raise ValueError()
            from services.orchestration.motion_result import motion_artifact
            path=motion_artifact(current.workspace,identifier,job['result'])
            handler.send_bytes(200,path.read_bytes(),'image/png' if path.suffix=='.png' else 'video/mp4');return
        if route.startswith('/api/computer/drawing/'):
            from uuid import UUID
            from pathlib import Path
            current.require(handler.headers.get('X-Brivany-Control'));identifier=route.removeprefix('/api/computer/drawing/')
            if str(UUID(identifier))!=identifier:raise ValueError()
            job=current.jobs.get(identifier)
            receipts=job.get('result',{}).get('receipts',[]) if job and isinstance(job.get('result'),dict) else []
            receipt=next((item for item in reversed(receipts) if item['action'] in {'draw_paint','save_paint'} and item['result'].get('localPath')),None)
            if not receipt:raise ValueError()
            path=Path(receipt['result']['localPath']).resolve()
            if not path.is_relative_to(current.workspace.resolve()) or path.suffix.lower()!='.png' or path.stat().st_size>10000000:raise ValueError()
            handler.send_bytes(200,path.read_bytes(),'image/png');return
        handler.error(404,'computer_missing','Ruta no disponible.')
    except (ValueError,PermissionError):handler.error(403,'computer_disabled','Activa el control desde Brivany Desktop.')
    except OSError:handler.error(503,'computer_artifact','El archivo del resultado no está disponible.')


def post(handler):
    if not handler.local_request():return
    if not handler.headers.get('Origin'):
        # The native worker has no browser Origin. Its private provider proxy
        # uses a separate unguessable bridge token and accepts no desktop action.
        if urlsplit(handler.path).path!='/api/computer/provider':
            handler.error(403,'computer_origin','Usa la ventana de Brivany.');return
    try:
        if urlsplit(handler.path).path=='/api/computer/media-input':
            from .media_inputs import receive
            handler.send_json(201,receive(handler,service(handler)));return
        if urlsplit(handler.path).path in {'/api/computer/media-inputs/clear','/api/computer/media-inputs/remove'}:
            current=service(handler)
            if not current.native:raise PermissionError()
            length=int(handler.headers.get('Content-Length','0'))
            if not 0<length<=512 or handler.headers.get('Transfer-Encoding') or handler.headers.get_content_type()!='application/json':raise ValueError()
            body=json.loads(handler.rfile.read(length))
            if urlsplit(handler.path).path.endswith('/clear'):
                if body!={}:raise ValueError()
                with current.lock:current.edits_inputs=[]
            else:
                if not isinstance(body,dict) or set(body)!={'ids'} or not isinstance(body['ids'],list) or len(body['ids'])>8 or not all(isinstance(item,str) for item in body['ids']):raise ValueError()
                from .media_inputs import take_selection
                take_selection(current,body['ids'])
            handler.send_json(200,{'selected':[]});return
        length=int(handler.headers.get('Content-Length','0'))
        maximum=2300000 if urlsplit(handler.path).path=='/api/computer/references' else 2000000 if urlsplit(handler.path).path=='/api/computer/provider' else 65536
        if not 0<length<=maximum or handler.headers.get('Transfer-Encoding') or handler.headers.get_content_type()!='application/json':raise ValueError()
        body=json.loads(handler.rfile.read(length));current=service(handler);route=urlsplit(handler.path).path
        if route=='/api/computer/provider':
            handler.send_json(200,current.proxy(body,handler.headers.get('X-Brivany-Bridge')));return
        token=handler.headers.get('X-Brivany-Control')
        if route in {'/api/computer/references','/api/computer/references/remove'}:
            if not current.native:raise PermissionError()
            if route.endswith('/remove'):
                if set(body)!={'id'} or not isinstance(body['id'],str):raise ValueError()
                current.remove_reference(body['id']);handler.send_json(200,{'removed':True});return
            if set(body)!={'data_url'}:raise ValueError()
            handler.send_json(201,current.references.add(body['data_url']));return
        if route not in {'/api/computer/image-turn','/api/computer/chat-turn'}:current.require(token)
        if route=='/api/computer/execute-prepared':
            if set(body)!={'ticket'} or not isinstance(body['ticket'],str):raise ValueError()
            handler.send_json(202,{'job':current.execute_prepared(body['ticket'],token)});return
        if route=='/api/computer/jobs':
            if set(body)!={'kind','goal'}:raise ValueError()
            handler.send_json(202,{'job':current.enqueue(body['kind'],body['goal'],token)});return
        if route=='/api/computer/cancel':
            if set(body)!={'id'}:raise ValueError()
            handler.send_json(200,{'job':current.cancel(body['id'])});return
        if route=='/api/computer/review':
            if set(body)!={'id'}:raise ValueError()
            handler.send_json(200,{'job':current.review(body['id'])});return
        if route in {'/api/computer/event-activate','/api/computer/event-cancel'}:
            if set(body)!={'id'}:raise ValueError()
            handler.send_json(200,{'event':current.events.activate(body['id']) if route.endswith('activate') else current.events.cancel(body['id'])});return
        if route=='/api/computer/personal-execute':
            if set(body)!={'id'}:raise ValueError()
            handler.send_json(200,current.execute_personal(body['id'],token));return
        if route=='/api/computer/disarm':
            if body!={}:raise ValueError()
            handler.send_json(200,current.disarm());return
        if route in {'/api/computer/turn','/api/computer/image-turn','/api/computer/chat-turn'}:
            value=(ImageTurnRequest if route.endswith('image-turn') else ConversationRequest).model_validate(body);cancelled=threading.Event()
            monitor_done=threading.Event()
            def observe_disconnect():
                while not monitor_done.wait(.05):
                    try:
                        readable,_,_=select.select([handler.connection],[],[],0)
                        if readable and not handler.connection.recv(1,socket.MSG_PEEK):cancelled.set();return
                    except (OSError,ValueError):cancelled.set();return
            threading.Thread(target=observe_disconnect,daemon=True).start()
            handler.close_connection=True
            handler.send_headers(200,'application/x-ndjson; charset=utf-8')
            try:
                events=current.image_turn(value,token,cancelled) if route.endswith('image-turn') else current.chat_turn(value,token,cancelled) if route.endswith('chat-turn') else current.turn(value,token,cancelled)
                for event in events:
                    handler.wfile.write((json.dumps(event,ensure_ascii=False)+'\n').encode());handler.wfile.flush()
            except (BrokenPipeError,ConnectionResetError):cancelled.set()
            except Exception:
                event={'type':'error','message':'No pude preparar esa tarea. Revisa el panel de control; no la repetiré automáticamente.'}
                try:handler.wfile.write((json.dumps(event)+'\n').encode());handler.wfile.flush()
                except OSError:cancelled.set()
            finally:monitor_done.set()
            return
        handler.error(404,'computer_missing','Ruta no disponible.')
    except ComputerRequestError as error:handler.error(error.status,error.code,str(error))
    except PermissionError:handler.error(403,'computer_grant','Activa el control desde la ventana nativa.')
    except (ValueError,TypeError,KeyError) as error:handler.error(422,'computer_request',str(error)[:400] if urlsplit(handler.path).path=='/api/computer/media-input' else 'Revisa la solicitud y la tarea activa.')
    except OSError:handler.error(503,'computer_runtime','El ejecutor no está disponible.')
