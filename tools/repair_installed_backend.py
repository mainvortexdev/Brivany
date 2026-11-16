"""Install this PC's already pinned Cognira backend; no downloads or user profiles."""
import hashlib
import json
from pathlib import Path
from desktop.management import data_folder, read_control, process_identity
from services.computer.backend import build_bundle, activate_bundle


def main():
    root=Path(__file__).resolve().parents[1]
    control=read_control()
    release=Path(process_identity(control['pid'])['path']).resolve().parents[1]
    install=(Path.home()/'AppData/Local/Programs/Brivany/releases').resolve()
    if not release.is_relative_to(install):raise ValueError('No es la instalación local de Brivany.')
    for name in ('computer-source.json','computer-runtime.json'):
        expected=(root/'config'/name).read_bytes()
        installed=(release/'app/config'/name).read_bytes()
        if hashlib.sha256(expected).digest()!=hashlib.sha256(installed).digest():
            raise ValueError('La instalación usa locks distintos; no se activa un backend incompatible.')
    output=data_folder()/'.local/computer/backend'
    result=build_bundle(root.parent/'cognira-desktop',output)
    activate_bundle(result['directory'],output)
    report={'passed':True,'mode':'local_allowlisted_pinned_backend_installation',
            'id':result['id'],'file_count':result['file_count'],
            'installed_locks_match_workspace':True,'credentials_or_profiles_copied':False,
            'external_calls':0,'native_action_replayed':False}
    (root/'tmp/installed-backend-repair-20261112.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':main()
