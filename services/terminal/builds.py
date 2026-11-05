"""Compile a user-selected source in a working copy. Never auto-run artifacts."""
import hashlib
import json
import os
from pathlib import Path
import re
import uuid
from .policy import TerminalError,scoped,REGISTRY


def compile_executable(executor,project,entry,cancelled=None):
    work=scoped(project['work'],[executor.root],existing=True)
    if not isinstance(entry,str) or Path(entry).is_absolute() or len(entry)>200:raise TerminalError('Selecciona un archivo de código del proyecto.')
    source=scoped(work/entry,[work],existing=True)
    if not source.is_file() or source.suffix.lower() not in {'.cs','.py'} or source.stat().st_size>200000:raise TerminalError('Este constructor admite un archivo C# o Python de hasta 200 KB.')
    if REGISTRY.search(source.read_text(encoding='utf-8-sig')):raise TerminalError('El código seleccionado contiene operaciones de registro; Melodi no lo compilará.','registry_forbidden')
    name=source.stem
    if not re.fullmatch('[A-Za-z0-9_-]{1,60}',name):raise TerminalError('El ejecutable necesita un nombre sencillo.')
    build=scoped(work.parent/'builds'/uuid.uuid4().hex,[executor.root]);build.mkdir(parents=True)
    receipts=[]
    if source.suffix.lower()=='.cs':
        if os.name!='nt':raise TerminalError('Este constructor C# usa el compilador .NET Framework del equipo Windows; no acredita macOS.','terminal_platform_unavailable')
        base=Path(os.environ.get('SystemRoot','C:/Windows'))/'Microsoft.NET'
        compiler=next((base/folder/'v4.0.30319/csc.exe' for folder in ('Framework64','Framework') if (base/folder/'v4.0.30319/csc.exe').is_file()),None)
        if not compiler:raise TerminalError('No se encontró el compilador C# de Windows.','terminal_missing_program')
        destination=build/(name+'.exe')
        receipt=executor.run('build.csharp',str(compiler),['/nologo','/target:exe','/out:'+str(destination),str(source)],cwd=work,cancelled=cancelled,timeout=90)
        receipts.append(receipt);executor.require_success(receipt)
    else:
        environment=work.parent/'python-env';python=environment/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        if not python.is_file():raise TerminalError('Prepara primero el entorno Python del proyecto.')
        receipt=executor.run('build.install_packager',str(python),['-m','pip','--disable-pip-version-check','install','PyInstaller>=6,<7'],cwd=work,cancelled=cancelled,timeout=300)
        receipts.append(receipt);executor.require_success(receipt)
        receipt=executor.run('build.python',str(python),['-m','PyInstaller','--onefile','--noupx','--name',name,'--distpath',str(build/'dist'),'--workpath',str(build/'work'),'--specpath',str(build),str(source)],cwd=work,cancelled=cancelled,timeout=300)
        receipts.append(receipt);executor.require_success(receipt)
        destination=build/'dist'/(name+('.exe' if os.name=='nt' else ''))
    if not destination.is_file() or destination.stat().st_size<1000:raise TerminalError('No se confirmó el ejecutable generado.','terminal_build_failed')
    result={'title':'Ejecutable creado','path':str(destination),'evidence_folder':str(destination.parent),'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'bytes':destination.stat().st_size,'compiler_receipts':[r['id'] for r in receipts],'created':True,'automatically_executed':False,'signed':False,'cross_platform_binary':False,'message':'Ejecutable creado para este sistema y guardado junto a la copia de trabajo.'}
    (build/'build.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return result
