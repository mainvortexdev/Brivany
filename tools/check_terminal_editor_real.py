"""Real planner + installed editor launch; UI verification is recorded separately."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import threading
from uuid import uuid4
from services.h1.server import load_local_config
from services.computer.planner import MetaPlanner
from services.terminal.service import TerminalService

ROOT=Path(__file__).resolve().parents[1]
GOAL='Abre la copia de trabajo local ProjectFixture-Trading-Operator-76d4c328 en el IDE Antigravity instalado. No clones de nuevo, no ejecutes operaciones financieras y no cambies la copia de origen.'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('El ensayo real necesita --run; usa un modelo y abre el IDE instalado.')
    load_local_config();service=TerminalService(ROOT/'.local/terminal');planner=MetaPlanner();calls=0
    def decide(prompt,data):
        nonlocal calls
        calls+=1;return planner.generate(prompt,data,max_tokens=700)
    report={'type':'real_planner_editor_launch','ui_verified':False,'provider_cost':'unknown'}
    try:
        result=service.run(GOAL,decide=decide,identifier=str(uuid4()),cancelled=threading.Event(),progress=lambda text:None)
        report.update(result=result,launch_requested=result.get('editor',{}).get('launch_requested') is True)
        if not report['launch_requested']:raise ValueError('No se solicitó abrir el proyecto en un IDE.')
        project=service.local_project('ProjectFixture-Trading-Operator-76d4c328')
        receipt=service.executor.require_success(service.executor.git(['status','--porcelain'],cwd=project['source']))
        if receipt['output'].strip():raise ValueError('La copia de origen presenta cambios.')
        report.update(source_preserved=True,source_status_receipt=receipt['id'])
    finally:
        report.update(model_calls=calls,recorded_utc=datetime.now(timezone.utc).isoformat())
        directory=ROOT/'tmp/terminal-ide-real';directory.mkdir(parents=True,exist_ok=True)
        (directory/'launch.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        service.close();print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
