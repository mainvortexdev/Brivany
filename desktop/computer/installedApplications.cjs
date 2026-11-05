'use strict';
const catalogScript=String.raw`$shell=New-Object -ComObject WScript.Shell
$targets=@{}
@([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu')) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter '*.lnk' -Recurse -File -ErrorAction SilentlyContinue } | ForEach-Object {
 try {$link=$shell.CreateShortcut($_.FullName);$target=[string]$link.TargetPath;if([IO.Path]::GetExtension($target) -eq '.exe' -and (Test-Path -LiteralPath $target -PathType Leaf)){$targets[$_.BaseName]=[IO.Path]::GetFileName($target)}}catch{}
}
@(Get-StartApps | ForEach-Object { @{id=[string]$_.AppID;name=[string]$_.Name;executableName=$targets[[string]$_.Name];source=$(if([string]$_.AppID -match '!'){'package'}else{'start-menu'})} }) | ConvertTo-Json -Compress`;
function packageMetadataScript(entry){
 if(!/^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$/.test(entry.id))throw Error('Paquete no observado.');
 const encoded=Buffer.from(entry.id).toString('base64');
 return `$appId=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$parts=$appId.Split('!');$package=Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $parts[0] }
if(@($package).Count -ne 1){throw 'APPLICATION_PACKAGE_NOT_INSTALLED'}
$manifest=Get-AppxPackageManifest -Package $package.PackageFullName
$application=@($manifest.Package.Applications.Application | Where-Object { $_.Id -eq $parts[1] })
if($application.Count -ne 1){throw 'APPLICATION_ENTRY_NOT_UNIQUE'}
$name=[IO.Path]::GetFileName([string]$application[0].Executable)
@{executableName=$name;source='package';installed=$true} | ConvertTo-Json -Compress`;
}
function packageLaunchScript(entry){
 if(!/^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$/.test(entry.id))throw Error('Paquete no observado.');
 const encoded=Buffer.from(JSON.stringify({id:entry.id,name:entry.name})).toString('base64');
 return `$selection=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
if(-not ('MelodiPackageStart' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
[ComImport,Guid("2e941141-7f97-4756-ba1d-9decde894a3d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface MelodiActivation {[PreserveSig]int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id,[MarshalAs(UnmanagedType.LPWStr)] string args,uint options,out uint pid);}
public static class MelodiPackageStart {public static uint Run(string id){var manager=(MelodiActivation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));uint pid;try{int result=manager.ActivateApplication(id,null,2,out pid);Marshal.ThrowExceptionForHR(result);return pid;}finally{Marshal.ReleaseComObject(manager);}}}
'@}
$started=[MelodiPackageStart]::Run([string]$selection.id)
$process=Get-Process -Id $started -ErrorAction SilentlyContinue
@{launched=$selection.name;process_id=$started;verified=($null -ne $process);method='observed-package-activation';background=$false;input_sent=$false} | ConvertTo-Json -Compress`;
}
module.exports={catalogScript,packageMetadataScript,packageLaunchScript};
