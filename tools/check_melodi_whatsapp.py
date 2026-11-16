"""Local release checks for the single Melodi runtime and its provider adapters."""
from pathlib import Path
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
FILES='''brivany-melodi melodi-tenants melodi-notifications melodi-release melodi-v2-worker melodi-desktop melodi-calls melodi-phone-desktop
owner-action-plan-executor owner-turn-response compound-owner-routing whatsapp-processing whatsapp-ingress
gmail mail-report-digest melodi-voice-note melodi-voice-mode melodi-owner-name conversation-recall encrypted-conversation-store owner-quoted-thread generated-image-thread melodi-partial-and-senses melodi-pending-request image-transient-failure drive drive-v2-integration google-calendar-auth google-calendar-sync google-calendar-sync-queue
google-calendar-guards google-calendar-client google-calendar-store google-calendar-schedules
document-design document-workflow document-timing document-pdf-layout document-schedules document-request-repair
desktop-media personal-finance email-sender-status'''.split()

def main():
    result=subprocess.run(['node','--test','--test-concurrency=2','--test-reporter=tap','--test-timeout=20000','--import','./test/cloudflare-register.js',
        *[f'test/{name}.test.js' for name in FILES]],cwd=ROOT/'workers/whatsapp',capture_output=True,text=True,encoding='utf-8',timeout=180)
    output=result.stdout+result.stderr
    path=ROOT/'.local/whatsapp-migration/reports/release-tests.tap';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(output,encoding='utf-8')
    print('\n'.join(line for line in output.splitlines() if re.match(r'^# (tests|pass|fail|cancelled|skipped|duration_ms)',line)))
    if result.returncode:
        for block in re.split(r'(?m)^not ok ',output)[1:]:print('FAIL '+block.split('\n  ...')[0][:2200])
    print('Simulated providers; no WhatsApp messages or Google account access. Full report:',path)
    return result.returncode

if __name__=='__main__':sys.exit(main())
