import { createDeliveryNotices } from './delivery-notice.js';
import { listDueScreenshotReminders, screenshotReminderCurrent, confirmScreenshotReminder } from './screenshot-calendar-store.js';
import { clockContext } from './event-time.js';

export function screenshotReminderMessage(env,reminder,{now=Date.now()}={}) {
  const zone=env.TIME_ZONE || 'America/Santo_Domingo';
  const start=new Date(reminder.startAt),today=clockContext(now,zone).today_local,day=clockContext(start,zone).today_local;
  const time=new Intl.DateTimeFormat('es-DO',{timeZone:zone,hour:'numeric',minute:'2-digit',hour12:true}).format(start);
  const date=day===today ? 'hoy' : new Intl.DateTimeFormat('es-DO',{timeZone:zone,weekday:'long',day:'numeric',month:'long'}).format(start);
  return `Daniel, recuerda que ${reminder.title} empieza ${date} a las ${time}.`;
}
export async function currentScreenshotReminderMessage(env,owner,reminder,{now=Date.now()}={}) {
  return await screenshotReminderCurrent(env,owner,reminder,{now}) ? screenshotReminderMessage(env,reminder,{now}) : null;
}
export async function enqueueScreenshotReminders(env,{services,now=Date.now()}={}) {
  const owner=String(env.OWNER_WHATSAPP_NUMBER || '').replace(/\D/g,'');
  if (!owner) return {queued:0};
  const notices=createDeliveryNotices(env.VETSA_CLOUD,{...services,now:()=>now}); await notices.ensureSchema();
  let queued=0;
  for (const reminder of await listDueScreenshotReminders(env,owner,{now})) {
    if (!await screenshotReminderCurrent(env,owner,reminder,{now})) continue;
    const notice=await notices.enqueue({owner,agent:reminder.agent,key:`screenshot-reminder:${JSON.stringify(reminder)}`,
      body:screenshotReminderMessage(env,reminder,{now}),ownerRequested:true,screenshotReminder:reminder});
    if (notice.status==='sent') await confirmScreenshotReminder(env,owner,reminder,{now});
    queued++;
  }
  return {queued};
}
