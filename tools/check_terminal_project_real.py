"""Authorized end-to-end project task through Melodi's real planner and queue."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import time
from packages.providers.conversation import ConversationRequest
from services.h1.server import load_local_config
from services.computer.runtime import ROOT
from services.computer.service import ComputerService

GOAL=('Clona https://github.com/mainvortexdev/ProjectFixture-Trading-Operator y arranca su servidor local en una copia de trabajo, sin modificar ni publicar el repositorio original. '
      'Detecta el IDE instalado y abre la copia en Antigravity. Abre la web y haz una captura de pantalla. Crea en el Escritorio la carpeta Evidencia Melodi y guarda ahí la captura. '
      'Abre Bloc de notas, escribe las acciones realizadas y guarda el archivo TXT en Evidencia Melodi. No hagas trading ni uses credenciales financieras. No cambies el registro ni eludas UAC.')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');parser.add_argument('--keep-open',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('La prueba real requiere --run; puede usar Meta e instalar dependencias.')
    load_local_config();directory=ROOT/'tmp/terminal-project-real';directory.mkdir(exist_ok=True)
    started=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    service=ComputerService('http://127.0.0.1:1',lambda:None,root=ROOT/'.local/terminal/computer-test',native=True)
    service.runtime.diagnostics=True
    report={'type':'real_melodi_project_task','success':False,'route_model_calls':0,'provider_cost':'unknown'}
    try:
        route=service.planner.route(ConversationRequest(text=GOAL,consent=True));report['route_model_calls']=1
        if route['kind']!='terminal':raise ValueError('El planificador no eligió el especialista de terminal: '+route['kind'])
        token=service.arm()['token'];job=service.enqueue('terminal',GOAL,token);report['job_id']=job['id']
        deadline=time.monotonic()+720;last=None
        while time.monotonic()<deadline:
            value=service.jobs[job['id']]
            if value['phase']!=last:print(value['phase'],flush=True);last=value['phase']
            if value['finished'].wait(.5):break
        value=service.jobs[job['id']];result=value.get('result') or {}
        fulfilled=all((result.get('server_health_verified'),result.get('source_preserved'),result.get('capture',{}).get('verified'),result.get('notes',{}).get('file_content_verified')))
        report.update(job=service.public(value),success=value['state']=='succeeded' and fulfilled)
        if not report['success']:raise ValueError('Tarea sin terminar: '+str(value.get('error') or value['phase']))
    except Exception as error:
        report['error']=str(error)
        raise
    finally:
        raw=json.dumps(report,ensure_ascii=False,indent=2)
        (directory/('result-'+started+'.json')).write_text(raw,encoding='utf-8');(directory/'latest.json').write_text(raw,encoding='utf-8')
        print(raw,flush=True)
        if args.keep_open and report['success']:
            print('Servidor y navegador conservados. Cerrar este proceso termina sus recursos.',flush=True)
            try:
                while True:time.sleep(1)
            except KeyboardInterrupt:pass
        service.close()


if __name__=='__main__':main()
