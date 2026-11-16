/* Each person authorizes their own account; application setup stays native. */
(() => {
 'use strict';
 const host=document.querySelector('#accounts');if(!host)return;
 const card=document.createElement('article');card.id='spotify-account';card.className='spotify-account';
 card.innerHTML='<div class="spotify-account-heading"><div><p class="spotify-account-label">MÚSICA</p><h3>Spotify</h3></div><span id="spotify-account-state">Consultando…</span></div><p id="spotify-account-detail"></p><div class="spotify-account-actions"><button id="spotify-account-link" type="button">Vincular Spotify ↗</button><button id="spotify-account-cancel" class="text" type="button" hidden>Cancelar vinculación</button><button id="spotify-account-disconnect" class="text" type="button" hidden>Desvincular cuenta</button></div><p id="spotify-account-message" role="status"></p>';
 host.before(card);
 const $=s=>card.querySelector(s);let busy=false,closed=false,notice='',noticeError=false;
 function api(){try{return window.pywebview?.api||window.parent.pywebview?.api;}catch{return null;}}
 async function update(){
  if(busy||closed)return;
  const bridge=api();if(!bridge?.spotify_status){$('#spotify-account-state').textContent='Disponible en el escritorio';return}
  try{
   const status=await bridge.spotify_status();if(closed)return;
   const account=status.account?.display_name;
   $('#spotify-account-state').textContent=status.pending?'Vinculando…':status.connected?(account?'Conectado · '+account:'Conectado'):'Sin conectar';
   card.dataset.connected=String(status.connected);
   $('#spotify-account-detail').textContent=status.connected
    ?status.streaming_access&&status.library_access?'Tu cuenta está lista para la biblioteca y el reproductor Brivany. Spotify Premium es necesario para reproducir aquí.':'Actualiza el acceso para usar tu biblioteca y reproducir desde Brivany. Spotify Premium es necesario para escuchar aquí.'
    :'Inicia sesión con tu cuenta de Spotify en el navegador. Para reproducir desde Brivany necesitas Spotify Premium.';
   if(status.application_access==='development')$('#spotify-account-detail').textContent+=' El acceso está en pruebas: Spotify debe habilitar tu cuenta para Brivany.';
   $('#spotify-account-link').textContent=status.pending?'Esperando a Spotify…':status.connected?'Actualizar acceso ↗':'Vincular Spotify ↗';
   $('#spotify-account-link').disabled=!!status.pending;
   $('#spotify-account-cancel').hidden=!status.pending;
   $('#spotify-account-disconnect').hidden=!status.connected||!!status.pending;
   $('#spotify-account-message').textContent=status.message||(noticeError||!status.connected||status.pending?notice:'');
  }catch{$('#spotify-account-message').textContent=noticeError?notice:'No se pudo consultar la conexión.'}
 }
 async function action(operation,message){
  if(busy)return;busy=true;notice='';noticeError=false;
  for(const button of card.querySelectorAll('button'))button.disabled=true;
  try{await operation();notice=message}
  catch(error){notice=error.message||'No se pudo completar la conexión con Spotify.';noticeError=true}
  finally{busy=false;for(const button of card.querySelectorAll('button'))button.disabled=false;await update()}
 }
 $('#spotify-account-link').onclick=()=>action(()=>api().spotify_connect(),'Completa la autorización en el navegador y vuelve a Brivany.');
 $('#spotify-account-cancel').onclick=()=>action(()=>api().spotify_cancel_link(),'Vinculación cancelada.');
 $('#spotify-account-disconnect').onclick=()=>action(()=>api().spotify_disconnect(),'Autorización eliminada de este equipo.');
 update();const timer=setInterval(update,2000);window.addEventListener('pywebviewready',update);
 window.addEventListener('pagehide',()=>{closed=true;clearInterval(timer);window.removeEventListener('pywebviewready',update)},{once:true});
})();
