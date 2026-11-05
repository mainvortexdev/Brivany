"""Re-evaluate the trial's own artifacts without regenerating images/files."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
import json
from pathlib import Path
import threading
from types import SimpleNamespace
from services.computer.planner import MetaPlanner
from services.h1.server import load_local_config
from services.orchestration.meta import MetaTools
from services.orchestration.team import TeamOrchestrator,validate_team
from tools.check_team_real import PROMPT,ROOT

def run(source):
 load_local_config();source=Path(source).resolve()
 if not source.is_relative_to(ROOT/'tmp/orchestration'):raise ValueError('Own trial report required')
 previous=json.loads(source.read_text(encoding='utf-8'));artifacts={row['kind']:row['path'] for row in previous.get('artifacts',[])}
 cancelled=threading.Event();calls=[];planner=MetaPlanner();tools=MetaTools();counter=threading.Lock()
 def charge():
  with counter:calls.append(1)
 def request_plan(parent,prompt,data,images=None,**kwargs):charge();return planner.generate(prompt,data,images=images,cancelled=cancelled,**kwargs)
 service=SimpleNamespace(workspace=ROOT/'.local/computer/workspace',request_plan=request_plan)
 coordinator=TeamOrchestrator(service);report={'passed':False,'type':'real_meta_review_reuses_own_trial_artifacts','regenerated_images':0,'originals_modified':False,'source_report':source.name}
 try:
  tasks=validate_team(tools.plan({'instruction':PROMPT,'authorized_user_request':PROMPT},[],cancelled,charge))
  def check(task):
   if task.kind not in artifacts:raise ValueError('Missing own fixture artifact')
   identifier=Path(artifacts[task.kind]).stem
   child=json.loads((ROOT/'.local/computer/receipts'/(identifier+'.json')).read_text(encoding='utf-8'))
   if child['kind']!=task.kind or child['result']['path']!=artifacts[task.kind]:raise ValueError('Own artifact provenance mismatch')
   value=coordinator.check({},task,child);return task.kind,value
  with ThreadPoolExecutor(max_workers=2) as pool:values=list(pool.map(check,tasks))
  private=ROOT/'.local/orchestration';private.mkdir(exist_ok=True);(private/'own-review-details.json').write_text(json.dumps(dict(values),ensure_ascii=False,indent=2),encoding='utf-8')
  report['verdicts']=[{'kind':kind,'accepted':value['accepted'],'technical_passed':value['technical_passed'],'checks':[{'index':c['index'],'passed':c['passed']} for c in value['checks']]} for kind,value in values]
  report['passed']=len(values)==3 and all(value['accepted'] for _,value in values)
 except Exception as error:report['error_code']=type(error).__name__;report['error_detail']=str(error)[:240] if isinstance(error,ValueError) else 'Provider/transport error'
 report['known_meta_requests']=len(calls);path=ROOT/'tmp/orchestration'/('review-reuse-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({'report':str(path.relative_to(ROOT)),**report}));return report['passed']

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('report');parser.add_argument('--allow-paid',action='store_true');args=parser.parse_args()
 if not args.allow_paid:parser.error('Explicit --allow-paid is required')
 raise SystemExit(0 if run(args.report) else 1)
