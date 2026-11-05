"""Two new questions: real Meta plans/answers and real read-only Windows data."""
from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
import threading
import time
from uuid import uuid4
from services.h1.server import load_local_config
from services.computer.planner import MetaPlanner
from services.computer.runtime import NativeRuntime,ROOT
from services.terminal.service import TerminalService

def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--allow-network',action='store_true');args=parser.parse_args()
    if not args.allow_network:parser.error('This test makes up to four Meta requests; pass --allow-network.')
    load_local_config();planner=MetaPlanner();calls=0
    report={'passed':False,'time':datetime.now(timezone.utc).isoformat(),'scope':'real Meta composition and answers with current Windows facts; questions not mapped to fixed answers','provider_requests':0,'billing_usd':None,'native_input_sent':False,'query_text_or_answer_saved':False,'cases':[]}
    with tempfile.TemporaryDirectory(prefix='brivany-adaptive-') as folder:
        service=TerminalService(folder);runtime=NativeRuntime(Path(folder)/'workspace',proxy='http://127.0.0.1:1',token=uuid4().hex);facts=[]
        def decide(prompt,data):
            nonlocal calls
            calls+=1
            if 'facts' in data:facts.append(data['facts'])
            return planner.generate(prompt,data,cancelled=threading.Event(),max_tokens=1600)
        try:
            questions=['¿Qué tres procesos están usando más memoria RAM en este momento? Indica sus nombres y cuánto usa cada uno en MiB.','¿Cuántos servicios con inicio automático están detenidos ahora?']
            for i,question in enumerate(questions):
                began=time.monotonic();result=service.run(question,decide=decide,identifier=uuid4().hex,cancelled=threading.Event(),progress=lambda _:None,runtime=runtime)
                actual=result['facts'];assert result['verified'] and actual['verified'] and result['message'].strip()
                if i==0:
                    assert actual['source']=='processes' and len(actual['rows'])==3
                    assert all(row.get('ProcessName','').casefold() in result['message'].casefold() for row in actual['rows'])
                    assert 'mib' in result['message'].casefold()
                else:
                    assert actual['source']=='services' and actual['aggregate']['op']=='count'
                    assert str(actual['aggregate']['value']) in result['message']
                report['cases'].append({'source_command':actual['source_command'],'source':actual['source'],'rows':len(actual['rows']),'aggregate':actual.get('aggregate'),'answer_based_on_current_facts':True,'elapsed_seconds':round(time.monotonic()-began,3)})
            assert calls==4;report['passed']=True
        except Exception as error:report['error']=str(error)[:240]
        finally:runtime.close();service.close()
    report['provider_requests']=calls;(ROOT/'tmp/adaptive-diagnostics-real.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
