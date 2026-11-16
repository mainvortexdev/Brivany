/* Local UI text only. File names, captions, lyrics and conversation stay as provided. */
(() => {
 'use strict';
 const key='brivany.workspace.interface.v1';
 const attributes=['aria-label','placeholder','title','alt'];
 const bindings=[];
 const tracked=new WeakMap();
 const prefs=window.BrivanyWorkspacePreferences;
 let locale='es',requested='es',dictionary={},pending;
 const meta=document.querySelector('meta[name="brivany-workspace-catalog"]');
 if(meta&&meta.dataset.locale===prefs.locale()){
  try{
   const messages=JSON.parse(meta.content);
   if(isCatalog(messages)){locale=requested=meta.dataset.locale;dictionary=messages;}
  }catch{}
 }

 function isCatalog(value){
  return value&&typeof value==='object'&&!Array.isArray(value)
   &&Object.values(value).every(message=>typeof message==='string'&&message.length>0);
 }
 function text(source){return Object.hasOwn(dictionary,source)?dictionary[source]:source}
 function track(node,attribute,original){
  const source=original?.trim();
  if(!source||!(/\p{L}/u.test(source)))return;
  let known=tracked.get(node);
  if(!known){known=new Set();tracked.set(node,known);}
  if(known.has(attribute))return;
  known.add(attribute);
  const binding={node,attribute,original,source,last:original};
  bindings.push(binding);
  paint(binding);
 }
 function paint(binding){
  const {node,attribute,original,source,last}=binding;
  const current=attribute?node.getAttribute(attribute):node.data;
  // A dynamic renderer can take ownership of this node.
  if(current!==last)return;
  const value=original.replace(source,()=>text(source));
  if(value!==current){
   if(attribute)node.setAttribute(attribute,value);
   else node.data=value;
  }
  binding.last=value;
 }
 function mount(root){
  if(!root)return;
  for(const element of [root,...root.querySelectorAll('*')]){
   if(element.matches('script,style'))continue;
   for(const attribute of attributes)track(element,attribute,element.getAttribute(attribute));
   for(const child of element.childNodes)if(child.nodeType===3)track(child,null,child.data);
  }
 }
 function apply(code,messages){
  locale=code;dictionary=messages;document.documentElement.lang=code;
  for(const binding of bindings)paint(binding);
  window.dispatchEvent(new Event('brivany-workspace-locale'));
 }
 async function refresh(){
  const next=prefs.locale();
  if(next===requested)return;
  requested=next;
  pending?.abort();
  if(next===locale)return;
  if(next==='es'){apply(next,{});return;}
  const request=new AbortController();pending=request;
  try{
   const response=await fetch('/desktop-shell/workspace-locales/'+next+'.json',{
    credentials:'same-origin',signal:AbortSignal.any([request.signal,AbortSignal.timeout(4000)])
   });
   if(!response.ok)throw new Error('catalog');
   const messages=await response.json();
   if(!isCatalog(messages))throw new Error('catalog');
   if(!request.signal.aborted&&requested===next)apply(next,messages);
  }catch{
   if(!request.signal.aborted&&requested===next)requested=locale;
  }finally{if(pending===request)pending=null;}
 }
 document.documentElement.lang=locale;
 window.BrivanyWorkspaceLocale={text,mount,current:()=>locale};
 mount(document.querySelector('#island'));
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null)refresh()});
 window.addEventListener('brivany-workspace-settings',refresh);
 window.addEventListener('pagehide',()=>pending?.abort(),{once:true});
 refresh();
})();
