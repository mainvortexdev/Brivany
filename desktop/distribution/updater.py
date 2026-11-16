"""Signed updates: download -> verify -> stage -> restart -> health -> rollback.

No installer runs during updates. User data lives outside release directories.
The publisher key never ships with the application.
"""
from __future__ import annotations
import base64,hashlib,json,os,re,secrets,shutil,stat,subprocess,sys,threading,time,zipfile
from pathlib import Path,PurePosixPath
from urllib.parse import urlsplit
from urllib.request import Request,build_opener,HTTPRedirectHandler
from packages.runtime_paths import APP_ROOT,LOCAL_ROOT

MAX_DOWNLOAD=1024*1024*1024
MAX_EXPANDED=3*MAX_DOWNLOAD
TRUST=APP_ROOT/'desktop/distribution/update-trust.json'
VERSION=json.loads((APP_ROOT/'desktop/distribution/version.json').read_text())['version']

def version(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{1,5}\.\d{1,5}\.\d{1,5}',value):raise ValueError('Versión no válida.')
    return tuple(map(int,value.split('.')))

def atomic_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+secrets.token_hex(6)+'.tmp')
    try:
        with temporary.open('x',encoding='utf-8') as f:
            json.dump(value,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
        os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)

def canonical(payload):return json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()

def verify_manifest(envelope,trust,*,now=None,current=VERSION):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    if not isinstance(envelope,dict) or set(envelope)!={'payload','signature'}:raise ValueError('Manifiesto no válido.')
    p=envelope['payload'];required={'schema','version','channel','url','sha256','size','expanded_size','published','expires','min_launcher'}
    if not isinstance(p,dict) or set(p)!=required or p['schema']!=1 or p['channel']!='stable' or p['min_launcher']!=1:raise ValueError('Formato de actualización no compatible.')
    try:Ed25519PublicKey.from_public_bytes(base64.b64decode(trust['public_key'],validate=True)).verify(base64.b64decode(envelope['signature'],validate=True),canonical(p))
    except Exception as exc:raise ValueError('La firma de la actualización no es válida.') from exc
    now=time.time() if now is None else now
    if type(p['published']) is not int or type(p['expires']) is not int or p['published']>now+300 or p['expires']<=now or p['expires']<=p['published']:raise ValueError('El manifiesto no está vigente.')
    if type(p['size']) is not int or not 0<p['size']<=MAX_DOWNLOAD or type(p['expanded_size']) is not int or not 0<p['expanded_size']<=MAX_EXPANDED:raise ValueError('Tamaño de actualización no válido.')
    if not re.fullmatch('[a-f0-9]{64}',p['sha256']):raise ValueError('Resumen no válido.')
    url=urlsplit(p['url']);origin=urlsplit(trust['manifest_url'])
    if url.scheme!='https' or url.netloc!=origin.netloc or url.username or url.password or url.fragment or not url.path.startswith('/windows/'):raise ValueError('Destino de actualización no permitido.')
    version(p['version'])
    if version(p['version'])<version(current):raise ValueError('No se permite retroceder con un paquete de red.')
    return p

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def fetch(url,limit):
    with build_opener(NoRedirect()).open(Request(url,headers={'User-Agent':'Brivany-Updater/1','Accept':'application/json'}),timeout=20) as response:
        raw=response.read(limit+1)
        if len(raw)>limit:raise ValueError('Respuesta demasiado grande.')
        return raw

