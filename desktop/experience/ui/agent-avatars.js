// Local DOM adapter for Blobatar 2.7.0's pinned adapter interface.
// Inline SVG and restrained CSS motion; no React, canvas, tracking or frame loop.
import {_parts} from 'blobatar/internal';
import {idle,thinking,happy,sad,sleepy,unsure} from 'blobatar/expression';

export const BLOBATAR_VERSION='2.7.0';
const active=new Set(['planning','running','reviewing']);
const hues=new Map(Object.entries({image:325,research:215,terminal:150,desktop:45,model:265,
 document:185,personal:15,edits:305,motion:280,media:345,support:120,skill:85,schedule:35,discovery:235}));
const value=text=>typeof text==='string'?text.slice(0,512):'';
function hash(text){let result=2166136261;for(const char of text){result^=char.codePointAt(0);result=Math.imul(result,16777619)}return result>>>0}
export function identity(job={}){
 // Appearance belongs to a function, never to a task, retry or conversation.
 const kind=value(job.kind)||'agent';
 return 'brivany:agent:v1:'+kind+':preview:'+kind;
}
export function profile(job={}){
 const seed=identity(job),code=hash(seed),kind=value(job.kind)||'agent';
 return {seed,hue:((hues.get(kind)??code%360)+(code%25)-12+360)%360};
}
function expression(state){
 if(active.has(state))return thinking;
 if(state==='succeeded')return happy;
 if(state==='failed')return sad;
 if(state==='cancelled'||state==='interrupted')return sleepy;
 if(['awaiting_approval','awaiting_user','waiting_for_user'].includes(state))return unsure;
 return idle;
}

export function companionParts(seed,hue,state,id){
 const code=hash(seed),round=23+code%7,tilt=(code%5)-2,done=state==='succeeded',sad=state==='failed',waiting=['awaiting_approval','awaiting_user','waiting_for_user'].includes(state);
 const eyes=done?'<path d="M30 51q5-7 10 0m20 0q5-7 10 0" fill="none" stroke="#29353b" stroke-width="4" stroke-linecap="round"/>':`<ellipse cx="35" cy="51" rx="${waiting?4:3.8}" ry="${sad?3:5.1}" fill="#29353b"/><ellipse cx="65" cy="${51+tilt*.35}" rx="3.8" ry="5.1" fill="#29353b"/>`;
 return {cls:'mo-root mo-breathe companion-root',vars:{},inner:`<defs><radialGradient id="${id}" cx="32%" cy="15%" r="90%"><stop offset="0" stop-color="hsl(${hue} 50% 91%)"/><stop offset=".55" stop-color="hsl(${hue} 48% 77%)"/><stop offset="1" stop-color="hsl(${hue} 32% 55%)"/></radialGradient><radialGradient id="${id}-shine"><stop stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><ellipse cx="50" cy="87" rx="29" ry="5" fill="#000" opacity=".18"/><g class="mo-bob"><g><ellipse cx="9" cy="64" rx="5" ry="6.5" fill="url(#${id})"/><ellipse cx="91" cy="61" rx="5" ry="6.5" fill="url(#${id})"/><rect x="13" y="22" width="74" height="62" rx="${round}" fill="url(#${id})"/><ellipse cx="39" cy="31" rx="24" ry="9" fill="url(#${id}-shine)"/><g class="companion-eyes mo-eyes">${eyes}</g><circle cx="28" cy="62" r="6" fill="#ef96a4" opacity=".18"/><circle cx="72" cy="62" r="6" fill="#ef96a4" opacity=".18"/>${done?'<path d="M44 64q6 5 12 0" fill="none" stroke="#47545b" stroke-width="2.3" stroke-linecap="round"/>':''}</g></g>`};
}

function figure(root,markup){
 // The app blocks parser-applied style attributes. Preserve the pinned
 // generator's eye origins through CSSOM, as with the outer pose variables.
 const rules=[];
 root.innerHTML=markup.replace(/\sstyle="([^"]*)"/g,(_,rule)=>' data-avatar-style="'+(rules.push(rule)-1)+'"');
 for(const node of root.querySelectorAll('[data-avatar-style]')){
  const rule=rules[Number(node.getAttribute('data-avatar-style'))];node.removeAttribute('data-avatar-style');
  for(const entry of rule.split(';')){
   const colon=entry.indexOf(':'),key=entry.slice(0,colon).trim(),value=entry.slice(colon+1).trim();
   if(!['--mo-wrap','--mo-lean','transform-origin'].includes(key))throw Error('Blobatar eye-style contract changed.');
   node.style.setProperty(key,value);
  }
 }
}

