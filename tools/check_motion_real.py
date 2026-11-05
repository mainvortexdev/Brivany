"""Two explicit, real Melodi chat plans and locally rendered promotional MP4s."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import shutil
import time
from uuid import uuid4
from packages.providers.conversation import ConversationRequest
from services.computer.service import ComputerService
from services.h1.server import load_local_config

ROOT=Path(__file__).resolve().parents[1]
REQUESTS=[
 ('workspace','Crea un video promocional de Brivany con Bang Motion, estilo workspace, de 24 segundos a 30 fps. Presenta a Melodi WorkSpace, una petición por voz que crea un video y permite continuar hablando. Usa Georgia con Segoe UI, suavidad, la marca Brivany y textos breves en español. Sin música ni locución en esta primera prueba.'),
 ('spatial','Crea otro video promocional de Brivany totalmente diferente con Bang Motion, estilo spatial, 24 segundos a 30 fps. Una idea pasa a plano y habitación conceptual 3D, las paredes crecen y los muebles se ensamblan. No uses interfaz de chat ni una lista de funciones. Georgia con Segoe UI, azul tinta, luz satinada, español breve. Sin música ni locución en esta primera prueba.')]


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('Usa --run: realiza dos planificaciones de ruta y dos planes creativos reales, importe desconocido.')
    load_local_config()
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    root=ROOT/'.local/motion-first-presentation'/stamp
    computer=ComputerService('http://127.0.0.1:1',lambda:None,root=root,native=True)
    report={'type':'real_Melodi_chat_and_motion_renderer','recorded_utc':datetime.now(timezone.utc).isoformat(),'passed':False,'router_calls':0,'creative_plans':0,'billing_amount':None,'microphone_tested':False,'voice_audio_tested':False,'native_gui_input':False,'videos':[]}
    output=ROOT/'Exports'/('Brivany-promos-'+stamp);output.mkdir(parents=True)
    began=time.monotonic()
    try:
        token=computer.arm()['token']
        for expected,request in REQUESTS:
            report['router_calls']+=1
            events=list(computer.chat_turn(ConversationRequest(text=request,consent=True),token))
            prepared=next((event for event in events if event.get('type')=='reference_action'),None)
            if not prepared or prepared['kind']!='motion':raise ValueError('El router no eligió el creador de animaciones.')
            job=computer.execute_prepared(prepared['ticket'],token)
            print(json.dumps({'job_id':job['id'],'style':expected,'state':'started'}),flush=True)
            current=computer.jobs[job['id']];last=None;end=time.monotonic()+950
            while current['state'] in {'queued','planning','running'} and time.monotonic()<end:
                if current['phase']!=last:print(current['phase'],flush=True);last=current['phase']
                time.sleep(.3)
            report['creative_plans']+=current['external_calls']
            if current['state']!='succeeded':raise ValueError(current.get('error') or current['phase'])
            result=current['result']
            if result['style']!=expected or not result['verified']:raise ValueError('No se verificó la pieza distinta solicitada.')
            name='01-A-tu-ritmo' if expected=='workspace' else '02-Hazlo-espacio'
            video=output/(name+'.mp4');html=output/(name+'.html')
            with Path(result['path']).open('rb') as source,video.open('xb') as target:shutil.copyfileobj(source,target)
            with Path(result['standalone_path']).open('rb') as source,html.open('xb') as target:shutil.copyfileobj(source,target)
            report['videos'].append({'job_id':job['id'],'planning_calls':current['external_calls'],'result':result,'delivery_path':str(video),'html_path':str(html)})
            print(json.dumps({'style':expected,'delivered':str(video),'planning_seconds':result['planning_seconds'],'render_seconds':result['render_seconds']},ensure_ascii=False),flush=True)
        assert report['videos'][0]['result']['style']!=report['videos'][1]['result']['style']
        report['passed']=True
    except Exception as error:report['error']=str(error)
    finally:
        computer.close();report['elapsed_seconds']=round(time.monotonic()-began,3)
        report['model_planning_calls']=report['router_calls']+report['creative_plans']
        directory=ROOT/'tmp/motion-real';directory.mkdir(exist_ok=True);file=directory/(stamp+'.json')
        file.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');(directory/'latest.json').write_text(file.read_text(encoding='utf-8'),encoding='utf-8')
        print(json.dumps({'passed':report['passed'],'report':str(file),'model_planning_calls':report['model_planning_calls'],'elapsed_seconds':report['elapsed_seconds'],'error':report.get('error')},ensure_ascii=False),flush=True)
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
