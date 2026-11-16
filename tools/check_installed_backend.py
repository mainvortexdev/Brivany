"""Probe the repaired local backend in an owned process; no input or replay."""
import json
from pathlib import Path
import tempfile
from uuid import uuid4
from desktop.management import data_folder
from services.computer.backend import resolve_backend
from services.computer.runtime import NativeRuntime


def main():
    location=resolve_backend(bundle_root=data_folder()/'.local/computer/backend',environ={})
    report={'passed':False,'mode':'owned_pinned_Electron_native_probe',
            'external_calls':0,'input_actions':0,'user_order_replayed':False}
    with tempfile.TemporaryDirectory(prefix='brivany-backend-probe-') as folder:
        runtime=NativeRuntime(Path(folder),proxy='http://127.0.0.1:1',token='fixture-'+uuid4().hex,source=location.source)
        try:
            status=runtime.availability()
            if not status['available'] or not status['bundle_verified']:raise ValueError('Repaired bundle is unavailable')
            probe=runtime.call('probe',timeout=25)
            report.update(passed=probe.get('source_available') is True,bundle_verified=status['bundle_verified'],source_mode=status['source_mode'],probe_received=True)
        except Exception as error:report['error_type']=type(error).__name__
        finally:runtime.close()
    path=Path('tmp/installed-backend-native-20261112.json');path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
