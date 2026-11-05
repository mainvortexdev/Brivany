"""The user's desktop scope supersedes the initial Windows Server inventory."""
from .recipes import RECIPES

DESKTOP_PS=set(RECIPES)|set('''Get-Command Get-Help Get-Module Import-Module Remove-Module Test-ModuleManifest
Get-History Get-Host Read-Host Write-Host Write-Output Write-Warning Write-Error
Get-PSReadLineOption Get-PSReadLineKeyHandler Set-PSReadLineOption
Get-Clipboard Set-Clipboard Get-ItemProperty Get-ItemPropertyValue
Test-Connection Resolve-DnsName Test-NetConnection Get-NetIPConfiguration
Get-NetIPAddress Get-NetTCPConnection Get-NetAdapter Get-NetRoute
Get-Service Start-Process Stop-Process Wait-Process
Get-TimeZone Get-ComputerInfo Get-HotFix Get-AuthenticodeSignature Get-ExecutionPolicy
Get-FileHash Get-Acl Get-Volume Get-Disk Get-Partition
Invoke-WebRequest Invoke-RestMethod Start-BitsTransfer Get-BitsTransfer
ConvertTo-Csv ConvertFrom-Csv ConvertTo-Xml Select-Xml ConvertTo-Html
Format-Table Format-List Format-Wide Out-String Out-Null Out-GridView
Measure-Command Start-Sleep Write-Progress Get-Unique ForEach-Object
Get-EventLog Get-WinEvent Test-Json Get-Error Get-Content Get-Verb
New-Variable Set-Variable Remove-Variable Clear-Variable
Start-Job Get-Job Receive-Job Wait-Job Stop-Job Remove-Job Start-ThreadJob
Find-Package Get-Package Get-PackageProvider Find-PSResource Get-InstalledPSResource
Find-Module Get-InstalledModule Find-Script Get-InstalledScript
Get-FileHash Compress-Archive Expand-Archive New-Guid
'''.split())

DESKTOP_NATIVE=set('''arp attrib call cd chcp chdir chkdsk choice clip cls cmd color comp compact copy
curl date del dir doskey driverquery echo exit expand fc find findstr for getmac help hostname
ipconfig label md mkdir mklink mode more move net netstat nslookup path pathping pause ping
popd powershell print prompt pushd rd recover rem ren rename replace rmdir robocopy route
set setlocal shift sort start subst systeminfo taskkill tasklist time timeout title tracert tree
type ver verify vol where whoami xcopy tar ssh scp sftp winget python node npm git
'''.split())

DESKTOP_MODULES={'Microsoft.PowerShell.Core','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management','Microsoft.PowerShell.Archive','Microsoft.PowerShell.Security','Microsoft.PowerShell.Host','Microsoft.PowerShell.Diagnostics','Microsoft.PowerShell.ThreadJob','Microsoft.PowerShell.PSResourceGet','PSReadLine','PSScheduledJob','NetTCPIP','DnsClient','NetAdapter','Storage','BitsTransfer','PackageManagement','PowerShellGet'}


def desktop_entry(entry):
    if entry.get('policy')=='registry_forbidden':return False
    if entry.get('kind')=='powershell':return entry.get('name') in DESKTOP_PS and entry.get('module') in DESKTOP_MODULES
    if entry.get('kind')=='windows_command':return entry.get('name','').casefold() in DESKTOP_NATIVE
    return False


def core_entries():
    # Commands omitted by Get-Command -CommandType Cmdlet -ListAvailable: some
    # are built into the engine or exposed as functions. Documentation is not
    # a claim that the current execution policy permits their implementation.
    modules={
      'Microsoft.PowerShell.Core':['Get-Command','Get-Help','Get-Module','Import-Module','Remove-Module','Where-Object','ForEach-Object','Get-History','Get-Verb'],
      'Microsoft.PowerShell.Utility':['Get-FileHash','New-Guid'],
      'Microsoft.PowerShell.Archive':['Compress-Archive','Expand-Archive']}
    return [{'id':'windows.ps.'+module.lower()+'.'+name.lower(),'name':name,'module':module,'platform':'windows','kind':'powershell','source':'https://learn.microsoft.com/en-us/powershell/module/'+module.lower()+'/'+name.lower()+'?view=powershell-5.1','availability':'requires_command_check','policy':'review_required'} for module,names in modules.items() for name in names]
