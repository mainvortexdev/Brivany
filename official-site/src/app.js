import {ProductScene} from './scene.js';

const $=s=>document.querySelector(s),tabs=[...document.querySelectorAll('[data-device]')];let scene,mode='overview',toastTimer,toastHide;
function toast(message){clearTimeout(toastTimer);clearTimeout(toastHide);const node=$('#toast');node.textContent=message;node.hidden=false;node.classList.remove('is-closing');toastTimer=setTimeout(()=>{node.classList.add('is-closing');toastHide=setTimeout(()=>node.hidden=true,250);},3000);}
const content={
 overview:{status:'Una experiencia interactiva',title:'Explora Brivany en 3D.',description:'Explora los dispositivos y prueba sus controles. El ordenador es la primera versión; móvil y gafas muestran la dirección de Brivany.',caption:'Ordenador, móvil y gafas. Elige un dispositivo.'},
 desktop:{status:'Brivany para Windows · en desarrollo',title:'Tu voz, con herramientas.',description:'Pide a Melodi que trabaje con un video, consulte un manual o prepare un proyecto. La conversación continúa mientras el agente se encarga.',caption:'Vista de ejemplo de la app y Melodi WorkSpace.'},
 phone:{status:'Concepto de Brivany en móvil',title:'Del móvil al espacio 3D.',description:'Cambia entre la habitación y el plano. Guarda una imagen del dispositivo y la escena de demostración.',caption:'Dispositivo y escena de demostración. No realiza un escaneo real.'},
 glasses:{status:'Concepto de Brivany en gafas',title:'Explora la habitación.',description:'Abre las gafas o entra en la habitación conceptual. Selecciona un objeto y prueba cómo cambia su posición dentro del espacio.',caption:'Exploración conceptual. La conexión con gafas aún no está disponible.'}
};
function button(label,action,{dark=false,pressed,disabled=false,id}={}){const node=document.createElement('button');node.type='button';node.className='pill'+(dark?' dark':'');node.textContent=label;node.disabled=disabled;node.dataset.action=id||label;if(pressed!==undefined)node.setAttribute('aria-pressed',String(pressed));node.onclick=action;return node;}
let viewUrl;
function viewDownload(){const link=document.createElement('a');link.className='pill dark';link.textContent='Guardar vista ↓';link.download='Brivany-vista-3D.png';link.href='#experiencia';link.onclick=event=>{if(!scene){event.preventDefault();return;}try{if(viewUrl)URL.revokeObjectURL(viewUrl);const data=scene.save().split(',')[1],bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));viewUrl=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));link.href=viewUrl;}catch{event.preventDefault();toast('No se pudo guardar la vista 3D.');}};return link;}
function actions(){
 const mount=$('#device-actions'),focused=document.activeElement?.dataset.action;mount.replaceChildren();
 if(mode==='overview')mount.append(button('Conocer a Melodi →',()=>select('desktop'),{dark:true}));
 if(mode==='desktop'){
  const fold=button(scene?.laptop.closed?'Abrir ordenador':'Cerrar ordenador',()=>{if(scene){const closed=scene.toggleLaptop();fold.textContent=closed?'Abrir ordenador':'Cerrar ordenador';}},{disabled:!scene,id:'fold'});
  const link=document.createElement('a');link.className='pill dark';link.href='#audio';link.textContent='Extraer audio ↓';mount.append(fold,link);
 }
 if(mode==='phone'){
  const view=button(scene?.phone.plan?'Ver habitación':'Ver plano',()=>{if(scene){const plan=scene.togglePhone();view.textContent=plan?'Ver habitación':'Ver plano';}},{disabled:!scene,id:'plan'});mount.append(view);if(scene)mount.append(viewDownload());
 }
 if(mode==='glasses'){
  if(scene?.entered){
   const detail=document.createElement('p');detail.className='detail';detail.id='object-detail';detail.textContent=scene.selected?.userData.name?scene.selected.userData.name+' · objeto de la escena de demostración':'Selecciona un objeto de la habitación.';mount.append(detail);
   mount.append(button('Mover silla',()=>{const moved=scene.moveChair();toast(moved?'La silla cambió de posición.':'La mesa limita el movimiento de la silla.');},{id:'move'}),viewDownload(),button('Volver a las gafas',()=>{scene.enterRoom();actions();},{dark:true,id:'enter'}));
  }else{
   const fold=button(scene?.glasses.opened?'Plegar patillas':'Abrir patillas',()=>{if(scene){const opened=scene.toggleGlasses();fold.textContent=opened?'Plegar patillas':'Abrir patillas';}},{disabled:!scene,id:'fold'});mount.append(fold,button('Explorar habitación →',()=>{if(scene){scene.enterRoom();actions();}},{dark:true,disabled:!scene,id:'enter'}));
  }
 }
 if(focused)mount.querySelector(`[data-action="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
}
function select(next){if(!content[next])return;mode=next;scene?.setMode(mode);for(const tab of tabs){const selected=tab.dataset.device===mode;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}const data=content[mode];$('#device-status').textContent=data.status;$('#device-title').textContent=data.title;$('#device-description').textContent=data.description;$('#scene-caption').textContent=data.caption;$('#device-panel').setAttribute('aria-labelledby','tab-'+mode);const panel=$('#device-panel');panel.classList.remove('is-changing');void panel.offsetWidth;panel.classList.add('is-changing');actions();}
for(const tab of tabs){tab.onclick=()=>select(tab.dataset.device);tab.onkeydown=event=>{const index=tabs.indexOf(tab);let target;if(event.key==='ArrowRight')target=(index+1)%tabs.length;else if(event.key==='ArrowLeft')target=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')target=0;else if(event.key==='End')target=tabs.length-1;else return;event.preventDefault();select(tabs[target].dataset.device);tabs[target].focus();};}
try{await Promise.all([300,400,500].map(w=>document.fonts.load(w+' 32px \"Brivany Editorial\"')));scene=new ProductScene($('#product-scene'),{onSelect:select,onObject:name=>{const detail=$('#object-detail');if(detail)detail.textContent=name+' · objeto de la escena de demostración';}});}catch{$('#product-scene').hidden=true;$('#scene-fallback').hidden=false;$('.drag-hint').hidden=true;}
$('#reset-scene').onclick=()=>{if(scene){scene.laptop.closed=false;scene.glasses.opened=true;scene.room.chair.position.x=-.75;if(scene.phone.plan)scene.togglePhone();}select('overview');};
document.querySelector('[data-select=desktop]').onclick=()=>select('desktop');actions();

const prompts={audio:'De este video extrae el audio y guárdalo en la carpeta Entrevistas de Documentos.',manual:'Busca el manual oficial de mi impresora y explícame cómo escanear con sus botones.',project:'Clona este repositorio en una copia de trabajo, inicia su servidor local y guarda una captura en el escritorio.'};
for(const node of document.querySelectorAll('[data-prompt]'))node.onclick=()=>{$('#instruction').value=prompts[node.dataset.prompt];$('#copy-status').textContent='';};
$('#copy-instruction').onclick=async()=>{const text=$('#instruction').value.trim();if(!text){$('#copy-status').textContent='Escribe una instrucción.';return;}try{await navigator.clipboard.writeText(text);$('#copy-status').textContent='Copiada. Puedes pegarla en el chat de Melodi.';}catch{$('#instruction').focus();$('#instruction').select();$('#copy-status').textContent='Selecciona y copia el texto con el teclado.';}};

let outputUrl=null,inputUrl=null,working=false;
function durationOf(file){return new Promise((resolve,reject)=>{const media=document.createElement('video'),url=URL.createObjectURL(file);let timer;const done=(error,duration)=>{clearTimeout(timer);media.removeAttribute('src');media.load();URL.revokeObjectURL(url);error?reject(error):resolve(duration);};media.onloadedmetadata=()=>{const duration=media.duration;done(Number.isFinite(duration)&&duration>0?null:Error('No se pudo comprobar la duración del archivo.'),duration);};media.onerror=()=>done(Error('Este navegador no reconoce el formato del archivo.'));timer=setTimeout(()=>done(Error('El navegador tardó demasiado en leer el archivo.')),15000);media.preload='metadata';media.src=url;});}
function createWav(buffer){return new Promise((resolve,reject)=>{const worker=new Worker('/assets/audio-worker.js',{type:'module'}),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice().buffer);worker.onmessage=event=>{worker.terminate();event.data.error?reject(Error(event.data.error)):resolve(event.data.result);};worker.onerror=()=>{worker.terminate();reject(Error('No se pudo preparar el archivo WAV.'));};worker.postMessage({rate:buffer.sampleRate,channels},channels);});}
$('#choose-media').onclick=()=>$('#media-input').click();
$('#media-input').onchange=async event=>{
 const file=event.target.files?.[0];if(!file||working)return;const card=$('.audio-card'),state=$('#audio-state'),choose=$('#choose-media'),download=$('#download-audio'),preview=$('#audio-preview');
 working=true;choose.disabled=true;card.dataset.busy='true';download.hidden=true;preview.pause();preview.hidden=true;preview.removeAttribute('src');if(outputUrl){URL.revokeObjectURL(outputUrl);outputUrl=null;}$('#audio-name').textContent=file.name;
 try{
  if(file.size>128*1024*1024)throw Error('Esta demo admite archivos de hasta 128 MB. Usa la app para archivos mayores.');
  state.textContent='Leyendo el archivo…';const duration=await durationOf(file);if(duration>300)throw Error('Esta demo admite hasta cinco minutos de audio o video.');
  const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!Offline)throw Error('Este navegador no permite decodificar audio local.');
  const context=new Offline(1,1,44100),buffer=await context.decodeAudioData(await file.arrayBuffer());state.textContent='Preparando el archivo WAV…';const wav=await createWav(buffer);
  outputUrl=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));download.href=outputUrl;download.download=file.name.replace(/\.[^.]+$/,'')+'-audio.wav';download.hidden=false;preview.src=outputUrl;preview.hidden=false;
  state.textContent=`${buffer.duration.toFixed(1).replace('.',',')} segundos · ${buffer.numberOfChannels===1?'Mono':'Estéreo'} · WAV`;scene?.desktopMode('result');
 }catch(error){state.textContent=error.message||'No se pudo extraer el audio. Prueba un MP4 con audio AAC o un WAV.';}
 finally{working=false;choose.disabled=false;card.dataset.busy='false';event.target.value='';}
};
window.addEventListener('pagehide',event=>{if(event.persisted)return;scene?.dispose();if(outputUrl)URL.revokeObjectURL(outputUrl);if(inputUrl)URL.revokeObjectURL(inputUrl);if(viewUrl)URL.revokeObjectURL(viewUrl);});
window.BrivanyDemo={select,get state(){return {mode,webgl:!!scene,room:!!scene?.entered,glassesOpened:scene?.glasses.opened,laptopClosed:scene?.laptop.closed,phonePlan:scene?.phone.plan,chairX:scene?.room.chair.position.x};}};
