/* Same-origin, temporary file grant. No analytics, persistent storage or polling. */
(async()=>{
 'use strict';const $=id=>document.getElementById(id);let token=location.hash.slice(1);
 let messages={};
 try{messages=JSON.parse(document.querySelector('meta[name="brivany-phone-language"]')?.content||'{}')}catch{}
 const t=text=>Object.hasOwn(messages,text)?messages[text]:text;
 for(const element of document.querySelectorAll('[data-i18n]'))element.textContent=t(element.dataset.i18n);
 history.replaceState(null,'','/');
 try{
  const response=await fetch(token?'/claim':'/info',token?{method:'POST',headers:{Authorization:'Bearer '+token},credentials:'same-origin',cache:'no-store'}:{credentials:'same-origin',cache:'no-store'});token='';
  if(!response.ok){$('status').textContent=t('El envío terminó. Genera otro QR en Brivany.');return}
  const value=await response.json(),number=new Intl.NumberFormat(document.documentElement.lang,{minimumFractionDigits:1,maximumFractionDigits:1});
  $('name').textContent=value.name;$('size').textContent=value.size<1024?value.size+' B':value.size<1048576?number.format(value.size/1024)+' KiB':number.format(value.size/1048576)+' MiB';$('download').hidden=false;$('status').textContent='';
  const remaining=Math.max(0,Math.min(300,Number(value.expires_in)||0));setTimeout(()=>{$('download').hidden=true;$('status').textContent=t('El envío terminó.')},remaining*1000);
 }catch{$('status').textContent=t('No se pudo conectar con Brivany.')}
})();
