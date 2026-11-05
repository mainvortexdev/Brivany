"""Windows Update applicable drivers; no registry edits, firmware or forced reboot."""
import ctypes
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from services.terminal.executor import TerminalExecutor
from services.terminal.recipes import literal

SOURCE='https://learn.microsoft.com/windows/win32/api/wuapi/nf-wuapi-iupdatesearcher-search'
QUERY=r'''$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$printers=@(Get-CimInstance Win32_Printer | Select-Object -ExpandProperty DriverName -Unique)
$problems=@(Get-CimInstance Win32_PnPEntity | Where-Object {$_.ConfigManagerErrorCode -ne 0} | Select-Object Name,Manufacturer,PNPClass,ConfigManagerErrorCode)
$session=New-Object -ComObject Microsoft.Update.Session;$session.ClientApplicationID='Brivany'
$result=$session.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver'")
$updates=@(foreach($u in $result.Updates){[pscustomobject]@{id=$u.Identity.UpdateID;revision=$u.Identity.RevisionNumber;title=$u.Title;manufacturer=$u.DriverManufacturer;model=$u.DriverModel;hardware_id=$u.DriverHardwareID;class=$u.DriverClass;driver_date=$u.DriverVerDate.ToString('o');eula_accepted=$u.EulaAccepted;downloaded=$u.IsDownloaded;requires_interaction=$u.InstallationBehavior.CanRequestUserInput}})
[ordered]@{printer_drivers=$printers;devices_with_errors=$problems;search_result=[int]$result.ResultCode;updates=$updates} | ConvertTo-Json -Depth 5 -Compress'''


