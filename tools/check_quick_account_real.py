"""Explicit real account test: open Word and query process count; keep Word open."""
import argparse
import ctypes
from ctypes import wintypes as w
from datetime import datetime,timezone
import json
from pathlib import Path
import time
from uuid import uuid4
from services.brivany_account import AccountHTTP,SecureAccountFile

ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-actions',action='store_true');args=parser.parse_args()
    if not args.allow_actions:parser.error('This test opens Word; pass --allow-actions explicitly.')
    session=SecureAccountFile(ROOT/'.local/mobile-accounts/preview-session.dpapi').load();token=session['session']['token'];http=AccountHTTP();calls=0
    report={'passed':False,'time':datetime.now(timezone.utc).isoformat(),'scope':'real account broker, running Brivany desktop and installed Word','inference_requests':0,'billing_usd':None,'original_conversation_saved':False}
    def call(path,body=None):
        nonlocal calls
        calls+=1;return http.call(path,body,token)
    def request(text):
        nonlocal calls
        started=time.monotonic();calls+=1;events=list(http.chat([{'role':'user','content':text}],token,conversation_id=str(uuid4())));ack_seconds=time.monotonic()-started
        event=next(e for e in events if e['type'] in {'computer_choice','computer_job'});command=event['command']
        if command['state']=='needs_device':
            device=json.loads((ROOT/'.local/account/device.json').read_text())['id'];command=call('/v1/commands/select',{'id':command['id'],'computer':device})['command']
        while time.monotonic()-started<25:
            current=call('/v1/commands/'+command['id'])['command']
            if current['state'] in {'succeeded','failed','uncertain','cancelled'}:break
            time.sleep(.35)
        else:raise ValueError('The account command did not finish in 25 seconds.')
        ack=''.join(e.get('text','') for e in events if e['type']=='delta')
        return current,{'ack_seconds':round(ack_seconds,3),'completion_seconds':round(time.monotonic()-started,3),'old_fixed_phrase_absent':'claro, lo haré' not in ack.casefold(),'state':current['state']}
    try:
        user=ctypes.WinDLL('user32');user.GetForegroundWindow.restype=w.HWND;before=user.GetForegroundWindow()
        opened,timing=request('Puedes abrir Word?');report['word']=timing
        assert opened['state']=='succeeded','The Word command failed.'
        output=opened.get('result',{}).get('output',{});receipt=next(r['result'] for r in output.get('receipts',[]) if r['action']=='launch_app');pid=receipt['process_id']
        windows=[]
        @ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
        def visit(hwnd,_):
            current=w.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(current))
            if current.value==pid and user.IsWindowVisible(hwnd):
                name=ctypes.create_unicode_buffer(100);user.GetClassNameW(hwnd,name,100);windows.append({'class':name.value,'minimized':bool(user.IsIconic(hwnd))})
            return True
        deadline=time.monotonic()+10
        while not windows and time.monotonic()<deadline:user.EnumWindows(visit,0);time.sleep(.1)
        assert windows,'No visible/minimized Word window was found.'
        report['word'].update(process_id=pid,window_verified=True,window_metadata=windows,foreground_preserved=user.GetForegroundWindow()==before,background=receipt.get('background'),input_sent=receipt.get('input_sent'),local_model_calls=opened.get('result',{}).get('external_calls'),word_left_open=True)
        counted,timing=request('Cuantos procesos tengo corriendo en mi pc ahora mismo?');result=counted.get('result',{}).get('output',{})
        assert counted['state']=='succeeded' and result.get('verified') and type(result.get('count')) is int
        report['process_count']={**timing,'observed_count':result['count'],'observed_at':result.get('observed_at'),'answer_contains_observed_count':str(result['count']) in result.get('message',''),'local_model_calls':counted.get('result',{}).get('external_calls')}
        report['passed']=True
    except Exception as error:report['error']=str(error)[:250]
    report['account_requests']=calls;path=ROOT/'tmp/quick-actions-real.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
