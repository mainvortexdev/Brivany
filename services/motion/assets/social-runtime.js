/* Brivany · runtime de videos para redes (edición 4).
   Código de confianza: el plan de Melodi llega como datos (window.SOCIAL) y todo
   texto se inserta con textContent. Una sola línea de tiempo GSAP en pausa,
   determinista y navegable (window.__timelines.main). Los efectos de sonido se
   anotan en window.__sfx en el mismo instante que el evento visual. */
/* Carga previa: fuentes de Brivany y, si hay marca de cliente, sus fuentes y logos. */
window.__loadSocial=function(){const B=(window.SOCIAL||{}).brand,F=[300,400,500].map(w=>document.fonts.load(w+' 40px Brivany'));
  if(B){const st=document.createElement('style');st.textContent=`@font-face{font-family:BrandHead;src:url('${B.fonts.head.normal}');font-weight:300 700}@font-face{font-family:BrandHead;src:url('${B.fonts.head.italic}');font-style:italic;font-weight:300 700}@font-face{font-family:BrandBody;src:url('${B.fonts.body.normal}');font-weight:100 900}`;
    document.head.appendChild(st);F.push(document.fonts.load('500 40px BrandHead'),document.fonts.load('italic 500 40px BrandHead'),document.fonts.load('500 40px BrandBody'),document.fonts.load('600 40px BrandBody'));
    for(const src of [B.logo,B.logo_light])F.push(new Promise(r=>{const i=new Image();i.onload=i.onerror=r;i.src=src}))}
  return Promise.all(F)};
