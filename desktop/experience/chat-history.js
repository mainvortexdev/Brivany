/* Private durable chat sessions. The parent owns state across module changes. */
(() => {
 const root=window, listeners=new Set(),pendingSends=new Map();let timer=null,queue=Promise.resolve(),catalog=[],failure='';
 const fresh=()=>({id:crypto.randomUUID(),messages:[],history:[],tasks:[],draft:''});
 const snapshot=session=>JSON.parse(JSON.stringify({id:session.id,messages:session.messages,history:session.history.slice(-12),tasks:session.tasks||[],draft:session.draft||'',...(session.title?{title:session.title,title_mode:session.title_mode||'auto'}:{})}));
 async function request(path,options){const response=await fetch('/api/desktop/chats'+path,{cache:'no-store',signal:AbortSignal.timeout(8000),...options});if(!response.ok)throw Error('No se pudo guardar el historial privado.');return response.json();}
 function changed(){for(const fn of listeners)fn();root.dispatchEvent(new CustomEvent('brivany-conversations-updated'));}
 const userCount=value=>value.messages.filter(message=>message.role==='user').length;
 function updateCatalog(value,result={}){
  const previous=catalog.find(item=>item.id===value.id),pending=pendingSends.get(value.id);
  const item={...previous,id:value.id,title:result.title||value.title||(value.messages.find(m=>m.role==='user')?.text||'Nueva conversación').slice(0,80),title_mode:result.title_mode||value.title_mode||'auto',messages:value.messages.length,updated:pending?.updated??result.updated??previous?.updated??Date.now()/1000};
  catalog=previous?catalog.map(old=>old.id===value.id?item:old):[item,...catalog];catalog.sort((a,b)=>b.updated-a.updated);
 }
 async function refresh(){const value=await request('');if(!Array.isArray(value.conversations))throw Error('No se pudo abrir el historial privado.');const previous=catalog;catalog=value.conversations;for(const [id,pending]of pendingSends){let item=catalog.find(item=>item.id===id);if(!item){item=previous.find(item=>item.id===id);if(item)catalog.push(item)}if(item)item.updated=pending.updated;}catalog.sort((a,b)=>b.updated-a.updated);changed();return value;}
 function flush(){clearTimeout(timer);timer=null;const session=root.BrivanyChatSession;if(!session)return Promise.resolve();const value=snapshot(session);
  queue=queue.catch(()=>{}).then(()=>request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).then(result=>{failure='';if(root.BrivanyChatSession?.id===value.id&&result.title)Object.assign(root.BrivanyChatSession,{title:result.title,title_mode:result.title_mode});if((pendingSends.get(value.id)?.users??Infinity)<=userCount(value))pendingSends.delete(value.id);updateCatalog(value,result);changed();return value}).catch(error=>{failure=error.message;changed();throw error});return queue;
 }
 const ready=(async()=>{try{const old=root.BrivanyChatSession,value=await refresh();root.BrivanyChatSession=old?.messages?.length?old:value.active?await request('/'+value.active):fresh();root.BrivanyChatSession.tasks||=[];if(old?.messages?.length)await flush();}catch{failure='No se pudo abrir el historial privado.';root.BrivanyChatSession||=fresh();}changed();})();
 async function select(identifier){await ready;await root.document.querySelector('#module-frame')?.contentWindow?.BrivanyChat?.persist?.();await flush();const session=identifier?await request('/'+identifier):fresh();root.BrivanyChatSession=session;await flush();root.BrivanyNavigate?.('/app?conversation='+encodeURIComponent(session.id));changed();}
 async function rename(identifier,title){await ready;await flush();const result=await request('/'+identifier+'/title',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});if(root.BrivanyChatSession?.id===identifier)Object.assign(root.BrivanyChatSession,{title:result.title,title_mode:'manual'});catalog=catalog.map(item=>item.id===identifier?{...item,title:result.title,title_mode:'manual'}:item);changed();return result;}
 root.BrivanyConversations={ready,flush,touch(){clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),300)},create:()=>select(null),select,
  messageSent(){const value=root.BrivanyChatSession;if(!value)return;const updated=Math.max(Date.now()/1000,...catalog.map(item=>item.updated+.001));pendingSends.set(value.id,{users:userCount(value),updated});updateCatalog(value);changed();clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),300);},
  rename,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},list:()=>catalog,error:()=>failure,refresh};
 root.addEventListener('pagehide',()=>{if(root.BrivanyChatSession)fetch('/api/desktop/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot(root.BrivanyChatSession)),keepalive:true}).catch(()=>{});});
})();
