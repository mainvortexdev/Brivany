"""Build a reproducible allowlisted Windows payload from installed dependencies.

No user .env, tokens, profiles, recordings, checkout .local or signing key ships.
Run with the verified development venv. Nothing is downloaded by this script.
"""
from pathlib import Path
import argparse,base64,hashlib,importlib.metadata as metadata,json,os,re,shutil,subprocess,sys,time,zipfile
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ROOT=Path(__file__).resolve().parents[1]
PRIVATE=ROOT/'.local/distribution';PRIVATE.mkdir(parents=True,exist_ok=True)
VERSION=json.loads((ROOT/'desktop/distribution/version.json').read_text())['version']
BUILD=PRIVATE/('build-'+VERSION);PAYLOAD=BUILD/'payload';RELEASE=PAYLOAD/'releases'/VERSION
OUT=ROOT/'Exports'/('Brivany-Windows-'+VERSION)
OUT.mkdir(parents=True,exist_ok=True)

def filehash(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  while chunk:=f.read(1024*1024):h.update(chunk)
 return h.hexdigest()

def signing_key():
 sys.path.insert(0,str(ROOT))
 from services.google_oauth import WindowsDPAPIProtector
 from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
 from cryptography.hazmat.primitives.serialization import Encoding,PrivateFormat,PublicFormat,NoEncryption
 protector=WindowsDPAPIProtector();path=PRIVATE/'publisher-key.dpapi'
 if path.exists():raw=protector.unprotect(path.read_bytes())
 else:
  key=Ed25519PrivateKey.generate();raw=key.private_bytes(Encoding.Raw,PrivateFormat.Raw,NoEncryption())
  path.write_bytes(protector.protect(raw))
 key=Ed25519PrivateKey.from_private_bytes(raw)
 public=base64.b64encode(key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode()
 return key,public

def copy_dependencies(target):
 names=['pydantic','websockets','aiohttp','pywebview','SoundCard','numpy','certifi','Pillow','ai-edge-litert','onnxruntime','scipy','soxr','segno','cryptography','sherpa-onnx','pypdf']
 done={};todo=list(names)
 while todo:
  name=canonicalize_name(todo.pop())
  if name in done:continue
  dist=metadata.distribution(name);done[name]=dist.version
  for spec in dist.requires or []:
   req=Requirement(spec)
   if req.marker is None or req.marker.evaluate({'extra':''}):todo.append(req.name)
  for f in dist.files or []:
   rel=Path(str(f))
   if rel.is_absolute() or '..' in rel.parts or '__pycache__' in rel.parts or rel.suffix in {'.pyc','.pyo'}:continue
   src=Path(dist.locate_file(f))
   if not src.is_file():continue
   dst=target/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 return done

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--iscc',type=Path);parser.add_argument('--refresh',action='store_true',help='Refresh application sources while reusing the verified Python runtime.')
 parser.add_argument('--bundle-motion-binaries',action='store_true',help='Include existing Node/FFmpeg/FFprobe from PATH in app/runtime-bin; downloads nothing.')
 args=parser.parse_args()
 # Resolve missing motion dependencies before replacing any private build tree.
 from tools.stage_motion_runtime import node_runtime_entries,portable_binary_entries
 motion_entries=node_runtime_entries(ROOT)
 if args.bundle_motion_binaries:motion_entries+=portable_binary_entries()
 key,public=signing_key()
 trust={'manifest_url':'https://brivany.vetsa.es/windows/stable.json','public_key':public}
 (ROOT/'desktop/distribution/update-trust.json').write_text(json.dumps(trust,indent=2))
 if BUILD.exists() and not args.refresh:raise SystemExit('Build directory exists. Use --refresh to reuse the verified runtime.')
 runtime=RELEASE/'python'
 # Keep the tested CPython runtime. Standard library only; no development pip,
 # tests, caches, or unrelated venv dependencies.
 if args.refresh:
  deps=json.loads((RELEASE/'app/desktop/distribution/dependencies.json').read_text())
  target=(RELEASE/'app').resolve()
  if target.parent!=RELEASE.resolve() or not target.is_relative_to(PRIVATE.resolve()) or (RELEASE/'app').is_symlink():raise SystemExit('Unsafe build directory.')
  shutil.rmtree(target)
 else:
  runtime.mkdir(parents=True)
  base=Path(sys.base_prefix)
  for name in ['python.exe','pythonw.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt']:
   shutil.copy2(base/name,runtime/name)
  shutil.copytree(base/'DLLs',runtime/'DLLs',ignore=shutil.ignore_patterns('*.pdb','*.lib'))
  shutil.copytree(base/'Lib',runtime/'Lib',ignore=shutil.ignore_patterns('site-packages','test','tests','__pycache__','ensurepip','idlelib','tkinter','turtledemo','*.pyc'))
  deps=copy_dependencies(runtime/'Lib/site-packages')
 (RELEASE/'app').mkdir(parents=True)
 folders=['desktop','services','packages','contracts','config','web','data']
 exclude={'node_modules','__pycache__','.git','.local','dist','build','tests'}
 for name in folders:
  src=ROOT/name
  for p in src.rglob('*'):
   rel=p.relative_to(ROOT)
   if not p.is_file() or any(x in exclude for x in rel.parts) or p.suffix in {'.pyc','.pyo','.log','.sqlite3','.dpapi','.pfx'} or p.name.startswith('.env'):continue
   if name=='desktop' and 'ui' in rel.parts and p.suffix not in {'.js','.css','.json'}:continue
   dst=RELEASE/'app'/rel;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dst)
 # Referenced Python workers; no cloud secrets or project outputs.
 for p in (ROOT/'workers').glob('*.py'):
  dst=RELEASE/'app/workers'/p.name;dst.parent.mkdir(exist_ok=True);shutil.copy2(p,dst)
 # Only the dedicated first-party Call Control host and its setup helper.
 for name in ['__init__.py','serve_telnyx_control.py','setup_telnyx_control.py']:
  src=ROOT/'tools'/name
  if src.is_file():
   dst=RELEASE/'app/tools'/name;dst.parent.mkdir(exist_ok=True);shutil.copy2(src,dst)
 # Existing compiled animation assets and their pinned MIT source, no dev caches.
 for name in ['motion-studio/dist','motion-studio/render.mjs','integrations/bang-motion.lock.json','integrations/bang-motion/LICENSE']:
  src=ROOT/name;dst=RELEASE/'app'/name
  if src.is_dir():shutil.copytree(src,dst)
  elif src.is_file():dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 # The generalized story service needs its pinned CLI and dependency closure.
 # Source assets under services/motion/assets were already copied above.
 for relative,src in motion_entries:
  dst=RELEASE/'app'/relative;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 lock=json.loads((ROOT/'integrations/bang-motion.lock.json').read_text())
 for rel in lock['files']:
  src=ROOT/'integrations/bang-motion'/rel;dst=RELEASE/'app/integrations/bang-motion'/rel
  dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
 for name in ['README.md','LICENSE','.env.example','requirements-h1.txt','requirements-contracts.txt','requirements-desktop.txt']:
  if (ROOT/name).is_file():shutil.copy2(ROOT/name,RELEASE/'app'/name)
 # Bundled third-party notices are kept next to their distributions.
 (RELEASE/'app/desktop/distribution/dependencies.json').write_text(json.dumps(deps,indent=2))
 (PAYLOAD/'current.json').write_text(json.dumps({'version':VERSION}))
 csc=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
 subprocess.run([str(csc),'/nologo','/target:winexe','/platform:x64','/optimize+',
  '/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',
  '/win32icon:'+str(ROOT/'desktop/assets/brivany.ico'),'/out:'+str(PAYLOAD/'Brivany.exe'),str(ROOT/'desktop/distribution/Launcher.cs')],check=True)
 archive=OUT/f'Brivany-{VERSION}-windows-x64.zip';expanded=0
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=5) as z:
  for p in RELEASE.rglob('*'):
   if p.is_file():z.write(p,p.relative_to(RELEASE).as_posix());expanded+=p.stat().st_size
 from desktop.distribution.updater import canonical
 now=int(time.time());payload={'schema':1,'version':VERSION,'channel':'stable','url':f'https://brivany.vetsa.es/windows/{archive.name}',
 'sha256':filehash(archive),'size':archive.stat().st_size,'expanded_size':expanded,'published':now,'expires':now+365*86400,'min_launcher':1}
 envelope={'payload':payload,'signature':base64.b64encode(key.sign(canonical(payload))).decode()}
 (OUT/'stable.json').write_text(json.dumps(envelope,indent=2))
 report={'version':VERSION,'payload':str(PAYLOAD),'runtime':sys.version.split()[0],'dependencies':deps,'expanded_bytes':expanded,'zip_bytes':archive.stat().st_size,'sha256':payload['sha256'],'private_files_included':False,'motion_cli_included':True,'motion_binary_mode':'bundled' if args.bundle_motion_binaries else 'existing_system_path'}
 (OUT/'build-report.json').write_text(json.dumps(report,indent=2))
 if args.iscc:
  subprocess.run([str(args.iscc),'/Qp','/DPayload='+str(PAYLOAD),'/DAppVersion='+VERSION,'/DOutputDir='+str(OUT),str(ROOT/'packaging/windows/Brivany.iss')],check=True)
 print(json.dumps(report))

if __name__=='__main__':main()
