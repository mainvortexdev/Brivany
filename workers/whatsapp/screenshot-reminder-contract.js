const instant=value=>typeof value==='string' && Number.isFinite(Date.parse(value));
export function validScreenshotReminder(value) {
  return value && typeof value==='object' && !Array.isArray(value)
    && typeof value.eventId==='string' && /^screenshot-[a-f0-9]{64}$/.test(value.eventId)
    && value.id===`advance-${value.eventId}` && typeof value.title==='string' && value.title.length>0 && value.title.length<=240
    && ['startAt','endAt','deliverAt','updatedAt','scheduleUpdatedAt'].every(key=>instant(value[key]))
    && Date.parse(value.endAt)>Date.parse(value.startAt)
    && Number.isInteger(value.leadMinutes) && value.leadMinutes>=1 && value.leadMinutes<=10080
    && Date.parse(value.deliverAt)===Date.parse(value.startAt)-value.leadMinutes*60000
    && typeof value.sourceTimeZone==='string' && value.sourceTimeZone.length>0 && value.sourceTimeZone.length<=80
    && ['melodi'].includes(value.agent);
}
