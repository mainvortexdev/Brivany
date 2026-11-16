/* Vetsa Live's turn contract, adapted to Muse's cumulative, identified segments.
 * Stable segments are not complete user turns. Repeated text never adds delay.
 * No device access, network, transcript persistence or provider-specific timers.
 */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.BrivanyLiveTurns=value;})(typeof window==='object'?window:globalThis,()=>{
 'use strict';
 const clean=text=>String(text||'').replace(/\s+/g,' ').trim();
 const CUE_TEXT={aja:'Ajá.',entiendo:'Entiendo.',bien:'Bien.',claro:'Claro.',ya_veo:'Ya veo.',te_escucho:'Te escucho.',continua:'Continúa.',te_sigo:'Te sigo.',ya_entiendo:'Ya entiendo.',mmm:'Mmm.',si:'Sí.',cuentame:'Cuéntame.',adelante:'Adelante.',aqui_estoy:'Aquí estoy.',sigo_aqui:'Sigo aquí.',de_acuerdo:'De acuerdo.'};
 const normal=text=>clean(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,'');
 function stripCueEcho(text,key){const phrase=CUE_TEXT[key];if(!phrase)return text;const words=clean(text).split(' '),size=clean(phrase).split(' ').length;return normal(words.slice(-size).join(' '))===normal(phrase)?words.slice(0,-size).join(' '):text;}
 function incompleteUtterance(text=''){
  if(/[?!]\s*$/.test(text))return false;
  const flat=clean(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,'').trim();
  if(/^(si|no|ok|vale|claro|adelante|gracias|hola|yes|thanks|hello)$/.test(flat))return false;
  return !flat||/\b(y|o|pero|porque|durante|considerando|si|que|de|del|con|para|por|entre|aunque|entonces|yo|una|un|el|la|los|las|debo|tengo|seria|and|or|but|because|with|for|the)\b$/.test(flat);
 }
 class SpeechTurnAssembler {
  constructor({onPartial=()=>{},onCommit=()=>{},timers=globalThis}={}){Object.assign(this,{onPartial,onCommit,timers});this.segments=new Map();this.consumed=new Map();this.pending='';this.timer=null;this.revision=0;}
  speechStart(){this.timers.clearTimeout(this.timer);this.timer=null;}
  push({id,text,final=false}){
   if(!id||!clean(text))return false;
   const raw=clean(text),used=this.consumed.get(id);let part=raw;
   // A late Muse final must not repeat a locally committed turn. If Muse keeps
   // the same ID while the person continues, retain only its new suffix.
   if(used){const previous=normal(used).split(' '),words=raw.split(' ');if(previous.every((word,index)=>normal(words[index]||'')===word))part=words.slice(previous.length).join(' ');else return false;if(!part)return false;}
   this.segments.set(id,{text:part,raw});const full=[...this.segments.values()].map(item=>item.text).join(' ');
   const changed=full!==this.pending;this.pending=full;if(changed)this.onPartial(full);
   if(!changed&&this.timer!==null)return false;
   this.timers.clearTimeout(this.timer);const revision=this.revision;
   this.timer=this.timers.setTimeout(()=>{
    this.timer=null;if(revision!==this.revision||incompleteUtterance(this.pending))return;
    const text=this.pending;for(const [key,item] of this.segments)this.consumed.set(key,item.raw);
    while(this.consumed.size>80)this.consumed.delete(this.consumed.keys().next().value);
    this.segments.clear();this.pending='';this.onPartial('');this.onCommit(text);
   },final&&/[?!]\s*$/.test(full)?800:final?1600:1900);
   return changed;
  }
  reset(){this.revision++;this.speechStart();this.segments.clear();this.consumed.clear();this.pending='';this.onPartial('');}
 }
 class ListeningCues {
  constructor({onCue=()=>{},timers=globalThis,now=Date.now,random=Math.random}={}){Object.assign(this,{onCue,timers,now,random});this.bag=[];this.last=null;this.timer=null;}
  update(text){this.text=text;this.updated=this.now();if(this.timer===null)this.timer=this.timers.setTimeout(()=>this.tick(),8000);}
  pick(){
   const sensitive=/\b(?:triste|miedo|duele|dolor|perdi|perdida|enfermo|enferma|ansiedad|depresion|fallecio|murio|despidieron|sad|scared|pain|died)\b/.test(normal(this.text));
   const allowed=Object.keys(CUE_TEXT).filter(key=>!sensitive||!['bien','claro','si','de_acuerdo'].includes(key));
   this.bag=this.bag.filter(key=>allowed.includes(key));
   if(!this.bag.length){this.bag=[...allowed];for(let i=this.bag.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]];}if(this.bag.at(-1)===this.last)[this.bag[0],this.bag[this.bag.length-1]]=[this.bag.at(-1),this.bag[0]];}
   return this.last=this.bag.pop();
  }
  tick(){this.timer=null;if((this.text?.split(/\s+/).length||0)>=8&&this.now()-this.updated<2000)this.onCue(this.pick());if(this.text)this.timer=this.timers.setTimeout(()=>this.tick(),14000);}
  stop(){this.timers.clearTimeout(this.timer);this.timer=null;this.text='';}
 }
 return {SpeechTurnAssembler,incompleteUtterance,ListeningCues,CUE_TEXT,stripCueEcho};
});
