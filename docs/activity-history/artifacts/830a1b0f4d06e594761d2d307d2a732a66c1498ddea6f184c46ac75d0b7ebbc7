'use strict';
const path=require('node:path');
const {spawn}=require('node:child_process');
const {appendScript}=require('./win32Text.cjs');

const uia='Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop';

const accessibility=String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Accessibility;

public static class BrivanyPaintControls {
 [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IAccessible value);
 [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible parent,int first,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]object[] children,out int obtained);
 delegate bool Visitor(IntPtr hwnd,IntPtr param);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd,Visitor visitor,IntPtr param);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
 [DllImport("user32.dll")] static extern bool IsChild(IntPtr hwnd,IntPtr child);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
 public class Control { public string name; public int x,y,right,bottom,role; }
 static void Walk(IAccessible parent,object child,bool tool,List<Control> controls,int depth,ref int budget) {
  if(--budget<0||depth>24)return;
  try {
   var name=(parent.get_accName(child)??"").Trim();
   int state=Convert.ToInt32(parent.get_accState(child)),role=Convert.ToInt32(parent.get_accRole(child));
   bool match=tool?(role==43||role==44||role==45||role==62||role==12)&&
     (name.Equals("Texto",StringComparison.OrdinalIgnoreCase)||name.Equals("Text",StringComparison.OrdinalIgnoreCase)):
     (role==16||role==10||role==15||role==33)&&System.Text.RegularExpressions.Regex.IsMatch(name,@"^(Usando .* (en|sobre) (el )?Lienzo|Using .* on (the )?Canvas|Lienzo|Canvas)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
   if(match&&(state&0x18001)==0){
    int x,y,w,h;parent.accLocation(out x,out y,out w,out h,child);
    if(w>=4&&h>=4&&!controls.Exists(row=>row.x==x&&row.y==y&&row.right==x+w&&row.bottom==y+h))
     controls.Add(new Control{name=name,x=x,y=y,right=x+w,bottom=y+h,role=role});
   }
  }catch{}
  if(!child.Equals(0))return;
  try {
   int count=Math.Min(parent.accChildCount,512),got;
   if(count<1)return;
   var children=new object[count];
   if(AccessibleChildren(parent,0,count,children,out got)<0)return;
   for(int i=0;i<got&&budget>0;i++){
    var nested=children[i] as IAccessible;
    if(nested!=null)Walk(nested,0,tool,controls,depth+1,ref budget);
    else if(children[i] is int)Walk(parent,children[i],tool,controls,depth+1,ref budget);
   }
  }catch{}
 }
 public static List<Control> Observe(long handle,bool tool){
  var hwnd=new IntPtr(handle);var controls=new List<Control>();
  if(GetForegroundWindow()!=hwnd)throw new Exception("PAINT_FOCUS_CHANGED");
  var windows=new List<IntPtr>{hwnd};
  EnumChildWindows(hwnd,(child,unused)=>{if(IsWindowVisible(child))windows.Add(child);return windows.Count<100;},IntPtr.Zero);
  foreach(var window in windows){
   IAccessible accessible;var iid=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
   if(AccessibleObjectFromWindow(window,0xfffffffcu,ref iid,out accessible)!=0||accessible==null)continue;
   int budget=1800;
   Walk(accessible,0,tool,controls,0,ref budget);
  }
  return controls;
 }
 public static bool Hit(long handle,int x,int y){
  var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
  try{
   var hwnd=new IntPtr(handle);var hit=WindowFromPoint(new POINT{x=x,y=y});
   return GetForegroundWindow()==hwnd&&(hit==hwnd||IsChild(hwnd,hit));
  }finally{if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);}
 }
}
`;

function accessibilityScript(handle,tool){
 return `if(-not ('BrivanyPaintControls' -as [type])){
 Add-Type -AssemblyName Accessibility
 Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'
${accessibility}
'@
}
$observed=[BrivanyPaintControls]::Observe([long]${handle},$${tool?'true':'false'})
if($observed.Count -ne 1){throw '${tool?'PAINT_TEXT_BUTTON_NOT_FOUND':'PAINT_CANVAS_NOT_FOUND'}'}
ConvertTo-Json -InputObject $observed[0] -Compress`;
}

function paintRoot(handle){
 return `${uia}
