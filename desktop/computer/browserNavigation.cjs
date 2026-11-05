'use strict';
function matchesDestination(actual,requested){
 const a=new URL(actual),r=new URL(requested);
 if(a.href===r.href)return true;
 // YouTube adds a documented-in-runtime UI refresh flag to its own search.
 return a.origin===r.origin&&a.origin==='https://www.youtube.com'&&a.pathname==='/results'&&r.pathname==='/results'&&
  a.searchParams.get('search_query')===r.searchParams.get('search_query')&&[...a.searchParams.keys()].every(k=>['search_query','themeRefresh'].includes(k));
}
async function navigateObserved({session,automation,type,readPage,assertActive,wait,attempts=30,handoff=false,diagnostic=()=>{}},url){
 const destination=new URL(url);if(!['https:','http:'].includes(destination.protocol)||destination.username||destination.password)throw Error('URL no admitida');
 const before=await session.observe();session.requireSelectedTab(before);
 assertActive();await automation.guardedHotkey(before.windowHandle,['ctrl','l']);await type(destination.href);
 assertActive();await automation.guardedHotkey(before.windowHandle,['enter']);
 let lastError;const deadline=Date.now()+25000;
 for(let index=0;index<attempts&&Date.now()<deadline;index++){
  await wait(400);assertActive();
  const identity=await automation.getForegroundIdentity();if(identity.windowHandle!==before.windowHandle)throw Error('Cambió la ventana durante la navegación; no se repetirá la entrada.');
  try{
   const page=await readPage();if(page.windowHandle!==before.windowHandle)throw Error('Cambió la ventana al leer la página.');
   const actual=page.url?new URL(page.url):null;
   if(actual)diagnostic({origin:actual.origin,pathname:actual.pathname,query_keys:[...actual.searchParams.keys()],requested_query_preserved:[...destination.searchParams].every(([k,v])=>actual.searchParams.get(k)===v)});
   const loginRedirect=handoff&&actual&&actual.origin===destination.origin&&actual.protocol==='https:'&&!actual.username&&!actual.password;
   if(page.url&&(matchesDestination(page.url,destination.href)||loginRedirect)){
    // Navigation can recreate the native tab node. Rebind only after the
    // requested destination was verified in the same foreground window.
    // Hand off authentication before observing page fields or rebinding its UIA tree.
    if(!handoff)await session.selectCurrentTabForNavigation();
    return {navigated:page.url,verified:true,method:'observed-page-url',navigation_input_count:1,...(handoff?{requires_user:true}:{})};
   }
   lastError='El destino observado no coincide con la dirección solicitada.';
  }catch(error){
   if(!/WEB_DOCUMENT_UNAVAILABLE|WEB_URL_UNAVAILABLE/.test(error.message))throw error;
   lastError='La página todavía no expone su URL accesible.';
  }
 }
 throw Error((lastError||'No se pudo comprobar el destino')+' No se repetirá la navegación.');
}
module.exports={matchesDestination,navigateObserved};
