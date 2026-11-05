"""Opt-in real Melodi planning, C# compilation and known fixture execution."""
import argparse
import json
from pathlib import Path
import threading
import uuid
from services.h1.server import load_local_config
from services.computer.planner import MetaPlanner
from services.computer.runtime import ROOT
from services.terminal.service import TerminalService

SOURCE='using System; class Hello { static int Main() { Console.WriteLine("Melodi executable verified"); return 0; } }\n'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',action='store_true');args=parser.parse_args()
    if not args.run:parser.error('La prueba usa planificación Meta, compilador local y una fixture ejecutable; requiere --run.')
    load_local_config();service=TerminalService(ROOT/'.local/terminal');name='Executable-Fixture-'+uuid.uuid4().hex[:8]
    project_root=service.executor.root/'projects'/name;source=project_root/'source';work=project_root/'work'
    source.mkdir(parents=True);work.mkdir()
    for folder in (source,work):(folder/'Hello.cs').write_text(SOURCE,encoding='utf-8')
    manifest={'work':str(work),'source':str(source),'repository':'local:synthetic-csharp-fixture','commit':None}
    (project_root/'project.json').write_text(json.dumps(manifest),encoding='utf-8')
    planner=MetaPlanner();calls=0;report={'type':'real_planner_and_compiler_known_source_fixture','success':False,'model_cost':'unknown'}
    def decide(prompt,data):
        nonlocal calls
        calls+=1;return planner.generate(prompt,data,max_tokens=1200)
    try:
        result=service.run('Crea un ejecutable del proyecto local '+name+' a partir de Hello.cs. Sólo compílalo, no lo ejecutes.',decide=decide,identifier=str(uuid.uuid4()),cancelled=threading.Event(),progress=lambda text:print(text,flush=True))
        if not result.get('created'):raise ValueError('El plan no creó el ejecutable solicitado.')
        binary=Path(result['path']);assert binary.read_bytes()[:2]==b'MZ'
        # This exact, application-authored fixture is separately executed for
        # verification. The product does not auto-run arbitrary build outputs.
        assert (work/'Hello.cs').read_text(encoding='utf-8')==SOURCE
        receipt=service.executor.run('test.known_csharp_fixture',str(binary),[],cwd=work,timeout=15)
        assert receipt['exit_code']==0 and receipt['output'].strip()=='Melodi executable verified' and not receipt['interrupted']
        assert (source/'Hello.cs').read_text(encoding='utf-8')==SOURCE
        report.update(success=True,result=result,execution_receipt=receipt['id'],source_preserved=True)
    finally:
        report['model_calls']=calls;folder=ROOT/'tmp/terminal-build-real';folder.mkdir(exist_ok=True)
        path=folder/(name+'.json');path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2));service.close()


if __name__=='__main__':main()
