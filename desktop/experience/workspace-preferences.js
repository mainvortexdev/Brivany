/* Share settings across views and persist Desktop changes beyond the WebView session. */
(() => {
 'use strict';
 const widgetsKey='brivany.workspace.widgets.v1',recordingKey='brivany.workspace.recording.v1';
 const localeKey='brivany.workspace.interface.v1';
 const musicKey='brivany.workspace.music.v1';
 const languages=Object.freeze({es:'Español',en:'English',fr:'Français','pt-BR':'Português (Brasil)'});
 function read(key){try{const raw=localStorage.getItem(key)||'{}';if(raw.length>131072)return {};const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}}
 function appearance(value){value=value&&typeof value==='object'?value:{};return {theme:['dark','soft'].includes(value.theme)?value.theme:'dark',accent:['blue','mint','amber','rose'].includes(value.accent)?value.accent:'blue',size:['compact','normal','large'].includes(value.size)?value.size:'normal',economy:value.economy!==false,motion:value.motion!==false}}
 function recording(){const saved=disk?.current('recording')||read(recordingKey);return {fps:[15,30].includes(saved.fps)?saved.fps:15,cursor:saved.cursor!==false}}
 const disk=window.BrivanyDesktopPreferenceStore;
 const widgets=()=>appearance(disk?.current('appearance')||read(widgetsKey).preferences);
 const music=()=>{const saved=disk?.current('music')||read(musicKey);return {expansion:saved.expansion===true,style:saved.style==='amber'?'amber':'orbital'}};
 function locale(){
  const value=(disk?.current('interface')||read(localeKey)).locale;
  return Object.hasOwn(languages,value)?value:'es';
 }

 function apply(value) {
  if(value.appearance){
   const saved=read(widgetsKey);
   const next=appearance(value.appearance);
   if(JSON.stringify(saved.preferences)!==JSON.stringify(next))
    localStorage.setItem(widgetsKey,JSON.stringify({...saved,preferences:next}));
  }
  if(value.recording&&JSON.stringify(recording())!==JSON.stringify(value.recording))
   localStorage.setItem(recordingKey,JSON.stringify(value.recording));
  if(value.music)localStorage.setItem(musicKey,JSON.stringify(value.music));
 }

 function update(group, patch, current) {
  if(disk)return disk.update(group,patch);
  const value={...current(),...patch};
  apply({[group]:value});
  window.dispatchEvent(new Event('brivany-workspace-settings'));
  return value;
 }
 function setWidgets(patch) {
  const normalized=appearance({...widgets(),...patch});
  return update('appearance',Object.fromEntries(Object.keys(patch).map(key=>[key,normalized[key]])),widgets);
 }
 function setRecording(patch) {
  const value={...recording(),...patch};
  if(![15,30].includes(value.fps)||typeof value.cursor!=='boolean')throw Error('Ajuste de grabación no válido.');
  return update('recording',patch,recording);
 }
 function setLocale(value) {
  if(!Object.hasOwn(languages,value))throw Error('Idioma de WorkSpace no válido.');
  if(disk)return disk.update('interface',{locale:value});
  localStorage.setItem(localeKey,JSON.stringify({locale:value}));
  window.dispatchEvent(new Event('brivany-workspace-settings'));
  return value;
 }
 function setMusic(patch){if(!patch||!Object.keys(patch).length||Object.keys(patch).some(key=>!['expansion','style'].includes(key))||('expansion' in patch&&typeof patch.expansion!=='boolean')||('style' in patch&&!['orbital','amber'].includes(patch.style)))throw Error('Ajuste musical no válido.');return update('music',patch,music)}
 window.BrivanyWorkspacePreferences={widgets,recording,music,locale,languages,setWidgets,setRecording,setLocale,setMusic,error:disk?.error||''};
})();
