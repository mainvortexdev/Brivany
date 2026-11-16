"""Private status, graceful stop/restart and launch, without window automation."""
import argparse
import json
from desktop.management import request,read_control,process_identity,wait_stopped,legacy_stop,launch

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['status','stop','restart','start']);parser.add_argument('--workspace',action='store_true');parser.add_argument('--wait',action='store_true');parser.add_argument('--legacy-pid',type=int);args=parser.parse_args()
    if args.legacy_pid:
        if args.action!='stop':parser.error('--legacy-pid solo prepara la primera actualización con un cierre normal.')
        print(json.dumps(legacy_stop(args.legacy_pid)));return
    if args.action=='start':print(json.dumps(launch(args.workspace)));return
    identity=None
    if args.wait:identity=process_identity(read_control()['pid'])
    result=request(args.action,mode='workspace' if args.workspace else None)
    if args.wait and args.action in {'stop','restart'}:
        result['old_process_stopped']=wait_stopped(identity['pid'],identity['started'])
        if not result['old_process_stopped']:raise ValueError('Brivany no terminó el cierre normal; revisa su estado. No se forzó la salida.')
    print(json.dumps(result))

if __name__=='__main__':main()
