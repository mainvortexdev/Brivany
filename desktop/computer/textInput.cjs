'use strict';
// Treat text as base64 data. Never interpolate user/model text in PowerShell.
function textScript(handle,controlId,text,{replace=false}={}){
 if(!/^\d+$/.test(handle)||!/^\d+(?:\.-?\d+)+$/.test(controlId)||typeof text!=='string'||text.length>10000)throw Error('Destino de escritura inválido.');
 const encoded=Buffer.from(text,'utf8').toString('base64');
 return `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
if([CogniraInput]::GetForegroundWindow().ToInt64().ToString() -ne '${handle}'){throw 'STALE_WINDOW'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${handle}))
$runtimeIds=[int[]]('${controlId}'.Split('.')|ForEach-Object{[int]$_})
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::RuntimeIdProperty,$runtimeIds)
$target=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
if(!$target -or $target.Current.IsPassword -or $target.Current.IsOffscreen -or !$target.Current.IsEnabled){throw 'STALE_CONTROL'}
$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
$pattern=$null
if($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern) -and !$pattern.Current.IsReadOnly){
 $original=$pattern.Current.Value
 $expected=${replace?'$text':'($original+$text)'}
 $pattern.SetValue($expected)
 if($pattern.Current.Value -ne $expected){throw 'TEXT_UNVERIFIED'}
 Write-Output 'VERIFIED';return
}
$target.SetFocus()
if(-not ('BrivanyUnicodeInput' -as [type])){
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BrivanyUnicodeInput {
 [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
 [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEYBOARD ki; [FieldOffset(0)] public MOUSE mi; }
 [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int dx,dy; public uint mouseData,flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] struct KEYBOARD { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
 [DllImport("user32.dll")] static extern uint SendInput(uint count,INPUT[] inputs,int size);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 public static void Write(long handle,string text) {
  foreach(char ch in text) {
   if(GetForegroundWindow().ToInt64()!=handle)throw new Exception("FOCUS_CHANGED");
   var down=new INPUT{type=1,data=new UNION{ki=new KEYBOARD{scan=ch,flags=4}}};
   var up=new INPUT{type=1,data=new UNION{ki=new KEYBOARD{scan=ch,flags=6}}};
   if(SendInput(2,new[]{down,up},Marshal.SizeOf(typeof(INPUT)))!=2)throw new Exception("INPUT_FAILED");
  }
 }
}
'@
}
[BrivanyUnicodeInput]::Write([long]${handle},$text)
Write-Output 'INPUT_SENT'`;
}
module.exports={textScript};
