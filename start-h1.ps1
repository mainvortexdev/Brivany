param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$runtimePython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$venvPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (Test-Path -LiteralPath $venvPython) { $brivanyPython = $venvPython }
elseif (Test-Path -LiteralPath $runtimePython) { $brivanyPython = $runtimePython }
else { $brivanyPython = 'python' }
Push-Location -LiteralPath $PSScriptRoot
try { & $brivanyPython -X utf8 -B -m services.h1.server --port $Port }
finally { Pop-Location }
