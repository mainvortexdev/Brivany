import { detectScreenshotCalendarRequest, interpretScreenshotCalendarRequest } from './screenshot-calendar-request.js';
import { createScreenshotCalendarEvent } from './screenshot-calendar-store.js';
import { clockContext, localDateTimeToUtc, localEventTime } from './event-time.js';

const imageOf = session => (session?.state?.refs || []).find(ref => ref?.kind === 'image' && ref.objectKey);
const fold = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
const explicitAck = value => /^(?:si|vale|adelante|de acuerdo|reintenta|otra vez)(?:[, ]+por favor)?[.!]*$/.test(fold(value));
const screenshotContinuation = value => typeof value === 'string' && value.length<=700 && !/["“”«»`\r\n]/.test(value)
  && (/^(?:si|vale|adelante|de acuerdo|reintenta|otra vez|no|cancela|olvida|dejalo|a las?|muevelo|muevela|pasalo|pasala|cambialo|cambiala|empieza|termina|inicio|fin|el evento|la zona|la fecha|gmt|utc)\b/.test(fold(value))
    || /^\d{1,2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?)?\s*$/.test(fold(value))
    || /\b\d{4}-\d{2}-\d{2}\b|\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|octubre|noviembre|diciembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre)\b/.test(fold(value)));
