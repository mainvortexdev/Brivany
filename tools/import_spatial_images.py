"""Import explicitly supplied local image references, without model or API calls."""
import argparse
import json
import sys

from services.spatial.references import ReferenceSetError, ReferenceSetService


def main(argv=None):
    parser = argparse.ArgumentParser(description='Importar referencias PNG/JPEG privadas para reconstrucción futura')
    parser.add_argument('--root', default='.local/spatial', help='Almacenamiento espacial local')
    actions = parser.add_subparsers(dest='action', required=True)
    create = actions.add_parser('create')
    create.add_argument('paths', nargs='+')
    create.add_argument('--title', default='Referencia interior')
    inspect = actions.add_parser('inspect')
    inspect.add_argument('set_id')
    args = parser.parse_args(argv)
    try:
        service = ReferenceSetService(args.root)
        result = service.create(args.paths, title=args.title) if args.action == 'create' else service.get(args.set_id)
    except (ReferenceSetError, OSError) as error:
        print(json.dumps({'status': 'rejected', 'code': getattr(error, 'code', 'reference_io'),
                          'message': str(error) if isinstance(error, ReferenceSetError) else 'No se pudo completar la operación local.',
                          'external_calls': 0, 'model_executed': False}, ensure_ascii=False))
        return 2
    print(json.dumps({'status': 'prepared_not_reconstructed', 'id': result['id'],
                      'frame_count': len(result['frames']), 'preflight': result['preflight'],
                      'external_calls': 0, 'model_executed': False}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
