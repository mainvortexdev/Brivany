/* Desktop widget preferences live in Settings, never in the compact tool panel. */
(() => {
 'use strict';const target=document.querySelector('[data-section="work"]');if(!target)return;
 const owner=parent.location.origin===location.origin?parent:window,block=document.createElement('div');block.hidden=true;
 block.innerHTML='<h3>Widgets de escritorio</h3><label class="setting-row"><span>Mantener encima</span><input id="desktop-widgets-topmost" type="checkbox" role="switch"></label><div class="setting-row"><span>Ventanas de widgets</span><button id="desktop-widgets-close" type="button">Cerrar todas</button></div><p id="desktop-widgets-setting-status" class="settings-status" role="status"></p>';
 target.append(block);const topmost=block.querySelector('input'),close=block.querySelector('button'),status=block.querySelector('[role=status]');let pending=false,disposed=false;
 const api=()=>owner.pywebview?.api;
 async function refresh(){if(disposed||pending||!api()?.workspace_desktop_widgets_settings)return;pending=true;try{const v=await api().workspace_desktop_widgets_settings();if(disposed)return;block.hidden=!v.native_available;topmost.checked=v.topmost}catch{block.hidden=true}finally{pending=false}}
 topmost.onchange=async()=>{topmost.disabled=true;try{const v=await api().workspace_desktop_widgets_settings(topmost.checked);topmost.checked=v.topmost;status.textContent=''}catch(error){status.textContent=error.message||'No se pudo guardar el ajuste.';await refresh()}finally{topmost.disabled=false}};
 close.onclick=async()=>{close.disabled=true;try{await api().workspace_desktop_widgets_close();status.textContent=''}catch(error){status.textContent=error.message||'No se pudieron cerrar los widgets.'}finally{close.disabled=false}};
 owner.addEventListener('pywebviewready',refresh);owner.addEventListener('focus',refresh);window.addEventListener('pagehide',()=>{disposed=true;owner.removeEventListener('pywebviewready',refresh);owner.removeEventListener('focus',refresh)},{once:true});refresh();
})();
