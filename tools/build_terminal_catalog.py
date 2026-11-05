"""Build a factual command/shortcut index from Microsoft and Apple documentation."""
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urljoin,urlsplit
from urllib.request import Request,urlopen
from tools.curate_terminal_catalog import curated

ROOT=Path(__file__).resolve().parents[1]
WINDOWS='https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/windows-commands'
SHORTCUTS='https://support.microsoft.com/en-us/accessibility/windows/keyboard-shortcuts-in-windows'
APPLE='https://developer.apple.com/library/archive/documentation/OpenSource/Conceptual/ShellScripting/Introduction/Introduction.html'


class IndexParser(HTMLParser):
    def __init__(self):super().__init__();self.links=[];self.rows=[];self.href=None;self.text=[];self.cells=None;self.cell=None
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='a':self.href=attrs.get('href');self.text=[]
        if tag=='tr':self.cells=[]
        if tag=='td' and self.cells is not None:self.cell=[]
        if tag=='img' and self.cell is not None:self.cell.append(attrs.get('alt',''))
    def handle_data(self,value):
        if self.href is not None:self.text.append(value)
        if self.cell is not None:self.cell.append(value)
    def handle_endtag(self,tag):
        if tag=='a' and self.href is not None:self.links.append((self.href,' '.join(' '.join(self.text).split())));self.href=None
        if tag=='td' and self.cell is not None:self.cells.append(' '.join(' '.join(self.cell).split()));self.cell=None
        if tag=='tr' and self.cells is not None:
            if len(self.cells)>=2:self.rows.append(self.cells)
            self.cells=None


def fetch(url):
    with urlopen(Request(url,headers={'User-Agent':'Brivany-documentation-index'}),timeout=30) as response:return response.read()


def forbidden(name):return bool(re.search(r'(?i)registry|^(?:reg|regedit|regedt32|regini|regsvr32)(?:\s|-|$)',name))


def main():
    directory=ROOT/'services/terminal/data';directory.mkdir(parents=True,exist_ok=True)
    evidence=ROOT/'tmp/terminal-research';evidence.mkdir(parents=True,exist_ok=True)
    tree=json.loads((evidence/'powershell-tree.json').read_text(encoding='utf-8'))
    values=[];seen=set()
    for row in tree['tree']:
        path=row['path'];parts=path.split('/')
        if len(parts)!=4 or parts[1]!='winserver2025-ps' or not re.fullmatch(r'[A-Za-z]+-[A-Za-z0-9]+\.md',parts[-1]):continue
        name=parts[-1][:-3];module=parts[2];key=(module.lower(),name.lower())
        if key in seen:continue
        seen.add(key);values.append({'id':'windows.ps.'+module.lower()+'.'+name.lower(),'name':name,'module':module,'platform':'windows','kind':'powershell','source':'https://learn.microsoft.com/en-us/powershell/module/'+module.lower()+'/'+name.lower()+'?view=windowsserver2025-ps','git_blob':row['sha'],'documentation_path':path,'availability':'requires_module_check','policy':'registry_forbidden' if forbidden(name) else 'review_required'})
    parser=IndexParser();parser.feed(fetch(WINDOWS).decode('utf-8'))
    command_urls=set()
    for href,name in parser.links:
        url=urljoin(WINDOWS,href);path=urlsplit(url).path
        if '/windows-commands/' not in path or not name or urlsplit(url).netloc!='learn.microsoft.com' or path.endswith('/windows-commands'):continue
        if url in command_urls:continue
        command_urls.add(url);slug=path.rsplit('/',1)[-1];values.append({'id':'windows.cmd.'+slug,'name':name.strip('`'),'platform':'windows','kind':'windows_command','source':url,'availability':'requires_program_check','policy':'registry_forbidden' if forbidden(name) else 'review_required'})
    script='Get-Command -CommandType Cmdlet -ListAvailable -ErrorAction SilentlyContinue | Select-Object Name,Source | Sort-Object Source,Name -Unique | ConvertTo-Json -Depth 3'
    powershell=Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
    completed=subprocess.run([str(powershell),'-NoProfile','-NonInteractive','-Command',script],capture_output=True,timeout=90,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    installed=json.loads(completed.stdout.decode('utf-8-sig')) if completed.returncode==0 else []
    for row in installed:
        name=row['Name'];module=row['Source'];key=(module.lower(),name.lower())
        if key in seen:continue
        seen.add(key);values.append({'id':'windows.ps.'+module.lower()+'.'+name.lower(),'name':name,'module':module,'platform':'windows','kind':'powershell','source':'https://learn.microsoft.com/en-us/powershell/module/'+module.lower()+'/'+name.lower()+'?view=powershell-5.1','availability':'installed','policy':'registry_forbidden' if forbidden(name) else 'review_required'})
    shortcut_parser=IndexParser();shortcut_parser.feed(fetch(SHORTCUTS).decode('utf-8'));keys=set();shortcuts=[]
    for row in shortcut_parser.rows:
        key=row[0].replace('Windows logo key','Win').replace('Windows key','Win')
        if not key or key in keys:continue
        keys.add(key);shortcuts.append({'id':'windows.shortcut.'+str(len(shortcuts)+1).zfill(4),'keys':key,'platform':'windows','kind':'shortcut','source':SHORTCUTS,'availability':'requires_owned_target','policy':'review_required'})
    values=curated(values)
    (directory/'windows.json').write_text(json.dumps(values,ensure_ascii=False,indent=2),encoding='utf-8')
    (directory/'shortcuts.json').write_text(json.dumps(shortcuts,ensure_ascii=False,indent=2),encoding='utf-8')
    mac=[{'id':'macos.command.'+name,'name':name,'platform':'macos','kind':'shell','source':APPLE,'availability':'macos_host_required','policy':'review_required'} for name in ['pwd','ls','cd','mkdir','rmdir','cp','mv','cat','head','tail','wc','sort','uniq','grep','find','stat','file','du','df','date','uname','sw_vers','system_profiler','ps','pgrep','kill','which','man','open','xcrun','xcodebuild','ditto','hdiutil','diskutil','launchctl','plutil','defaults','curl','git','tar','zip','unzip','shasum','chmod','chown','sudo']]
    (directory/'macos.json').write_text(json.dumps(mac,ensure_ascii=False,indent=2),encoding='utf-8')
    report={'windows_commands':len(values),'windows_shortcuts':len(shortcuts),'macos_commands_indexed':len(mac),'registry_forbidden':sum(row['policy']=='registry_forbidden' for row in values),'installed_detected_not_tested':len(installed),'executed_approved':0,'sources':[WINDOWS,SHORTCUTS,'https://github.com/MicrosoftDocs/windows-powershell-docs',APPLE],'source_tree_sha':tree['sha'],'note':'Documentation index and local discovery, never proof of execution. Server/role commands require their module and environment.'}
    report['scope']='everyday_desktop_and_selected_advanced'
    assert len(values)>50 and len(shortcuts)>50
    (evidence/'catalog-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
