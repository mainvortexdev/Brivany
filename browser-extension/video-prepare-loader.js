/* Registered at document start only on sites the user has previously granted. */
(() => {
 if(globalThis.brivanyPrefixLoad)return globalThis.brivanyPrefixLoad;
 const rootReady=()=>document.documentElement||new Promise(resolve=>{
  const finish=()=>{observer.disconnect();clearTimeout(timer);resolve(document.documentElement);};
  const observer=new MutationObserver(()=>{if(document.documentElement)finish();});
  const timer=setTimeout(finish,1500);
  observer.observe(document,{childList:true});
 });
 const load=(async()=>{
  const root=await rootReady();
  if(!root)return 'document-timeout';
  root.dataset.brivanyPrefixLoader='loading';
  try{
   const module=await import(chrome.runtime.getURL('video-selection.js'));
   module.observeVideoPreparation();
   root.dataset.brivanyPrefixLoader='ready';
   return 'ready';
  }catch{
   root.dataset.brivanyPrefixLoader='module-error';
   return 'module-error';
  }
 })();
 globalThis.brivanyPrefixLoad=load;
 load.then(result=>{if(result==='document-timeout')delete globalThis.brivanyPrefixLoad;});
 return load;
})();
