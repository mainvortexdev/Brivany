"""Pristine local source plus a separate working copy; never push or publish."""
import io
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import subprocess
import sys
import socket
import time
from urllib.request import urlopen
from uuid import uuid4
from .policy import TerminalError,repository_url,scoped,child_environment


class ProjectWorkspace:
    def __init__(self,executor):self.executor=executor
    def clone(self,url,name=None,cancelled=None):
        url=repository_url(url);name=name or url.rstrip('/').rsplit('/',1)[1].removesuffix('.git')
        if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',name):raise TerminalError('Nombre de proyecto no válido.')
        root=self.executor.root/'projects'/name;root.mkdir(parents=True,exist_ok=True);source=root/'source';work=root/'work';receipts=[]
        if not source.exists():
            receipt=self.executor.git(['clone','--no-local','--',url,str(source)],cwd=root,cancelled=cancelled,timeout=240);receipts.append(receipt);self.executor.require_success(receipt)
        origin=self.executor.require_success(self.executor.git(['remote','get-url','origin'],cwd=source,cancelled=cancelled));receipts.append(origin)
        if origin['output'].strip().removesuffix('.git')!=url.removesuffix('.git'):raise TerminalError('La copia existente pertenece a otro repositorio.')
        status=self.executor.require_success(self.executor.git(['status','--porcelain'],cwd=source,cancelled=cancelled));receipts.append(status)
        if status['output'].strip():raise TerminalError('La copia de origen tiene cambios; no se modificará ni reutilizará.')
        revision=self.executor.require_success(self.executor.git(['rev-parse','HEAD'],cwd=source,cancelled=cancelled));receipts.append(revision)
        commit=revision['output'].strip()
        if not re.fullmatch(r'[0-9a-f]{40}',commit):raise TerminalError('No se pudo identificar la revisión clonada.')
        if not work.exists():
            archive=root/'source.tar'
            receipt=self.executor.git(['archive','--format=tar','--output='+str(archive),'HEAD'],cwd=source,cancelled=cancelled);receipts.append(receipt);self.executor.require_success(receipt)
            work.mkdir()
            with tarfile.open(archive) as bundle:
                for entry in bundle.getmembers():
                    target=(work/entry.name).resolve()
                    if not target.is_relative_to(work.resolve()) or entry.issym() or entry.islnk() or not(entry.isfile() or entry.isdir()):raise TerminalError('El archivo contiene rutas o enlaces no admitidos.')
                bundle.extractall(work,filter='data')
            archive.unlink()
        manifest={'repository':url,'commit':commit,'source':str(source),'work':str(work),'source_modified':False,'remote_changes':False,'receipts':[r['id'] for r in receipts]}
        (root/'project.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
        return manifest

    def detect_editors(self):
        import os
        options=[];companions=[]
        if os.name=='nt':
            from .editors import discover_windows_editors
            locations=[Path(os.environ.get('LOCALAPPDATA',''))/'Programs',Path(os.environ.get('ProgramFiles','C:/Program Files'))]
            detected=discover_windows_editors(locations);options=detected['installed'];companions=detected['companion_apps']
        elif sys.platform=='darwin':
            from .editors import discover_macos_editors
            detected=discover_macos_editors(['/Applications',Path.home()/'Applications']);options=detected['installed'];companions=detected['companion_apps']
        for installation in (self.executor.root/'editors').glob('VSCode-*/brivany-install.json'):
            try:
                saved=json.loads(installation.read_text(encoding='utf-8'));binary=scoped(installation.parent/'Code.exe',[self.executor.root],existing=True)
                if saved.get('microsoft_signature_verified') and saved.get('path')==str(binary):options.append({'name':'VS Code','path':str(binary)})
            except (OSError,ValueError,KeyError):pass
        return {'installed':options,'companion_apps':companions,'recommended':'VS Code','recommendation_source':'https://code.visualstudio.com/download','registry_access':False}

    def prepare_python(self,project,cancelled=None):
        root=scoped(Path(project['work']).parent,[self.executor.root],existing=True);work=scoped(project['work'],[root],existing=True)
        environment=root/'python-env';binary=environment/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        receipts=[]
        if not binary.exists():
            receipt=self.executor.run('python.create_environment',sys.executable,['-m','venv',str(environment)],cwd=root,cancelled=cancelled,timeout=120);receipts.append(receipt);self.executor.require_success(receipt)
        # A cloned service credential is never used for a local presentation.
        removed=0
        for candidate in work.glob('*adminsdk*.json'):
            if (Path(project['source'])/candidate.name).is_file():scoped(candidate,[work]).unlink();removed+=1
        dotenv=work/'.env'
        if not dotenv.exists():dotenv.write_text('BINANCE_TESTNET=true\nENABLE_SENTIMENT_ANALYSIS=false\n',encoding='utf-8')
        requirement=work/'requirements.txt'
        values=[line.strip() for line in requirement.read_text(encoding='utf-8').splitlines() if line.strip() and not line.lstrip().startswith('#')]
        if any(not re.fullmatch(r'[A-Za-z0-9_.-]+(?:\[[A-Za-z0-9_,.-]+\])?(?:[<>=!~]+[A-Za-z0-9.*+_-]+(?:,[<>=!~]+[A-Za-z0-9.*+_-]+)*)?',line) for line in values):raise TerminalError('Las dependencias incluyen instrucciones o destinos no admitidos.')
        receipt=self.executor.run('python.install_dependencies',str(binary),['-m','pip','--disable-pip-version-check','install','-r',str(requirement)],cwd=work,cancelled=cancelled,timeout=420);receipts.append(receipt);self.executor.require_success(receipt)
        receipt=self.executor.run('python.compile_project',str(binary),['-m','compileall','-q','config','src','web','main.py'],cwd=work,cancelled=cancelled,timeout=60);receipts.append(receipt)
        return {'python':str(binary),'receipts':receipts,'credentials_omitted_from_work_copy':removed,'compiled':receipt['exit_code']==0 and not receipt['interrupted']}

    def start_python_web(self,project,python,cancelled=None):
        root=scoped(Path(project['work']).parent,[self.executor.root],existing=True)
        if not (Path(project['work'])/'web/server.py').is_file():raise TerminalError('No se encontró la entrada Flask del proyecto.')
        with socket.socket() as candidate:candidate.bind(('127.0.0.1',0));port=candidate.getsockname()[1]
        identifier=str(uuid4());configuration=root/('preview-'+identifier+'.json')
        site=Path(python).parents[1]/('Lib/site-packages' if os.name=='nt' else 'lib/python'+str(sys.version_info.major)+'.'+str(sys.version_info.minor)+'/site-packages')
        configuration.write_text(json.dumps({'id':identifier,'work':project['work'],'site_packages':str(site),'port':port}),encoding='utf-8')
        runner=Path(__file__).with_name('preview_server.py')
        receipt=self.executor.start_server(getattr(sys,'_base_executable',sys.executable),['-I',str(runner),str(configuration)],cwd=project['work'],port=port)
        try:return self._wait_server(root,receipt,identifier,cancelled)
        except BaseException:
            self.executor.stop_server(receipt['id']);raise

    def _wait_server(self,root,receipt,identifier,cancelled):
        deadline=time.monotonic()+35
        while time.monotonic()<deadline:
            if cancelled and cancelled.is_set():raise TerminalError('Arranque cancelado.')
            process=self.executor.processes[receipt['id']]
            if process.poll() is not None:raise TerminalError('El servidor se cerró durante el arranque. Revisa el log del proceso.','terminal_server_failed')
            try:
                with urlopen(receipt['url']+'/api/health',timeout=1) as response:
                    if response.headers.get('X-Melodi-Run')==identifier and json.load(response).get('status')=='healthy':
                        receipt.update(health_verified=True,mode='local_web_presentation',trading_enabled=False,cloud_credentials_used=False)
                        (root/'server.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8');return receipt
            except (OSError,ValueError):pass
            time.sleep(.2)
        raise TerminalError('No se confirmó la salud del servidor local.','terminal_server_timeout')
