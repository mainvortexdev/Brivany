"""Opt-in paid, real Paint test. Creates a new drawing; never records user media."""
import argparse
import base64
import json
from pathlib import Path
import threading
from datetime import datetime,timezone
from desktop.experience.launcher import experience_handler
from desktop.launcher import LocalDesktopServer
from services.h1.server import Handler,load_local_config
from services.computer.service import ComputerService

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description='Prueba real con Paint; consume planificación Meta, sin reintentos de tarea.')
    parser.add_argument('--allow-paid',action='store_true',required=True)
    args=parser.parse_args();load_local_config()
    directory=ROOT/'tmp/computer-paint-real';directory.mkdir(parents=True,exist_ok=True)
    report={'scope':'real Paint; native Cognira executors through Brivany adapter','synthetic_drawing':True,
            'started_at':datetime.now(timezone.utc).isoformat(),'steps':[], 'cost_amount':None,'physical_quality_verified':False}
    with LocalDesktopServer(handler=experience_handler(Handler)) as server:
        server.http.computer_lock=threading.RLock()
        current=ComputerService(server.base_url,lambda:None,native=True);server.http.computer=current
        current.runtime.diagnostics=True
        token=current.arm()['token'];job={'id':'real-paint-fixture','kind':'desktop','state':'running','phase':'Prueba Paint',
            'steps':0,'result':None,'error':None,'external_calls':0,'goal':'Dibujo sintético en ventana nueva de Paint',
            'cancelled':threading.Event(),'grant':token}
        current.jobs[job['id']]=job
        try:
            opened=current.runtime.call('execute',step={'action':'launch_app','params':{'app':'Paint, nueva ventana para dibujar una prueba'}},roots=list(current.roots),cancelled=job['cancelled'],timeout=60)
            if not opened.get('windowHandle') or opened.get('reused'):raise ValueError('No se confirmó una nueva ventana de Paint.')
            report['steps'].append({'action':'launch_app','verified':bool(opened.get('verified'))})
            instruction='Dibuja una ilustración sencilla y clara de una casa con tejado rojo, puerta azul y dos ventanas; a su lado un árbol de copa verde, arriba un sol amarillo y dos nubes. Usa los pinceles o lápiz y los colores de Paint. Distribuye el dibujo completo dentro del lienzo blanco. Es una prueba sintética nueva; no incluyas texto. Al menos 12 elementos visuales: cielo, sol, rayos, nubes, tronco, copa, casa, tejado, puerta, ventanas, césped y sendero.'
            result=current.runtime.call('execute',step={'action':'draw_paint','params':{'instruction':instruction}},roots=list(current.roots),cancelled=job['cancelled'],timeout=180)
            report['steps'].append({'action':'draw_paint',**result})
            capture=current.runtime.call('paint_snapshot',handle=opened['windowHandle'],timeout=20)
            (directory/'paint-result.png').write_bytes(base64.b64decode(capture.pop('png_base64'),validate=True))
            report.update(status='passed',capture=capture,visual_review_pending=True)
        except Exception as error:
            report.update(status='failed',failure=str(error),visual_review_pending=True)
        finally:
            report.update(finished_at=datetime.now(timezone.utc).isoformat(),planner_requests=job['external_calls'],external_cost_unknown=True,
                          native_diagnostics=current.runtime.diagnostic_events,
                          limits=['No semantic or artistic quality claim from stroke count.','No inference retries at task level; source Paint helper may correct a structured response.','Only the new Paint drawing is captured; no original user image.'])
            job['state']='succeeded' if report['status']=='passed' else 'failed';current.close()
            (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
