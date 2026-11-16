/* Persist only known settings. Storage events coordinate windows in the current session. */
(() => {
 'use strict';
 const keys={
  general:'brivany.preferences',
  appearance:'brivany.workspace.widgets.v1',
  interface:'brivany.workspace.interface.v1',
  recording:'brivany.workspace.recording.v1',
  auditory:'brivany.translation',
  weather:'brivany.workspace.weather.v1',
  music:'brivany.workspace.music.v1'
 };
 const revisionKey='brivany.desktop.settings.revision';
 const meta=document.querySelector('meta[name="brivany-workspace-preferences"]');
 let bootstrap;
 try { bootstrap=JSON.parse(meta?.content); } catch { return; }
 if(bootstrap)bootstrap.music={expansion:false,style:'orbital',...bootstrap.music};
 const groups=Object.keys(keys);
 const defaults=Object.fromEntries(groups.map(group=>[group,bootstrap[group]]));
 if(groups.some(group=>!defaults[group]))return;
 let writes=Promise.resolve();
 let diskState=bootstrap;
 let owner=window;
 try { if(parent.location.origin===location.origin)owner=parent; } catch {}

 function read(key) {
  try {
   const raw=localStorage.getItem(key);
   const value=raw&&raw.length<=131072?JSON.parse(raw):null;
   return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  } catch { return {}; }
 }

 function current(group) {
  const stored=read(keys[group]);
  let fields=group==='appearance'?stored.preferences:stored;
  if(group==='weather'&&!diskState.initialized&&!('location' in stored))
   fields={location:read('brivany.workspace.daily.v1').location};
  const value={...diskState[group]};
  for(const key of Object.keys(defaults[group])){
   const next=fields?.[key];
   if(typeof next===typeof value[key])value[key]=next;
  }
  return value;
 }

 function apply(value) {
  if(!Number.isSafeInteger(value.revision)||value.revision<diskState.revision)return;
  diskState=value;
  try {
   const revision=Number(localStorage.getItem(revisionKey)??-1);
   if(value.revision<revision)return;
   for(const group of groups){
    const stored=read(keys[group]);
    const previous=group==='appearance'?stored.preferences:stored;
    if(JSON.stringify(previous)===JSON.stringify(value[group]))continue;
    const updated=group==='appearance'?{...stored,preferences:value[group]}:value[group];
    localStorage.setItem(keys[group],JSON.stringify(updated));
   }
   localStorage.setItem(revisionKey,String(value.revision));
  } catch {
   // The confirmed settings still work when browser storage is unavailable.
  }
 }

 function update(group, fields) {
  const write=writes.catch(()=>{}).then(async()=>{
   const initial=Object.fromEntries(groups.map(name=>[name,current(name)]));
   const response=await fetch('/api/desktop/workspace-preferences',{
    method:'POST', credentials:'same-origin', cache:'no-store',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({patch:{[group]:fields},initial}),
    signal:AbortSignal.timeout(6000)
   });
   if(!response.ok)throw Error(bootstrap.error||'No se pudo guardar el ajuste.');
   const saved=await response.json();
   if(!saved.initialized||!Number.isSafeInteger(saved.revision))throw Error('No se pudo confirmar el ajuste.');
   apply(saved);
   owner.dispatchEvent(new Event('brivany-preferences'));
   window.dispatchEvent(new Event('brivany-workspace-settings'));
   return current(group);
  });
  writes=write;
  return write;
 }

 if(bootstrap.initialized)apply(bootstrap);
 window.BrivanyDesktopPreferenceStore={current,update,error:bootstrap.error||''};
})();
