(() => {
 'use strict';const core=window.BrivanyMusicComposition,$=id=>document.getElementById(id),canvas=$('music-spectrum'),context=canvas.getContext('2d'),measureCanvas=document.createElement('canvas').getContext('2d');
 let gone=false,started=false,track=null,lyrics={lines:[]},receivedAt=0,lineKey='',lastText='',stateTimer,spectrumTimer,animation=0,lastDraw=0,spectrum={state:'off',bins:[]},smooth=new Float32Array(64),forcePosition=null,style='orbital',clockMinute='';
 document.fonts.ready.then(()=>{lineKey='';if(!gone&&lastText)compose(lastText,core.lyricAt(lyrics.lines||[],position()))});
 const api=()=>window.pywebview?.api,reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const measure=(text,size,weight)=>{measureCanvas.font=`${weight} ${size*100}px "Brivany Editorial",sans-serif`;return measureCanvas.measureText(text).width/100};
 function appearance(){const store=window.BrivanyDesktopPreferenceStore,next=store?.current('music')?.style==='amber'?'amber':'orbital';if(next!==style){style=next;lineKey=''}document.body.dataset.style=style;document.body.dataset.motion=String(store?.current('appearance')?.motion!==false)}
 function clock(){const now=new Date(),minute=now.toDateString()+now.getHours()+':'+now.getMinutes();if(minute===clockMinute)return;clockMinute=minute;$('expansion-time').textContent=now.toLocaleTimeString(document.documentElement.lang,{hour:'2-digit',minute:'2-digit'});$('expansion-time').dateTime=now.toISOString();$('expansion-date').textContent=now.toLocaleDateString(document.documentElement.lang,{weekday:'short',day:'numeric',month:'short'})}
 function position(){return forcePosition??Math.min(track?.duration_ms||0,(track?.progress_ms||0)+(track?.playing?performance.now()-receivedAt:0))}
 function compose(text,index){
  lastText=text;document.body.dataset.hasLyrics=String(!!text);const target=$('lyric-composition'),bounds=document.querySelector('.lyric-scene').getBoundingClientRect(),plan=core.composition(text,index,bounds.width,bounds.height,measure,style);
  target.replaceChildren();target.dataset.composition=plan.name;
  for(const row of plan.rows){const line=document.createElement('div');line.className='lyric-row';line.style.fontSize=plan.font*row.scale+'px';line.style.fontWeight=String(row.weight);line.style.textAlign=row.align;line.style.paddingLeft=row.indent*100+'%';const phrase=document.createElement('span');phrase.className='lyric-phrase';phrase.dataset.emphasis=row.emphasis||'plain';phrase.style.setProperty('--phrase-tilt',(row.tilt||0)+'deg');for(const [index,word] of row.words.entries()){if(index)phrase.append(document.createTextNode(' '));const node=document.createElement('span');node.className='lyric-word';node.textContent=word;phrase.append(node)}line.append(phrase);target.append(line)}
 }
 function lyricFrame(){
  const current=position(),index=lyrics.synced?core.lyricAt(lyrics.lines||[],current):-1,key=(track?.id||'')+':'+index;
  if(key!==lineKey){lineKey=key;const text=index>=0?lyrics.lines[index].text:'';compose(text,index);$('lyric-availability').hidden=!!text}
  if(track?.duration_ms)$('expansion-progress').style.transform=`scaleX(${core.clamp(current/track.duration_ms,0,1)})`;
 }
 function receive(value){
  if(gone||!value)return;appearance();clock();const changed=track?.id!==value.track?.id;track=value.track||null;receivedAt=performance.now();lyrics=value.lyrics||{lines:[]};if(changed){lineKey='';smooth.fill(0);$('expansion-cover').removeAttribute('src')}
  document.body.dataset.playing=String(track?.playing===true);$('expansion-title').textContent=track?.title||'';$('expansion-artist').textContent=track?.artist||'';$('expansion-source').textContent=track?.source==='youtube'?'YouTube':'Spotify';
  document.querySelector('.expansion-name').textContent=value.preview?'Expansión musical · Vista previa':'Expansión musical';document.querySelector('.expansion-right p').textContent=value.preview?'Esc para volver':'Mueve el ratón o usa el teclado para volver';
  const art=track?.artwork;let valid=false;try{const url=new URL(art,location.origin);valid=(url.origin===location.origin&&url.pathname.startsWith('/api/spotify/artwork'))||(url.protocol==='https:'&&['i.ytimg.com','i.scdn.co','mosaic.scdn.co'].includes(url.hostname))}catch{}
  if(valid){if($('expansion-cover').getAttribute('src')!==art)$('expansion-cover').src=art;$('expansion-cover').hidden=false}else $('expansion-cover').hidden=true;
  $('lyric-availability').textContent=lyrics.status==='loading'?'Buscando letra sincronizada…':lyrics.status==='instrumental'?'Una pausa para escuchar.':lyrics.status==='unavailable'?'Letra sincronizada no disponible.':'';
  if(value.spectrum)receiveSpectrum(value.spectrum);lyricFrame();
 }
 function receiveSpectrum(value){if(!value)return;spectrum=value;$('spectrum-state').textContent=value.state==='audio'?'Ritmo del audio del sistema':value.state==='unavailable'?'Visualizador sin audio disponible':value.state==='starting'?'Preparando visualizador…':''}
 function resize(){const bounds=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(bounds.width*ratio);canvas.height=Math.round(bounds.height*ratio);lineKey='';lyricFrame()}
 function draw(now){
  if(gone)return;animation=requestAnimationFrame(draw);if(document.hidden||now-lastDraw<33)return;lastDraw=now;lyricFrame();
  const width=canvas.width,height=canvas.height,cx=width/2,cy=height/2,radius=width*.253,maxLength=width*.205;context.clearRect(0,0,width,height);context.lineCap='round';
  const real=spectrum.state==='audio'&&!reduced.matches&&document.body.dataset.motion!=='false';
  if(style==='amber'){const energy=real?(spectrum.bins||[]).reduce((sum,value)=>sum+core.clamp(Number(value)||0,0,1),0)/64:0;document.body.style.setProperty('--aura-level',String(.32+energy*.6));return}
  for(let i=0;i<128;i++){
   const bin=Math.min(63,i<64?i:127-i),target=real?core.clamp(Number(spectrum.bins?.[bin])||0,0,1):0;smooth[bin]+=(target-smooth[bin])*(target>smooth[bin]?.4:.12);
   const amplitude=real?smooth[bin]:0,angle=i/128*Math.PI*2-Math.PI/2,end=radius+width*.012+amplitude*maxLength;
   context.strokeStyle=`rgba(248,245,213,${.26+amplitude*.64})`;context.lineWidth=Math.max(1,width*.0034);context.beginPath();context.moveTo(cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius);context.lineTo(cx+Math.cos(angle)*end,cy+Math.sin(angle)*end);context.stroke();
  }
 }
 async function pullState(){if(gone)return;try{receive(await api()?.state())}catch{}if(!gone)stateTimer=setTimeout(pullState,1000)}
 async function pullSpectrum(){if(gone)return;try{if(!document.hidden)receiveSpectrum(await api()?.spectrum())}catch{}if(!gone)spectrumTimer=setTimeout(pullSpectrum,reduced.matches?500:100)}
 async function close(){try{await api()?.close()}catch{}}
 async function start(){if(started||gone||!api())return;started=true;resize();await pullState();pullSpectrum();animation=requestAnimationFrame(draw);await api().ready()}
 function dispose(){if(gone)return;gone=true;clearTimeout(stateTimer);clearTimeout(spectrumTimer);cancelAnimationFrame(animation);observer.disconnect();window.removeEventListener('pywebviewready',start)}
 $('expansion-close').onclick=close;window.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
 const observer=new ResizeObserver(resize);observer.observe(document.querySelector('.lyric-scene'));observer.observe(canvas);
 window.addEventListener('pywebviewready',start);window.addEventListener('pagehide',dispose,{once:true});
 window.BrivanyMusicExpansion={receive,receiveSpectrum,seek:ms=>{forcePosition=ms;lineKey='';lyricFrame()},snapshot:()=>({track:track?.id,style,composition:$('lyric-composition').dataset.composition,position:position()}),dispose};start();
})();