if([CogniraInput]::GetForegroundWindow().ToInt64() -ne ${handle}){throw 'PAINT_FOCUS_CHANGED'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${handle}))`;
}

function observeScript(handle,tool){
 return `${paintRoot(handle)}
$condition=[System.Windows.Automation.Condition]::TrueCondition
$matches=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition) | Where-Object {
  !$_.Current.IsOffscreen -and $_.Current.IsEnabled -and $_.Current.Name.Trim() -match '${tool?'^(Texto|Text)$':'^(Usando .* (en|sobre) (el )?Lienzo|Using .* on (the )?Canvas|Lienzo|Canvas)$'}' -and
  $_.Current.ControlType.ProgrammaticName -match '${tool?'[.](Button|SplitButton|RadioButton|MenuItem)$':'[.](Pane|Custom|Document)$'}'
})
if($matches.Count -ne 1){throw '${tool?'PAINT_TEXT_BUTTON_NOT_FOUND':'PAINT_CANVAS_NOT_FOUND'}'}
$node=$matches[0];$rect=$node.Current.BoundingRectangle
ConvertTo-Json -InputObject @{id=($node.GetRuntimeId() -join '.');x=[int][Math]::Ceiling($rect.Left);y=[int][Math]::Ceiling($rect.Top);right=[int][Math]::Floor($rect.Right);bottom=[int][Math]::Floor($rect.Bottom);name=$node.Current.Name} -Compress`;
}

function dragScript(handle,canvas,start,end){
 if(!canvas.id)return `${accessibilityScript(handle,false)}
$current=$observed[0]
if($current.Name -ne $expectedCanvasName -or $current.x -ne ${canvas.x} -or $current.y -ne ${canvas.y} -or
 $current.right -ne ${canvas.right} -or $current.bottom -ne ${canvas.bottom}){throw 'PAINT_CANVAS_CHANGED'}
if(-not [BrivanyPaintControls]::Hit([long]${handle},${start.x},${start.y})){throw 'PAINT_CANVAS_OCCLUDED'}
${mouseDrag(handle,start,end)}`;
 return `${paintRoot(handle)}
$id=[int[]]('${canvas.id}'.Split('.') | ForEach-Object {[int]$_})
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::RuntimeIdProperty,$id)
$canvas=$root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
if(!$canvas -or $canvas.Current.IsOffscreen -or $canvas.Current.Name -ne $expectedCanvasName){throw 'PAINT_CANVAS_CHANGED'}
$rect=$canvas.Current.BoundingRectangle
$from=[System.Windows.Point]::new(${start.x},${start.y});$to=[System.Windows.Point]::new(${end.x},${end.y})
if(!$rect.Contains($from) -or !$rect.Contains($to)){throw 'PAINT_CANVAS_CHANGED'}
$hit=[System.Windows.Automation.AutomationElement]::FromPoint($from)
while($hit -and ($hit.GetRuntimeId() -join '.') -ne '${canvas.id}'){$hit=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($hit)}
if(!$hit -or [CogniraInput]::GetForegroundWindow().ToInt64() -ne ${handle}){throw 'PAINT_CANVAS_OCCLUDED'}
${mouseDrag(handle,start,end)}`;
}

function mouseDrag(handle,start,end){
 return `[CogniraInput]::MoveTo(${start.x},${start.y})
try {
 [CogniraInput]::MouseDown('left')
 Start-Sleep -Milliseconds 65
 for($i=1;$i -le 10;$i++){
  if([CogniraInput]::GetForegroundWindow().ToInt64() -ne ${handle}){throw 'PAINT_FOCUS_CHANGED'}
  [CogniraInput]::MoveTo([int](${start.x}+(${end.x}-${start.x})*$i/10),[int](${start.y}+(${end.y}-${start.y})*$i/10))
  Start-Sleep -Milliseconds 14
 }
} finally {[CogniraInput]::MouseUp('left')}
Write-Output 'DRAWN'`;
}

function editorScript(handle,canvas){
 return `${paintRoot(handle)}
