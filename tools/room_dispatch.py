"""Inspect room work offline or explicitly invoke an already verified deployment."""
import argparse
import json
from pathlib import Path
import sqlite3
from types import SimpleNamespace

from services.spatial.budget import SpatialBudget,BudgetError
from services.spatial.room import RoomPreparationService
from services.spatial.room_dispatch import RoomDispatch,RoomDispatchError,identifier
from services.spatial.room_modal_transport import RoomModalTransport
from workers.spatial_room import read_room_lock,readiness
from workers.spatial_runtime import SpatialWorkerError

ROOT=Path(__file__).resolve().parents[1]


class CaptureSource:
    """The preparation service only needs an owned-path reader, not a worker."""
    def __init__(self,root):
        self.root=Path(root).absolute()
        if self.root.resolve()!=self.root or not self.root.is_dir():raise RoomDispatchError('room_storage','Falta almacenamiento espacial local sin redirecciones.')

    def _owned(self,category,item,*parts):
        identifier(item);path=self.root/category/item
        target=path.joinpath(*parts)
        if category!='captures' or target.resolve()!=target or not target.is_relative_to(self.root/'captures'):raise RoomDispatchError('room_storage','La vista no pertenece al almacenamiento de captura.')
        return target


def main(argv=None):
    parser=argparse.ArgumentParser(description='Reconstrucción multivista con Modal optativo y presupuesto compartido')
    parser.add_argument('--root',type=Path,default=ROOT/'.local/spatial');parser.add_argument('--lock',type=Path)
    commands=parser.add_subparsers(dest='operation',required=True)
    for name in ('preflight','submit'):
        command=commands.add_parser(name);command.add_argument('capture_id');command.add_argument('--source-sha256',required=True)
        command.add_argument('--frame',dest='frames',action='append',required=True);command.add_argument('--reviewed',action='store_true')
        command.add_argument('--seed',type=int,default=0);command.add_argument('--timeout-seconds',type=int,default=180)
        command.add_argument('--sample-stride',type=int,default=4)
        if name=='submit':command.add_argument('--execute',action='store_true');command.add_argument('--provider',choices=['modal'])
    command=commands.add_parser('inspect');command.add_argument('job_id')
    command=commands.add_parser('list');command.add_argument('capture_id')
    command=commands.add_parser('cancel');command.add_argument('job_id');command.add_argument('--execute',action='store_true');command.add_argument('--provider',choices=['modal'])
    command=commands.add_parser('reconcile');command.add_argument('job_id');command.add_argument('--actual-usd',required=True)
    args=parser.parse_args(argv)
    try:
        source=CaptureSource(args.root);prepared=RoomPreparationService(source);lock=read_room_lock(args.lock)
        if args.operation in {'submit','cancel'} and not args.execute:raise RoomDispatchError('room_explicit_execution','Falta --execute; no se iniciará ni cancelará una ejecución.')
        if args.operation=='submit':
            if readiness(lock)['pending']:raise RoomDispatchError('room_not_configured','El lock multivista continúa cerrado; no se reservó presupuesto.')
            if args.provider!='modal':raise RoomDispatchError('room_transport_pending','Selecciona --provider modal junto con --execute.')
        mutation=args.operation in {'submit','cancel','reconcile'}
        budget=SpatialBudget(source.root/'budget.sqlite3') if mutation else SimpleNamespace(path=source.root/'budget.sqlite3')
        transport=RoomModalTransport(source.root,lock) if getattr(args,'provider',None)=='modal' else None
        service=RoomDispatch(source.root,prepared,budget,lock_path=args.lock,transport=transport)
        if args.operation in {'preflight','submit'}:
            payload={'expected_source_sha256':args.source_sha256,'frame_ids':args.frames,'reviewed':args.reviewed,
                'seed':args.seed,'timeout_seconds':args.timeout_seconds,'parameters':{'sample_stride':args.sample_stride}}
            result=service.preflight(args.capture_id,payload) if args.operation=='preflight' else service.submit(args.capture_id,payload,execute=True)
        elif args.operation=='inspect':result=service.inspect(args.job_id)
        elif args.operation=='list':result=service.list_results(args.capture_id)
        elif args.operation=='cancel':result=service.cancel(args.job_id,remote=args.provider=='modal')
        else:result=service.reconcile(args.job_id,args.actual_usd)
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0
    except (RoomDispatchError,SpatialWorkerError,BudgetError) as error:
        print(json.dumps({'error':error.code,'message':str(error),'gpu_execution_verified':False},ensure_ascii=False));return 2
    except (OSError,sqlite3.Error,ValueError,TypeError):
        print(json.dumps({'error':'room_storage','message':'No se pudo leer el estado multivista local.'},ensure_ascii=False));return 2


if __name__=='__main__':raise SystemExit(main())
