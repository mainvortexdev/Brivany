'use strict';
// Fallback for classic editors whose UIA provider exposes only container panes.
const source=String.raw`
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Accessibility;
public static class BrivanyWin32Text {
 public class Point { public int x,y; }
 public class Control { public string id,name,role;public Point point; }
 [StructLayout(LayoutKind.Sequential)]struct RECT {public int left,top,right,bottom;}
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out RECT rect);
 [DllImport("oleacc.dll")]static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IAccessible value);
 static bool IsEdit(string name){return name.Equals("Edit",StringComparison.OrdinalIgnoreCase)||name.StartsWith("RichEdit",StringComparison.OrdinalIgnoreCase)||name.StartsWith("WindowsForms10.EDIT.",StringComparison.OrdinalIgnoreCase);}
 static bool IsButton(string name){return name.Equals("Button",StringComparison.OrdinalIgnoreCase)||name.StartsWith("WindowsForms10.BUTTON.",StringComparison.OrdinalIgnoreCase);}
 delegate bool EnumProc(IntPtr hwnd,IntPtr param);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr param);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int length);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr h);
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint source,uint target,bool attach);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr h,int index);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW")] static extern IntPtr SendString(IntPtr h,uint msg,IntPtr wp,string value,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageTimeoutW")] static extern IntPtr ReadString(IntPtr h,uint msg,IntPtr wp,StringBuilder value,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW")] static extern IntPtr SendNumber(IntPtr h,uint msg,IntPtr wp,IntPtr lp,uint flags,uint timeout,out IntPtr result);
 static void Check(long parent,long child,bool button=false) {
  var p=new IntPtr(parent);var h=new IntPtr(child);uint pp,cp;GetWindowThreadProcessId(p,out pp);GetWindowThreadProcessId(h,out cp);
  var name=new StringBuilder(256);GetClassName(h,name,256);
  if(GetForegroundWindow()!=p||!IsChild(p,h)||pp!=cp||!IsWindowVisible(h)||!IsWindowEnabled(h)||
     !(button?IsButton(name.ToString()):IsEdit(name.ToString()))||
     !button&&(GetWindowLong(h,-16)&0x20)!=0)throw new Exception("STALE_OR_PROTECTED_TEXT_CONTROL");
 }
 public static List<Control> Observe(long parent) {
  var list=new List<Control>();
  EnumChildWindows(new IntPtr(parent),(h,p)=>{
   try{var type=new StringBuilder(256);GetClassName(h,type,256);bool button=IsButton(type.ToString());Check(parent,h.ToInt64(),button);string label="";
    IAccessible acc;Guid iid=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
    if(AccessibleObjectFromWindow(h,0xfffffffcu,ref iid,out acc)==0&&acc!=null){try{label=acc.get_accName(0)??"";}catch{}finally{Marshal.ReleaseComObject(acc);}}
    if(label.Length==0&&button){var caption=new StringBuilder(200);IntPtr result;ReadString(h,13,new IntPtr(caption.Capacity),caption,2,1000,out result);label=caption.ToString();}
    if(label.Length==0)label="Editor de texto observado";if(label.Length>160)label=label.Substring(0,160);RECT r;GetWindowRect(h,out r);
    list.Add(new Control{id="win32:"+h.ToInt64(),name=label,role=button?"ControlType.Button":"ControlType.Edit",point=new Point{x=(r.left+r.right)/2,y=(r.top+r.bottom)/2}});
   }catch{}
   return list.Count<50;
  },IntPtr.Zero);return list;
 }
 public static string Read(long parent,long child) {
  Check(parent,child);IntPtr count,result;var h=new IntPtr(child);
  if(SendNumber(h,14,IntPtr.Zero,IntPtr.Zero,2,2000,out count)==IntPtr.Zero||count.ToInt64()>20000)throw new Exception("TEXT_LIMIT_OR_TIMEOUT");
  var text=new StringBuilder((int)count.ToInt64()+1);
  if(ReadString(h,13,new IntPtr(text.Capacity),text,2,2000,out result)==IntPtr.Zero)throw new Exception("TEXT_READ_FAILED");return text.ToString();
 }
 public static void Append(long parent,long child,string text) {
  var original=Read(parent,child);var h=new IntPtr(child);IntPtr result;
  if(original.Length+text.Length>20000)throw new Exception("TEXT_LIMIT");
  Check(parent,child);
  if(SendNumber(h,177,new IntPtr(original.Length),new IntPtr(original.Length),2,2000,out result)==IntPtr.Zero||
     SendString(h,194,new IntPtr(1),text,2,2000,out result)==IntPtr.Zero)throw new Exception("TEXT_WRITE_FAILED");
  if(Read(parent,child)!=original+text)throw new Exception("TEXT_UNVERIFIED");
 }
 public static void Focus(long parent,long child) {
  Check(parent,child);uint pid;var thread=GetWindowThreadProcessId(new IntPtr(child),out pid);var current=GetCurrentThreadId();
  var attached=thread!=current&&AttachThreadInput(current,thread,true);
  try{SetFocus(new IntPtr(child));}finally{if(attached)AttachThreadInput(current,thread,false);}
 }
 public static void Click(long parent,long child) {
  Check(parent,child,true);IntPtr result;if(SendNumber(new IntPtr(child),0x00f5,IntPtr.Zero,IntPtr.Zero,2,2000,out result)==IntPtr.Zero)throw new Exception("BUTTON_TIMEOUT");
 }
}`;
function bootstrap(){return `if(-not ('BrivanyWin32Text' -as [type])){Add-Type -AssemblyName Accessibility;Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'\n${source}\n'@\n}`;}
function identity(handle,controlId){if(!/^\d+$/.test(handle)||!/^win32:\d+$/.test(controlId))throw Error('Control Win32 inválido');return controlId.slice(6);}
function readScript(handle,controlId){const child=identity(handle,controlId);return bootstrap()+`\nConvertTo-Json -InputObject @{text=[BrivanyWin32Text]::Read([long]${handle},[long]${child})} -Compress`;}
function appendScript(handle,controlId,text){const child=identity(handle,controlId),encoded=Buffer.from(text,'utf8').toString('base64');return bootstrap()+`\n$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));[BrivanyWin32Text]::Append([long]${handle},[long]${child},$text);Write-Output 'VERIFIED'`;}
function focusScript(handle,controlId){const child=identity(handle,controlId);return bootstrap()+`\n[BrivanyWin32Text]::Focus([long]${handle},[long]${child});Write-Output 'FOCUSED'`;}
function clickScript(handle,controlId){const child=identity(handle,controlId);return bootstrap()+`\n[BrivanyWin32Text]::Click([long]${handle},[long]${child});Write-Output 'CLICKED'`;}
module.exports={bootstrap,readScript,appendScript,focusScript,clickScript};
