/* Keep module startup observable and recoverable without replacing chat data. */
(() => {
 const faults=[],state={phase:'starting',attempt:0};
 const ownAsset=value=>{try{const url=new URL(value,location.href);return url.origin===location.origin?url.pathname.split('/').pop().slice(0,80):'external'}catch{return 'unknown'}};
 window.addEventListener('error',event=>{if(faults.length>=12)return;const asset=event.target?.src||event.target?.href||event.filename||'';faults.push({asset:ownAsset(asset),kind:event.target?.tagName&&event.target!==window?'resource-'+event.target.tagName.toLowerCase():event.error?.name||'script-error',message:typeof event.message==='string'?event.message.replace(/(?:sk-|Bearer\s+)[\w.-]+/gi,'[omitted]').replace(/https?:\/\/\S+/g,'[url]').slice(0,160):''})},true);
 window.BrivanyShellBoot={snapshot:()=>({...state,faults:[...faults]})};
 function initialize(){
  const frame=document.getElementById('module-frame'),panel=document.getElementById('module-loading');if(!frame||!panel)return;
  const label=panel.querySelector('[role=status]'),retry=panel.querySelector('button');let timer=null,deadline=0;
  const isChat=()=>{try{return new URL(frame.getAttribute('src')||'/app',location.origin).pathname==='/app'}catch{return false}};
  const inspect=()=>{clearTimeout(timer);if(!isChat()){panel.hidden=true;state.phase='module';return}let ready=false;try{ready=!!frame.contentWindow?.BrivanyChat}catch{}if(ready){panel.hidden=true;state.phase='ready';return}panel.hidden=false;if(Date.now()>=deadline){state.phase='failed';label.textContent='No se pudo abrir el chat.';label.classList.remove('status-shimmer');retry.hidden=false;return}state.phase='loading';timer=setTimeout(inspect,150)};
  const start=()=>{clearTimeout(timer);deadline=Date.now()+12000;state.attempt++;panel.hidden=!isChat();label.textContent='Abriendo el chat…';label.classList.add('status-shimmer');retry.hidden=true;inspect()};
  retry.onclick=async()=>{retry.disabled=true;try{await document.querySelector('#module-frame')?.contentWindow?.BrivanyChat?.persist?.()}catch{}location.reload()};
  // A shell extension failing must not prevent the main chat from loading.
  if(!frame.getAttribute('src'))frame.src='/app';
  const observer=new MutationObserver(start);observer.observe(frame,{attributes:true,attributeFilter:['src']});frame.addEventListener('load',inspect);start();
  window.addEventListener('pagehide',()=>{clearTimeout(timer);observer.disconnect()},{once:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
