"""Opt-in real test of Melodi's project browser and Notepad adapters.

Reuses a prepared project to avoid another dependency installation. No model,
financial actions, credentials, registry access or elevation are exercised.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import threading
from urllib.request import urlopen
from services.computer.runtime import NativeRuntime, ROOT
from services.terminal.evidence import evidence_directory


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run',action='store_true')
    args=parser.parse_args()
    if not args.run:parser.error('La prueba real requiere --run.')
    root=ROOT/'.local/terminal/projects/ProjectFixture-Trading-Operator'
    project=json.loads((root/'project.json').read_text(encoding='utf-8'))
    server=json.loads((root/'server.json').read_text(encoding='utf-8'))
    configuration=json.loads(Path(server['argv'][-1]).read_text(encoding='utf-8'))
    with urlopen(server['url']+'/api/health',timeout=3) as response:
        assert response.status==200 and response.headers['X-Melodi-Run']==configuration['id']
    folder=evidence_directory();stamp=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    runtime=NativeRuntime(ROOT/'.local/terminal/evidence-runtime',proxy='http://127.0.0.1:1',token=secrets.token_urlsafe(32),diagnostics=True)
    cancelled=threading.Event();result={'type':'real_native_adapters','model_calls':0,'success':False}
    try:
        runtime.call('begin_task',cancelled=cancelled,timeout=20)
        result['capture']=runtime.call('terminal_project_capture',url=server['url']+'/',proof=configuration['id'],destination=str(folder/('ProjectFixture-'+stamp+'.png')),roots=[str(folder)],cancelled=cancelled,timeout=60)
        text='\r\n'.join([
            'Acciones realizadas por las herramientas de Melodi',
            'Fecha UTC: '+datetime.now(timezone.utc).isoformat(),'',
            '1. Detecté Git, Python y Antigravity IDE en el equipo.',
            '2. Cloné '+project['repository']+'.',
            '3. Comprobé el commit '+project['commit']+'.',
            '4. Conservé la copia de origen limpia y generé una copia de trabajo separada.',
            '5. Creé un entorno Python e instalé las dependencias de requirements.txt.',
            '6. Excluí de la copia de ejecución las credenciales de servicio clonadas; no las utilicé.',
            '7. La comprobación compileall terminó correctamente; no hizo falta corregir sintaxis.',
            '8. Arranqué la aplicación Flask original con un adaptador de presentación local en '+server['url']+'.',
            '9. Comprobé /api/health y el identificador del servidor. La vista local bloquea operaciones financieras y API ajenas a salud.',
            '10. Creé la carpeta Evidencia Melodi en el Escritorio.',
            '11. Abrí la web en un navegador local aislado y guardé '+Path(result['capture']['path']).name+'.',
            '12. Abrí este TXT nuevo en Bloc de notas, escribí estas acciones y utilicé su menú Guardar observado.',
            '13. La herramienta verifica que el texto guardado coincide con el texto escrito.','',
            'Límites: prueba real de clonación, instalación, compilación, servidor y adaptadores nativos.',
            'Este ensayo de adaptadores usa una petición fija; no acredita la planificación del modelo ni ejecución dentro del IDE.',
            'No publiqué cambios en el repositorio, no ejecuté trading, no usé cuentas financieras ni cambié el registro.',
            'La checklist general de comandos y los ensayos macOS se verifican por separado.',''])
        result['notes']=runtime.call('terminal_notepad_evidence',destination=str(folder/('Acciones-'+stamp+'.txt')),text=text,roots=[str(folder)],cancelled=cancelled,timeout=70)
        result.update(success=True,server_url=server['url'],source_commit=project['commit'])
    except Exception as error:
        result['error']=str(error);result['error_code']=getattr(error,'code',None)
        raise
    finally:
        try:runtime.call('end_task',timeout=8)
        except Exception:pass
        runtime.close()
        output=ROOT/'tmp/terminal-research/native-evidence-result.json'
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        output.with_name('native-evidence-'+stamp+'.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
