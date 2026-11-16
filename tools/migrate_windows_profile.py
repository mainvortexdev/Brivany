"""Optional local-only migration. Never called by or bundled with the installer."""
from pathlib import Path
import argparse,json,os,shutil,sqlite3
ROOT=Path(__file__).resolve().parents[1]
FOLDERS=('workspace','work','translation','integrations','spotify','telephony','account','widgets','audio-ducking','personal','activity','computer','phone','phone-control','models','tools','spatial','sous','sous-vision','human-skills','terminal','references')

def migrate(source,destination):
 source=Path(source).resolve();destination=Path(destination).absolute()
 if destination.resolve()!=destination:raise ValueError('El destino no puede ser un enlace.')
 destination.mkdir(parents=True,exist_ok=True);count=0
 for name in FOLDERS:
  folder=source/'.local'/name
  if not folder.is_dir():continue
  for p in folder.rglob('*'):
   if not p.is_file() or p.is_symlink() or not p.resolve().is_relative_to(folder.resolve()):continue
   if p.name.endswith(('-wal','-shm')) or p.name=='demo-browser-handoff.json':continue
   target=destination/p.relative_to(source)
   if target.exists():continue
   target.parent.mkdir(parents=True,exist_ok=True)
   if p.suffix in {'.sqlite3','.sqlite','.db'}:
    # Include committed WAL state without copying a live SQLite file unsafely.
    with sqlite3.connect(p.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(target) as dst:src.backup(dst)
   else:shutil.copy2(p,target)
   count+=1
 if (source/'.env').is_file() and not (destination/'.env').exists():shutil.copy2(source/'.env',destination/'.env');count+=1
 return {'copied_files':count,'existing_files_overwritten':False,'destination':str(destination)}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=ROOT);parser.add_argument('--destination',type=Path,default=Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data');args=parser.parse_args();print(json.dumps(migrate(args.source,args.destination)))