window.__buildSocial=function(){
'use strict';
const D=window.SOCIAL;
const W=D.size[0],H=D.size[1],PORTRAIT=H>W,S=D.safe;
const KW=864,KH=760;
const THEMES={
  paper:{bg:'#fbfcfd',ink:'#1d1d1f',accent:'#0071e3',muted:'#60758a',chip:'#eef3f8'},
  soft:{bg:'linear-gradient(170deg,#eef6ff 0%,#d6e8fc 100%)',ink:'#1d1d1f',accent:'#0063c9',muted:'#4f6a86',chip:'#ffffff'},
  night:{bg:'radial-gradient(120% 80% at 50% 0%,#14233a 0%,#080b11 62%)',ink:'#ffffff',accent:'#2997ff',muted:'#a9b8c8',chip:'rgba(255,255,255,.08)'},
  blue:{bg:'linear-gradient(160deg,#1a86f0 0%,#0060c9 100%)',ink:'#ffffff',accent:'#d6ecff',muted:'rgba(255,255,255,.78)',chip:'rgba(255,255,255,.14)'}
};
// Marca de cliente (kit de marca): paleta, acentos, tipografías y logo propios
const BR=D.brand||null;if(BR&&BR.themes)Object.assign(THEMES,BR.themes);
const ACC=BR?BR.ui.accent:'#0071e3',ACCG=BR?BR.ui.accent_gradient:'linear-gradient(180deg,#3a99f3,#0060c9)',GOLD=BR?BR.colors.gold:'#0071e3';
const CAP_HI=BR?BR.ui.caption_highlight:'#5fb0ff',TINT=BR?'74,89,47':'0,113,227',TINT_D=BR?'227,197,138':'41,151,255';
const INK='#26382e',OUT='power3.out',IO='power3.inOut';
const sfx=[];let cue=(t,type,gain)=>{if(isFinite(t)&&t>=0&&t<D.total)sfx.push({t:+t.toFixed(3),type,gain:gain??1})};
let tl=gsap.timeline({paused:true});
window.__timelines=window.__timelines||{};
let uid=0;const nid=p=>p+'-'+(++uid);

/* ---------- utilidades DOM ---------- */
function el(tag,cls,style,text){const e=document.createElement(tag);if(cls)e.className=cls;if(style)Object.assign(e.style,style);if(text!=null)e.textContent=text;return e}
function abs(parent,x,y,w,h,cls,extra,text){const e=el('div',cls,Object.assign({position:'absolute',left:x+'px',top:y+'px',width:w==null?'auto':w+'px',height:h==null?'auto':h+'px'},extra||{}),text);parent.appendChild(e);return e}
function svg(markup){const t=document.createElement('template');t.innerHTML=markup.trim();return t.content.firstChild}
const CHECK='<svg viewBox="0 0 42 42" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 22l9 9L34 12"/></svg>';

/* ---------- personajes ---------- */
function melodi(){const id=nid('m');return svg(`<svg class="melodi" viewBox="8 -2 172 126" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="${id}-b" x1=".1" x2=".8" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#f7fcf9"/><stop offset="1" stop-color="#d2e4dd"/></linearGradient></defs>
<ellipse cx="25" cy="64" rx="11" ry="17" fill="#e4f1ed"/><ellipse cx="162" cy="64" rx="11" ry="17" fill="#d8e7e0"/>
<path d="M39 39Q43 13 73 10Q100 7 125 16Q149 24 150 53L147 86Q143 107 117 111Q86 115 61 107Q37 101 35 79Z" fill="url(#${id}-b)" stroke="#dde9e4"/>
<path d="M51 34Q74 18 99 24" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".85"/>
<g class="m-eyes"><ellipse cx="71" cy="57" rx="4.8" ry="6.8" fill="${INK}"/><ellipse cx="115" cy="57" rx="4.8" ry="6.8" fill="${INK}"/></g>
<ellipse cx="59" cy="75" rx="9" ry="4.4" fill="#f3d7d0"/><ellipse cx="127" cy="75" rx="9" ry="4.4" fill="#f3d7d0"/>
<path class="m-smile" d="M87 77Q93 82 99 77" fill="none" stroke="#afc0b6" stroke-width="2" stroke-linecap="round"/>
<ellipse class="m-open" cx="93" cy="80" rx="5" ry="4.2" fill="#3c4d43" opacity="0"/></svg>`)}
const TONES={mint:['#f4fcf8','#a6dcc1','#bfe6d2'],rose:['#fff5f7','#f2a8be','#f6c5d2'],amber:['#fff9ea','#f3c56c','#f6d596'],blue:['#f3f8ff','#84b8f0','#aacdf3'],ink:['#66768a','#1d2430','#2c3644'],lilac:['#f8f4ff','#bba4f0','#d3c4f6']};
const SHAPES=['M38 62Q42 22 100 20Q158 22 164 66L168 128Q166 176 104 180Q40 178 34 130Z','M100 16Q160 18 166 92Q170 178 100 182Q30 178 34 92Q40 18 100 16Z','M30 100Q26 40 96 34Q176 30 176 104Q176 174 100 176Q34 176 30 100Z','M100 14Q112 34 140 44Q176 66 170 120Q162 180 100 182Q38 180 30 120Q24 66 62 44Q90 34 100 14Z'];
function blob(tone,shape){const id=nid('b'),[a,b,s]=TONES[tone],dark=tone==='ink',eye=dark?'#d6e8fc':INK;
return svg(`<svg class="blob" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1=".15" y1="0" x2=".8" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<path d="${SHAPES[shape%4]}" fill="url(#${id})" stroke="${s}" stroke-width="2"/><path d="M60 58Q82 40 110 45" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity="${dark?.28:.8}"/>
<g class="eyes"><ellipse cx="76" cy="98" rx="7.5" ry="10.5" fill="${eye}"/><ellipse cx="124" cy="98" rx="7.5" ry="10.5" fill="${eye}"/></g>
${dark?'':'<ellipse cx="58" cy="123" rx="13" ry="6.5" fill="#ee8d84" opacity=".36"/><ellipse cx="142" cy="123" rx="13" ry="6.5" fill="#ee8d84" opacity=".36"/>'}
<path class="smile" d="M88 122Q100 134 112 122" fill="none" stroke="${eye}" stroke-width="4" stroke-linecap="round"/><ellipse class="open" cx="100" cy="127" rx="9" ry="8" fill="${eye}" opacity="0"/></svg>`)}
function wordmark(color,dot){return svg("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 166.02 62\" role=\"img\" aria-label=\"brivany.\"><g fill=\"#1d1d1f\" transform=\"translate(2 46) scale(0.024 -0.024)\"><path d=\"M336 250Q384 187 440.0 162.0Q496 137 562 137Q698 137 771.5 234.0Q845 331 845 527Q845 708 780.0 792.5Q715 877 596 877Q512 877 450.5 839.0Q389 801 336 731ZM336 876Q399 946 479.0 989.0Q559 1032 661 1032Q750 1032 821.5 997.5Q893 963 943.0 898.5Q993 834 1020.0 742.0Q1047 650 1047 534Q1047 411 1016.5 310.0Q986 209 929.5 137.0Q873 65 792.0 25.5Q711 -14 610 -14Q561 -14 520.0 -4.5Q479 5 444.5 23.0Q410 41 381.0 67.0Q352 93 326 126L317 41Q309 0 267 0H141V1476H336Z\" transform=\"translate(0 0)\"/><path d=\"M325 821Q374 921 443.0 978.0Q512 1035 609 1035Q642 1035 671.5 1027.5Q701 1020 723 1005L710 858Q703 831 677 831Q663 831 635.0 836.5Q607 842 575 842Q528 842 492.0 828.5Q456 815 427.5 788.5Q399 762 377.0 723.5Q355 685 336 636V0H141V1016H253Q285 1016 296.5 1004.5Q308 993 313 964Z\" transform=\"translate(1083 0)\"/><path d=\"M345 1016V0H150V1016ZM382 1330Q382 1303 371.0 1278.5Q360 1254 341.5 1235.5Q323 1217 298.0 1206.5Q273 1196 246 1196Q219 1196 195.0 1206.5Q171 1217 152.5 1235.5Q134 1254 123.5 1278.5Q113 1303 113 1330Q113 1358 123.5 1382.5Q134 1407 152.5 1425.5Q171 1444 195.0 1454.5Q219 1465 246 1465Q273 1465 298.0 1454.5Q323 1444 341.5 1425.5Q360 1407 371.0 1382.5Q382 1358 382 1330Z\" transform=\"translate(1775 0)\"/><path d=\"M1051 1016 627 0H447L23 1016H189Q212 1016 227.5 1005.0Q243 994 248 977L498 353Q511 314 521.0 275.5Q531 237 539 199Q547 237 557.5 275.0Q568 313 582 353L835 977Q841 994 856.5 1005.0Q872 1016 894 1016Z\" transform=\"translate(2221 0)\"/><path d=\"M704 451Q582 447 496.5 432.5Q411 418 358.0 394.0Q305 370 281.0 337.5Q257 305 257 265Q257 227 270.0 199.5Q283 172 305.0 154.5Q327 137 357.0 129.0Q387 121 422 121Q468 121 506.5 130.0Q545 139 579.0 155.5Q613 172 644.0 196.0Q675 220 704 251ZM116 874Q204 955 306.0 995.0Q408 1035 531 1035Q620 1035 689.0 1006.5Q758 978 805.0 927.0Q852 876 876.5 805.0Q901 734 901 648V0H811Q782 0 766.5 9.5Q751 19 741 45L720 134Q680 98 641.0 70.5Q602 43 559.0 23.5Q516 4 468.0 -6.0Q420 -16 361 -16Q299 -16 245.0 0.5Q191 17 151.0 51.0Q111 85 88.0 136.0Q65 187 65 255Q65 315 98.5 370.5Q132 426 207.5 470.0Q283 514 405.0 542.0Q527 570 704 574V648Q704 763 654.0 820.0Q604 877 506 877Q440 877 395.5 861.0Q351 845 318.5 825.5Q286 806 262.0 790.0Q238 774 212 774Q191 774 176.5 785.0Q162 796 152 811Z\" transform=\"translate(3246 0)\"/><path d=\"M324 875Q357 910 393.0 939.0Q429 968 469.5 988.5Q510 1009 556.5 1020.5Q603 1032 656 1032Q740 1032 803.5 1004.0Q867 976 910.0 925.5Q953 875 975.0 804.0Q997 733 997 647V0H801V647Q801 756 751.0 816.5Q701 877 598 877Q523 877 457.5 841.5Q392 806 336 745V0H141V1016H258Q299 1016 309 977Z\" transform=\"translate(4227 0)\"/><path d=\"M1057 1016 477 -295Q468 -317 452.5 -329.0Q437 -341 408 -341H258L450 64L21 1016H196Q221 1016 235.5 1004.0Q250 992 256 977L522 367Q530 344 537.5 320.5Q545 297 550 274Q558 298 566.0 321.5Q574 345 583 368L839 977Q846 994 861.5 1005.0Q877 1016 897 1016Z\" transform=\"translate(5305 0)\"/><path d=\"M105 117Q105 144 115.0 168.0Q125 192 142.5 210.0Q160 228 184.0 238.5Q208 249 236 249Q263 249 287.0 238.5Q311 228 329.0 210.0Q347 192 357.5 168.0Q368 144 368 117Q368 89 357.5 65.0Q347 41 329.0 23.0Q311 5 287.0 -5.0Q263 -15 236 -15Q208 -15 184.0 -5.0Q160 5 142.5 23.0Q125 41 115.0 65.0Q105 89 105 117Z\" transform=\"translate(6329 0)\" fill=\"#0071e3\"/></g></svg>".replaceAll("#1d1d1f",color).replaceAll("#0071e3",dot))}

/* ---------- movimientos ---------- */
const rise=(t,sel,o={})=>tl.fromTo(sel,{opacity:0,y:o.y??28,scale:o.scale??1},{opacity:1,y:0,scale:1,duration:o.d??.32,ease:OUT,stagger:o.s??0,transformOrigin:o.origin??'50% 50%'},t);
const blink=(t,node)=>{const e=node.querySelector('.m-eyes,.eyes');if(e)tl.to(e,{scaleY:.12,transformOrigin:'50% 50%',duration:.07,repeat:1,yoyo:true,ease:'power1.inOut'},t)};
const loop=(target,from,to,t,len,period,ease)=>{if(!(len>=period*.6)||!target)return;const n=Math.max(0,Math.min(400,Math.floor(len/period)-1));tl.fromTo(target,from,Object.assign({},to,{duration:period,repeat:n,yoyo:true,ease:ease||'sine.inOut'}),t)};
function talk(node,a,b){const open=node.querySelector('.open,.m-open'),smile=node.querySelector('.smile,.m-smile');if(!open||b-a<.2)return;
  tl.set(smile,{opacity:0},a);tl.set(open,{opacity:1},a);tl.fromTo(open,{scaleY:.3},{scaleY:1,transformOrigin:'50% 50%',duration:.11,repeat:Math.max(1,Math.round((b-a)/.11)-1),yoyo:true,ease:'sine.inOut'},a);tl.set(open,{opacity:0},b);tl.set(smile,{opacity:1},b)}
function bars(parent,x,y,w,h,n,color,seed){const row=abs(parent,x,y,w,h,'k-bars');const gap=Math.max(3,w/n*.32),bw=(w-gap*(n-1))/n;
  for(let i=0;i<n;i++){const a=Math.min(1,.18+.82*Math.abs(Math.sin(i*.55+seed)*.55+Math.sin(i*1.7+.6+seed)*.3+Math.sin(i*.21+2)*.15));
    const b=el('i','',{position:'absolute',left:(i*(bw+gap))+'px',top:(h*(1-a)/2)+'px',width:bw+'px',height:(h*a)+'px',borderRadius:(bw/2)+'px',background:color});row.appendChild(b)}
  return row}
function wiggle(row,t,len){[...row.children].forEach((b,i)=>{const d=.2+(i%4)*.03;loop(b,{scaleY:1},{scaleY:.4+.5*Math.abs(Math.sin(i*2.3))},t+(i%6)*.035,len-(i%6)*.035,d)})}
function typeWords(container,text,t,each){const ws=[];text.split(/(\s+)/).forEach(p=>{if(!p)return;if(/^\s+$/.test(p)){container.append(' ');return}const s=el('span','w',{display:'inline-block',opacity:0},p);container.appendChild(s);ws.push(s)});
  tl.to(ws,{opacity:1,duration:.12,stagger:each,ease:'power1.out'},t);return ws.length*each}
function card(parent,x,y,w,h,extra){return abs(parent,x,y,w,h,'k-card',extra)}
function chip(parent,text,cls){const c=el('span','k-chip'+(cls?' '+cls:''),null,text);parent.appendChild(c);return c}

/* ---------- kits: 864×760 ---------- */
const KITS={};
KITS.melodi=(k,L,c)=>{const g=abs(k,82,610,700,140,'k-ground');
  const halo=abs(k,62,40,740,740,'k-orb');const rings=[0,1,2].map(i=>abs(k,72,50,720,720,'k-ring'));
  const m=abs(k,162,190,540,null,'');m.appendChild(melodi());
  tl.fromTo(halo,{opacity:0,scale:.5},{opacity:1,scale:1,duration:.45,ease:OUT},c.t0);loop(halo,{scale:1},{scale:1.06},c.t0+.5,c.dur-.6,1.3);
  rise(c.t0+.1,g,{y:0,d:.4});tl.fromTo(m,{opacity:0,y:40,scale:.7},{opacity:1,y:0,scale:1,duration:.42,ease:'back.out(1.4)'},c.t0+.12);cue(c.t0+.12,'pop');
  rings.forEach((r,i)=>loop(r,{scale:.55,opacity:.55},{scale:1.35,opacity:0},c.t0+.5+i*.4,c.dur-.6-i*.4,1.2,'power1.out'));
  loop(m,{y:0},{y:-12},c.t0+.6,c.dur-.7,1.1);
  for(let t=c.t0+.9;t<c.t0+c.dur-.3;t+=2.3)blink(t,m);
  c.speakers.push(m);
  if(L[0]){const b=abs(k,430,0,434,null,'k-bubble');typeWords(b,L[0],c.t0+.7,.09);rise(c.t0+.55,b,{y:12,scale:.85,origin:'0% 100%'});cue(c.t0+.55,'pop',.6)}
};
KITS.languages=(k,L,c)=>{const HELLO=['Hello','Bonjour','こんにちは','Hallo','Olá','Ciao','你好','Привет','Namaste','Merhaba','안녕하세요','Hej','Salut','Aloha','Ahoj','Hola'];
  const box=abs(k,0,40,864,640,'k-wrap');const target=L[0]||'Hola';
  const chips=HELLO.map(w=>{const ch=el('span','k-chip k-flip');const a=el('span','or',null,w),b=el('span','es',{opacity:0},target);ch.append(a,b);box.appendChild(ch);return ch});
  tl.fromTo(chips,{opacity:0,scale:.82},{opacity:1,scale:1,duration:.22,ease:OUT,stagger:Math.min(.07,c.dur*.3/chips.length)},c.t0+.1);cue(c.t0+.1,'pop',.7);
  const flip=c.t0+Math.max(1.2,c.dur*.55);cue(flip,'whoosh',.8);
  chips.forEach((ch,i)=>{const t=flip+i*.025;tl.to(ch,{scaleY:0,duration:.08,ease:'power2.in'},t);tl.set(ch.children[0],{opacity:0},t+.08);tl.set(ch.children[1],{opacity:1},t+.08);tl.set(ch,{background:c.theme.accent,color:c.dark?'#08111c':'#fff',borderColor:c.theme.accent},t+.08);tl.to(ch,{scaleY:1,duration:.14,ease:OUT},t+.08)});
};
KITS.counter=(k,L,c)=>{const value=(L[0]||'7.000').replace(/[^0-9.,+%]/g,'').slice(0,9)||'7.000';const word=L[1]||'';
  const size=value.length>6?190:240;const row=abs(k,0,120,864,size,'k-count',{fontSize:size+'px',height:size+'px',justifyContent:'center'});
  let reelIndex=0;[...value].forEach(ch=>{if(/[0-9]/.test(ch)){const reel=el('span','reel',{height:size+'px'});const strip=el('span','strip');const n=10+reelIndex*6+parseInt(ch,10);
      for(let i=0;i<n;i++)strip.appendChild(el('b','',{height:size+'px',lineHeight:size+'px'},String(i===n-1?ch:i%10)));
      reel.appendChild(strip);row.appendChild(reel);tl.fromTo(strip,{yPercent:0},{yPercent:-100*(n-1)/n,duration:Math.min(1.6,c.dur*.45)+reelIndex*.08,ease:'power3.out'},c.t0+.08);reelIndex++}
    else row.appendChild(el('span','sep',{height:size+'px',lineHeight:size+'px'},ch))});
  for(let i=0;i<8;i++)cue(c.t0+.1+i*.13,'tick',.45);cue(c.t0+Math.min(1.6,c.dur*.45)+.1,'pop');
  if(word){const w=abs(k,0,140+size,864,140,'k-countword',{color:c.theme.accent},word);rise(c.t0+.5,w,{y:20})}
};
KITS.dubbing=(k,L,c)=>{const v=card(k,0,0,864,486,{overflow:'hidden',background:'linear-gradient(160deg,#e6f1fd 0%,#f6faff 55%,#dfeaf6 100%)'});
  abs(v,-40,316,944,220,'k-floor');const spk=abs(v,60,110,250,null,'');spk.appendChild(blob('amber',3));
  const tag=abs(v,28,26,null,null,'k-tag k-tag-light');tag.style.width='auto';tag.textContent='▶  '+(L[2]||'YouTube');
  const sub=abs(v,340,150,490,180,'k-subs');const o=el('p','orig',null,L[0]||'The secret is to start.'),t=el('p','tr',{opacity:0},L[1]||'El secreto es empezar.');sub.append(o,t);
  const track=abs(v,30,450,804,10,'k-track');const fill=el('i');track.appendChild(fill);
  tl.fromTo(fill,{scaleX:.12},{scaleX:.7,duration:c.dur,ease:'none'},c.t0);
  rise(c.t0,v,{y:40});cue(c.t0+.05,'pop',.6);rise(c.t0+.25,o,{y:12});talk(spk,c.t0+.3,c.t0+c.dur-.2);
  const swap=c.t0+Math.max(1,c.dur*.42);tl.to(o,{opacity:.0,y:-10,duration:.14},swap);tl.fromTo(t,{opacity:0,y:14},{opacity:1,y:0,duration:.24,ease:OUT,immediateRender:false},swap+.08);cue(swap,'whoosh',.6);
  // pistas sincronizadas: subtítulos y doblaje sobre la misma regla de tiempo
  const l1=abs(k,0,530,300,40,'k-lane',null,'Subtítulos');const l2=abs(k,0,640,300,40,'k-lane',null,'Doblaje');
  const segs=[[0,150],[170,330],[350,470],[490,700],[720,864]];const subs=abs(k,0,576,864,40,'');
  segs.forEach(([a,b])=>{const s=el('i','k-seg',{left:a+'px',width:(b-a-8)+'px'});subs.appendChild(s)});
  const dub=abs(k,0,686,864,64,'');segs.forEach(([a,b],i)=>{const r=bars(dub,a,0,b-a-8,64,Math.round((b-a)/16),'linear-gradient(180deg,#3a99f3,#0060c9)',i)});
  const head=abs(k,0,520,6,240,'k-head');
  rise(c.t0+.4,[l1,subs],{y:12,s:.05});rise(c.t0+.55,[l2,dub],{y:12,s:.05});
  tl.fromTo(head,{x:0,opacity:1},{x:858,duration:c.dur-.5,ease:'none'},c.t0+.4);
  [...subs.children].forEach((s,i)=>{const at=c.t0+.4+(c.dur-.5)*segs[i][0]/864;tl.to(s,{background:c.theme.accent,duration:.12},at);tl.fromTo(dub.children[i],{opacity:.35},{opacity:1,duration:.12,immediateRender:true},at);if(i)cue(at,'tick',.35)});
};
KITS.voice_clone=(k,L,c)=>{// una tarjeta a pantalla completa: la pista de destino espera desde el principio
  const cd=card(k,0,0,864,760,{overflow:'hidden'});
  const l1=abs(cd,40,34,784,48,'k-lane');l1.append('Voz original ',el('span','k-pill grey',null,L[0]||'Inglés'));
  const r1=bars(cd,40,96,784,124,44,'#a9b7c5',0);
  const st=abs(cd,40,250,784,128,'k-status-box');const stx=abs(st,28,22,660,50,'k-status',null,L[2]||'Clonando la voz… unos segundos');
  const tr=abs(st,28,88,728,14,'k-track');const fi=el('i');tr.appendChild(fi);const ok=abs(st,700,18,56,56,'k-ok');ok.innerHTML=CHECK;
  const l2=abs(cd,40,408,784,48,'k-lane');l2.append('La misma voz ',el('span','k-pill blue',null,L[1]||'Español'));
  const wait=bars(cd,40,470,784,124,44,'#dfe7ef',0);const r2=bars(cd,40,470,784,124,44,'linear-gradient(180deg,#3a99f3,#0060c9)',0);
  const route=abs(cd,40,640,560,84,'k-route');route.append(el('span','k-pill grey',null,L[0]||'Inglés'),el('b',null,null,'→'),el('span','k-pill blue',null,L[1]||'Español'));
  const m=abs(cd,664,600,170,null,'');m.appendChild(melodi());
  rise(c.t0,cd,{y:30,scale:.97});cue(c.t0,'pop',.6);rise(c.t0+.1,[l1,r1],{y:16,s:.06});wiggle(r1,c.t0+.3,c.dur-.4);
  rise(c.t0+.2,[st,l2,wait,route],{y:20,s:.06});rise(c.t0+.3,m,{y:20,scale:.8});c.speakers.push(m);
  loop(wait,{opacity:1},{opacity:.55},c.t0+.4,Math.max(.6,c.dur*.45),.45);
  const fillEnd=Math.max(1.2,c.dur*.45);
  tl.fromTo(fi,{scaleX:0},{scaleX:1,duration:fillEnd,ease:'power1.inOut'},c.t0+.45);
  const done=c.t0+.45+fillEnd;tl.fromTo(ok,{opacity:0,scale:.5},{opacity:1,scale:1,duration:.24,ease:OUT},done);cue(done,'chime',.7);
  tl.to(stx,{color:'#0071e3',duration:.2},done);
  tl.fromTo(r2.children,{opacity:0,scaleY:.2},{opacity:1,scaleY:1,duration:.3,ease:OUT,stagger:.012},done+.1);cue(done+.1,'whoosh',.6);
  wiggle(r2,done+.7,c.t0+c.dur-done-.8);
};
KITS.speakers=(k,L,c)=>{const tones=['mint','rose','amber'],names=['Voz 1','Voz 2','Voz 3'];const lines=(L.length?L:['Hola a todos.','Empezamos ya.','Perfecto.']).slice(0,3);
  const rows=lines.map((txt,i)=>{const r=card(k,0,i*256,864,232,{overflow:'hidden'});const stripe=abs(r,0,0,14,232,'',{background:TONES[tones[i]][1]});
    const b=abs(r,34,30,150,null,'');b.appendChild(blob(tones[i],i+1));const n=abs(r,214,34,600,40,'k-name',null,names[i]);
    const tx=abs(r,214,86,610,130,'k-line');const ring=abs(r,0,0,864,232,'k-active',{borderColor:TONES[tones[i]][1]});return {r,b,tx,ring,txt}});
  rise(c.t0,rows.map(x=>x.r),{y:30,s:.08});cue(c.t0,'pop',.6);
  const slot=(c.dur-.4)/rows.length;rows.forEach((x,i)=>{const a=c.t0+.35+i*slot;tl.to(x.ring,{opacity:1,duration:.14},a);talk(x.b,a,a+slot-.15);typeWords(x.tx,x.txt,a+.1,Math.min(.16,(slot-.4)/Math.max(1,x.txt.split(/\s+/).length)));tl.to(x.ring,{opacity:0,duration:.14},a+slot-.12);cue(a,'tick',.4)});
};
KITS.meeting=(k,L,c)=>{const win=card(k,0,0,864,470,{overflow:'hidden'});const bar=abs(win,0,0,864,70,'k-winbar');
  bar.append(el('i','dot'),el('i','dot'),el('i','dot'),el('span','title',null,'Reunión de equipo'),el('span','live',null,'● En vivo'));
  // el participante que habla lleva el idioma real de la frase citada (labels[0])
  const PEOPLE={en:['Emma','English'],de:['Lukas','Deutsch'],fr:['Sophie','Français'],pt:['João','Português'],it:['Giulia','Italiano']};
  // «Nombre: frase» → la tarjeta usa ese nombre y la frase va sin prefijo
  const named=/^\s*([A-ZÁÉÍÓÚÑ][\wáéíóúñ]{1,15})\s*:\s*/;const said=(L[0]||'').match(named);L=L.map(x=>x.replace(named,''));
  const base=PEOPLE[(c.lang||[])[0]]||PEOPLE.en;const who=said?[said[1],base[1]]:base,other=Object.values(PEOPLE).find(p=>p!==base&&p!==PEOPLE.en)||PEOPLE.fr;
  const tiles=[['mint',who[0]+' · '+who[1],1],['rose',other[0]+' · '+other[1],2],['amber','Ana',3],['blue','Tú',0]].map(([tone,name,s],i)=>{const t=abs(win,20+(i%2)*420,88+Math.floor(i/2)*186,404,170,'k-tile',{background:`linear-gradient(160deg,${TONES[tone][0]},${TONES[tone][2]})`});
    const b=abs(t,142,12,120,null,'');b.appendChild(blob(tone,s));abs(t,12,118,null,null,'k-nametag',{width:'auto'},name);const ring=abs(t,0,0,404,170,'k-active',{borderColor:'#0071e3',borderRadius:'22px'});return {t,b,ring}});
  const p=card(k,0,500,864,260);const head=abs(p,30,22,800,60,'k-phead');const mm=el('span','mini');mm.appendChild(melodi());head.append(mm,'Melodi',el('small',null,null,'  · traducción en vivo'));
  // labels[0]=frase original de quien habla, labels[1]=traducción de Melodi (como en dubbing)
  const orig=abs(p,34,100,800,44,'k-orig',null,who[0]+' · «'+(L[0]||'We need to move the deadline.')+'»');
  const tr=abs(p,34,150,800,100,'k-utt');const txt=L[1]||'Tenemos que mover la fecha de entrega.';
  rise(c.t0,win,{y:40});rise(c.t0+.1,tiles.map(x=>x.t),{y:0,scale:.93,s:.05});rise(c.t0+.25,p,{y:30});cue(c.t0,'pop',.6);
  const a=c.t0+.45,len=c.dur-.7;tl.to(tiles[0].ring,{opacity:1,duration:.14},a);talk(tiles[0].b,a,a+len*.8);
  rise(a+.05,orig,{y:10,d:.22});const n=Math.max(1,txt.split(/\s+/).length);typeWords(tr,txt,a+Math.min(1,len*.3),Math.min(.2,(len*.6)/n));cue(a,'tick',.4);
  tl.to(tiles[0].ring,{opacity:0,duration:.14},a+len*.85);tl.to(tiles[3].ring,{opacity:1,duration:.14},a+len*.85);
};
KITS.chat=(k,L,c)=>{const msgs=(L.length?L:['¿Me resumes la reunión?','Claro. Decisión: entregar el viernes.']).slice(0,4);
  const win=card(k,0,0,864,760,{overflow:'hidden'});const head=abs(win,0,0,864,96,'k-winbar k-chathead');const mm=el('span','mini');mm.appendChild(melodi());head.append(mm,el('span','title',null,'Melodi'),el('span','live',null,'● en línea'));
  rise(c.t0,win,{y:40});cue(c.t0,'pop',.6);let y=130;const slot=(c.dur-.5)/msgs.length;
  msgs.forEach((txt,i)=>{const me=i%2===0;const b=abs(win,me?264:30,y,570,null,'k-msg '+(me?'me':'mel'),null,txt);const by=y;const h=b.offsetHeight;y+=h+26;
    const a=c.t0+.35+i*slot;if(!me){const dots=abs(win,30,by,130,64,'k-typing');for(let j=0;j<3;j++){const d=el('i');dots.appendChild(d);loop(d,{y:0},{y:-8},a+j*.08,.6,.18)}
      tl.fromTo(dots,{opacity:0},{opacity:1,duration:.1},a);tl.to(dots,{opacity:0,duration:.1},a+.55);cue(a,'type',.5);
      tl.fromTo(b,{opacity:0,y:16,scale:.9},{opacity:1,y:0,scale:1,duration:.26,ease:OUT,transformOrigin:'0% 100%'},a+.62);cue(a+.62,'pop',.5)}
    else{tl.fromTo(b,{opacity:0,y:16,scale:.9},{opacity:1,y:0,scale:1,duration:.26,ease:OUT,transformOrigin:'100% 100%'},a);cue(a,'pop',.5)}});
};
KITS.live_voice=(k,L,c)=>{const orb=abs(k,142,0,580,580,'k-orb');const rings=[0,1,2].map(()=>abs(k,142,0,580,580,'k-ring'));
  const m=abs(k,247,140,370,null,'');m.appendChild(melodi());
  const eq=bars(k,32,500,800,120,40,'linear-gradient(180deg,#3a99f3,#0060c9)',1.3);
  const pill=abs(k,327,520,210,68,'k-livepill',null,'● Live');const bub=abs(k,20,640,824,null,'k-caption-in');
  tl.fromTo(orb,{opacity:0,scale:.6},{opacity:1,scale:1,duration:.4,ease:OUT},c.t0);rise(c.t0+.1,m,{y:20,scale:.8});cue(c.t0,'swell',.6);
  rings.forEach((r,i)=>loop(r,{scale:.8,opacity:.6},{scale:1.5,opacity:0},c.t0+.3+i*.4,c.dur-.4-i*.4,1.2,'power1.out'));
  rise(c.t0+.2,eq,{y:10});wiggle(eq,c.t0+.3,c.dur-.4);rise(c.t0+.3,pill,{y:10});c.speakers.push(m);
  if(L[0])typeWords(bub,L[0],c.t0+.6,Math.min(.18,(c.dur-1)/Math.max(1,L[0].split(/\s+/).length)));
  for(let t=c.t0+.8;t<c.t0+c.dur-.3;t+=2.1)blink(t,m);
};
KITS.agents=(k,L,c)=>{const tasks=(L.length?L:['Buscar el dato','Redactar el resumen','Revisar la agenda']).slice(0,4);const tones=['ink','mint','rose','amber'];
  const hub=abs(k,342,10,180,null,'');hub.appendChild(melodi());const hubring=abs(k,322,-10,220,220,'k-ring');
  const n=tasks.length,cw=Math.min(260,(864-(n-1)*20)/n),gap=n>1?(864-cw*n)/(n-1):0;
  const lines=svg(`<svg class="k-links" viewBox="0 0 864 760" width="864" height="760">${tasks.map((_,i)=>{const x=i*(cw+gap)+cw/2;return `<path d="M432 190 C432 280 ${x} 250 ${x} 330" fill="none" stroke="#9cc8f5" stroke-width="4" stroke-dasharray="320" stroke-dashoffset="320"/>`}).join('')}</svg>`);k.appendChild(lines);
  const cards=tasks.map((txt,i)=>{const x=i*(cw+gap);const cd=card(k,x,330,cw,400,{overflow:'hidden'});const b=abs(cd,cw/2-60,24,120,null,'');b.appendChild(blob(tones[i],i));
    abs(cd,18,170,cw-36,130,'k-task',null,txt);const tr=abs(cd,18,320,cw-36,12,'k-track');const fi=el('i');tr.appendChild(fi);const ok=abs(cd,cw/2-28,346,56,56,'k-ok');ok.innerHTML=CHECK;return {cd,fi,ok,b}});
  tl.fromTo(hub,{opacity:0,scale:.7},{opacity:1,scale:1,duration:.36,ease:'back.out(1.4)'},c.t0);cue(c.t0,'pop',.7);loop(hubring,{scale:.8,opacity:.5},{scale:1.3,opacity:0},c.t0+.3,c.dur-.4,1.2,'power1.out');c.speakers.push(hub);
  tl.to(lines.querySelectorAll('path'),{strokeDashoffset:0,duration:.4,stagger:.08,ease:'power2.out'},c.t0+.3);
  rise(c.t0+.45,cards.map(x=>x.cd),{y:30,s:.08});cue(c.t0+.45,'whoosh',.5);
  const span=Math.max(.8,c.dur-1.6);cards.forEach((x,i)=>{const d=span*(.55+.12*i);tl.fromTo(x.fi,{scaleX:0},{scaleX:1,duration:d,ease:'power1.inOut'},c.t0+.7);loop(x.b.querySelector('.eyes'),{x:-4},{x:4},c.t0+.7,d,.25);
    tl.fromTo(x.ok,{opacity:0,scale:.5},{opacity:1,scale:1,duration:.22,ease:OUT},c.t0+.7+d);cue(c.t0+.7+d,'tick',.6)});
};
KITS.summary=(k,L,c)=>{const sh=card(k,0,0,864,750,{background:'linear-gradient(170deg,#fff 0%,#f4f7fa 100%)'});abs(sh,770,0,94,94,'k-fold');
  abs(sh,54,50,600,40,'k-kicker',null,'Resumen · hoy');abs(sh,54,94,680,80,'k-h3',null,L[0]||'Resumen ejecutivo');abs(sh,54,196,676,2,'k-rule');
  const rows=(L.slice(1).length?L.slice(1):['Decisión: entregar el viernes.','Responsable: Ana.','Dato clave: crecimiento del 14 %.']).slice(0,3).map((txt,i)=>{const r=abs(sh,54,238+i*160,680,140,'k-row');const bx=abs(r,0,8,66,66,'k-box');const u=el('u');bx.appendChild(u);const ck=el('span','ck');ck.innerHTML=CHECK;bx.appendChild(ck);abs(r,94,0,580,140,'k-rowtext',null,txt);return {r,u,ck}});
  tl.fromTo(sh,{opacity:0,y:70,rotation:-2.5},{opacity:1,y:0,rotation:0,duration:.38,ease:OUT},c.t0);cue(c.t0,'whoosh',.5);
  rise(c.t0+.3,rows.map(x=>x.r),{y:18,s:.1});const step=Math.max(.4,(c.dur-1.2)/rows.length);
  rows.forEach((x,i)=>{const t=c.t0+.8+i*step;tl.to(x.u,{opacity:1,duration:.12},t);tl.fromTo(x.ck,{opacity:0,scale:.4},{opacity:1,scale:1,duration:.2,ease:OUT},t+.03);cue(t,'tick',.7)});
};
KITS.workspace=(k,L,c)=>{const names=(L.length?L:['Traducción','Chat','Agentes','Música']).slice(0,4);const win=card(k,0,0,864,700,{overflow:'hidden',background:'linear-gradient(170deg,#ffffff,#f1f5f9)'});
  const bar=abs(win,0,0,864,64,'k-winbar');bar.append(el('i','dot'),el('i','dot'),el('i','dot'),el('span','title',null,'Brivany · WorkSpace'));
  const side=abs(win,0,64,96,636,'k-side');for(let i=0;i<5;i++)abs(side,26,30+i*80,44,44,'k-ico'+(i===0?' on':''));
  const panels=names.map((n,i)=>{const p=abs(win,118+(i%2)*368,86+Math.floor(i/2)*302,350,286,'k-panel');abs(p,22,18,300,40,'k-ptitle',null,n);const body=abs(p,22,74,306,190,'');
    if(i%4===0)bars(body,0,40,306,110,22,'linear-gradient(180deg,#3a99f3,#0060c9)',i);
    else if(i%4===1){abs(body,0,10,220,52,'k-mini-msg me');abs(body,80,76,226,52,'k-mini-msg')}
    else if(i%4===2){for(let j=0;j<3;j++){abs(body,0,j*62,40,40,'k-mini-box');abs(body,56,j*62+12,220-j*40,16,'k-mini-line')}}
    else{bars(body,0,50,306,90,14,'#bfd9f6',3);abs(body,0,0,180,16,'k-mini-line')}
    return p});
  const m=abs(k,700,560,170,null,'');m.appendChild(melodi());
  rise(c.t0,win,{y:40});cue(c.t0,'whoosh',.5);tl.fromTo(panels,{opacity:0,scale:.86},{opacity:1,scale:1,duration:.3,ease:OUT,stagger:Math.min(.22,c.dur/10)},c.t0+.35);
  panels.forEach((_,i)=>cue(c.t0+.35+i*Math.min(.22,c.dur/10),'pop',.4));rise(c.t0+.4+names.length*.2,m,{y:30,scale:.8});c.speakers.push(m);
};
KITS.checklist=(k,L,c)=>{const items=(L.length?L:['Traducir','Resumir','Crear']).slice(0,4);const box=card(k,0,0,864,760);const gap=760/items.length;// la tarjeta llena el kit y reparte los puntos
  const rows=items.map((txt,i)=>{const r=abs(box,40,i*gap+(gap-150)/2,784,150,'k-row');const bx=abs(r,0,34,72,72,'k-box');const u=el('u');bx.appendChild(u);const ck=el('span','ck');ck.innerHTML=CHECK;bx.appendChild(ck);abs(r,104,20,680,120,'k-rowtext big',null,txt);return {r,u,ck}});
  rise(c.t0,box,{y:40});rise(c.t0+.2,rows.map(x=>x.r),{y:18,s:.08});const step=Math.max(.35,(c.dur-1)/rows.length);
  rows.forEach((x,i)=>{const t=c.t0+.6+i*step;tl.to(x.u,{opacity:1,duration:.12},t);tl.fromTo(x.ck,{opacity:0,scale:.4},{opacity:1,scale:1,duration:.2,ease:OUT},t+.03);cue(t,'tick',.7)});
};
KITS.video_maker=(k,L,c)=>{const tracks=(L.length?L:['Guion','Ilustración','Voz','Música']).slice(0,4);
  // vista previa: un mini reel vertical con su propio titular, Melodi y subtítulo
  const pv=card(k,232,0,400,430,{overflow:'hidden',background:'radial-gradient(120% 80% at 50% 0%,#1d3557 0%,#0a1220 70%)',border:'0'});
  const glow=abs(pv,60,60,280,280,'k-ring',{color:'#2997ff'});const pm=abs(pv,120,120,160,null,'');pm.appendChild(melodi());
  const ln1=abs(pv,40,40,250,26,'k-pv-line'),ln2=abs(pv,40,80,170,26,'k-pv-line blue');
  const capv=abs(pv,90,340,220,44,'k-pv-cap');const play=abs(pv,170,175,60,60,'k-play');
  const rec=abs(pv,252,18,132,48,'k-rec',null,'● REC');
  const tlbox=card(k,0,452,864,308);const LW=612;const rows=tracks.map((n,i)=>{abs(tlbox,20,24+i*68,206,48,'k-tname',null,n);const lane=abs(tlbox,232,24+i*68,LW,50,'k-tlane');return lane});
  const colors=['linear-gradient(180deg,#7cb8f7,#4f9cf0)','linear-gradient(180deg,#f8cf7e,#f0b347)','linear-gradient(180deg,#3a99f3,#0060c9)','linear-gradient(180deg,#86dcb0,#4fbf88)'];const clips=[];
  rows.forEach((lane,i)=>{const cuts=i===3?[[0,1]]:[[0,.3],[.32,.64],[.66,1]];cuts.forEach(([a,b],j)=>{const cl=el('i','k-clip',{left:(a*LW)+'px',width:((b-a)*LW-6)+'px',background:colors[i%4]});lane.appendChild(cl);clips.push([cl,i,j]);
    if(i===2||i===3){const w=(b-a)*LW-6;const n=Math.floor(w/12);for(let q=0;q<n;q++){const hgt=6+22*Math.abs(Math.sin(q*1.3+j+i));cl.appendChild(el('b','',{position:'absolute',left:(6+q*12)+'px',top:(22-hgt/2)+'px',width:'5px',height:hgt+'px',borderRadius:'3px',background:'rgba(255,255,255,.75)'}))}}})});
  const head=abs(tlbox,232,10,4,288,'k-head');
  rise(c.t0,pv,{y:30,scale:.94});rise(c.t0+.15,tlbox,{y:30});cue(c.t0,'pop',.6);c.speakers.push(pm);
  const build=Math.max(1,c.dur*.5);clips.forEach(([cl,i,j],n)=>{const t=c.t0+.35+n*(build/clips.length);tl.fromTo(cl,{opacity:0,scaleX:.15,transformOrigin:'0% 50%'},{opacity:1,scaleX:1,duration:.22,ease:OUT},t);if(n%2===0)cue(t,'tick',.35)});
  tl.fromTo([ln1,ln2],{scaleX:0,transformOrigin:'0% 50%'},{scaleX:1,duration:.4,stagger:.12,ease:OUT},c.t0+.4);
  tl.fromTo(capv,{opacity:0,y:10},{opacity:1,y:0,duration:.25,ease:OUT},c.t0+.4+build*.6);
  loop(rec,{opacity:1},{opacity:.25},c.t0+.3,c.dur-.4,.5);loop(glow,{scale:.7,opacity:.5},{scale:1.25,opacity:0},c.t0+.4,c.dur-.5,1.1,'power1.out');
  const go=c.t0+.4+build;tl.fromTo(play,{opacity:1,scale:1},{opacity:0,scale:1.6,duration:.25},go);cue(go,'chime',.5);
  tl.fromTo(head,{x:0},{x:LW-4,duration:Math.max(.5,c.t0+c.dur-go-.1),ease:'none'},go);loop(pm,{y:0},{y:-8},go,c.t0+c.dur-go,.5);
};
KITS.logo=(k,L,c)=>{const g=abs(k,82,320,700,130,'k-ground');const m=abs(k,222,0,420,null,'');m.appendChild(melodi());
  const wm=abs(k,0,392,864,268,'k-wm');const inner=wordmark(c.theme.ink,c.dark?'#2997ff':'#0071e3');wm.appendChild(inner);
  const tag=abs(k,0,668,864,60,'k-tagline',{color:c.theme.muted},L[0]||'');
  rise(c.t0+.1,g,{y:0});tl.fromTo(m,{opacity:0,y:30,scale:.8},{opacity:1,y:0,scale:1,duration:.36,ease:OUT},c.t0+.1);cue(c.t0+.1,'pop',.6);
  tl.fromTo(inner,{yPercent:105},{yPercent:0,duration:.42,ease:OUT},c.t0+.45);cue(c.t0+.45,'chime',.9);
  if(L[0])rise(c.t0+.8,tag,{y:14});for(let t=c.t0+1.1;t<c.t0+c.dur-.3;t+=2)blink(t,m);c.speakers.push(m);
};

/* ---------- kits de reserva (marca neutra; todo texto viene de labels) ---------- */
function villaSVG(id,detail){const sky=BR?['#f7e6c8','#d7e7e4']:['#eaf4ff','#d6e8fc'];
 return svg(`<svg viewBox="0 0 864 760" xmlns="http://www.w3.org/2000/svg" class="villa">
 <defs><linearGradient id="${id}s" x2="0" y2="1"><stop stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
 <linearGradient id="${id}sea" x2="0" y2="1"><stop stop-color="#6aa3b8"/><stop offset="1" stop-color="#2f5f78"/></linearGradient>
 <linearGradient id="${id}h" x1="0" x2=".3" y2="1"><stop stop-color="#7d9258"/><stop offset="1" stop-color="#3f4f27"/></linearGradient>
 <linearGradient id="${id}f" x2="0" y2="1"><stop stop-color="#a9b98e"/><stop offset="1" stop-color="#7f9468"/></linearGradient>
 <linearGradient id="${id}p" x2="0" y2="1"><stop stop-color="#9adbe9"/><stop offset="1" stop-color="#48a6c4"/></linearGradient>
 <linearGradient id="${id}w" x2="0" y2="1"><stop stop-color="#fffaf0"/><stop offset="1" stop-color="#eadfca"/></linearGradient>
 <clipPath id="${id}c"><rect width="864" height="760" rx="40"/></clipPath></defs>
 <g clip-path="url(#${id}c)"><g class="v-cam">
 <rect width="864" height="760" fill="url(#${id}s)"/>
 <circle class="v-sun" cx="660" cy="150" r="64" fill="#f6d391" opacity=".9"/><circle cx="660" cy="150" r="110" fill="#f6d391" opacity=".18"/>
 <path d="M0 360 Q120 300 240 330 T470 320 T864 300 V760 H0Z" fill="url(#${id}f)" opacity=".75"/>
 <rect y="400" width="864" height="360" fill="url(#${id}sea)"/>
 <g class="v-waves" stroke="#d9eef4" stroke-width="5" stroke-linecap="round" fill="none" opacity=".75">
  <path d="M-40 452 q30 -10 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0"/>
  <path d="M-10 498 q30 -10 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0"/></g>
 <path d="M150 760 C190 560 300 360 470 300 C610 250 760 330 864 420 V760Z" fill="url(#${id}h)"/>
 <g class="v-pool"><path d="M330 520 h190 a12 12 0 0 1 12 12 v26 a12 12 0 0 1 -12 12 h-190 a12 12 0 0 1 -12 -12 v-26 a12 12 0 0 1 12 -12z" fill="url(#${id}p)"/>
  <path d="M560 470 h110 v40 h-110z M600 510 h90 v36 h-90z" fill="url(#${id}p)" opacity=".95"/>
  <path class="v-shine" d="M350 538 h60 M440 548 h50" stroke="#e8f8fb" stroke-width="5" stroke-linecap="round"/></g>
 ${[[400,380,1.25],[250,470,.9],[640,400,.95]].map(([x,y,k],i)=>`<g class="v-house" transform="translate(${x} ${y}) scale(${k})">
  <rect x="-70" y="0" width="140" height="78" rx="6" fill="url(#${id}w)" stroke="#d8ccb4"/>
  <path d="M-96 6 L0 -62 L96 6 Z" fill="${['#7a5a3a','#8a6a45','#6b4f33'][i]}"/><path d="M-96 6 L0 -62 L96 6" fill="none" stroke="#5a422a" stroke-width="4"/>
  <rect x="-48" y="22" width="34" height="38" rx="4" fill="#3c4a5c" opacity=".75"/><rect x="14" y="22" width="34" height="38" rx="4" fill="#3c4a5c" opacity=".75"/>
  <rect x="-110" y="76" width="220" height="10" rx="5" fill="#5a422a" opacity=".25"/></g>`).join('')}
 ${[[130,560,1],[760,520,.9],[560,330,.65],[300,350,.6]].map(([x,y,k])=>`<g class="v-palm" transform="translate(${x} ${y}) scale(${k})">
  <path d="M0 0 C6 -60 14 -120 4 -190" stroke="#6b4f33" stroke-width="12" fill="none" stroke-linecap="round"/>
  <g transform="translate(4 -190)" fill="#4f6b2f">${[-150,-110,-60,-20,25].map(a=>`<path transform="rotate(${a})" d="M0 0 C40 -14 90 -10 130 18 C88 6 44 8 0 0Z"/>`).join('')}</g></g>`).join('')}
 <g class="v-leaves" fill="#2f3f1f">
  <path d="M-20 760 C40 640 120 600 210 610 C150 650 110 700 100 760Z"/><path d="M884 760 C820 620 740 590 650 610 C720 650 760 700 770 760Z"/>
  <path d="M60 760 C90 690 150 660 230 670 C170 700 140 730 140 760Z" fill="#3e5229"/></g>
 <g transform="translate(720 640)"><path d="M0 120 C2 80 0 40 4 0" stroke="#4f6b2f" stroke-width="6" fill="none"/>
  ${[0,1,2,3,4].map(i=>`<path d="M4 ${-i*18} l24 -10 l-8 18z" fill="#c9364a"/>`).join('')}</g>
 </g></g></svg>`)}
KITS.villa=(k,L,c)=>{const box=abs(k,0,0,864,760,'k-villa');const v=villaSVG(nid('v'));box.appendChild(v);
  const badge=L[0]?abs(k,32,30,null,null,'k-badge',null,L[0]):null;
  tl.fromTo(box,{opacity:0,y:30,scale:.97},{opacity:1,y:0,scale:1,duration:.4,ease:OUT},c.t0);cue(c.t0,'swell',.6);
  tl.fromTo(v.querySelector('.v-cam'),{scale:1.08,transformOrigin:'50% 60%'},{scale:1,duration:Math.max(1,c.dur),ease:'sine.out'},c.t0);
  tl.fromTo(v.querySelectorAll('.v-house'),{opacity:0,y:30},{opacity:1,y:0,duration:.3,ease:OUT,stagger:.12},c.t0+.2);[0,1,2].forEach(i=>cue(c.t0+.2+i*.12,'pop',.4));
  v.querySelectorAll('.v-palm').forEach((p,i)=>{const b=p.getAttribute('transform');loop(p,{rotation:-2,transformOrigin:'50% 100%'},{rotation:2.5},c.t0+i*.15,c.dur,1.4)});
  loop(v.querySelector('.v-waves'),{x:0},{x:-60},c.t0,c.dur,1.6,'sine.inOut');loop(v.querySelector('.v-sun'),{scale:1,transformOrigin:'50% 50%'},{scale:1.08},c.t0,c.dur,1.2);
  loop(v.querySelector('.v-leaves'),{rotation:-1,transformOrigin:'50% 100%'},{rotation:1},c.t0,c.dur,1.8);loop(v.querySelector('.v-shine'),{opacity:.3},{opacity:1},c.t0,c.dur,.7);
  if(badge){rise(c.t0+.35,badge,{y:12,scale:.9});cue(c.t0+.35,'pop',.5)}};
function cursorSVG(){return svg(`<svg viewBox="0 0 48 60" class="k-cursor"><path d="M4 4 L4 46 L16 36 L24 56 L32 52 L24 33 L40 33 Z" fill="#fff" stroke="#2b2b2b" stroke-width="3.5" stroke-linejoin="round"/></svg>`)}
function press(btn,cur,at,x,y){tl.fromTo(cur,{x:x+260,y:y+240,opacity:0},{x,y,opacity:1,duration:.55,ease:'power2.inOut'},at-.6);
  tl.to(btn,{scale:.94,duration:.08,yoyo:true,repeat:1,ease:'power1.inOut'},at);tl.to(cur,{scale:.86,duration:.08,yoyo:true,repeat:1},at);cue(at,'tick',.8)}
KITS.web_button=(k,L,c)=>{const win=card(k,0,0,864,620,{overflow:'hidden'});const bar=abs(win,0,0,864,74,'k-winbar');bar.append(el('i','dot'),el('i','dot'),el('i','dot'));
  const url=abs(bar,120,10,660,54,'k-url');const lock=el('span','lock',null,'🔒︎');url.append(lock);const ut=el('span','ut',null,L[0]||'example.com');url.appendChild(ut);
  const hero=abs(win,0,74,864,546,'k-hero');const mini=villaSVG(nid('m'));mini.setAttribute('preserveAspectRatio','xMidYMid slice');hero.appendChild(mini);
  const shade=abs(hero,0,0,864,546,'k-shade');const ht=L[2]?abs(hero,48,70,768,140,'k-hero-title',null,L[2]):null;
  const btn=abs(hero,152,410,560,96,'k-book k-nowrap',null,L[1]||'Book');const ring=abs(hero,152,410,560,96,'k-ripple');
  const cur=abs(k,0,0,56,70,'');cur.appendChild(cursorSVG());
  rise(c.t0,win,{y:34});cue(c.t0,'pop',.6);tl.fromTo(ut,{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:Math.min(.8,c.dur*.25),ease:'none'},c.t0+.15);cue(c.t0+.2,'type',.5);
  if(ht)rise(c.t0+.3,ht,{y:16});rise(c.t0+.35,btn,{y:16,scale:.9});
  const at=c.t0+Math.max(1,c.dur*.5);press(btn,cur,at,430,470);tl.fromTo(ring,{opacity:.8,scale:1},{opacity:0,scale:1.35,duration:.5,ease:'power2.out'},at);
  tl.to(btn,{boxShadow:`0 0 0 10px rgba(${TINT},.25)`,duration:.2},at+.1)};
function personSVG(small){return `<svg viewBox="0 0 60 80" width="${small?44:58}" height="${small?60:78}"><circle cx="30" cy="20" r="14" fill="${ACC}"/><path d="M6 78 C6 50 18 40 30 40 C42 40 54 50 54 78Z" fill="${ACC}" opacity=".85"/></svg>`}
KITS.date_picker=(k,L,c)=>{const cd=card(k,0,0,864,760,{overflow:'hidden'});const title=abs(cd,40,28,784,60,'k-step',null,L[0]||'');
  const days=[];const x0=40,y0=104,cw=112,ch=66;for(let d=1;d<=35;d++){const col=(d-1)%7,row=Math.floor((d-1)/7);const n=d<=31?d:'';
    const cell=abs(cd,x0+col*cw,y0+row*ch,cw-8,ch-8,'k-day',null,String(n));days.push(cell)}
  const sel=[12,13,14,15,16].map(d=>days[d-1]);
  const g=abs(cd,40,452,784,100,'k-guests');const icons=el('span','icons');icons.innerHTML=personSVG()+personSVG()+personSVG(true);g.append(icons,el('span','gt',null,L[1]||''));
  const btn=abs(cd,40,600,784,110,'k-book',null,L[2]||'');const cur=abs(k,0,0,56,70,'');cur.appendChild(cursorSVG());
  rise(c.t0,cd,{y:30});tl.fromTo(days,{opacity:0},{opacity:1,duration:.2,stagger:.008},c.t0+.1);
  const a=c.t0+Math.max(.5,c.dur*.18),step=Math.max(.08,c.dur*.06);
  sel.forEach((d,i)=>{const end=i===0||i===sel.length-1;tl.to(d,{background:end?ACC:`rgba(${TINT},.16)`,color:end?'#fff':'inherit',borderRadius:end?'33px':'14px',duration:.15},a+i*step);if(end)cue(a+i*step,'tick',.6)});
  tl.fromTo(icons.children,{opacity:0,scale:.4},{opacity:1,scale:1,duration:.22,ease:OUT,stagger:.12},a+sel.length*step+.1);cue(a+sel.length*step+.1,'pop',.5);
  rise(a+sel.length*step+.2,g.querySelector('.gt'),{y:10});press(btn,cur,c.t0+c.dur*.82,430,650)};
function houseIcon(roof){return `<svg viewBox="0 0 120 90" width="120" height="90"><rect x="22" y="38" width="76" height="46" rx="5" fill="#fffaf0" stroke="#d8ccb4" stroke-width="2"/><path d="M8 42 L60 6 L112 42Z" fill="${roof}"/><rect x="40" y="52" width="16" height="20" rx="3" fill="#3c4a5c" opacity=".7"/><rect x="64" y="52" width="16" height="20" rx="3" fill="#3c4a5c" opacity=".7"/></svg>`}
KITS.stay_picker=(k,L,c)=>{const stays=L.slice(0,3).length?L.slice(0,3):['A','B','C'];const btnText=L[3]||'';const roofs=['#7a5a3a','#8a6a45','#6b4f33'];
  const cards=stays.map((txt,i)=>{const r=card(k,0,i*176,864,156,{display:'flex',alignItems:'center',gap:'26px',padding:'0 34px'});
    const ic=el('span','ico');ic.innerHTML=houseIcon(roofs[i%3]);const t=el('span','k-stay',null,txt);const radio=el('span','k-radio');r.append(ic,t,radio);return {r,radio}});
  const btn=abs(k,0,560,864,112,'k-book',null,btnText);const cur=abs(k,0,0,56,70,'');cur.appendChild(cursorSVG());
  rise(c.t0,cards.map(x=>x.r),{y:30,s:.1});cue(c.t0,'pop',.5);const pick=c.t0+Math.max(.6,c.dur*.4);
  tl.to(cards[0].r,{borderColor:ACC,boxShadow:`0 0 0 6px rgba(${TINT},.22)`,scale:1.02,duration:.2},pick);tl.to(cards[0].radio,{background:ACC,borderColor:ACC,duration:.15},pick);
  tl.to(cards.slice(1).map(x=>x.r),{opacity:.55,duration:.2},pick);cue(pick,'tick',.7);
  rise(c.t0+.25,btn,{y:16});tl.fromTo(btn,{opacity:.55},{opacity:1,duration:.2,immediateRender:false},pick+.15);press(btn,cur,c.t0+c.dur*.84,430,600)};
KITS.details_form=(k,L,c)=>{const cd=card(k,0,0,864,760,{overflow:'hidden'});abs(cd,40,30,784,60,'k-step',null,L[0]||'');
  const fields=[L[1],L[2]].filter(Boolean).map((lab,i)=>{const y=118+i*150;abs(cd,40,y,784,40,'k-flabel',null,lab);const box=abs(cd,40,y+46,784,74,'k-input');const fill=abs(box,26,30,300+i*120,14,'k-typed');return fill});
  const note=L[3]?abs(cd,40,430,784,90,'k-note',null,L[3]):null;const btn=abs(cd,40,580,784,116,'k-book',null,L[4]||'');const cur=abs(k,0,0,56,70,'');cur.appendChild(cursorSVG());
  rise(c.t0,cd,{y:30});cue(c.t0,'pop',.5);fields.forEach((f,i)=>{const t=c.t0+.3+i*Math.max(.35,c.dur*.18);tl.fromTo(f,{scaleX:0,transformOrigin:'0 50%'},{scaleX:1,duration:.4,ease:'none'},t);cue(t,'type',.45)});
  if(note)rise(c.t0+c.dur*.45,note,{y:12});press(btn,cur,c.t0+c.dur*.8,430,640)};
KITS.confirmation=(k,L,c)=>{const top=abs(k,0,0,864,250,'k-confirm');const badge=abs(top,40,40,150,150,'k-okbig');badge.innerHTML=`<svg viewBox="0 0 42 42"><path d="M10 22l8 8L33 13" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="40" stroke-dashoffset="40"/></svg>`;
  abs(top,220,58,600,130,'k-ctitle',null,L[0]||'');
  const doc=card(k,0,280,864,280,{overflow:'hidden'});abs(doc,40,30,784,56,'k-doctitle',null,L[1]||'');[0,1,2].forEach(i=>abs(doc,40,104+i*30,i===2?420:700,12,'k-line'));
  const sig=svg(`<svg viewBox="0 0 400 80" class="k-sig"><path d="M10 60 C40 10 60 70 90 40 S140 10 160 50 S220 70 250 30 S320 40 390 45" fill="none" stroke="${GOLD}" stroke-width="5" stroke-linecap="round" stroke-dasharray="520" stroke-dashoffset="520"/></svg>`);
  const sg=abs(doc,420,170,400,80,'');sg.appendChild(sig);
  const opts=[L[2],L[3]].filter(Boolean).map((t,i)=>abs(k,i*444,600,420,110,'k-option',null,t));
  rise(c.t0,top,{y:20});tl.fromTo(badge,{scale:.4,opacity:0},{scale:1,opacity:1,duration:.35,ease:'back.out(1.6)'},c.t0+.05);tl.to(badge.querySelector('path'),{strokeDashoffset:0,duration:.35},c.t0+.25);cue(c.t0+.25,'chime',.8);
  rise(c.t0+.1,doc,{y:30});tl.to(sig.querySelector('path'),{strokeDashoffset:0,duration:Math.max(.6,c.dur*.3),ease:'power1.inOut'},c.t0+.4);cue(c.t0+.4,'type',.4);
  opts.forEach((o,i)=>{const t=c.t0+.2+i*.1;rise(t,o,{y:16,scale:.92});const pick=c.t0+c.dur*(.55+.18*i);tl.to(o,{background:ACC,color:'#fff',duration:.15},pick);if(i)tl.to(opts[0],{background:'#fffdf8',color:'#5a422a',duration:.15},pick);cue(pick,'pop',.45)})};
KITS.brand_logo=(k,L,c)=>{const g=abs(k,132,430,600,120,'k-ground');const box=abs(k,112,0,640,470,'');const img=el('img','k-logo');img.src=c.dark?(BR&&BR.logo_light):(BR&&BR.logo);img.alt='';box.appendChild(img);
  const sweep=abs(box,0,0,640,470,'k-sweep');const line=abs(k,282,500,300,3,'k-goldline');const tag=L[0]?abs(k,0,530,864,80,'k-tag2',null,L[0]):null;const site=L[1]&&!(D.plan.cta||'').toLowerCase().includes(L[1].toLowerCase())?abs(k,132,630,600,92,'k-book k-site',null,L[1]):null;  // no repetir la web si ya está en el cta
  tl.fromTo(box,{opacity:0,scale:.92},{opacity:1,scale:1,duration:.4,ease:OUT},c.t0);cue(c.t0,'chime',.9);rise(c.t0,g,{y:0});
  tl.fromTo(sweep,{xPercent:-120},{xPercent:120,duration:1.1,ease:'power1.inOut'},c.t0+.4);tl.fromTo(line,{scaleX:0},{scaleX:1,duration:.4,ease:OUT},c.t0+.2);
  if(tag)rise(c.t0+.25,tag,{y:14});if(site){rise(c.t0+.4,site,{y:14,scale:.92});cue(c.t0+.4,'pop',.5)}};

/* ---------- fondo vivo para planos tipográficos ---------- */
function ambient(sec,theme,dark,t0,dur){const cols=BR?(dark?[`rgba(${TINT_D},.22)`,'rgba(120,150,90,.2)',`rgba(${TINT_D},.12)`]:[`rgba(${TINT},.12)`,'rgba(201,54,74,.06)','rgba(246,241,231,.8)']):dark?['rgba(41,151,255,.28)','rgba(120,90,255,.18)','rgba(41,151,255,.14)']:['rgba(0,113,227,.12)','rgba(90,170,245,.16)','rgba(214,232,252,.9)'];
  const spots=[[-.15,-.05,.75],[.55,.55,.7],[.1,.75,.5]].map(([x,y,r],i)=>{const d=Math.max(W,H)*r;const s=abs(sec,W*x,H*y,d,d,'amb',{background:`radial-gradient(closest-side,${cols[i]},rgba(0,0,0,0))`});return s});
  spots.forEach((s,i)=>tl.fromTo(s,{x:0,y:0,scale:1},{x:(i%2?-1:1)*W*.08,y:(i?-1:1)*H*.04,scale:1.12,duration:Math.max(.5,dur),ease:'sine.inOut'},t0));
  const dots=abs(sec,0,0,W,H,'amb-dots',{backgroundImage:`radial-gradient(${dark?'rgba(255,255,255,.10)':'rgba(29,29,31,.07)'} 2px,transparent 2.5px)`,backgroundSize:'44px 44px'});
  tl.fromTo(dots,{y:0},{y:-44,duration:Math.max(.5,dur),ease:'none'},t0)}

/* ---------- estilos ---------- */
const css0=`@font-face{font-family:"Brivany";src:url("assets/brivany-runtime/BrivanyEditorial-Light.woff2") format("woff2");font-style:normal;font-weight:300;font-display:block}@font-face{font-family:"Brivany";src:url("assets/brivany-runtime/BrivanyEditorial-Regular.woff2") format("woff2");font-style:normal;font-weight:400;font-display:block}@font-face{font-family:"Brivany";src:url("assets/brivany-runtime/BrivanyEditorial-Medium.woff2") format("woff2");font-style:normal;font-weight:500 900;font-display:block}
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#fbfcfd}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;font-family:Brivany,'Yu Gothic','Malgun Gothic','Microsoft YaHei',sans-serif;color:#1d1d1f}
.shot{position:absolute;inset:0;overflow:hidden;visibility:hidden}
.hd{position:absolute}.kicker{font-size:${PORTRAIT?40:34}px;font-weight:600;letter-spacing:-.5px;margin:0 0 18px}
.headline{margin:0;font-weight:700;letter-spacing:-.04em;line-height:1.04}.headline .wm{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.12em;margin-bottom:-.12em}.headline .wi{display:inline-block}
.amb,.amb-dots{pointer-events:none}.cta{display:inline-block;margin:34px 0 0;padding:${PORTRAIT?'22px 44px':'18px 38px'};border-radius:60px;font-size:${PORTRAIT?44:38}px;font-weight:700;letter-spacing:-.6px}
.body{margin:22px 0 0;font-size:${PORTRAIT?42:36}px;line-height:1.25;font-weight:400;letter-spacing:-.3px}
.kitbox{position:absolute}.kit{position:absolute;left:0;top:0;width:${KW}px;height:${KH}px;transform-origin:0 0}
.melodi,.blob{display:block;width:100%;height:auto;overflow:visible;filter:drop-shadow(0 10px 12px rgba(41,76,103,.18))}
.k-card{border-radius:40px;background:linear-gradient(165deg,#fff 0%,#f1f5f9 100%);border:1.5px solid #d9e3ec;box-shadow:0 34px 64px -28px rgba(37,74,105,.30),0 6px 14px rgba(37,74,105,.06);color:#1d1d1f}
.k-ground{border-radius:50%;background:radial-gradient(closest-side,rgba(143,180,208,.42),rgba(189,216,237,0))}
.k-ring{border-radius:50%;border:4px solid currentColor;color:#5aa9f5;opacity:0}
.k-bubble{padding:24px 32px;border-radius:34px 34px 34px 10px;background:#fff;border:1.5px solid #d9e3ec;font-size:50px;font-weight:600;line-height:1.18;letter-spacing:-.6px;color:#1d1d1f;box-shadow:0 18px 34px -18px rgba(37,74,105,.28)}
.k-wrap{display:flex;flex-wrap:wrap;justify-content:center;align-content:center;gap:22px 18px}
.k-chip{display:inline-grid;place-items:center;height:96px;padding:0 34px;border-radius:48px;font-size:44px;font-weight:600;white-space:nowrap;border:2px solid rgba(127,150,175,.28)}
.k-chip>span{grid-area:1/1}
.k-count{display:flex;align-items:flex-start;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.04em;line-height:1}
.k-count .reel{display:block;overflow:hidden}.k-count .strip{display:block}.k-count b{display:block}.k-count .sep{display:block;margin:0 -.04em}
.k-countword{text-align:center;font-size:110px;font-weight:700;letter-spacing:-5px;line-height:1}
.k-floor{border-radius:50%;background:radial-gradient(closest-side,rgba(143,180,208,.42),rgba(189,216,237,0))}
.k-tag{display:inline-flex;align-items:center;height:54px;padding:0 22px;border-radius:27px;font-size:30px;font-weight:600;white-space:nowrap}
.k-tag-light{background:#fff;border:1.5px solid #d9e3ec;color:#60758a}
.k-subs p{position:absolute;left:0;right:0;bottom:0;margin:0;padding:18px 24px;border-radius:24px;font-size:38px;line-height:1.18;font-weight:600;letter-spacing:-.6px}
.k-subs .orig{background:#fff;color:#56687a;border:1.5px solid #d9e3ec}.k-subs .tr{background:#1d1d1f;color:#fff}
.k-track{border-radius:7px;background:rgba(29,29,31,.10);overflow:hidden}.k-track i{display:block;width:100%;height:100%;border-radius:7px;background:linear-gradient(90deg,#3a99f3,#0060c9);transform-origin:0 50%}
.k-lane{display:flex;align-items:center;gap:14px;font-size:36px;font-weight:700;letter-spacing:-1px}
.k-pill{display:inline-flex;align-items:center;height:48px;padding:0 20px;border-radius:24px;font-size:28px;font-weight:600}.k-pill.grey{background:#eef2f6;color:#60758a}.k-pill.blue{background:#d6e8fc;color:#0058b3}
.k-seg{position:absolute;top:6px;height:28px;border-radius:14px;background:rgba(127,150,175,.35)}
.k-head{border-radius:3px;background:#0071e3;box-shadow:0 0 0 7px rgba(0,113,227,.14)}
.k-status{font-size:36px;font-weight:700;letter-spacing:-.8px;color:#1d1d1f}.k-status-box{border-radius:28px;background:#f3f7fb;border:1.5px solid #d9e3ec}.k-route{display:flex;align-items:center;gap:18px;font-size:40px;color:#60758a}
.k-ok{border-radius:50%;background:#0071e3;display:grid;place-items:center;opacity:0}.k-ok svg{width:60%;height:60%}
.k-name{font-size:30px;font-weight:700;color:#60758a}.k-line{font-size:44px;line-height:1.14;font-weight:700;letter-spacing:-1.4px;color:#1d1d1f}
.k-active{border:7px solid;opacity:0;border-radius:40px;pointer-events:none}
.k-winbar{display:flex;align-items:center;gap:12px;padding:0 28px;border-bottom:1.5px solid #d9e3ec;font-size:34px;font-weight:600}
.k-winbar .dot{width:16px;height:16px;border-radius:8px;background:#d5dee7;flex:0 0 16px}.k-winbar .title{margin-left:12px;flex:1}.k-winbar .live{color:#0071e3;font-size:34px}
.k-chathead .mini,.k-phead .mini{width:72px;height:72px;flex:0 0 72px;padding:14px 6px 0;border-radius:50%;background:#dcebfc}
.k-tile{border-radius:22px;overflow:hidden}.k-nametag{height:44px;padding:0 16px;border-radius:22px;background:rgba(255,255,255,.92);display:flex;align-items:center;font-size:26px;font-weight:600;white-space:nowrap}
.k-phead{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:700}.k-phead small{font-weight:400;color:#60758a;font-size:30px}
.k-orig{font-size:30px;color:#60758a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.k-utt{font-size:50px;line-height:1.12;font-weight:700;letter-spacing:-1.8px}
.k-msg{padding:20px 28px;border-radius:30px;font-size:38px;line-height:1.2;font-weight:600;letter-spacing:-.6px}.k-msg.me{background:#0071e3;color:#fff;border-bottom-right-radius:8px}.k-msg.mel{background:#eaf2fb;border:1.5px solid #cfe0f2;border-bottom-left-radius:8px}
.k-typing{display:flex;align-items:center;justify-content:center;gap:10px;border-radius:32px;background:#eef3f8;opacity:0}.k-typing i{width:14px;height:14px;border-radius:7px;background:#8aa1b8}
.k-orb{border-radius:50%;background:radial-gradient(closest-side,#e9f3fe 0%,#cfe3fb 62%,rgba(207,227,251,0) 100%)}
.k-livepill{display:flex;align-items:center;justify-content:center;border-radius:30px;background:#0071e3;color:#fff;font-size:36px;font-weight:700}
.k-caption-in{text-align:center;font-size:44px;line-height:1.16;font-weight:700;letter-spacing:-1.2px}
.k-links{position:absolute;left:0;top:0;overflow:visible}
.k-task{font-size:30px;line-height:1.16;font-weight:700;letter-spacing:-.6px;text-align:center;color:#1d1d1f}
.k-fold{border-radius:0 40px 0 22px;background:linear-gradient(225deg,#fbfcfd 49%,#c9d9ea 50%,#eef4fa 100%)}
.k-kicker{font-size:34px;color:#60758a}.k-h3{font-size:62px;font-weight:700;letter-spacing:-2.4px}.k-rule{background:#d9e3ec}
.k-box{border-radius:20px;border:3px solid #c7d4e1;background:#fff}.k-box u{position:absolute;inset:-3px;border-radius:20px;background:#0071e3;opacity:0}.k-box .ck{position:absolute;inset:12px;opacity:0}.k-box .ck svg{width:100%;height:100%}
.k-rowtext{font-size:44px;line-height:1.14;font-weight:600;letter-spacing:-1.4px;color:#1d1d1f}.k-rowtext.big{font-size:54px;font-weight:700;letter-spacing:-2px}
.k-side{background:#f1f5f9;border-right:1.5px solid #d9e3ec}.k-ico{border-radius:14px;background:#dfe7ef}.k-ico.on{background:#0071e3}
.k-panel{border-radius:26px;background:#fff;border:1.5px solid #d9e3ec;box-shadow:0 18px 30px -20px rgba(37,74,105,.25)}.k-ptitle{font-size:30px;font-weight:700;letter-spacing:-.6px}
.k-mini-msg{border-radius:20px;background:#eef3f8}.k-mini-msg.me{background:#0071e3}.k-mini-box{border-radius:12px;background:#0071e3}.k-mini-line{border-radius:8px;background:#dfe7ef}
.k-pv-line{border-radius:13px;background:rgba(255,255,255,.9)}.k-pv-cap{border-radius:22px;background:rgba(255,255,255,.16);border:2px solid rgba(255,255,255,.35)}.k-rec{display:flex;align-items:center;justify-content:center;border-radius:17px;background:rgba(255,80,80,.18);color:#ff8a8a;font-size:32px;font-weight:700}.k-pv-line.blue{background:#2997ff}.k-play{border-radius:50%;background:rgba(255,255,255,.92)}
.k-tname{font-size:34px;font-weight:700;letter-spacing:-.6px;display:flex;align-items:center;white-space:nowrap}.k-tlane{border-radius:14px;background:#eef3f8}.k-clip{position:absolute;top:3px;height:44px;border-radius:12px;overflow:hidden;box-shadow:inset 0 -2px 0 rgba(0,0,0,.08)}
.k-wm svg{display:block;width:100%;height:100%;overflow:visible}.k-wm{overflow:hidden}.k-tagline{text-align:center;font-size:44px;letter-spacing:-.6px}
#brand{position:absolute;z-index:40}#brand svg{display:block;width:100%;height:100%;overflow:visible}
.cover{position:absolute;inset:0;z-index:50}
#captions{position:absolute;z-index:60;left:0;right:0;display:flex;justify-content:center;pointer-events:none}
.cap{position:absolute;max-width:${PORTRAIT?860:1400}px;padding:${PORTRAIT?'16px 30px':'12px 28px'};border-radius:26px;background:rgba(10,14,22,.86);color:#fff;font-size:${PORTRAIT?54:46}px;line-height:1.16;font-weight:700;letter-spacing:-1px;text-align:center;visibility:hidden}
.cap span{display:inline-block;opacity:.62}`;
const css=(BR?`@font-face{font-family:BrandHead;src:url('${BR.fonts.head.normal}');font-weight:300 700}
@font-face{font-family:BrandHead;src:url('${BR.fonts.head.italic}');font-style:italic;font-weight:300 700}
@font-face{font-family:BrandBody;src:url('${BR.fonts.body.normal}');font-weight:100 900}`:'')+css0.split('#0071e3').join('var(--acc)').split('linear-gradient(180deg,#3a99f3,#0060c9)').join('var(--accg)').split('linear-gradient(90deg,#3a99f3,#0060c9)').join('var(--accg)')
 +`#root{--acc:${ACC};--accg:${ACCG}}`
 +(BR?`#root{font-family:BrandBody,sans-serif}.headline{font-family:BrandHead,serif;font-weight:${BR.ui.headline_weight};font-style:${BR.ui.headline_style};letter-spacing:-.01em;line-height:1.02}
 .kicker{text-transform:uppercase;letter-spacing:.16em;font-size:${PORTRAIT?32:26}px;font-weight:600}.body{font-family:BrandBody}.cta{font-family:BrandBody;font-weight:600;letter-spacing:.06em}
 .cap{background:${BR.ui.caption_bg};font-family:BrandBody;font-weight:600;letter-spacing:-.2px}
 .k-card{background:linear-gradient(165deg,#fffdf8 0%,#f3ece0 100%);border-color:#e2d6c0;box-shadow:0 34px 64px -28px rgba(90,66,42,.32),0 6px 14px rgba(90,66,42,.06);color:#5a422a}
 .k-step,.k-ctitle,.k-doctitle,.k-stay,.k-hero-title,.k-tag2{font-family:BrandHead,serif}.k-book,.k-badge,.k-option{font-family:BrandBody}`:'')
 +`.villa{display:block;width:100%;height:100%}.k-villa{border-radius:40px;overflow:hidden;box-shadow:0 34px 64px -28px rgba(60,50,30,.35)}
 .k-badge{padding:14px 26px;border-radius:30px;background:rgba(255,253,248,.92);color:#5a422a;font-size:32px;font-weight:600;letter-spacing:.04em}
 .k-cursor{width:56px;height:70px;filter:drop-shadow(0 6px 8px rgba(0,0,0,.25))}
 .k-url{display:flex;align-items:center;gap:12px;padding:0 22px;border-radius:23px;background:rgba(0,0,0,.05);font-size:33px;font-weight:500;color:#5a422a}.k-url .lock{font-size:30px;opacity:.6}
 .k-hero{overflow:hidden}.k-hero .villa{position:absolute;inset:0;width:100%;height:100%}.k-shade{background:linear-gradient(180deg,rgba(30,24,16,.55) 0%,rgba(30,24,16,.08) 42%,rgba(30,24,16,.12) 62%,rgba(30,24,16,.5) 100%)}.k-nowrap{white-space:nowrap;font-size:36px}
 .k-hero-title{color:#fffaf0;font-size:64px;font-style:italic;line-height:1.05;text-shadow:0 4px 18px rgba(0,0,0,.35)}
 .k-book{display:flex;align-items:center;justify-content:center;border-radius:60px;background:var(--acc);color:#fff;font-size:40px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;box-shadow:0 18px 30px -16px rgba(0,0,0,.45)}
 .k-ripple{border-radius:60px;border:4px solid var(--acc);opacity:0}
 .k-step{font-size:54px;font-weight:600;color:inherit}.k-day{display:flex;align-items:center;justify-content:center;border-radius:14px;font-size:34px;font-weight:500;color:#5a422a}
 .k-guests{display:flex;align-items:center;gap:26px;padding:0 26px;border-radius:26px;background:rgba(0,0,0,.035)}.k-guests .icons{display:flex;align-items:flex-end;gap:6px}.k-guests .gt{font-size:40px;font-weight:600}
 .k-stay{flex:1;font-size:50px;font-weight:600;line-height:1.05}.k-radio{width:46px;height:46px;border-radius:50%;border:4px solid #cbbfa8}
 .k-flabel{font-size:32px;font-weight:600;opacity:.8}.k-input{border-radius:20px;background:#fff;border:2px solid #e2d6c0}.k-typed{border-radius:7px;background:repeating-linear-gradient(90deg,#8b7660 0 22px,transparent 22px 30px)}
 .k-note{display:flex;align-items:center;padding:0 30px;border-radius:24px;background:rgba(${TINT},.1);font-size:36px;font-weight:600;line-height:1.15}
 .k-confirm{display:block}.k-okbig{border-radius:50%;background:var(--acc);display:grid;place-items:center}.k-okbig svg{width:62%;height:62%}
 .k-ctitle{display:flex;align-items:center;font-size:64px;font-weight:600;line-height:1.02}.k-doctitle{font-size:48px;font-weight:600}.k-line{border-radius:6px;background:rgba(90,66,42,.15)}.k-sig{width:100%;height:100%}
 .k-option{display:flex;align-items:center;justify-content:center;text-align:center;padding:0 20px;border-radius:30px;background:#fffdf8;border:3px solid var(--acc);color:#5a422a;font-size:38px;font-weight:600;line-height:1.1}
 .k-logo{width:100%;height:100%;object-fit:contain}.k-sweep{background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.55) 50%,transparent 70%);mix-blend-mode:soft-light}
 .k-site{text-transform:none;letter-spacing:.02em;font-size:38px}.k-goldline{background:${GOLD};transform-origin:50% 50%}.k-tag2{text-align:center;font-size:52px;font-style:italic;font-weight:500}
 .brand-logo{width:100%;height:100%;object-fit:contain;object-position:left center}`;
document.head.appendChild(el('style',null,null,css));

/* ---------- composición ---------- */
const root=document.getElementById('root');
const shots=D.plan.shots,times=D.timing;
const CAP_TOP=PORTRAIT?H-S.bottom-130:H-S.bottom-100;let shotHasKit=false;
const layoutBoxes=(layout)=>{
  if(PORTRAIT){const top=S.top+76+(BR?50:0),bottom=CAP_TOP-18;const x=S.left+10,w=W-S.left-S.right-20;
    // vertical: titular arriba, ilustración a todo el ancho seguro y alto restante, subtítulos al pie
    const kit={x:S.left,y:top+250,w:W-S.left-S.right,h:bottom-top-250};
    if(layout==='statement')return {head:{x,y:top+10,w,max:360,size:118},kit,nobody:true};
    if(layout==='end')return {head:{x,y:top+10,w,max:300,size:92,center:true},kit,nobody:true};
    return {head:{x,y:top+10,w,max:300,size:100},kit,nobody:true}}
  const left=S.left+20,top=S.top+60,bottom=CAP_TOP-20;
  if(layout==='statement')return shotHasKit?{head:{x:left+40,y:top+90,w:820,max:620,size:104,vcenter:[top+10,bottom]},kit:{x:960,y:top+10,w:W-960-S.right+40,h:bottom-top}}:{head:{x:left+60,y:top+120,w:W-2*left-120,max:470,size:132,center:true,vcenter:[top+10,bottom]},kit:{x:0,y:0,w:1,h:1}};
  if(layout==='end')return {head:{x:left+10,y:top+120,w:760,max:640,size:96,vcenter:[top+20,bottom]},kit:{x:900,y:top+10,w:W-900-S.right+40,h:bottom-top}};
  return {head:{x:left+10,y:top+120,w:740,max:640,size:96,vcenter:[top+20,bottom]},kit:{x:900,y:top+10,w:W-900-S.right+40,h:bottom-top}}};

function headline(parent,text,accent,theme){const h=el('h1','headline',{color:theme.ink});let a=-1,b=-1;if(accent){a=text.indexOf(accent);b=a+accent.length}
  let pos=0;const words=[];text.split(/(\s+)/).forEach(p=>{if(!p)return;const start=pos;pos+=p.length;if(/^\s+$/.test(p)){h.append(' ');return}
    const m=el('span','wm');const i=el('span','wi',start>=a&&start<b&&a>=0?{color:theme.accent}:null,p);m.appendChild(i);h.appendChild(m);words.push(i)});
  parent.appendChild(h);return {h,words}}

const brand=BR?abs(root,PORTRAIT?S.left+6:S.left,PORTRAIT?S.top-6:S.top-40,PORTRAIT?150:130,PORTRAIT?110:96,''):abs(root,PORTRAIT?S.left+18:S.left,PORTRAIT?S.top+6:S.top-30,PORTRAIT?190:170,PORTRAIT?59:53,'');brand.id='brand';
const sections=[];
shots.forEach((shot,i)=>{const t0=times[i].start,dur=times[i].duration;const theme=THEMES[shot.theme],dark=shot.theme==='night'||shot.theme==='blue';
  const sec=el('section','shot',{background:theme.bg,color:theme.ink});sec.id='shot-'+shot.id;root.appendChild(sec);sections.push(sec);
  shotHasKit=shot.kit!=='none';const box=layoutBoxes(shot.layout);
  if(PORTRAIT||shot.layout==='statement'||shot.layout==='end')ambient(sec,theme,dark,t0,dur);const hd=abs(sec,box.head.x,box.head.y,box.head.w,null,'hd',{textAlign:box.head.center?'center':'left'});
  let kick=null;if(shot.kicker){kick=el('p','kicker',{color:theme.accent},shot.kicker);hd.appendChild(kick)}
  const cover=D.cover&&shot.id===D.plan.publish.cover_shot;
  const {h,words}=headline(hd,cover?D.plan.publish.cover_title:shot.headline,cover&&D.plan.publish.cover_title.indexOf(shot.accent)<0?'':shot.accent,theme);
  let size=box.head.size;h.style.fontSize=size+'px';let body=null;
  if(shot.body&&!cover&&!box.nobody){body=el('p','body',{color:theme.muted},shot.body);hd.appendChild(body)}
  while(hd.offsetHeight>box.head.max&&size>44){size-=4;h.style.fontSize=size+'px'}
  if(box.head.vcenter){const [a,b]=box.head.vcenter;hd.style.top=Math.max(a,(a+b)/2-hd.offsetHeight/2)+'px'}
  if(shot.layout==='end'&&D.plan.cta){const cta=el('p','cta',{background:dark?'#ffffff':ACC,color:dark?(BR?'#2f3a22':'#0b1626'):'#ffffff'},D.plan.cta);hd.appendChild(cta);tl.fromTo(cta,{opacity:0,y:18,scale:.92},{opacity:1,y:0,scale:1,duration:.34,ease:OUT},t0+.9);cue(t0+.9,'pop',.6)}
  const kitName=shot.kit;const ctx={tl,t0,dur,theme,dark,speakers:[]};
  if(kitName!=='none'&&KITS[kitName]){const kb=box.kit;const stacked=PORTRAIT;const top=stacked?Math.max(kb.y,hd.offsetTop+hd.offsetHeight+30):kb.y;const kh=kb.y+kb.h-top;
    const scale=Math.min(kb.w/KW,kh/KH);const ky=top+(kh-KH*scale)/2;
    if(PORTRAIT){const stage=abs(sec,24,ky+KH*scale*.18,W-48,H-ky-KH*scale*.18+60,'stage',{background:dark?`linear-gradient(180deg,rgba(${TINT_D},.16),rgba(${TINT_D},.02))`:`linear-gradient(180deg,rgba(${TINT},.09),rgba(${TINT},.015))`,borderRadius:'64px'});
      tl.fromTo(stage,{opacity:0,y:60},{opacity:1,y:0,duration:.4,ease:OUT},t0)}
    const wrap=abs(sec,kb.x+(kb.w-KW*scale)/2,ky,KW*scale,KH*scale,'kitbox');
    const k=el('div','kit',{transform:`scale(${scale})`});wrap.appendChild(k);const kctx={...ctx,lang:shot.label_langs||[]};
    if(i===0){// gancho: la ilustración ya está medio segundo avanzada en el fotograma 0 (imagen fuerte en el feed) y sigue moviéndose
      const LEAD=.55,main=tl,mainCue=cue,sub=gsap.timeline({paused:true});tl=sub;cue=(t,type,g)=>mainCue(t0+t-LEAD,type,g);
      try{KITS[kitName](k,shot.labels,{...kctx,t0:0,dur:dur+LEAD})}finally{tl=main;cue=mainCue}
      sub.to({},{duration:.001},dur+LEAD);main.add(sub.tweenFromTo(LEAD,dur+LEAD,{ease:'none'}),t0)}
    else KITS[kitName](k,shot.labels,kctx);
    if(i===0){// gancho: la ilustración entra con fuerza en el primer fotograma
      tl.fromTo(wrap,{scale:1.2,opacity:.45,rotation:-2},{scale:1,opacity:1,rotation:0,duration:.5,ease:'expo.out',transformOrigin:'50% 50%'},t0);cue(t0+.02,'swell',.7);
      const rays=abs(sec,W/2-H*.6,ky+KH*scale/2-H*.6,H*1.2,H*1.2,'rays',{background:`repeating-conic-gradient(${dark?`rgba(${TINT_D},.10)`:`rgba(${TINT},.06)`} 0 6deg,transparent 6deg 18deg)`,borderRadius:'50%'});
      sec.insertBefore(rays,wrap);tl.fromTo(rays,{rotation:0,opacity:0},{rotation:40,opacity:1,duration:Math.max(1,dur),ease:'none'},t0)}}
  // titular por palabras con máscara
  if(kick)rise(t0+.02,kick,{y:16,d:.26});
  tl.fromTo(words,{yPercent:118},{yPercent:0,duration:.36,ease:OUT,stagger:Math.min(.06,.9/Math.max(1,words.length))},t0+.06);
  if(body)rise(t0+.3+words.length*.04,body,{y:16,d:.3});
  // Melodi habla con su voz
  const spoken=D.words.filter(w=>w.shot===i);ctx.speakers.forEach(sp=>spoken.forEach(w=>talk(sp,w.start,Math.min(w.end,t0+dur))));
  // visibilidad y transición
  if(i>0)tl.set(sec,{visibility:'visible'},t0);else tl.set(sec,{visibility:'visible'},0);
  if(i<shots.length-1)tl.set(sec,{visibility:'hidden'},t0+dur+(shots[i+1].transition==='wipe'?0:.0001));
  if(i>0){const tr=shot.transition;
    if(tr==='push'){tl.fromTo(sec,{yPercent:6,opacity:0},{yPercent:0,opacity:1,duration:.34,ease:OUT},t0);const prev=sections[i-1];tl.to(prev,{yPercent:-4,opacity:.0,duration:.2,ease:'power2.in'},t0-.2);tl.set(prev,{yPercent:0,opacity:1},t0+.01);cue(t0-.18,'whoosh',.55)}
    else if(tr==='wipe'){const a=abs(root,0,0,W,H,'cover',{background:BR?(dark?'#2f3a22':'#e1d6c1'):dark?'#0b1626':'#d6e8fc',transform:`translateX(${-W}px)`}),b=abs(root,0,0,W,H,'cover',{background:theme.bg,transform:`translateX(${-W}px)`});
      tl.fromTo(a,{x:-W},{x:W,duration:.54,ease:IO},t0-.27);tl.fromTo(b,{x:-W},{x:W,duration:.54,ease:IO},t0-.22);cue(t0-.3,'whoosh',.8)}
    else cue(t0,'tick',.3)}
  // color de la marca según el fondo
  tl.set(brand,{opacity:shot.layout==='end'?0:1},t0);brand.dataset['c'+i]=dark?'1':'0';
});
// marca: un wordmark claro y otro oscuro alternados por plano
const bd=el('div','',{position:'absolute',inset:0}),bl=el('div','',{position:'absolute',inset:0});
if(BR){const a=el('img','brand-logo');a.src=BR.logo;a.alt='';const b=el('img','brand-logo');b.src=BR.logo_light;b.alt='';bd.appendChild(a);bl.appendChild(b)}
else{bd.appendChild(wordmark('#1d1d1f','#0071e3'));bl.appendChild(wordmark('#ffffff','#2997ff'))}brand.append(bd,bl);
shots.forEach((s,i)=>{const dark=s.theme==='night'||s.theme==='blue';tl.set(bd,{opacity:dark?0:1},times[i].start);tl.set(bl,{opacity:dark?1:0},times[i].start)});
const firstEnd=shots.length-1;
/* ---------- subtítulos ---------- */
const capLayer=abs(root,0,CAP_TOP,W,10,'');capLayer.id='captions';
if(!D.cover)D.captions.forEach(cp=>{const c=el('div','cap');c.style.top='0px';const spans=cp.words.map(w=>{const s=el('span',null,null,w.w);c.appendChild(s);c.append(' ');return [s,w]});capLayer.appendChild(c);
  c.style.left='50%';c.style.transform='translateX(-50%)';c.style.width='max-content';
  tl.set(c,{visibility:'visible'},cp.start);tl.set(c,{visibility:'hidden'},cp.end);
  spans.forEach(([s,w])=>{tl.set(s,{opacity:1,color:'#ffffff'},w.start);});
  if(spans.length){tl.set(spans[0][0],{color:CAP_HI},spans[0][1].start);spans.forEach(([s,w],j)=>{if(j)tl.set(spans[j-1][0],{color:'#ffffff'},w.start);tl.set(s,{color:CAP_HI},w.start)})}});
tl.to({},{duration:.001},D.total-.001);
window.__timelines.main=tl;window.__sfx=sfx.sort((a,b)=>a.t-b.t);window.__socialReady=true;
};
