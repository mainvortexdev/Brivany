"""An explicit Windows UAC request for a single, fixed read-only diagnostic."""
from datetime import datetime,timezone
import ctypes
import json
import os
from pathlib import Path
import secrets
import subprocess
import uuid
from .policy import TerminalError,scoped
from .recipes import literal


def system_directory():
    if os.name!='nt':raise TerminalError('Esta operación necesita Windows.','terminal_platform_unavailable')
    buffer=ctypes.create_unicode_buffer(32768)
    if not ctypes.windll.kernel32.GetSystemDirectoryW(buffer,len(buffer)):raise ctypes.WinError()
    return Path(buffer.value)


def diagnostic_command(directory,identifier,nonce):
    directory=Path(directory).resolve();output=directory/'result.json'
    if str(uuid.UUID(identifier))!=identifier or not isinstance(nonce,str) or len(nonce)!=64:raise TerminalError('Solicitud elevada inválida.')
    binary=system_directory()/'chkdsk.exe';drive=binary.drive
    # Fixed application code. No scripts from a model, registry access,
    # execution-policy changes, eval, repair flags or user-provided shell.
    return f'''$ErrorActionPreference='Stop';$directory={literal(directory)};$destination={literal(output)}
$cursor=[IO.DirectoryInfo]::new($directory)
while($null -ne $cursor){{if(($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){{throw 'REPARSE_PATH'}};$cursor=$cursor.Parent}}
$elevated=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $elevated){{throw 'ADMIN_TOKEN_REQUIRED'}}
Set-Location -LiteralPath $directory
[Console]::OutputEncoding=[Text.Encoding]::GetEncoding({ctypes.windll.kernel32.GetOEMCP()})
$started=[DateTime]::UtcNow.ToString('o')
$lines=@(& {literal(binary)} {literal(drive)} 2>&1);$exitCode=$LASTEXITCODE
$text=($lines | Out-String -Width 240);if($text.Length -gt 180000){{$text=$text.Substring(0,180000);$truncated=$true}}else{{$truncated=$false}}
$receipt=[ordered]@{{request_id={literal(identifier)};nonce={literal(nonce)};profile='chkdsk-readonly';admin_token=$elevated;pid=$PID;binary={literal(binary)};arguments=@({literal(drive)});cwd=(Get-Location).Path;started_at=$started;finished_at=[DateTime]::UtcNow.ToString('o');exit_code=$exitCode;output=$text;output_truncated=$truncated;repair_requested=$false}}
$json=$receipt | ConvertTo-Json -Compress -Depth 4;$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json)
$file=[IO.File]::Open($destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{{$file.Write($bytes,0,$bytes.Length)}}finally{{$file.Dispose()}}'''


class ElevationRequests:
    def __init__(self,root):self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True)

    def prepare_chkdsk(self):
        identifier=str(uuid.uuid4());directory=self.root/identifier;directory.mkdir()
        nonce=secrets.token_hex(32)
        request={'id':identifier,'profile':'chkdsk-readonly','nonce':nonce,'directory':str(directory),'result':str(directory/'result.json'),'requested_at':datetime.now(timezone.utc).isoformat(),'state':'prepared','binary':str(system_directory()/'chkdsk.exe'),'arguments':[system_directory().drive],'repair_requested':False}
        command=diagnostic_command(directory,identifier,nonce)
        (directory/'command.txt').write_text(command,encoding='utf-8');(directory/'request.json').write_text(json.dumps(request,ensure_ascii=False,indent=2),encoding='utf-8')
        return request

    def launch(self,request):
        directory=scoped(request['directory'],[self.root],existing=True)
        if directory.name!=request['id'] or (directory/'result.json').exists():raise TerminalError('La solicitud ya tiene un resultado o no corresponde a su carpeta.')
        command=diagnostic_command(directory,request['id'],request['nonce'])
        host=system_directory()/'WindowsPowerShell/v1.0/powershell.exe'
        try:os.startfile(str(host),operation='runas',arguments=subprocess.list2cmdline(['-NoLogo','-NoProfile','-NonInteractive','-Command',command]))
        except OSError as error:
            if getattr(error,'winerror',None)==1223:raise TerminalError('Windows no autorizó la elevación; no se repitió ni avanzó la checklist.','terminal_elevation_cancelled') from error
            raise
        request['state']='uac_requested';(directory/'request.json').write_text(json.dumps(request,ensure_ascii=False,indent=2),encoding='utf-8')
        return {'request_id':request['id'],'requires_windows_consent':True,'repair_requested':False,'diagnostic_started_verified':False}

    def result(self,request):
        file=scoped(request['result'],[self.root],existing=True)
        if file.stat().st_size>260000:raise TerminalError('Resultado de diagnóstico demasiado grande.')
        value=json.loads(file.read_text(encoding='utf-8'))
        expected={'request_id':request['id'],'nonce':request['nonce'],'profile':'chkdsk-readonly','binary':request['binary'],'arguments':request['arguments'],'cwd':request['directory'],'repair_requested':False,'admin_token':True}
        if any(value.get(key)!=expected_value for key,expected_value in expected.items()) or value.get('admin_token') is not True or value.get('repair_requested') is not False or type(value.get('pid')) is not int or type(value.get('exit_code')) is not int or not isinstance(value.get('output'),str):raise TerminalError('El recibo no corresponde al diagnóstico elevado preparado.')
        return value
