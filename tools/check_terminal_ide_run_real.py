"""Real terminal planner and native observed IDE execution. No terminal UI typing."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import threading
from uuid import uuid4
from urllib.request import urlopen
from services.h1.server import load_local_config
from services.computer.planner import MetaPlanner
from services.computer.runtime import NativeRuntime
from services.terminal.service import TerminalService

ROOT=Path(__file__).resolve().parents[1]
GOAL='Ejecuta la copia local ProjectFixture-Trading-Operator-76d4c328 desde el depurador del IDE Antigravity instalado. Abre su workspace, inicia la configuración de Melodi y comprueba la salud HTTP. No clones de nuevo, no cambies el original, no uses trading ni credenciales externas.'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('Requiere --run: usa un modelo y el IDE real.')
    load_local_config();service=TerminalService(ROOT/'.local/terminal');planner=MetaPlanner();calls=0
    runtime=NativeRuntime(ROOT/'.local/terminal/ide-native',proxy='http://127.0.0.1:1',token=str(uuid4()),diagnostics=True)
    report={'type':'real_planner_native_IDE_execution','success':False,'provider_cost':'unknown'}
    def decide(prompt,data):
        nonlocal calls
        calls+=1;return planner.generate(prompt,data,max_tokens=800)
    try:
        result=service.run(GOAL,decide=decide,identifier=str(uuid4()),cancelled=threading.Event(),progress=lambda text:print(text,flush=True),runtime=runtime)
        report['result']=result
        if not result.get('verification',{}).get('execution_in_ide_verified'):raise ValueError('El ensayo no acredita ejecución desde el IDE.')
        with urlopen(result['verification']['url']+'/api/health',timeout=3) as response:
            if response.headers.get('X-Melodi-Run')!=result['editor']['run_configuration']['proof'] or json.load(response).get('status')!='healthy':raise ValueError('La segunda lectura de salud no coincide.')
        project=service.local_project('ProjectFixture-Trading-Operator-76d4c328')
        source=service.executor.require_success(service.executor.git(['status','--porcelain'],cwd=project['source']))
        if source['output'].strip():raise ValueError('El origen tiene cambios.')
        report.update(success=True,source_preserved=True,source_status_receipt=source['id'])
    except Exception as error:
        report['error']=str(error);raise
    finally:
        report.update(model_calls=calls,recorded_utc=datetime.now(timezone.utc).isoformat())
        directory=ROOT/'tmp/terminal-ide-real';directory.mkdir(parents=True,exist_ok=True)
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
        raw=json.dumps(report,ensure_ascii=False,indent=2);(directory/('native-'+stamp+'.json')).write_text(raw,encoding='utf-8');(directory/'native-latest.json').write_text(raw,encoding='utf-8')
        runtime.close();service.close();print(raw,flush=True)


if __name__=='__main__':main()
