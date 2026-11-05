(() => {
 const $=selector=>document.querySelector(selector),frame=$('#module-frame');
 const names=new Map([['/app','Melodi'],['/spaces','Espacios'],['/viewer','Espacios'],['/human-skills','Human-skills'],['/practice','Práctica'],['/dubbing','Video y traducción'],['/translate','Video y traducción'],['/connections','Conexiones'],['/activity','Bitácora'],['/sous','Sous'],['/computer','Agentes'],['/desktop-services','Servicios']]);
 let toastTimer,maximized=false;
 const notify=text=>{$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);};
 function openModule(route){
  const url=new URL(route,location.origin);if(url.origin!==location.origin||!names.has(url.pathname))return;
  if(frame.contentWindow?.location.pathname===url.pathname&&!url.search&&!url.hash)return;
  $('#page-title').textContent=names.get(url.pathname);frame.title=names.get(url.pathname);frame.src=url.pathname+url.search+url.hash;
  document.querySelectorAll('.module-link[data-route]').forEach(button=>{const active=button.dataset.route===url.pathname;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  frame.onload=()=>{window.pywebview?.api?.music_media_active?.(frame.contentWindow?.BrivanyMediaActive===true).catch(()=>{});if(url.pathname==='/activity'){const doc=frame.contentDocument,button=doc?.querySelector('#load-older-activity');if(button){const advance=()=>{if(!button.hidden&&!button.disabled)button.click();};const observer=new MutationObserver(advance);observer.observe(button,{attributes:true});advance();}}};
 }
 window.BrivanyNavigate=openModule;
 const settings=$('#app-settings');const openSettings=(hash='')=>{if(!$('#settings-frame').src)$('#settings-frame').src='/settings'+hash;else{$('#settings-frame').contentWindow.BrivanySettings?.refresh();if(hash)$('#settings-frame').contentWindow.BrivanySettings?.tab(hash.replace('#',''));}settings.showModal();};
 window.BrivanyOpenSettings=openSettings;
 document.querySelectorAll('[data-route]').forEach(button=>button.onclick=()=>openModule(button.dataset.route));document.querySelectorAll('[data-settings]').forEach(button=>button.onclick=()=>openSettings());
 $('#settings-close').onclick=()=>settings.close();settings.addEventListener('click',event=>{if(event.target===settings){const rect=settings.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)settings.close();}});
 $('.brand-mark').onclick=()=>openModule('/app');$('#sidebar-toggle').onclick=()=>{const collapsed=$('.app-shell').classList.toggle('sidebar-collapsed');$('#sidebar-toggle').setAttribute('aria-label',collapsed?'Expandir menú':'Contraer menú');window.BrivanyIcons.set($('#sidebar-toggle'),collapsed?'panelRight':'panelLeft');};
 const work=document.createElement('button');work.type='button';work.className='subtle-icon';work.setAttribute('aria-label','Abrir Melodi WorkSpace');window.BrivanyIcons.set(work,'workspace');work.onclick=async()=>{try{await window.pywebview.api.start_work();}catch{notify('WorkSpace requiere Brivany Desktop.');}};$('.topbar-actions').prepend(work);
 $('#new-session').onclick=()=>{const chat=frame.contentWindow?.BrivanyChat;if(chat)chat.clear();else{window.BrivanyChatSession={messages:[],history:[]};openModule('/app');}};
 const native=async(method,...args)=>{try{const api=window.pywebview?.api;if(!api?.[method])return;return await api[method](...args);}catch{notify('No se pudo cambiar la ventana.');}};
 $('#window-minimize').onclick=()=>native('minimize_window');$('#window-close').onclick=()=>native('close_window');$('#window-maximize').onclick=async()=>{const result=await native('set_window_maximized',!maximized);if(result?.ok){maximized=!maximized;window.BrivanyIcons.set($('#window-maximize'),maximized?'restore':'maximize');$('#window-maximize').setAttribute('aria-label',maximized?'Restaurar':'Maximizar');}};
 window.addEventListener('message',event=>{if(event.origin!==location.origin)return;if(event.data?.type==='brivany-navigate'){if(event.source!==frame.contentWindow&&event.source!==$('#settings-frame').contentWindow)return;settings.close();openModule(event.data.route);}if(event.data?.type==='brivany-settings'&&event.source===frame.contentWindow)openSettings();if(event.data?.type==='brivany-media-active'&&event.source===frame.contentWindow&&typeof event.data.active==='boolean')window.pywebview?.api?.music_media_active?.(event.data.active).catch(()=>{});});
 openModule('/app');
})();
