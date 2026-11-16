(() => {
 'use strict';const $=id=>document.getElementById(id),parts=location.hash.slice(1).split('.');
 const texts={es:['Tu archivo','Conectando…','Descargar','Enlace temporal · Archivo cifrado','El envío terminó. Genera otro QR en Brivany.','Descarga iniciada'],en:['Your file','Connecting…','Download','Temporary link · Encrypted file','The transfer ended. Create another QR code in Brivany.','Download started'],fr:['Votre fichier','Connexion…','Télécharger','Lien temporaire · Fichier chiffré','Le transfert est terminé. Générez un nouveau QR code dans Brivany.','Téléchargement démarré'],'pt-BR':['Seu arquivo','Conectando…','Baixar','Link temporário · Arquivo criptografado','A transferência terminou. Gere outro código QR no Brivany.','Download iniciado']};
 const locale=new URLSearchParams(location.search).get('lang'),words=texts[locale]||texts.es;document.documentElement.lang=texts[locale]?locale:'es';document.title='Brivany · '+words[0];$('name').textContent=words[0];$('status').textContent=words[1];$('download').textContent=words[2];document.querySelector('.privacy').textContent=words[3];history.replaceState(null,'',location.pathname+location.search);
 let [id,token,key]=parts;parts.fill('');let objectURL=null;
 const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),char=>char.charCodeAt(0));
 const fail=()=>{$('download').hidden=true;$('status').dataset.error='true';$('status').textContent=words[4]};
 // Safari may reuse a tab for the next QR. A fragment-only navigation does
 // not execute this script again; reload it without sending the fragment.
 window.addEventListener('hashchange',()=>{if(location.hash)location.reload()});
 if(!/^[A-Za-z0-9_-]{22}$/.test(id||'')||!/^[A-Za-z0-9_-]{43}$/.test(token||'')||!/^[A-Za-z0-9_-]{43}$/.test(key||'')){fail();return}
 (async()=>{try{
  const base='/transfer/api/'+id,claim=await fetch(base+'/claim',{method:'POST',credentials:'same-origin',headers:{Authorization:'Bearer '+token},cache:'no-store'});token='';if(!claim.ok)throw Error();
  const info=await claim.json(),response=await fetch(base+'/payload',{credentials:'same-origin',cache:'no-store'});if(!response.ok||response.headers.get('Content-Type')!=='application/octet-stream')throw Error();
  const box=new Uint8Array(await response.arrayBuffer());if(box.length<32||box.length>8*1024*1024+1024)throw Error();
  const keyBytes=decode(key);key='';const secret=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);keyBytes.fill(0);const clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:box.slice(0,12),additionalData:new TextEncoder().encode('Brivany-transfer-v1:'+id)},secret,box.slice(12)));
  const nameLength=(clear[0]<<8)|clear[1];if(nameLength<1||nameLength>720||clear.length<nameLength+2)throw Error();
  const name=new TextDecoder('utf-8',{fatal:true}).decode(clear.slice(2,2+nameLength));if(name.length>180||/[\\/\x00-\x1f<>:"|?*]/.test(name))throw Error();
  const file=clear.slice(2+nameLength);if(file.length>8*1024*1024)throw Error();objectURL=URL.createObjectURL(new Blob([file],{type:'application/octet-stream'}));clear.fill(0);box.fill(0);
  $('name').textContent=name;$('size').textContent=file.length<1024?file.length+' B':file.length<1048576?(file.length/1024).toFixed(1)+' KiB':(file.length/1048576).toFixed(1)+' MiB';$('status').textContent='';
  const link=$('download');link.href=objectURL;link.download=name;link.hidden=false;link.onclick=()=>{fetch(base+'/sent',{method:'POST',credentials:'same-origin',cache:'no-store',keepalive:true}).catch(()=>{});$('status').textContent=words[5]};
  setTimeout(()=>{if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;fail()},Math.max(0,Math.min(300,Number(info.expires_in)||0))*1000);
 }catch{fail()}})();
 window.addEventListener('pagehide',()=>{if(objectURL)URL.revokeObjectURL(objectURL)},{once:true});
})();
