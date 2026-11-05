"""Editorial correction requested by the user: two narrated, authored films."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import threading
from uuid import uuid4
from services.h1.server import load_local_config
from services.motion.service import write_project

ROOT=Path(__file__).resolve().parents[1]
PLANS=[
 {'style':'workspace','title':'Tu voz, en movimiento','headline':'Tu voz, en movimiento','request':'Melodi, crea mi próximo video','payoff':'Una idea que se convierte en video','closing':'Tu próxima idea empieza aquí','duration':30,'fps':30,
  'narration':['Soy Melodi. Dime lo que imaginas.',
    'Una voz se convierte en movimiento, forma y color.',
    'Crea con Brivany y sigue con lo tuyo mientras preparo el resultado.',
    'Tu próxima idea empieza aquí. Brivany.']},
 {'style':'spatial','title':'Del trazo al espacio','headline':'Todo empieza con una idea','request':'Melodi, diseña un espacio','payoff':'Dale tu propia forma','closing':'Imagina el espacio. Créalo.','duration':30,'fps':30,
  'narration':['Todo espacio empieza con una idea.',
    'De un trazo nacen la luz, los materiales y el volumen.',
    'Explora un diseño conceptual y dale tu propia forma.',
    'Imagina el espacio. Créalo con Brivany.']}
]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('--run genera ocho frases con la voz de Melodi ya configurada; coste desconocido.')
    load_local_config();stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');root=ROOT/'.local/motion-premium'/stamp;root.mkdir(parents=True)
    report={'type':'real_Cartesia_Melodi_narration_and_editorial_composition','passed':False,'planning_calls':0,'tts_calls':0,'billing_amount':None,'microphone_recorded':False,'videos':[]}
    try:
        for plan in PLANS:
            folder=root/str(uuid4());folder.mkdir()
            print('Preparando '+plan['title'],flush=True);write_project(folder,plan,cancelled=threading.Event())
            spec=json.loads((folder/'motion.json').read_text(encoding='utf-8'));report['tts_calls']+=spec['audio']['external_calls']
            report['videos'].append({'style':plan['style'],'folder':str(folder),'voice_segments':spec['audio']['segments'],'voice_id':spec['audio']['voice_id']})
            print(json.dumps({'style':plan['style'],'folder':str(folder),'segments':spec['audio']['segments']},ensure_ascii=False),flush=True)
        report['passed']=True
    except Exception as error:report['error']=str(error)
    target=ROOT/'tmp/motion-premium';target.mkdir(exist_ok=True);file=target/(stamp+'.json');file.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');(target/'prepared.json').write_text(file.read_text(encoding='utf-8'),encoding='utf-8')
    print(json.dumps({'passed':report['passed'],'report':str(file),'tts_calls':report['tts_calls'],'error':report.get('error')},ensure_ascii=False),flush=True)
    return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
