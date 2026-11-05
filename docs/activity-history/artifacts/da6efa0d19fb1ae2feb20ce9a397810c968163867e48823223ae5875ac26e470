'use strict';
// SetPhysicalCursorPos is filtered as physical input by the inherited cursor
// guard. Deliver an injected mouse move at the already validated player point
// so the browser receives hover, without releasing the guard or clicking.
function playerHoverScript({windowHandle,id}){
 if(!/^\d+$/.test(windowHandle)||! /^-?\d+(?:\.-?\d+)+$/.test(id))throw Error('Identidad de reproductor inválida.');
 return `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
if([CogniraInput]::GetForegroundWindow().ToInt64().ToString() -ne '${windowHandle}'){throw 'STALE_WINDOW'}
$point=[CogniraInput]::GetPosition()
$hit=[System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($point.X,$point.Y))
$matched=$false
for($depth=0;$hit -and $depth -lt 30;$depth++){
 if(($hit.GetRuntimeId() -join '.') -eq '${id}'){$matched=$true;break}
 $hit=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($hit)
}
if(!$matched){throw 'OCCLUDED_PLAYER'}
if([CogniraInput]::GetForegroundWindow().ToInt64().ToString() -ne '${windowHandle}'){throw 'STALE_WINDOW'}
[CogniraInput]::mouse_event(1,1,0,0,0)
[CogniraInput]::mouse_event(1,-1,0,0,0)
Write-Output 'OK'`;
}
module.exports={playerHoverScript};
