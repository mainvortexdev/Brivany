"""Installed entrypoint; uses the bundled interpreter, never a system Python."""
from pathlib import Path
import json,os,sys,traceback

APP=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(APP))
os.chdir(APP)

def main():
    from packages.runtime_paths import LOCAL_ROOT
    logs=LOCAL_ROOT/'logs';logs.mkdir(parents=True,exist_ok=True)
    with (logs/'desktop.log').open('a',encoding='utf-8',buffering=1) as log:
        sys.stdout=log;sys.stderr=log
        try:
            lifecycle_flags=set(sys.argv[1:])&{'--restart','--stop','--status'}
            if lifecycle_flags:
                if len(lifecycle_flags)!=1 or set(sys.argv[1:])-{'--restart','--stop','--status','--island'}:raise ValueError('Comando privado no válido.')
                from desktop.management import request
                action=next(iter(lifecycle_flags))[2:]
                print(json.dumps(request(action,mode='workspace' if '--island' in sys.argv else None)))
                return 0
            if '--diagnose' in sys.argv:
                from desktop.launcher import dependency_status
                from packages.runtime_paths import DATA_ROOT
                report={'version':json.loads((APP/'desktop/distribution/version.json').read_text())['version'],
                    'app_root':str(APP),'data_root':str(DATA_ROOT),'dependencies':dependency_status()}
                index=sys.argv.index('--diagnose')
                Path(sys.argv[index+1]).write_text(json.dumps(report,indent=2),encoding='utf-8')
                return 0 if report['dependencies']['edgechromium_available'] else 2
            from desktop.experience.launcher import main as launch
            return launch(sys.argv[1:])
        except Exception:
            traceback.print_exc()
            import ctypes
            ctypes.windll.user32.MessageBoxW(None,'No se pudo iniciar Brivany. Revisa desktop.log en la carpeta de datos.','Brivany',16)
            return 2

if __name__=='__main__':raise SystemExit(main())
