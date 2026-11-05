'use strict';
function launchScript(selected){
 if(!selected||typeof selected.name!=='string'||typeof selected.id!=='string'||selected.name.length>200||selected.id.length>1000)throw Error('Aplicación no observada.');
 const encoded=Buffer.from(JSON.stringify({name:selected.name,id:selected.id}),'utf8').toString('base64');
 return `$selection=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$locations=@([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'))
$links=@($locations | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter '*.lnk' -Recurse -File -ErrorAction SilentlyContinue } | Where-Object { $_.BaseName -eq $selection.name })
if($links.Count -ne 1){throw 'BACKGROUND_SHORTCUT_NOT_UNIQUE'}
$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($links[0].FullName)
$target=[string]$shortcut.TargetPath
if(![IO.Path]::IsPathRooted($target) -or $target.StartsWith('\\\\') -or [IO.Path]::GetExtension($target) -ne '.exe' -or !(Test-Path -LiteralPath $target -PathType Leaf)){throw 'BACKGROUND_TARGET_UNAVAILABLE'}
if([IO.Path]::GetFileNameWithoutExtension($target) -match '^(regedit|reg|cmd|powershell|pwsh|consent|winlogon|taskmgr|wscript|cscript|mshta|rundll32|runas)$'){throw 'BACKGROUND_TARGET_PROTECTED'}
if(-not ('MelodiBackgroundStart' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class MelodiBackgroundStart {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct Info {public int size;public uint mask;public IntPtr hwnd;public string verb,file,parameters,directory;public int show;public IntPtr instance,list;public string className;public IntPtr key;public uint hotkey;public IntPtr icon,process;}
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ShellExecuteEx(ref Info info);
 [DllImport("kernel32.dll")]static extern uint GetProcessId(IntPtr handle);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 public static uint Run(string file,string arguments,string directory){var info=new Info{size=Marshal.SizeOf(typeof(Info)),mask=0x40,verb="open",file=file,parameters=arguments,directory=directory,show=7};if(!ShellExecuteEx(ref info))throw new Exception("BACKGROUND_START_FAILED");try{return info.process==IntPtr.Zero?0:GetProcessId(info.process);}finally{if(info.process!=IntPtr.Zero)CloseHandle(info.process);}}
}
'@}
$started=[MelodiBackgroundStart]::Run($target,[string]$shortcut.Arguments,[string]$shortcut.WorkingDirectory)
$running=@(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($target)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target })
if($running.Count -gt 0){$started=$running[0].Id}
@{launched=$selection.name;process_id=$started;method='observed-shortcut-background';verified=($running.Count -gt 0);background=$true;input_sent=$false} | ConvertTo-Json -Compress`;
}
module.exports={launchScript};
