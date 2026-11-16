"""Prepare a release channel. By default only signed version metadata is exposed.

--packages explicitly includes the distributable binaries (and application code).
Run Wrangler deploy separately after reviewing the generated publication report.
"""
from pathlib import Path
import argparse,hashlib,json,shutil,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from desktop.distribution.updater import verify_manifest,TRUST

def prepare(release,*,packages=False,destination=None):
 release=Path(release).resolve();destination=Path(destination or ROOT/'.local/distribution/update-channel').absolute()
 if destination.resolve()!=destination or not destination.resolve().is_relative_to((ROOT/'.local/distribution').resolve()):raise ValueError('Unsafe channel destination.')
 if destination.exists():shutil.rmtree(destination)
 (destination/'windows').mkdir(parents=True)
 envelope=json.loads((release/'stable.json').read_text());p=verify_manifest(envelope,json.loads(TRUST.read_text()))
 shutil.copy2(release/'stable.json',destination/'windows/stable.json');catalog={}
 if packages:
  for path in sorted(release.iterdir()):
   if path.suffix not in {'.zip','.exe'}:continue
   digest=hashlib.sha256();parts=[]
   with path.open('rb') as stream:
    while block:=stream.read(20*1024*1024):
     digest.update(block);part='/parts/'+path.name+'.'+str(len(parts)).zfill(4)
     target=destination/part[1:];target.parent.mkdir(exist_ok=True);target.write_bytes(block);parts.append(part)
   value={'name':path.name,'size':path.stat().st_size,'sha256':digest.hexdigest(),'parts':parts}
   if path.suffix=='.zip' and (value['sha256']!=p['sha256'] or value['size']!=p['size']):raise ValueError('Archive differs from signed manifest.')
   catalog['/windows/'+path.name]=value
 (destination/'catalog.json').write_text(json.dumps(catalog))
 report={'version':p['version'],'packages_included':packages,'files':list(catalog),'destination':str(destination)}
 return report

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('release',type=Path);parser.add_argument('--packages',action='store_true');args=parser.parse_args()
 print(json.dumps(prepare(args.release,packages=args.packages)))
