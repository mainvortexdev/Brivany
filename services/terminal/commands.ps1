param([Parameter(Mandatory=$true)][string]$Recipe,[Parameter(Mandatory=$true)][string]$Workspace)
$ErrorActionPreference='Stop'
$seed=Join-Path $Workspace 'seed.txt'
$TerminalFixture='melodi'
$value=switch($Recipe){
 'Get-Date' { (Get-Date).ToString('o') }
 'Get-Location' { (Get-Location).Path }
 'Test-Path' { Test-Path -LiteralPath $seed -PathType Leaf }
 'Get-Item' { (Get-Item -LiteralPath $seed).Length }
 'Get-ChildItem' { @(Get-ChildItem -LiteralPath $Workspace -File | Select-Object -ExpandProperty Name) }
 'Join-Path' { Join-Path $Workspace 'seed.txt' }
 'Split-Path' { Split-Path -Path $seed -Leaf }
 'Resolve-Path' { (Resolve-Path -LiteralPath $seed).Path }
 'Get-FileHash' { (Get-FileHash -LiteralPath $seed -Algorithm SHA256).Hash }
 'Get-Content' { @(Get-Content -LiteralPath $seed -Encoding UTF8) }
 'New-Item' { [bool](New-Item -Path (Join-Path $Workspace 'new-directory') -ItemType Directory) }
 'Set-Content' { Set-Content -LiteralPath (Join-Path $Workspace 'set.txt') -Value 'alpha' -NoNewline -Encoding UTF8; Get-Content -LiteralPath (Join-Path $Workspace 'set.txt') -Raw }
 'Add-Content' { Add-Content -LiteralPath (Join-Path $Workspace 'append.txt') -Value 'beta' -Encoding UTF8; @(Get-Content -LiteralPath (Join-Path $Workspace 'append.txt')) }
 'Copy-Item' { Copy-Item -LiteralPath $seed -Destination (Join-Path $Workspace 'copy.txt'); (Get-FileHash -LiteralPath (Join-Path $Workspace 'copy.txt')).Hash }
 'Move-Item' { Move-Item -LiteralPath $seed -Destination (Join-Path $Workspace 'moved.txt'); @{old=(Test-Path -LiteralPath $seed);new=(Test-Path -LiteralPath (Join-Path $Workspace 'moved.txt'))} }
 'Rename-Item' { Rename-Item -LiteralPath $seed -NewName 'renamed.txt'; @{old=(Test-Path -LiteralPath $seed);new=(Test-Path -LiteralPath (Join-Path $Workspace 'renamed.txt'))} }
 'Remove-Item' { Remove-Item -LiteralPath $seed; Test-Path -LiteralPath $seed }
 'Get-Command' { (Get-Command -Name 'Get-Date' -CommandType Cmdlet).Name }
 'Get-Help' { (Get-Help -Name 'Get-Date').Name }
 'Get-Module' { @(Get-Module -ListAvailable -Name Microsoft.PowerShell.Utility | Select-Object -ExpandProperty Name) }
 'Get-PSProvider' { (Get-PSProvider -PSProvider FileSystem).Name }
 'Get-PSDrive' { @(Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name) }
 'Get-Process' { (Get-Process -Id $PID).Id }
 'Get-Culture' { (Get-Culture).Name }
 'Get-UICulture' { (Get-UICulture).Name }
 'Measure-Object' { (@(1,2,3,4) | Measure-Object).Count }
 'Select-Object' { [pscustomobject]@{Alpha=1;Beta=2} | Select-Object Alpha }
 'Sort-Object' { @(3,1,2 | Sort-Object) }
 'Where-Object' { @(1,2,3,4 | Where-Object {$_ -gt 2}) }
 'Group-Object' { @('a','b','a' | Group-Object | Select-Object Name,Count) }
 'Compare-Object' { @(Compare-Object -ReferenceObject @(1,2) -DifferenceObject @(2,3) | Select-Object InputObject,SideIndicator) }
 'ConvertTo-Json' { @{probe='melodi';n=2} | ConvertTo-Json -Compress }
 'ConvertFrom-Json' { '{"probe":"melodi","n":2}' | ConvertFrom-Json }
 'Export-Csv' { [pscustomobject]@{Probe='melodi';Number=2} | Export-Csv -LiteralPath (Join-Path $Workspace 'export.csv') -NoTypeInformation -Encoding UTF8; (Import-Csv -LiteralPath (Join-Path $Workspace 'export.csv')).Probe }
 'Import-Csv' { Import-Csv -LiteralPath (Join-Path $Workspace 'input.csv') }
 'Select-String' { (Select-String -LiteralPath $seed -Pattern '^terminal$').Line }
 'Out-File' { 'melodi' | Out-File -LiteralPath (Join-Path $Workspace 'out.txt') -Encoding UTF8; (Get-Content -LiteralPath (Join-Path $Workspace 'out.txt') -Raw).Trim() }
 'Tee-Object' { 'melodi' | Tee-Object -FilePath (Join-Path $Workspace 'tee.txt') }
 'Compress-Archive' { Compress-Archive -LiteralPath $seed -DestinationPath (Join-Path $Workspace 'compressed.zip'); Test-Path -LiteralPath (Join-Path $Workspace 'compressed.zip') }
 'Expand-Archive' { Expand-Archive -LiteralPath (Join-Path $Workspace 'input.zip') -DestinationPath (Join-Path $Workspace 'expanded'); Get-Content -LiteralPath (Join-Path $Workspace 'expanded/inside.txt') -Raw }
 'New-Guid' { (New-Guid).ToString() }
 'Get-Random' { Get-Random -Minimum 1 -Maximum 100 }
 'Get-Verb' { @(Get-Verb | Select-Object -ExpandProperty Verb) }
 'Get-Alias' { (Get-Alias -Name gc).Definition }
 'Get-Variable' { (Get-Variable -Name TerminalFixture).Value }
 default {throw 'La receta no está implementada; no se ejecutó otro comando.'}
}
@{recipe=$Recipe;value=$value;process_id=$PID} | ConvertTo-Json -Compress -Depth 6
