"""Explicit real Melodi chat -> tool -> model-authored story, never a fixture plan."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import shutil
import time
from packages.providers.conversation import ConversationRequest
from services.computer.service import ComputerService
from services.h1.server import load_local_config

ROOT=Path(__file__).resolve().parents[1]
REFERENCE=Path('C:/Users/felix/Documents/TRABAJOS/VETSA INTELLIGENCE/BRIVANY/VIDEO 3/Brivany-Que-es-Brivany.mp4')
CAPTURE=Path('C:/Users/felix/AppData/Local/Temp/codex-clipboard-f1f5a4bb-190f-4319-88eb-f6c9d93f9a2a.png')
BANNER=ROOT/'Exports/Identidades-Canal-20261109/Banner-YouTube-Brivany-Vetsa-Cognira-2560x1440.png'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');parser.add_argument('--illustration',action='store_true');parser.add_argument('--revision',action='store_true');parser.add_argument('--edit-only',action='store_true');parser.add_argument('--polish',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('--run confirma uso real de Meta y Cartesia; importe no medido.')
    load_local_config()
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    root=ROOT/'.local/melodi-story-real'
    output=ROOT/'Exports'/('Melodi-Creadora-'+stamp);output.mkdir(parents=True)
    service=ComputerService('http://127.0.0.1:1',lambda:None,root=root,native=True)
    report={'mode':'real_Melodi_chat_and_model_authored_scene_graph','started_utc':datetime.now(timezone.utc).isoformat(),'passed':False,'handwritten_demo_plan':False,'billing_amount':None,'published':False,'results':[]}
    def execute(text,selection):
        service.select_edits_inputs([str(x) for x in selection]) if selection else setattr(service,'edits_inputs',[])
        events=list(service.chat_turn(ConversationRequest(text=text,consent=True),token))
        prepared=next((e for e in events if e.get('type')=='reference_action'),None)
        if not prepared:raise ValueError('Melodi no preparó la acción solicitada.')
        report.setdefault('routes',[]).append(prepared['kind'])
        job=service.execute_prepared(prepared['ticket'],token)
        last=None;deadline=time.monotonic()+1400
        while time.monotonic()<deadline:
            current=service.jobs[job['id']]
            if current['phase']!=last:print(current['phase'],flush=True);last=current['phase']
            if current['state'] not in {'queued','planning','running','reviewing'}:break
            time.sleep(.35)
        if current['state']!='succeeded':raise ValueError(current.get('error') or current['phase'])
        candidates=[j for j in service.jobs.values() if j['kind']=='motion' and j['state']=='succeeded' and (j['id']==job['id'] or j.get('parent_id')==job['id'])]
        if not candidates:raise ValueError('El encargo no produjo una creación de motion.')
        result=candidates[-1]['result']
        if result.get('creator')!='Melodi' or result.get('authorship',{}).get('handwritten_demo_script') is not False:raise ValueError('No se acreditó la autoría de Melodi.')
        report['results'].append({'job_id':candidates[-1]['id'],'external_model_calls':candidates[-1]['external_calls'],'result':result})
        return result
    try:
        token=service.arm()['token']
        if args.polish:
            result=execute('Rediseña la composición de tu último video para que tenga el acabado editorial de la guía de Brivany. Conserva EXACTAMENTE su guion, narraciones, textos, duración de 15 segundos, escenas, película, música e intervalos. Cambia sólo tamaños y colocación: una ilustración protagonista debe llenar entre el 65 y el 80 por ciento del ancho; evita iconos diminutos flotando y espacio vacío excesivo. Los objetos deben relacionarse visualmente. La tarjeta blanca sobre cine debe ser compacta y ajustarse al titular, sin un gran rectángulo casi vacío. Mantén márgenes seguros y jerarquía. Tú decides el diseño final, sin agregar decoraciones geométricas ni texto nuevo.',[])
        elif args.edit_only:
            result=execute('Continúa el proyecto de video anterior que no pudo exportarse. Corrige las tildes y signos de interrogación de tus textos y elimina frases de relleno. Conserva exactamente los 15 segundos, el guion narrado, las escenas, la película, la música y sus intervalos. Exporta el video. No añadas locución nueva si ya la tienes; reutiliza tus archivos anteriores.',[])
        elif args.illustration:
            request=('Crea una ilustración vectorial editorial para una historia de Instagram a partir de la captura del canal de YouTube adjunta. '
                     'Usa la guía de Brivany: blanco, tinta, azul y Melodi con volumen suave. Reinterpreta la tarjeta del canal con buen diseño, no pegues toda la captura. '
                     'Incluye las tres identidades del banner adjunto: Brivany, Vetsa IA y Cognira. Nunca debe verse Desktop Master ni Master. '
                     'Mantén el nombre Daniel Luna y el usuario @lunawork_s; no inventes cifras, no correos ni textos decorativos. Decide tú la composición y el texto breve. '
                     'Usa tu creador motion para entregar el PNG, sin voz.')
            result=execute(request,[CAPTURE,BANNER])
        else:
            request=('Crea con tu herramienta motion un video educativo de 15 segundos para Instagram sobre qué es Brivany y la traducción auditiva. '
                     'Analiza el video adjunto como referencia de ritmo y diseño. Escribe tú el guion, los textos, las escenas y su montaje; '
                     'no copies un video terminado ni una plantilla de dos frases. Usa ilustraciones cuidadas, escenas de una película de tu catálogo y música diferente a Origami y Neon. '
                     'Con voz de Melodi. No vendas directamente ni incluyas correos; respeta la guía de Brivany y los créditos al final. '
                     'Elige tú la película, la música, los encuadres y el mensaje. Debe durar exactamente 15 segundos incluyendo créditos.')
            result=execute(request,[REFERENCE])
            if abs(result['duration']-15)>.05:raise ValueError('No mantuvo los 15 segundos.')
            if args.revision:
                result=execute('Reformula el último titular de tu video anterior para hacerlo más claro. Elige tú las nuevas palabras. Conserva su duración de 15 segundos, las demás escenas, la película y la música.',[])
        source=Path(result['path']);target=output/('Melodi-Historia-Instagram.png' if args.illustration else 'Melodi-Creo-Este-Video-15s.mp4')
        shutil.copyfile(source,target);shutil.copyfile(Path(result['evidence_folder'])/'story.json',output/'Plan-creado-por-Melodi.json')
        shutil.copyfile(Path(result['evidence_folder'])/'CREDITS.md',output/'Creditos.md')
        report.update(passed=True,delivery_path=str(target),model_calls_total=sum(j['external_calls'] for j in service.jobs.values()))
    except Exception as error:
        report['error']=str(error);print('ERROR:',str(error),flush=True)
    finally:
        service.close();(output/'prueba-real.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'passed':report['passed'],'path':report.get('delivery_path'),'report':str(output/'prueba-real.json'),'error':report.get('error')},ensure_ascii=False),flush=True)
    return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
