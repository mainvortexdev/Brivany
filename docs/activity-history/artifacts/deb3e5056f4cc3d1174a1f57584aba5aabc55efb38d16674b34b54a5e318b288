'use strict';
const {pageForPlanner}=require('./webPage.cjs');
const uiaId=value=>typeof value==='string'&&/^-?\d+(?:\.-?\d+)+$/.test(value);
const b64=value=>Buffer.from(value,'utf8').toString('base64');
function actionBootstrap({windowHandle,documentId,url}){
 if(!/^\d+$/.test(windowHandle)||!uiaId(documentId)||typeof url!=='string')throw Error('Identidad de página inválida.');
 return `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase -ErrorAction Stop
if([CogniraInput]::GetForegroundWindow().ToInt64().ToString() -ne '${windowHandle}'){throw 'STALE_WINDOW'}
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${windowHandle}))
function FindId($parent,$id){$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::RuntimeIdProperty,([int[]]($id.Split('.')|ForEach-Object{[int]$_})));return $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)}
$doc=FindId $root '${documentId}'
if(!$doc -or $doc.Current.IsOffscreen -or !$doc.Current.IsEnabled -or $doc.Current.ControlType -ne [System.Windows.Automation.ControlType]::Document){throw 'STALE_DOCUMENT'}
$expectedUrl=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(url)}'))
$value=$null;if(!$doc.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value) -or $value.Current.Value -cne $expectedUrl){throw 'PAGE_URL_CHANGED'}
`;
}
function scrollScript({windowHandle,documentId,url,scrollId,direction,percent}){
 if(!uiaId(scrollId)||!['up','down'].includes(direction)||!Number.isFinite(percent)||percent<0||percent>100)throw Error('Desplazamiento inválido.');
 return actionBootstrap({windowHandle,documentId,url})+`
$node=if('${scrollId}' -eq '${documentId}'){$doc}else{FindId $doc '${scrollId}'}
if(!$node -or $node.Current.IsOffscreen -or !$node.Current.IsEnabled -or $node.Current.IsPassword){throw 'STALE_SCROLL_CONTAINER'}
$scroll=$null;if(!$node.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern,[ref]$scroll) -or !$scroll.Current.VerticallyScrollable){throw 'SCROLL_PATTERN_UNAVAILABLE'}
if([Math]::Abs($scroll.Current.VerticalScrollPercent-${percent}) -gt 0.5){throw 'SCROLL_POSITION_CHANGED'}
if([CogniraInput]::GetForegroundWindow().ToInt64().ToString() -ne '${windowHandle}'){throw 'STALE_WINDOW'}
$scroll.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount,[System.Windows.Automation.ScrollAmount]::${direction==='down'?'LargeIncrement':'LargeDecrement'})
Write-Output 'INPUT_SENT'`;
}
function linkScript({windowHandle,documentId,url,controlId,name,href}){
 if(!uiaId(controlId)||typeof name!=='string'||typeof href!=='string')throw Error('Enlace inválido.');
 return actionBootstrap({windowHandle,documentId,url})+`
$node=FindId $doc '${controlId}'
$expectedName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(name)}'))
$expectedHref=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(href)}'))
if(!$node -or $node.Current.IsOffscreen -or !$node.Current.IsEnabled -or $node.Current.IsPassword -or $node.Current.ControlType -ne [System.Windows.Automation.ControlType]::Hyperlink -or $node.Current.Name -cne $expectedName){throw 'STALE_LINK'}
$linkValue=$null;$href=''
if($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$linkValue)){$href=[string]$linkValue.Current.Value}
if(!$href){$linkValue=$null;if($node.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern,[ref]$linkValue)){$href=[string]$linkValue.Current.Value}}
if($href -cne $expectedHref){throw 'LINK_DESTINATION_CHANGED'}
$invoke=$null;if(!$node.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){throw 'LINK_INVOKE_UNAVAILABLE'}
if([CogniraInput]::GetForegroundWindow().ToInt64().ToString() -ne '${windowHandle}'){throw 'STALE_WINDOW'}
$invoke.Invoke()
Write-Output 'INPUT_SENT'`;
}
function observedDestination(href,base){
 const destination=new URL(href,base);
 if(!['http:','https:'].includes(destination.protocol)||destination.username||destination.password)throw Error('El enlace no expone un destino HTTP/HTTPS sin credenciales.');
 return destination;
}
function attachPageActions(session,{readPage,readUrl,readTabs,run,assertActive,wait}){
 async function selected(){const snapshot=await session.observe({});session.requireSelectedTab(snapshot);return snapshot;}
 async function currentPage(){
  await selected();const page=await readPage();if(page.windowHandle!==session.windowHandle)throw Error('Cambió la ventana al leer la página.');
  return {...page,tab_id:session.tabId};
 }
 function previous(params){
  const page=session.lastPage;
  if(!page||page.tab_id!==params.tab_id||page.documentId!==params.document_id)throw Error('Lee de nuevo la página y sus controles antes de actuar.');
  return page;
 }
 function samePage(before,after){if(before.documentId!==after.documentId||before.url!==after.url||before.windowHandle!==after.windowHandle)throw Error('La página cambió; no se repetirá la acción.');}
 session.readObservedPage=async()=>{const page=await currentPage();session.lastPage=page;return pageForPlanner(page);};
 session.scrollObservedPage=async params=>{
  const before=previous(params),expected=before.scrollables?.find(c=>c.id===params.scroll_id);
  if(!expected)throw Error('El contenedor no estaba observado.');
  const fresh=await currentPage();samePage(before,fresh);const scroller=fresh.scrollables?.find(c=>c.id===expected.id);
  if(!scroller||Math.abs(scroller.vertical_percent-expected.vertical_percent)>.5)throw Error('El desplazamiento cambió desde la observación.');
  const at=scroller.vertical_percent;
  if((params.direction==='up'&&at<=.01)||(params.direction==='down'&&at>=99.99))return {verified:true,scrolled:false,at_boundary:true,method:'observed-scroll-boundary',input_count:0};
  session.lastPage=null;assertActive();
  const input=await run(scrollScript({windowHandle:fresh.windowHandle,documentId:fresh.documentId,url:fresh.url,scrollId:scroller.id,direction:params.direction,percent:at}));
  if(input.trim()!=='INPUT_SENT')throw Error('El desplazamiento no confirmó envío de entrada.');
  for(let index=0;index<5;index++){
   assertActive();await wait(150);const after=await currentPage();samePage(fresh,after);const updated=after.scrollables?.find(c=>c.id===scroller.id);
   if(updated&&((params.direction==='down'&&updated.vertical_percent>at+.01)||(params.direction==='up'&&updated.vertical_percent<at-.01))){
    session.lastPage=after;return {verified:true,scrolled:true,input_count:1,method:'observed-scroll-percent',before_percent:at,after_percent:updated.vertical_percent,page:pageForPlanner(after)};
   }
  }
  return {verified:false,verificationPending:true,input_count:1,warning:'Se pidió un solo desplazamiento, pero no se confirmó su efecto. No se repetirá.'};
 };
 session.openObservedLink=async params=>{
  const before=previous(params),expected=before.items?.find(c=>c.id===params.control_id&&c.role==='ControlType.Hyperlink');
  if(!expected?.href)throw Error('El enlace no tenía un destino observado.');
  if(/\b(send|enviar|delete|borrar|eliminar|publish|publicar|buy|comprar|pagar|autorizar|allow|permitir)\b/i.test(expected.name))throw Error('Este enlace requiere un flujo específico y no se abrirá desde la navegación general.');
  const destination=observedDestination(expected.href,before.url),fresh=await currentPage();samePage(before,fresh);
  const link=fresh.items?.find(c=>c.id===expected.id&&c.name===expected.name&&c.href===expected.href&&c.role==='ControlType.Hyperlink');
  if(!link)throw Error('El enlace cambió antes de abrirlo.');
  const tabsBefore=await selected(),idsBefore=tabsBefore.tabs.map(t=>t.id);session.lastPage=null;assertActive();
  const input=await run(linkScript({windowHandle:fresh.windowHandle,documentId:fresh.documentId,url:fresh.url,controlId:link.id,name:link.name,href:link.href}));
  if(input.trim()!=='INPUT_SENT')throw Error('El enlace no confirmó envío de entrada.');
  const handoff=/\b(login|sign.?in|iniciar sesi[oó]n|autenticaci[oó]n)\b/i.test(link.name+' '+destination.pathname);
  for(let index=0;index<25;index++){
   assertActive();await wait(300);let page;
   try{page=await readUrl();}catch(error){if(/WEB_DOCUMENT_UNAVAILABLE|WEB_URL_UNAVAILABLE/.test(error.message))continue;throw error;}
   if(page.windowHandle!==fresh.windowHandle)throw Error('Cambió la ventana después de abrir el enlace.');
   if(!page.url)continue;const actual=new URL(page.url);
   const redirectedToLogin=/\b(login|sign.?in|oauth|authorize|authentication)\b/i.test(actual.pathname);
   if(actual.href!==destination.href&&!(handoff&&actual.protocol==='https:'&&actual.origin===destination.origin)){
    if(redirectedToLogin)return {verified:false,requires_user:true,input_count:1,method:'observed-login-redirect',handoff_reason:'El enlace pidió iniciar sesión. Completa el acceso directamente en el navegador.'};
    continue;
   }
   const after=handoff?await readTabs():await session.observe({}),selectedTabs=after.tabs.filter(t=>t.selected);
   if(after.windowHandle!==fresh.windowHandle||selectedTabs.length!==1||after.tabs.length<idsBefore.length||after.tabs.length>idsBefore.length+1)throw Error('La ventana o las pestañas cambiaron inesperadamente.');
   const required=after.tabs.length>idsBefore.length?idsBefore:idsBefore.filter(id=>id!==params.tab_id);
   if(required.some(id=>!after.tabs.some(t=>t.id===id)))throw Error('No se conservaron las otras pestañas observadas.');
   session.tabId=selectedTabs[0].id;
   return {verified:true,method:'observed-link-destination',input_count:1,tabs_preserved:true,new_tab:after.tabs.length>idsBefore.length,destination_origin:actual.origin,...(handoff?{requires_user:true,handoff_reason:'Completa tus credenciales y la verificación directamente en el navegador.'}:{})};
  }
  return {verified:false,verificationPending:true,input_count:1,warning:'Se abrió una sola vez el enlace observado, pero no se confirmó su destino. No se repetirá.'};
 };
 return session;
}
module.exports={actionBootstrap,scrollScript,linkScript,observedDestination,attachPageActions};
