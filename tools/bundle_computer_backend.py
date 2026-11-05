"""Build an offline local backend from the user's pinned Cognira installation."""
import argparse
import json
from pathlib import Path
from services.computer.backend import BUNDLES,ROOT,build_bundle,activate_bundle


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,default=ROOT.parent/'cognira-desktop')
    parser.add_argument('--output-root',type=Path,default=BUNDLES)
    parser.add_argument('--activate',action='store_true')
    args=parser.parse_args()
    if args.activate and args.output_root.resolve()!=BUNDLES.resolve():parser.error('La activación usa la carpeta predeterminada de Brivany; para un paquete externo elige BRIVANY_COGNIRA_SOURCE explícitamente.')
    result=build_bundle(args.source,args.output_root)
    if args.activate:activate_bundle(result['directory'],args.output_root)
    result.update(activated=args.activate,external_calls=0)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
