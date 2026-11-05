"""Official VS Code portable installation when no usable IDE was selected."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import socket
import urllib.parse
from urllib.request import Request,urlopen
import uuid
import zipfile
from .policy import TerminalError,scoped,validate_program,child_environment
from .recipes import literal

SOURCE='https://code.visualstudio.com/docs/setup/portable'


def discover_windows_editors(locations):
    """Keep the Antigravity 2.x agent manager separate from its code editor."""
    editors=[];companions=[];seen=set()
    candidates=[('Microsoft VS Code','Code.exe','VS Code'),
                ('Antigravity IDE','Antigravity IDE.exe','Antigravity'),
                ('antigravity','Antigravity.exe','Antigravity'),
                ('Antigravity','Antigravity.exe','Antigravity'),
                ('Cursor','Cursor.exe','Cursor')]
    for root in map(Path,locations):
        for folder,binary,label in candidates:
            path=root/folder/binary
            if not path.is_file() or str(path).casefold() in seen:continue
            seen.add(str(path).casefold())
            value={'name':label,'path':str(path)}
            # The former IDE and the newer agent manager share Antigravity.exe.
            # Classic VS Code based installations have an unpacked product manifest.
            if binary=='Antigravity.exe' and not (path.parent/'resources/app/product.json').is_file():
                companions.append({**value,'kind':'agent_manager','usable_as_ide':False})
            else:editors.append(value)
    return {'installed':editors,'companion_apps':companions}


def discover_macos_editors(locations):
    """Path discovery only. It does not certify an editor or command on macOS."""
    editors=[];companions=[];seen=set()
    for root in map(Path,locations):
        for folder,label in [('Visual Studio Code.app','VS Code'),('Antigravity IDE.app','Antigravity'),('Antigravity.app','Antigravity'),('Cursor.app','Cursor')]:
            path=root/folder
            if not path.is_dir() or str(path) in seen:continue
            seen.add(str(path));value={'name':label,'path':str(path)}
            if folder=='Antigravity.app' and not (path/'Contents/Resources/app/product.json').is_file():companions.append({**value,'kind':'agent_manager','usable_as_ide':False})
            else:editors.append(value)
    return {'installed':editors,'companion_apps':companions}


def select_editor(editors,request):
    """An explicitly named IDE takes precedence over the default recommendation."""
    if not isinstance(request,str):raise TerminalError('Petición de editor inválida.')
    requested=None
    for name,pattern in [('Antigravity',r'\bantigravity\b'),('Cursor',r'(?:\b(?:en|con|usa|usar|abre|abrir|editor|ide)\s+(?:el\s+)?(?:ide\s+)?cursor\b|\bcursor\s+(?:ide|editor)\b)'),('VS Code',r'\b(?:vs\s*code|visual studio code)\b')]:
        match=re.search(pattern,request,re.I)
        if match and not re.search(r'\b(?:no\s+uses?|sin\s+usar)\s+(?:el\s+)?$',request[:match.start()],re.I):requested=name;break
    if requested:
        chosen=next((editor for editor in editors if editor['name']==requested),None)
        if chosen is None:raise TerminalError('No se encontró el IDE '+requested+'. Un gestor de agentes no acredita un editor instalado.','terminal_missing_editor')
        return chosen
    return next((editor for editor in editors if editor['name']=='VS Code'),editors[0] if editors else None)


def open_project_editor(executor,project,editor,*,workspace=None):
    """Open the working copy via the installed IDE's CLI, with no terminal UI input."""
    work=scoped(project['work'],[executor.root],existing=True)
    if not work.is_dir() or work.name!='work':raise TerminalError('Selecciona la copia de trabajo del proyecto.')
    target=work
    if workspace is not None:
        target=scoped(workspace,[work.parent/'ide'],existing=True)
        if target.suffix!='.code-workspace' or json.loads(target.read_text(encoding='utf-8')).get('folders')!=[{'path':str(work),'name':'ProjectFixture · copia de trabajo'}]:raise TerminalError('El workspace no corresponde a esta copia.')
    binary=Path(editor['path'])
    if sys.platform=='darwin':
        if binary.suffix!='.app' or not binary.is_dir():raise TerminalError('No se encontró la aplicación del editor.')
        argv=['/usr/bin/open','-a',str(binary),'--args','--new-window',str(target)]
    else:
        if not binary.is_file():raise TerminalError('No se encontró el ejecutable del editor.')
        argv=[str(binary),'--new-window',str(target)]
    validate_program(argv[0],argv[1:])
    process=subprocess.Popen(argv,cwd=work,env=child_environment(executor.root/'environment'),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    result={'name':editor['name'],'path':str(binary),'pid':process.pid,'launch_requested':True,'project_open_verified':False,'work':str(work),'launch_target':str(target),'method':'installed-editor-cli','message':'Apertura solicitada en el IDE; la ventana y su contenido necesitan comprobación.'}
    (work.parent/'editor-launch.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result


def prepare_editor_run(executor,project):
    """Create a separate IDE workspace; no automatic tasks or source changes."""
    if os.name!='nt':raise TerminalError('La preparación de este ensayo IDE requiere Windows; macOS no está certificado.','terminal_platform_unavailable')
    work=scoped(project['work'],[executor.root],existing=True);root=work.parent
    python=scoped(root/'python-env/Scripts/python.exe',[root],existing=True)
    site=scoped(root/'python-env/Lib/site-packages',[root],existing=True)
    if not (work/'web/server.py').is_file():raise TerminalError('No se encontró la aplicación Flask de esta copia.')
    adapter=Path(__file__).with_name('preview_server.py');bridge=Path(__file__).resolve().parents[2]/'desktop/computer/ideProject.cjs'
    node=executor.binary('node');identifier=str(uuid.uuid4());directory=scoped(root/'ide'/identifier,[root]);directory.mkdir(parents=True)
    with socket.socket() as candidate:candidate.bind(('127.0.0.1',0));port=candidate.getsockname()[1]
    base_python=Path(getattr(sys,'_base_executable',sys.executable)).resolve()
    config={'id':identifier,'work':str(work),'site_packages':str(site),'port':port,'python':str(base_python),'python_sha256':hashlib.sha256(base_python.read_bytes()).hexdigest(),'node':node,'node_sha256':hashlib.sha256(Path(node).read_bytes()).hexdigest(),'bridge_sha256':hashlib.sha256(bridge.read_bytes()).hexdigest(),'runner':str(adapter),'runner_sha256':hashlib.sha256(adapter.read_bytes()).hexdigest()}
    file=directory/'preview.json';raw=json.dumps(config,ensure_ascii=False,indent=2).encode();file.write_bytes(raw);seal=hashlib.sha256(raw).hexdigest()
    name='Melodi · ProjectFixture · '+identifier[:8]
    workspace={'folders':[{'path':str(work),'name':'ProjectFixture · copia de trabajo'}],'launch':{'version':'0.2.0','configurations':[{'name':name,'type':'node','request':'launch','runtimeExecutable':node,'program':str(bridge),'args':[str(file),seal],'cwd':str(work),'console':'internalConsole','outputCapture':'std','skipFiles':['<node_internals>/**']}]}}
    target=directory/('Melodi-ProjectFixture-'+identifier[:8]+'.code-workspace');target.write_text(json.dumps(workspace,ensure_ascii=False,indent=2),encoding='utf-8')
    return {'workspace':str(target),'configuration':str(file),'configuration_sha256':seal,'configuration_name':name,'url':'http://127.0.0.1:'+str(port),'proof':identifier,'auto_run':False,'source_changed':False,'launched':False}


def archive_target(info,root):
    if '\\' in info.orig_filename or ':' in info.filename or Path(info.filename).is_absolute() or '..' in Path(info.filename).parts or (info.external_attr>>16)&0o170000==0o120000:raise TerminalError('El archivo del editor contiene rutas o enlaces no admitidos.')
    return scoped(Path(root)/info.filename,[root])


def install_vscode(executor,cancelled=None):
    if os.name!='nt':raise TerminalError('La instalación portable automática de este adaptador está verificada sólo para Windows.','terminal_platform_unavailable')
    architecture='arm64' if platform.machine().casefold() in {'arm64','aarch64'} else 'x64'
    metadata_url='https://update.code.visualstudio.com/api/update/win32-'+architecture+'-archive/stable/latest'
    with urlopen(Request(metadata_url,headers={'User-Agent':'Brivany-editor-setup'}),timeout=20) as response:metadata=json.load(response)
    url=urllib.parse.urlsplit(metadata.get('url',''));digest=metadata.get('sha256hash','');version=metadata.get('productVersion','')
    if url.scheme!='https' or url.hostname not in {'vscode.download.prss.microsoft.com','az764295.vo.msecnd.net','vscode.download.prss.microsoft.com.edgesuite.net'} or not re.fullmatch('[0-9a-fA-F]{64}',digest) or not re.fullmatch('[0-9.]+',version):raise TerminalError('No se pudo verificar la descarga oficial del editor.')
    base=executor.root/'editors';base.mkdir(exist_ok=True);destination=base/('VSCode-'+version+'-'+architecture)
    if destination.exists():raise TerminalError('Ya existe esa instalación; comprueba su recibo antes de reutilizarla.')
    temporary=base/('download-'+uuid.uuid4().hex);temporary.mkdir();archive=temporary/'editor.zip'
    hashed=hashlib.sha256();size=0
    try:
        with urlopen(Request(metadata['url'],headers={'User-Agent':'Brivany-editor-setup'}),timeout=30) as response,archive.open('xb') as output:
            if urllib.parse.urlsplit(response.url).scheme!='https':raise TerminalError('La descarga salió de HTTPS.')
            while True:
                if cancelled is not None and cancelled.is_set():raise TerminalError('Descarga del editor cancelada.')
                block=response.read(1024*1024)
                if not block:break
                size+=len(block)
                if size>350*1024*1024:raise TerminalError('La descarga excede el tamaño admitido.')
                output.write(block);hashed.update(block)
        if hashed.hexdigest().lower()!=digest.lower():raise TerminalError('El ZIP del editor no coincide con el hash oficial.')
        unpacked=temporary/'unpacked';unpacked.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            entries=bundle.infolist()
            if len(entries)>50000 or sum(e.file_size for e in entries)>1500*1024*1024:raise TerminalError('El editor excede el límite de extracción.')
            for info in entries:archive_target(info,unpacked)
            bundle.extractall(unpacked)
        executable=unpacked/'Code.exe'
        if not executable.is_file():raise TerminalError('No se encontró Code.exe en el ZIP oficial.')
        host=Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
        command="Get-AuthenticodeSignature -LiteralPath "+literal(executable)+" | Select-Object @{n='Status';e={$_.Status.ToString()}},@{n='Signer';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress"
        receipt=executor.run('editor.verify_signature',str(host),['-NoProfile','-NonInteractive','-Command',command],cwd=temporary,cancelled=cancelled,timeout=30)
        executor.require_success(receipt);signature=json.loads(receipt['output'])
        if signature.get('Status')!='Valid' or 'O=Microsoft Corporation' not in signature.get('Signer',''):raise TerminalError('La firma de Microsoft del editor no se confirmó.')
        settings=unpacked/'data/user-data/User';settings.mkdir(parents=True)
        (settings/'settings.json').write_text(json.dumps({'workbench.startupEditor':'none','window.restoreWindows':'none','files.autoSave':'off'},indent=2),encoding='utf-8')
        unpacked.rename(destination)
        result={'name':'VS Code','path':str(destination/'Code.exe'),'version':version,'portable':True,'archive_sha256':digest.lower(),'microsoft_signature_verified':True,'signature_receipt':receipt['id'],'source':SOURCE,'registry_configuration_changed':False}
        (destination/'brivany-install.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return result
    finally:
        # This is a freshly created, canonically checked helper directory only.
        scoped(temporary,[base],existing=True);shutil.rmtree(temporary)