export function createAvatarService(doc){
 const win=doc.defaultView,records=new Map(),reduced=win.matchMedia('(prefers-reduced-motion: reduce)');
 const svgNode=name=>doc.createElementNS('http://www.w3.org/2000/svg',name);
 let disposed=false,serial=0;
 function motion(record){
  const allowed=!doc.hidden&&!reduced.matches&&doc.body?.dataset.motion!=='false';
  record.host.dataset.avatarMotion=allowed&&record.visible&&(active.has(record.state)||record.engaged)?'running':'paused';
 }
 const refresh=()=>{for(const record of records.values())motion(record)};
 const observer=new win.IntersectionObserver(entries=>{
  for(const entry of entries){const record=records.get(entry.target);if(record){record.visible=entry.isIntersecting;motion(record)}}
 },{threshold:0.01});
 const preferences=new win.MutationObserver(refresh);
 if(doc.body)preferences.observe(doc.body,{attributes:true,attributeFilter:['data-motion']});
 doc.addEventListener('visibilitychange',refresh);reduced.addEventListener('change',refresh);
 function dispose(host){
  const record=records.get(host);if(!record)return;
  observer.unobserve(host);
  for(const [target,event,listener] of record.listeners)target.removeEventListener(event,listener);
  record.svg.remove();records.delete(host);delete host.dataset.agentAvatar;delete host.dataset.avatarMotion;delete host.dataset.agentState;
 }
 function render(host,job){
  if(disposed||!host)return;
  const chosen=profile(job),style=host.dataset.avatarStyle==='companion'?'companion':'blobatar';let record=records.get(host);
  if(record&&(record.seed!==chosen.seed||record.style!==style)){dispose(host);record=null;}
  if(!record){
   const svg=svgNode('svg'),root=svgNode('g');
   svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
   svg.setAttribute('width','32');svg.setAttribute('height','32');svg.append(root);host.prepend(svg);
   record={host,svg,root,seed:chosen.seed,hue:chosen.hue,style,uid:'companion-'+(++serial),state:null,vars:[],inner:null,visible:false,engaged:false,listeners:[]};
   const code=hash(chosen.seed);
   svg.style.setProperty('--briva-float-duration',(8+code%31/10)+'s');
   svg.style.setProperty('--briva-float-phase',(-code%8000/1000)+'s');
   svg.style.setProperty('--briva-blink-duration',(5.4+code%19/10)+'s');
   svg.style.setProperty('--briva-blink-phase',(-code%4700/1000)+'s');
   const target=host.closest('button')||host;
   for(const [event,engaged] of [['mouseenter',true],['mouseleave',false],['focusin',true],['focusout',false]]){
    const listener=()=>{record.engaged=engaged;motion(record)};target.addEventListener(event,listener);record.listeners.push([target,event,listener]);
   }
   records.set(host,record);host.dataset.agentAvatar=String(hash(chosen.seed));observer.observe(host);
  }
  const state=value(job.state)||'queued';
  if(record.state!==state){
   const parts=style==='companion'?companionParts(record.seed,record.hue,state,record.uid):_parts(record.seed,{background:false,hue:record.hue,normalize:false,animate:'always',expression:expression(state)});
   record.root.setAttribute('class',parts.cls||'');
   // Retain the figure on state changes so CSS motion does not restart each poll.
   if(record.inner!==parts.inner){figure(record.root,parts.inner);record.inner=parts.inner;}
   for(const key of record.vars)record.svg.style.removeProperty(key);
   for(const [key,item] of Object.entries(parts.vars||{}))record.svg.style.setProperty(key,item);
   record.vars=Object.keys(parts.vars||{});record.state=state;
  }
  host.dataset.agentState=state;motion(record);
 }
 function close(){
  disposed=true;for(const host of [...records.keys()])dispose(host);
  observer.disconnect();preferences.disconnect();doc.removeEventListener('visibilitychange',refresh);reduced.removeEventListener('change',refresh);
 }
 win.addEventListener('pagehide',close,{once:true});
 return {render,dispose,close,version:BLOBATAR_VERSION,count:()=>records.size};
}

if(typeof window!=='undefined'&&typeof document!=='undefined')window.BrivanyAgentAvatars=createAvatarService(document);
