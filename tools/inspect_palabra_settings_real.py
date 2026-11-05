"""One authorized configuration-only session. No audio, transcripts or secrets."""
import argparse,json,re,time
from datetime import datetime,timezone
from pathlib import Path
from uuid import uuid4
from websockets.sync.client import connect
from services.h1.server import load_local_config
from packages.providers.palabra import palabra_key,URL,task_settings

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-provider',action='store_true');args=parser.parse_args()
    if not args.allow_provider:parser.error('Explicit --allow-provider required.')
    load_local_config();report={'started_at':datetime.now(timezone.utc).isoformat(),'provider_sessions':1,'audio_input_bytes':0,'actual_billed_usd':None,'purpose':'Inspect applied settings to explain long segmentation and unverified profile.','fields':{},'shape':{}}
    permitted={'source_language','target_language','translate_partial_transcriptions','segment_confirmation_silence_threshold','only_confirm_by_silence','enabled','desired_queue_level_ms','max_queue_level_ms','min_tempo','max_tempo','auto_tempo','voice_id','voice_cloning'}
    def inspect(value,path='data',depth=0):
        if depth>8:return
        if isinstance(value,dict):
            report['shape'][path]=[key for key in value if re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,63}',key)][:32]
            for key,item in value.items():
                if key in permitted and isinstance(item,(str,bool,int,float)) and len(str(item))<50:report['fields'][path+'.'+key]=item
                elif isinstance(item,(dict,list)) and re.fullmatch('[A-Za-z_][A-Za-z0-9_]{0,63}',key):inspect(item,path+'.'+key,depth+1)
        elif isinstance(value,list):
            for index,item in enumerate(value[:3]):inspect(item,path+f'[{index}]',depth+1)
    with connect(URL.format(random_hash=uuid4().hex),additional_headers={'Authorization':'Bearer '+palabra_key()},open_timeout=8,close_timeout=2,max_size=1048576,compression=None,proxy=None) as socket:
        socket.send(json.dumps(task_settings('auto','es')));deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            event=json.loads(socket.recv(timeout=10))
            if event.get('message_type')=='task_status':break
        socket.send(json.dumps({'message_type':'get_task','data':{'exclude_hidden':False}}))
        for _ in range(8):
            event=json.loads(socket.recv(timeout=5))
            if event.get('message_type')=='current_task':inspect(event.get('data'));break
        socket.send(json.dumps({'message_type':'end_task','data':{'force':True}}))
    report['finished_at']=datetime.now(timezone.utc).isoformat()
    directory=Path('tmp/palabra-settings-real');directory.mkdir(exist_ok=True,parents=True)
    (directory/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
