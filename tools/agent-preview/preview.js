(() => {
 const frame=document.querySelector('#preview-chat'),team=document.querySelector('#team'),buttons=new Map();let current=null;
 window.BrivanyConversations={ready:Promise.resolve(),touch(){},flush:async()=>({})};
 const request=async path=>(await fetch(path,{method:path==='/api/demo'?'GET':'POST'})).json();
 const fallback={assistant_status:async()=>({jobs:(await request('/api/demo')).jobs}),workspace_chat_publish:async()=>({simulation:true}),music_voice_active:async()=>({simulation:true}),stop_assistant_tasks:async()=>request('/api/demo/pause')};
 if(!window.pywebview)window.pywebview={api:fallback};
 async function refresh(){
  const value=await request('/api/demo');current=value;document.body.dataset.motion=String(!value.paused);if(frame.contentDocument?.body)frame.contentDocument.body.dataset.motion=String(!value.paused);document.querySelector('#pause').textContent=value.paused?'Continuar':'Pausar';
  for(const job of value.jobs){let button=buttons.get(job.id);if(!button){button=document.createElement('button');button.className='preview-agent';const face=document.createElement('span');face.className='preview-avatar';face.dataset.avatarStyle='blobatar';button.append(face,document.createElement('strong'),document.createElement('small'));button.onclick=()=>{document.querySelector('#detail').textContent=button._job.title+' · '+button._job.phase;};buttons.set(job.id,button);team.append(button)}button._job=job;button.querySelector('strong').textContent=job.agent;button.querySelector('small').textContent=job.state==='planning'?'Preparando':job.state==='reviewing'?'Revisando':'Trabajando';window.BrivanyAgentAvatars?.render(button.querySelector('.preview-avatar'),job);}
 }
 const api=()=>window.pywebview?.api||fallback;
 document.querySelector('#pause').onclick=()=>request('/api/demo/pause').then(refresh);document.querySelector('#next').onclick=()=>request('/api/demo/next').then(refresh);document.querySelector('#restart').onclick=()=>request('/api/demo/reset').then(()=>location.reload());document.querySelector('#close').onclick=()=>window.pywebview?.api?.close_preview();
 let booted=false;async function bootChat(){
  for(let i=0;i<100&&!frame.contentWindow.BrivanyChat;i++)await new Promise(r=>setTimeout(r,50));
  if(!frame.contentWindow.BrivanyChat||booted)return;booted=true;
  if(!window.pywebview)window.pywebview={api:fallback};
  await frame.contentWindow.BrivanyChat.send('Muestra cómo trabajan mis agentes.',false);
  const data=await request('/api/demo');frame.contentWindow.BrivanyChat.observeImageJob({id:data.jobs[1].id},'También preparo una imagen de ejemplo para mostrar la miniatura y su progreso.');
 }
 frame.addEventListener('load',bootChat);bootChat();
 refresh();const timer=setInterval(async()=>{if(current&&!current.paused&&current.step<4)await request('/api/demo/next');await refresh()},6000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();
