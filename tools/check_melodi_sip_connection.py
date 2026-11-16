"""Explicit real SIP REGISTER-only check of the saved profile. Never places calls.

Not a tools.verify suite: uses an actual carrier, whose billed amount is unknown.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
from uuid import uuid4

from services.telephony.sip import NativeSIP, ROOT, load_profile


def main():
    report = {'mode':'real_saved_netelip_sip_registration_only', 'registered':False,
              'calls_placed':0, 'ai_requests':0, 'physical_audio_device':False,
              'credentials_in_report':False, 'billed_amount':'unknown'}
    native = None
    try:
        account = load_profile(ROOT/'.local/telephony/sip.dpapi')
        configuration = account.engine()
        configuration['allow'] = []  # Even an accidental dial command cannot call PSTN.
        native = NativeSIP(configuration, str(uuid4()), lambda _:None)
        native.connect()
        report.update(registered=native.registered, sip_status=native.registration_status)
    except Exception:
        report['error'] = 'registration_not_confirmed'
        if native:
            report['sip_status'] = native.registration_status
    finally:
        if native:
            native.shutdown()
    destination = ROOT/'tmp/verification'/('melodi-sip-registration-'+
        datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid4().hex[:8]+'.json')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
    print('Report: ' + str(destination.relative_to(ROOT)))
    return 0 if report['registered'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
