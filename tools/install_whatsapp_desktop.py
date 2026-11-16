"""One-computer update with immutable backups; never copies a user profile."""
from __future__ import annotations
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import sys
from uuid import uuid4
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from services.brivany_account import SecureAccountFile

ROOT=Path(__file__).resolve().parents[1]
FILES='''services/whatsapp_desktop.py services/whatsapp_cloud.py services/vetsa_account.py services/connections_http.py
web/whatsapp-cloud.js web/connections.js web/connections.html web/connections.css
desktop/experience/launcher.py desktop/experience/telephony.py desktop/computer/native.cjs services/computer/service.py
services/telephony/realtime.py services/telephony/control_host.py
services/telephony/call_control.py services/telephony/call_control_http.py services/telephony/call_control_client.py services/telephony/telnyx_media.py
services/telephony/common.py services/telephony/safety.py services/telephony/telnyx.py
tools/serve_telnyx_control.py tools/setup_telnyx_control.py'''.split()
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def install():
    home=Path(os.environ['LOCALAPPDATA'])/'Programs/Brivany';version=json.loads((home/'current.json').read_text())['version']
    if not isinstance(version,str) or not re.fullmatch('[a-zA-Z0-9.-]{1,40}',version):raise ValueError('Instalación no válida.')
    release=(home/'releases'/version).resolve();app=release/'app';site=release/'python/Lib/site-packages'
    if not app.is_dir() or not app.resolve().is_relative_to(home.resolve()):raise ValueError('La aplicación está fuera de su instalación.')
    data=Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data'
    backup=Path(os.environ['LOCALAPPDATA'])/'Brivany/migration-backups/20261114-whatsapp-desktop'
    backup.mkdir(parents=True,exist_ok=True);changed=[]
    def copy(source,target,relative):
        if target.exists() and digest(source)==digest(target):return
        saved=backup/relative
        if target.exists() and not saved.exists():saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,saved)
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
        if digest(source)!=digest(target):raise ValueError('La copia no coincide con su origen.')
        changed.append({'path':str(relative).replace('\\','/'),'sha256':digest(target)})
    for name in FILES:
        if not (ROOT/name).is_file():raise ValueError('Falta un archivo de aplicación: '+name)
    for name in FILES:
        source=ROOT/name;target=app/name
        if not source.is_file():raise ValueError('Falta un archivo de aplicación: '+name)
        if not target.resolve().is_relative_to(app.resolve()):raise ValueError('Ruta fuera de la aplicación.')
        copy(source,target,Path('app')/name)
    done={};todo=[]
    installed={canonicalize_name(d.metadata['Name']):d for d in metadata.distributions(path=[str(site)]) if d.metadata.get('Name')}
    while todo:
        name=canonicalize_name(todo.pop())
        if name in done:continue
        dist=metadata.distribution(name);done[name]=dist.version
        for spec in dist.requires or []:
            req=Requirement(spec)
            if req.marker is None or req.marker.evaluate({'extra':''}):todo.append(req.name)
        old=installed.get(name)
        if old and old.version==dist.version:continue
        for file in dist.files or []:
            rel=Path(str(file))
            if rel.is_absolute() or '..' in rel.parts or '__pycache__' in rel.parts or rel.suffix in {'.pyc','.pyo'}:continue
            source=Path(dist.locate_file(file));target=site/rel
            if source.is_file() and target.resolve().is_relative_to(site.resolve()):copy(source,target,Path('python/Lib/site-packages')/rel)
    # Reuse only the existing Telnyx configuration. Preserve every unrelated key.
    from tools.setup_telnyx_control import save_environment
    from services.telephony.call_control import ENV_KEYS
    def values(path):
        result={}
        if path.is_file():
            for line in path.read_text(encoding='utf-8-sig').splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    key,value=(part.strip() for part in line.split('=',1));result[key]=value.strip('\"\'')
        return result
    existing=values(data/'.env');source=values(ROOT/'.env');add={k:source[k] for k in ENV_KEYS if source.get(k) and not existing.get(k)}
    if add:
        if (data/'.env').is_file() and not (backup/'configuration-before.dpapi').exists():SecureAccountFile(backup/'configuration-before.dpapi').save({'text':(data/'.env').read_text(encoding='utf-8-sig')})
        save_environment(add,data/'.env')
    connector_name='cloudflared-2026.10.7-windows-amd64.exe';source=ROOT/'.local/tools'/connector_name;target=data/'.local/tools'/connector_name
    if not target.is_file():
        if digest(source)!='2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343':raise ValueError('El conector no coincide con la versión verificada.')
        copy(source,target,Path('tools')/connector_name)
    report={'application':str(app),'files':changed,'dependencies':done,'configurationKeysMigrated':sorted(add),'userDataPreserved':True}
    path=ROOT/'.local/whatsapp-migration/reports/native-desktop-install-20261114.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'filesUpdated':len(changed),'dependencies':done,'telnyxKeysMigrated':len(add),'report':str(path)}))

def enroll_operator(*,recover_zeroed=False):
    """One-time migration of the explicitly authorized original operator only."""
    backup=Path(os.environ['LOCALAPPDATA'])/'Brivany/migration-backups/20261113-vetsa-before-melodi'
    location=backup/'desktop-enrollment.json'
    value=json.loads(location.read_text(encoding='utf-8'))
    if value.get('phone')!='18495205246' or not isinstance(value.get('userId'),str) or not value['userId']:
        raise ValueError('La migración no corresponde al operador autorizado.')
    path=Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data/.local/whatsapp-desktop/host.dpapi'
    secure=SecureAccountFile(path)
    try:profile=secure.load() if path.is_file() else None
    except Exception:
        raw=path.read_bytes()
        if not recover_zeroed or not raw or len(raw)>65536 or any(raw):raise ValueError('El vínculo cifrado no es legible; se ha conservado.') from None
        archived=Path(os.environ['LOCALAPPDATA'])/'Brivany/migration-backups/20261114-whatsapp-desktop'/('host-zeroed-'+hashlib.sha256(raw).hexdigest()[:12]+'.dpapi')
        archived.parent.mkdir(parents=True,exist_ok=True)
        if not archived.exists():shutil.copy2(path,archived)
        if archived.read_bytes()!=raw:raise ValueError('No se pudo respaldar el vínculo dañado.')
        value['previousDeviceId']=value.get('deviceId');profile=None
    if profile:
        if profile.get('userId')!=value['userId'] or not profile.get('operator_enrolled'):
            raise ValueError('Ya existe un vínculo de escritorio; se ha conservado.')
    else:
        profile={'deviceId':str(uuid4()),'deviceKey':secrets.token_hex(32),
                 'userId':value['userId'],'enabled':True,'name':platform.node()[:80] or 'Mi ordenador',
                 'operator_enrolled':True,'jobs':{},'pull':None}
        path.parent.mkdir(parents=True,exist_ok=True);secure.save(profile)
        if secure.load()!=profile:raise ValueError('No se confirmó el guardado DPAPI del nuevo vínculo.')
    value.update(deviceId=profile['deviceId'],keyHash=hashlib.sha256(profile['deviceKey'].encode()).hexdigest(),name=profile['name'])
    location.write_text(json.dumps(value),encoding='utf-8')
    print(json.dumps({'operatorEnrolledLocally':True,'credentialsProtected':True}))

if __name__=='__main__':
    if sys.argv[1:]==['--enroll-operator']:enroll_operator()
    elif sys.argv[1:]==['--recover-zeroed-operator']:enroll_operator(recover_zeroed=True)
    elif not sys.argv[1:]:install()
    else:raise SystemExit('Argumento no válido.')
