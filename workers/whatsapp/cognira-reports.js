import {localDateTimeToUtc,localEventTime,explicitReminderTime,clockContext} from './event-time.js';
import {calendarActivityPaused,calendarScheduleExclusion} from './google-calendar-guards.js';
export function reportRequest(text,now=new Date(),zone='America/Santo_Domingo'){
 const t=text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
 if(!/cognira|melodi/.test(t)||!/estadistic|usuarios?|uso|reporte|informe|resumen.*uso|uso.*resumen/.test(t))return null;
 if(/cancel|deten|desactiva/.test(t))return {cancel:true};
 const tomorrow=/\bmanana\b/.test(t.replace(/(?:de|por) la manana/g,''));
 if(/lunes|martes|miercoles|jueves|viernes|sabado|domingo|pasado manana|\d{4}-\d{2}-\d{2}|(?:en|dentro de) (?:una?|\d+) (?:hora|minuto)/.test(t))return {clarify:true};
 const email=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
 const channel=/email|correo/.test(t)?'email':'whatsapp';
 const hours=[...t.matchAll(/(?:a las?|y las?|,)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de la manana|de la tarde|de la noche)?/g)].map(m=>{let h=Number(m[1]),n=Number(m[2]||0);if(m[3]&&(h<1||h>12))return null;if(m[3])h=h%12+(/^(p|de la tarde|de la noche)/.test(m[3])?12:0);return h<24&&n<60?`${String(h).padStart(2,'0')}:${String(n).padStart(2,'0')}`:null}).filter(Boolean);
 const recurring=/diari|cada dia|todos los dias/.test(t);
 if(/program|diari|cada dia|todos los dias|manana|a las?\s*\d/.test(t)&&!hours.length)return {clarify:true};
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 const date=`${parts.year}-${parts.month}-${parts.day}`;
 const schedules=[...new Set(hours)].map(hour=>{let day=date;let at=localDateTimeToUtc(`${day}T${hour}`,zone);if(tomorrow||(recurring&&new Date(at)<=now)){day=new Date(new Date(date+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);at=localDateTimeToUtc(`${day}T${hour}`,zone)}return {at,hour,recurring};});
 if(!recurring&&schedules.length===1){const resolved=explicitReminderTime(text,now,zone);if(resolved!==undefined){if(!resolved.eventAt)return {clarify:true};schedules[0].at=resolved.eventAt;schedules[0].hour=clockContext(resolved.eventAt,zone).now_local.slice(11,16);}}
 if(schedules.some(s=>!s.at||new Date(s.at)<=now))return {clarify:true};
 return {channel,email,schedules,zone};
}
export async function usageReport(env,now=new Date()){
 if(env.MELODI_BUSINESS_ADMIN===false)throw Error('business_metrics_not_authorized');
 const day=now.toISOString().slice(0,10),week=new Date(now-6*86400000).toISOString().slice(0,10),month=new Date(now-29*86400000).toISOString().slice(0,10);
 const stats=await env.VETSA_CLOUD.prepare(`SELECT COUNT(DISTINCT CASE WHEN activity_day >= ? THEN user_id END) daily,COUNT(DISTINCT CASE WHEN activity_day >= ? THEN user_id END) weekly,COUNT(DISTINCT CASE WHEN activity_day >= ? THEN user_id END) monthly,COALESCE(SUM(CASE WHEN activity_day >= ? THEN requests ELSE 0 END),0) requests FROM cognira_daily_activity`).bind(day,week,month,day).first();
 const editions=await env.VETSA_CLOUD.prepare(`SELECT edition,COUNT(DISTINCT user_id) users,SUM(requests) requests FROM cognira_daily_activity WHERE activity_day >= ? GROUP BY edition`).bind(day).all();
 return `Melodi · Reporte Cognira Desktop\nCorte: ${localEventTime(now,env.TIME_ZONE||'America/Santo_Domingo')} (República Dominicana)\n\nUsuarios activos: hoy ${stats.daily}; últimos 7 días ${stats.weekly}; últimos 30 días ${stats.monthly}.\nSolicitudes de modelos hoy: ${stats.requests}.\n${editions.results.map(r=>`${r.edition==='full'?'Completa':'Beta'}: ${r.users} usuarios; ${r.requests} solicitudes.`).join('\n')}\n\nLos totales diarios disponibles están agrupados por fecha UTC. Actividad = cuenta autenticada que hizo una solicitud autorizada a modelos. Incluye intentos; no mide tiempo frente al PC, tareas terminadas ni instalaciones. Recuento disponible desde la activación de 4.1.`;
}
export async function handleUsageRequest(env,{phone,incoming,sendText,sendEmail}){
 const request=reportRequest(incoming,new Date(),env.TIME_ZONE);if(!request)return false;
 if(env.MELODI_BUSINESS_ADMIN===false){await sendText(env,phone,'Las estadísticas internas de la empresa están reservadas al operador del servicio.');return true;}
 if(request.cancel){await env.VETSA_CLOUD.prepare('DELETE FROM cognira_report_schedules WHERE owner_phone = ?').bind(phone).run();await sendText(env,phone,'Cancelé tus reportes programados de Cognira Desktop.');return true}
 if(request.clarify){await sendText(env,phone,'Indica las horas, por ejemplo: reportes de Cognira todos los días a las 09:00 y a las 18:00 por WhatsApp. Para email puedes añadir la dirección.');return true}
 const target=request.channel==='email'?(request.email||'ceo@vetsa.es'):phone;
 if(request.schedules.length){for(const s of request.schedules)await env.VETSA_CLOUD.prepare('INSERT INTO cognira_report_schedules(id,owner_phone,channel,target,next_at,recurring,time_zone,local_hour) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),phone,request.channel,target,s.at,s.recurring?1:0,request.zone,s.hour).run();await sendText(env,phone,`Programé reportes de Cognira por ${request.channel} a ${target}:\n${request.schedules.map(s=>localEventTime(s.at,request.zone)+(s.recurring?' · diario':'')).join('\n')}\nZona: ${request.zone}. Si WhatsApp bloquea el envío fuera de su ventana de conversación, el reporte se enviará a ceo@vetsa.es.`);return true}
 const body=await usageReport(env);if(request.channel==='email'){await sendEmail(env,phone,crypto.randomUUID(),{to:target,subject:'Reporte Cognira Desktop',body});await sendText(env,phone,`Envié el reporte a ${target}.`)}else await sendText(env,phone,body);return true;
}
export async function runUsageReports(env,sendText,sendEmail,now=new Date()){
 if(env.MELODI_BUSINESS_ADMIN===false)return;
 const calendarFilter=await calendarScheduleExclusion(env.VETSA_CLOUD,{kind:'cognira_report',ownerColumn:'owner_phone',idColumn:'id'});
 const claimed=await env.VETSA_CLOUD.prepare(`UPDATE cognira_report_schedules SET lease_until=? WHERE id IN (SELECT id FROM cognira_report_schedules WHERE owner_phone=? AND next_at<=? AND (lease_until IS NULL OR lease_until<?)${calendarFilter} LIMIT 5) RETURNING *`).bind(new Date(now.getTime()+300000).toISOString(),String(env.OWNER_WHATSAPP_NUMBER||'').replace(/\D/g,''),now.toISOString(),now.toISOString()).all();
 for(const row of claimed.results){try{if(await calendarActivityPaused(env.VETSA_CLOUD,row.owner_phone,'cognira_report',row.id))continue;const body=await usageReport(env,now);
 // A Calendar edit or cancellation can arrive while statistics are being read.
 // The lease and concrete schedule must still match before contacting anyone.
 const current=await env.VETSA_CLOUD.prepare('SELECT id FROM cognira_report_schedules WHERE id=? AND owner_phone=? AND next_at=? AND lease_until=? AND channel=? AND target=?').bind(row.id,row.owner_phone,row.next_at,row.lease_until,row.channel,row.target).first();
 if(!current||await calendarActivityPaused(env.VETSA_CLOUD,row.owner_phone,'cognira_report',row.id))continue;
 if(row.channel==='email'){const result=await sendEmail(env,row.owner_phone,`cognira-report-${row.id}-${row.next_at}`,{to:row.target,subject:'Reporte Cognira Desktop',body});if(result.status!=='sent')throw Error('Entrega de correo pendiente')}else {try{await sendText(env,row.owner_phone,body)}catch(error){if(!/131047/.test(error.message))throw error;const fresh=await env.VETSA_CLOUD.prepare('SELECT id FROM cognira_report_schedules WHERE id=? AND owner_phone=? AND next_at=? AND lease_until=?').bind(row.id,row.owner_phone,row.next_at,row.lease_until).first();if(!fresh)continue;const sent=await sendEmail(env,row.owner_phone,`cognira-report-${row.id}-${row.next_at}`,{to:'ceo@vetsa.es',subject:'Reporte Cognira Desktop · respaldo WhatsApp',body});if(sent.status!=='sent')throw Error('Correo de respaldo pendiente')}};
 if(row.recurring){const local=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:row.time_zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));const day=new Date(`${local.year}-${local.month}-${local.day}T12:00:00Z`);day.setUTCDate(day.getUTCDate()+1);const next=localDateTimeToUtc(day.toISOString().slice(0,10)+'T'+row.local_hour,row.time_zone);await env.VETSA_CLOUD.prepare('UPDATE cognira_report_schedules SET next_at=?,lease_until=NULL WHERE id=? AND owner_phone=? AND next_at=? AND lease_until=?').bind(next,row.id,row.owner_phone,row.next_at,row.lease_until).run()}else await env.VETSA_CLOUD.prepare('DELETE FROM cognira_report_schedules WHERE id=? AND owner_phone=? AND next_at=? AND lease_until=?').bind(row.id,row.owner_phone,row.next_at,row.lease_until).run();
 }catch(error){console.error('cognira_report_delivery_failed',row.id,error.message)}}
}
