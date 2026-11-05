"""Offline real bundle: native executor, owned note and GLB, then optional activation."""
import argparse
import json
from pathlib import Path
import subprocess
import threading
from uuid import uuid4
from unittest.mock import patch

from services.computer.backend import BUNDLES,ROOT,build_bundle,verify_bundle,activate_bundle,resolve_backend
from services.computer.runtime import NativeRuntime
from services.computer.models import publish_model,compiler_command
from services.spatial.jobs import SpatialService


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=ROOT.parent/'cognira-desktop');parser.add_argument('--activate',action='store_true');args=parser.parse_args()
    directory=ROOT/'tmp/computer-bundle-real';directory.mkdir(parents=True,exist_ok=True);workspace=directory/('fixture-'+uuid4().hex[:8]);workspace.mkdir()
    report={'scope':'offline bundle with real pinned Electron, native executor, own fixture note and local GLB compiler','external_calls':0,'physical_audio_verified':False,'checks':[]}
    runtime=None;spatial=None
    try:
        built=build_bundle(args.source);bundle=Path(built['directory']);report['bundle']={key:value for key,value in built.items() if key!='directory'}
        report['checks'].append('only pinned source/runtime files and notices copied and verified')
        runtime=NativeRuntime(workspace/'native',proxy='http://127.0.0.1:1',token='fixture-'+uuid4().hex,source=bundle)
        availability=runtime.availability();assert availability['available'] and availability['bundle_verified'];report['runtime_source_mode']=availability['source_mode']
        probe=runtime.call('probe',timeout=25);assert probe['source_available'];report['checks'].append('real native executor started from bundled source and bundled Electron')
        note=runtime.call('execute',step={'action':'write_note','params':{'name':'bundle-fixture.txt','text':'Prueba local del backend empaquetado. ñ $() {ENTER}'}},timeout=30)
        file=Path(note['path']);assert file.is_relative_to(workspace.resolve()) and file.read_text(encoding='utf-8')=='Prueba local del backend empaquetado. ñ $() {ENTER}'
        report['checks'].append('bundled executor wrote exact literal bytes to its own new note')
        plan={'title':'Mesa del paquete local','assumptions':'Fixture procedural sin dimensiones verificadas.','objects':[
            {'name':'Tablero','type':'box','position':[0,1,0],'size':[2,.12,1],'color':'#b68c69'},
            {'name':'Soporte','type':'cylinder','position':[0,.5,0],'size':[.15,1,.15],'color':'#267f78'},
            {'name':'Base','type':'box','position':[0,.05,0],'size':[.8,.1,.6],'color':'#267f78'}]}
        spatial=SpatialService(workspace/'spatial',start_worker=False,seed_demo=False)
        with patch('services.computer.models.shutil.which',side_effect=AssertionError('The bundle must not require global Node')):
            command,env=compiler_command(bundle)
            version=subprocess.run([command[0],'-e','process.stdout.write(JSON.stringify({node:process.versions.node,electron:process.versions.electron}))'],env=env,capture_output=True,text=True,timeout=10,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            assert version.returncode==0;versions=json.loads(version.stdout);assert versions['node']==built['versions']['node'] and versions['electron']==built['versions']['electron'];report['compiler_versions']=versions
            model=publish_model(plan,spatial,bundle,threading.Event())
        assert model['object_count']==3
        scene=spatial.scene(model['scene_id'])['scene'];assert scene['origin']=='generated_demo' and scene['units']=='source_relative'
        for asset in scene['assets']:assert spatial.asset(model['scene_id'],asset['id'])[0][:4]==b'glTF'
        report['checks'].append('bundled Electron in Node mode compiled and published three valid local GLBs without system Node')
        verify_bundle(bundle,force=True);report['checks'].append('bundle remained unchanged after execution')
        if args.activate:
            activate_bundle(bundle);selected=resolve_backend(environ={});assert selected.source==bundle and selected.mode=='bundled'
            report['checks'].append('verified bundle activated for new Brivany sessions')
        report.update(status='passed',activated=args.activate,system_node_used=False,object_count=3)
    except Exception as error:report.update(status='failed',failure=str(error))
    finally:
        if runtime:runtime.close()
        if spatial:spatial.close()
        (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
