"""Inspect preparation, or explicitly invoke an already verified Modal deployment."""
import argparse
import json
from pathlib import Path
import sqlite3
import sys

from services.spatial.dispatch import SpatialDispatch, DispatchError, preflight_package
from services.spatial.review import CaptureReviewService, CaptureReviewError
from services.spatial.budget import SpatialBudget, BudgetError
from workers.spatial_runtime import SpatialWorkerError, read_lock

ROOT=Path(__file__).resolve().parents[1]


def main(argv=None):
    parser=argparse.ArgumentParser(description='Orquestación espacial con ejecución Modal optativa')
    parser.add_argument('--root',type=Path,default=ROOT/'.local'/'spatial')
    parser.add_argument('--lock',type=Path,default=None)
    sub=parser.add_subparsers(dest='operation',required=True)
    for name in ('preflight','submit'):
        command=sub.add_parser(name);command.add_argument('capture_id');command.add_argument('package_id')
        command.add_argument('--expected-revision',type=int,required=True)
        command.add_argument('--seed',type=int,default=0);command.add_argument('--timeout-seconds',type=int,default=180)
        if name=='submit':
            command.add_argument('--execute',action='store_true')
            command.add_argument('--provider',choices=['modal'],default=None)
    command=sub.add_parser('inspect');command.add_argument('job_id')
    command=sub.add_parser('cancel');command.add_argument('job_id');command.add_argument('--execute',action='store_true');command.add_argument('--provider',choices=['modal'],default=None)
    command=sub.add_parser('reconcile');command.add_argument('job_id');command.add_argument('--actual-usd',required=True)
    args=parser.parse_args(argv)
    try:
        reviews=CaptureReviewService(args.root)
        if args.operation=='preflight':
            result=preflight_package(reviews,args.capture_id,args.package_id,expected_revision=args.expected_revision,
                seed=args.seed,timeout_seconds=args.timeout_seconds,lock=read_lock(args.lock))
        else:
            if args.operation=='submit':
                if not args.execute:raise DispatchError('dispatch_explicit_execution','Falta --execute; no se reservó presupuesto.')
                from workers.spatial_runtime import readiness
                if readiness(read_lock(args.lock))['pending']:raise DispatchError('dispatch_not_configured','Los controles de ejecución siguen cerrados.')
                if args.provider!='modal':raise DispatchError('dispatch_transport_pending','Selecciona --provider modal además de --execute; no se reservó presupuesto.')
                from services.spatial.modal_transport import ModalTransport
                transport=ModalTransport(args.root,read_lock(args.lock))
                service=SpatialDispatch(args.root,reviews,SpatialBudget(args.root/'budget.sqlite3'),lock_path=args.lock,transport=transport)
                result=service.submit(args.capture_id,args.package_id,expected_revision=args.expected_revision,seed=args.seed,timeout_seconds=args.timeout_seconds,execute=True)
                print(json.dumps(result,ensure_ascii=False,indent=2));return 0
            service=SpatialDispatch(args.root,reviews,SpatialBudget(args.root/'budget.sqlite3'),lock_path=args.lock)
            if args.operation=='cancel':
                if not args.execute:raise DispatchError('dispatch_explicit_execution','Falta --execute para solicitar la cancelación.')
                result=service.cancel(args.job_id)
                if args.provider=='modal' and result['transport_kind']=='modal':
                    from services.spatial.modal_transport import ModalTransport
                    result['remote_cancellation']=ModalTransport(args.root,read_lock(args.lock)).cancel(args.job_id)
            elif args.operation=='reconcile':result=service.reconcile(args.job_id,args.actual_usd)
            else:result=service.inspect(args.job_id)
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0
    except (DispatchError,CaptureReviewError,BudgetError,SpatialWorkerError) as exc:
        print(json.dumps({'error':exc.code,'message':str(exc),'remote_adapter_implemented':True,'gpu_execution_verified':False},ensure_ascii=False));return 2
    except (OSError,ValueError,sqlite3.Error):
        print(json.dumps({'error':'dispatch_local_storage','message':'No se pudo leer el estado local.'}));return 2


if __name__=='__main__':sys.exit(main())
