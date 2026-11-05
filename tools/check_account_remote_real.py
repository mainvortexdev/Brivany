"""Explicit own read-only account trial. Never logs tokens, PCM or transcripts."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import struct
import time
from urllib import request
from uuid import uuid4
from websockets.sync.client import connect
from services.brivany_account import AccountHTTP,SecureAccountFile,BASE

ROOT=Path(__file__).resolve().parents[1]
TEXT='Consulta cuánto tiempo lleva encendido este ordenador. No modifiques nada.'


def run(voice=False):
    saved=SecureAccountFile(ROOT/'.local/mobile-accounts/preview-session.dpapi').load();token=saved['session']['token'];http=AccountHTTP()
    report={'type':'real_account_and_desktop_read_only','source':'voice' if voice else 'chat','physical_iphone':False,'microphone_used':False,'audio_persisted':False,'transcripts_persisted':False,'calls':{'chat':0,'asr':0,'tts':0},'passed':False,'checked_at':datetime.now(timezone.utc).isoformat()};text=TEXT
    def speech(words):
        report['calls']['tts']+=1
        req=request.Request(BASE+'/v1/speech',data=json.dumps({'text':words}).encode(),method='POST',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'Brivany-Own-Test/1.0'})
        with request.urlopen(req,timeout=35) as response:pcm=response.read(2000001)
        if not pcm or len(pcm)>2000000 or len(pcm)%2:raise ValueError('invalid_tts')
        return pcm
    try:
        ready_until=time.monotonic()+45
        while True:
            devices=http.call('/v1/devices',token=token)['devices'];online=[d for d in devices if d['kind']=='desktop' and d['online']]
            if online:report['connected_computers']=len(online);break
            if time.monotonic()>ready_until:raise ValueError('desktop_not_connected')
            time.sleep(2)
        if voice:
            pcm=speech(TEXT);report['calls']['asr']+=1
            with connect(BASE.replace('https://','wss://')+'/v1/asr',additional_headers={'Authorization':'Bearer '+token},open_timeout=10,close_timeout=1,proxy=None) as socket:
                socket.send(json.dumps({'type':'start','language':'es'}));ready=json.loads(socket.recv(timeout=15));assert ready['type']=='ready'
                # Own synthetic input at exactly 1x, followed by one second silence.
                source=pcm+b'\x00'*48000;source+=b'\x00'*(-len(source)%3840);start=time.monotonic()
                for index in range(0,len(source),3840):
                    delay=start+index/48000-time.monotonic()
                    if delay>0:time.sleep(delay)
                    socket.send(source[index:index+3840])
                socket.send(json.dumps({'type':'finish'}));finals=[]
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    try:event=json.loads(socket.recv(timeout=1))
                    except TimeoutError:continue
                    except Exception:break
                    if event.get('type')=='error':raise ValueError('asr_error')
                    if event.get('type')=='speechComplete' and event.get('transcript'):finals.append(event['transcript'])
                text=' '.join(finals)
                if not text:raise ValueError('asr_empty')
                report['recognized_nonempty']=True;report['synthetic_source_seconds']=round(len(pcm)/48000,3)
        report['calls']['chat']+=1;events=list(http.chat([{'role':'user','content':text}],token,source=report['source'],conversation_id=str(uuid4())))
        report['event_types']=[e['type'] for e in events];command=next((e['command'] for e in events if e['type']=='computer_job'),None)
        if not command:
            choice=next((e.get('command') for e in events if e['type']=='computer_choice'),None)
            if choice:report['choice_id']=choice['id'];report['online_choices']=len(choice.get('computers',[]))
            raise ValueError('no_computer_task')
        report['command_id']=command['id'];report['kind']=command.get('kind');report['device_id']=command['device_id'];report['initial_state']=command['state']
        if voice:
            ack=next(e['text'] for e in events if e['type']=='delta');answer=speech(ack);report['reply_pcm_seconds']=round(len(answer)/48000,3);report['reply_has_energy']=any(abs(value[0])>100 for value in struct.iter_unpack('<h',answer));assert report['reply_has_energy']
        until=time.monotonic()+100;states=[]
        while time.monotonic()<until:
            value=http.call('/v1/commands/'+command['id'],token=token)['command']
            if not states or states[-1]!=value['state']:states.append(value['state'])
            if value['state'] in ('succeeded','failed','uncertain','cancelled'):
                report['states']=states;report['final_state']=value['state'];report['host_external_calls']=(value.get('result') or {}).get('external_calls');report['result_fields']=sorted((value.get('result') or {}).keys());report['passed']=value['state']=='succeeded'
                receipt=ROOT/'.local/account/receipts'/(command['id']+'.json')
                if receipt.exists():
                    local=json.loads(receipt.read_text()).get('local_id');detail=ROOT/'.local/computer/receipts'/(str(local)+'.json')
                    if detail.exists():report['host_external_calls']=json.loads(detail.read_text()).get('external_calls')
                break
            time.sleep(2)
        if 'final_state' not in report:report['states']=states;report['error_code']='completion_timeout'
    except Exception as exc:report['error_code']=str(exc) if isinstance(exc,ValueError) and len(str(exc))<80 else type(exc).__name__
    path=ROOT/'tmp/account-remote'/('real-'+report['source']+'-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({'report':str(path.relative_to(ROOT)),**report},indent=2));return report['passed']


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',action='store_true');parser.add_argument('--voice',action='store_true');args=parser.parse_args()
    if not args.allow_paid:parser.error('--allow-paid is required')
    raise SystemExit(0 if run(args.voice) else 1)
