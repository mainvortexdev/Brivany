"""Explicit offline spatial backup CLI. No server/model startup."""
import argparse
import json
import sys
from services.spatial.backup import BackupError,create_backup,restore_backup,inspect_backup


def main(argv=None):
    parser=argparse.ArgumentParser(description='Respaldar o restaurar datos espaciales con Brivany cerrado')
    parser.add_argument('action',choices=['create','restore','inspect'])
    parser.add_argument('--source',required=True)
    parser.add_argument('--destination')
    parser.add_argument('--offline',action='store_true',help='Confirmar que Brivany y sus trabajos están cerrados')
    args=parser.parse_args(argv)
    if args.action!='inspect' and not args.destination:parser.error('--destination es obligatorio para create/restore')
    if args.action=='inspect' and args.destination:parser.error('inspect no recibe --destination')
    try:
        if args.action=='create':result=create_backup(args.source,args.destination,offline=args.offline)
        elif args.action=='restore':result=restore_backup(args.source,args.destination,offline=args.offline)
        else:result=inspect_backup(args.source,offline=args.offline)
    except (BackupError,OSError) as error:
        print(json.dumps({'status':'rejected','code':error.code if isinstance(error,BackupError) else 'backup_io',
                          'message':str(error) if isinstance(error,BackupError) else 'No se pudo completar la operación local.',
                          'external_calls':0},ensure_ascii=False));return 2
    print(json.dumps(result,ensure_ascii=False));return 0


if __name__=='__main__':sys.exit(main())
