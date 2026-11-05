'use strict';
const tabsScript=String.raw`
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
$handle=[CogniraInput]::GetForegroundWindow();$root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::TabItem)
$nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker;$tabs=New-Object System.Collections.Generic.List[object]
foreach($node in $nodes){try{
 $info=$node.Current;$r=$info.BoundingRectangle
 if($info.IsOffscreen -or !$info.IsEnabled -or $r.IsEmpty){continue}
 $parent=$walker.GetParent($node);$embedded=$false
 for($depth=0;$parent -and $depth -lt 40;$depth++){if($parent.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document){$embedded=$true;break};if($parent -eq $root){break};$parent=$walker.GetParent($parent)}
 if($embedded){continue};$pattern=$null;$selected=$false
 if($node.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)){$selected=$pattern.Current.IsSelected}
 $tabs.Add(@{id=($node.GetRuntimeId() -join '.');name=$info.Name;className=$info.ClassName;role='ControlType.TabItem';selected=$selected;x=$r.Left;y=$r.Top;width=$r.Width;height=$r.Height})
}catch{}}
@{windowHandle=$handle.ToInt64().ToString();tabs=@($tabs.ToArray())}|ConvertTo-Json -Depth 4 -Compress`;
const pageUrlScript=String.raw`
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
$handle=[CogniraInput]::GetForegroundWindow();$root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Document)
$docs=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition);$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker;$page=$null
foreach($candidate in $docs){
 if($candidate.Current.IsOffscreen){continue};$parent=$walker.GetParent($candidate);$nested=$false
 for($depth=0;$parent -and $depth -lt 40;$depth++){if($parent.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document){$nested=$true;break};if($parent -eq $root){break};$parent=$walker.GetParent($parent)}
 if(!$nested){if($page){throw 'WEB_AMBIGUOUS_DOCUMENT'};$page=$candidate}
}
if(!$page){throw 'WEB_DOCUMENT_UNAVAILABLE'}
$pattern=$null;if(!$page.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){throw 'WEB_URL_UNAVAILABLE'}
@{windowHandle=$handle.ToInt64().ToString();url=$pattern.Current.Value}|ConvertTo-Json -Compress`;
module.exports={tabsScript,pageUrlScript};
