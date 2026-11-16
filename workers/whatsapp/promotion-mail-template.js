const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function promotionMailMessage(data){
 if(!data||typeof data.email!=='string'||data.email.length>254||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(data.email)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.campaign||''))throw Error('invalid_newsletter');
 const url=new URL(data.unsubscribe);
 if(url.origin!=='https://cognira.vetsa.es'||url.pathname!=='/notifications/unsubscribe'||!/^[a-f0-9-]{36}$/i.test(url.searchParams.get('u')||'')||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('token')||''))throw Error('invalid_unsubscribe');
 const tips=[
  ['Tus herramientas, en un mismo lugar','Desde Mi cuenta → Conexiones puedes elegir un ordenador y gestionar Drive, Gmail, Google Calendar y WhatsApp en las aplicaciones compatibles. Revisa siempre la cuenta y los permisos antes de autorizar.','https://cognira.vetsa.es/account#connections'],
  ['Prepara una entrega con Melodi','Indica la carpeta de clips, la duración deseada y el destino de Drive. Revisa la línea de tiempo y los subtítulos antes de exportar. Pide los avisos por correo con un destinatario concreto.','https://cognira.vetsa.es/docs'],
  ['Revisa la seguridad de tu cuenta','En Mi cuenta → Seguridad puedes consultar tu correo y activar voluntariamente Vetsa Three Auth. Guarda tu PIN de forma segura; Vetsa nunca te lo pedirá por email.','https://cognira.vetsa.es/account#security'],
 ];
 const [subject,body,link]=tips[(Number(data.campaign.slice(5))-1)%tips.length];
 const text=subject+'\n\n'+body+'\n\n'+link+'\n\nRecibes este correo porque activaste las novedades de Vetsa. Máximo un correo al mes. Puedes desactivarlas en '+url.href+'\n\nVetsa Intelligence · https://vetsa.es · support@vetsa.es';
 return {sender:{email:'notificaciones@vetsa.es',name:'Vetsa Intelligence'},replyTo:{email:'support@vetsa.es',name:'Soporte Vetsa'},to:[{email:data.email}],subject:'Vetsa · '+subject,textContent:text,htmlContent:'<div style="font:16px/1.7 Arial,sans-serif;max-width:600px"><p>VETSA INTELLIGENCE</p><h1 style="font-size:27px">'+escape(subject)+'</h1><p>'+escape(body)+'</p><p><a href="'+link+'">Abrir Cognira</a></p><hr><p style="font-size:12px">Recibes este correo porque activaste las novedades. Máximo un correo al mes. <a href="'+escape(url.href)+'">Desactivar novedades</a>.</p><p style="font-size:12px">Vetsa Intelligence · <a href="https://vetsa.es">vetsa.es</a> · support@vetsa.es</p></div>',headers:{'List-Unsubscribe':'<'+url.href+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},tags:['vetsa-opt-in-newsletter']};
}
