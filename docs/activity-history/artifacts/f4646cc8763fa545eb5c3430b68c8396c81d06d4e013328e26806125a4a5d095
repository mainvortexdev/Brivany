'use strict';
// Extend the pinned Cognira read-only observer without changing its source.
function pageScript(source){
 const itemMarker='  $items.Add($item)',resultMarker='@{windowHandle=$h.ToInt64().ToString();processName=$process;url=$url;title=$doc.Current.Name;documentId=($doc.GetRuntimeId() -join \'.\');items=@($items.ToArray());truncated=($items.Count -ge 700)}';
 if(!source.includes(itemMarker)||!source.includes(resultMarker))throw Error('El observador fuente cambió; necesita revisión.');
 const links=String.raw`  if($role -eq 'ControlType.Hyperlink'){
    $linkValue=$null;$href=''
    if($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$linkValue)){$href=[string]$linkValue.Current.Value}
    if(!$href){$linkValue=$null;if($node.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$linkValue)){$href=[string]$linkValue.Current.Value}}
    if($href){$item.href=$href}
  }
  $items.Add($item)`;
 const scrollers=String.raw`
$scrollCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty,$true)
$scrollNodes=@($doc)+@($doc.FindAll([System.Windows.Automation.TreeScope]::Descendants,$scrollCondition))
$scrollables=New-Object System.Collections.Generic.List[object];$scrollSeen=New-Object 'System.Collections.Generic.HashSet[string]'
foreach($node in $scrollNodes){try{
 $id=$node.GetRuntimeId() -join '.';if(!$scrollSeen.Add($id)){continue};$c=$node.Current;$r=$c.BoundingRectangle;$pattern=$null
 if($c.IsOffscreen -or !$c.IsEnabled -or $c.IsPassword -or $r.IsEmpty -or $r.Width -lt 8 -or $r.Height -lt 8){continue}
 if($node.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern,[ref]$pattern) -and $pattern.Current.VerticallyScrollable){
  $scrollables.Add(@{id=$id;name=([string]$c.Name).Substring(0,[Math]::Min(160,$c.Name.Length));role=$c.ControlType.ProgrammaticName;x=$r.Left;y=$r.Top;width=$r.Width;height=$r.Height;vertical_percent=$pattern.Current.VerticalScrollPercent;vertical_view_size=$pattern.Current.VerticalViewSize})
 }
 if($scrollables.Count -ge 12){break}
}catch{}}
$pageBounds=$doc.Current.BoundingRectangle
`;
 const result=resultMarker.replace('items=@($items.ToArray());','items=@($items.ToArray());scrollables=@($scrollables.ToArray());bounds=@{x=$pageBounds.Left;y=$pageBounds.Top;width=$pageBounds.Width;height=$pageBounds.Height};');
 return source.replace(itemMarker,links).replace(resultMarker,scrollers+result);
}
function pageForPlanner(page){
 // Retain the full observation only inside the native session. Queries and
 // signed destinations are not needed to choose an observed link/control ID.
 const output={...page,items:[],truncated:!!page.truncated};let budget=15000;
 if(output.url){const url=new URL(output.url);output.url=['http:','https:'].includes(url.protocol)?url.origin+url.pathname:url.protocol;output.url_components_omitted=!!(url.search||url.hash);}
 for(const item of page.items||[]){
  const safe={...item,name:String(item.name||'').slice(0,240)};delete safe.href;
  if(item.href){try{const url=new URL(item.href,page.url);safe.destination_origin=['http:','https:'].includes(url.protocol)?url.origin:null;safe.destination_observed=true;}catch{safe.destination_observed=false;}}
  const size=JSON.stringify(safe).length;
  if(output.items.length>=120||size>budget){output.truncated=true;break;}
  output.items.push(safe);budget-=size;
 }
 return output;
}
module.exports={pageScript,pageForPlanner};
