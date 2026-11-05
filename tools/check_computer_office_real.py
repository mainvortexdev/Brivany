"""Real Word/PowerPoint creation on fixed synthetic plans; no model calls."""
import json
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile
from services.computer.runtime import NativeRuntime,ROOT


def main():
    directory=ROOT/'tmp/computer-office-real';directory.mkdir(parents=True,exist_ok=True)
    workspace=directory/('fixture-'+uuid4().hex[:8]);workspace.mkdir()
    runtime=NativeRuntime(workspace,proxy='http://127.0.0.1:1',token='fixture-'+uuid4().hex,diagnostics=True)
    plans=[{'kind':'document','title':'Brivany · prueba de documento','subtitle':'Contenido sintético para verificar el adaptador',
            'sections':[{'heading':'Control de Melodi','paragraphs':['Este documento nuevo comprueba la creación nativa de Word. No contiene información personal.'],
                         'table':{'headers':['Prueba','Estado'],'rows':[['Contenido','Sintético'],['Documento','Editable']]}}]},
           {'kind':'presentation','title':'Brivany · prueba de presentación','slides':[
               {'title':'Melodi en el escritorio','body':'Prueba sintética de creación nativa.','notes':'Esta diapositiva no contiene datos personales.'},
               {'title':'Un resultado editable','body':'Texto, tabla y notas verificables.','notes':'Segunda diapositiva de prueba.','table':{'headers':['Elemento','Cantidad'],'rows':[['Diapositivas','2'],['Tablas','1']]}}]}]
    report={'scope':'real native Office worker, new synthetic files only','external_calls':0,'results':[],'user_documents_modified':False}
    try:
        runtime.call('begin_task',roots=[str(workspace)],timeout=25)
        for plan in plans:
            result=runtime.call('execute',step={'action':'create_office','params':{'plan':plan}},roots=[str(workspace)],timeout=120)
            artifact=Path(result['localPath']);pdf=Path(result['pdfPath']);assert artifact.is_file() and pdf.is_file()
            with ZipFile(artifact) as archive:
                if plan['kind']=='document':
                    xml=archive.read('word/document.xml').decode();assert 'Control de Melodi' in xml and 'Sintético' in xml
                else:
                    slides=[name for name in archive.namelist() if __import__('re').fullmatch(r'ppt/slides/slide\d+\.xml',name)]
                    assert len(slides)==2;xml=archive.read('ppt/slides/slide2.xml').decode();assert 'Un resultado editable' in xml
            report['results'].append({'kind':plan['kind'],'native_result':result,'openxml_readback':True,'pdf_bytes':pdf.stat().st_size})
        report['status']='passed'
    except Exception as error:report.update(status='failed',failure=str(error))
    finally:
        try:runtime.call('end_task',timeout=5)
        except Exception:runtime.cancel()
        runtime.close();(directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
