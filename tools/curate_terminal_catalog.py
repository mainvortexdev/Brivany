"""Apply the user's revised desktop scope without erasing old receipts."""
from datetime import datetime,timezone
import json
from pathlib import Path
import shutil
from services.computer.runtime import ROOT
from services.terminal.catalog import DATA
from services.terminal.scope import desktop_entry,core_entries
from services.terminal.executor import TerminalExecutor
from services.terminal.checklist import CommandChecklist


def curated(rows):
    selected={row['id']:row for row in rows if desktop_entry(row)}
    for row in core_entries():selected.setdefault(row['id'],row)
    return list(selected.values())


def main():
    path=DATA/'windows.json';old=json.loads(path.read_text(encoding='utf-8'));active=curated(old)
    history=ROOT/'.local/terminal/catalog-history';history.mkdir(parents=True,exist_ok=True)
    destination=history/('windows-before-desktop-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')+'.json')
    shutil.copyfile(path,destination)
    path.write_text(json.dumps(active,ensure_ascii=False,indent=2),encoding='utf-8')
    checklist=CommandChecklist(TerminalExecutor(ROOT/'.local/terminal'))
    try:
        migration=checklist.synchronize_desktop_scope();checklist.markdown(ROOT/'docs/terminal-checklist.md')
        result={'scope':'everyday_desktop_and_selected_advanced','windows_commands':len(active),'shortcuts':len(json.loads((DATA/'shortcuts.json').read_text(encoding='utf-8'))),'migration':migration,'state':checklist.status()}
        output=ROOT/'tmp/terminal-research/desktop-scope.json';output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False,indent=2))
    finally:checklist.close()


if __name__=='__main__':main()
