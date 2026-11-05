"""Run the local Rapier WASM checks; no browser, provider, GPU or package fetch."""
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]


def main():
    command=['node','--test','tests/spatial-physics.test.cjs']
    try:
        result=subprocess.run(command,cwd=ROOT,capture_output=True,timeout=60,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        code=result.returncode;output=(result.stdout+result.stderr).decode('utf-8',errors='replace')
    except (OSError,subprocess.TimeoutExpired):
        code=1;output='No se pudo completar la comprobación local de Rapier en 60 segundos.'
    print(output[:20000])
    print(json.dumps({'status':'passed' if code==0 else 'failed','engine':'@dimforge/rapier3d-compat',
        'version':'0.21.0','scope':'Real CPU WASM simulation of synthetic cuboids; no measured interior physics.',
        'physical_realism_verified':False,'metric_scale_verified':False,'external_calls':0,'gpu_seconds':0}))
    return code


if __name__=='__main__':sys.exit(main())
