import {parseSimpleReminderRequest} from './simple-reminder-request.js';
import {desktopHash} from './melodi-desktop.js';
const stmt=(env,sql,...values)=>env.VETSA_CLOUD.prepare(sql).bind(...values);
// Retained only for cancelling pre-cloud reservations and their old receipts.
export const CALL_SCHEMA=Object.freeze([
 `CREATE TABLE IF NOT EXISTS brivany_call_schedules(id TEXT PRIMARY KEY,phone TEXT NOT NULL,device_id TEXT NOT NULL,channel TEXT NOT NULL,due_at INTEGER NOT NULL,time_zone TEXT NOT NULL,request_hash TEXT UNIQUE NOT NULL,payload_encrypted TEXT NOT NULL,payload_iv TEXT NOT NULL,state TEXT NOT NULL,command_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS brivany_call_schedule_notices(schedule_id TEXT PRIMARY KEY,status TEXT NOT NULL,receipt_id TEXT,updated_at INTEGER NOT NULL)`
]);
export async function ensureCalls(env){await env.VETSA_CLOUD.batch(CALL_SCHEMA.map(sql=>env.VETSA_CLOUD.prepare(sql)));}
const owner=env=>String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,'');
const fold=text=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
export function parseCallRequest(text,{now=Date.now(),timeZone='UTC'}={}){
 if(typeof text!=='string'||text.length>1200)return null;
 const request=text.trim().replace(/^(?:melodi[, :]*)/i,'');
 if(!/^(?:por favor,?\s+)?(?:ll[aá]mame|quiero que me llames|puedes llamarme|programa una llamada(?: para m[ií])?)\b/i.test(request))return null;
 if(/[\r\n<>"“”«»`]/.test(request))return {error:'Escribe la llamada como un pedido directo con su hora.'};
 if(/\bwhatsapp\b/.test(fold(request)))return {error:'Las llamadas son telefónicas por Telnyx. WhatsApp se usa para pedírmelas y cancelarlas. Si quieres, escribe «Llámame en 20 minutos».'};
 let timing=request.replace(/^(?:por favor,?\s+)?(?:ll[aá]mame|quiero que me llames|puedes llamarme|programa una llamada(?: para m[ií])?)\s*/i,'').replace(/(?:por\s+)?(?:tel[eé]fono|v[ií]a\s+telnyx|telnyx|llamada\s+(?:normal|directa)|llamada\s+telef[oó]nica)/gi,'').trim();
 let objective='Conversa conmigo con la voz de Melodi.';
 const split=timing.match(/\s+(?:para hablar (?:de|sobre)|sobre|acerca de)\s+(.+)$/i);if(split){objective=split[1].slice(0,600);timing=timing.slice(0,split.index);}
 if(/^(?:ahora|ya)(?: mismo)?[.! ]*$/i.test(timing))return {channel:'telephone',dueAt:now+1000,objective};
 timing=timing.replace(/\bmedia hora\b/i,'30 minutos').replace(/\bun cuarto de hora\b/i,'15 minutos').replace(/\bun minuto\b/i,'1 minuto').replace(/\buna hora\b/i,'1 hora');
 const seconds=/^(?:en|dentro de)\s+(\d{1,3})\s+segundos?[.! ]*$/i.exec(timing);
 if(seconds&&Number(seconds[1])>=5)return {channel:'telephone',dueAt:now+Number(seconds[1])*1000,objective};
 const parsed=parseSimpleReminderRequest('Recuérdame atender la llamada '+timing,{now,timeZone});
 if(!parsed||Date.parse(parsed.eventAt)>now+30*86400000)return {error:'No pude fijar esa hora. Usa «en 20 minutos», «mañana a las 9» o una fecha y hora concretas.'};
 return {channel:'telephone',dueAt:Date.parse(parsed.eventAt),objective};
}
const LABELS={scheduled:'programada',dialing:'iniciando',ringing:'sonando',active:'en curso',uncertain:'inicio sin confirmar',cancel_requested:'cancelación en curso',cancelled:'cancelada',completed:'terminada',failed:'no completada',expired:'vencida',interrupted:'interrumpida'};
export async function handleCallMessage(env,{phone,incoming,message,reply,now=Date.now()}={}){
 if(phone!==owner(env)||message?.type!=='text'||typeof incoming!=='string')return false;
 const normalized=fold(incoming.trim()),list=/^(?:mis llamadas|lista (?:mis )?llamadas|llamadas programadas)[?.! ]*$/.test(normalized),cancel=/^(?:cancela(?:r)? (?:la )?llamada) ([a-f0-9-]{36})[.! ]*$/.exec(normalized);
 const parsed=list||cancel?null:parseCallRequest(incoming,{now,timeZone:env.TIME_ZONE||'UTC'});
 if(!list&&!cancel&&!parsed)return false;
 if(parsed?.error){await reply(parsed.error);return true;}
 try{
  if(!env.MELODI_CALLS||(await env.MELODI_CALLS.info()).configured!==true){await reply('El servicio de llamadas telefónicas en la nube todavía no está disponible. No he programado una llamada.');return true;}
  if(list){const rows=await env.MELODI_CALLS.list(phone);await reply(rows.length?rows.map(r=>`Teléfono · ${new Intl.DateTimeFormat('es',{timeZone:r.timeZone,dateStyle:'short',timeStyle:'short'}).format(r.dueAt)} · ${r.reason==='no_answer'?'sin respuesta':LABELS[r.state]||r.state}\n${r.id}`).join('\n\n'):'No tienes llamadas programadas.');return true;}
  if(cancel){const row=await env.MELODI_CALLS.cancel(phone,cancel[1]);await reply(!row?'No encontré esa llamada.':row.state==='cancelled'?'Cancelé esa llamada.':row.state==='cancel_requested'?'La cancelación está en curso.':'Esa llamada ya no está pendiente.');return true;}
  if(typeof message.id!=='string'||!message.id){await reply('No pude verificar este pedido de llamada.');return true;}
  const result=await env.MELODI_CALLS.schedule({id:crypto.randomUUID(),phone,requestHash:await desktopHash(phone+':'+message.id),dueAt:parsed.dueAt,objective:parsed.objective,timeZone:env.TIME_ZONE||'UTC'});
  if(!result.created){await reply('Ese pedido de llamada ya está registrado. Estado: '+(LABELS[result.state]||result.state)+'.');return true;}
  await reply(`Guardé tu llamada telefónica por Telnyx para ${new Intl.DateTimeFormat('es',{timeZone:result.timeZone,dateStyle:'full',timeStyle:'short'}).format(result.dueAt)} (${result.timeZone}). La gestionaré desde la nube con mi voz de Cartesia, aunque el ordenador esté apagado.\nPara cancelarla: Cancela llamada ${result.id}`);return true;
 }catch{await reply('No pude confirmar ese cambio en tus llamadas. Puedes consultar «Mis llamadas» antes de repetir el pedido.');return true;}
}
export async function dispatchDueCalls(env,_services,{now=Date.now(),phone=owner(env)}={}){
 // Withdraw the desktop dispatcher. Future calls are durable alarms in the
 // cloud service; a PC poll or cron must never create a second phone call.
 await ensureCalls(env);
 if(await stmt(env,"SELECT name FROM sqlite_master WHERE type='table' AND name='brivany_desktop_commands'").first())await stmt(env,"UPDATE brivany_desktop_commands SET state='cancelled',updated_at=? WHERE phone=? AND state IN ('pending','claimed') AND id IN (SELECT command_id FROM brivany_call_schedules WHERE phone=? AND state IN ('scheduled','dispatching','queued'))",now,phone,phone).run();
 await stmt(env,"UPDATE brivany_call_schedules SET state='cancelled',updated_at=? WHERE phone=? AND state IN ('scheduled','dispatching','queued')",now,phone).run();
}
export async function deliverCallFailures(env,sendText){
 if(!env.MELODI_CALLS)return;
 const phone=owner(env),rows=await env.MELODI_CALLS.reserveNotices(phone);
 for(const row of rows){
  let accepted=false;
  try{await sendText(env,phone,`Tu llamada telefónica por Telnyx figura como ${row.reason==='no_answer'?'sin respuesta':LABELS[row.state]||row.state}.\n${row.id}`);accepted=true;}catch{/* The WhatsApp window may have closed; never re-dial or repeat a notice. */}
  await env.MELODI_CALLS.recordNotice(phone,row.id,accepted);
 }
}
