"""Dedicated loopback HTTP + WebSocket listener for a public HTTPS tunnel."""
import asyncio
import hmac
import json
import logging

from aiohttp import web, WSMsgType
from .call_control import CallControl, TERMINAL, valid_signature
from .common import ProviderError, TelephonyError
from .realtime import LivePhoneSession
from .telnyx_media import TelnyxMediaTransport


def create_app(calls, providers_factory=None):
    @web.middleware
    async def protect(request, handler):
        try:
            if request.path.startswith('/api/'):
                values = request.headers.getall('Authorization', [])
                if (len(values) != 1 or request.headers.get('Origin') is not None
                        or not hmac.compare_digest(values[0].encode(), ('Bearer ' + calls.config.token).encode())):
                    return web.json_response({'error': 'Acceso no autorizado.'}, status=401)
            response = await handler(request)
        except PermissionError:
            response = web.json_response({'error': 'Firma o sesión no válida.'}, status=401)
        except ProviderError as error:
            response = web.json_response({'error': str(error), 'provider_code': error.provider_code,
                                          'uncertain': error.uncertain}, status=502)
        except (TelephonyError, ValueError, TypeError, KeyError):
            response = web.json_response({'error': 'Solicitud no válida.'}, status=422)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    app = web.Application(middlewares=[protect], client_max_size=65536)

    async def body(request):
        if request.content_type != 'application/json':
            raise TelephonyError('Se requiere JSON.')
        def unique(pairs):
            result = dict(pairs)
            if len(result) != len(pairs):
                raise ValueError('Campos duplicados.')
            return result
        return json.loads(await request.read(), object_pairs_hook=unique)

    async def health(request):
        return web.json_response({'service': 'melodi-telnyx-call-control', 'ready': not calls.closed.is_set()})

    async def info(request):
        return web.json_response(calls.info())

    async def outbound(request):
        value = await body(request)
        result = await asyncio.to_thread(calls.start, value)
        return web.json_response(result, status=202)

    async def status(request):
        return web.json_response(calls.status(request.match_info['identifier']))

    async def cancel(request):
        if await body(request) != {}:
            raise TelephonyError('Cancelación no válida.')
        return web.json_response(await asyncio.to_thread(calls.cancel, request.match_info['identifier']))

    def signatures(request):
        signature = request.headers.getall('telnyx-signature-ed25519', [])
        timestamp = request.headers.getall('telnyx-timestamp', [])
        if len(signature) != 1 or len(timestamp) != 1:
            raise PermissionError()
        return signature[0], timestamp[0]

    async def webhook(request):
        if request.content_type != 'application/json':
            raise TelephonyError('Se requiere JSON.')
        signature, timestamp = signatures(request)
        # All provider actions run in the worker, after this durable acceptance.
        accepted = calls.receive(await request.read(), signature, timestamp)
        return web.json_response({'received': True, 'accepted': accepted})

    async def media(request):
        identifier, capability = request.match_info['identifier'], request.match_info['capability']
        expected = calls.media_url(identifier)
        signature, timestamp = signatures(request)
        if request.query_string or not valid_signature(calls.config.verification_key, expected.encode(), signature, timestamp):
            raise PermissionError()
        runtime = calls.media_runtime(identifier, capability)
        ws = web.WebSocketResponse(max_msg_size=16384, heartbeat=20)
        await ws.prepare(request)
        loop, transport, task, stream_id = asyncio.get_running_loop(), None, None, None

        def converse(adapter):
            kwargs = {'max_turns': None, 'audio_format': 'telnyx_pcm_24000', 'safety': runtime.safety}
            if providers_factory:
                kwargs['providers'] = providers_factory()
            session = LivePhoneSession(adapter, adapter.stream_id, runtime.objective, runtime.ended, **kwargs)
            try:
                session.run()
            finally:
                values = {'metrics': json.dumps({**session.metrics, **adapter.metrics})}
                if session.metrics.get('end_reason'):
                    values['end_reason'] = session.metrics['end_reason']
                elif session.metrics['failed']:
                    values['end_reason'] = 'communication_failed'
                    values['error'] = 'No se pudo mantener la comunicación de voz; se ha solicitado colgar.'
                calls._update(identifier, **values)
                calls.action(identifier, 'hangup')
                runtime.ended.set()

        try:
            while not runtime.ended.is_set():
                message = await asyncio.wait_for(ws.receive(), timeout=12 if transport is None else 30)
                if message.type != WSMsgType.TEXT:
                    break
                event = json.loads(message.data)
                if not isinstance(event, dict):
                    raise TelephonyError('Evento no válido.')
                if event.get('event') == 'connected' and transport is None:
                    continue
                if event.get('event') == 'start' and transport is None:
                    start = event.get('start') or {}
                    with calls.lock:
                        control = calls.db.execute('SELECT control_id FROM cc_calls WHERE id=?', (identifier,)).fetchone()[0]
                    fmt = start.get('media_format') or {}
                    stream_id = event.get('stream_id')
                    if (start.get('call_control_id') != control or not isinstance(stream_id, str) or not 1 <= len(stream_id) <= 128
                            or fmt != {'encoding': 'PCMU', 'sample_rate': 8000, 'channels': 1}):
                        raise TelephonyError('Formato o identidad del stream no válidos.')
                    transport = TelnyxMediaTransport(ws, loop, 'telnyx-' + identifier)
                    runtime.media = transport
                    task = asyncio.create_task(asyncio.to_thread(converse, transport))
                elif transport:
                    if event.get('stream_id', stream_id) != stream_id:
                        raise TelephonyError('Identidad de stream no válida.')
                    transport.feed(event)
                    if event.get('event') == 'stop':
                        break
                else:
                    raise TelephonyError('Se esperaba el inicio del stream.')
        except (ValueError, KeyError, TelephonyError, TimeoutError):
            calls._update(identifier, error='El stream telefónico terminó o no pasó su validación.')
        finally:
            if transport:
                transport.closed.set()
            await ws.close()
            if task:
                try:
                    await asyncio.wait_for(asyncio.shield(task), timeout=25)
                except TimeoutError:
                    runtime.ended.set()
            else:
                await asyncio.to_thread(calls.action, identifier, 'hangup')
        return ws

    async def shutdown(app):
        calls.closed.set()
        for identifier, runtime in list(calls.runtime.items()):
            if not runtime.ended.is_set():
                await asyncio.to_thread(calls.cancel, identifier)
            if runtime.media:
                await runtime.media.websocket.close()

    async def cleanup(app):
        await asyncio.to_thread(calls.close)

    app.router.add_get('/health', health)
    app.router.add_get('/api/calls/info', info)
    app.router.add_post('/api/calls/outbound', outbound)
    app.router.add_get('/api/calls/{identifier}', status)
    app.router.add_post('/api/calls/{identifier}/hangup', cancel)
    app.router.add_post('/webhooks/telnyx', webhook)
    app.router.add_get('/media/telnyx/{identifier}/{capability}', media)
    app.on_shutdown.append(shutdown)
    app.on_cleanup.append(cleanup)
    return app