def safe_extract(archive,destination,*,expected_size):
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=False)
    total=0;names=set()
    with zipfile.ZipFile(archive) as z:
        if len(z.infolist())>50000:raise ValueError('Demasiados archivos.')
        for member in z.infolist():
            name=member.filename;p=PurePosixPath(name)
            if (not name or '\\' in name or ':' in name or p.is_absolute() or any(part in {'..','.'} or part.endswith(('.', ' ')) for part in p.parts)
                or not p.parts or p.parts[0] not in {'app','python'} or any(part.lower() in {'.local','.env','.git','user data'} or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?',part) for part in p.parts)
                or stat.S_ISLNK(member.external_attr>>16) or name.casefold() in names):raise ValueError('Ruta no permitida dentro del paquete.')
            names.add(name.casefold());total+=member.file_size
            if total>expected_size or total>MAX_EXPANDED:raise ValueError('Paquete expandido fuera del límite.')
            target=destination.joinpath(*p.parts)
            if not target.resolve().is_relative_to(destination.resolve()):raise ValueError('Ruta fuera de la versión.')
            if member.is_dir():target.mkdir(parents=True,exist_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with z.open(member) as src,target.open('xb') as dst:shutil.copyfileobj(src,dst,1024*1024)
    if total!=expected_size or not (destination/'python/pythonw.exe').is_file() or not (destination/'app/desktop/distribution/entry.py').is_file():raise ValueError('Paquete incompleto.')

class UpdateService:
    def __init__(self,install=None,local=None,trust=None):
        self.install=Path(install or os.environ['BRIVANY_INSTALL_DIR']).absolute()
        self.root=Path(local or LOCAL_ROOT/'updates');self.root.mkdir(parents=True,exist_ok=True)
        self.trust=trust or json.loads(TRUST.read_text());self.lock=threading.Lock();self.state={'state':'idle','version':VERSION,'message':'Listo para buscar actualizaciones.'};self.manifest=None
        try:
            result=json.loads((self.root/'last-update.json').read_text())
            if result.get('outcome')=='rolled_back' and result.get('previous')==VERSION:
                self.state.update(state='recovered',message='Se recuperó la versión anterior porque la actualización no pudo iniciar.')
        except (OSError,ValueError,TypeError):pass
        try:
            pending=json.loads((self.root/'pending.json').read_text())
            candidate=verify_manifest(pending['envelope'],self.trust)
            if pending['previous']==VERSION and version(candidate['version'])>version(VERSION) and (self.install/'releases'/candidate['version']).is_dir():
                self.manifest=pending['envelope'];self.state.update(state='ready',available_version=candidate['version'],message='Actualización lista. Reinicia cuando termines tu trabajo.')
        except (OSError,ValueError,KeyError,TypeError):pass
    def status(self):return dict(self.state)
    def check(self):
        if not self.lock.acquire(False):return self.status()
        try:
            if self.state['state']=='ready':return self.status()
            self.state={'state':'checking','version':VERSION,'message':'Buscando actualizaciones…'}
            envelope=json.loads(fetch(self.trust['manifest_url'],32768));p=verify_manifest(envelope,self.trust)
            self.manifest=envelope
            if version(p['version'])==version(VERSION):self.state={'state':'current','version':VERSION,'message':'Brivany está actualizado.'}
            else:self.state={'state':'available','version':VERSION,'available_version':p['version'],'message':'Hay una nueva versión.'}
        except Exception:self.state={'state':'offline','version':VERSION,'message':'No se pudieron comprobar las actualizaciones. Puedes volver a intentarlo.'}
        finally:self.lock.release()
        return self.status()
    def stage(self):
        if not self.lock.acquire(False):return self.status()
        archive=None;stage=None
        try:
            if self.state['state']=='ready':return self.status()
            if not self.manifest:raise ValueError('Comprueba la nueva versión primero.')
            p=verify_manifest(self.manifest,self.trust)
            if version(p['version'])<=version(VERSION):return self.status()
            self.state.update(state='downloading',message='Descargando la actualización…')
            archive=self.root/('update-'+secrets.token_hex(8)+'.zip');h=hashlib.sha256();count=0
            with build_opener(NoRedirect()).open(Request(p['url'],headers={'User-Agent':'Brivany-Updater/1'}),timeout=30) as src,archive.open('xb') as dst:
                while block:=src.read(1024*1024):
                    count+=len(block)
                    if count>p['size']:raise ValueError('Tamaño distinto al firmado.')
                    dst.write(block);h.update(block)
            if count!=p['size'] or h.hexdigest()!=p['sha256']:raise ValueError('El archivo no coincide con la firma.')
            self.state.update(state='staging',message='Preparando la actualización…')
            releases=self.install/'releases';stage=releases/(p['version']+'.stage-'+secrets.token_hex(6))
            safe_extract(archive,stage,expected_size=p['expanded_size'])
            bundled=json.loads((stage/'app/desktop/distribution/version.json').read_text())
            if bundled['version']!=p['version']:raise ValueError('Versión del paquete incorrecta.')
            ready=releases/p['version']
            if ready.exists():raise ValueError('Ya existe una versión con ese identificador.')
            stage.rename(ready);archive.unlink()
            atomic_json(self.root/'pending.json',{'envelope':self.manifest,'previous':VERSION})
            self.state.update(state='ready',message='Actualización lista. Reinicia cuando termines tu trabajo.')
        except Exception:self.state.update(state='error',message='No se pudo preparar la actualización. La versión actual sigue disponible.')
        finally:
            if archive is not None:archive.unlink(missing_ok=True)
            if stage is not None and stage.is_dir() and not stage.is_symlink() and stage.resolve().parent==(self.install/'releases').resolve():shutil.rmtree(stage)
            self.lock.release()
        return self.status()
    def restart(self):
        if self.state['state']!='ready':raise ValueError('La actualización no está lista.')
        # The helper runs outside the process being closed, on the old runtime.
        subprocess.Popen([sys.executable,'-I','-B',str(APP_ROOT/'desktop/distribution/apply_update.py'),str(self.install),str(self.root),str(os.getpid())],creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),close_fds=True)
        return {'ok':True,'restart_requested':True}

def apply(install,root,pid,*,wait_seconds=90,health_seconds=75):
    install=Path(install).absolute();root=Path(root);trust=json.loads(TRUST.read_text())
    pending=json.loads((root/'pending.json').read_text());p=verify_manifest(pending['envelope'],trust)
    previous=pending['previous'];version(previous)
    if p['version']==previous:return False
    # Wait for graceful shutdown; never kill a session with unsaved work.
    import ctypes
    from ctypes import wintypes as w
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];kernel.OpenProcess.restype=w.HANDLE
    kernel.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD];kernel.WaitForSingleObject.restype=w.DWORD
    kernel.CloseHandle.argtypes=[w.HANDLE];kernel.CloseHandle.restype=w.BOOL
    handle=kernel.OpenProcess(0x100000,False,pid)
    if handle:
        try:
            if kernel.WaitForSingleObject(handle,wait_seconds*1000)!=0:return False
        finally:kernel.CloseHandle(handle)
    elif ctypes.get_last_error() not in (0,87):
        # Access denied is not evidence that the old application has exited.
        return False
    current=json.loads((install/'current.json').read_text())
    if current.get('version')!=previous:return False
    token=secrets.token_hex(24);healthy=root/'healthy.json'
    atomic_json(install/'current.json',{'version':p['version']})
    env=dict(os.environ,BRIVANY_UPDATE_HEALTH_TOKEN=token)
    try:
        subprocess.Popen([str(install/'Brivany.exe')],env=env,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    except OSError:
        atomic_json(install/'current.json',{'version':previous})
        atomic_json(root/'last-update.json',{'version':p['version'],'previous':previous,'outcome':'rolled_back'})
        (root/'pending.json').unlink(missing_ok=True)
        return False
    deadline=time.monotonic()+health_seconds
    while time.monotonic()<deadline:
        try:
            value=json.loads(healthy.read_text())
            if value.get('version')==p['version'] and secrets.compare_digest(value.get('token',''),token):
                atomic_json(root/'last-update.json',{'version':p['version'],'previous':previous,'outcome':'updated'});(root/'pending.json').unlink(missing_ok=True);return True
        except (OSError,ValueError,TypeError):pass
        time.sleep(.5)
    # New process may still exist. Roll back the selection for the next launch;
    # don't start a second instance or destroy data while another app is alive.
    atomic_json(install/'current.json',{'version':previous})
    atomic_json(root/'last-update.json',{'version':p['version'],'previous':previous,'outcome':'rolled_back'})
    (root/'pending.json').unlink(missing_ok=True)
    return False

def mark_healthy():
    atomic_json(LOCAL_ROOT/'updates/healthy.json',{'version':VERSION,'pid':os.getpid(),'token':os.environ.get('BRIVANY_UPDATE_HEALTH_TOKEN','')})
