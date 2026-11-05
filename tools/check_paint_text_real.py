"""Run the Paint regression with the live planner and an isolated workspace."""
import argparse
import json
from pathlib import Path
import time
import threading
from uuid import uuid4

from services.computer.runtime import NativeRuntime
from services.computer.service import ComputerService
from services.h1.server import load_local_config


class ObservedComputerService(ComputerService):
    def request_plan(self, job, prompt, data, **kwargs):
        result = super().request_plan(job, prompt, data, **kwargs)
        if job['kind'] == 'desktop':
            step = result.get('step')
            if isinstance(step, dict):
                self.actions.append(step.get('action') if step.get('action') in ('paint_text','launch_app','focus_window','draw_paint','write_note') else 'other')
            else:
                self.actions.append('no_step')
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-network', action='store_true')
    if not parser.parse_args().allow_network:
        parser.error('La prueba usa Meta y escribe en un cuadro nativo nuevo en Paint.')
    load_local_config()
    root = Path('tmp/paint-adaptive-real') / uuid4().hex
    runtime = NativeRuntime(root / 'workspace', proxy='http://127.0.0.1:1', token=uuid4().hex, diagnostics=True)
    service = ObservedComputerService('http://127.0.0.1:1', lambda: None, root=root, runtime=runtime, native=True)
    service.actions = []
    report = {'passed': False, 'real_paint': True, 'real_meta': True, 'billing_usd': None, 'planned_actions': service.actions, 'executor_errors': []}
    def trace(frame, event, details):
        if event == 'exception' and frame.f_code.co_name == '_run_job':
            error = details[1]
            report['executor_errors'].append({'type':type(error).__name__,'code':getattr(error,'code',None),'line':frame.f_lineno})
        return trace
    threading.settrace(trace)
    started = time.monotonic()
    try:
        token = service.arm()['token']
        request = 'Abre Paint y escribe un poema de cuatro versos sobre el boxeo. Usa su herramienta Texto y deja abierto el cuadro editable.'
        job = service.jobs[service.enqueue('orchestrator', request, token)['id']]
        if not job['finished'].wait(105):
            raise ValueError('La tarea no terminó dentro del plazo de prueba.')
        report.update(state=job['state'], phase=job['phase'])
        if job['state'] != 'succeeded':
            raise ValueError('Melodi no aprobó el resultado.')
        children = [service.jobs[identifier] for identifier in job['children']]
        assert [child['kind'] for child in children] == ['desktop']
        proof = next(row['result'] for row in children[0]['result']['receipts'] if row['action'] == 'paint_text')
        assert all(proof[key] is True for key in ('openedInPaint', 'input_sent', 'text_value_verified', 'editable_text_box'))
        assert children[0]['review']['accepted']
        observed = runtime.call('observe', timeout=25)
        window = next(row for row in observed['windows'] if row['processId']==proof['process_id'] and row['processName'].lower()=='mspaint')
        assert not list((root/'workspace').glob('*.png'))
        report.update(passed=True, paint_window_verified=True, native_input=True, editor_read_back=True,
                      editable_text_box=True, window_handle=str(window['handle']), process_id=proof['process_id'])
    except Exception as error:
        report['error'] = str(error)[:300]
    finally:
        threading.settrace(None)
        report['provider_requests'] = sum(job['external_calls'] for job in service.jobs.values())
        report['elapsed_seconds'] = round(time.monotonic() - started, 2)
        service.close()
        (root / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
        print(root / 'report.json')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
