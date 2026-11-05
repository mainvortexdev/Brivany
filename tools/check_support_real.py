"""Official Epson PDF and real Melodi routing/answer, without installing drivers."""
import argparse
from datetime import datetime,timezone
import json
import time
from services.computer.runtime import ROOT
from services.computer.service import ComputerService
from services.h1.server import load_local_config
from packages.providers.conversation import ConversationRequest


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('Consulta Meta y un manual público; requiere --run.')
    load_local_config();service=ComputerService('http://127.0.0.1:1',lambda:None,root=ROOT/'.local/support-real/computer',native=True)
    goal='Busca y lee el manual oficial de mi impresora Epson L3250 y explica cómo escanear usando los botones de la propia impresora. Incluye las páginas que hayas leído.'
    report={'type':'real_melodi_official_documentation','provider_cost':'unknown','started_at':datetime.now(timezone.utc).isoformat(),'success':False,'drivers_installed':False}
    folder=ROOT/'tmp/support-real';folder.mkdir(exist_ok=True)
    try:
        route=service.planner.route(ConversationRequest(text=goal,consent=True));report['route_calls']=1
        if route['kind']!='support':raise ValueError('Ruta incorrecta: '+route['kind'])
        token=service.arm()['token'];job=service.enqueue('support',goal,token);value=service.jobs[job['id']];last=None;deadline=time.monotonic()+240
        while time.monotonic()<deadline:
            if value['phase']!=last:print(value['phase'][:180],flush=True);last=value['phase']
            if value['finished'].wait(.5):break
        report['job']=service.public(value);report['success']=value['state']=='succeeded' and bool((value.get('result') or {}).get('sources'))
        if not report['success']:raise ValueError(value.get('error') or value['phase'])
    except Exception as error:report.update(error_type=type(error).__name__,error=str(error));raise
    finally:
        (folder/'manual-latest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False,indent=2));service.close()


if __name__=='__main__':main()
