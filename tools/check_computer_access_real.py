"""Own synthetic files, actual native transport/trash. No model or GUI input."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
from uuid import uuid4
from services.computer.runtime import NativeRuntime

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('Usa --run: sólo opera archivos sintéticos creados por esta prueba.')
    directory=ROOT/'tmp/computer-access-real'/str(uuid4());directory.mkdir(parents=True)
    files=directory/'owned';files.mkdir();source=files/'nuevo.txt';destination=files/'anterior.txt'
    source.write_text('Texto sintético nuevo.',encoding='utf-8');destination.write_text('Versión sintética anterior.',encoding='utf-8')
    runtime=NativeRuntime(directory/'runtime',proxy='http://127.0.0.1:1',token=str(uuid4()),diagnostics=True)
    report={'type':'actual_native_file_operations_on_owned_synthetic_files','recorded_utc':datetime.now(timezone.utc).isoformat(),
            'human_approval_simulated_by_test':True,'user_files_accessed':False,'model_calls':0,'uac_requested':False,'gui_input':False,'checks':[],'passed':False}
    try:
        step={'action':'replace_file','params':{'source':str(source),'destination':str(destination)}}
        prepared=runtime.call('file_action_prepare',step=step,roots=[str(files)],timeout=25)
        assert destination.read_text(encoding='utf-8')=='Versión sintética anterior.'
        report['checks'].append('prepare_keeps_original')
        replacement=runtime.call('file_action_commit',ticket=prepared['ticket'],roots=[str(files)],timeout=25)
        assert destination.read_bytes()==source.read_bytes() and Path(replacement['backup_path']).read_text(encoding='utf-8')=='Versión sintética anterior.'
        report['checks'].append('actual_transport_replace_and_backup')
        deleting=files/'papelera.txt'
        deleting.write_text('Archivo sintético descartable de Brivany.',encoding='utf-8')
        prepared=runtime.call('file_action_prepare',step={'action':'delete_file','params':{'path':str(deleting)}},roots=[str(files)],timeout=25)
        assert deleting.is_file()
        trashed=runtime.call('file_action_commit',ticket=prepared['ticket'],roots=[str(files)],timeout=25)
        assert trashed['verified'] and trashed['permanent_delete'] is False and not deleting.exists()
        report['checks'].append('actual_electron_os_trash')
        report.update(passed=True,replacement=replacement,trash=trashed)
    except Exception as error:report['error']=str(error)
    finally:
        runtime.close();path=directory/'report.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        (directory.parent/'latest.json').write_text(path.read_text(encoding='utf-8'),encoding='utf-8');print(json.dumps({'passed':report['passed'],'report':str(path),'checks':report['checks'],'error':report.get('error')},ensure_ascii=False))
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
