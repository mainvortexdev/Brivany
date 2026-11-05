"""Capture the verified IDE preview through Melodi's existing native API."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
from uuid import uuid4
from services.computer.runtime import NativeRuntime
from services.terminal.evidence import evidence_directory

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('Requiere --run; abre la web local verificada y guarda una captura nueva.')
    task=json.loads((ROOT/'tmp/terminal-ide-real/native-latest.json').read_text(encoding='utf-8'))
    if not task.get('success'):raise ValueError('La ejecución desde el IDE no está comprobada.')
    run=task['result']['editor']['run_configuration'];folder=evidence_directory();folder.mkdir(exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    runtime=NativeRuntime(ROOT/'.local/terminal/ide-capture',proxy='http://127.0.0.1:1',token=str(uuid4()),diagnostics=True)
    try:
        capture=runtime.call('terminal_project_capture',url=run['url']+'/',destination=str(folder/('ProjectFixture-IDE-'+stamp+'.png')),proof=run['proof'],roots=[str(folder)],timeout=60)
        if not capture.get('verified'):raise ValueError('Captura sin verificar.')
        report={'type':'real_native_capture_of_IDE_preview','model_calls':0,'capture':capture,'recorded_utc':datetime.now(timezone.utc).isoformat()}
        directory=ROOT/'tmp/terminal-ide-real';(directory/'capture.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        (directory/'final-web.png').write_bytes(Path(capture['path']).read_bytes())
        print(json.dumps(report,ensure_ascii=False,indent=2))
    finally:runtime.close()


if __name__=='__main__':main()