const conflictQuestion = (conflict,env) => `«${conflict.title}» coincide con el inicio del evento${conflict.eventAt ? ` (${localEventTime(conflict.eventAt,env.TIME_ZONE || 'America/Santo_Domingo')})` : ''}. ¿A qué hora quieres moverlo?`;
function confirmedConflictTime(incoming, conflict, timeZone) {
  const value=fold(incoming).replace(/[.!]+$/,'');
  const match=value.match(/^(?:(?:muevelo|muevela|pasalo|pasala|cambialo|cambiala)\s+)?(?:a las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|de la manana|de la tarde|de la noche)?(?:[, ]+por favor)?$/);
  if(!match)return null;
  let hour=Number(match[1]);const minute=Number(match[2] || 0),period=match[3];
  if(minute>59 || hour>(period?12:23) || period && hour<1)return null;
  if(!period && hour>=1 && hour<=12)return{clarification:`¿A las ${hour}:${String(minute).padStart(2,'0')} de la mañana o de la tarde?`};
  if(period)hour=hour%12+(/^(?:p|de la tarde|de la noche)/.test(period)?12:0);
  const day=clockContext(conflict.eventAt,timeZone).today_local,eventAt=localDateTimeToUtc(`${day}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,timeZone);
  return eventAt?{id:conflict.id,previousEventAt:conflict.eventAt,eventAt}:null;
}

/** The owner caption supplies authority; OCR only supplies event data. Media
 * and any unresolved question stay private so a follow-up can finish the job. */
export async function prepareScreenshotCalendar(env, context, dependencies) {
  const { phone, message, incoming, session, descriptor, agent='melodi', reply, referenceAt=Date.now() }=context;
  const { storeMedia, readText, generate, setSession, clearSession, authorize, services, mutate=fn=>fn(), sync }=dependencies;
  const pending=session?.type==='await_screenshot_calendar';
  const request=detectScreenshotCalendarRequest(incoming);
  const continuing=pending && !request && (descriptor?.kind==='image' || message.type==='text' && screenshotContinuation(incoming));
  if (!request && !continuing) return false;
  let reference=imageOf(session);
  if (!reference && descriptor?.kind!=='image') {
    if (!/\b(?:esto|esta|captura|imagen|foto)\b/i.test(incoming)) return false;
    await setSession(env,phone,'await_screenshot_calendar',{refs:[],instruction:incoming,reason:'await_image'});
    await reply('Envíame la captura del evento y lo organizo con ese aviso.');
    return true;
  }
  if (continuing && /^(?:no|cancela|olvida|d[eé]jalo)[.!\s]*$/i.test(incoming.trim())) {
    await clearSession(env,phone); await reply('De acuerdo, dejo la agenda como está.'); return true;
  }
  if (descriptor?.kind==='image') reference=await storeMedia(env,phone,message);
  let instruction=continuing ? session.state.instruction : incoming;
  let sourceText=continuing && descriptor?.kind!=='image' ? session.state.sourceText : null;
  const refs=[reference];
  let conflictMoves=[];
  if (continuing && session.state.reason==='fixed_start_conflict') {
    const conflicts=session.state.conflicts || [];
    if(conflicts.length!==1 || !conflicts[0].id){await reply('Necesito resolver por separado los compromisos que coinciden con el inicio. No cambié tu agenda.');return true;}
    const resolution=confirmedConflictTime(incoming,conflicts[0],env.TIME_ZONE || 'America/Santo_Domingo');
    if(resolution?.clarification){await reply(resolution.clarification);return true;}
    if(!resolution){await reply(conflictQuestion(conflicts[0],env));return true;}
    conflictMoves=[resolution];
  }
  if (!sourceText) {
    // Save the actual attachment before asking a model to read it.
    await setSession(env,phone,'staging',{refs});
    try { sourceText=await readText(env,reference); }
    catch {
      await setSession(env,phone,'await_screenshot_calendar',{refs,instruction,reason:'screenshot_unreadable'});
      await reply('No pude leer la captura. Puedes reenviarla o decirme el nombre, las fechas y la zona horaria del evento.');
      return true;
    }
  }
  if (continuing && incoming.trim() && !explicitAck(incoming) && descriptor?.kind!=='image') sourceText+=`\nDatos confirmados por Daniel:\n${incoming.trim()}`;
  const interpreted=continuing && session.state.event && (explicitAck(incoming) || conflictMoves.length)
    ? {status:'validated',event:session.state.event}
    : await interpretScreenshotCalendarRequest(env,{instruction,sourceText,now:referenceAt},{generate});
  if (interpreted?.status!=='validated') {
    await setSession(env,phone,'await_screenshot_calendar',{refs,instruction,sourceText,...(interpreted?.event ? {event:interpreted.event} : {}),reason:interpreted?.reason || 'event_uncertain'});
    await reply(interpreted?.clarification || 'No pude leer bien las fechas. Dime cuándo empieza y termina el evento.');
    return true;
  }
  const event=interpreted.event;
  const allowLateNotice=continuing && session.state.reason==='advance_notice_elapsed' && explicitAck(incoming);
  // Keep the complete validated request before permission or durable mutation;
  // a denied grant or storage failure must not require another image/OCR.
  await setSession(env,phone,'await_screenshot_calendar',{refs,instruction,sourceText,event,reason:'ready'});
  const execution={message,normalized:instruction,interpretation:{intent:'create_reminder',agent,
    title:event.title,eventAt:event.startAt,screenshotCalendar:event,screenshotConflictMoves:conflictMoves},receiptSent:false};
  if (!await authorize(execution,reply)) return true;
  const saved=await mutate(()=>createScreenshotCalendarEvent(env,phone,message.id,event,{now:referenceAt,
    timeZone:env.TIME_ZONE || 'America/Santo_Domingo',services,conflictMoves,allowLateNotice}));
  if (!['applied','replayed'].includes(saved?.status) || !saved.event?.id || !saved.advance?.id) {
    await setSession(env,phone,'await_screenshot_calendar',{refs,instruction,sourceText,event,reason:saved?.reason || 'store_retry',conflicts:saved?.events || []});
    const conflict=saved?.events?.[0];
    await reply(conflict ? conflictQuestion(conflict,env)
      : saved?.clarification || 'No pude guardar el cambio completo. Tus actividades siguen como estaban.');
    return true;
  }
  // A failed Google dispatch does not undo the durable local schedule. The
  // minute reconciliation will retry publication using its stable event ID.
  if (sync) await sync(env,phone).catch(()=>console.error(JSON.stringify({event:'screenshot_calendar_sync_deferred'})));
  await clearSession(env,phone);
  const lead=event.remindBeforeMinutes===120 ? 'dos horas' : `${event.remindBeforeMinutes} minutos`;
  const moved=saved.moved?.map(item=>`«${item.title}» a ${localEventTime(item.to || item.eventAt || item.startAt,env.TIME_ZONE || 'America/Santo_Domingo')}`).join('; ');
  await reply(`Listo, Daniel. Agendé ${event.title}${allowLateNotice ? ' y dejé el aviso para ahora' : ` y te avisaré ${lead} antes`}.${moved ? ` Moví ${moved}.` : ''}`);
  return true;
}
