(() => {
 'use strict';
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],body=document.body,root=document.documentElement;
 const surface=new URLSearchParams(location.search).get('surface')||'preview',controls=surface!=='panel';body.dataset.surface=surface;
 let prefs={motion:true,sleep:true};try{prefs={...prefs,...JSON.parse(localStorage.getItem('brivany.workspace')||'{}')};}catch{}
 const CHARACTER_WIDTH=40;
 const musicMotion=window.BrivanyMusicMotion,paletteTween=musicMotion.paletteTransition(root,()=>body.dataset.motion==='true');
 const reduced=matchMedia('(prefers-reduced-motion:reduce)');let pendingIntent=null;const OPEN_DELAY=480,SWITCH_DELAY=140;
 let expanded=false,panel='music',layoutKind='music',anchor=innerWidth/2,revision=-1,opening,closing,suppressed=false,keyboard=false,busyLayout=false,pendingLayout=null,lastActive=Date.now(),active=false,lastSignature='',state={},gone=false,glanceUntil=0,nextGlance=Date.now()+8000,nextWander=0;
 const panelSizes={melodi:[250,104],chat:[388,148],notice:[336,104],music:[336,212],'music-player':[720,232],'music-library':[720,404],'music-lyrics':[620,404],'music-devices':[720,376]};
 let chatHeight=148,chatLimit=404;
 let computerWorking=false,activityRevision=-1;
 function receiveActivity(value){if(!value||!Number.isFinite(value.revision)||value.revision<activityRevision)return;activityRevision=value.revision;if(Array.isArray(value.jobs))window.BrivanyWorkspaceAgents?.receive({jobs:value.jobs,changed_job:value.changed_job});computerWorking=value.working===true;body.dataset.computerWorking=String(computerWorking);if(computerWorking){wake();body.dataset.characterState='working';}}
 panelSizes.result=[520,340];panelSizes.agent=[336,244];panelSizes.auditory=[400,320]; const labels={result:'Resultado',agent:'Agente',melodi:'Melodi',chat:'Melodi',music:'Música',notice:'Aviso',auditory:'Traducción auditiva'};
 const ready=()=>window.pywebview?.api;
 async function call(method,...args){const api=ready();if(!api?.[method])throw new Error('Abre esta herramienta en Brivany Desktop.');return api[method](...args);}
 function errorText(error){return typeof error?.message==='string'?error.message:'No se pudo completar la acción. Inténtalo de nuevo.';}
 function note(text){$('#work-status').textContent=text||'';}
 function wake(){lastActive=Date.now();body.dataset.sleeping='false';}
 function motion(){body.dataset.motion=String(prefs.motion&&!reduced.matches);root.dataset.motion=body.dataset.motion;if(body.dataset.motion!=='true'){paletteTween.settle();$('#lyrics-lines').getAnimations({subtree:true}).forEach(a=>a.cancel());}}
 
 function paint(){if(!expanded||panel!=='result')window.BrivanyResultView?.suspend();body.dataset.expanded=String(expanded);body.dataset.panel=panel;root.dataset.panel=panel;$('#island-content').inert=!expanded;$('#panel-label').textContent=labels[panel]||labels.music;$$('[data-view]').forEach(el=>el.hidden=el.dataset.view!==panel);$$('#tools [data-panel]').forEach(el=>el.setAttribute('aria-expanded',String(expanded&&el.dataset.panel===panel)));}
 function receiveLayout(meta){if(!meta)return;if(meta.agent)window.BrivanyWorkspaceAgents?.select(meta.agent);if(typeof meta.revision==='number'&&meta.revision<revision)return;revision=meta.revision??revision;expanded=meta.expanded===true;layoutKind=meta.panel;panel=meta.panel?.startsWith('music-')?'music':(labels[meta.panel]?meta.panel:'music');if(Number.isFinite(meta.anchor_x))anchor=meta.anchor_x;
  if(Number.isFinite(meta.host_height))chatLimit=Math.min(404,meta.host_height);if(expanded&&panel==='chat')chatHeight=meta.height;
  root.style.setProperty('--panel-width',Math.min(innerWidth,meta.width||336)+'px');root.style.setProperty('--panel-height',Math.min(innerHeight-(surface==='preview'?46:0),meta.height||148)+'px');root.style.setProperty('--panel-left',Math.max(0,Math.min(innerWidth-(meta.width||336),meta.clip_left||0))+'px');
  if(meta.panel?.startsWith('music-')){musicView=meta.panel.slice(6)==='player'?'player':meta.panel.slice(6);paintMusicView();}if(meta.music_status)renderConnection(meta.music_status);if(meta.suppress_hover)suppressed=true;paint();if(expanded&&panel==='music')refreshMusic();window.dispatchEvent(new Event('brivany-island-layout'));
 }
 async function layout(open,view=panel,x=anchor,manual=false){
  if(open){clearTimeout(closing);closing=null;}
  if(open&&view==='music'&&musicConnected)view='music-'+musicView;
  cancelIntent();wake();layoutKind=view;panel=view.startsWith('music-')?'music':view;anchor=Math.max(0,Math.min(surface==='panel'?screen.width:innerWidth,x));expanded=open;
  if(open&&panel==='chat')root.style.setProperty('--panel-width',Math.min(innerWidth-16,388)+'px');paint();
  const requestedHeight=open&&panel==='chat'?(window.BrivanyWorkspace?.chatHeight()||148):undefined;
  const request={open,view,x:anchor,manual};if(busyLayout){pendingLayout=request;return;}
  busyLayout=true;try{const args=[open,'normal',view,body.dataset.motion==='true',manual,anchor];if(requestedHeight!==undefined)args.push(requestedHeight);const meta=await call('work_island_layout',...args);receiveLayout(meta);}catch(error){if(ready())note(errorText(error));else receiveLayout({expanded:open,panel:view,width:Math.min(innerWidth-16,panelSizes[view][0]),height:Math.min(innerHeight-46,requestedHeight??panelSizes[view][1]),clip_left:Math.max(8,Math.min(innerWidth-panelSizes[view][0]-8,anchor-panelSizes[view][0]/2)),anchor_x:anchor});}
  finally{busyLayout=false;if(pendingLayout){const next=pendingLayout;pendingLayout=null;layout(next.open,next.view,next.x,next.manual);}}
 }
 function resizeChat(){if(!expanded||panel!=='chat'||surface==='bar'||busyLayout)return;const height=Math.min(chatLimit,innerHeight-(surface==='preview'?46:0),window.BrivanyWorkspace?.chatHeight()||148);if(height!==chatHeight)layout(true,'chat',anchor);}
 function cancelIntent(){clearTimeout(opening);opening=null;pendingIntent=null;}
 function toolAt(x){return $$('#tools [data-panel]').find(el=>{const r=el.getBoundingClientRect();return r.width>0&&x>=r.left&&x<=r.right;})?.dataset.panel||null;}
 function approach(x,view=toolAt(x)){
  clearTimeout(closing);closing=null;
  if(expanded&&panel==='chat'){cancelIntent();return;}
  if(suppressed||!view){cancelIntent();return;}
  wake();if(expanded&&panel===view){cancelIntent();return;}
  if(pendingIntent?.view===view)return;
  cancelIntent();pendingIntent={view,x};opening=setTimeout(()=>{const target=pendingIntent;pendingIntent=null;opening=null;if(target&&!suppressed)layout(true,target.view,target.x);},expanded?SWITCH_DELAY:OPEN_DELAY);
 }
 function depart(){cancelIntent();if(!expanded||panel==='result'||panel==='chat'||keyboard)return;if(!closing)closing=setTimeout(()=>{closing=null;keyboard=false;call('work_island_keyboard',false).catch(()=>{});layout(false);},1200);}
 function close(){suppressed=true;keyboard=false;call('work_island_keyboard',false).catch(()=>{});cancelIntent();clearTimeout(closing);closing=null;layout(false,panel,anchor,true);}
 $$('.toolstrip [data-panel]').forEach(button=>{button.onclick=event=>{suppressed=false;const rect=button.getBoundingClientRect();layout(true,button.dataset.panel,event.clientX||rect.x+rect.width/2);};button.onpointerenter=event=>approach(event.clientX,button.dataset.panel);});
 $$('.toolstrip').forEach(el=>{el.onpointermove=event=>approach(event.clientX);el.onpointerleave=()=>{cancelIntent();if(!ready())depart();};});
 $('#island-content').onpointerenter=()=>{clearTimeout(closing);closing=null;wake();};$('#island-content').onpointerleave=()=>{if(!ready()||panel==='chat')depart();};
 $('#island-collapse').onclick=close;
 document.addEventListener('keydown',event=>{wake();if(event.key==='Escape'){close();return;}if(event.key==='Tab'){$$('button[data-pointer-focus]').forEach(b=>delete b.dataset.pointerFocus);keyboard=true;call('work_island_keyboard',true).catch(()=>{});clearTimeout(closing);closing=null;}});
 document.addEventListener('pointerdown',event=>{const target=event.target.closest('button');if(target)target.dataset.pointerFocus='true';keyboard=false;call('work_island_keyboard',false).catch(()=>{});wake();});
 async function action(method,...args){wake();try{const value=await call(method,...args);note('');return value;}catch(error){note(errorText(error));if(!expanded)layout(true,'notice',anchor);return null;}}
 $$('[data-open-panel]').forEach(button=>button.onclick=()=>layout(true,button.dataset.openPanel));
 $$('[data-route]').forEach(button=>button.onclick=()=>action('workspace_open_module',button.dataset.route));
 $('#workspace-open-app').onclick=()=>{cancelIntent();action('return_to_chat');};$('#workspace-brand').onclick=()=>action('return_to_chat');$('#work-region').onclick=()=>action('begin_work_region','translate');
 function renderDucking(value){if(value){body.dataset.musicDucked=String(value.ducked===true);if(value.error)note(value.error);}}
 reduced.addEventListener('change',motion);motion();
 function render(value){state=value;receiveActivity(value.computer_activity);window.BrivanyWorkspaceAgents?.receive(value);active=(value.jobs||[]).some(j=>['queued','planning','running','reviewing','awaiting_approval'].includes(j.state))||Object.values(value.live||{}).some(Boolean)||value.audio_translation?.active===true;if(active){lastActive=Date.now();body.dataset.sleeping='false';}if(value.island)receiveLayout(value.island);renderDucking(value.ducking);window.BrivanyTranslation?.receive(value.audio_translation);if(value.error)note(value.error);}
 function glance(){if(body.dataset.motion!=='true'||body.dataset.sleeping==='true')return;glanceUntil=Date.now()+3000;nextGlance=Date.now()+18000+Math.random()*24000;}
 function eyes(){
  if(!controls)return;
  if(body.dataset.liveListening==='true'||body.dataset.liveSpeaking==='true'||body.dataset.liveStarting==='true'||body.dataset.livePending==='true'||body.dataset.dictating==='true'||body.dataset.replyVisible==='true'||computerWorking){body.dataset.sleeping='false';lastActive=Date.now();return;}const bay=$('.eye-track').getBoundingClientRect(),now=Date.now(),sleep=prefs.sleep&&!ambientPlaying&&!active&&body.dataset.agentsWorking!=='true'&&!expanded&&now-lastActive>120000;
  if(sleep&&body.dataset.sleeping!=='true'){root.style.setProperty('--wander-time','.45s');root.style.setProperty('--eye-x',Math.max(12,(bay.width-CHARACTER_WIDTH)/2)+'px');nextWander=0;}
  body.dataset.sleeping=String(sleep);body.dataset.characterState=sleep?'sleeping':ambientPlaying?'dancing':active?'working':expanded?'attentive':'idle';
  if(sleep||body.dataset.motion!=='true'){root.style.setProperty('--gaze-x','0px');root.style.setProperty('--gaze-y','0px');return;}
  if(now>=nextWander){root.style.setProperty('--wander-time',(3+Math.random()*3)+'s');root.style.setProperty('--eye-x',Math.round(12+Math.random()*Math.max(0,bay.width-CHARACTER_WIDTH-24))+'px');nextWander=now+8500+Math.random()*7000;}
  if(now>=nextGlance){glance();nextGlance=now+18000+Math.random()*24000;}
  if(now<glanceUntil)call('work_island_gaze',Math.max(0,Math.min(innerWidth,$('.eye-wander').getBoundingClientRect().x+CHARACTER_WIDTH/2))).then(gaze=>{if(gaze){root.style.setProperty('--gaze-x',(gaze.x*5)+'px');root.style.setProperty('--gaze-y',(gaze.y*3)+'px');}}).catch(()=>{});else{root.style.setProperty('--gaze-x','0px');root.style.setProperty('--gaze-y','0px');}
 }

 let polling=false;
 async function pollPointer(){if(!controls||polling||!ready()||gone)return;polling=true;try{const value=await call('work_island_pointer');if(value){if(value.hide_chat&&expanded&&panel==='chat'){close();return;}keyboard=value.keep_open===true;if(keyboard){clearTimeout(closing);closing=null;cancelIntent();return;}if(value.near){clearTimeout(closing);closing=null;if(value.over_bar!==false&&Number.isFinite(value.anchor_x)){anchor=value.anchor_x;approach(anchor);}else cancelIntent();}else{suppressed=false;depart();}}}catch{}finally{polling=false;}}

 let statusBusy=false;async function pollState(){if(statusBusy||!ready()||gone)return;statusBusy=true;try{render(await call('work_status'));}catch{}finally{statusBusy=false;}}
 let warmed=false,deviceSignature='';
 let hadMusic=false,ambientPlaying=false,ambienceUntil=0,musicRevision=-1;
 let themeAt=0,localBusy=false,libraryRows=[],libraryHasNext=false,libraryRetry=null;
 let themeBusy=false,themeTrack='',failedArt='',lastMusicState=Date.now();
 let musicConnected=false,musicBusy=false,musicAction=false,musicView='player',musicData=null,musicReceived=0,lyricPage=0,lastTrack='',pending=false,lyricData=null,lyricAt=0,lyricBusy=false,libraryKind='playlists',libraryPage=0,libraryBusy=false,libraryRevision=0;
 const lyricRequests=new Set(),lyricCache=new Map();let lyricEpoch=0;
 let playbackIntent=null;
 function ambient(p){const playing=p?.playing===true&&p?.type==='track';if(playing){hadMusic=true;ambienceUntil=0;}else if(ambientPlaying)ambienceUntil=Date.now()+300000;ambientPlaying=playing;body.dataset.musicPlaying=String(playing);body.dataset.musicAmbience=String(hadMusic&&(playing||Date.now()<ambienceUntil));if(p)lastMusicState=Date.now();if(playing){body.dataset.sleeping='false';body.dataset.characterState='dancing';}else if(body.dataset.characterState==='dancing')body.dataset.characterState='idle';}
 function receivePlayback(value){if(!value)return;if(Number.isFinite(value.playback_revision)&&value.playback_revision<musicRevision)return;musicRevision=value.playback_revision??musicRevision;musicData=value;musicReceived=Number.isFinite(value.observed_at)?value.observed_at*1000:Date.now();renderConnection(value);renderMusic(value);musicLayout();}
 async function loadTheme(track){if(themeBusy)return;themeBusy=true;themeTrack=track;themeAt=Date.now();try{const value=await call('spotify_palette',track);if(value&&value.track_id===musicData?.playback?.id){paletteTween.to(value);themeTrack=track;}}catch{}finally{themeBusy=false;if(musicData?.playback?.id&&musicData.playback.id!==track)loadTheme(musicData.playback.id);}}
 $('#track-art').onerror=()=>{failedArt=$('#track-art').getAttribute('src')||'';$('#track-art').hidden=true;$('.art-empty').hidden=false;};
 $('#music-refresh').onclick=async()=>{failedArt='';const value=await musicCall('spotify_refresh');if(value){receivePlayback(value);}else ambient(null);};
 function musicMessage(text){$('#music-status').textContent=text||'';}
 async function musicCall(method,...args){try{return await call(method,...args);}catch(error){musicMessage(errorText(error));return null;}}
 function paintMusicView(){body.dataset.musicView=musicView;for(const view of ['library','devices'])$('#music-'+view+'-view').hidden=musicView!==view;$$('[data-music-view]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.musicView===musicView)));$('#music-device').setAttribute('aria-expanded',String(musicView==='devices'));}
 function musicLayout(){const kind=musicConnected?'music-'+musicView:'music';if(expanded&&panel==='music'&&layoutKind!==kind)layout(true,kind,anchor);}
 function renderConnection(s){if(typeof s.connected!=='boolean')return;musicConnected=s.connected;pending=s.pending===true;$('#spotify-setup').hidden=s.connected===true;$('#spotify-player').hidden=!s.connected;$('#spotify-storage').hidden=s.persistent!==false||pending;$('#spotify-connect').disabled=pending;$('#spotify-connect').textContent=pending?'Esperando a Spotify…':'Vincular Spotify ↗';$('#spotify-pending').hidden=!pending;if(s.message||s.queue_message)musicMessage(s.message||s.queue_message);if(!s.connected){lyricEpoch++;lyricCache.clear();lyricRequests.clear();ambient(null);musicData=null;musicRevision=-1;musicView='player';lyricData=null;lastTrack='';$('#music-library').replaceChildren();$('#lyrics-lines').replaceChildren();}musicLayout();}
 async function refreshMusic(){if(musicBusy||gone||(!controls&&(!expanded||panel!=='music')))return;musicBusy=true;try{const s=await musicCall('spotify_status');if(!s){ambient(null);return;}renderConnection(s);if(s.retry_after>0)musicMessage('Spotify está limitando las peticiones. Se reanudará en '+Math.ceil(s.retry_after/60)+' min.');if(surface==='bar'&&s.connected&&s.streaming_access&&!warmed){warmed=true;call('spotify_start_player').catch(()=>{});}if(s.connected){const value=await musicCall('spotify_playback');if(value){receivePlayback(value);}else ambient(null);}}finally{musicBusy=false;}}
 $('#spotify-connect').onclick=async()=>{const button=$('#spotify-connect');button.disabled=true;button.textContent='Abriendo Spotify…';if(await musicCall('spotify_connect')){pending=true;$('#spotify-pending').hidden=false;button.textContent='Esperando a Spotify…';}else{button.disabled=false;button.textContent='Vincular Spotify ↗';}};
 const fmt=ms=>{const seconds=Math.floor(Math.max(0,ms)/1000);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');};
 function position(){const p=musicData?.playback;return p?Math.min(p.duration_ms,Math.max(0,p.progress_ms+(p.playing?Math.min(15000,Math.max(0,Date.now()-musicReceived)):0))):0;}
 function renderMusic(s){
  const p=s.playback,shown=p||s.last_listened,valid=p?.type==='track',art=$('#track-art');if(!hadMusic&&p&&Number.isFinite(s.music_ambience_until)&&s.music_ambience_until*1000>Date.now()){hadMusic=true;ambienceUntil=s.music_ambience_until*1000;}ambient(p);updateDance();if(p?.id&&p.artwork&&(themeTrack!==p.id||Date.now()-themeAt>60000))loadTheme(p.id);$('#track-state').textContent=s.recovery_available?'Continuar escucha':p?(p.playing?'Sonando':'En pausa'):shown?'Última escucha':'Sin reproducción activa';$('#track-title').textContent=shown?.title||'Sin reproducción activa';$('#track-artist').textContent=shown?.artist||(s.empty_reason==='private_session'?'Spotify mantiene esta sesión privada.':s.local_player?.state==='ready'?'Elige música de tu biblioteca.':s.streaming_access?'Pulsa Escuchar aquí.':'Activa Brivany en Conexiones.');art.hidden=!shown?.artwork||shown.artwork===failedArt;$('.art-empty').hidden=!art.hidden;if(shown?.artwork&&art.getAttribute('src')!==shown.artwork)art.src=shown.artwork;if(!shown?.artwork)art.removeAttribute('src');
  $('#music-play').dataset.playing=String(p?.playing===true);$('#music-play').setAttribute('aria-label',p?.playing?'Pausar':!p&&shown?'Reproducir última escucha':'Reproducir');$('#music-shuffle').setAttribute('aria-pressed',String(p?.shuffle===true));$('#music-repeat').setAttribute('aria-pressed',String(p?.repeat&&p.repeat!=='off'));$('#music-repeat').dataset.track=String(p?.repeat==='track');$('#music-repeat').setAttribute('aria-label','Repetir: '+({off:'desactivado',context:'lista',track:'canción'}[p?.repeat]||'desactivado'));
  if(playbackIntent){if(!p||p.id!==playbackIntent.id||Date.now()>playbackIntent.until||p.playing===playbackIntent.playing&&!s.recovery_available)playbackIntent=null;else{$('#music-play').dataset.playing=String(playbackIntent.playing);$('#music-play').setAttribute('aria-label',playbackIntent.playing?'Pausar':'Reproducir');$('#track-state').textContent=playbackIntent.playing?'Iniciando…':'Pausando…';}}
  const d=p?.disallows||{},available=valid&&(s.devices||[]).some(x=>x.id===p.device&&!x.is_restricted);for(const [id,disallow] of [['play',p?.playing?'pausing':'resuming'],['next','skipping_next'],['prev','skipping_prev'],['seek','seeking'],['shuffle','toggling_shuffle'],['repeat',p?.repeat==='track'?'toggling_repeat_track':'toggling_repeat_context']])$('#music-'+id).disabled=!available||!!d[disallow]||s.recovery_available&&id!=='play';
  if(!p&&shown?.uri)$('#music-play').disabled=!(s.devices||[]).some(d=>!d.is_restricted);
  $('#music-seek').max=p?.duration_ms||100;$('#music-duration').textContent=fmt(shown?.duration_ms||0);if(document.activeElement!==$('#music-volume'))$('#music-volume').value=p?.volume||0;$('#music-volume').disabled=!available||!p.supports_volume||musicAction;
  const devices=s.devices||[],current=devices.find(x=>x.id===p?.device);$('#music-device-name').textContent=current?.name||'Dispositivos';$('#music-device').classList.toggle('device-active',!!current);const nextDevices=JSON.stringify([devices,p?.device,musicAction]);if(nextDevices!==deviceSignature){deviceSignature=nextDevices;$('#music-devices').replaceChildren(...devices.map(device=>{const button=document.createElement('button');button.className='device-option';button.textContent=device.name+(device.is_restricted?' · restringido':'');button.setAttribute('aria-pressed',String(device.id===p?.device));button.disabled=device.is_restricted||musicAction;button.onclick=()=>command('transfer',device.id);return button;}));if(!devices.length){const text=document.createElement('p');text.className='fine';text.textContent='No se han encontrado dispositivos.';$('#music-devices').append(text);}}

  if(p?.id!==lastTrack){lastTrack=p?.id||'';lyricData=null;lyricPage=0;$('#lyrics-lines').dataset.signature='';loadLyrics();}loadLyrics();tickMusic();
 }
 async function command(name,value){if(musicAction)return;musicAction=true;if(['play','pause'].includes(name)&&musicData?.playback)playbackIntent={id:musicData.playback.id,playing:name==='play',until:Date.now()+5000};$('#music-play').setAttribute('aria-busy','true');musicMessage('');if(musicData)renderMusic(musicData);const result=await musicCall('spotify_command',name,value);musicAction=false;if(!result)playbackIntent=null;$('#music-play').setAttribute('aria-busy','false');if(result?.state)receivePlayback(result.state);else if(musicData)renderMusic(musicData);if(result){musicMessage('');refreshMusic();}}
 $('#music-play').onclick=async()=>{if(!musicData?.playback&&musicData?.last_listened?.uri){await playLibraryItem(musicData.last_listened.uri);}else command(musicData?.playback?.playing?'pause':'play');};$('#music-prev').onclick=()=>command('previous');$('#music-next').onclick=()=>command('next');$('#music-shuffle').onclick=()=>command('shuffle',!musicData?.playback?.shuffle);$('#music-repeat').onclick=()=>command('repeat',({off:'context',context:'track',track:'off'})[musicData?.playback?.repeat]||'off');$('#music-volume').onchange=event=>command('volume',Math.round(Number(event.target.value)));$('#music-seek').onchange=event=>command('seek',Math.round(Number(event.target.value)));
 function toggleMusic(view){musicView=musicView===view?'player':view;paintMusicView();musicLayout();if(musicView==='library')loadLibrary();loadLyrics();}
 $$('[data-music-view]').forEach(button=>button.onclick=()=>toggleMusic(button.dataset.musicView));$('#music-device').onclick=()=>toggleMusic('devices');
 function libraryMessage(text,connections=false){const p=document.createElement('p');p.className='library-empty';p.textContent=text;$('#music-library').replaceChildren(p);if(connections){const button=document.createElement('button');button.className='text-button';button.textContent='Actualizar acceso en Conexiones ↗';button.onclick=()=>action('workspace_open_module','/connections');$('#music-library').append(button);}}
 const libraryObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&expanded&&musicView==='library'&&!libraryBusy&&libraryHasNext){libraryPage++;loadLibrary(true);}}, {root:$('#music-library'),rootMargin:'40px'});
 async function ensureLocalPlayer(){
  const status=await call('spotify_status');if(!status.streaming_access)throw new Error('Actualiza el acceso en Conexiones para escuchar desde Brivany. Requiere Spotify Premium.');
  await call('spotify_start_player');const deadline=Date.now()+20000;
  while(!gone&&Date.now()<deadline){const value=await call('spotify_status'),host=value.local_player||{};if(host.state==='ready'){
    if(musicData?.devices?.some(d=>d.id===host.id&&!d.is_restricted))return host.id;
    const fresh=await call('spotify_refresh');if(fresh.devices?.some(d=>d.id===host.id&&!d.is_restricted)){musicData=fresh;musicReceived=Date.now();renderMusic(fresh);return host.id;}
   }else if(!['idle','starting'].includes(host.state))throw new Error(host.message||'No se pudo activar el reproductor Brivany.');
   await new Promise(resolve=>setTimeout(resolve,700));
  }throw new Error('Spotify no confirmó el dispositivo Brivany. Vuelve a intentarlo.');
 }
 async function playLibraryItem(uri){if(musicAction||localBusy)return;localBusy=true;musicMessage('Preparando Brivany…');try{const id=await ensureLocalPlayer();await call('spotify_play_item',uri,id);musicMessage('');refreshMusic();}catch(error){musicMessage(errorText(error));}finally{localBusy=false;}}
 $('#music-here').onclick=async()=>{if(localBusy)return;localBusy=true;try{const id=await ensureLocalPlayer();await command('transfer',id);}catch(error){musicMessage(errorText(error));}finally{localBusy=false;}};
 async function loadLibrary(append=false){const revision=++libraryRevision;libraryObserver.disconnect();libraryBusy=true;musicMessage('');if(!append&&!libraryRows.length)libraryMessage('Cargando tu biblioteca…');$$('[data-library]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.library===libraryKind)));const result=await musicCall('spotify_library',libraryKind,libraryPage);if(revision!==libraryRevision)return;libraryBusy=false;if(!result){if(!append)libraryMessage('No se pudo cargar la biblioteca. Vuelve a abrirla para reintentar.');return;}if(result.retry_after){clearTimeout(libraryRetry);const wait=result.retry_after;libraryRetry=setTimeout(()=>{if(!gone&&expanded&&panel==='music'&&musicView==='library')loadLibrary(append);},wait*1000+200);musicMessage('Spotify limita las peticiones. Reintento automático en '+Math.max(1,Math.ceil(wait/60))+' min.');if(!result.items?.length){libraryMessage('Spotify está temporalmente limitado. Tu biblioteca se cargará al terminar la espera.');return;}}if(result.access_required){libraryMessage(libraryKind==='recent'?'Autoriza el historial de Spotify para recuperar tus últimas escuchas.':'Autoriza el acceso a tu biblioteca para escuchar tus favoritos.',true);return;}
  libraryRows=append?[...libraryRows,...result.items]:result.items||[];libraryHasNext=!result.stale&&result.has_next&&result.items?.length>0;if(!libraryRows.length){libraryMessage('Todavía no hay elementos guardados aquí.');return;}
  $('#music-library').replaceChildren(...libraryRows.map(item=>{const button=document.createElement('button');button.className='library-item';button.setAttribute('aria-label','Reproducir '+item.title);const cover=document.createElement('span');cover.className='library-cover';if(item.artwork){const img=document.createElement('img');img.src=item.artwork;img.alt='';img.onerror=()=>{img.remove();cover.textContent='♪';};cover.append(img);}else cover.textContent='♪';const copy=document.createElement('span'),name=document.createElement('strong'),subtitle=document.createElement('small'),play=document.createElement('span');copy.className='library-copy';name.textContent=item.title;subtitle.textContent=item.subtitle;copy.append(name,subtitle);play.className='library-play';play.textContent='▶';play.setAttribute('aria-hidden','true');button.append(cover,copy,play);button.onclick=()=>playLibraryItem(item.uri);return button;}));
  if(libraryHasNext){const sentinel=document.createElement('span');sentinel.className='library-sentinel';sentinel.setAttribute('aria-hidden','true');$('#music-library').append(sentinel);libraryObserver.observe(sentinel);}
 }
 $$('[data-library]').forEach(b=>b.onclick=()=>{libraryKind=b.dataset.library;libraryPage=0;libraryRows=[];clearTimeout(libraryRetry);loadLibrary();});
 async function loadLyrics(){
  const track=musicData?.playback?.id;if(!track){lyricData=null;lyricBusy=false;paintLyrics();return;}
  const cached=lyricCache.get(track);if(cached&&Date.now()-cached.at<(cached.value.retry_after??120)*1000){lyricData=cached.value;lyricBusy=false;paintLyrics();return;}
  if(lyricRequests.has(track))return;const epoch=lyricEpoch;lyricRequests.add(track);lyricBusy=true;paintLyrics();
  const result=await musicCall('spotify_lyrics',track);lyricRequests.delete(track);if(epoch!==lyricEpoch)return;
  const value=result?.track_id===track?result:{track_id:track,status:'loading',synced:false,lines:[],retry_after:.5};
  lyricCache.delete(track);lyricCache.set(track,{value,at:Date.now()});while(lyricCache.size>32)lyricCache.delete(lyricCache.keys().next().value);
  lyricBusy=lyricRequests.has(musicData?.playback?.id);if(track!==musicData?.playback?.id)return;
  $('#lyrics-lines').dataset.signature='';lyricAt=Date.now();lyricData=value;paintLyrics();
 }
 function stepLyrics(delta){if(!lyricData?.lines?.length||lyricData.synced)return false;const next=Math.max(0,Math.min(lyricData.lines.length-1,lyricPage+delta));if(next===lyricPage)return false;lyricPage=next;paintLyrics();return true;}
 $('#lyrics-lines').addEventListener('wheel',event=>{if(Math.abs(event.deltaY)>10&&stepLyrics(Math.sign(event.deltaY)))event.preventDefault();},{passive:false});$('#lyrics-lines').addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)&&stepLyrics(event.key==='ArrowUp'?-1:1))event.preventDefault();});
 function updateDance(){const p=musicData?.playback;if(!p)return;const profile=musicMotion.estimate(p,lyricData,position());body.dataset.musicMood=profile.mood;body.dataset.danceVariant=profile.variant;body.dataset.moodSource=profile.source;root.style.setProperty('--music-step',profile.period+'s');root.style.setProperty('--music-wave-scale',({gentle:.65,groove:.85,lively:1})[profile.mood]);}
 function paintLyrics(){const lyrics=lyricData,lines=lyrics?.synced?lyrics.lines||[]:[],container=$('#lyrics-lines');container.dataset.synced=String(lyrics?.synced===true);container.dataset.provider=lyrics?.provider||'';
  if((!lyrics&&lyricBusy)||lyrics?.status==='loading'){if(container.dataset.signature!=='loading'){container.dataset.signature='loading';container.replaceChildren(...[0,1,2].map(i=>{const row=document.createElement('p');row.className='lyric-placeholder '+(i===1?'current':'');const bar=document.createElement('span');row.append(bar);return row;}));}container.classList.add('is-loading');return;}
  container.classList.remove('is-loading');
  if(!lines.length){const signature='unavailable:'+(lyrics?.track_id||'');if(container.dataset.signature!==signature){container.dataset.signature=signature;container.replaceChildren();}return;}

  updateDance();let current=lyricPage;if(lyrics?.synced){current=-1;for(let i=0;i<lines.length;i++){if(lines[i].ms<=position())current=i;else break;}}else current=Math.min(current,Math.max(0,lines.length-1));
  const signature=[lyrics?.track_id||'',current,lines.length].join(':');if(container.dataset.signature!==signature){container.dataset.signature=signature;musicMotion.lyricTransition(container,[-1,0,1].map((offset)=>{const row=document.createElement('p');row.className=offset===0?'current':offset<0?'previous':'upcoming';row.dataset.lineIndex=lyrics.track_id+':'+(current+offset);row.textContent=lines[current+offset]?.text||'\u00a0';return row;}),()=>body.dataset.motion==='true');}
 }
 function tickMusic(){if(Date.now()-lastMusicState>12000)ambient(null);else body.dataset.musicAmbience=String(hadMusic&&(ambientPlaying||Date.now()<ambienceUntil));if(!musicData||!expanded||panel!=='music')return;if(playbackIntent&&Date.now()>playbackIntent.until){playbackIntent=null;renderMusic(musicData);}const ms=position();if(document.activeElement!==$('#music-seek'))$('#music-seek').value=ms;$('#music-elapsed').textContent=fmt(ms);if(!lyricBusy)loadLyrics();}
 const timers=[setInterval(pollPointer,200),setInterval(pollState,1000),setInterval(eyes,250),setInterval(refreshMusic,3500),setInterval(tickMusic,500)];
 
 window.addEventListener('resize',()=>{const bay=$('.eye-track').getBoundingClientRect();root.style.setProperty('--wander-time','0s');root.style.setProperty('--eye-x',Math.max(12,(bay.width-CHARACTER_WIDTH)/2)+'px');nextWander=Date.now()+1000;const width=Math.min(innerWidth,parseFloat(root.style.getPropertyValue('--panel-width'))||336),left=parseFloat(root.style.getPropertyValue('--panel-left'))||0;root.style.setProperty('--panel-width',width+'px');root.style.setProperty('--panel-left',Math.max(0,Math.min(innerWidth-width,left))+'px');});
 window.addEventListener('pywebviewready',()=>{pollState();pollPointer();refreshMusic();});function dispose(){paletteTween.dispose();$('#lyrics-lines').getAnimations({subtree:true}).forEach(a=>a.cancel());libraryObserver.disconnect();ambient(null);gone=true;timers.forEach(clearInterval);clearTimeout(opening);clearTimeout(closing);clearTimeout(libraryRetry);}
 window.addEventListener('pagehide',dispose);
 window.BrivanyIsland={showNotice:text=>{note(text);layout(true,'notice',anchor);},dispose,receivePlayback,receiveLayout,receiveActivity,wake,resizeChat,expand:(view='music',x=anchor)=>layout(true,view,x),reopen:close,glance};
 paint();pollState();pollPointer();eyes();
})();