$node=[System.Windows.Automation.AutomationElement]::FocusedElement
if(!$node -or $node.Current.IsPassword -or $node.Current.IsOffscreen){throw 'PAINT_TEXT_EDITOR_NOT_FOCUSED'}
$child=$node.Current.NativeWindowHandle
$rect=$node.Current.BoundingRectangle
if(!$child -or $node.Current.ClassName -notmatch '^(Edit|RichEdit)' -or
 $rect.Left -lt ${canvas.x}-4 -or $rect.Top -lt ${canvas.y}-4 -or $rect.Right -gt ${canvas.right}+4 -or $rect.Bottom -gt ${canvas.bottom}+4){
 throw 'PAINT_TEXT_EDITOR_NOT_FOCUSED'
}
Write-Output "win32:$child"`;
}

async function writePaintText(text,{automation,system,overlay,target,assertActive}){
 const paint=path.join(process.env.SystemRoot||'C:\\Windows','System32','mspaint.exe');
 const child=spawn(paint,[],{detached:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 child.unref();
 let window;
 const deadline=Date.now()+12000;
 while(!window&&Date.now()<deadline){
  assertActive();
  const windows=await system.listWindows();
  window=windows.find(row=>row.processId===child.pid&&/^mspaint$/i.test(row.processName||''));
  if(!window)await new Promise(resolve=>setTimeout(resolve,200));
 }
 if(!window)throw Error('PAINT_NEW_WINDOW_NOT_FOUND');
 const handle=String(window.handle);
 if(!/^\d+$/.test(handle))throw Error('PAINT_NEW_WINDOW_NOT_FOUND');
 await target({handle,process_id:child.pid});
 const observe=async tool=>{
  try{return JSON.parse(await automation.run(observeScript(handle,tool),8000));}
  catch{assertActive();return JSON.parse(await automation.run(accessibilityScript(handle,tool),12000));}
 };
 const tool=await observe(true);
 const point={x:Math.floor((tool.x+tool.right)/2),y:Math.floor((tool.y+tool.bottom)/2)};
 if(tool.id)await automation.clickObservedControl({windowHandle:handle,id:tool.id,point});
 else await overlay.withUnobstructedInput(async()=>{
  assertActive();
  await automation.run(`${accessibilityScript(handle,true)}
if($observed[0].x -ne ${tool.x} -or $observed[0].y -ne ${tool.y} -or
 $observed[0].right -ne ${tool.right} -or $observed[0].bottom -ne ${tool.bottom}){throw 'PAINT_TEXT_BUTTON_CHANGED'}
if(-not [BrivanyPaintControls]::Hit([long]${handle},${point.x},${point.y})){throw 'PAINT_TEXT_BUTTON_OCCLUDED'}
[CogniraInput]::MoveTo(${point.x},${point.y})
[CogniraInput]::LeftClick()`,12000);
 },{point});
 const canvas=await observe(false);
 if(canvas.id&&!/^-?\d+(?:\.-?\d+)+$/.test(canvas.id)||!/^(Usando .* (en|sobre) (el )?Lienzo|Using .* on (the )?Canvas)$/i.test(canvas.name)||!/texto|text/i.test(canvas.name))throw Error('PAINT_TEXT_TOOL_NOT_SELECTED');
 const start={x:canvas.x+30,y:canvas.y+25};
 const end={x:Math.min(canvas.right-18,canvas.x+700),y:Math.min(canvas.bottom-18,canvas.y+290)};
 if(end.x-start.x<240||end.y-start.y<110)throw Error('PAINT_CANVAS_TOO_SMALL');
 const encodedName=Buffer.from(canvas.name,'utf8').toString('base64');
 await overlay.withUnobstructedInput(async()=>{
  assertActive();
  await automation.run(`$expectedCanvasName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedName}'))\n`+dragScript(handle,canvas,start,end),8000);
 },{point:start});
 assertActive();
 const control=(await automation.run(editorScript(handle,canvas),8000)).trim();
 if(!/^win32:\d+$/.test(control))throw Error('PAINT_TEXT_EDITOR_NOT_FOCUSED');
 const written=(await automation.run(appendScript(handle,control,text.replace(/\r\n?|\n/g,'\r\n')),10000)).trim();
 if(written!=='VERIFIED')throw Error('PAINT_TEXT_UNVERIFIED');
 return {verified:true,openedInPaint:true,method:'paint-native-text-tool',input_sent:true,text_value_verified:true,editable_text_box:true,process_id:child.pid};
}
module.exports={writePaintText};
