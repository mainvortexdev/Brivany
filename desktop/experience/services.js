(() => {
 const box=document.getElementById('services-status');
 async function refresh(){
  box.textContent='Consultando configuración local…';
  try{
   const response=await fetch('/api/desktop/services',{cache:'no-store'});
   if(!response.ok)throw Error();
   const data=await response.json();box.replaceChildren();
   for(const service of data.services){const row=document.createElement('p'),link=document.createElement('a');link.href=service.route;link.textContent=service.name;row.append(link,document.createTextNode(service.configured?' · Configurada en este equipo':' · Requiere credenciales'));box.append(row);}
  }catch{box.textContent='No se pudo consultar el servidor. Actualiza para volver a intentarlo.';}
 }
 document.getElementById('refresh-services').addEventListener('click',refresh);refresh();
})();
