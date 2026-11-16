/* Message-scoped attachments. Previews stay local; files are never executed here. */
(() => {
 let owner,rail,report,changed,uploading=false,generation=0;const items=()=>owner.BrivanyMediaDraft||=[];
 function card(item,remove){
  const tile=document.createElement('div');tile.className='chat-file';tile.title=item.name;
  const visual=document.createElement('div');visual.className='chat-file-visual';
  if(/^data:image\/jpeg;base64,/.test(item.thumbnail||'')){const image=document.createElement('img');image.src=item.thumbnail;image.alt='Miniatura de '+item.name;visual.append(image);}
  else{const icon=document.createElement('span');icon.className='chat-file-fallback';icon.textContent=item.kind==='video'?'▶':'♫';icon.setAttribute('aria-hidden','true');visual.append(icon);}
  const label=document.createElement('div');label.className='chat-file-label';const name=document.createElement('strong');name.textContent=item.name;const detail=document.createElement('span');detail.textContent=item.kind==='video'?'Video':'Audio';label.append(name,detail);tile.append(visual,label);
  if(remove){const button=document.createElement('button');button.type='button';button.className='chat-file-remove';button.setAttribute('aria-label','Quitar '+item.name);button.textContent='×';button.onclick=remove;tile.append(button);}
  return tile;
 }
 function render(){rail.replaceChildren(...items().map(item=>card(item,async()=>{
  try{const response=await fetch('/api/computer/media-inputs/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[item.id]})});if(!response.ok)throw Error();owner.BrivanyMediaDraft=items().filter(value=>value.id!==item.id);render();changed();}
  catch{report('No pude quitar ese adjunto. Vuelve a intentarlo.',true);}
 })));rail.hidden=!items().length;}
 async function thumbnail(file){
  if(!/\.(mp4|mov|m4v|webm|mkv|avi|mpg|mpeg)$/i.test(file.name))return '';
  const url=URL.createObjectURL(file),video=document.createElement('video');video.muted=true;video.preload='auto';video.playsInline=true;
  try{return await new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};const timer=setTimeout(()=>finish(''),2500);
   video.onerror=()=>finish('');video.onloadeddata=()=>{try{if(!video.videoWidth||!video.videoHeight)return finish('');const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#202624';ctx.fillRect(0,0,160,100);const scale=Math.min(160/video.videoWidth,100/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;ctx.drawImage(video,(160-w)/2,(100-h)/2,w,h);finish(canvas.toDataURL('image/jpeg',.65));}catch{finish('');}};video.src=url;
  });}finally{video.onloadeddata=video.onerror=null;video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
 }
 async function attach(files){
  if(uploading)return;const turn=generation;uploading=true;changed();
  try{for(const file of files){if(items().length>=8)throw Error('Puedes adjuntar hasta ocho archivos.');if(file.size>250*1024*1024)throw Error('El archivo supera los 250 MB.');report('Adjuntando '+file.name+'…');
   const [response,preview]=await Promise.all([fetch('/api/computer/media-input',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Brivany-Media-Name':encodeURIComponent(file.name)},body:file}),thumbnail(file)]);
   const value=await response.json();if(!response.ok)throw Error(value.error?.message||'No se pudo adjuntar el archivo.');if(!value.attachment?.id)throw Error('No pude confirmar el adjunto.');if(turn!==generation){fetch('/api/computer/media-inputs/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[value.attachment.id]})}).catch(()=>{});break;}items().push({...value.attachment,thumbnail:preview});render();
  }if(turn===generation)report();}catch(error){if(turn===generation)report(error.message||'No se pudo adjuntar el archivo.',true);}finally{uploading=false;changed();}
 }
 window.BrivanyChatMedia={
  init(options){({owner,report,changed}=options);if(owner.BrivanyMediaDraftConversation!==owner.BrivanyChatSession?.id)owner.BrivanyMediaDraft=[];owner.BrivanyMediaDraftConversation=owner.BrivanyChatSession?.id;rail=document.createElement('div');rail.className='chat-media-selection';rail.setAttribute('aria-label','Videos y audios adjuntos');document.querySelector('#chat-images').after(rail);render();
   const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='video/*,audio/*,.mkv,.m4v';input.hidden=true;document.body.append(input);
   const button=document.createElement('button');button.type='button';button.className='chat-icon';button.setAttribute('aria-label','Adjuntar video o audio');BrivanyIcons.set(button,'video');document.querySelector('#chat-attach-anchor').append(button);button.onclick=()=>input.click();input.onchange=()=>{attach([...input.files]);input.value='';};
   document.addEventListener('dragover',event=>{if([...event.dataTransfer?.types||[]].includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
   document.addEventListener('drop',event=>{const files=[...event.dataTransfer?.files||[]];if(!files.length)return;event.preventDefault();const media=files.filter(file=>/\.(mp4|mov|mkv|webm|m4v|avi|mpg|mpeg|wav|mp3|m4a|flac|ogg)$/i.test(file.name)),pictures=files.filter(file=>['image/png','image/jpeg','image/webp'].includes(file.type));if(media.length)attach(media);if(pictures.length)window.BrivanyImageRequest?.attachFiles(pictures);if(!media.length&&!pictures.length)report('Usa un video, audio o imagen PNG, JPEG o WebP.',true);});
  },
  get busy(){return uploading;},
  clear(){generation++;const ids=items().map(item=>item.id);owner.BrivanyMediaDraft=[];render();if(ids.length)fetch('/api/computer/media-inputs/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}).catch(()=>{});},
  take(){const batch=items().slice();owner.BrivanyMediaDraft=[];render();return batch;},
  restore(batch){const current=items();owner.BrivanyMediaDraft=[...batch.filter(item=>!current.some(other=>other.id===item.id)),...current].slice(0,8);render();changed();},
  renderSent(target,batch){const rail=document.createElement('div');rail.className='chat-sent-files';rail.setAttribute('aria-label','Archivos enviados');for(const item of batch)rail.append(card(item));target.prepend(rail);},
 };
})();
