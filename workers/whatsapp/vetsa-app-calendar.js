import {calendarWindow,googleCalendarSnapshot} from './vetsa-calendar-events.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
// Invoked only after the original service verifies both Vetsa JWT and owner link.
// OAuth credentials stay in the assistant runtime and never reach the app gateway.
export async function appCalendarReadRoute(request,env,{owner,createStore,getAccessToken}){
 if(request.method!=='GET')return json({error:'Método no permitido.'},405);
 if(!/^\d{8,15}$/.test(owner||'')||owner!==String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''))return json({error:'Cuenta no autorizada.'},403);
 let store,lease;
 try{
  const range=calendarWindow(new URL(request.url));store=createStore(env);const connection=await store.getConnection(owner);
  if(connection?.status!=='connected'||!connection.calendarId)return json({error:'Calendar no está conectado.',authorizationRequired:true},409);
  lease=await store.acquireLease(owner);if(!lease)return json({error:'Calendar está actualizando. Vuelve a intentarlo en un momento.'},503);
  const accessToken=await getAccessToken(env,connection,store,{leaseToken:lease});
  const result=await googleCalendarSnapshot({accessToken,calendarId:connection.calendarId,calendarName:'Vetsa · Equipo',source:'google-assistants',readOnly:true,range});
  return json(result);
 }catch(error){return json({error:error.status===400?'Elige un rango de fechas válido.':'No se pudieron actualizar los eventos de Calendar.'},error.status===400?400:502);}
 finally{if(lease)await store.releaseLease(owner,lease).catch(()=>{});}
}
