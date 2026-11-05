'use strict';
// Classic Notepad exposes an Edit HWND even when its menus have no UIA provider.
// Discover the actual localized Save menu ID; never assume a numeric command ID.
const source=`using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class BrivanyNotepadSave {
 public class Item { public uint id; public string label; public bool enabled; }
 [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu,int position);
 [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
 [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu,int position);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetMenuString(IntPtr menu,uint position,StringBuilder text,int length,uint flags);
 [DllImport("user32.dll")] static extern uint GetMenuState(IntPtr menu,uint position,uint flags);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr wp,IntPtr lp);
 static void Walk(IntPtr menu,List<Item> items,int depth) {
  if(depth>5)return;
  for(int i=0;i<GetMenuItemCount(menu);i++) {
   var child=GetSubMenu(menu,i);if(child!=IntPtr.Zero){Walk(child,items,depth+1);continue;}
   var label=new StringBuilder(300);GetMenuString(menu,(uint)i,label,300,0x400);
   var visible=label.ToString().Split('\t')[0].Replace("&","").Trim();
   if(visible.Equals("Guardar",StringComparison.OrdinalIgnoreCase)||visible.Equals("Save",StringComparison.OrdinalIgnoreCase))
    items.Add(new Item{id=GetMenuItemID(menu,i),label=label.ToString(),enabled=(GetMenuState(menu,(uint)i,0x400)&3)==0});
  }
 }
 public static List<Item> Observe(long window) {
  if(GetForegroundWindow().ToInt64()!=window)throw new Exception("STALE_NOTEPAD");
  var items=new List<Item>();Walk(GetMenu(new IntPtr(window)),items,0);return items;
 }
 public static void Save(long window,uint command) {
  var items=Observe(window);if(items.Count!=1||items[0].id!=command||!items[0].enabled)throw new Exception("STALE_SAVE_MENU");
  if(!PostMessage(new IntPtr(window),0x111,new IntPtr(command),IntPtr.Zero))throw new Exception("SAVE_NOT_SENT");
 }
}`;
function bootstrap(){return `if(-not ('BrivanyNotepadSave' -as [type])){Add-Type -TypeDefinition @'\n${source}\n'@\n}`;}
function handle(value){if(!/^\d+$/.test(value))throw Error('Ventana de notas inválida');return value;}
function observeScript(value){return bootstrap()+`\nConvertTo-Json -InputObject @([BrivanyNotepadSave]::Observe([long]${handle(value)}).ToArray()) -Compress`;}
function saveScript(value,id){if(!Number.isInteger(id)||id<=0||id>65535)throw Error('Menú Guardar inválido');return bootstrap()+`\n[BrivanyNotepadSave]::Save([long]${handle(value)},[uint32]${id});Write-Output 'SAVE_REQUESTED'`;}
module.exports={observeScript,saveScript};
