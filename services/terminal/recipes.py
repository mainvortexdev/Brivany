"""Individual terminal commands; no PS1, policy change, encoded shell or eval."""
from .policy import TerminalError

RECIPES=['Get-Date','Get-Location','Test-Path','Get-Item','Get-ChildItem','Join-Path','Split-Path','Resolve-Path','Get-FileHash','Get-Content','New-Item','Set-Content','Add-Content','Copy-Item','Move-Item','Rename-Item','Remove-Item','Get-Command','Get-Help','Get-Module','Get-PSProvider','Get-PSDrive','Get-Process','Get-Culture','Get-UICulture','Measure-Object','Select-Object','Sort-Object','Where-Object','Group-Object','Compare-Object','ConvertTo-Json','ConvertFrom-Json','Export-Csv','Import-Csv','Select-String','Out-File','Tee-Object','Compress-Archive','Expand-Archive','New-Guid','Get-Random','Get-Verb','Get-Alias','Get-Variable']


def literal(value):return "'"+str(value).replace("'","''")+"'"


def command(name,workspace,fixture_url=None):
    seed=literal(workspace/'seed.txt');join=lambda leaf:literal(workspace/leaf)
    commands={
      'Get-BitsTransfer':'[int](@(Get-BitsTransfer -ErrorAction Stop).Count)',
      'Resolve-DnsName':"@(Resolve-DnsName -Name localhost -Type A -ErrorAction Stop | Where-Object {$_.IPAddress} | Select-Object -ExpandProperty IPAddress)",
      'Get-NetAdapter':'[int](@(Get-NetAdapter -IncludeHidden -ErrorAction Stop).Count)',
      'Get-NetIPAddress':"(Get-NetIPAddress -IPAddress '127.0.0.1' -AddressFamily IPv4 -ErrorAction Stop).IPAddress",
      'Get-NetIPConfiguration':'[int](@(Get-NetIPConfiguration -All -ErrorAction Stop).Count)',
      'Get-NetRoute':"@(Get-NetRoute -DestinationPrefix '127.0.0.0/8' -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty DestinationPrefix)",
      'Get-Disk':'[int](@(Get-Disk -ErrorAction Stop).Count)',
      'Get-Partition':'[int](@(Get-Partition -ErrorAction Stop).Count)',
      'Get-Volume':f"(Get-Volume -DriveLetter {literal(workspace.drive.rstrip(':'))} -ErrorAction Stop).DriveLetter",
      'Get-Date':"Get-Date -Format o",'Get-Location':'(Get-Location).Path','Test-Path':f'Test-Path -LiteralPath {seed} -PathType Leaf',
      'Get-Item':f'(Get-Item -LiteralPath {seed}).Length','Get-ChildItem':f'@(Get-ChildItem -LiteralPath {literal(workspace)} -File | Select-Object -ExpandProperty Name)',
      'Join-Path':f'Join-Path {literal(workspace)} seed.txt','Split-Path':f'Split-Path -Path {seed} -Leaf','Resolve-Path':f'(Resolve-Path -LiteralPath {seed}).Path',
      'Get-FileHash':f'(Get-FileHash -LiteralPath {seed} -Algorithm SHA256).Hash','Get-Content':f'@(Get-Content -LiteralPath {seed} -Encoding UTF8 | ForEach-Object {{ [string]::new([char[]]$_.ToString()) }})',
      'New-Item':f'(New-Item -Path {join("new-directory")} -ItemType Directory).FullName',
      'Set-Content':f'Set-Content -LiteralPath {join("set.txt")} -Value alpha -NoNewline -Encoding UTF8',
      'Add-Content':f'Add-Content -LiteralPath {join("append.txt")} -Value beta -Encoding UTF8',
      'Copy-Item':f'Copy-Item -LiteralPath {seed} -Destination {join("copy.txt")}',
      'Move-Item':f'Move-Item -LiteralPath {seed} -Destination {join("moved.txt")}',
      'Rename-Item':f'Rename-Item -LiteralPath {seed} -NewName renamed.txt','Remove-Item':f'Remove-Item -LiteralPath {seed}',
      'Get-Command':"(Get-Command -Name Get-Date -CommandType Cmdlet).Name",'Get-Help':"(Get-Help -Name Get-Date).Name",
      'Get-Module':"@(Get-Module -ListAvailable -Name Microsoft.PowerShell.Utility | Select-Object -ExpandProperty Name)",
      'Get-PSProvider':"(Get-PSProvider -PSProvider FileSystem).Name",'Get-PSDrive':"@(Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name)",
      'Get-Process':'(Get-Process -Id $PID).Id','Get-Culture':'(Get-Culture).Name','Get-UICulture':'(Get-UICulture).Name',
      'Measure-Object':'(@(1,2,3,4) | Measure-Object).Count','Select-Object':"[pscustomobject]@{Alpha=1;Beta=2} | Select-Object Alpha",
      'Sort-Object':'@(3,1,2 | Sort-Object)','Where-Object':'@(1,2,3,4 | Where-Object {$_ -gt 2})',
      'Group-Object':"@('a','b','a' | Group-Object | Select-Object Name,Count)",
      'Compare-Object':'@(Compare-Object -ReferenceObject @(1,2) -DifferenceObject @(2,3) | Select-Object InputObject,SideIndicator)',
      'ConvertTo-Json':"@{probe='melodi';n=2} | ConvertTo-Json -Compress",'ConvertFrom-Json':"'{\"probe\":\"melodi\",\"n\":2}' | ConvertFrom-Json",
      'Export-Csv':f"[pscustomobject]@{{Probe='melodi';Number=2}} | Export-Csv -LiteralPath {join('export.csv')} -NoTypeInformation -Encoding UTF8",
      'Import-Csv':f'Import-Csv -LiteralPath {join("input.csv")}','Select-String':f'(Select-String -LiteralPath {seed} -Pattern "^terminal$").Line',
      'Out-File':f"'melodi' | Out-File -LiteralPath {join('out.txt')} -Encoding UTF8",'Tee-Object':f"'melodi' | Tee-Object -FilePath {join('tee.txt')}",
      'Compress-Archive':f'Compress-Archive -LiteralPath {seed} -DestinationPath {join("compressed.zip")}',
      'Expand-Archive':f'Expand-Archive -LiteralPath {join("input.zip")} -DestinationPath {join("expanded")}',
      'New-Guid':'(New-Guid).ToString()','Get-Random':'Get-Random -Minimum 1 -Maximum 100','Get-Verb':'@(Get-Verb | Select-Object -ExpandProperty Verb)',
      'Get-Alias':'(Get-Alias -Name gc).Definition','Get-Variable':"(Get-Variable -Name PSVersionTable).Name"
    }
    if name=='Start-BitsTransfer':
        import re
        if not isinstance(fixture_url,str) or not re.fullmatch(r'http://127\.0\.0\.1:\d+/fixture\.txt',fixture_url):raise TerminalError('Esta prueba necesita su servidor loopback identificado.')
        commands[name]=f'Start-BitsTransfer -Source {literal(fixture_url)} -Destination {join("download.txt")} -DisplayName {literal("Melodi-check-"+workspace.name)} -Description "Owned synthetic local test" -RetryInterval 60 -RetryTimeout 60'
    if name in {'Get-NetTCPConnection','Test-NetConnection'}:
        from urllib.parse import urlsplit
        import re
        if not isinstance(fixture_url,str) or not re.fullmatch(r'http://127\.0\.0\.1:\d+/fixture\.txt',fixture_url):raise TerminalError('Esta prueba necesita su servidor loopback identificado.')
        port=urlsplit(fixture_url).port
        commands[name]=(f"(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort {port} -State Listen -ErrorAction Stop).LocalPort" if name=='Get-NetTCPConnection' else f"[bool](Test-NetConnection -ComputerName '127.0.0.1' -Port {port} -InformationLevel Quiet -WarningAction SilentlyContinue)")
    if name not in commands:raise TerminalError('No hay una receta individual verificada para este comando.')
    # Formatting is fixed application code, not an evaluated documentation example.
    return "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); "+'& { '+commands[name]+' } | ConvertTo-Json -Compress -Depth 6'


RECIPES += ['Get-BitsTransfer','Start-BitsTransfer','Resolve-DnsName','Get-NetAdapter','Get-NetIPAddress','Get-NetIPConfiguration','Get-NetRoute','Get-NetTCPConnection','Test-NetConnection','Get-Disk','Get-Partition','Get-Volume']
