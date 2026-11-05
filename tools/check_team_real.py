"""Explicit paid trial of own content. No secrets, transcripts or audio logged."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import time
from uuid import uuid4
from services.brivany_account import AccountHTTP,SecureAccountFile

ROOT=Path(__file__).resolve().parents[1]
PROMPT='Crea en paralelo estas tres cosas para una prueba de Brivany: una imagen original sin texto de un escritorio minimalista azul con una planta; un documento breve de bienvenida a Brivany en español con título y tres frases, sin afirmar funciones no verificadas; y una investigación en la documentación oficial de Python de qué hace pathlib.Path, con explicación breve y enlace. Guarda todo sólo en el espacio de trabajo de Brivany. No abras programas, no modifiques archivos existentes y no envíes mensajes.'

def run(documents_only=False):
 report={'passed':False,'scope':'real_account_desktop_and_meta_own_content','checked_at':datetime.now(timezone.utc).isoformat(),'physical_iphone':False,'microphone':False,'originals_modified':False,'calls':{'account_chat':0},'content_in_report':False};started=time.monotonic()
 output=ROOT/'tmp/orchestration';output.mkdir(parents=True,exist_ok=True)
 try:
  saved=SecureAccountFile(ROOT/'.local/mobile-accounts/preview-session.dpapi').load();token=saved['session']['token'];http=AccountHTTP()
  until=time.monotonic()+45
  while time.monotonic()<until:
   online=[d for d in http.call('/v1/devices',token=token)['devices'] if d['kind']=='desktop' and d['online']]
   if len(online)==1:break
   time.sleep(2)
  if len(online)!=1:raise ValueError('one_online_desktop_required')
  report['calls']['account_chat']+=1
  prompt='Crea exactamente dos documentos independientes en paralelo para una prueba de Brivany. Uno debe dar la bienvenida a Brivany en español, con título y dos frases. El otro debe ser una lista de tres ideas para organizar un escritorio, con título. Guarda ambos como documentos nuevos en el espacio de trabajo de Brivany. No abras programas ni modifiques archivos existentes.' if documents_only else PROMPT
  rows=list(http.chat([{'role':'user','content':prompt}],token,conversation_id=str(uuid4())))
  command=next((row.get('command') for row in rows if row.get('type')=='computer_job'),None)
  if not command:raise ValueError('no_team_delivered')
  report['command_id']=command['id'];report['broker_kind']=command.get('kind');last='';until=time.monotonic()+360
  while time.monotonic()<until:
   value=http.call('/v1/commands/'+command['id'],token=token)['command']
   receipt=ROOT/'.local/account/receipts'/(command['id']+'.json')
   local=json.loads(receipt.read_text()).get('local_id') if receipt.exists() else None
   file=ROOT/'.local/computer/receipts'/(str(local)+'.json')
   parent=json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}
   child_rows=[]
   for identifier in parent.get('children',[]):
    child_file=ROOT/'.local/computer/receipts'/(identifier+'.json')
    if child_file.exists():child_rows.append(json.loads(child_file.read_text(encoding='utf-8')))
   signature=json.dumps({'parent':parent.get('state'),'children':[(j['kind'],j['state'],j.get('attempt')) for j in child_rows]},sort_keys=True)
   if signature!=last:
    print(json.dumps({'stage':'team_progress','parent':parent.get('state'),'agents':[{'kind':j['kind'],'state':j['state'],'attempt':j.get('attempt')} for j in child_rows]},ensure_ascii=False),flush=True);last=signature
   if value['state'] in {'succeeded','failed','cancelled','uncertain'}:
    report['state']=value['state'];report['local_state']=parent.get('state');report['error']=parent.get('error');report['team_size']=parent.get('team_size');report['accepted']=(parent.get('result') or {}).get('accepted');report['attempts']=[{'kind':j['kind'],'state':j['state'],'attempt':j.get('attempt'),'review_state':j.get('review_state'),'external_calls':j.get('external_calls')} for j in child_rows]
    report['known_host_provider_attempts']=parent.get('external_calls',0)+sum(j.get('external_calls',0) for j in child_rows)
    report['artifacts']=[{'kind':j['kind'],'path':(j.get('result') or {}).get('path'),'review_state':j.get('review_state')} for j in child_rows if (j.get('result') or {}).get('path')]
    intervals=[(j.get('execution_started_at'),j.get('execution_finished_at')) for j in child_rows]
    report['execution_overlap_seconds']=round(max(0,min(end for start,end in intervals)-max(start for start,end in intervals)),3) if intervals and all(start is not None and end is not None for start,end in intervals) else None
    expected=2 if documents_only else 3;report['documents_only']=documents_only
    report['passed']=value['state']=='succeeded' and parent.get('team_size')==expected and report['accepted']==expected and (not documents_only or report['execution_overlap_seconds']>0)
    break
   time.sleep(2)
  else:raise ValueError('trial_timeout')
 except Exception as error:report['error_code']=str(error)[:180] if isinstance(error,ValueError) else type(error).__name__
 report['elapsed_seconds']=round(time.monotonic()-started,2);path=output/('real-team-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'report':str(path.relative_to(ROOT)),**report},ensure_ascii=False),flush=True);return report['passed']

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',action='store_true');parser.add_argument('--documents-only',action='store_true');args=parser.parse_args()
 if not args.allow_paid:parser.error('Explicit --allow-paid is required')
 raise SystemExit(0 if run(args.documents_only) else 1)
