import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Glass,Button} from 'glisse';

const mount=document.querySelector('#workspace-result');
const api=()=>window.pywebview?.api;
const close=()=>{mount.querySelectorAll('video,audio').forEach(item=>item.pause());api()?.work_island_keyboard?.(false);window.BrivanyIsland?.reopen()};
const Cross=()=> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M7 17 17 7"/></svg>;

function Media({value}){
 const [url,setURL]=useState(''),[error,setError]=useState(false);
 useEffect(()=>{let objectURL;const abort=new AbortController();
  fetch(value.media_url,{headers:{'X-Brivany-Result':value.media_ticket},signal:abort.signal,cache:'no-store'}).then(response=>{if(!response.ok)throw Error();return response.blob()}).then(blob=>{if(abort.signal.aborted)return;objectURL=URL.createObjectURL(blob);setURL(objectURL)}).catch(()=>{if(!abort.signal.aborted)setError(true)});
  return()=>{abort.abort();if(objectURL)URL.revokeObjectURL(objectURL)};
 },[value]);
 if(error)return <p>No se pudo cargar el archivo.</p>;
 if(!url)return <div className="result-loading" role="status" aria-label="Cargando archivo"/>;
 return value.type==='audio'?<audio src={url} controls/>:<video src={url} controls playsInline preload="metadata"/>;
}

function Viewer(){
 const [value,setValue]=useState(null),scroll=useRef(null);
 useLayoutEffect(()=>{window.__renderBrivanyResult=next=>flushSync(()=>setValue(next));return()=>delete window.__renderBrivanyResult},[]);
 useEffect(()=>{if(scroll.current)scroll.current.scrollTop=0},[value]);
 if(!value)return null;
 const openChild=async item=>{try{await api().work_agent_review(item.job_id)}catch{}};
 return <Glass className="result-glass" data-theme="dark" role="dialog" aria-modal="false" aria-labelledby="result-heading">
  <header className="result-header"><h2 id="result-heading">{value.title}</h2><Button icon={<Cross/>} onClick={close} aria-label="Cerrar resultado" className="result-close"/></header>
  <div className="result-scroll" ref={scroll} tabIndex={0} aria-label="Contenido del resultado" onPointerDown={()=>api()?.work_island_keyboard?.(true)} onKeyDown={event=>{if(event.key==='Escape')close()}}>
   {value.type==='image'?<img src={value.src} alt={value.title} className="result-image"/>:
    ['video','audio'].includes(value.type)?<Media key={value.id+value.media_ticket} value={value}/>:
    value.type==='model'?<iframe src={value.url} title={value.title} sandbox="allow-scripts allow-same-origin" className="result-model"/>:
    value.type==='team'?<div className="result-team">{value.items.map(item=><Button key={item.key} onClick={()=>openChild(item)} disabled={!item.job_id} className="result-team-item"><span>{item.title}</span><i className={item.accepted?'done':'pending'} aria-label={item.accepted?'Revisado':'Pendiente'}/></Button>)}</div>:
    <div className="result-text">{value.text}</div>}
  </div>
 </Glass>;
}

if(mount){
 const root=createRoot(mount);flushSync(()=>root.render(<Viewer/>));
 window.BrivanyResultView={receive(value){if(!value||typeof value.id!=='string'||typeof value.title!=='string')return false;window.__renderBrivanyResult?.(value);return true},suspend(){mount.querySelectorAll('video,audio').forEach(item=>item.pause())}};
 window.addEventListener('pagehide',()=>{root.unmount();delete window.BrivanyResultView},{once:true});
}
