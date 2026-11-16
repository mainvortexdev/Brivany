import {createGoogleCalendarLink} from './google-calendar-auth.js';
import {createDriveLink} from './drive-auth.js';
import {createGmailLink} from './gmail-auth.js';
import {linkedTenant} from './melodi-tenants.js';
import {findBrivanyDesktop} from './melodi-desktop.js';

const SCHEMA=`CREATE TABLE IF NOT EXISTS brivany_whatsapp_service_notices(
  notice_key TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,
  message_id TEXT,delivery_status TEXT,error_code TEXT,updated_at INTEGER NOT NULL)`;
const number=value=>String(value||'').replace(/\D/g,'');
const GOOGLE_FACTORIES=[['calendar',createGoogleCalendarLink],['drive',createDriveLink],['gmail',createGmailLink]];
/** Real HTTP check through the public route, stopping before any Google sign-in.
 * Probe links are separate from the fresh links sent to the user. */
export async function checkGoogleConsentStarts(env,job,{fetchImpl=fetch}={}){
 const owner=number(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER);
 if(number(job.ownerPhone)!==owner||typeof job.release!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(job.release))throw Error('invalid_service_check');
 await env.VETSA_CLOUD.prepare(`CREATE TABLE IF NOT EXISTS brivany_whatsapp_integration_checks(release TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,http_status INTEGER,updated_at INTEGER NOT NULL,PRIMARY KEY(release,provider))`).run();
 const results=[];
 for(const [provider,factory] of GOOGLE_FACTORIES){
  let status='failed',httpStatus=null;
  try{
   const result=await factory(env),url=new URL(result.url);
   if(!result.configured||url.origin!=='https://ia.vetsa.es'||!url.pathname.startsWith('/oauth/'))throw Error('invalid_probe_link');
   const page=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});httpStatus=page.status;
   if(page.status!==200||!(await page.text()).includes('method="post"'))throw Error('consent_preview_failed');
   const response=await fetchImpl(url.origin+url.pathname,{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({link:url.searchParams.get('link')}),redirect:'manual',signal:AbortSignal.timeout(15000)});httpStatus=response.status;
   const target=new URL(response.headers.get('location'));
   if(response.status!==302||target.origin!=='https://accounts.google.com'||target.searchParams.get('client_id')!==env.GOOGLE_CLIENT_ID
     ||target.searchParams.get('redirect_uri')!=='https://ia.vetsa.es/oauth/google/callback'||target.searchParams.get('code_challenge_method')!=='S256'
     ||!response.headers.get('set-cookie')?.includes('HttpOnly; Secure; SameSite=Lax'))throw Error('consent_redirect_failed');
   status='passed';
  }catch{/* Store only operational status, never nonces or provider URLs. */}
  await env.VETSA_CLOUD.prepare(`INSERT INTO brivany_whatsapp_integration_checks VALUES(?,?,?,?,?) ON CONFLICT(release,provider) DO UPDATE SET status=excluded.status,http_status=excluded.http_status,updated_at=excluded.updated_at`)
   .bind(job.release,provider,status,httpStatus,Date.now()).run();
  results.push({provider,status,httpStatus});
 }
 return results;
}
export async function notifyMelodiOwner(env,job,{sendText,services}={}){
  const owner=number(env.MELODI_PRIMARY_OWNER||env.OWNER_WHATSAPP_NUMBER);
  if(!/^\d{8,15}$/.test(owner)||number(job.ownerPhone)!==owner||!['ready','google-approval','verification-approval','cloud-calls'].includes(job.kind)
    ||typeof job.release!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(job.release)||typeof sendText!=='function'
    ||job.connectors!==undefined&&(!Array.isArray(job.connectors)||!job.connectors.length||job.connectors.some(item=>!['calendar','drive','gmail'].includes(item))||new Set(job.connectors).size!==job.connectors.length))throw Error('invalid_service_notice');
  await env.VETSA_CLOUD.prepare(SCHEMA).run();
  const key=`${job.release}:${job.kind}`;
  const claim=await env.VETSA_CLOUD.prepare(`INSERT OR IGNORE INTO brivany_whatsapp_service_notices(notice_key,owner,kind,status,updated_at) VALUES(?,?,?,'sending',?)`)
    .bind(key,owner,job.kind,Date.now()).run();
  if(!claim.meta?.changes)return{status:'already_attempted'};
  let attemptingDelivery=false;
  try{
    const tenant=await linkedTenant(env,owner,services);
    let body;
    if(job.kind==='cloud-calls'){
      const info=env.MELODI_CALLS?await env.MELODI_CALLS.info():null;
      if(!info?.configured)throw Error('cloud_calls_not_ready');
      body='La programación de llamadas telefónicas ya está alojada en la nube de Brivany. Puedes escribirme «Llámame en 20 minutos» o «Llámame mañana a las 9». Telnyx hará la llamada aunque tu PC esté apagado; la voz se genera exclusivamente con Cartesia y la voz exacta de Melodi.\n\nUsa «Mis llamadas» para consultarlas y «Cancela llamada» seguido del identificador para cancelarlas. Conservo los límites de duración y no repito un marcado cuyo resultado sea incierto.\n\nRetiré las llamadas por WhatsApp como pediste. Este chat sigue sirviendo para pedirme tareas y llamadas telefónicas. Podemos comprobar la conversación y el control del PC cuando atiendas una llamada.';
    }else if(job.kind==='verification-approval'){
      body='Dejé preparados los permisos y las justificaciones de Brivany en Google. Para completar la solicitud falta una demostración del nuevo canal de WhatsApp y, para la aprobación de permisos restringidos, Google exige la evaluación de seguridad CASA. El video anterior solo muestra Desktop.\n\nNecesito tu aprobación en el aviso de Codex antes de autorizar el cliente web con Drive de ceo@vetsa.es y Gmail de felixdanielluna40@gmail.com para grabar una prueba con un archivo y un borrador ficticios, sin enviar correos. El video ocultaría datos personales y conversaciones. Puedes elegir usar otras cuentas de prueba. No he contratado ni pagado ninguna evaluación.\n\nCalendar ya está conectado. El aviso de Drive/Gmail seguirá hasta la aprobación de Google.';
    }else if(job.kind==='google-approval'){
      if(!tenant)body='Para continuar con Google, primero vincula tu WhatsApp desde Conexiones en Brivany. Abre Brivany, inicia sesión en tu cuenta Vetsa y pulsa «Vincular mi WhatsApp». Te prepararé un mensaje para enviarlo a este mismo número.';
      else{
        const checks=await checkGoogleConsentStarts(env,job);
        if(checks.some(check=>check.status!=='passed'))throw Error('google_consent_preflight_failed');
        const links=[];
        for(const [id,label,factory] of [['calendar','Google Calendar',createGoogleCalendarLink],['drive','Google Drive',createDriveLink],['gmail','Gmail',createGmailLink]].filter(([id])=>!job.connectors||job.connectors.includes(id))){
          const result=await factory(env);if(result.configured&&result.url)links.push(`${label}: ${result.url}`);
        }
        const introduction=job.verificationPending===true?'Revisé el aviso de Google. La marca Brivany está verificada, pero el acceso a datos de Drive y Gmail sigue pendiente de la revisión de Google. Estos enlaces son nuevos y piden permisos más limitados; el aviso puede seguir apareciendo hasta que Google apruebe esa revisión. Calendar ya está conectado.':'Ya preparé la conexión de Google con el proyecto propio de Brivany. Necesito que autorices tus cuentas; el acceso que tenía la aplicación anterior no se puede transferir. Abre cada enlace que quieras conectar y revisa los permisos en Google:';
        body=introduction+'\n\n'+links.join('\n\n')+'\n\nConectar la cuenta no envía correos ni publica archivos por sí solo.';
      }
    }else{
      body='Ya estoy operativa en WhatsApp como Melodi de Brivany. Puedes escribirme a este mismo número.\n\nMis herramientas incluyen:\n• Conversación y trabajo con tus archivos y notas de voz.\n• Agenda, recordatorios y rutinas que me pidas.\n• Proyectos, pendientes, memoria privada y contactos.\n• Finanzas personales: ingresos, gastos, deudas, ahorro y suscripciones.\n• Informes de uso del negocio para el operador autorizado.\n• Documentos PDF y Word.\n• Búsqueda e investigación web.\n• Google Calendar, Drive y Gmail: consultar agenda y archivos, preparar documentos y trabajar con tu correo al autorizar tus cuentas.\n• Herramientas de imágenes, contenido y redes conectadas, según tus permisos.\n• Acciones en el ordenador vinculado, cuando esté conectado y me autorices.\n\nEn Brivany encontrarás el número y el vínculo de tu cuenta en Conexiones → Melodi en WhatsApp. Tus datos y conexiones se mantienen separados de los de otros usuarios.\n\nGoogle necesita una nueva autorización con el cliente de Brivany cuando la conexión anterior no esté vigente. Te lo indicaré cuando una conexión no esté lista; no daré una acción por hecha sin comprobar su resultado.';
      const statuses=[];
      for(const [name,table] of [['Calendar','google_calendar_connections'],['Drive','drive_connections'],['Gmail','gmail_connections']]){
        const exists=await env.VETSA_CLOUD.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
        const connection=exists?await env.VETSA_CLOUD.prepare(`SELECT status FROM ${table} WHERE owner=?`).bind(owner).first():null;
        statuses.push(`${name}: ${connection?.status==='connected'?'conectado':'pendiente de autorización'}`);
      }
      body+='\n\nEstado actual de tus conexiones:\n'+statuses.join('\n');
      const desktop=await findBrivanyDesktop(env,owner);
      body+='\n\nOrdenador: '+(desktop?.status==='online'?'conectado a Brivany. Puedes enviarme una tarea para este PC; Brivany debe seguir abierta.':'sin conexión ahora; abre Brivany y activa el control del ordenador en Conexiones.');
      if(env.MELODI_CALLS&&(await env.MELODI_CALLS.info()).configured)body+='\n\nPuedo guardar llamadas telefónicas en la nube: «Llámame en 20 minutos» o «Llámame mañana a las 9». Telnyx marca aunque el PC esté apagado y uso mi voz exacta de Cartesia. Consulta «Mis llamadas» o cancela con el identificador. Las llamadas por WhatsApp están retiradas.';
      body+='\nLa revisión de Google que enviaste sigue siendo un requisito externo; no equivale a una conexión autorizada de Drive o Gmail.';
      if(!tenant||tenant.legacy)body+='\n\nEl vínculo con tu cuenta de Brivany aún está pendiente. Puedes completarlo en Conexiones; tu número original conserva sus herramientas durante la migración.';
    }
    attemptingDelivery=true;
    const receipt=await sendText(env,owner,body,{agent:'melodi'});
    if(!receipt?.messageId)throw Error('notification_receipt_missing');
    await env.VETSA_CLOUD.prepare("UPDATE brivany_whatsapp_service_notices SET status='accepted',message_id=?,updated_at=? WHERE notice_key=? AND status='sending'")
      .bind(receipt.messageId,Date.now(),key).run();
    return{status:'accepted',messageId:receipt.messageId};
  }catch(error){
    const rejected=/WhatsApp API returned (?:400|401|403|404|422|429)\b/.test(error?.message||'');
    const code=String(error?.message||'').match(/code (\d+)/)?.[1]||'send_unconfirmed';
    await env.VETSA_CLOUD.prepare("UPDATE brivany_whatsapp_service_notices SET status=?,error_code=?,updated_at=? WHERE notice_key=? AND status='sending'")
      .bind(!attemptingDelivery?'preflight_failed':rejected?'rejected':'uncertain',code,Date.now(),key).run();
    return{status:!attemptingDelivery?'preflight_failed':rejected?'rejected':'uncertain',code};
  }
}
export async function recordServiceNoticeStatuses(env,payload){
  if(!payload?.entry?.some(entry=>entry.changes?.some(change=>change.value?.statuses?.length)))return;
  const exists=await env.VETSA_CLOUD.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brivany_whatsapp_service_notices'").first();if(!exists)return;
  for(const entry of Array.isArray(payload?.entry)?payload.entry:[])for(const change of Array.isArray(entry.changes)?entry.changes:[]){
    if(change.value?.metadata?.phone_number_id!==env.WHATSAPP_PHONE_NUMBER_ID)continue;
    for(const status of Array.isArray(change.value?.statuses)?change.value.statuses:[]){
      if(typeof status.id!=='string'||!['sent','delivered','read','failed'].includes(status.status))continue;
      // Do not replace a delivery/read receipt with an older sent callback.
      await env.VETSA_CLOUD.prepare(`UPDATE brivany_whatsapp_service_notices SET delivery_status=?,updated_at=? WHERE message_id=? AND owner=?
        AND NOT(COALESCE(delivery_status,'')='read' AND ?<>'read') AND NOT(COALESCE(delivery_status,'')='delivered' AND ?='sent')`)
        .bind(status.status,Date.now(),status.id,number(status.recipient_id),status.status,status.status).run();
    }
  }
}
