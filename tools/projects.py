"""Explicit local project destinations; no server path write or native claim."""
import argparse
import json
from pathlib import Path
import sys
from services.projects import ProjectError, SpatialProjectSource, create_project, open_project, list_versions, save_project, export_project


def main(argv=None):
    parser = argparse.ArgumentParser(description='Proyectos espaciales privados y portables de Brivany')
    actions = parser.add_subparsers(dest='action', required=True)
    create = actions.add_parser('create'); create.add_argument('--spatial-root', default='.local/spatial')
    create.add_argument('--scene-id', required=True); create.add_argument('--destination', required=True)
    create.add_argument('--include-originals', action='store_true'); create.add_argument('--without-references', action='store_true')
    for action in ('open', 'versions', 'save', 'export'):
        command = actions.add_parser(action); command.add_argument('--project', required=True)
        if action == 'save':
            command.add_argument('--expected-revision', required=True, type=int); command.add_argument('--title')
        if action == 'export': command.add_argument('--destination', required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == 'create':
            source = SpatialProjectSource(Path(args.spatial_root))
            result = create_project(source, args.scene_id, args.destination, include_references=not args.without_references, include_originals=args.include_originals)
        elif args.action == 'open': result = open_project(args.project)
        elif args.action == 'versions': result = list_versions(args.project)
        elif args.action == 'save': result = save_project(args.project, expected_revision=args.expected_revision, title=args.title)
        else: result = export_project(args.project, args.destination)
        if 'project' in result:
            result = {'status': 'opened', 'project_id': result['project']['project_id'], 'revision': result['revision'],
                      'origin': result['project']['origin'], 'flags': result['project']['flags']}
        print(json.dumps(result, ensure_ascii=False)); return 0
    except (ProjectError, ValueError, OSError) as error:
        print(json.dumps({'status': 'rejected', 'code': getattr(error, 'code', 'project_io'),
                          'message': str(error) if isinstance(error, ProjectError) else 'No se pudo completar la operación local.'}, ensure_ascii=False)); return 2


if __name__ == '__main__': sys.exit(main())
