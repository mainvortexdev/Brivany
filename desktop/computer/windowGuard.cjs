'use strict';
function windowGuardScript(handle){
 if(!/^\d+$/.test(handle))throw Error('Ventana inválida');
 return `if(-not ('BrivanyWindowGuard' -as [type])){Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BrivanyWindowGuard {
 [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetLastActivePopup(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint mode);
 public static bool IsBlocked(long handle) {
  var window=new IntPtr(handle);if(!IsWindowEnabled(window))return true;
  var popup=GetLastActivePopup(window);
  return popup!=window&&popup!=IntPtr.Zero&&IsWindowVisible(popup)&&GetWindow(popup,4)==window;
 }
}
'@
}
if([BrivanyWindowGuard]::IsBlocked([long]${handle})){throw 'MODAL_WINDOW_REQUIRES_USER'}
Write-Output 'READY'`;
}
module.exports={windowGuardScript};
