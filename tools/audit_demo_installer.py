"""Audit the private demo artifact; output counts/hashes, never secrets."""
from pathlib import Path
import hashlib,json,re,zipfile
from tools.setup_demo_account import operations
ROOT=Path(__file__).resolve().parents[1]

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        while chunk:=stream.read(1024*1024):h.update(chunk)
    return h.hexdigest()

def main():
    version=json.loads((ROOT/'desktop/distribution/version.json').read_text())['version'];folder=ROOT/'Exports'/('Brivany-Jon-Demo-'+version);archive=folder/f'Brivany-Jon-Demo-{version}-windows-x64.zip';installer=folder/f'Brivany-Jon-Demo-Setup-{version}-x64.exe'
    values=[]
    for line in ((ROOT/'.env').read_text(encoding='utf-8-sig').splitlines() if (ROOT/'.env').exists() else []):
        if '=' not in line or line.lstrip().startswith('#'):continue
        name,value=line.split('=',1);value=value.strip().strip('\"\'')
        if re.search('API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|CLIENT_SECRET|SIGNING_KEY|APP_SECRET',name) and len(value)>=16:values.append(value.encode())
    ops=operations();values.extend(ops[k].encode() for k in ['admin','setup','data_key']);pattern=re.compile(b'|'.join(re.escape(v) for v in values));tail=max(map(len,values));hits=[];forbidden=[];private_invites=0;paths=0
    expected=json.loads((ROOT/'.local/demo-jon/bootstrap.json').read_text(encoding='utf-8'))
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            paths+=1;parts=Path(entry.filename).parts
            if any(p.lower() in {'.env','.local','.git','user data','video-private','exports'} for p in parts) or entry.filename.startswith('app/Examples/') or entry.filename.endswith(('.dpapi','.pfx','.p12','.key','.log','.sqlite3')):forbidden.append(entry.filename)
            if entry.filename.endswith('demo-bootstrap.json'):
                if entry.filename!='app/desktop/distribution/demo-bootstrap.json' or json.loads(z.read(entry))!=expected:raise ValueError('Unexpected private bootstrap')
                private_invites+=1
            previous=b''
            with z.open(entry) as stream:
                while chunk:=stream.read(8*1024*1024):
                    if pattern.search(previous+chunk):hits.append(entry.filename);break
                    previous=chunk[-tail:]
    if hits or forbidden or private_invites!=1:
        print(json.dumps({'matching_paths_only':hits[:20],'forbidden_paths':forbidden[:20],'invitation_count':private_invites}));raise ValueError('Artifact audit failed; do not distribute.')
    from services.computer.backend import verify_bundle
    bundle=ROOT/'.local/distribution'/('build-'+version+'-jon-demo')/'payload/releases'/version/'app/computer-backend/0e902343e34f8ac5b25c2eb90f3a8a15'
    verify_bundle(bundle,force=True)
    proof={'edition':'private-jon-demo','version':version,'provider_secrets_found':len(hits),'forbidden_paths_found':len(forbidden),'known_private_values_checked':len(values),'limited_invitation_files':private_invites,'archive_entries_checked':paths,'verified_backend_included':True,'installer_bytes':installer.stat().st_size,'installer_sha256':digest(installer),'archive_sha256':digest(archive),'new_provider_keys_origin':'encrypted_server_only_not_local_build_inputs','authenticode_signed':False}
    (folder/'private-audit.json').write_text(json.dumps(proof,indent=2),encoding='utf-8');print(json.dumps(proof))

if __name__=='__main__':main()
