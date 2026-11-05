"""Read-only ledger/evidence reconciliation; hashes do not approve features."""
import argparse
from contextlib import closing
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from services.activity import ROOT,ZERO_HASH


def audit(root=ROOT):
    root=Path(root).resolve();database=root/'.local/activity/activity.sqlite3'
    with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as db:
        db.row_factory=sqlite3.Row;rows=db.execute('SELECT * FROM entries ORDER BY seq').fetchall()
    known={};artifacts={};previous=ZERO_HASH;chain=[]
    for row in rows:
        value=json.loads(row['payload']);digest=hashlib.sha256((previous+'\n'+row['payload']).encode()).hexdigest()
        if row['previous_hash']!=previous or row['entry_hash']!=digest:chain.append(row['seq'])
        previous=row['entry_hash']
        for item in value['evidence']:
            known.setdefault(item['label'],set()).add(item['sha256']);artifacts[item['sha256']]=item['size_bytes']
    missing=[];corrupt=[]
    for digest,size in artifacts.items():
        path=root/'.local/activity/artifacts'/digest
        if not path.is_file():missing.append(digest)
        elif path.stat().st_size!=size or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:corrupt.append(digest)
    untracked=[];changed=[];covered=[]
    for doc in sorted((root/'docs').rglob('*.md')):
        name=doc.relative_to(root).as_posix();digest=hashlib.sha256(doc.read_bytes()).hexdigest()
        if name not in known:untracked.append(name)
        elif digest not in known[name]:changed.append(name)
        else:covered.append(name)
    reports=[];changed_reports=[]
    for path in sorted((root/'tmp/verification').glob('*.json')):
        name=path.relative_to(root).as_posix()
        if name not in known:reports.append(name)
        elif hashlib.sha256(path.read_bytes()).hexdigest() not in known[name]:changed_reports.append(name)
    return {'type':'read_only_ledger_reconciliation','checked_at':datetime.now(timezone.utc).isoformat(),'entries':len(rows),'unique_evidence_snapshots':len(artifacts),
        'chain_errors':chain,'missing_snapshots':missing,'corrupt_snapshots':corrupt,'docs_total':len(untracked)+len(changed)+len(covered),
        'docs_exactly_snapshotted':len(covered),'docs_not_attached':untracked,'docs_with_new_content':changed,'unregistered_suite_reports':reports,'suite_reports_with_new_content':changed_reports,
        'integrity_passed':not (chain or missing or corrupt),'documentation_coverage_complete':not (untracked or changed),
        'suite_report_coverage_complete':not (reports or changed_reports),
        'limits':'Chain, evidence and document coverage only; not feature correctness, semantic quality or a new test execution.'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',default='tmp/bitacora-audit-latest.json');args=parser.parse_args()
    path=(ROOT/args.output).resolve();path.relative_to(ROOT);path.parent.mkdir(parents=True,exist_ok=True)
    report=audit();path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
    return 0 if report['integrity_passed'] and report['documentation_coverage_complete'] and report['suite_report_coverage_complete'] else 1


if __name__=='__main__':raise SystemExit(main())
