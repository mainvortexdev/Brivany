"""Verify the read-only auditor against disposable local ledger fixtures."""
import hashlib
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
from services.activity import ActivityStore, ROOT
from tools.audit_activity import audit


def main():
    checks={}
    with tempfile.TemporaryDirectory(prefix='activity-audit-',dir=ROOT/'tmp') as directory:
        root=Path(directory);(root/'docs').mkdir();(root/'tmp/verification').mkdir(parents=True)
        doc=root/'docs/reference.md';doc.write_text('Reviewed reference',encoding='utf-8')
        report=root/'tmp/verification/check.json';report.write_text('{"passed":true}',encoding='utf-8')
        store=ActivityStore(root=root)
        store.add({'kind':'test','status':'passed','title':'Fixture','summary':'Disposable synthetic ledger.'},[doc,report])
        before=hashlib.sha256(store.database.read_bytes()).hexdigest()
        result=audit(root)
        checks['complete_fixture_passes']=result['integrity_passed'] and result['documentation_coverage_complete'] and result['suite_report_coverage_complete']
        checks['audit_does_not_write_database']=before==hashlib.sha256(store.database.read_bytes()).hexdigest()
        doc.write_text('Changed reference',encoding='utf-8');report.write_text('{"passed":false}',encoding='utf-8')
        result=audit(root)
        checks['changed_content_detected']=result['docs_with_new_content']==['docs/reference.md'] and result['suite_reports_with_new_content']==['tmp/verification/check.json']
        (root/'docs/new.md').write_text('New reference',encoding='utf-8')
        (root/'tmp/verification/new.json').write_text('{}',encoding='utf-8')
        result=audit(root)
        checks['unregistered_files_detected']=result['docs_not_attached']==['docs/new.md'] and result['unregistered_suite_reports']==['tmp/verification/new.json']
        artifacts=list(store.artifacts.iterdir());artifacts[0].write_bytes(b'corrupted fixture')
        artifacts[1].unlink()
        result=audit(root)
        checks['missing_and_corrupt_snapshots_detected']=len(result['missing_snapshots'])==1 and len(result['corrupt_snapshots'])==1 and not result['integrity_passed']
        with closing(sqlite3.connect(store.database)) as db:
            db.execute("UPDATE entries SET previous_hash='invalid' WHERE seq=1");db.commit()
        checks['broken_chain_detected']=audit(root)['chain_errors']==[1]
    value={'type':'local_disposable_activity_auditor_fixtures','passed':all(checks.values()),'checks':checks,'production_ledger_mutated':False,'external_calls':0}
    path=ROOT/'tmp/activity-auditor-check.json';path.write_text(json.dumps(value,indent=2),encoding='utf-8');print(json.dumps(value))
    return 0 if value['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
