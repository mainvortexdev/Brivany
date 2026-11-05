"""Real native fixture for notes and file organization. No model or user document."""
import hashlib
import json
from pathlib import Path
import time
from uuid import uuid4
from services.computer.runtime import NativeRuntime,ROOT


def main():
    directory=ROOT/'tmp/computer-files-real';directory.mkdir(parents=True,exist_ok=True)
    fixture=directory/('fixture-'+uuid4().hex[:8]);fixture.mkdir()
    runtime=NativeRuntime(fixture,proxy='http://127.0.0.1:1',token='fixture-'+uuid4().hex,diagnostics=True)
    report={'scope':'real native execution on new synthetic files only','external_calls':0,'checks':[],
            'user_documents_modified':False,'fixture_root':str(fixture)}
    def execute(action,params):return runtime.call('execute',step={'action':action,'params':params},roots=[str(fixture)],timeout=45)
    try:
        runtime.call('begin_task',roots=[str(fixture)],timeout=25)
        name='Melodi-fixture-'+uuid4().hex[:6]+'.txt';initial='Brivany: nota de prueba. '
        created=execute('write_note',{'name':name,'text':initial});note=Path(created['path'])
        assert note.read_text(encoding='utf-8')==initial;report['checks'].append('new note bytes verified')
        execute('open_file',{'path':str(note)})
        deadline=time.monotonic()+20;window=None
        while time.monotonic()<deadline:
            observed=runtime.call('observe',timeout=20)
            candidates=[w for w in observed['windows'] if note.stem.lower() in w.get('title','').lower()]
            if len(candidates)==1:window=candidates[0];break
            time.sleep(.25)
        if window is None:raise ValueError('No se identificó una ventana única de la nota de prueba.')
        identity={'handle':str(window['handle']),'process_id':window['processId']}
        execute('focus_window',identity);observed=runtime.call('observe',timeout=20)
        edits=[c for c in observed['controls'] if c.get('role') in {'ControlType.Edit','ControlType.Document'}]
        if len(edits)!=1:
            report['control_probe']=runtime.call('control_probe',timeout=20)
            report['observed_foreground']=observed['foreground']
            raise ValueError('La nota no presenta un único campo editable; no se escribirá en otro control.')
        target={**identity,'control_id':edits[0]['id']}
        execute('click_control',target)
        text='Texto literal: $(no-ejecutar) $VARIABLE {ENTER} áéñ 123.'
        typed=execute('type_text',{**target,'text':text})
        contents=runtime.call('inspect_control',target=target,timeout=20)['text']
        assert text in contents,'La aplicación no conservó el texto literal.'
        report['checks'].append('literal text read back from observed editor; no shell expansion')
        report['text_value_verified']=typed.get('text_value_verified',False)
        report['observed_editor_sha256']=hashlib.sha256(contents.encode()).hexdigest()
        # Organize a separate fixture; the open editor file is left intact.
        source=fixture/'organizar.txt';source.write_text('Contenido sintético para organizar.',encoding='utf-8')
        folder=fixture/'Organizado';execute('create_directory',{'path':str(folder)})
        copied=folder/'copia.txt';execute('copy_file',{'source':str(source),'destination':str(copied)})
        destination=folder/'movido.txt';execute('move_file',{'source':str(source),'destination':str(destination)})
        assert not source.exists() and destination.read_bytes()==copied.read_bytes()
        report['checks'].append('real copy and move preserve bytes; source moved only after verified copy')
        try:execute('copy_file',{'source':str(copied),'destination':str(destination)})
        except ValueError:report['checks'].append('existing destination rejected without overwrite')
        else:raise AssertionError('Se permitió sobrescribir.')
        report['status']='passed';report['ui_text_saved_to_disk']=False
    except Exception as error:report.update(status='failed',failure=str(error))
    finally:
        try:runtime.call('end_task',timeout=5)
        except Exception:runtime.cancel()
        runtime.close();(directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
