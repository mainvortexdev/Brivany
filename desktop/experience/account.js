(() => {
 const content=document.querySelector('.settings-content'),nav=document.querySelector('.settings-nav nav');if(!content||!nav)return;
 const container=document.createElement('section');container.dataset.section='account';container.hidden=true;content.append(container);
 const tab=document.createElement('button');tab.type='button';tab.dataset.tab='account';tab.textContent='Cuenta Vetsa';nav.prepend(tab);tab.onclick=()=>{nav.querySelectorAll('[data-tab]').forEach(b=>b.removeAttribute('aria-current'));tab.setAttribute('aria-current','page');content.querySelectorAll('[data-section]').forEach(s=>s.hidden=s!==container);};if(location.hash==='#account')tab.click();
 const owner=parent.location.origin===location.origin?parent:window,api=()=>owner.pywebview?.api;
 const card=document.createElement('section');card.className='brivany-account';card.setAttribute('aria-label','Cuenta Vetsa');
 card.innerHTML=`<header class="account-heading"><div><span class="account-eyebrow">ECOSISTEMA VETSA</span><h2>Tu cuenta</h2></div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/></svg></header>
 <div id="account-profile" hidden><div class="account-identity"><span class="account-avatar" aria-hidden="true"></span><div><strong id="account-name"></strong><span id="account-email"></span></div></div><div class="account-security"><div><span>Correo verificado</span><strong data-security="email_verified">—</strong></div><div><span>Vetsa Three Auth</span><strong data-security="three_auth">—</strong></div><div><span>Claves de acceso</span><strong data-security="passkeys">—</strong></div><div><span>Alertas de seguridad</span><strong data-security="email_alerts">—</strong></div></div><div class="account-actions"><button type="button" id="account-manage">Mi cuenta</button><button type="button" id="account-security">Seguridad VAS</button><button type="button" id="account-refresh" aria-label="Actualizar estado de cuenta">Actualizar</button><button type="button" id="account-logout" class="account-quiet">Cerrar sesión</button></div></div>
 <div id="account-signin"><p class="account-intro">La misma cuenta de Vetsa y Cognira, también en Brivany.</p><button type="button" id="account-login">Iniciar sesión con Vetsa <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button><button type="button" id="account-cancel" class="account-quiet" hidden>Cancelar acceso</button></div><p id="account-message" role="status" aria-live="polite"></p>`;
 container.prepend(card);let busy=false,previous;
 const $=s=>card.querySelector(s),message=t=>$('#account-message').textContent=t||'';
 function render(state){
  const identity=state.account?.id||null;
  if(previous!==undefined&&previous!==identity){owner.BrivanyChatAccount=identity;owner.dispatchEvent(new owner.CustomEvent('brivany-account-change'));}
  previous=identity;owner.BrivanyChatAccount=identity;
  $('#account-profile').hidden=!state.signed_in;$('#account-signin').hidden=state.signed_in;
  $('#account-login').disabled=state.pending||busy;$('#account-login').classList.toggle('account-pending',!!state.pending);$('#account-cancel').hidden=!state.pending;
  if(state.signed_in){
   $('#account-name').textContent=state.account.name;$('#account-email').textContent=state.account.email;
   $('.account-avatar').textContent=state.account.name.trim().slice(0,1).toUpperCase();
   card.querySelectorAll('[data-security]').forEach(node=>{const key=node.dataset.security,value=state.security?.[key];node.textContent=value===undefined?'Sin consultar':key==='passkeys'?String(value):value?'Activado':'Desactivado';if(key==='email_verified'&&value!==undefined)node.textContent=value?'Verificado':'Pendiente';});
  }
  message(state.error||(state.pending?'Completa el acceso en la ventana de Brivany.':state.signed_in&&!state.connected?'Comprobando la sesión…':''));
  owner.dispatchEvent(new owner.CustomEvent('brivany-account-status',{detail:state}));
 }
 async function refresh(){if(busy||!api()?.account_status)return;try{render(await api().account_status());}catch{message('No se pudo consultar tu cuenta.');}}
 async function action(run){if(busy)return;let failure='';busy=true;card.querySelectorAll('button').forEach(b=>b.disabled=true);try{const state=await run();if(state?.provider)render(state);}catch(e){failure=e.message||'No se pudo completar la solicitud.';}finally{busy=false;card.querySelectorAll('button').forEach(b=>b.disabled=false);const state=await api()?.account_status?.();if(state)render(state);if(failure)message(failure);}}
 $('#account-login').onclick=()=>action(()=>api().account_begin_login());$('#account-cancel').onclick=()=>action(()=>api().account_cancel_login());
 $('#account-logout').onclick=()=>action(()=>api().account_logout());$('#account-refresh').onclick=()=>action(()=>api().account_refresh());
 $('#account-manage').onclick=()=>action(()=>api().account_manage('profile'));$('#account-security').onclick=()=>action(()=>api().account_manage('security'));
 const timer=setInterval(()=>{if(!document.hidden)void refresh();},4000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
 owner.addEventListener('pywebviewready',refresh);refresh();
})();