class DriverService:
    def __init__(self,root):self.executor=TerminalExecutor(root);self.root=self.executor.root
    def host(self):return str(Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe')
    def scan(self,cancelled=None):
        if os.name!='nt':return {'requires_user':True,'message':'La instalación de controladores en macOS se gestiona mediante el fabricante y Actualización de software; este adaptador Windows no se ejecutará.'}
        receipt=self.executor.run('drivers.applicable_windows_update',self.host(),['-NoProfile','-NonInteractive','-Command',QUERY],cwd=self.root,cancelled=cancelled,timeout=240)
        self.executor.require_success(receipt);data=json.loads(receipt['output'])
        if data.get('search_result')!=2:raise ValueError('Windows Update no completó la búsqueda de controladores.')
        for update in data.get('updates',[]):
            update['installable']=bool(update.get('eula_accepted') and not update.get('requires_interaction') and str(update.get('class') or '').casefold()!='firmware' and not re.search(r'\b(?:bios|firmware)\b',update.get('title',''),re.I))
        snapshot={'observed':True,'source':SOURCE,'receipt_id':receipt['id'],**data}
        (self.root/'latest-scan.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf-8')
        return snapshot

    def prepare(self,identifiers,scan):
        if not isinstance(identifiers,list) or not 1<=len(identifiers)<=8 or len(set(identifiers))!=len(identifiers):raise ValueError('Selecciona de uno a ocho controladores observados.')
        updates={u['id']:u for u in scan.get('updates',[])}
        for identifier in identifiers:
            if str(uuid.UUID(identifier))!=identifier or identifier not in updates or not updates[identifier].get('installable'):raise ValueError('El controlador no es aplicable o requiere revisar su licencia/interacción en Windows Update.')
        identifier=str(uuid.uuid4());folder=self.root/identifier;folder.mkdir()
        proposal={'id':identifier,'nonce':uuid.uuid4().hex,'updates':[updates[i] for i in identifiers],'state':'prepared','source':SOURCE,'verified_installed':False,'automatic_reboot':False}
        (folder/'proposal.json').write_text(json.dumps(proposal,ensure_ascii=False,indent=2),encoding='utf-8');return proposal

    def start(self,identifier):
        if str(uuid.UUID(identifier))!=identifier:raise ValueError('Propuesta inválida.')
        folder=self.root/identifier
        from services.terminal.policy import scoped
        scoped(folder,[self.root],existing=True)
        proposal=json.loads((folder/'proposal.json').read_text(encoding='utf-8'))
        if proposal['state']!='prepared':raise ValueError('Esta instalación ya se solicitó; revisa su estado antes de repetirla.')
        ids=[str(uuid.UUID(u['id'])) for u in proposal['updates']]
        path=folder/'result.json';nonce=proposal['nonce']
        # Recheck applicability, EULA and exact IDs in the elevated worker. A
        # package having been downloaded is never installation proof.
        command=r'''$ErrorActionPreference='Stop'; $ids=@(IDS); $output=DEST; $nonce=NONCE
$value=@{nonce=$nonce;ids=$ids;completed=$false;installed=$false;reboot_required=$false}
try {
 if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Windows elevation required'}
 $s=New-Object -ComObject Microsoft.Update.Session;$s.ClientApplicationID='Brivany'
 $found=$s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver'")
 if([int]$found.ResultCode -ne 2){throw 'Search incomplete'}
 $items=New-Object -ComObject Microsoft.Update.UpdateColl
 foreach($id in $ids){$u=@($found.Updates | Where-Object {$_.Identity.UpdateID -eq $id})
  if($u.Count -ne 1 -or -not $u[0].EulaAccepted -or $u[0].InstallationBehavior.CanRequestUserInput -or $u[0].DriverClass -eq 'Firmware' -or $u[0].Title -match '\b(BIOS|firmware)\b'){throw 'Driver needs native review'}
  [void]$items.Add($u[0])
 }
 $download=$s.CreateUpdateDownloader();$download.Updates=$items;$d=$download.Download();$value.download_result=[int]$d.ResultCode
 if([int]$d.ResultCode -ne 2){throw 'Download incomplete'}
 $installer=$s.CreateUpdateInstaller();$installer.Updates=$items;$installer.AllowSourcePrompts=$false
 $r=$installer.Install();$value.install_result=[int]$r.ResultCode;$value.reboot_required=$r.RebootRequired
 $results=@(for($i=0;$i -lt $items.Count;$i++){[int]$r.GetUpdateResult($i).ResultCode})
 $value.update_results=$results;$value.installed=([int]$r.ResultCode -eq 2 -and @($results | Where-Object {$_ -ne 2}).Count -eq 0);$value.completed=$true
} catch {$value.error='Windows no completó la instalación; revisa Windows Update.'}
$parent=[IO.Path]::GetDirectoryName($output)
while($parent){if(([IO.File]::GetAttributes($parent) -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'A result path changed'};$parent=[IO.Path]::GetDirectoryName($parent)}
$json=$value|ConvertTo-Json -Compress -Depth 5
$stream=[IO.File]::Open($output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$raw=[Text.Encoding]::UTF8.GetBytes($json);$stream.Write($raw,0,$raw.Length)}finally{$stream.Dispose()}'''
        command=command.replace('IDS',','.join(literal(i) for i in ids)).replace('DEST',literal(path)).replace('NONCE',literal(nonce))
        proposal['state']='elevation_requested';(folder/'proposal.json').write_text(json.dumps(proposal,ensure_ascii=False,indent=2),encoding='utf-8')
        try:os.startfile(self.host(),operation='runas',arguments=subprocess.list2cmdline(['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',command]))
        except OSError as error:
            proposal['state']='launch_cancelled' if getattr(error,'winerror',None)==1223 else 'launch_failed';(folder/'proposal.json').write_text(json.dumps(proposal),encoding='utf-8');raise
        return {'requires_user':True,'proposal_id':identifier,'installation_verified':False,'message':'Windows recibió la instalación de los controladores revisados. La elevación se autoriza en su diálogo; no se reiniciará automáticamente.'}

    def result(self,identifier):
        if str(uuid.UUID(identifier))!=identifier:raise ValueError('Propuesta inválida.')
        from services.terminal.policy import scoped
        folder=scoped(self.root/identifier,[self.root],existing=True)
        proposal=json.loads((folder/'proposal.json').read_text(encoding='utf-8'));path=folder/'result.json'
        if not path.exists():return {'pending':True,'installed_verified':False,'proposal_id':identifier}
        scoped(path,[self.root],existing=True);value=json.loads(path.read_text(encoding='utf-8'))
        if value.get('nonce')!=proposal['nonce'] or value.get('ids')!=[u['id'] for u in proposal['updates']]:raise ValueError('El resultado no corresponde a la instalación preparada.')
        installed=value.get('completed') is True and value.get('installed') is True and value.get('install_result')==2 and value.get('update_results')==[2]*len(proposal['updates'])
        return {'pending':False,'installed_verified':installed,'reboot_required':bool(value.get('reboot_required')),'proposal_id':identifier,'message':'Windows Update confirmó la instalación.' if installed else 'No se confirmó la instalación. Revisa Windows Update antes de repetirla.'}
