"""Check the distributable against local private paths/known provider secrets.

Reports only counts, hashes and public version metadata; never secret values.
"""
from pathlib import Path
import argparse,hashlib,json,re,sys,zipfile
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from desktop.distribution.updater import TRUST,fetch,verify_manifest

def audit(*,local_only=False):
 version=json.loads((ROOT/'desktop/distribution/version.json').read_text())['version'];out=ROOT/'Exports'/('Brivany-Windows-'+version)
 values=[]
 for line in ((ROOT/'.env').read_text(encoding='utf-8-sig').splitlines() if (ROOT/'.env').exists() else []):
  if '=' not in line or line.lstrip().startswith('#'):continue
  name,value=line.split('=',1);value=value.strip().strip('\"\'')
  if re.search('API_KEY|TOKEN|PASSWORD|PRIVATE_KEY|CLIENT_SECRET|SIGNING_KEY|APP_SECRET',name) and len(value)>=16:values.append(value.encode())
 pattern=re.compile(b'|'.join(re.escape(v) for v in values)) if values else None
 forbidden=[];hits=[]
 with zipfile.ZipFile(out/f'Brivany-{version}-windows-x64.zip') as z:
  for entry in z.infolist():
   parts=Path(entry.filename).parts
   if any(p.lower() in {'.env','.local','.git','user data','video-private','exports'} for p in parts) or entry.filename.startswith('app/Examples/') or entry.filename.endswith(('.dpapi','.pfx','.p12','.key','.log','.sqlite3')):forbidden.append(entry.filename)
   if pattern and pattern.search(z.read(entry)):hits.append(entry.filename)
 if forbidden or hits:raise ValueError(f'Private paths: {len(forbidden)}; configured secrets: {len(hits)}. Do not distribute.')
 trust=json.loads(TRUST.read_text());envelope=json.loads((out/'stable.json').read_text()) if local_only else json.loads(fetch(trust['manifest_url'],32768));p=verify_manifest(envelope,trust)
 if envelope!=json.loads((out/'stable.json').read_text()):raise ValueError('Published manifest differs from local release.')
 result={'private_paths_found':0,'configured_provider_secrets_found':0,'private_values_checked':len(values),'local_signed_manifest_valid':True,'public_https_feed_valid':not local_only,'audited_version':p['version'],'packages_published':False,'installer_sha256':hashlib.sha256((out/f'Brivany-Setup-{version}-x64.exe').read_bytes()).hexdigest()}
 (out/'release-validation.json').write_text(json.dumps(result,indent=2));return result

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--local-only',action='store_true',help='Audit the local signed package without assuming the HTTPS channel was deployed.')
 print(json.dumps(audit(local_only=parser.parse_args().local_only)))
