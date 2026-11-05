"""Real account broker, one real PC plus a clearly labelled simulated host."""
from datetime import datetime,timezone
import argparse
import json
from pathlib import Path
from uuid import uuid4
from websockets.sync.client import connect
from services.brivany_account import AccountHTTP,SecureAccountFile,BASE

ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-paid',action='store_true');args=parser.parse_args()
    if not args.allow_paid:parser.error('--allow-paid is required')
    account=json.loads((ROOT/'.local/mobile-accounts/test-account.json').read_text());mobile=SecureAccountFile(ROOT/'.local/mobile-accounts/preview-session.dpapi').load();token=mobile['session']['token'];http=AccountHTTP();device=str(uuid4())
    report={'type':'real_account_selection_with_simulated_second_host','physical_computers':1,'simulated_computers':1,'os_actions_executed_by_fixture':0,'calls':{'chat':0},'passed':False};host=None
    try:
        session=http.call('/v1/account/login',{'email':account['email'],'password':account['password'],'device_id':device,'device_name':'Equipo simulado · prueba','kind':'desktop','platform':'linux'})
        with connect(BASE.replace('https://','wss://')+'/v1/host',additional_headers={'Authorization':'Bearer '+session['session']['token']},proxy=None,open_timeout=10,close_timeout=1) as host:
            assert json.loads(host.recv(timeout=5))['type']=='ready'
            computers=[d for d in http.call('/v1/devices',token=token)['devices'] if d['kind']=='desktop' and d['online']];report['connected_computers']=len(computers);assert len(computers)>=2
            outcomes=[]
            for source in ['chat','voice']:
                if source=='voice':
                    report['calls']['chat']+=1
                    events=list(http.chat([{'role':'user','content':'Consulta el tiempo que lleva encendido mi ordenador, sin modificar nada.'}],token,source='voice',conversation_id=str(uuid4())))
                    command=next(e['command'] for e in events if e['type']=='computer_choice')
                else:command=http.call('/v1/commands',{'instruction':'Prueba de transporte simulada, sin acciones del sistema.','kind':'desktop','source':source,'nonce':str(uuid4())},token)['command']
                assert command['state']=='needs_device';assert len(command['computers'])>=2
                try:host.recv(timeout=.2);raise AssertionError('delivered_before_choice')
                except TimeoutError:pass
                chosen=http.call('/v1/commands/select',{'id':command['id'],'computer':device},token)['command'];assert chosen['state']=='offered'
                received=json.loads(host.recv(timeout=5));assert received['id']==command['id']
                host.send(json.dumps({'type':'update','id':command['id'],'state':'accepted'}));assert json.loads(host.recv(timeout=5))['ok']
                host.send(json.dumps({'type':'update','id':command['id'],'state':'succeeded','result':{'simulation':True,'summary':'Sólo transporte de prueba.'}}));assert json.loads(host.recv(timeout=5))['ok']
                outcomes.append({'source':source,'asked_before_delivery':True,'target_matches_explicit_choice':True,'fixture_result_simulated':True})
            report['outcomes']=outcomes;report['passed']=True
    except Exception as exc:report['error_type']=type(exc).__name__
    finally:
        try:http.call('/v1/account/revoke',{'device_id':device},token);report['fixture_revoked']=True
        except Exception:report['fixture_revoked']=False
    path=ROOT/'tmp/account-remote'/('selection-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'.json');path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({'report':str(path.relative_to(ROOT)),**report},indent=2));return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
