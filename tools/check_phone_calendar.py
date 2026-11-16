"""Calendar readiness audit through both telephone audio session formats.

Synthetic ASR, Meta replies and PCM replace every remote provider. This is an
audit of application routing, not a claim about real model/tool selection or
human hearing. A completed audit exits 1 while calendar calling is unavailable.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import queue
import threading
import time
from unittest.mock import patch
from uuid import uuid4

from services.integrations import OPERATIONS
from services.telephony.realtime import LivePhoneSession, LiveProviders
from tests.test_telephony_realtime import SyntheticMuse, SyntheticSpeech

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = (
    ('consultar', 'Consulta mi agenda del nueve de noviembre.'),
    ('agendar', 'Agenda una cita de una hora el nueve de noviembre a las diez.'),
    ('buscar_hueco', 'Busca una hora libre mañana por la tarde.'),
    ('hacer_espacio', 'Haz espacio mañana por la mañana para una cita de una hora.'),
    ('reorganizar', 'Organiza mis citas de mañana para dejar la tarde libre.'),
    ('desplazar', 'Desplaza la cita de mañana de las diez a las once.'),
)


def until(predicate):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.005)
    raise RuntimeError('El recorrido sintético de agenda no terminó.')


class Socket:
    """Only local JSON queues; acknowledged marks represent transport delivery."""
    def __init__(self):
        self.events = queue.Queue()
        self.audio_packets = 0
        self.closed = False
        self.sequence = 0

    def receive_event(self, event):
        self.sequence += 1
        self.events.put(json.dumps({**event, 'sequenceNumber': str(self.sequence)}))

    def send(self, raw):
        event = json.loads(raw)
        if event['event'] == 'mark':
            self.receive_event(event)
        if event['event'] == 'media':
            self.audio_packets += 1

    def recv(self, timeout=.25):
        try:
            return self.events.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError() from None

    def close(self):
        self.closed = True


class Providers(LiveProviders):
    """Preserve the production sentences() method, substitute ASR and TTS."""
    def __init__(self):
        self.muse = SyntheticMuse()
        self.spoken = []
        self.block_tts = False

    def listen(self):
        return self.muse

    def speak(self, text):
        self.spoken.append(text)
        return SyntheticSpeech(self)


def route(audio_format):
    observed = []

    def meta(request, **kwargs):
        # Do not write prompts, transcripts or generated speech to the report.
        observed.append({'tool_context': sorted((kwargs.get('context') or {}).keys()),
                         'declares_no_tools': 'no tienes herramientas' in kwargs['instructions']})
        yield {'type': 'sentence', 'text': 'Respuesta sintética del recorrido de agenda.'}
        yield {'type': 'done', 'text': 'Respuesta sintética del recorrido de agenda.'}

    socket, providers = Socket(), Providers()
    session = LivePhoneSession(socket, 'synthetic-calendar-audit',
        'Auditar acceso a la agenda con datos sintéticos.', threading.Event(),
        providers, max_seconds=30, audio_format=audio_format)
    with patch('packages.providers.conversation.stream_reply', side_effect=meta), \
         patch('services.integrations.IntegrationService.propose') as propose, \
         patch('services.integrations.IntegrationService.execute') as execute, \
         patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('Red externa prohibida')):
        worker = threading.Thread(target=session.run, daemon=True)
        worker.start()
        try:
            until(lambda: len(providers.spoken) == 1 and session.current is None)
            for number, (_, text) in enumerate(SCENARIOS, 1):
                providers.muse.utterance(number, text)
                until(lambda: session.metrics['completed_turns'] == number)
            socket.receive_event({'event': 'stop', 'streamSid': session.stream_id})
            worker.join(4)
            if worker.is_alive() or session.metrics['failed'] or len(observed) != len(SCENARIOS):
                raise RuntimeError('Falló el transporte del recorrido sintético.')
            return {'audio_format': audio_format, 'synthetic_turns_completed': len(observed),
                    'synthetic_audio_packets': socket.audio_packets,
                    'proposal_dispatches': propose.call_count, 'execution_dispatches': execute.call_count,
                    'all_turns_declare_no_tools': all(item['declares_no_tools'] for item in observed),
                    'model_context_keys': sorted({key for item in observed for key in item['tool_context']}),
                    'private_calendar_context_supplied': False,
                    'calendar_access_observed': bool(propose.call_count or execute.call_count)}
        finally:
            session.close()
            worker.join(4)


def main():
    routes = [route('pcm_24000')]
    detected = any(item['calendar_access_observed'] for item in routes)
    # Dispatch alone cannot certify successful reads, event changes or scoped
    # permission. If a future bridge appears, expand this audit before declaring
    # it ready instead of treating a proposal as a completed calendar action.
    ready = None if detected else False
    report = {'mode': 'simulated_phone_calendar_readiness_audit',
              'audit_completed': True, 'ready_for_calendar_calls': ready,
              'routes': routes, 'scenario_names': [name for name, _ in SCENARIOS],
              'registered_calendar_operations': sorted(key for key in OPERATIONS if key.startswith('calendar.')),
              'public_calls': 0, 'calendar_api_requests': 0, 'paid_ai_requests': 0,
              'limitations': ['Synthetic recognition, model output and speech; no real model semantics or latency validated.',
                             'Transport exercised in memory; actual SIP/RTP covered by the telephony-sip suite (Telnyx).',
                             'No calendar account state, consent or actual calendar event changes tested.']}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
    path = ROOT / 'tmp/verification' / ('phone-calendar-audit-' + stamp + '-' + uuid4().hex[:8] + '.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print('Informe: ' + str(path.relative_to(ROOT)))
    return 2 if detected else 1


if __name__ == '__main__':
    raise SystemExit(main())
