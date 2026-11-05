"""Check pinned local render modules and transitive imports; no network."""
import hashlib,json,re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def main():
    directory=ROOT/'web/vendor/three'
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    checked=[]
    for entry in manifest['files']:
        file=directory/entry['path']
        assert file.resolve().is_relative_to(directory.resolve())
        assert hashlib.sha256(file.read_bytes()).hexdigest()==entry['sha256'],file.name
        if file.suffix=='.js':
            source=re.sub(r'/\*.*?\*/','',file.read_text(encoding='utf-8'),flags=re.S)
            for imported in re.findall(r"(?m)^\s*(?:import|export)\b[^;]*?\bfrom\s+['\"]([^'\"]+)['\"]",source):
                assert imported.startswith(('.', '/vendor/three/')),imported
                target=ROOT/'web'/imported.lstrip('/') if imported.startswith('/') else file.parent/imported
                assert target.resolve().is_relative_to(directory.resolve()) and target.is_file(),imported
        checked.append(entry['path'])
    print(json.dumps({'status':'passed','package':'three','version':manifest['version'],'license':manifest['license'],
      'files_checked':checked,'runtime_external_requests':0,'external_calls':0,'scope':'Integrity and import closure, not rendered scene quality.'}))

if __name__=='__main__':main()
